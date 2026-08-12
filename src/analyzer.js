import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import { readFileSync, existsSync } from 'fs';
import { basename, resolve, join } from 'path';
import { renameFile } from './renamer.js';
import { appendToCsv, readAllHistory } from './csv-writer.js';
import { uploadToWordPress } from './uploader/wordpress.js';
import { uploadToShopify } from './uploader/shopify.js';
import { state, addLog, doneFiles } from './state.js';

const MEDIA_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
};

const LANGUAGE_MAP = {
  fr: 'en français',
  en: 'in English',
  es: 'en español',
  de: 'auf Deutsch',
};

const client = new Anthropic();

export async function processImage(filePath, config, customPrompt = '', displayName = '', destination = null) {
  const resolvedPath = resolve(filePath);
  const imageData = readFileSync(resolvedPath);
  const base64Image = imageData.toString('base64');
  const ext = resolvedPath.split('.').pop().toLowerCase();
  const mediaType = MEDIA_TYPES[ext] || 'image/jpeg';
  const originalName = displayName || basename(resolvedPath);
  const lang = LANGUAGE_MAP[config.language] || 'en français';

  state.isProcessing = true;
  state.currentFile = originalName;
  doneFiles.add(resolvedPath);
  addLog('info', `Analyse IA: ${originalName}`);

  try {
    const analysis = await analyzeImage(base64Image, mediaType, lang, config, customPrompt);
    addLog('info', `→ "${analysis.filename}" | alt: "${analysis.alt_text}"`);

    const seoFilename = buildFilename(analysis.filename, ext);
    const outputPath = renameFile(resolvedPath, seoFilename, config.outputDir);
    addLog('success', `Renommé: ${originalName} → ${seoFilename}`);

    // L'analyse IA (déjà facturée) et le renommage sont acquis à ce stade.
    // Un échec de l'envoi vers la destination ne doit pas faire perdre ce
    // travail ni forcer une nouvelle analyse au prochain essai — on capture
    // l'erreur séparément et on la consigne dans le CSV pour pouvoir ne
    // retenter que l'upload plus tard.
    const { uploadStatus, uploadError } = await attemptUpload(outputPath, analysis.alt_text, destination);

    await appendToCsv(config.outputDir, {
      original: originalName,
      filename: seoFilename,
      alt_text: analysis.alt_text,
      keywords: analysis.keywords.join(', '),
      upload_status: uploadStatus,
    });

    addLog('success', `Terminé: ${seoFilename}`);
    return { uploadStatus, uploadError };
  } finally {
    state.isProcessing = false;
    state.currentFile = null;
  }
}

async function attemptUpload(outputPath, altText, destination) {
  if (destination?.platform === 'wordpress') {
    try {
      await uploadToWordPress(outputPath, altText, destination.wp);
      return { uploadStatus: 'ok', uploadError: '' };
    } catch (err) {
      state.errors++;
      addLog('error', `Upload WordPress échoué: ${err.message}`);
      return { uploadStatus: 'failed', uploadError: err.message };
    }
  }
  if (destination?.platform === 'shopify') {
    try {
      await uploadToShopify(outputPath, altText, destination.shopify);
      return { uploadStatus: 'ok', uploadError: '' };
    } catch (err) {
      state.errors++;
      addLog('error', `Upload Shopify échoué: ${err.message}`);
      return { uploadStatus: 'failed', uploadError: err.message };
    }
  }
  addLog('info', 'Upload ignoré (aucune destination sélectionnée)');
  return { uploadStatus: 'none', uploadError: '' };
}

// Retente uniquement l'envoi vers la destination pour une image déjà
// analysée avec succès (trouvée dans le CSV actif ou dans une archive
// backups/), sans consommer de crédits IA. Le résultat est journalisé comme
// une nouvelle ligne CSV (plutôt que de modifier les archives existantes),
// qui devient la plus récente pour ce fichier lors des prochaines reprises.
export async function retryUpload(displayName, config, destination) {
  const rows = readAllHistory(config.outputDir);
  const row = [...rows].reverse().find((r) => r.original === displayName);
  if (!row) return { found: false, uploadStatus: 'none', uploadError: 'Aucun historique pour ce fichier' };

  const outputPath = join(config.outputDir, row.filename);
  if (!existsSync(outputPath)) {
    // Le fichier renommé n'existe plus (ex: "Supprimer fichiers" a été utilisé) —
    // il faudra une analyse complète, pas seulement un nouvel essai d'envoi.
    return { found: false, uploadStatus: 'none', uploadError: `Fichier introuvable: ${outputPath}` };
  }

  addLog('info', `Nouvel essai d'envoi: ${displayName}`);
  const { uploadStatus, uploadError } = await attemptUpload(outputPath, row.alt_text, destination);

  await appendToCsv(config.outputDir, {
    original: row.original,
    filename: row.filename,
    alt_text: row.alt_text,
    keywords: row.keywords,
    upload_status: uploadStatus,
  });
  if (uploadStatus === 'ok') addLog('success', `Upload réussi: ${row.filename}`);

  return { found: true, uploadStatus, uploadError };
}

