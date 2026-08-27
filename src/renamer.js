import { renameSync, existsSync, mkdirSync } from 'fs';
import { join, extname, basename } from 'path';

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// originalName sert de repère en cas de collision: deux images différentes
// (souvent des logos/icônes visuellement proches) reçoivent parfois le même
// nom généré par l'IA — un simple "-1"/"-2" ne dit rien de laquelle est
// laquelle, alors qu'un fragment du nom d'origine garde une trace lisible
// jusqu'à la bonne image source.
export function renameFile(filePath, seoFilename, outputDir, originalName = '') {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const ext = extname(seoFilename);
  const base = seoFilename.slice(0, seoFilename.length - ext.length);

  const candidates = [seoFilename];
  const originalSlug = slugify(basename(originalName, extname(originalName))).slice(0, 40);
  if (originalSlug && originalSlug !== base) {
    candidates.push(`${base}-${originalSlug}${ext}`);
  }

  let finalName = candidates.find((name) => !existsSync(join(outputDir, name)));
  let counter = 1;
  while (!finalName) {
    const candidate = `${base}-${originalSlug ? originalSlug + '-' : ''}${counter}${ext}`;
    if (!existsSync(join(outputDir, candidate))) finalName = candidate;
    counter++;
  }

  const finalPath = join(outputDir, finalName);
  renameSync(filePath, finalPath);
  return finalPath;
}
