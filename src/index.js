import 'dotenv/config';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from './server.js';
import { addLog } from './state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '..', 'config.json');

let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch {
  addLog('error', 'config.json introuvable ou invalide');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

const app = createServer(config);
app.listen(PORT, () => {
  addLog('info', `Image SEO Processor — http://localhost:${PORT}`);
  addLog('info', `Langue: ${config.language} | Modèle: ${config.model || 'claude-opus-4-8'}`);
});
