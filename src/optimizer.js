import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { extname } from 'path';

// SVG et GIF ne sont pas touchés: vectoriel (rasterisation = perte) et
// animation (le redimensionnement/réencodage casserait les images animées).
const OPTIMIZABLE = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif']);

function resolveOptimization(config) {
  return {
    convert: config.convertToWebp !== false,
    resize: config.resizeImages !== false,
    quality: Math.min(100, Math.max(1, Math.round(Number(config.webpQuality) || 85))),
    maxSize: Math.round(Number(config.maxSize) || 2500),
  };
}

export function outputExtension(ext, config) {
  if (resolveOptimization(config).convert && OPTIMIZABLE.has(ext)) return 'webp';
  return ext;
}

export async function optimizeImage(filePath, config) {
  const ext = extname(filePath).slice(1).toLowerCase();
  if (!OPTIMIZABLE.has(ext)) return;
  const opts = resolveOptimization(config);
  if (!opts.convert && !opts.resize) return;

  let pipeline = sharp(filePath).rotate();
  if (opts.resize) {
    pipeline = pipeline.resize({
      width: opts.maxSize,
      height: opts.maxSize,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  const targetExt = outputExtension(ext, config);
  let encoded;
  if (targetExt === 'webp') encoded = pipeline.webp({ quality: opts.quality });
  else if (targetExt === 'avif') encoded = pipeline.avif({ quality: opts.quality });
  else if (targetExt === 'png') encoded = pipeline.png();
  else encoded = pipeline.jpeg({ quality: opts.quality });

  writeFileSync(filePath, await encoded.toBuffer());
}
