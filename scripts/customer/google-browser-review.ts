/** Browser-facing controls for the isolated review only. All identities and credentials are fixtures. */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LEGAL_VERSION } from '../../src/customer/legal';
import { createGoogleCallbackHarness } from '../../src/tests/customer/googleCallbackHarness';

const callbackPath = '/api/customer-auth/callback/google';
const emailPath = '/api/customer-auth/sign-in/email';
const sessionPath = '/api/customer/me';
const logoutPath = '/api/customer-auth/sign-out';

export async function createBrowserReview() {
  const backend = await createGoogleCallbackHarness();
  try {
    const credential = await backend.provisionBrowserEmail();
    // Cookies are shared across ports. Isolate names from other BOLT installs on this computer.
    const prefix = 'review_' + randomUUID().replaceAll('-', '') + '_';
    function sendJSON(res: ServerResponse, value: unknown) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(value));
    }
    async function handle(req: IncomingMessage, res: ServerResponse, publicOrigin: string) {
      const url = new URL(req.url!, publicOrigin);
      const route = url.pathname;
      if (![callbackPath, emailPath, sessionPath, logoutPath, '/navegador/google'].includes(route)) return false;
      const read = route === sessionPath || route === callbackPath;
      if (req.method !== (read ? 'GET' : 'POST') || (!read && req.headers.origin !== publicOrigin)) {
        res.writeHead(403).end();
        return true;
      }
      const cookies = (req.headers.cookie || '').split(';').map(value => value.trim())
        .filter(value => value.startsWith(prefix + 'bolt_customer.')).map(value => value.slice(prefix.length)).join('; ');
      async function upstream(endpoint: string, body?: object) {
        const response = await fetch(backend.origin + endpoint, {
          method: body ? 'POST' : 'GET', redirect: 'manual', credentials: 'omit',
          headers: { Cookie: cookies, Origin: backend.origin, ...(body && {'Content-Type':'application/json'}) },
          body: body && JSON.stringify(body), signal: AbortSignal.timeout(10_000),
        });
        const set = response.headers.getSetCookie().filter(c => c.startsWith('bolt_customer.')).map(c => prefix + c);
        if (set.length) res.setHeader('Set-Cookie', set);
        return response;
      }
      if (route === sessionPath) {
        const response = await upstream(sessionPath);
        if (!response.ok) throw Error('Consulta de sesión indisponible');
        const { user } = await response.json();
        // The session itself is resolved by /api/customer/me using the cookies of this browser.
        sendJSON(res, {user: user && { name: user.name, providers: user.providers }});
      } else if (route === '/navegador/google') {
        const response = await upstream('/api/customer-auth/sign-in/social', {
          provider:'google', requestSignUp:true, disableRedirect:true, callbackURL:'/cuenta',
          errorCallbackURL:'/cuenta?error=oauth',
          additionalData:{ legalConsent:{ version:LEGAL_VERSION, terms:true, privacy:true, marketing:false } },
        });
        if (!response.ok) throw Error('No se pudo iniciar el acceso');
        const auth = backend.provider.authorize((await response.json()).url, 'valid', {
          subject:'browser-review-google', email:'navegador-google@example.invalid', name:'Cliente Google de prueba',
        });
        // The simulated provider returns to the browser. BOLT consumes its state and exchanges the code.
        sendJSON(res, { returnTo: callbackPath + '?' + new URLSearchParams(auth) });
      } else if (route === callbackPath) {
        const params = new URLSearchParams();
        for (const key of ['code','state']) {
          const values = url.searchParams.getAll(key);
          if (values.length !== 1 || !values[0] || values[0].length > 4096) {
            res.writeHead(400).end(); return true;
          }
          params.set(key, values[0]);
        }
        const reply = await upstream(callbackPath + '?' + params);
        const target = new URL(reply.headers.get('location') || '/error', backend.origin);
        const ok = reply.status === 302 && target.origin === backend.origin && target.pathname === '/cuenta' && !target.search;
        res.writeHead(303, {Location: ok ? '/#sesion-navegador' : '/?resultado=error#sesion-navegador'}).end();
      } else {
        const response = await upstream(route, route === emailPath ? credential : {});
        if (!response.ok) throw Error('No se completó el acceso solicitado');
        // Never forward token responses to the review page. Better Auth owns its HttpOnly cookie.
        res.writeHead(204).end();
      }
      return true;
    }
    return { handle, close: backend.close };
  } catch (error) { await backend.close(); throw error; }
}
