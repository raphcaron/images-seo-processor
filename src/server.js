import express from 'express';
import multer from 'multer';
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, renameSync, mkdirSync } from 'fs';
import { join, extname, basename, resolve } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { processImage, retryUpload, testModel } from './analyzer.js';
import { startWatcher, stopWatcher } from './watcher.js';
import { readCsvRows, readAllHistory } from './csv-writer.js';
import { state, addLog, processingFiles, doneFiles, queue } from './state.js';
import {
  loadProfiles, getProfile, createProfile, updateProfile, deleteProfile,
  maskProfile, migrateLegacyEnvProfile,
} from './profiles.js';
import {
  loadFailures, getFailure, recordFailure, removeFailure, updateFailureError, maskFailure,
} from './failures.js';
import { testWordPress } from './uploader/wordpress.js';
import { testShopify } from './uploader/shopify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export function createServer(config) {
  const app = express();
  app.use(express.json());

  const migrated = migrateLegacyEnvProfile(ROOT, config);
  if (migrated) {
    if (!config.defaultProfileId) {
      config.defaultProfileId = migrated.id;
      writeFileSync(join(ROOT, 'config.json'), JSON.stringify(config, null, 2));
    }
    addLog('info', `Profil migré depuis .env: "${migrated.name}"`);
  }

  app.use('/output', express.static(join(ROOT, config.outputDir)));
  app.use(express.static(join(__dirname, 'public')));

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, join(ROOT, config.inputDir)),
      filename: (_req, file, cb) => {
        // Prefixe unique pour éviter les collisions quand un dossier entier
        // (avec sous-dossiers) est uploadé et que plusieurs fichiers portent
        // le même nom (ex: IMG_1234.jpg dans deux catégories différentes).
        const ext = extname(file.originalname);
        const name = basename(file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, '_');
        const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        cb(null, `${unique}-${name}${ext}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  startWatcher(config, ROOT);

  function countHistory() {
    const csvPath = join(ROOT, config.outputDir, 'alt-texts.csv');
    if (!existsSync(csvPath)) return 0;
    return readFileSync(csvPath, 'utf-8').trim().split('\n').length - 1;
  }

  app.get('/api/status', (_req, res) => {
    res.json({
      watcherActive: state.watcherActive,
      isProcessing: state.isProcessing,
      currentFile: state.currentFile,
      processed: countHistory(),
      errors: state.errors,
      queueSize: queue.size,
      logs: state.logs.slice(-80),
    });
  });

  app.get('/api/config', (_req, res) => {
    res.json(config);
  });

  app.put('/api/config', (req, res) => {
    if (req.body.platform !== undefined) config.platform = req.body.platform;
    if (req.body.language !== undefined) config.language = req.body.language;
    if (req.body.model !== undefined) config.model = req.body.model;
    if (req.body.defaultProfileId !== undefined) config.defaultProfileId = req.body.defaultProfileId;
    writeFileSync(join(ROOT, 'config.json'), JSON.stringify(config, null, 2));
    addLog('info', `Config: platform=${config.platform}, language=${config.language}`);
    res.json(config);
  });

  // Destinations (profils WordPress/Shopify sauvegardés)
  app.get('/api/profiles', (_req, res) => {
    res.json(loadProfiles(ROOT).map(maskProfile));
  });

  app.post('/api/profiles', (req, res) => {
    const { name, platform, wp, shopify } = req.body;
    if (!name || !['wordpress', 'shopify'].includes(platform)) {
      return res.status(400).json({ error: 'name et platform (wordpress|shopify) requis' });
    }
    const profile = createProfile(ROOT, { name, platform, wp, shopify });
    addLog('success', `Destination créée: "${profile.name}"`);
    res.json(maskProfile(profile));
  });

  app.put('/api/profiles/:id', (req, res) => {
    const profile = updateProfile(ROOT, req.params.id, req.body);
    if (!profile) return res.status(404).json({ error: 'Profil introuvable' });
    addLog('info', `Destination mise à jour: "${profile.name}"`);
    res.json(maskProfile(profile));
  });

  app.delete('/api/profiles/:id', (req, res) => {
    const profile = getProfile(ROOT, req.params.id);
    const ok = deleteProfile(ROOT, req.params.id);
    if (ok && profile) addLog('info', `Destination supprimée: "${profile.name}"`);
    if (config.defaultProfileId === req.params.id) {
      config.defaultProfileId = null;
      writeFileSync(join(ROOT, 'config.json'), JSON.stringify(config, null, 2));
    }
    res.json({ ok });
  });

  // Vérifie un modèle IA (clé + accès) ou une destination (identifiants +
  // permission d'upload) sans consommer de tokens ni rien envoyer. Pour une
  // destination, accepte soit un profil déjà enregistré (profileId) soit des
  // identifiants bruts (platform/wp/shopify) pour tester avant sauvegarde.
  app.post('/api/test/model', async (req, res) => {
    try {
      const result = await testModel({ ...config, model: req.body.model || config.model });
      addLog('success', `Test modèle IA: ${result.message}`);
      res.json(result);
    } catch (err) {
      addLog('error', `Test modèle IA échoué: ${err.message}`);
      res.json({ ok: false, error: err.message });
    }
  });

  app.post('/api/test/profile', async (req, res) => {
    const destination = req.body.profileId ? getProfile(ROOT, req.body.profileId) : req.body;
    if (!destination || !['wordpress', 'shopify'].includes(destination.platform)) {
      return res.status(400).json({ ok: false, error: 'Plateforme requise (wordpress|shopify)' });
    }
    try {
      const result = destination.platform === 'wordpress'
        ? await testWordPress(destination.wp)
        : await testShopify(destination.shopify);
      addLog('success', `Test destination: ${result.message}`);
      res.json(result);
    } catch (err) {
      addLog('error', `Test destination échoué: ${err.message}`);
      res.json({ ok: false, error: err.message });
    }
  });

  app.get('/api/history', (_req, res) => {
    res.json(readCsvRows(config.outputDir).reverse());
  });

  // Images dont l'analyse IA a échoué (ex: crédits épuisés) — gardées de
  // côté pour être retentées depuis l'interface sans reglisser le dossier.
  app.get('/api/failures', (_req, res) => {
    res.json(loadFailures(config.outputDir).map(maskFailure).reverse());
  });

  app.post('/api/failures/:id/retry', async (req, res) => {
    const failure = getFailure(config, req.params.id);
    if (!failure) return res.status(404).json({ error: 'Introuvable' });

    const destination = req.body.profileId ? getProfile(ROOT, req.body.profileId) : null;
    try {
      const r = await queue.add(() => processImage(failure.savedPath, config, '', failure.displayName, destination));
      removeFailure(config, failure.id);
      if (r?.uploadStatus === 'failed') {
        state.errors++;
        return res.json({ ok: true, status: 'error', error: r.uploadError });
      }
      res.json({ ok: true, status: 'ok' });
    } catch (err) {
      updateFailureError(config, failure.id, err);
      addLog('error', `Nouvel essai échoué (${failure.displayName}): ${err.message}`);
      res.json({ ok: false, status: 'error', error: err.message });
    }
  });

  app.post('/api/failures/retry-all', async (req, res) => {
    const destination = req.body.profileId ? getProfile(ROOT, req.body.profileId) : null;
    const failures = loadFailures(config.outputDir);
    const results = [];
    for (const failure of failures) {
      try {
        const r = await queue.add(() => processImage(failure.savedPath, config, '', failure.displayName, destination));
        removeFailure(config, failure.id);
        results.push({ displayName: failure.displayName, status: r?.uploadStatus === 'failed' ? 'error' : 'ok' });
      } catch (err) {
        updateFailureError(config, failure.id, err);
        addLog('error', `Nouvel essai échoué (${failure.displayName}): ${err.message}`);
        results.push({ displayName: failure.displayName, status: 'error', error: err.message });
      }
    }
    res.json({ ok: true, results });
  });

  app.delete('/api/failures/:id', (req, res) => {
    const failure = removeFailure(config, req.params.id);
    if (failure) addLog('info', `Échec ignoré: ${failure.displayName}`);
    res.json({ ok: !!failure });
  });

  app.delete('/api/failures', (_req, res) => {
    const failures = loadFailures(config.outputDir);
    for (const f of failures) removeFailure(config, f.id);
    if (failures.length) addLog('info', `${failures.length} échec(s) ignoré(s)`);
    res.json({ ok: true, count: failures.length });
  });

  app.post('/api/upload', upload.array('files', 20), async (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: 'Aucun fichier' });

    const customPrompt = req.body.customPrompt || '';
    // Chemin relatif (ex: "Drainage/Nettoyage de drain/IMG_0723.webp") envoyé
    // par le client lors d'un upload de dossier, pour garder trace de
    // l'origine dans les logs/CSV même si le fichier est aplati sur disque.
    const relativePath = req.body.relativePath || '';
    const destination = req.body.profileId ? getProfile(ROOT, req.body.profileId) : null;

    // Reprise: si un dossier a déjà été (partiellement) traité — ex: crédits
    // Anthropic épuisés en cours de route, destination indisponible, ou même
    // un "Effacer l'historique" survenu entre-temps — on ne refait pas ce
    // qui est déjà acquis. On cherche dans le CSV actif ET les archives
    // backups/, car un clear d'historique déplace les lignes déjà traitées
    // dans une archive sans effacer le travail qu'elles représentent.
    const history = readAllHistory(config.outputDir);
    const lastByOriginal = new Map();
    for (const row of history) lastByOriginal.set(row.original, row); // le dernier gagne (ordre chronologique)

    const results = [];
    for (const file of req.files) {
      const displayName = relativePath || file.originalname;
      doneFiles.add(resolve(file.path));
      const existing = lastByOriginal.get(displayName);

      if (existing && (existing.upload_status !== 'failed' || !destination)) {
        // Déjà analysé, et soit le statut d'envoi n'est PAS explicitement
        // "failed" ('ok' = déjà envoyé, 'none' = aucun envoi demandé alors,
        // 'unknown' = ligne d'avant le suivi des envois), soit aucun envoi
        // n'est demandé cette fois — dans tous ces cas on NE retente PAS
        // l'envoi automatiquement, pour ne pas créer de doublons sur
        // WordPress/Shopify quand l'envoi avait en réalité déjà réussi
        // (cas le plus fréquent pour les lignes 'unknown'). Seul un statut
        // 'failed' explicite (confirmé après mon correctif) avec une
        // destination sélectionnée déclenche un nouvel essai ci-dessous.
        unlinkSync(file.path);
        addLog('info', `Ignoré (déjà traité): ${displayName}`);
        results.push({ original: file.originalname, status: 'skipped' });
        continue;
      }

      if (existing && destination) {
        // existing.upload_status === 'failed' ici: échec confirmé, sûr à retenter.
        try {
          const r = await queue.add(() => retryUpload(displayName, config, destination));
          if (r.found) {
            unlinkSync(file.path);
            if (r.uploadStatus === 'failed') {
              state.errors++;
              results.push({ original: file.originalname, status: 'error', error: r.uploadError });
            } else {
              results.push({ original: file.originalname, status: 'ok' });
            }
            continue;
          }
          // Fichier de sortie introuvable (ex: "Supprimer fichiers" a été
          // utilisé) — on retombe sur une analyse complète ci-dessous.
        } catch (err) {
          state.errors++;
          addLog('error', `Erreur ${displayName}: ${err.message}`);
          results.push({ original: file.originalname, status: 'error', error: err.message });
          continue;
        }
      }

      processingFiles.add(file.path);
      try {
        const r = await queue.add(() => processImage(file.path, config, customPrompt, displayName, destination));
        if (r?.uploadStatus === 'failed') {
          results.push({ original: file.originalname, status: 'error', error: r.uploadError });
        } else {
          results.push({ original: file.originalname, status: 'ok' });
        }
      } catch (err) {
        state.errors++;
        addLog('error', `Erreur ${displayName}: ${err.message}`);
        results.push({ original: file.originalname, status: 'error', error: err.message });
        // L'échec (ex: crédits épuisés) survient avant le renommage vers
        // output/ — on garde le fichier dans une file d'attente persistante
        // pour pouvoir le retenter depuis l'interface, plutôt que de le
        // supprimer (ce qui obligerait à retrouver et reglisser le dossier
        // source pour retraiter cette image).
        if (existsSync(file.path)) recordFailure(config, file.path, displayName, err);
      } finally {
        processingFiles.delete(file.path);
      }
    }
    res.json({ results });
  });

  app.post('/api/watcher/toggle', async (_req, res) => {
    if (state.watcherActive) {
      await stopWatcher();
    } else {
      startWatcher(config, ROOT);
    }
    res.json({ active: state.watcherActive });
  });

  app.get('/api/env', (_req, res) => {
    const mask = (v) => (v && v.length > 10 ? v.slice(0, 6) + '***' + v.slice(-4) : v ? '***' : '');
    res.json({
      anthropic: { set: !!process.env.ANTHROPIC_API_KEY, masked: mask(process.env.ANTHROPIC_API_KEY) },
      gemini: { set: !!process.env.GEMINI_API_KEY, masked: mask(process.env.GEMINI_API_KEY) },
    });
  });

  app.put('/api/env', (req, res) => {
    const envPath = join(ROOT, '.env');
    let envContent = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';

    for (const [key, value] of Object.entries(req.body)) {
      if (!value) continue;
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
      process.env[key] = value;
    }

    writeFileSync(envPath, envContent.trim() + '\n');
    addLog('info', 'Variables .env mises à jour');
    res.json({ ok: true });
  });

  app.delete('/api/output', (_req, res) => {
    const outputDir = join(ROOT, config.outputDir);
    const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'];

    if (!existsSync(outputDir)) {
      addLog('error', `Dossier output introuvable: ${outputDir}`);
      return res.json({ ok: false, deleted: [], error: 'Dossier output introuvable' });
    }

    const allFiles = readdirSync(outputDir);
    const files = allFiles.filter((f) => {
      if (f === 'backups' || f === '.gitkeep' || f === 'alt-texts.csv') return false;
      return imageExts.includes(extname(f).toLowerCase());
    });

    addLog('info', `Suppression: ${files.length} image(s) trouvée(s) sur ${allFiles.length} fichier(s)`);

    const deleted = [];
    for (const file of files) {
      try {
        unlinkSync(join(outputDir, file));
        deleted.push(file);
        addLog('info', `Supprimé: ${file}`);
      } catch (err) {
        addLog('error', `Échec suppression ${file}: ${err.message}`);
      }
    }

    addLog('success', `Output nettoyé: ${deleted.length} image(s) supprimée(s)`);
    res.json({ ok: true, deleted });
  });

  app.delete('/api/history', (_req, res) => {
    const outputDir = join(ROOT, config.outputDir);
    const csvPath = join(outputDir, 'alt-texts.csv');

    if (existsSync(csvPath)) {
      const backupDir = join(outputDir, 'backups');
      if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = join(backupDir, `alt-texts-${ts}.csv`);
      renameSync(csvPath, backupPath);
      addLog('success', `CSV sauvegardé: ${backupPath}`);
    } else {
      addLog('info', 'Aucun CSV à sauvegarder');
    }

    state.errors = 0;

    res.json({ ok: true });
  });

  return app;
}
