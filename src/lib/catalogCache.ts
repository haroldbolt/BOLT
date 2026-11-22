import { statSync } from 'node:fs';

export function catalogCacheTtlMs(raw = process.env.BOLT_CATALOG_CACHE_TTL_SECONDS): number {
  if (raw === undefined || raw === '') return 60_000;
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > 3600) {
    throw new Error('BOLT_CATALOG_CACHE_TTL_SECONDS debe estar entre 1 y 3600 segundos.');
  }
  return Number(raw) * 1000;
}

// Atomic replacements get a new inode even when the file size is unchanged.
export function catalogFileVersion(file: string): string {
  const stat = statSync(file, { bigint: true, throwIfNoEntry: false });
  return stat ? [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':') : 'missing';
}
