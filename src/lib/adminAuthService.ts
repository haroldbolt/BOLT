import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { atomicJson } from './fulfillmentStorage';
import { AdminBootstrap, type AdminBinding } from './adminBootstrap';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  salt: string;
  role: 'ADMINISTRADOR' | 'OPERADOR_SEDE';
  storeId?: string;
  rotationRecommended?: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface AdminSession {
  userId: string;
  email: string;
  name: string;
  role: 'ADMINISTRADOR' | 'OPERADOR_SEDE';
  storeId?: string;
  rotationRecommended?: boolean;
  createdAt: string;
  expiresAt: string;
}

type AuthMode = { mode: 'managed'; env: NodeJS.ProcessEnv; offlineBootstrap?: true } | { mode: 'isolated' };
type SetupState = 'open' | 'closed' | 'recovery-required';
const RECOVERY = 'Almacenamiento de administración pendiente de recuperación. Recupera la copia autorizada antes de iniciar.';

const AUTH_FILE_PATH = path.join(process.cwd(), 'src', 'data', 'persisted-admin-auth.json');
const SESSION_DURATION_HOURS = 24;

type PublicAdmin = Omit<AdminUser, 'passwordHash' | 'salt'>;

function publicAdmin(user: AdminUser): PublicAdmin {
  const { id, email, name, role, storeId, createdAt, lastLoginAt } = user;
  return { id, email, name, role, storeId, createdAt, lastLoginAt, ...(user.rotationRecommended === true && { rotationRecommended: true }) };
}

