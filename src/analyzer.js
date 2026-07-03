import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { basename, resolve } from 'path';
import { renameFile } from './renamer.js';
import { appendToCsv } from './csv-writer.js';
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

export async function processImage(filePath, config, customPrompt = '') {
  const resolvedPath = resolve(filePath);
  const imageData = readFileSync(resolvedPath);
  const base64Image = imageData.toString('base64');
  const ext = resolvedPath.split('.').pop().toLowerCase();
  const mediaType = MEDIA_TYPES[ext] || 'image/jpeg';
  const originalName = basename(resolvedPath);
  const lang = LANGUAGE_MAP[config.language] || 'en français';

  state.isProcessing = true;
  state.currentFile = originalName;
  doneFiles.add(resolvedPath);
  addLog('info', `Analyse IA: ${originalName}`);

  try {
    const analysis = await analyzeWithClaude(base64Image, mediaType, lang, config, customPrompt);
    addLog('info', `→ "${analysis.filename}" | alt: "${analysis.alt_text}"`);

    const seoFilename = buildFilename(analysis.filename, ext);
    const outputPath = renameFile(resolvedPath, seoFilename, config.outputDir);
    addLog('success', `Renommé: ${originalName} → ${seoFilename}`);

    await appendToCsv(config.outputDir, {
      original: originalName,
      filename: seoFilename,
      alt_text: analysis.alt_text,
      keywords: analysis.keywords.join(', '),
    });

    if (config.platform === 'wordpress') {
      await uploadToWordPress(outputPath, analysis.alt_text);
    } else if (config.platform === 'shopify') {
      await uploadToShopify(outputPath, analysis.alt_text, config);
    } else {
      addLog('info', `Upload ignoré (platform: ${config.platform})`);
    }

    addLog('success', `Terminé: ${seoFilename}`);
  } finally {
    state.isProcessing = false;
    state.currentFile = null;
  }
}

async function analyzeWithClaude(base64Image, mediaType, lang, config, customPrompt = '') {
  const response = await client.messages.create({
    model: config.model || 'claude-opus-4-8',
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

  const rawText = response.content[0].text.trim();
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Réponse non-JSON: ${rawText}`);
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
