import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const tesseract = '/usr/bin/tesseract';

export function productPhotoOcrAvailable() {
  return existsSync(tesseract);
}

export async function readProductPhotoText(jpeg: Buffer, signal: AbortSignal, highContrast = false): Promise<string> {
  const image = sharp(jpeg)
    .trim({ threshold: 20 })
    .resize({ width: 1250, height: 1250, fit: 'inside' })
    .grayscale();
  if (highContrast) image.threshold(165).negate();
  const input = await image.png().toBuffer();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const process = execFile(tesseract, ['stdin', 'stdout', '-l', 'spa+eng', '--psm', '11'], {
      signal,
      maxBuffer: 32 * 1024,
      env: { OMP_THREAD_LIMIT: '1' },
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
    process.stdin?.on('error', reject);
    process.stdin?.end(input);
  });
}
