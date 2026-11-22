import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import type { ServerResponse } from 'node:http';

export const revalidate = 'public, no-cache, must-revalidate';
export const privateResponse = 'private, no-store';
const immutable = 'public, max-age=31536000, immutable';

/** Only enable shared revalidation for a successful response containing the public view. */
export function publicCatalogHeaders(req: Request, res: Response) {
  res.vary('Origin');
  res.vary('Cookie');
  res.vary('Authorization');
  res.vary('X-Order-Token');
  res.set('Cache-Control', req.get('Cookie') || req.get('Authorization') || req.get('X-Order-Token') ||
    res.getHeader('Set-Cookie') ? privateResponse : revalidate);
}

/** A matching-looking URL alone does not establish the content hash. Use Vite's build manifest. */
export function staticCacheHeaders(dist: string) {
  const assets = new Set<string>();
  const manifest = path.join(dist, '.vite', 'manifest.json');
  if (fs.existsSync(manifest)) {
    const entries = JSON.parse(fs.readFileSync(manifest, 'utf8')) as Record<string, { file?: string; css?: string[]; assets?: string[] }>;
    for (const entry of Object.values(entries)) {
      for (const name of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
        if (name && /^assets\/[\w.-]+-[\w-]{8,}\.(?:js|css)$/.test(name)) assets.add(path.resolve(dist, name));
      }
    }
  }
  return (res: ServerResponse, file: string) => {
    if (res.hasHeader('Cache-Control')) return;
    res.setHeader('Cache-Control', assets.has(path.resolve(file)) ? immutable : revalidate);
  };
}
