import { appendFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const CSV_HEADER = 'original,filename,alt_text,keywords,date\n';

export async function appendToCsv(outputDir, data) {
  const csvPath = join(outputDir, 'alt-texts.csv');

  if (!existsSync(csvPath)) {
    writeFileSync(csvPath, CSV_HEADER, 'utf-8');
  }

  const escape = (str) => `"${str.replace(/"/g, '""')}"`;

  const row = [
    escape(data.original),
    escape(data.filename),
    escape(data.alt_text),
    escape(data.keywords),
    escape(new Date().toISOString()),
  ].join(',') + '\n';

  appendFileSync(csvPath, row, 'utf-8');
}
