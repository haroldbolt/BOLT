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

type PublicAdmin = Omit<AdminUser, 'passwordHash' | 'salt'>;

function publicAdmin(user: AdminUser): PublicAdmin {
  const { id, email, name, role, storeId, createdAt, lastLoginAt } = user;
  return { id, email, name, role, storeId, createdAt, lastLoginAt };
}

function parseAccounts(raw: string): Map<string, AdminUser> {
  const data = JSON.parse(raw);
  if (data?.version !== '1.0.0' || !Array.isArray(data.admins) || !data.admins.length) throw Error('Invalid account list');
  const accounts = new Map<string, AdminUser>();
  const ids = new Set<string>();
  for (const account of data.admins) {
    if (!account || typeof account.id !== 'string' || !account.id.trim() || ids.has(account.id) ||
        typeof account.email !== 'string' || !account.email.includes('@') || accounts.has(account.email.toLowerCase()) ||
        typeof account.name !== 'string' || !account.name.trim() || !Number.isFinite(Date.parse(account.createdAt)) ||
        typeof account.passwordHash !== 'string' || !/^[a-f0-9]{128}$/i.test(account.passwordHash) ||
        typeof account.salt !== 'string' || !/^[a-f0-9]{32}$/i.test(account.salt) ||
        !(account.role === 'ADMINISTRADOR' || (account.role === 'OPERADOR_SEDE' && typeof account.storeId === 'string' && account.storeId.trim()))) {
      throw Error('Invalid account record');
    }
    ids.add(account.id);
    accounts.set(account.email.toLowerCase(), account);
  }
  if (!data.admins.some((account: AdminUser) => account.role === 'ADMINISTRADOR')) throw Error('Missing coordinator');
  return accounts;
}

export class AdminAuthService {
  private admins: Map<string, AdminUser> = new Map();
  private activeSessions: Map<string, AdminSession> = new Map();
  private storageAvailable = true;

  constructor(private authFile=AUTH_FILE_PATH) {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      const stat = fs.lstatSync(this.authFile, { throwIfNoEntry: false });
      if (stat) {
        if (!stat.isFile()) throw Error('Invalid account storage');
        this.admins = parseAccounts(fs.readFileSync(this.authFile, 'utf8'));
        return;
      }
    } catch {
      throw Error('Almacenamiento de administración ilegible. Recupera la copia autorizada antes de iniciar.');
    }

    // Optional environment variable injection (without exposing default credentials in source code)
    const envEmail = process.env.BOLT_ADMIN_EMAIL?.trim();
    const envPassword = process.env.BOLT_ADMIN_PASSWORD?.trim();
    if (envEmail && envPassword) {
      if (!envEmail.includes('@') || envPassword.length < 8) throw Error('Verifica las credenciales administrativas iniciales del entorno.');
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
      this.saveToDisk(new Map([[newAdmin.email, newAdmin]]));
      console.log('[AdminAuthService] Administrador inicial aprovisionado.');
    }

  }

  private requireStorage(): void {
    if (!this.storageAvailable) throw Error('Almacenamiento de administración pendiente de recuperación.');
  }

  private saveToDisk(accounts: Map<string, AdminUser>): void {
    this.requireStorage();
    const data: PersistedAuthData = { version: '1.0.0', admins: Array.from(accounts.values()) };
    try {
      atomicJson(this.authFile, data);
    } catch {
      // A failure after rename can leave a committed file. Reload on restart before granting access.
      this.storageAvailable = false;
      this.activeSessions.clear();
      throw Error('No se pudo confirmar la escritura de cuentas. Revisa el almacenamiento y reinicia.');
    }
    this.admins = accounts;
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
    return { id: user.id, name: user.name, storeId };
  }

  public revokeStoreOperator(id: string): boolean {
    const operator = Array.from(this.admins.values()).find(user => user.id === id && user.role === 'OPERADOR_SEDE');
    if (!operator) return false;
    const accounts = new Map(this.admins);
    accounts.delete(operator.email);
    this.saveToDisk(accounts);
    for (const [token, session] of this.activeSessions) {
      if (session.userId === id) this.activeSessions.delete(token);
    }
    return true;
  }

  private hashPassword(password: string, salt: string): string {
    return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  }

  public isSetupRequired(): boolean {
    this.requireStorage();
    return this.admins.size === 0;
  }

  public getAdminCount(): number {
    this.requireStorage();
    return this.admins.size;
  }

  public setupMasterAdmin(params: { email: string; password: string; name: string }): { success: boolean; user?: PublicAdmin; token?: string; error?: string } {
    this.requireStorage();

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

    this.saveToDisk(new Map(this.admins).set(email, newAdmin));

    // Crear sesión de inmediato
    const token = this.createSession(newAdmin);

    return {
      success: true,
      user: publicAdmin(newAdmin),
      token,
    };
  }

  public login(email: string, password: string): { success: boolean; token?: string; user?: PublicAdmin; error?: string } {
    this.requireStorage();

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

    const updated = { ...admin, lastLoginAt: new Date().toISOString() };
    this.saveToDisk(new Map(this.admins).set(normalizedEmail, updated));
    return { success: true, token: this.createSession(updated), user: publicAdmin(updated) };
  }

  private createSession(admin: AdminUser): string {
    const token = `bolt_sec_${crypto.randomBytes(32).toString('hex')}`;
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();

    const session: AdminSession = {
      userId: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      storeId: admin.storeId,
      createdAt: new Date().toISOString(),
      expiresAt,
    };

    const digest = crypto.createHash('sha256').update(token).digest('hex');
    this.activeSessions.set(digest, session);
    return token;
  }

  // Existing administrative routes only accept unrestricted coordination sessions.
  public verifySession(token: string | undefined): AdminSession | null {
    const session = this.verifyStaffSession(token);
    return session?.role === 'ADMINISTRADOR' ? session : null;
  }

  public verifyStaffSession(token: string | undefined): AdminSession | null {
    if (!this.storageAvailable || !token) return null;
    const digest = crypto.createHash('sha256').update(token).digest('hex');
    const session = this.activeSessions.get(digest);
    if (!session) return null;

    // Comprobar expiración
    if (new Date(session.expiresAt) < new Date()) {
      this.activeSessions.delete(digest);
      return null;
    }

    return session;
  }

  public logout(token: string): boolean {
    return this.activeSessions.delete(crypto.createHash('sha256').update(token).digest('hex'));
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
