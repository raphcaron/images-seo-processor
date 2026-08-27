import { watch as chokidarWatch } from 'chokidar';
import { extname, resolve, join } from 'path';
import { processImage } from './analyzer.js';
import { getProfile } from './profiles.js';
import { state, addLog, processingFiles, doneFiles, queue } from './state.js';

const SUPPORTED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif',
]);

let watcherInstance = null;

export function startWatcher(config, rootDir) {
  if (watcherInstance) return;

  const inputDir = config.inputDir || './input';

  watcherInstance = chokidarWatch(inputDir, {
    ignoreInitial: true,
    ignorePermissionErrors: true,
    // input/failed/ est une zone d'attente gérée par failures.js pour les
    // images dont l'analyse a échoué — un nouvel essai s'y fait uniquement
    // depuis l'interface (POST /api/failures/:id/retry), jamais par simple
    // détection de fichier, sinon le watcher retraite le fichier en double
    // dès qu'il y est déplacé, avec son nom UUID interne au lieu du nom
    // d'origine.
    ignored: (path) => resolve(path).startsWith(resolve(join(inputDir, 'failed'))),
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 500,
    },
  });

  watcherInstance.on('add', (filePath) => {
    const resolved = resolve(filePath);
    const ext = extname(resolved).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return;
    if (processingFiles.has(resolved) || doneFiles.has(resolved)) return;

    addLog('info', `Image détectée: ${filePath}`);

    const destination = config.defaultProfileId ? getProfile(rootDir, config.defaultProfileId) : null;
    queue.add(() => processImage(resolved, config, '', '', destination)).catch((err) => {
      addLog('error', `Erreur ${filePath}: ${err.message}`);
      state.errors++;
    });
  });

  watcherInstance.on('error', (err) => {
    addLog('error', `Watcher: ${err.message}`);
  });

  watcherInstance.on('ready', () => {
    state.watcherActive = true;
    addLog('info', `Surveillance active: ${inputDir}/`);
  });
}

export async function stopWatcher() {
  if (watcherInstance) {
    await watcherInstance.close();
    watcherInstance = null;
    state.watcherActive = false;
    addLog('info', 'Surveillance arrêtée');
  }
}
