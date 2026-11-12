import express, { type Express, type Request } from 'express';
import sharp from 'sharp';
import type { Product } from '../types';
import { openAIProductPhotoRecognizer, rankProductPhoto, type ProductPhotoRecognizer } from './productPhotoSearch';

const SEARCH_PATH = '/api/v1/catalog/photo-search';
const MAX_BYTES = 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const MINUTE = 60_000;
const DAY = 86_400_000;
const MAX_CONCURRENT = 4;
const DEADLINE_MS = 8_000;

function limit(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}

function sameSiteRequest(req: Request, customerOrigin?: string) {
  if (req.get('Sec-Fetch-Site') === 'cross-site') return false;
  const origin = req.get('Origin');
  if (!origin || origin === customerOrigin) return true;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.host === req.get('Host');
  } catch {
    return false;
  }
}

async function prepareSearchPhoto(image: Buffer) {
  const decoder = sharp(image, { limitInputPixels: MAX_PIXELS, failOn: 'warning' });
  const metadata = await decoder.metadata();
  if (metadata.format !== 'jpeg' || (metadata.pages || 1) !== 1) throw new Error('Invalid JPEG');
  return decoder.rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 }).toBuffer();
}

export function mountProductPhotoSearch(app: Express, options: {
  catalog: () => readonly Product[];
  env?: NodeJS.ProcessEnv;
  recognizer?: ProductPhotoRecognizer;
}) {
  const env = options.env || process.env;
  const key = env.BOLT_PHOTO_SEARCH_OPENAI_API_KEY?.trim();
  const recognizer = options.recognizer || (env.BOLT_PHOTO_SEARCH_ENABLED === 'true' && key
    ? openAIProductPhotoRecognizer(key, env.BOLT_PHOTO_SEARCH_MODEL?.trim() || undefined)
    : undefined);
  const requestsPerMinute = limit(env.BOLT_PHOTO_SEARCH_REQUESTS_PER_MINUTE, 5, 60);
  const dailyLimit = limit(env.BOLT_PHOTO_SEARCH_DAILY_LIMIT, 100, 10_000);
  let minuteWindow = 0;
  let dayWindow = 0;
  let providerCalls = 0;
  let concurrent = 0;
  const requestCounts = new Map<string, number>();
  const receiveImage = express.raw({ type: 'image/jpeg', limit: MAX_BYTES, inflate: false });

  app.get(`${SEARCH_PATH}/status`, (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ enabled: !!recognizer });
  });

  app.post(SEARCH_PATH, (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!recognizer) return res.status(503).json({ error: 'La búsqueda por foto no está habilitada.' });
    if (!sameSiteRequest(req, env.BOLT_CUSTOMER_ORIGIN)) {
      return res.status(403).json({ error: 'Origen de la solicitud no autorizado.' });
    }
    if (!req.is('image/jpeg')) return res.status(415).json({ error: 'Envía una foto JPEG.' });

    const minute = Math.floor(Date.now() / MINUTE);
    if (minute !== minuteWindow) {
      minuteWindow = minute;
      requestCounts.clear();
    }
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const count = requestCounts.get(ip) ?? 0;
    if (count >= requestsPerMinute || (!count && requestCounts.size >= 2048)) {
      res.set('Retry-After', '60');
      return res.status(429).json({ error: 'Demasiadas búsquedas. Intenta en un minuto.' });
    }
    requestCounts.set(ip, count + 1);

    if (concurrent >= MAX_CONCURRENT) {
      res.set('Retry-After', '5');
      return res.status(429).json({ error: 'Hay muchas fotos en proceso. Intenta en unos segundos.' });
    }
    concurrent++;
    // Bound simultaneous reads, decodes and provider calls. Release the slot when the
    // connection closes, including failures while reading the request body.
    const cancelled = new AbortController();
    res.once('close', () => cancelled.abort());

    receiveImage(req, res, async (error?: { status?: number }) => {
      try {
        if (cancelled.signal.aborted || res.destroyed) return;
        if (error?.status === 413) return res.status(413).json({ error: 'La foto supera 1 MB.' });
        if (error?.status === 415) return res.status(415).json({ error: 'Envía una foto JPEG sin codificación adicional.' });
        if (error || !Buffer.isBuffer(req.body) || !req.body.length) {
          return res.status(400).json({ error: 'No pudimos leer la foto. Elige otra e intenta nuevamente.' });
        }

        let jpeg: Buffer;
        try {
          jpeg = await prepareSearchPhoto(req.body);
        } catch {
          return res.status(400).json({ error: 'La foto no es un JPEG válido o es demasiado grande.' });
        }
        if (cancelled.signal.aborted) return;
        if (jpeg.length > MAX_BYTES) return res.status(413).json({ error: 'La foto supera 1 MB.' });

        const day = Math.floor(Date.now() / DAY);
        if (day !== dayWindow) {
          dayWindow = day;
          providerCalls = 0;
        }
        if (providerCalls >= dailyLimit) {
          return res.status(429).json({ error: 'Llegamos al límite diario de búsquedas por foto. Puedes buscar por texto.' });
        }
        providerCalls++;

        const signal = AbortSignal.any([cancelled.signal, AbortSignal.timeout(DEADLINE_MS)]);
        const evidence = await recognizer(jpeg, signal);
        if (!cancelled.signal.aborted) res.json(rankProductPhoto(evidence, options.catalog()));
      } catch {
        if (!cancelled.signal.aborted) {
          res.status(503).json({ error: 'La búsqueda por foto no está disponible ahora. Intenta otra vez o busca por texto.' });
        }
      } finally {
        concurrent--;
      }
    });
  });
}