export function parseAdminAccounts(data: any): Map<string, AdminUser> {
  if (!['1.0.0','2.0.0'].includes(data?.version) || !Array.isArray(data.admins) || !data.admins.length) throw Error('Invalid account list');
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

  private control?: AdminBootstrap;
  private binding?: AdminBinding;
  private diskIdentity?: fs.Stats;

  constructor(private authFile = AUTH_FILE_PATH, private access: AuthMode = { mode: 'managed', env: process.env }) {
    try {
      if (access.mode === 'managed') this.control = AdminBootstrap.fromEnvironment(access.env, authFile);
      this.loadFromDisk();
    } catch {
      this.lockForRecovery();
      if (access.mode === 'isolated') throw Error(RECOVERY);
    }
  }

  private lockForRecovery() {
    this.storageAvailable = false;
    this.activeSessions.clear();
  }

  private loadFromDisk() {
    const stat = fs.lstatSync(this.authFile, { throwIfNoEntry: false });
    if (!stat) {
      if (this.control && this.control.inspect() !== 'open') throw Error(RECOVERY);
      return;
    }
    if (!stat.isFile()) throw Error(RECOVERY);
    const raw = fs.readFileSync(this.authFile, 'utf8');
    const data = JSON.parse(raw);
    const accounts = parseAdminAccounts(data);
    this.diskIdentity = stat;
    if (this.control) {
      if (data.version === '1.0.0') {
        if (this.control.inspect(undefined, raw) !== 'adopt') throw Error(RECOVERY);
        this.binding = this.control.adopt(raw);
      } else {
        if (!data.bootstrap) throw Error(RECOVERY);
        this.binding = data.bootstrap as AdminBinding;
      }
      const binding = this.binding!;
      const owner = [...accounts.values()].find(user =>
        user.role === 'ADMINISTRADOR' && this.control!.matchesAccount(binding, user.email));
      if (!owner) throw Error(RECOVERY);
      if (data.version === '1.0.0') this.saveToDisk(accounts);
      this.control.complete(binding, owner.email);
    } else if (data.version !== '1.0.0') {
      throw Error(RECOVERY);
    }
    this.admins = accounts;
  }

  private matchesDisk() {
    const current = fs.lstatSync(this.authFile, { throwIfNoEntry: false });
    const saved = this.diskIdentity;
    return saved ? !!current && current.isFile() && current.dev === saved.dev &&
      current.ino === saved.ino && current.ctimeMs === saved.ctimeMs && current.size === saved.size : !current;
  }

  public setupState(): SetupState {
    if (!this.storageAvailable) return 'recovery-required';
    try {
      if (!this.matchesDisk()) throw Error(RECOVERY);
      if (this.control) {
        const state = this.control.inspect(this.binding);
        if (state !== 'open' && state !== 'closed') throw Error(RECOVERY);
        if (state === 'open' && this.access.mode === 'managed' && !this.access.offlineBootstrap && (this.access.env.BOLT_ADMIN_SETUP_TOKEN?.trim().length ?? 0) < 32) return 'recovery-required';
        return state;
      }
      return this.admins.size ? 'closed' : 'open';
    } catch {
      this.lockForRecovery();
      return 'recovery-required';
    }
  }

  private requireStorage(): void {
    if (!this.storageAvailable) throw Error(RECOVERY);
  }

  private saveToDisk(accounts: Map<string, AdminUser>): void {
    this.requireStorage();
    const data = this.binding
      ? { version: '2.0.0', bootstrap: this.binding, admins: [...accounts.values()] }
      : { version: '1.0.0', admins: [...accounts.values()] };
    try {
      if (!this.matchesDisk()) throw Error(RECOVERY);
      atomicJson(this.authFile, data);
      this.diskIdentity = fs.lstatSync(this.authFile);
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
    accounts.delete(operator.email.toLowerCase());
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
    const state = this.setupState();
    if (state === 'recovery-required') throw Error(RECOVERY);
    return state === 'open';
  }

  public getAdminCount(): number {
    this.requireStorage();
    return this.admins.size;
  }

  public setupMasterAdmin(params: { email: string; password: string; name: string }): { success: boolean; user?: PublicAdmin; token?: string; error?: string; status?: number } {
    // Solo se permite configurar si no existe ningún administrador
    const state = this.setupState();
    if (state === 'recovery-required') return { success: false, status: 503, error: RECOVERY };
    if (state === 'closed') {
      return { success: false, status: 409, error: 'Ya existe un administrador registrado en el sistema. Inicia sesión con tus credenciales.' };
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

    if (this.control) {
      try { this.binding = this.control.reserve(email); }
      catch {
        return this.setupState() === 'open'
          ? { success: false, status: 403, error: 'Alta no autorizada para esta cuenta.' }
          : { success: false, status: 503, error: RECOVERY };
      }
    }
    try {
      this.saveToDisk(new Map(this.admins).set(email, newAdmin));
      if (this.control) this.control.complete(this.binding!, email);
    } catch {
      this.lockForRecovery();
      return { success: false, status: 503, error: RECOVERY };
    }

    const token = this.access.mode === 'managed' && this.access.offlineBootstrap
      ? undefined : this.createSession(newAdmin);

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
      ...(admin.rotationRecommended && { rotationRecommended: true }),
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
    if (!token || this.setupState() !== 'closed') return null;
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

  /** Offline maintenance only. Caller holds the same writer lock as the running service. */
  public maintainCredential(email: string, password?: string) {
    if (this.setupState() !== 'closed' || !this.control) throw Error(RECOVERY);
    const user = this.admins.get(email.trim().toLowerCase());
    if (!user) throw Error('Cuenta administrativa desconocida.');
    const updated = { ...user };
    if (password === undefined) {
      updated.rotationRecommended = true;
    } else {
      if (password !== password.trim() || password.length < 16 || password.length > 256 ||
          this.hashPassword(password, user.salt) === user.passwordHash) throw Error('Se requiere una contraseña distinta de 16 a 256 caracteres, sin espacios exteriores.');
      updated.salt = crypto.randomBytes(16).toString('hex');
      updated.passwordHash = this.hashPassword(password, updated.salt);
      delete updated.rotationRecommended;
    }
    this.saveToDisk(new Map(this.admins).set(user.email.toLowerCase(), updated));
    for (const [digest, session] of this.activeSessions) {
      if (session.userId === user.id) this.activeSessions.delete(digest);
    }
  }
}
