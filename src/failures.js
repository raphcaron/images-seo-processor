import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, renameSync } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';

function manifestPath(outputDir) {
  return join(outputDir, 'failures.json');
}

function failedDir(inputDir) {
  return join(inputDir, 'failed');
}

export function loadFailures(outputDir) {
  const path = manifestPath(outputDir);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}

function saveFailures(outputDir, failures) {
  writeFileSync(manifestPath(outputDir), JSON.stringify(failures, null, 2));
}

// Déplace un fichier dont l'analyse IA a échoué (ex: crédits épuisés) vers
// une zone d'attente persistante, pour qu'il puisse être retenté plus tard
// depuis l'interface sans avoir à reglisser le dossier source.
export function recordFailure(config, filePath, displayName, error) {
  const dir = failedDir(config.inputDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const ext = extname(filePath);
  const id = randomUUID();
  const savedPath = join(dir, `${id}${ext}`);
  renameSync(filePath, savedPath);

  const failures = loadFailures(config.outputDir);
  failures.push({
    id,
    displayName,
    savedPath,
    error: error?.message || String(error),
    date: new Date().toISOString(),
  });
  saveFailures(config.outputDir, failures);
  return id;
}

export function getFailure(config, id) {
  return loadFailures(config.outputDir).find((f) => f.id === id) || null;
}

export function removeFailure(config, id) {
  const failures = loadFailures(config.outputDir);
  const failure = failures.find((f) => f.id === id);
  const next = failures.filter((f) => f.id !== id);
  saveFailures(config.outputDir, next);
  if (failure && existsSync(failure.savedPath)) {
    try {
      unlinkSync(failure.savedPath);
    } catch {
      // fichier déjà déplacé/consommé par un retry réussi — rien à faire
    }
  }
  return failure;
}

// Un nouvel essai qui échoue à nouveau garde le fichier en place (jamais
// consommé par renameFile) — seule l'entrée du manifeste est mise à jour.
export function updateFailureError(config, id, error) {
  const failures = loadFailures(config.outputDir);
  const failure = failures.find((f) => f.id === id);
  if (!failure) return null;
  failure.error = error?.message || String(error);
  failure.date = new Date().toISOString();
  saveFailures(config.outputDir, failures);
  return failure;
}

export function maskFailure(f) {
  return { id: f.id, displayName: f.displayName, error: f.error, date: f.date };
}
