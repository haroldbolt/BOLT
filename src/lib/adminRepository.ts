import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import type { Product, Store } from '../types';
import type { AdminUser, AdminProduct, AdminPresentation, AdminPromotion, InventoryMovement, AdminAuditEntry, DiscountResult } from '../types/admin';

export class AdminError extends Error {
  constructor(message: string, public status = 400, public code = 'INVALID_INPUT') { super(message); }
}
type SessionRecord = { user: AdminUser; csrfToken: string; expiresAt: number };
type LoginResult = SessionRecord & { token: string };
const SESSION_MS = 8 * 60 * 60 * 1000;
const CATEGORIES = ['Todo', 'Perros', 'Gatos', 'Alimentos', 'Arenas', 'Snacks', 'Farmacia', 'Antipulgas', 'Higiene', 'Accesorios'];
const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const clone = <T,>(value: T): T => structuredClone(value);

function text(value: unknown, label: string, max = 200, required = false): string {
  if (value === undefined || value === null) { if (required) throw new AdminError(`${label} es obligatorio.`); return ''; }
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new AdminError(`${label} no es válido.`);
  const result = value.trim();
  if (required && !result) throw new AdminError(`${label} es obligatorio.`);
  return result;
}
function number(value: unknown, label: string, max = 1_000_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new AdminError(`${label} debe ser un número válido mayor o igual a cero.`);
  return value;
}
function imageUrl(value: unknown): string {
  const result = text(value, 'La imagen', 2048);
  if (!result) return '';
  // Solo enlaces de imágenes. No se descargan ni se interpretan rutas de archivos del servidor.
  try { const url = new URL(result); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); }
  catch { throw new AdminError('La imagen debe ser una URL HTTPS válida.'); }
  return result;
}
function strings(value: unknown, label: string, max = 200): string[] {
  if (!Array.isArray(value) || value.length > max) throw new AdminError(`${label} debe ser una lista válida.`);
  return [...new Set(value.map(item => text(item, label, 300, true)))];
}
function passwordHash(password: string): string {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const result = scryptSync(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return `scrypt$131072$8$1$${salt}$${result.toString('hex')}`;
}
function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new AdminError('La contraseña debe tener entre 12 y 128 caracteres.');
}
function derivePassword(password: string, salt: string, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N, r, p, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
async function passwordHashAsync(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const result = await derivePassword(password, salt, 131072, 8, 1);
  return `scrypt$131072$8$1$${salt}$${result.toString('hex')}`;
}
async function passwordMatches(password: string, encoded: string): Promise<boolean> {
  const [, n, r, p, salt, expected] = encoded.split('$');
  if (!salt || !expected) return false;
  const computed = await derivePassword(password, salt, Number(n), Number(r), Number(p));
  const expectedBytes = Buffer.from(expected, 'hex');
  return computed.length === expectedBytes.length && timingSafeEqual(computed, expectedBytes);
}
// El usuario inexistente recibe el mismo trabajo de hash que una contraseña equivocada.
const DUMMY_PASSWORD = 'scrypt$131072$8$1$00000000000000000000000000000000$' + '0'.repeat(128);

export class AdminRepository {
  readonly db: DatabaseSync;
  readonly dataDir: string;
  readonly products: Product[];
  readonly stores: Store[];
  private transactionDepth = 0;
  private serialized = new Map<string, string>();
  private activeAuthentication = 0;

  constructor(options: { dataDir?: string; products: Product[]; stores: Store[] }) {
    this.dataDir = path.resolve(options.dataDir || process.env.BOLT_DATA_DIR || path.join(process.cwd(), '.bolt-private/operations'));
    this.products = options.products;
    this.stores = options.stores;
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const filename = path.join(this.dataDir, 'admin.sqlite');
    this.db = new DatabaseSync(filename);
    try { fs.chmodSync(filename, 0o600); } catch { /* Windows administra los permisos mediante la carpeta del usuario. */ }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS admin_users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_login_attempts (attempt_key TEXT PRIMARY KEY, failures INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS managed_products (id TEXT PRIMARY KEY, payload TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS promotions (id TEXT PRIMARY KEY, payload TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inventory_movements (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_audit (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operational_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS movements_product ON inventory_movements(product_id, created_at);
    `);
    const imported = this.db.prepare("SELECT value FROM admin_metadata WHERE name='catalog_imported'").get();
    const storedCount = Number(this.db.prepare('SELECT COUNT(*) AS count FROM managed_products').get()?.count || 0);
    // Crear una cuenta o un respaldo antes del primer arranque no equivale a
    // importar un catálogo vacío. También recupera el marcador vacío de versiones
    // anteriores sin reemplazar productos locales que ya se hubieran guardado.
    if (this.products.length > 0 && (!imported || storedCount === 0)) {
      this.transaction(() => {
        const existing = this.db.prepare('SELECT id FROM managed_products WHERE id=?');
        for (const product of this.products) {
          if (!existing.get(product.id)) this.saveProduct(product, 1, now());
        }
        this.db.prepare("INSERT INTO admin_metadata(name,value) VALUES ('catalog_imported',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").run(now());
      });
    }
    const originalReferences = new Map(this.products.map(product => [product.id, product]));
    const loaded = this.db.prepare('SELECT payload FROM managed_products ORDER BY rowid').all().map(row => JSON.parse(String(row.payload)) as Product);
    this.products.splice(0, this.products.length, ...loaded.map(product => {
      const original = originalReferences.get(product.id);
      return original ? Object.assign(original, product) : product;
    }));
    for (const product of this.products) this.serialized.set(product.id, JSON.stringify(product));
  }

  close(): void { this.db.close(); }

  transaction<T>(operation: () => T): T {
    if (this.transactionDepth) return operation();
    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth++;
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); this.serialized.clear(); throw error; }
    finally { this.transactionDepth--; }
  }

  readOperationalState(): any | null {
    const row = this.db.prepare('SELECT payload FROM operational_state WHERE id=1').get();
    return row ? JSON.parse(String(row.payload)) : null;
  }

  writeOperationalState(state: unknown): void {
    this.transaction(() => {
      this.persistCatalog();
      this.db.prepare('INSERT INTO operational_state(id,payload,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at').run(JSON.stringify(state), now());
    });
  }

  persistCatalog(): void {
    this.transaction(() => {
      for (const product of this.products) {
        const first = product.presentaciones?.[0] as AdminPresentation | undefined;
        if (first) {
          first.price = product.price;
          first.weightKg = product.weightKg;
          first.stockByStore = product.stockByStore;
          first.reservedStockByStore = product.reservedStockByStore;
          first.inventoryVerifiedByStore = (product as AdminProduct).inventoryVerifiedByStore;
        }
        const data = JSON.stringify(product);
        if (this.serialized.get(product.id) === data) continue;
        const row = this.db.prepare('SELECT version FROM managed_products WHERE id=?').get(product.id);
        this.saveProduct(product, Number(row?.version || 0) + 1, now());
      }
    });
  }

  private saveProduct(product: Product, version: number, updatedAt: string): void {
    const payload = JSON.stringify(product);
    this.db.prepare('INSERT INTO managed_products(id,payload,version,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=excluded.version,updated_at=excluded.updated_at').run(product.id, payload, version, updatedAt);
    this.serialized.set(product.id, payload);
  }

  hasAdministrator(): boolean { return !!this.db.prepare('SELECT id FROM admin_users LIMIT 1').get(); }

  createAdministrator(username: string, password: string, displayName?: string): AdminUser {
    username = text(username, 'El usuario', 64, true).toLowerCase();
    if (!/^[a-z0-9_.@-]{3,64}$/.test(username)) throw new AdminError('El usuario debe tener entre 3 y 64 caracteres: letras, números, punto, guion, @ o guion bajo.');
    const user: AdminUser = { id: randomUUID(), username, displayName: text(displayName || username, 'El nombre', 100, true) };
    const encoded = passwordHash(password);
    if (this.db.prepare('SELECT id FROM admin_users WHERE username=?').get(username)) throw new AdminError('Ese usuario ya existe.', 409, 'USER_EXISTS');
    this.transaction(() => {
      this.db.prepare('INSERT INTO admin_users VALUES (?,?,?,?,?)').run(user.id, username, user.displayName, encoded, now());
      this.audit('ADMIN_CREATED', user.id, user, 'Cuenta administrativa creada mediante configuración privada.');
    });
    return user;
  }

  resetPassword(username: string, password: string): void {
    const row = this.db.prepare('SELECT id,username,display_name FROM admin_users WHERE username=?').get(username.toLowerCase());
    if (!row) throw new AdminError('El usuario no existe.', 404);
    const encoded = passwordHash(password);
    this.transaction(() => {
      this.db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(encoded, String(row.id));
      this.db.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(String(row.id));
      this.audit('PASSWORD_RESET', String(row.id), { id: String(row.id), username: String(row.username), displayName: String(row.display_name) }, 'Contraseña restablecida localmente; sesiones revocadas.');
    });
  }

  async login(username: unknown, password: unknown, remoteAddress: string): Promise<LoginResult> {
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 128) throw new AdminError('Usuario o contraseña incorrectos.', 401, 'INVALID_CREDENTIALS');
    const normalized = username.trim().toLowerCase();
    const keys = [`ip:${hashToken(remoteAddress)}`, `user:${hashToken(normalized)}`];
    const time = Date.now();
    this.db.prepare('DELETE FROM admin_login_attempts WHERE expires_at<?').run(time);
    for (const [index, key] of keys.entries()) {
      const attempt = this.db.prepare('SELECT failures FROM admin_login_attempts WHERE attempt_key=?').get(key);
      if (Number(attempt?.failures || 0) >= (index === 0 ? 40 : 8)) throw new AdminError('Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.', 429, 'LOGIN_RATE_LIMIT');
    }
    if (this.activeAuthentication >= 2) throw new AdminError('Hay verificaciones en curso. Inténtalo en unos segundos.', 429, 'LOGIN_RATE_LIMIT');
    // Se reserva el intento antes del trabajo asíncrono para cerrar ráfagas concurrentes.
    for (const key of keys) this.db.prepare('INSERT INTO admin_login_attempts VALUES (?,1,?) ON CONFLICT(attempt_key) DO UPDATE SET failures=failures+1').run(key, time + 15 * 60 * 1000);
    const row = this.db.prepare('SELECT * FROM admin_users WHERE username=?').get(normalized);
    let valid = false;
    this.activeAuthentication++;
    try { valid = await passwordMatches(password, row ? String(row.password_hash) : DUMMY_PASSWORD); }
    finally { this.activeAuthentication--; }
    // Una rotación ocurrida durante scrypt invalida también la autenticación en curso.
    const currentPassword = row ? this.db.prepare('SELECT password_hash FROM admin_users WHERE id=?').get(String(row.id)) : undefined;
    if (!row || !valid || currentPassword?.password_hash !== row.password_hash) throw new AdminError('Usuario o contraseña incorrectos.', 401, 'INVALID_CREDENTIALS');
    this.db.prepare('DELETE FROM admin_login_attempts WHERE attempt_key=?').run(keys[1]);
    const user: AdminUser = { id: String(row.id), username: String(row.username), displayName: String(row.display_name) };
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const expiresAt = time + SESSION_MS;
    this.db.prepare('DELETE FROM admin_sessions WHERE expires_at<?').run(time);
    this.db.prepare('INSERT INTO admin_sessions VALUES (?,?,?,?)').run(hashToken(token), user.id, csrfToken, expiresAt);
    this.audit('LOGIN', user.id, user, 'Inicio de sesión administrativo.');
    return { token, user, csrfToken, expiresAt };
  }

  getSession(token: string | undefined): SessionRecord | null {
    if (!token || token.length > 256) return null;
    const row = this.db.prepare('SELECT s.csrf_token,s.expires_at,u.id,u.username,u.display_name FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(hashToken(token), Date.now());
    if (!row) return null;
    return { user: { id: String(row.id), username: String(row.username), displayName: String(row.display_name) }, csrfToken: String(row.csrf_token), expiresAt: Number(row.expires_at) };
  }

  logout(token: string): void { this.db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hashToken(token)); }

  async changePassword(user: AdminUser, currentPassword: unknown, nextPassword: unknown): Promise<void> {
    validatePassword(nextPassword);
    const time = Date.now();
    const key = `password:${user.id}`;
    this.db.prepare('DELETE FROM admin_login_attempts WHERE expires_at<?').run(time);
    const attempts = this.db.prepare('SELECT failures FROM admin_login_attempts WHERE attempt_key=?').get(key);
    if (Number(attempts?.failures || 0) >= 5 || this.activeAuthentication >= 2) throw new AdminError('Demasiadas verificaciones. Inténtalo más tarde.', 429, 'LOGIN_RATE_LIMIT');
    this.db.prepare('INSERT INTO admin_login_attempts VALUES (?,1,?) ON CONFLICT(attempt_key) DO UPDATE SET failures=failures+1').run(key, time + 15 * 60 * 1000);
    const row = this.db.prepare('SELECT password_hash FROM admin_users WHERE id=?').get(user.id);
    this.activeAuthentication++;
    try {
      if (typeof currentPassword !== 'string' || currentPassword.length > 128 || !row || !await passwordMatches(currentPassword, String(row.password_hash))) throw new AdminError('La contraseña actual no es correcta.', 400);
      if (currentPassword === nextPassword) throw new AdminError('La contraseña nueva debe ser diferente.');
      const encoded = await passwordHashAsync(nextPassword);
      this.transaction(() => {
        const update = this.db.prepare('UPDATE admin_users SET password_hash=? WHERE id=? AND password_hash=?').run(encoded, user.id, String(row.password_hash));
        if (Number(update.changes) !== 1) throw new AdminError('La contraseña cambió durante la verificación. Inicia sesión nuevamente.', 409, 'PASSWORD_CONFLICT');
        this.db.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(user.id);
        this.db.prepare('DELETE FROM admin_login_attempts WHERE attempt_key=?').run(key);
        this.audit('PASSWORD_CHANGED', user.id, user, 'Contraseña actualizada; todas las sesiones revocadas.');
      });
    } finally { this.activeAuthentication--; }
  }

  getProduct(id: string): AdminProduct {
    const product = this.products.find(item => item.id === id);
    const row = this.db.prepare('SELECT version,updated_at FROM managed_products WHERE id=?').get(id);
    if (!product || !row) throw new AdminError('Producto no encontrado.', 404, 'NOT_FOUND');
    const dataPending: string[] = [];
    if (!(product.price > 0)) dataPending.push('Precio');
    if (!(product.weightKg > 0)) dataPending.push('Peso');
    if (!product.image) dataPending.push('Foto');
    if (!Object.values((product as AdminProduct).inventoryVerifiedByStore || {}).some(Boolean)) dataPending.push('Existencias por verificar');
    return { ...clone(product), version: Number(row.version), updatedAt: String(row.updated_at), dataPending };
  }

  listProducts(options: { q?: string; status?: string; storeId?: string; variantId?: string; page?: number; pageSize?: number } = {}) {
    const q = (options.q || '').trim().toLocaleLowerCase('es-CO');
    const pageSize = Math.min(100, Math.max(1, Math.trunc(options.pageSize || 30)));
    const page = Math.max(1, Math.trunc(options.page || 1));
    const filtered = this.products.filter(product => {
      if (q && !`${product.name} ${product.brand} ${product.sku} ${(product.presentaciones || []).map(v => v.sku).join(' ')}`.toLocaleLowerCase('es-CO').includes(q)) return false;
      if (options.status && product.status !== options.status) return false;
      if (options.variantId && !product.presentaciones?.some(v => v.varianteId === options.variantId)) return false;
      const store = this.stores.find(s => s.id === options.storeId);
      if (options.storeId && !product.bodegaIds?.some(id => id === options.storeId || id === store?.shopifyLocationGid)) return false;
      return true;
    });
    return { products: filtered.slice((page - 1) * pageSize, page * pageSize).map(p => this.getProduct(p.id)), total: filtered.length, page, pageSize };
  }

  private checkVersion(productId: string, expected: unknown): number {
    const current = this.db.prepare('SELECT version FROM managed_products WHERE id=?').get(productId);
    if (!current) throw new AdminError('Producto no encontrado.', 404, 'NOT_FOUND');
    if (!Number.isSafeInteger(expected) || Number(expected) !== Number(current.version)) throw new AdminError('Este producto cambió. Vuelve a cargarlo antes de guardar.', 409, 'VERSION_CONFLICT');
    return Number(current.version);
  }

  private validateProduct(input: any, current?: Product): Product {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdminError('Datos de producto no válidos.');
    const result: Product = current ? clone(current) : {
      id: `LOCAL-${randomUUID()}`, sku: '', name: '', brand: '', species: 'Ambos', category: 'Alimentos', requiresPrescription: false,
      storageCondition: 'LUGAR_FRESCO_Y_SECO', temperatureColdChain: false, price: 0, presentation: 'Unidad', weightKg: 0, image: '', description: '',
      stockByStore: Object.fromEntries(this.stores.map(s => [s.id, 0])), reservedStockByStore: Object.fromEntries(this.stores.map(s => [s.id, 0])), rating: 0, reviewsCount: 0, tags: [], status: 'DRAFT', bodegaIds: [], presentaciones: [],
    };
    for (const [key, label, max] of [['name', 'El nombre', 250], ['sku', 'El SKU', 120], ['brand', 'La marca', 150], ['description', 'La descripción', 12000], ['presentation', 'La presentación', 150], ['barcode', 'El código de barras', 120], ['activeIngredient', 'El principio activo', 200], ['icaRegistration', 'El registro ICA', 100], ['concentration', 'La concentración', 150], ['pharmaceuticalForm', 'La forma farmacéutica', 150], ['authorizedInfo', 'La información autorizada', 2000]] as const) {
      if (key in input) (result as any)[key] = text(input[key], label, max, key === 'name');
    }
    if (!result.name) throw new AdminError('El nombre del producto es obligatorio.');
    if ('price' in input) result.price = number(input.price, 'El precio');
    if ('weightKg' in input) result.weightKg = number(input.weightKg, 'El peso', 100000);
    if ('category' in input) { if (!CATEGORIES.includes(input.category)) throw new AdminError('Categoría no válida.'); result.category = input.category; }
    if ('species' in input) { if (!['Perro', 'Gato', 'Ambos', 'Otros'].includes(input.species)) throw new AdminError('Especie no válida.'); result.species = input.species; }
    if ('status' in input) { if (!['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(input.status)) throw new AdminError('Estado no válido.'); result.status = input.status; }
    if ('requiresPrescription' in input) { if (typeof input.requiresPrescription !== 'boolean') throw new AdminError('Indica si requiere fórmula.'); result.requiresPrescription = input.requiresPrescription; }
    if ('temperatureColdChain' in input) { if (typeof input.temperatureColdChain !== 'boolean') throw new AdminError('Indica si requiere cadena de frío.'); result.temperatureColdChain = input.temperatureColdChain; }
    if ('storageCondition' in input) {
      if (!['TEMPERATURA_AMBIENTE', 'CADENA_FRIO_2_8', 'LUGAR_FRESCO_Y_SECO'].includes(input.storageCondition)) throw new AdminError('Condición de almacenamiento no válida.');
      result.storageCondition = input.storageCondition;
    }
    if ('pharmacySubcategory' in input) {
      if (input.pharmacySubcategory && !['Antipulgas y garrapatas', 'Desparasitación', 'Dermatología', 'Oídos y ojos', 'Cuidado digestivo', 'Vitaminas y suplementos', 'Curación y primeros auxilios', 'Medicamentos veterinarios'].includes(input.pharmacySubcategory)) throw new AdminError('Subcategoría de Farmacia no válida.');
      result.pharmacySubcategory = input.pharmacySubcategory || undefined;
    }
    if ('image' in input) result.image = imageUrl(input.image);
    if ('gallery' in input) result.gallery = strings(input.gallery, 'Las fotos', 30).map(imageUrl);
    if ('tags' in input) result.tags = strings(input.tags, 'Las etiquetas', 60);
    if ('bodegaIds' in input) {
      result.bodegaIds = strings(input.bodegaIds, 'Las bodegas', 20);
      if (result.bodegaIds.some(id => !this.stores.some(s => s.id === id || s.shopifyLocationGid === id))) throw new AdminError('Una bodega no existe.');
    }
    if ('presentaciones' in input) {
      if (!Array.isArray(input.presentaciones) || input.presentaciones.length > 200) throw new AdminError('Las presentaciones no son válidas.');
      const ids = new Set<string>();
      result.presentaciones = input.presentaciones.map((submitted: any) => {
        const variantId = submitted.varianteId ? text(submitted.varianteId, 'El identificador de presentación', 300, true) : `VAR-${randomUUID()}`;
        const previous = (current?.presentaciones as AdminPresentation[] || []).find(v => v.varianteId === variantId);
        if (submitted.varianteId && !previous && current && !variantId.startsWith('VAR-')) throw new AdminError('No se puede cambiar el identificador de una presentación existente.');
        if (ids.has(variantId)) throw new AdminError('Hay presentaciones repetidas.');
        ids.add(variantId);
        const variant: AdminPresentation = {
          varianteId: variantId, nombre: text(submitted.nombre, 'El nombre de presentación', 150, true), sku: text(submitted.sku || '', 'El SKU', 120), foto: imageUrl(submitted.foto || ''),
          bodegaIds: submitted.bodegaIds ? strings(submitted.bodegaIds, 'Las bodegas', 20) : clone(previous?.bodegaIds || result.bodegaIds || []),
          price: submitted.price === undefined ? previous?.price : number(submitted.price, 'El precio de presentación'),
          weightKg: submitted.weightKg === undefined ? previous?.weightKg : number(submitted.weightKg, 'El peso de presentación', 100000),
          stockByStore: clone(previous?.stockByStore || Object.fromEntries(this.stores.map(s => [s.id, 0]))),
          reservedStockByStore: clone(previous?.reservedStockByStore || Object.fromEntries(this.stores.map(s => [s.id, 0]))),
          inventoryVerifiedByStore: clone(previous?.inventoryVerifiedByStore || {}),
        };
        if (variant.bodegaIds.some(id => !this.stores.some(s => s.id === id || s.shopifyLocationGid === id))) throw new AdminError('Una bodega de la presentación no existe.');
        return variant;
      });
      const removed = (current?.presentaciones as AdminPresentation[] || []).filter(v => !ids.has(v.varianteId));
      if (removed.length) throw new AdminError('Conserva las presentaciones históricas. Para retirar el producto de la venta, archívalo.');
      if (current?.presentaciones?.[0] && result.presentaciones?.[0]?.varianteId !== current.presentaciones[0].varianteId) throw new AdminError('La presentación principal histórica debe conservar su posición.');
      for (const product of this.products) {
        if (product.id !== current?.id && product.presentaciones?.some(variant => ids.has(variant.varianteId))) throw new AdminError('Una presentación ya pertenece a otro producto.', 409, 'DUPLICATE_VARIANT');
      }
    }
    // La primera presentación mantiene la compatibilidad con los pedidos históricos agrupados.
    const first = result.presentaciones?.[0] as AdminPresentation | undefined;
    if (first) {
      // Una edición explícita de la ficha principal se refleja en su presentación,
      // pero archivar o ajustar inventario no reescribe los nombres/fotos importados.
      if ('presentation' in input) first.nombre = result.presentation;
      if ('sku' in input) first.sku = result.sku;
      if ('image' in input) first.foto = result.image;
      first.price = result.price;
      first.weightKg = result.weightKg;
      first.stockByStore = result.stockByStore;
      first.reservedStockByStore = result.reservedStockByStore;
      first.inventoryVerifiedByStore = (result as AdminProduct).inventoryVerifiedByStore;
    }
    const previousSkus = new Set([current?.sku, ...(current?.presentaciones || []).map(v => v.sku)].filter(Boolean));
    const candidateSkus = [result.sku, ...(result.presentaciones || []).map(v => v.sku)].filter(sku => sku && !previousSkus.has(sku));
    const variantSkus = (result.presentaciones || []).map(v => v.sku).filter(Boolean);
    if (candidateSkus.some(sku => variantSkus.filter(value => value === sku).length > 1)) throw new AdminError('Cada presentación nueva debe tener un SKU diferente.', 409, 'DUPLICATE_SKU');
    for (const product of this.products) {
      if (product.id === current?.id) continue;
      const other = new Set([product.sku, ...(product.presentaciones || []).map(v => v.sku)].filter(Boolean));
      if (candidateSkus.some(sku => other.has(sku))) throw new AdminError('Ese SKU ya está usado por otro producto.', 409, 'DUPLICATE_SKU');
    }
    return result;
  }

  createProduct(input: unknown, actor: AdminUser): AdminProduct {
    const product = this.validateProduct(input);
    this.transaction(() => { this.saveProduct(product, 1, now()); this.audit('PRODUCT_CREATED', product.id, actor, `Producto creado: ${product.name}`); });
    this.products.push(product);
    return this.getProduct(product.id);
  }

  updateProduct(id: string, input: any, actor: AdminUser): AdminProduct {
    const version = this.checkVersion(id, input?.version);
    const current = this.products.find(p => p.id === id)!;
    const next = this.validateProduct(input, current);
    this.transaction(() => { this.saveProduct(next, version + 1, now()); this.audit('PRODUCT_UPDATED', id, actor, `Producto actualizado: ${next.name}`); });
    Object.assign(current, next);
    return this.getProduct(id);
  }

  setArchived(id: string, archived: boolean, version: unknown, actor: AdminUser): AdminProduct {
    return this.updateProduct(id, { version, status: archived ? 'ARCHIVED' : 'ACTIVE' }, actor);
  }

  adjustInventory(id: string, input: any, actor: AdminUser): AdminProduct {
    const version = this.checkVersion(id, input?.version);
    const current = this.products.find(p => p.id === id)!;
    const product = clone(current);
    const storeId = text(input.storeId, 'La bodega', 100, true);
    const store = this.stores.find(s => s.id === storeId);
    if (!store || !store.isActive) throw new AdminError('Selecciona una bodega activa.');
    const quantity = number(input.quantity, 'La cantidad', 1_000_000_000);
    if (!Number.isSafeInteger(quantity)) throw new AdminError('La cantidad debe ser un entero.');
    const reason = text(input.reason, 'El motivo del ajuste', 500, true);
    const variantId = input.variantId ? text(input.variantId, 'La presentación', 300, true) : undefined;
    const variant = variantId ? (product.presentaciones as AdminPresentation[] || []).find(v => v.varianteId === variantId) : undefined;
    if (variantId && !variant) throw new AdminError('La presentación no existe.');
    const isPrimary = !variant || product.presentaciones?.[0]?.varianteId === variantId;
    const stock = isPrimary ? product.stockByStore : (variant!.stockByStore ||= {});
    const reservations = isPrimary ? product.reservedStockByStore : (variant!.reservedStockByStore ||= {});
    const reserved = reservations[storeId] || 0;
    if (quantity < reserved) throw new AdminError(`Hay ${reserved} unidades reservadas. La cantidad física no puede ser menor.`, 409, 'RESERVED_STOCK');
    const previousQuantity = stock[storeId] || 0;
    stock[storeId] = quantity;
    const verifiedTarget = isPrimary ? product as AdminProduct : variant!;
    (verifiedTarget.inventoryVerifiedByStore ||= {})[storeId] = true;
    if (isPrimary && product.presentaciones?.[0]) {
      const first = product.presentaciones[0] as AdminPresentation;
      first.stockByStore = product.stockByStore;
      first.reservedStockByStore = product.reservedStockByStore;
      first.inventoryVerifiedByStore = (product as AdminProduct).inventoryVerifiedByStore;
    }
    product.bodegaIds = [...new Set([...(product.bodegaIds || []), storeId])];
    if (variant) variant.bodegaIds = [...new Set([...(variant.bodegaIds || []), storeId])];
    const movement: InventoryMovement = { id: randomUUID(), productId: id, productName: product.name, variantId, storeId, previousQuantity, quantity, reserved, reason, actorId: actor.id, actorName: actor.displayName, createdAt: now() };
    this.transaction(() => {
      this.saveProduct(product, version + 1, now());
      this.db.prepare('INSERT INTO inventory_movements VALUES (?,?,?,?)').run(movement.id, id, JSON.stringify(movement), movement.createdAt);
      this.audit('INVENTORY_ADJUSTED', id, actor, `${store.name}: ${previousQuantity} → ${quantity}. ${reason}`);
    });
    Object.assign(current, product);
    return this.getProduct(id);
  }

  listMovements(options: { productId?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, Math.trunc(options.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(options.pageSize || 30)));
    const rows = options.productId ? this.db.prepare('SELECT payload FROM inventory_movements WHERE product_id=? ORDER BY created_at DESC').all(options.productId) : this.db.prepare('SELECT payload FROM inventory_movements ORDER BY created_at DESC').all();
    return { movements: rows.slice((page - 1) * pageSize, page * pageSize).map(row => JSON.parse(String(row.payload)) as InventoryMovement), total: rows.length, page, pageSize };
  }

  listPromotions(): AdminPromotion[] { return this.db.prepare('SELECT payload FROM promotions ORDER BY updated_at DESC').all().map(row => JSON.parse(String(row.payload))); }

  getActivePromotions(at = Date.now()): AdminPromotion[] {
    return this.listPromotions().filter(p => p.active && at >= Date.parse(p.startsAt) && at < Date.parse(p.endsAt));
  }

  savePromotion(input: any, actor: AdminUser, id?: string): AdminPromotion {
    if (!input || typeof input !== 'object') throw new AdminError('La promoción no es válida.');
    const current = id ? this.listPromotions().find(p => p.id === id) : undefined;
    if (id && !current) throw new AdminError('Promoción no encontrada.', 404);
    if (current && input.version !== current.version) throw new AdminError('La promoción cambió. Vuelve a cargarla.', 409, 'VERSION_CONFLICT');
    const type = input.type;
    if (type !== 'PERCENTAGE' && type !== 'FIXED') throw new AdminError('Selecciona descuento porcentual o de valor fijo.');
    const value = number(input.value, 'El descuento', type === 'PERCENTAGE' ? 100 : 1_000_000_000);
    if (value <= 0) throw new AdminError('El descuento debe ser mayor que cero.');
    const startsAt = text(input.startsAt, 'El inicio', 40, true);
    const endsAt = text(input.endsAt, 'El fin', 40, true);
    if (!/(Z|[+-]\d\d:\d\d)$/.test(startsAt) || !/(Z|[+-]\d\d:\d\d)$/.test(endsAt) || !Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt)) throw new AdminError('Las fechas deben incluir zona horaria y el fin debe ser posterior al inicio.');
    const productIds = strings(input.productIds || [], 'Los productos', 5000);
    const variantIds = strings(input.variantIds || [], 'Las presentaciones', 10000);
    const storeIds = strings(input.storeIds || [], 'Las bodegas', 20);
    if (productIds.some(pid => !this.products.some(p => p.id === pid))) throw new AdminError('Un producto seleccionado no existe.');
    if (variantIds.some(vid => !this.products.some(p => p.presentaciones?.some(v => v.varianteId === vid)))) throw new AdminError('Una presentación seleccionada no existe.');
    if (storeIds.some(sid => !this.stores.some(s => s.id === sid && s.isActive))) throw new AdminError('Selecciona bodegas activas.');
    if (typeof input.active !== 'boolean') throw new AdminError('El estado de la promoción no es válido.');
    const result: AdminPromotion = { id: id || `PROMO-${randomUUID()}`, name: text(input.name, 'El nombre', 150, true), type, value, productIds, variantIds, storeIds, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), minSubtotal: number(input.minSubtotal ?? 0, 'La compra mínima'), active: input.active, version: (current?.version || 0) + 1, updatedAt: now() };
    this.transaction(() => {
      this.db.prepare('INSERT INTO promotions VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=excluded.version,updated_at=excluded.updated_at').run(result.id, JSON.stringify(result), result.version, result.updatedAt);
      this.audit(current ? 'PROMOTION_UPDATED' : 'PROMOTION_CREATED', result.id, actor, `${result.name}: ${result.active ? 'activa' : 'pausada'}.`);
    });
    return result;
  }

  calculateDiscount(items: Array<{ productId: string; variantId?: string; price: number; quantity: number }>, storeId: string, at = Date.now(), eligiblePromotions?: AdminPromotion[]): DiscountResult {
    if (!Array.isArray(items) || items.some(item => !Number.isFinite(item.price) || item.price < 0 || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) || !Number.isFinite(at)) throw new AdminError('No se puede calcular la promoción con cantidades o precios inválidos.');
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    if (!Number.isFinite(subtotal) || subtotal > Number.MAX_SAFE_INTEGER / 100) throw new AdminError('El importe del pedido supera el rango permitido.');
    let result: DiscountResult = { discount: 0 };
    // Un catálogo puede reutilizar la lista obtenida una sola vez por solicitud.
    // No hay caché global: pausar o editar promociones surte efecto de inmediato.
    for (const promotion of eligiblePromotions ?? this.listPromotions()) {
      if (!promotion.active || at < Date.parse(promotion.startsAt) || at >= Date.parse(promotion.endsAt) || subtotal < promotion.minSubtotal || (promotion.storeIds.length && !promotion.storeIds.includes(storeId))) continue;
      const eligible = items.filter(item => (!promotion.productIds.length && !promotion.variantIds.length) || promotion.productIds.includes(item.productId) || (!!item.variantId && promotion.variantIds.includes(item.variantId))).reduce((sum, item) => sum + item.price * item.quantity, 0);
      const discount = Math.min(eligible, Math.round((promotion.type === 'PERCENTAGE' ? eligible * promotion.value / 100 : promotion.value) * 100) / 100);
      if (discount > result.discount) result = { discount, promotionId: promotion.id, promotionName: promotion.name };
    }
    return result;
  }

  audit(action: string, resourceId: string, actor: AdminUser, detail: string): void {
    const entry: AdminAuditEntry = { id: randomUUID(), action, resourceId, actorId: actor.id, actorName: actor.displayName, detail, createdAt: now() };
    this.db.prepare('INSERT INTO admin_audit VALUES (?,?,?)').run(entry.id, JSON.stringify(entry), entry.createdAt);
  }
  listAudit(): AdminAuditEntry[] { return this.db.prepare('SELECT payload FROM admin_audit ORDER BY created_at DESC LIMIT 200').all().map(row => JSON.parse(String(row.payload))); }

  backup(filename?: string): string {
    const backups = path.join(this.dataDir, 'backups');
    fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
    const destination = filename ? path.resolve(filename) : path.join(backups, `bolt-admin-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    if (fs.existsSync(destination)) throw new AdminError('La copia de seguridad ya existe; no se sobrescribe.');
    this.db.prepare('VACUUM INTO ?').run(destination);
    try { fs.chmodSync(destination, 0o600); } catch { /* Ver nota de permisos Windows en constructor. */ }
    return destination;
  }
}
