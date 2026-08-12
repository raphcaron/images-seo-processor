import { appendFileSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const CSV_HEADER = 'original,filename,alt_text,keywords,upload_status,date';

const escape = (str) => `"${String(str).replace(/"/g, '""')}"`;
const unescape = (str) => str.replace(/""/g, '"');

// upload_status a été ajouté après coup: les anciennes lignes n'ont que 5
// champs. On tente d'abord le format à 6 champs, puis on retombe sur
// l'ancien format à 5 champs avec un statut "unknown" (upload non confirmé,
// à retenter plutôt qu'à considérer comme réussi).
const ROW_RE_6 = /^"((?:[^"]|"")*)","((?:[^"]|"")*)","((?:[^"]|"")*)","((?:[^"]|"")*)","((?:[^"]|"")*)","((?:[^"]|"")*)"$/;
const ROW_RE_5 = /^"((?:[^"]|"")*)","((?:[^"]|"")*)","((?:[^"]|"")*)","((?:[^"]|"")*)","((?:[^"]|"")*)"$/;

function csvPathFor(outputDir) {
  return join(outputDir, 'alt-texts.csv');
}

function backupsDirFor(outputDir) {
  return join(outputDir, 'backups');
}

function parseCsvFile(csvPath) {
  if (!existsSync(csvPath)) return [];
  const lines = readFileSync(csvPath, 'utf-8').trim().split('\n').slice(1);
  return lines
    .map((line) => {
      let m = line.match(ROW_RE_6);
      if (m) {
        return {
          original: unescape(m[1]), filename: unescape(m[2]), alt_text: unescape(m[3]),
          keywords: unescape(m[4]), upload_status: unescape(m[5]), date: unescape(m[6]),
        };
      }
      m = line.match(ROW_RE_5);
      if (m) {
        return {
          original: unescape(m[1]), filename: unescape(m[2]), alt_text: unescape(m[3]),
          keywords: unescape(m[4]), upload_status: 'unknown', date: unescape(m[5]),
        };
      }
      return null;
    })
    .filter(Boolean);
}

export async function appendToCsv(outputDir, data) {
  const csvPath = csvPathFor(outputDir);

  if (!existsSync(csvPath)) {
    writeFileSync(csvPath, CSV_HEADER + '\n', 'utf-8');
  }

  const row = [
    escape(data.original),
    escape(data.filename),
    escape(data.alt_text),
    escape(data.keywords),
    escape(data.upload_status || 'none'),
    escape(new Date().toISOString()),
  ].join(',') + '\n';

  appendFileSync(csvPath, row, 'utf-8');
}

// Historique du CSV actif uniquement (utilisé pour l'onglet "Historique" de
// l'interface, qui n'a pas besoin de remonter les archives).
export function readCsvRows(outputDir) {
  return parseCsvFile(csvPathFor(outputDir));
}

// Historique complet: CSV actif + toutes les archives dans backups/ (créées
// à chaque "Effacer l'historique" ou redémarrage). Nécessaire pour la
// reprise après interruption — sinon une image déjà analysée avant un clear
// d'historique semblerait "jamais traitée" et serait réanalysée pour rien.
// Les lignes sont retournées en ordre chronologique (archives les plus
// anciennes d'abord, CSV actif en dernier) pour que "le dernier gagne"
// donne bien le statut le plus récent par fichier d'origine.
export function readAllHistory(outputDir) {
  const backupsDir = backupsDirFor(outputDir);
  const backupFiles = existsSync(backupsDir)
    ? readdirSync(backupsDir).filter((f) => f.endsWith('.csv')).sort()
    : [];

  const rows = [];
  for (const f of backupFiles) rows.push(...parseCsvFile(join(backupsDir, f)));
  rows.push(...parseCsvFile(csvPathFor(outputDir)));
  return rows;
}
