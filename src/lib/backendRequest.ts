/** Credentials are sent only to explicit, same-origin BOLT backend operations. */
export function backendAuthorization(url:RequestInfo|URL, token:string|null, origin:string):Headers {
  const headers=new Headers();
  const target=new URL(String(url),origin);
  const allowed=/^\/api\/v1\/(?:admin|operations|orders)(?:\/|$)/.test(target.pathname) || /^\/api\/v1\/stores\/[^/]+\/verify-entrance$/.test(target.pathname);
  if(token && target.origin===new URL(origin).origin && allowed)headers.set('Authorization',`Bearer ${token}`);
  return headers;
}
