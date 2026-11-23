import fs from 'node:fs';
import path from 'node:path';
import { atomicJson } from './fulfillmentStorage';

type Counts = { day: string; used: Record<string, number> };
const businessDay = new Intl.DateTimeFormat('sv-SE', {timeZone: 'America/Bogota', year:'numeric', month:'2-digit', day:'2-digit'});

// Bogotá observes UTC-05:00 year-round.
export function secondsUntilBogotaMidnight(now: number) {
  const businessTime = now - 5 * 60 * 60 * 1000;
  return Math.ceil((86400000 - businessTime % 86400000) / 1000);
}

/** The pilot launcher holds the volume's single-writer lock. Reserve a call before the network operation. */
export function createDailyProviderBudget(env: NodeJS.ProcessEnv, now = Date.now) {
  const persistent = env.NODE_ENV === 'production' && !!env.BOLT_PILOT_VOLUME;
  if (persistent && (!env.BOLT_DATA_DIR || !path.isAbsolute(env.BOLT_DATA_DIR))) {
    throw Error('El cupo de proveedores requiere el directorio operativo.');
  }
  const file = persistent ? path.join(env.BOLT_DATA_DIR!, '.bolt-private', 'provider-budget.json') : null;
  let memory: Counts | undefined;
  return {
    take(provider: string, limit: number) {
      if (!/^[a-z][a-z0-9_-]{0,40}$/i.test(provider) || Object.hasOwn(Object.prototype, provider) || !Number.isSafeInteger(limit) || limit <= 0) return false;
      const day = businessDay.format(now());
      let record = memory;
      if (file) {
        try {
          record = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (!record || !/^\d{4}-\d{2}-\d{2}$/.test(record.day) || !record.used || typeof record.used !== 'object' ||
              Array.isArray(record.used) || Object.values(record.used).some(n => !Number.isSafeInteger(n) || n < 0)) {
            throw Error('Registro de consumo inválido');
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('No se pudo verificar el cupo de proveedores.');
          record = undefined;
        }
      }
      if (!record || record.day < day) record = {day, used:{}};
      const used = record.used[provider] || 0;
      if (used >= limit) return false;
      record.used[provider] = used + 1;
      if (file) atomicJson(file, record);
      else memory = record;
      return true;
    },
  };
}
