import type { AdminProduct, AdminSession, AdminPromotion } from '../types/admin';

let csrfToken = '';
export const getAdminCsrfToken = () => csrfToken;
export const setAdminCsrfToken = (token?: string) => { csrfToken = token || ''; };

export class AdminApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (csrfToken && options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(path.startsWith('/api/') ? path : `/api/v1/admin${path}`, {
    ...options, headers, credentials: 'same-origin',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/login') window.dispatchEvent(new Event('bolt-admin-session-expired'));
    throw new AdminApiError(payload.error || 'No se pudo completar la operación.', response.status);
  }
  return payload as T;
}

export const adminApi = {
  async session() {
    const session = await adminRequest<AdminSession>('/session');
    setAdminCsrfToken(session.csrfToken);
    return session;
  },
  async login(username: string, password: string) {
    const session = await adminRequest<AdminSession>('/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    setAdminCsrfToken(session.csrfToken);
    return session;
  },
  async logout() {
    await adminRequest('/logout', { method: 'POST' });
    setAdminCsrfToken();
  },
  product(id: string) { return adminRequest<AdminProduct>(`/products/${encodeURIComponent(id)}`); },
  saveProduct(product: Partial<AdminProduct>, existing: boolean) {
    return adminRequest<AdminProduct>(existing ? `/products/${encodeURIComponent(product.id!)}` : '/products', {
      method: existing ? 'PUT' : 'POST', body: JSON.stringify(product),
    });
  },
  archive(product: AdminProduct, restore: boolean) {
    return adminRequest<AdminProduct>(`/products/${encodeURIComponent(product.id)}/${restore ? 'restore' : 'archive'}`, {
      method: 'POST', body: JSON.stringify({ version: product.version }),
    });
  },
  savePromotion(promotion: Partial<AdminPromotion>, existing: boolean) {
    return adminRequest<AdminPromotion>(existing ? `/promotions/${encodeURIComponent(promotion.id!)}` : '/promotions', {
      method: existing ? 'PUT' : 'POST', body: JSON.stringify(promotion),
    });
  },
};
