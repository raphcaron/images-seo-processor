# Images SEO Processor

Outil web de traitement SEO d'images alimenté par l'IA Claude d'Anthropic. Analyse, renomme et optimise automatiquement vos images pour le référencement, avec upload optionnel vers WordPress ou Shopify.

## Fonctionnalités

- Analyse IA via Claude (Opus 4.8 / Fable 5) pour générer des noms de fichiers SEO, des textes alternatifs et des mots-clés
- Upload par drag-and-drop ou surveillance automatique d'un dossier
- Prompt personnalisable pour guider l'analyse de chaque lot d'images
- Upload automatique vers WordPress ou Shopify
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

Variables disponibles :

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Clé API Anthropic (requise) |
| `WP_SITE_URL` | URL du site WordPress |
| `WP_APP_USERNAME` | Utilisateur WordPress |
| `WP_APP_PASSWORD` | Mot de passe application WordPress |
| `SHOPIFY_STORE` | Domaine du store Shopify |
| `SHOPIFY_ACCESS_TOKEN` | Token d'accès Shopify Admin API |

Les clés peuvent aussi être configurées depuis l'interface web.

### 2. Configuration générale

Le fichier `config.json` à la racine :

```json
{
  "inputDir": "./input",
  "outputDir": "./output",
  "platform": "shopify",
  "language": "fr",
  "model": "claude-opus-4-8",
  "shopifyApiVersion": "2025-01"
}
```

| Champ | Valeurs possibles | Description |
|---|---|---|
| `platform` | `wordpress`, `shopify`, `none` | Plateforme d'upload cible |
| `language` | `fr`, `en`, `es`, `de` | Langue des textes générés |
| `model` | `claude-opus-4-8`, `claude-fable-5` | Modèle Claude utilisé |

La configuration est aussi modifiable depuis l'interface.

## Utilisation

```bash
npm start
```

L'interface est accessible sur `http://localhost:3000`.

### Upload d'images

- **Via l'interface** : glissez vos images dans la zone de drop ou cliquez pour sélectionner
- **Via le dossier** : placez vos images dans le dossier `input/`, elles seront dététées et traitées automatiquement

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
