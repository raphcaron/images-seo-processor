# Images SEO Processor

Outil web de traitement SEO d'images alimenté par IA. Analyse, renomme et optimise automatiquement vos images pour le référencement, avec upload optionnel vers WordPress ou Shopify.

## Fonctionnalités

- Analyse IA multi-fournisseur au choix : Claude (Anthropic, payant), Gemini (Google, gratuit avec limites de débit), ou un modèle vision local via Ollama (gratuit, illimité, aucune donnée envoyée à l'extérieur) — pour générer des noms de fichiers SEO, des textes alternatifs et des mots-clés
- Upload par drag-and-drop (fichiers ou dossier entier avec sous-dossiers) ou surveillance automatique d'un dossier
- Prompt personnalisable pour guider l'analyse de chaque lot d'images
- Destinations multiples sauvegardées (plusieurs sites WordPress et/ou stores Shopify), sélectionnables au moment de l'upload
- Historique des traitements avec export CSV
- Interface web avec thème sombre/clair
- Gestion des clés API depuis l'interface

## Installation

```bash
git clone https://github.com/raphcaron/images-seo-processor.git
cd images-seo-processor
npm install
```

## Configuration

### 1. Variables d'environnement

Copiez le fichier d'exemple et renseignez vos clés :

```bash
cp .env.example .env
```

Variables (au moins une clé est nécessaire selon le modèle choisi — voir "Modèles IA disponibles" plus bas) :

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Clé API Anthropic — requise pour les modèles Claude |
| `GEMINI_API_KEY` | Clé API Google Gemini (gratuite) — requise pour Gemini. Clé sur [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `OLLAMA_URL` | URL du serveur Ollama pour les modèles locaux (optionnel, défaut `http://localhost:11434`) |

Les clés Anthropic et Gemini peuvent aussi être configurées depuis l'interface web (carte "Clés API").

### Modèles IA disponibles

| Modèle | Fournisseur | Coût | Notes |
|---|---|---|---|
| Claude Opus 5 / Sonnet 5 / Haiku 4.5 / Opus 4.8 / Fable 5 | Anthropic | Payant au token | Meilleure qualité, nécessite `ANTHROPIC_API_KEY` |
| Google Gemini Flash | Google | Gratuit, limité (~10-15 req/min) | Nécessite `GEMINI_API_KEY` |
| Qwen3-VL 8B / 4B (local) | Ollama (local) | Gratuit, illimité | Tourne sur ta machine, aucune clé requise. Voir "Modèle local (Ollama)" ci-dessous |

### Modèle local (Ollama)

Pour un traitement illimité et gratuit sans dépendre d'un fournisseur externe :

```bash
# 1. Installer Ollama (une seule fois)
curl -fsSL https://ollama.com/install.sh | sh

# 2. Télécharger le modèle vision (~6 Go pour la version 8B)
ollama pull qwen3-vl:8b
# ou la version plus légère/rapide :
ollama pull qwen3-vl:4b
```

Ensuite, sélectionne "Qwen3-VL (local)" dans le menu "Modèle IA" de l'interface. Recommandé : GPU avec au moins 8 Go de VRAM pour la version 8B (4 Go pour la version 4B). Fonctionne aussi sur CPU, mais plus lentement.

### 2. Destinations WordPress / Shopify

Les identifiants WordPress et Shopify ne se configurent plus via `.env` mais depuis la carte **Destinations** de l'interface : chaque destination est un profil nommé (ex: "Client A — Shopify") avec sa propre plateforme et ses propres identifiants. Ils sont stockés localement dans `profiles.json` (non versionné) et sélectionnables au moment de chaque upload, ou comme destination par défaut pour le dossier surveillé `input/`.

### 3. Configuration générale

Le fichier `config.json` à la racine :

```json
{
  "inputDir": "./input",
  "outputDir": "./output",
  "language": "fr",
  "model": "claude-opus-4-8",
  "shopifyApiVersion": "2025-01",
  "defaultProfileId": null
}
```

| Champ | Valeurs possibles | Description |
|---|---|---|
| `language` | `fr`, `en`, `es`, `de` | Langue des textes générés |
| `model` | ex: `claude-opus-4-8`, `gemini-flash-latest`, `local:qwen3-vl:8b` | Modèle IA utilisé — voir "Modèles IA disponibles" plus haut |
| `defaultProfileId` | id d'une destination, ou `null` | Destination utilisée pour le dossier surveillé `input/` |

La configuration est aussi modifiable depuis l'interface.

## Utilisation

```bash
npm start
```

L'interface est accessible sur `http://localhost:3000`.

### Upload d'images

- **Via l'interface** : glissez vos images (ou un dossier entier, sous-dossiers inclus) dans la zone de drop, ou cliquez pour sélectionner des fichiers
- **Via le dossier** : placez vos images dans le dossier `input/`, elles seront détectées et traitées automatiquement avec la destination par défaut configurée

Avant l'upload, choisissez la destination (WordPress, Shopify, ou "Aucune" pour un traitement local uniquement) dans le menu au-dessus de la zone de drop.

### Prompt personnalisé

Un champ texte au-dessus de la zone d'upload permet d'ajouter des instructions pour guider l'IA (contexte produit, style, public cible, etc.). Ces instructions sont prises en compte pour le nom de fichier, le texte alternatif et les mots-clés.

### Formats supportés

JPG, PNG, WebP, AVIF, GIF (max 20 Mo par fichier)

## Architecture

```
src/
├── index.js          # Point d'entrée
├── server.js         # Serveur Express + API
├── analyzer.js       # Intégration Claude + pipeline de traitement
├── queue.js          # File d'attente séquentielle
├── state.js          # État partagé + logs
├── watcher.js        # Surveillance du dossier input/
├── profiles.js       # Gestion des destinations (profils WordPress/Shopify)
├── renamer.js        # Renommage SEO des fichiers
├── csv-writer.js     # Export CSV des résultats
├── uploader/
│   ├── shopify.js    # Upload Shopify (GraphQL staged upload)
│   └── wordpress.js  # Upload WordPress (REST API)
└── public/
    └── index.html    # Interface web
```

## Licence

MIT