function analyzeImage(base64Image, mediaType, lang, config, customPrompt = '') {
  const model = config.model || 'claude-opus-4-8';
  if (model.startsWith('local:')) {
    return analyzeWithOllama(base64Image, mediaType, lang, model.slice('local:'.length), customPrompt);
  }
  if (model.startsWith('gemini-')) {
    return analyzeWithGemini(base64Image, mediaType, lang, model, customPrompt);
  }
  return analyzeWithClaude(base64Image, mediaType, lang, model, customPrompt);
}

async function analyzeWithClaude(base64Image, mediaType, lang, model, customPrompt = '') {
  const response = await client.messages.create({
    model,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: buildPrompt(lang, customPrompt),
          },
        ],
      },
    ],
  });

  return parseAnalysisResponse(response.content[0].text);
}

// Client construit à chaque appel (pas de singleton au chargement du module)
// pour que sauvegarder une nouvelle clé GEMINI_API_KEY depuis l'interface
// prenne effet immédiatement, sans redémarrer le serveur.
async function analyzeWithGemini(base64Image, mediaType, lang, model, customPrompt = '') {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY manquante — ajoute une clé Gemini gratuite dans les paramètres');
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildPrompt(lang, customPrompt) },
          { inlineData: { mimeType: mediaType, data: base64Image } },
        ],
      },
    ],
  });

  return parseAnalysisResponse(response.text);
}

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// Modèle vision local via Ollama — gratuit, illimité, aucune clé API,
// tourne entièrement sur la machine (aucune donnée envoyée à l'extérieur).
async function analyzeWithOllama(base64Image, mediaType, lang, model, customPrompt = '') {
  // Le décodeur d'image d'Ollama (llama.cpp) ne supporte pas WebP/AVIF —
  // on reconvertit systématiquement en PNG avant l'envoi, quel que soit
  // le format source, pour que ça marche avec toutes les photos.
  const pngBuffer = await sharp(Buffer.from(base64Image, 'base64')).png().toBuffer();
  const pngBase64 = pngBuffer.toString('base64');

  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: buildPrompt(lang, customPrompt),
        images: [pngBase64],
        stream: false,
      }),
    });
  } catch (err) {
    throw new Error(`Ollama injoignable (${OLLAMA_URL}) — vérifie qu'il tourne (ollama serve): ${err.message}`);
  }

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 404) {
      throw new Error(`Modèle Ollama "${model}" introuvable — télécharge-le avec: ollama pull ${model}`);
    }
    throw new Error(`Ollama (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  return parseAnalysisResponse(data.response);
}

function parseAnalysisResponse(rawText) {
  const text = (rawText || '').trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Réponse non-JSON: ${text}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);

  if (!parsed.filename || !parsed.alt_text || !parsed.keywords) {
    throw new Error(`Champs manquants: ${JSON.stringify(parsed)}`);
  }

  return parsed;
}

function buildPrompt(lang, customPrompt = '') {
  let prompt = `Analyse cette image pour le SEO d'un site web. Réponds UNIQUEMENT avec un JSON valide, sans aucun texte avant ou après.

Le JSON doit contenir exactement ces champs:
- "filename": un nom de fichier SEO-friendly ${lang} (max 60 caractères, mots séparés par des tirets, pertinent pour les moteurs de recherche, sans articles comme "le", "la", "un", "une", "des", "the", "a", "an"). Ne PAS inclure d'extension de fichier.
- "alt_text": un texte alternatif concis et descriptif ${lang} (max 125 caractères, destiné à décrire l'image pour l'accessibilité et le SEO)
- "keywords": un tableau de 3 à 5 mots-clés pertinents ${lang}

IMPORTANT: Retourne UNIQUEMENT le JSON brut, sans blocs de code markdown.`;

  if (customPrompt) {
    prompt += `\n\nContexte supplémentaire fourni par l'utilisateur — utilise ces informations pour guider le nom de fichier, le texte alternatif et les mots-clés:\n${customPrompt}`;
  }

  return prompt;
}

function buildFilename(aiFilename, ext) {
  let name = aiFilename
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[a-z]{2,4}$/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 70);
  return `${name}.${ext}`;
}
