import type { OAuth2Tokens } from "@better-auth/core/oauth2";
import type { GoogleProfile } from "@better-auth/core/social-providers";
import { createLocalJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

const googleCerts = "https://www.googleapis.com/oauth2/v3/certs";
const issuers = ["https://accounts.google.com", "accounts.google.com"];
const maxCacheMs = 10 * 60_000;
const keyMissCooldownMs = 30_000;

function cacheLifetime(headers: Headers) {
  const control = headers.get("cache-control") || "";
  if (/\b(?:no-store|no-cache)\b/i.test(control)) return 0;
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?\s*(?:,|$)/i.exec(control);
  const age = Number(headers.get("age") || 0);
  if (!maxAge || !Number.isFinite(age) || age < 0) return 0;
  return Math.min(maxCacheMs, Math.max(0, Number(maxAge[1]) - age) * 1000);
}

function googleSigningKeys(): JWTVerifyGetKey {
  type Keys = { resolve: ReturnType<typeof createLocalJWKSet>; expiresAt: number };
  let current: Keys | undefined;
  let loading: Promise<Keys> | undefined;
  let nextKeyMissRefresh = 0;

  async function load(): Promise<Keys> {
    const response = await fetch(googleCerts, {
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw Error("Google signing keys unavailable");
    const expiresAt = Date.now() + cacheLifetime(response.headers);
    const resolve = createLocalJWKSet(await response.json());
    current = { resolve, expiresAt };
    return current;
  }
  function refresh() {
    loading ??= load().finally(() => { loading = undefined; });
    return loading;
  }

  return async (header, token) => {
    if (typeof header.kid !== "string" || !header.kid.trim()) throw Error("Missing signing key ID");
    const now = Date.now();
    const cached = current;
    if (!cached || now >= cached.expiresAt) return (await refresh()).resolve(header, token);
    try {
      return await cached.resolve(header, token);
    } catch (error) {
      // Allow a newly rotated key to work before max-age, with bounded refreshes on misses.
      if (!(error instanceof errors.JWKSNoMatchingKey)) throw error;
      if (loading) return (await loading).resolve(header, token);
      if (current && current !== cached) return current.resolve(header, token);
      if (now < nextKeyMissRefresh) throw error;
      nextKeyMissRefresh = now + keyMissCooldownMs;
      return (await refresh()).resolve(header, token);
    }
  };
}

/** Called by Better Auth after the server-side code exchange and before resolving a customer. */
export function googleUserInfo(clientId: string) {
  const keys = googleSigningKeys();
  return async (tokens: OAuth2Tokens & { expectedIdTokenNonce?: string }) => {
    if (!tokens.idToken) return null;
    try {
      const { payload } = await jwtVerify<GoogleProfile>(tokens.idToken, keys, {
        algorithms: ["RS256"],
        issuer: issuers,
        audience: clientId,
        maxTokenAge: "1h",
        requiredClaims: ["sub", "exp", "iat", "email", "email_verified"],
      });
      const { sub, aud, azp, email } = payload;
      if (typeof sub !== "string" || !sub.trim() || sub !== sub.trim() || sub.length > 255) return null;
      if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return null;
      if (Array.isArray(aud) && !aud.every(a => typeof a === "string" && a.length > 0)) return null;
      const needsAuthorizedParty = Array.isArray(aud) && aud.length > 1;
      if ((needsAuthorizedParty || azp !== undefined) && azp !== clientId) return null;
      if (payload.nonce !== tokens.expectedIdTokenNonce) return null;
      if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(email) || payload.email_verified !== true) return null;
      return {
        data: payload,
        user: {
          email,
          emailVerified: true,
          name: typeof payload.name === "string" ? payload.name : undefined,
          image: typeof payload.picture === "string" ? payload.picture : undefined,
        },
      };
    } catch {
      // The callback uses its ordinary error redirect and cannot persist an identity or session.
      return null;
    }
  };
}
