// Run outside BOLT. The scheduler must serialize invocations sharing a state file.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkAvailability } from './check-availability.mjs';

async function readState(file, origin) {
  try {
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    if (state.version !== 1 || state.origin !== origin || !['up', 'down'].includes(state.last) ||
        !Array.isArray(state.pending) || state.pending.some(event =>
          !['down', 'recovered'].includes(event?.signal) || typeof event.id !== 'string' || typeof event.timestamp !== 'string')) {
      throw Error('Invalid monitor state');
    }
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, origin, last: null, pending: [] };
    throw error;
  }
}

async function save(file, state) {
  const temporary = file + '.' + randomUUID();
  try {
    await fs.writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function notifyAvailability(env) {
  const file = env.BOLT_MONITOR_STATE_FILE ?? '';
  let receiver;
  try {
    receiver = new URL(env.BOLT_MONITOR_WEBHOOK_URL);
    if (receiver.protocol !== 'https:' || receiver.username || receiver.password || receiver.hash ||
        !path.isAbsolute(file)) throw Error();
  } catch {
    return { code: 2, report: { ok: false, reason: 'INVALID_CONFIGURATION' } };
  }
  const result = await checkAvailability(env);
  if (result.code === 2) return result;
  const state = await readState(file, new URL(env.BOLT_MONITOR_ORIGIN).origin);
  const observed = result.report.ok ? 'up' : 'down';
  if (state.last !== observed) {
    if (observed === 'down' || state.last === 'down') {
      state.pending.push({ id: randomUUID(), signal: observed === 'down' ? 'down' : 'recovered', timestamp: result.report.checkedAt });
    }
    state.last = observed;
    await save(file, state);
  }

  // Persist before sending and retry the same event if the receiver's acknowledgement is lost.
  while (state.pending.length) {
    const event = state.pending[0];
    try {
      const response = await fetch(receiver, {
        method: 'POST', redirect: 'error', credentials: 'omit',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': event.id },
        body: JSON.stringify({ service: 'bolt-pets', ...event }),
        signal: AbortSignal.timeout(Number(env.BOLT_MONITOR_TIMEOUT_MS ?? '5000')),
      });
      await response.body?.cancel();
      if (!response.ok) throw Error();
    } catch {
      return { code: 3, report: { ...result.report, notification: 'PENDING' } };
    }
    state.pending.shift();
    await save(file, state);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { code, report } = await notifyAvailability(process.env);
    console.log(JSON.stringify(report));
    process.exitCode = code;
  } catch {
    console.log(JSON.stringify({ ok: false, reason: 'MONITOR_STATE_ERROR' }));
    process.exitCode = 2;
  }
}
