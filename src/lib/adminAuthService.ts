import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  salt: string;
  role: 'ADMINISTRADOR';
  createdAt: string;
  lastLoginAt?: string;
}

export interface AdminSession {
  token: string;
  userId: string;
  email: string;
  name: string;
  role: 'ADMINISTRADOR';
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

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(AUTH_FILE_PATH)) {
        const raw = fs.readFileSync(AUTH_FILE_PATH, 'utf-8');
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

  private saveToDisk(): void {
    try {
      const data: PersistedAuthData = {
        version: '1.0.0',
        admins: Array.from(this.admins.values()),
      };
      const dir = path.dirname(AUTH_FILE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(AUTH_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[AdminAuthService] Error saving admin auth file:', err);
    }
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
      createdAt: new Date().toISOString(),
      expiresAt,
    };

    this.activeSessions.set(token, session);
    return session;
  }

  public verifySession(token: string | undefined): AdminSession | null {
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
    if (fs.existsSync(AUTH_FILE_PATH)) {
      try {
        fs.unlinkSync(AUTH_FILE_PATH);
      } catch {}
    }
  }
}

export const adminAuthService = new AdminAuthService();
