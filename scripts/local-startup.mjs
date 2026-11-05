export const BOLT_APP_ID = 'bolt-pets-actual';

export async function probeBoltHealth(url, { fetchImpl = fetch, timeoutMs = 3000 } = {}) {
  try {
    const response = await fetchImpl(`${url}/api/v1/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { status: 'foreign' };
    const info = await response.json();
    if (info?.appId !== BOLT_APP_ID) return { status: 'foreign' };
    return { status: info.status === 'ok' ? 'ready' : 'offline' };
  } catch (error) {
    if (error instanceof SyntaxError) return { status: 'foreign' };
    return { status: 'offline' };
  }
}

export function occupiedPortError(url) {
  const error = new Error(`El puerto de ${url} responde con otra aplicación. No se cerró ni modificó ese programa. Usa otro PORT o cierra ese programa antes de abrir Bolt Pets.`);
  error.code = 'BOLT_PORT_BUSY';
  return error;
}

/** Espera por disponibilidad real; las pruebas usan reloj y sondeo simulados. */
export async function waitForReady({
  url, probe = () => probeBoltHealth(url), getFailure = () => undefined,
  now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = 90_000, pollMs = 500, progressMs = 10_000, onProgress = () => {},
}) {
  const started = now();
  let nextProgress = progressMs;
  while (true) {
    const result = await probe();
    if (result.status === 'ready') return { reused: Boolean(getFailure()) };
    if (result.status === 'foreign') throw occupiedPortError(url);
    const failure = getFailure();
    if (failure) throw failure;
    const elapsed = now() - started;
    if (elapsed >= timeoutMs) {
      const error = new Error(`Bolt Pets todavía no responde después de ${Math.round(timeoutMs / 1000)} segundos. Puede seguir iniciándose; vuelve a abrir el acceso para comprobarlo.`);
      error.code = 'BOLT_START_TIMEOUT';
      throw error;
    }
    if (elapsed >= nextProgress) {
      onProgress(Math.floor(elapsed / 1000));
      nextProgress = (Math.floor(elapsed / progressMs) + 1) * progressMs;
    }
    await wait(Math.min(pollMs, timeoutMs - elapsed));
  }
}

/** Guarda el proceso nuevo antes de esperar, incluso cuando el arranque falla. */
export async function trackStartup({ child, url, root, writeMetadata, now = Date.now, ...options }) {
  let failure;
  const onError = error => { failure = new Error(`No se pudo iniciar el proceso de Bolt Pets: ${error.message}`); };
  const onExit = (code, signal) => { failure = new Error(`El servidor de Bolt Pets terminó durante el inicio${signal ? ` (${signal})` : ` (código ${code})`}. Revisa el registro privado.`); };
  child.once('error', onError);
  child.once('exit', onExit);
  const record = { pid: child.pid ?? null, url, root, startedAt: new Date(now()).toISOString(), status: 'starting' };
  writeMetadata(record);
  try {
    const result = await waitForReady({ url, now, getFailure: () => failure, ...options });
    writeMetadata({ ...record, pid: result.reused ? null : record.pid, status: 'ready', ...(result.reused ? { reused: true } : {}), readyAt: new Date(now()).toISOString() });
  } catch (error) {
    writeMetadata({ ...record, status: error.code === 'BOLT_START_TIMEOUT' ? 'starting' : 'failed', lastError: error.message, checkedAt: new Date(now()).toISOString() });
    throw error;
  } finally {
    child.removeListener('error', onError);
    child.removeListener('exit', onExit);
  }
}
