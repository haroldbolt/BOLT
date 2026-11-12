import sharp from 'sharp';
import type { Product } from '../types';
import referenceData from '../data/productPhotoVisualReferences.json';
import { searchableProduct } from './productPhotoSearch';

const GRID_SIZE = 12;
const SAMPLE_SIZE = 192;
const MAX_ASPECT_DIFFERENCE = 0.25;
const MAX_COLOR_DIFFERENCE = 22;
const MIN_COLOR_MARGIN = 8;

interface Fingerprint {
  aspect: number;
  colors: Buffer;
}

// Public Shopify packshots of Agility Gold, keyed by catalog product ID.
// OCR handles photos beyond these white-background references.
const references = (referenceData as Array<[string, number, string]>).map(([productId, aspect, colors]) => ({
  productId, aspect, colors: Buffer.from(colors, 'base64'),
}));

export async function productPhotoFingerprint(image: Buffer): Promise<Fingerprint | undefined> {
  const { data, info } = await sharp(image, { limitInputPixels: 20_000_000 })
    .rotate().flatten({ background: 'white' }).toColourspace('srgb')
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'inside' }).removeAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width < 12 || height < 12 || channels !== 3) return undefined;

  const marginX = Math.max(1, Math.floor(width / 20));
  const marginY = Math.max(1, Math.floor(height / 20));
  function lightBackground(x: number, y: number) {
    const offset = (y * width + x) * channels;
    return Math.min(data[offset], data[offset + 1], data[offset + 2]) >= 231;
  }
  if (![
    [marginX, marginY], [width - 1 - marginX, marginY],
    [marginX, height - 1 - marginY], [width - 1 - marginX, height - 1 - marginY],
  ].every(([x, y]) => lightBackground(x, y))) return undefined;

  // Trim the white studio background. Requiring several foreground pixels per
  // row and column keeps isolated specks from shifting the package boundaries.
  const columns = new Uint16Array(width);
  const rows = new Uint16Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!lightBackground(x, y)) {
        columns[x]++;
        rows[y]++;
      }
    }
  }
  const left = columns.findIndex(count => count >= height * 0.06);
  const right = columns.reduce((last, count, index) => count >= height * 0.06 ? index : last, -1);
  const top = rows.findIndex(count => count >= width * 0.06);
  const bottom = rows.reduce((last, count, index) => count >= width * 0.06 ? index : last, -1);
  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  if (left < 0 || top < 0 || cropWidth < width / 6 || cropHeight < height / 6) return undefined;

  const colors = await sharp(data, { raw: { width, height, channels } })
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize(GRID_SIZE, GRID_SIZE, { fit: 'fill', kernel: 'lanczos2' }).raw().toBuffer();
  return { aspect: cropWidth / cropHeight, colors };
}

function colorDifference(first: Buffer, second: Buffer) {
  let total = 0;
  for (let index = 0; index < first.length; index++) {
    total += Math.abs(first[index] - second[index]);
  }
  return total / first.length;
}

export async function matchProductPhotoVisual(jpeg: Buffer, catalog: readonly Product[]) {
  const eligible = new Set(catalog.filter(searchableProduct).map(product => product.id));
  if (!references.some(reference => eligible.has(reference.productId))) return undefined;
  const photo = await productPhotoFingerprint(jpeg);
  if (!photo) return undefined;

  const scores = new Map<string, number>();
  // Keep unavailable items in the comparison so an image of one cannot be
  // promoted to the nearest available product.
  for (const reference of references) {
    if (Math.abs(Math.log(photo.aspect / reference.aspect)) > MAX_ASPECT_DIFFERENCE) continue;
    const score = colorDifference(photo.colors, reference.colors);
    scores.set(reference.productId, Math.min(score, scores.get(reference.productId) ?? Infinity));
  }
  const [best, second] = [...scores].sort((a, b) => a[1] - b[1]);
  const margin = second ? second[1] - best[1] : Infinity;
  if (!best || !eligible.has(best[0]) || best[1] > MAX_COLOR_DIFFERENCE || margin < MIN_COLOR_MARGIN) {
    return undefined;
  }
  return { matches: [{ productId: best[0] }], confident: best[1] <= 10 && margin >= 10 };
}
