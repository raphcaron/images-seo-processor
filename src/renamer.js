import { renameSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';

export function renameFile(filePath, seoFilename, outputDir) {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  let finalName = seoFilename;
  let finalPath = join(outputDir, finalName);

  let counter = 1;
  while (existsSync(finalPath)) {
    const ext = extname(seoFilename);
    const base = seoFilename.replace(ext, '');
    finalName = `${base}-${counter}${ext}`;
    finalPath = join(outputDir, finalName);
    counter++;
  }

  renameSync(filePath, finalPath);
  return finalPath;
}
