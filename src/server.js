import express from 'express';
import multer from 'multer';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, extname, basename, resolve } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { processImage } from './analyzer.js';
import { startWatcher, stopWatcher } from './watcher.js';
import { state, addLog, processingFiles, doneFiles, queue } from './state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export function createServer(config) {
  const app = express();
  app.use(express.json());

  app.use('/output', express.static(join(ROOT, config.outputDir)));
  app.use(express.static(join(__dirname, 'public')));

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, join(ROOT, config.inputDir)),
      filename: (_req, file, cb) => {
        const ext = extname(file.originalname);
        const name = basename(file.originalname, ext);
        cb(null, `${name}${ext}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  startWatcher(config);

  app.get('/api/status', (_req, res) => {
    res.json({
      watcherActive: state.watcherActive,
      isProcessing: state.isProcessing,
      currentFile: state.currentFile,
      processed: state.processed,
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
    writeFileSync(join(ROOT, 'config.json'), JSON.stringify(config, null, 2));
    addLog('info', `Config: platform=${config.platform}, language=${config.language}`);
    res.json(config);
  });

  app.get('/api/history', (_req, res) => {
    const csvPath = join(ROOT, config.outputDir, 'alt-texts.csv');
    if (!existsSync(csvPath)) return res.json([]);

    const lines = readFileSync(csvPath, 'utf-8').trim().split('\n').slice(1);
    const history = lines
      .map((line) => {
        const match = line.match(/^"([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)"$/);
        if (!match) return null;
        return {
          original: match[1],
          filename: match[2],
          alt_text: match[3],
          keywords: match[4],
          date: match[5],
        };
      })
      .filter(Boolean);

    res.json(history.reverse());
  });

  app.post('/api/upload', upload.array('files', 20), async (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: 'Aucun fichier' });

    for (const file of req.files) {
      doneFiles.add(resolve(file.path));
      processingFiles.add(file.path);
    }

    const results = [];
    for (const file of req.files) {
      try {
        await queue.add(() => processImage(file.path, config));
        results.push({ original: file.originalname, status: 'ok' });
      } catch (err) {
        state.errors++;
        results.push({ original: file.originalname, status: 'error', error: err.message });
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
      startWatcher(config);
    }
    res.json({ active: state.watcherActive });
  });

  app.get('/api/env', (_req, res) => {
    const mask = (v) => (v && v.length > 10 ? v.slice(0, 6) + '***' + v.slice(-4) : v ? '***' : '');
    res.json({
      anthropic: { set: !!process.env.ANTHROPIC_API_KEY, masked: mask(process.env.ANTHROPIC_API_KEY) },
      wp: {
        url: process.env.WP_SITE_URL || '',
        urlSet: !!process.env.WP_SITE_URL,
        userSet: !!process.env.WP_APP_USERNAME,
        userMasked: mask(process.env.WP_APP_USERNAME),
        passSet: !!process.env.WP_APP_PASSWORD,
      },
      shopify: {
        store: process.env.SHOPIFY_STORE || '',
        storeSet: !!process.env.SHOPIFY_STORE,
        tokenSet: !!process.env.SHOPIFY_ACCESS_TOKEN,
        tokenMasked: mask(process.env.SHOPIFY_ACCESS_TOKEN),
      },
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

  return app;
}
