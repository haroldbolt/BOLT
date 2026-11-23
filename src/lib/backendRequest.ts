const splitAccountNotice = 'En esta versión de BOLT puedes comprar y consultar tus pedidos como invitado. El acceso por cuenta aún no está disponible.';

export function parseBoltApiOrigin(value?: string): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try { url = new URL(value); }
  catch { throw Error('VITE_BOLT_API_ORIGIN debe ser un origen HTTPS exacto.'); }
  if (url.protocol !== 'https:' || (value !== url.origin && value !== url.origin + '/')) {
    throw Error('VITE_BOLT_API_ORIGIN debe ser un origen HTTPS exacto.');
  }
  return url.origin;
}

export function createBoltBackend(frontendOrigin: () => string, configuredOrigin?: string) {
  const configured = parseBoltApiOrigin(configuredOrigin);
  const split = () => !!configured && configured !== frontendOrigin();
  const url = (path: string | URL) => {
    const origin = configured ?? frontendOrigin();
    const target = new URL(path, origin);
    if (target.origin !== origin || target.username || target.password || target.hash ||
        !target.pathname.startsWith('/api/v1/')) {
      throw Error('Ruta de API de BOLT no autorizada.');
    }
    return target;
  };
  return {
    split,
    url,
    fetch(path: string | URL, options?: RequestInit) {
      const target = url(path);
      return split()
        ? fetch(target.href, { ...options, credentials: 'omit', redirect: 'error' })
        : fetch(path, options);
    },
    catalogImage(src?: string) {
      if (!split() || !src?.startsWith('/uploads/catalog/')) return src;
      const target = new URL(src, configured);
      return target.pathname.startsWith('/uploads/catalog/') ? target.href : undefined;
    },
  };
}

const browserBackend = createBoltBackend(
  () => typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  import.meta.env?.VITE_BOLT_API_ORIGIN,
);

export const isBoltSplitDeployment = browserBackend.split;
export const backendUrl = browserBackend.url;
export const backendFetch = browserBackend.fetch;
export const backendCatalogImage = browserBackend.catalogImage;
export const splitCustomerAccountNotice = splitAccountNotice;

/** Admin credentials are limited to their operations at the selected BOLT API origin. */
export function backendAuthorization(url: string | URL, token: string | null, origin: string): Headers {
  const headers = new Headers();
  const target = new URL(url, origin);
  const allowed = /^\/api\/v1\/(?:admin|operations|orders)(?:\/|$)/.test(target.pathname) ||
    ['/api/v1/shopify/status', '/api/v1/integrations/status', '/api/v1/inventory/status'].includes(target.pathname) ||
    /^\/api\/v1\/stores\/[^/]+\/verify-entrance$/.test(target.pathname);
  if (token && target.origin === new URL(origin).origin && allowed) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

/** Static PWAs keep receipt routes reloadable without a server path rewrite. */
export function customerNavigationUrl(path: string, split = isBoltSplitDeployment()) {
  if (!split || !/^\/(pedido|confirmacion)\/[A-Za-z0-9_-]+\/?$/.test(path)) return path;
  return '/?vista=' + encodeURIComponent(path);
}
export function customerNavigationPath(location: Pick<Location, 'pathname' | 'search'>) {
  const requested = new URLSearchParams(location.search).get('vista');
  return isBoltSplitDeployment() && location.pathname === '/' && requested &&
    /^\/(pedido|confirmacion)\/[A-Za-z0-9_-]+\/?$/.test(requested)
      ? requested : location.pathname;
}
