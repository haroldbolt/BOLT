import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AdminError, AdminRepository } from './adminRepository';
import type { AdminUser } from '../types/admin';

export const ADMIN_COOKIE = 'bolt_admin_session';

export function adminToken(req: Request): string | undefined {
  const cookie = (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${ADMIN_COOKIE}=`));
  if (!cookie) return undefined;
  try { return decodeURIComponent(cookie.slice(ADMIN_COOKIE.length + 1)); } catch { return undefined; }
}

export function resolveAdmin(req: Request, repository: AdminRepository): AdminUser | null {
  return repository.getSession(adminToken(req))?.user || null;
}

export function requireAdmin(repository: AdminRepository): RequestHandler {
  return (req, res, next) => {
    const session = repository.getSession(adminToken(req));
    if (!session) return res.status(401).json({ error: 'Inicia sesión para acceder al administrador.', code: 'AUTH_REQUIRED' });
    res.locals.adminUser = session.user;
    res.locals.adminSession = session;
    next();
  };
}

function originAllowed(req: Request): boolean {
  const origin = req.get('origin');
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return false;
  if (!origin) return true; // Clientes no navegador siguen necesitando sesión y token CSRF.
  const configured = process.env.BOLT_PUBLIC_ORIGIN;
  try {
    const url = new URL(origin);
    if (configured) return url.origin === new URL(configured).origin;
    return url.host === req.get('host') && url.protocol === `${req.protocol}:`;
  } catch { return false; }
}

export function requireMutation(repository: AdminRepository): RequestHandler {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (!originAllowed(req)) return res.status(403).json({ error: 'El origen de la solicitud no está permitido.', code: 'ORIGIN_REJECTED' });
    const session = repository.getSession(adminToken(req));
    if (!session) return res.status(401).json({ error: 'La sesión administrativa terminó.', code: 'AUTH_REQUIRED' });
    const value = req.get('x-csrf-token') || '';
    const actual = Buffer.from(value);
    const expected = Buffer.from(session.csrfToken);
    if (!actual.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(403).json({ error: 'La verificación de seguridad venció. Recarga la página.', code: 'CSRF_REJECTED' });
    res.locals.adminUser = session.user;
    res.locals.adminSession = session;
    next();
  };
}

export function createAdminRouter(repository: AdminRepository, options: { onCatalogChange?: () => void; onPromotionChange?: () => void } = {}) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  const sessionBody = (req: Request) => {
    const session = repository.getSession(adminToken(req));
    return { authenticated: !!session, ...(session ? { user: session.user, csrfToken: session.csrfToken } : {}), setupRequired: !repository.hasAdministrator() };
  };
  const cookieOptions = (req: Request) => {
    const address = req.socket.remoteAddress || '';
    const local = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    let configuredHttps = false;
    try { configuredHttps = new URL(process.env.BOLT_PUBLIC_ORIGIN || '').protocol === 'https:'; } catch { /* Sin origen público válido, se utiliza el transporte real. */ }
    return { httpOnly: true, sameSite: 'strict' as const, secure: req.secure || configuredHttps || !local, path: '/api/v1', maxAge: 8 * 60 * 60 * 1000 };
  };
  const wrap = (handler: (req: Request, res: Response) => unknown): RequestHandler => (req, res, next) => {
    try { Promise.resolve(handler(req, res)).catch(next); } catch (error) { next(error); }
  };

  router.get('/session', (req, res) => res.json(sessionBody(req)));
  router.post('/login', wrap(async (req, res) => {
    if (!originAllowed(req)) throw new AdminError('El origen de la solicitud no está permitido.', 403, 'ORIGIN_REJECTED');
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');
    if (!local && !req.secure && !process.env.BOLT_PUBLIC_ORIGIN?.startsWith('https://')) throw new AdminError('El acceso remoto al administrador requiere HTTPS.', 426, 'HTTPS_REQUIRED');
    const result = await repository.login(req.body?.username, req.body?.password, req.socket.remoteAddress || 'unknown');
    res.cookie(ADMIN_COOKIE, result.token, cookieOptions(req));
    res.json({ authenticated: true, user: result.user, csrfToken: result.csrfToken, setupRequired: false });
  }));

  router.use(requireAdmin(repository));
  router.use(requireMutation(repository));
  router.post('/logout', wrap((req, res) => {
    const token = adminToken(req);
    if (token) repository.logout(token);
    res.clearCookie(ADMIN_COOKIE, { ...cookieOptions(req), maxAge: undefined });
    res.json({ authenticated: false, setupRequired: !repository.hasAdministrator() });
  }));
  router.post('/password', wrap(async (req, res) => {
    await repository.changePassword(res.locals.adminUser, req.body?.currentPassword, req.body?.newPassword);
    res.clearCookie(ADMIN_COOKIE, { ...cookieOptions(req), maxAge: undefined });
    res.json({ ok: true, message: 'Contraseña actualizada. Inicia sesión nuevamente.' });
  }));

  router.get('/products', wrap((req, res) => res.json(repository.listProducts({
    q: typeof req.query.q === 'string' ? req.query.q.slice(0, 250) : '',
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    storeId: typeof req.query.storeId === 'string' ? req.query.storeId : undefined,
    variantId: typeof req.query.variantId === 'string' ? req.query.variantId : undefined,
    page: Number(req.query.page) || 1, pageSize: Number(req.query.pageSize) || 30,
  }))));
  router.get('/products/:id', wrap((req, res) => res.json(repository.getProduct(req.params.id))));
  router.post('/products', wrap((req, res) => {
    const product = repository.createProduct(req.body, res.locals.adminUser);
    options.onCatalogChange?.();
    res.status(201).json(product);
  }));
  router.put('/products/:id', wrap((req, res) => {
    const product = repository.updateProduct(req.params.id, req.body, res.locals.adminUser);
    options.onCatalogChange?.();
    res.json(product);
  }));
  router.post('/products/:id/archive', wrap((req, res) => {
    const product = repository.setArchived(req.params.id, true, req.body?.version, res.locals.adminUser);
    options.onCatalogChange?.();
    res.json(product);
  }));
  router.post('/products/:id/restore', wrap((req, res) => {
    const product = repository.setArchived(req.params.id, false, req.body?.version, res.locals.adminUser);
    options.onCatalogChange?.();
    res.json(product);
  }));
  router.post('/products/:id/inventory', wrap((req, res) => {
    const product = repository.adjustInventory(req.params.id, req.body, res.locals.adminUser);
    options.onCatalogChange?.();
    res.json(product);
  }));
  router.get('/inventory/movements', wrap((req, res) => res.json(repository.listMovements({
    productId: typeof req.query.productId === 'string' ? req.query.productId : undefined,
    page: Number(req.query.page) || 1, pageSize: Number(req.query.pageSize) || 30,
  }))));
  router.get('/promotions', wrap((_req, res) => res.json(repository.listPromotions())));
  router.post('/promotions', wrap((req, res) => {
    const promotion = repository.savePromotion(req.body, res.locals.adminUser);
    options.onPromotionChange?.();
    res.status(201).json(promotion);
  }));
  router.put('/promotions/:id', wrap((req, res) => {
    const promotion = repository.savePromotion(req.body, res.locals.adminUser, req.params.id);
    options.onPromotionChange?.();
    res.json(promotion);
  }));
  router.get('/audit', wrap((_req, res) => res.json({ entries: repository.listAudit() })));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AdminError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error('[Administración] No fue posible completar la operación.');
    res.status(500).json({ error: 'No se pudo guardar la operación. Inténtalo nuevamente.', code: 'SERVER_ERROR' });
  });
  return router;
}
