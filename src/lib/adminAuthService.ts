import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { atomicJson } from './fulfillmentStorage';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  salt: string;
  role: 'ADMINISTRADOR' | 'OPERADOR_SEDE';
  storeId?: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface AdminSession {
  token: string;
  userId: string;
  email: string;
  name: string;
  role: 'ADMINISTRADOR' | 'OPERADOR_SEDE';
  storeId?: string;
  createdAt: string;
  expiresAt: string;
}

interface PersistedAuthData {
  version: string;
  admins: AdminUser[];
}

const AUTH_FILE_PATH = path.join(process.cwd(), 'src', 'data', 'persisted-admin-auth.json');
const SESSION_DURATION_HOURS = 24;

export class AdminAuthService {
  private admins: Map<string, AdminUser> = new Map();
  private activeSessions: Map<string, AdminSession> = new Map();
  private isLoaded = false;

  constructor(private authFile=AUTH_FILE_PATH) {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.authFile)) {
        const raw = fs.readFileSync(this.authFile, 'utf-8');
        const data: PersistedAuthData = JSON.parse(raw);
        if (Array.isArray(data.admins)) {
          this.admins.clear();
          data.admins.forEach(admin => {
            this.admins.set(admin.email.toLowerCase(), admin);
          });
        }
      }
    } catch (err) {
      console.warn('[AdminAuthService] Error reading persisted admin auth file:', err);
    }

    // Optional environment variable injection (without exposing default credentials in source code)
    const envEmail = process.env.BOLT_ADMIN_EMAIL?.trim();
    const envPassword = process.env.BOLT_ADMIN_PASSWORD?.trim();
    if (envEmail && envPassword && !this.admins.has(envEmail.toLowerCase())) {
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = this.hashPassword(envPassword, salt);
      const newAdmin: AdminUser = {
        id: `adm-${Date.now().toString(36)}`,
        email: envEmail.toLowerCase(),
        name: process.env.BOLT_ADMIN_NAME?.trim() || 'Administrador Bolt Pets',
        passwordHash,
        salt,
        role: 'ADMINISTRADOR',
        createdAt: new Date().toISOString(),
      };
      this.admins.set(envEmail.toLowerCase(), newAdmin);
      this.saveToDisk();
      console.log(`[AdminAuthService] Administrador inicial aprovisionado desde variables de entorno: ${envEmail}`);
    }

    this.isLoaded = true;
  }

  private saveToDisk(accounts = this.admins): void {
    const data: PersistedAuthData = { version: '1.0.0', admins: Array.from(accounts.values()) };
    atomicJson(this.authFile, data);
  }

  public createStoreOperator(email: string, name: string, password: string, storeId: string) {
    const key = email.trim().toLowerCase();
    if (this.admins.has(key)) return undefined;
    const salt = crypto.randomBytes(16).toString('hex');
    const user: AdminUser = {
      id: 'ops-' + crypto.randomUUID(), email: key, name: name.trim(), role: 'OPERADOR_SEDE',
      storeId, salt, passwordHash: this.hashPassword(password.trim(), salt), createdAt: new Date().toISOString(),
    };
    const accounts = new Map(this.admins).set(key, user);
    this.saveToDisk(accounts);
    this.admins = accounts;
    return { id: user.id, name: user.name, storeId };
  }

  public revokeStoreOperator(id: string): boolean {
    const operator = Array.from(this.admins.values()).find(user => user.id === id && user.role === 'OPERADOR_SEDE');
    if (!operator) return false;
    const accounts = new Map(this.admins);
    accounts.delete(operator.email);
    this.saveToDisk(accounts);
    this.admins = accounts;
    for (const [token, session] of this.activeSessions) {
      if (session.userId === id) this.activeSessions.delete(token);
    }
    return true;
  }

  private hashPassword(password: string, salt: string): string {
    return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  }

  public isSetupRequired(): boolean {
    if (!this.isLoaded) this.loadFromDisk();
    return this.admins.size === 0;
  }

  public getAdminCount(): number {
    if (!this.isLoaded) this.loadFromDisk();
    return this.admins.size;
  }

  public setupMasterAdmin(params: { email: string; password: string; name: string }): { success: boolean; user?: AdminUser; token?: string; error?: string } {
    if (!this.isLoaded) this.loadFromDisk();

    // Solo se permite configurar si no existe ningún administrador
    if (this.admins.size > 0) {
      return { success: false, error: 'Ya existe un administrador registrado en el sistema. Inicia sesión con tus credenciales.' };
    }

    const email = params.email.trim().toLowerCase();
    const password = params.password.trim();
    const name = params.name.trim();

    if (!email || !email.includes('@')) {
      return { success: false, error: 'Proporciona un correo electrónico válido.' };
    }
    if (!password || password.length < 8) {
      return { success: false, error: 'La contraseña administrativa debe tener al menos 8 caracteres.' };
    }
    if (!name) {
      return { success: false, error: 'Proporciona el nombre del administrador.' };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = this.hashPassword(password, salt);

    const newAdmin: AdminUser = {
      id: `adm-master-${Date.now().toString(36)}`,
      email,
      name,
      passwordHash,
      salt,
      role: 'ADMINISTRADOR',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };

    this.admins.set(email, newAdmin);
    this.saveToDisk();

    // Crear sesión de inmediato
    const session = this.createSession(newAdmin);

    return {
      success: true,
      user: newAdmin,
      token: session.token,
    };
  }

  public login(email: string, password: string): { success: boolean; token?: string; user?: Omit<AdminUser, 'passwordHash' | 'salt'>; error?: string } {
    if (!this.isLoaded) this.loadFromDisk();

    const normalizedEmail = email.trim().toLowerCase();
    const admin = this.admins.get(normalizedEmail);

    if (!admin) {
      return { success: false, error: 'Credenciales inválidas. Verifica tu correo y contraseña.' };
    }

    const computedHash = this.hashPassword(password.trim(), admin.salt);
    const hashBuffer = Buffer.from(computedHash, 'hex');
    const storedBuffer = Buffer.from(admin.passwordHash, 'hex');

    if (hashBuffer.length !== storedBuffer.length || !crypto.timingSafeEqual(hashBuffer, storedBuffer)) {
      return { success: false, error: 'Credenciales inválidas. Verifica tu correo y contraseña.' };
    }

    // Actualizar último login
    admin.lastLoginAt = new Date().toISOString();
    this.admins.set(normalizedEmail, admin);
    this.saveToDisk();

    const session = this.createSession(admin);

    return {
      success: true,
      token: session.token,
      user: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        createdAt: admin.createdAt,
        lastLoginAt: admin.lastLoginAt,
      },
    };
  }

  private createSession(admin: AdminUser): AdminSession {
    const token = `bolt_sec_${crypto.randomBytes(32).toString('hex')}`;
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();

    const session: AdminSession = {
      token,
      userId: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      storeId: admin.storeId,
      createdAt: new Date().toISOString(),
      expiresAt,
    };

    this.activeSessions.set(token, session);
    return session;
  }

  // Existing administrative routes only accept unrestricted coordination sessions.
  public verifySession(token: string | undefined): AdminSession | null {
    const session = this.verifyStaffSession(token);
    return session?.role === 'ADMINISTRADOR' ? session : null;
  }

  public verifyStaffSession(token: string | undefined): AdminSession | null {
    if (!token) return null;
    const session = this.activeSessions.get(token);
    if (!session) return null;

    // Comprobar expiración
    if (new Date(session.expiresAt) < new Date()) {
      this.activeSessions.delete(token);
      return null;
    }

    return session;
  }

  public logout(token: string): boolean {
    return this.activeSessions.delete(token);
  }

  /**
   * Resetea el almacenamiento para suites de pruebas automatizadas aisladas
   */
  public resetForTesting(): void {
    this.admins.clear();
    this.activeSessions.clear();
    if (fs.existsSync(this.authFile)) {
      try {
        fs.unlinkSync(this.authFile);
      } catch {}
    }
  }
}

export const adminAuthService = new AdminAuthService();
