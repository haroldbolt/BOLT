import { pathToFileURL } from 'node:url';

const maxBytes = 128 * 1024;
const maxAgeMs = 5 * 60_000;

class ProbeError extends Error {}

function configuration(env) {
  const origin = new URL(env.BOLT_MONITOR_ORIGIN);
  const timeout = env.BOLT_MONITOR_TIMEOUT_MS ?? '5000';
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' ||
      origin.search || origin.hash || env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
      !/^[1-9]\d*$/.test(timeout) || Number(timeout) > 60_000) throw new Error();
  return { origin: origin.origin, timeout: Number(timeout) };
}

async function readJson(response) {
  const reject = reason => {
    response.body?.cancel().catch(() => {});
    throw new ProbeError(reason);
  };
  if (response.redirected || (response.status >= 300 && response.status < 400)) reject('REDIRECT');
  if (response.status !== 200) reject('HTTP_STATUS');
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') reject('CONTENT_TYPE');
  if (Number(response.headers.get('content-length')) > maxBytes) reject('BODY_LIMIT');
  if (!response.body) reject('INVALID_JSON');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        reader.cancel().catch(() => {});
        throw new ProbeError('BODY_LIMIT');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
  catch { throw new ProbeError('INVALID_JSON'); }
}

function countStores(name, data, timestamp) {
  if (name === 'health') {
    const age = timestamp - Date.parse(data?.timestamp);
    if (data?.status !== 'ok' || data.service !== 'Bolt Pets Authoritative Backend' ||
        data.timezone !== 'America/Bogota' || !Number.isSafeInteger(data.storesCount) || data.storesCount < 1 ||
        !Number.isFinite(age) || age > maxAgeMs || age < -60_000) throw new ProbeError('HEALTH_CONTRACT');
    return data.storesCount;
  }
  if (!Array.isArray(data) || !data.length || !data.every(store => store?.isActive === true &&
      typeof store.id === 'string' && store.id.trim() && typeof store.name === 'string' && store.name.trim()) ||
      new Set(data.map(store => store.id)).size !== data.length) throw new ProbeError('STORES_CONTRACT');
  return data.length;
}

async function probe(config, name, fetcher, now) {
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout);
  let status;
  try {
    const response = await fetcher(new URL('/api/v1/' + name, config.origin), {
      method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store',
      headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    status = response.status;
    const count = countStores(name, await readJson(response), now());
    return { name, ok: true, status, latencyMs: Math.round(performance.now() - start), count };
  } catch (err) {
    const reason = controller.signal.aborted ? 'TIMEOUT' : err instanceof ProbeError ? err.message : 'NETWORK_ERROR';
    return { name, ok: false, status, latencyMs: Math.round(performance.now() - start), reason };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAvailability(env, fetcher = fetch, now = Date.now) {
  let config;
  try { config = configuration(env); }
  catch { return { code: 2, report: { ok: false, reason: 'INVALID_CONFIGURATION' } }; }
  const checks = await Promise.all(['health', 'stores'].map(name => probe(config, name, fetcher, now)));
  const allPassed = checks.every(check => check.ok);
  const mismatch = allPassed && checks[0].count !== checks[1].count;
  const ok = allPassed && !mismatch;
  return { code: ok ? 0 : 1, report: { ok, checkedAt: new Date(now()).toISOString(),
    ...(mismatch ? { reason: 'STORE_COUNT_MISMATCH' } : {}), checks } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, report } = await checkAvailability(process.env);
  console.log(JSON.stringify(report));
  process.exitCode = code;
}
