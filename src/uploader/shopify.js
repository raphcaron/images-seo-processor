import { readFileSync } from 'fs';
import { basename, extname } from 'path';
import { addLog } from '../state.js';

const MEDIA_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
};

export async function uploadToShopify(filePath, altText, config) {
  const { SHOPIFY_STORE, SHOPIFY_ACCESS_TOKEN } = process.env;

  if (!SHOPIFY_STORE || !SHOPIFY_ACCESS_TOKEN) {
    addLog('warn', 'Shopify: variables .env manquantes, upload ignoré');
    return;
  }

  const fileData = readFileSync(filePath);
  const filename = basename(filePath);
  const ext = extname(filename).replace('.', '').toLowerCase();
  const mimeType = MEDIA_TYPES[ext] || 'image/jpeg';
  const apiVersion = config.shopifyApiVersion || '2025-01';
  const adminUrl = `https://${SHOPIFY_STORE}/admin/api/${apiVersion}/graphql.json`;

  addLog('info', `Upload Shopify: ${filename}`);

  const stagedTarget = await createStagedUpload(adminUrl, filename, mimeType, fileData.length);
  await uploadToStagedTarget(stagedTarget, fileData, filename);
  const file = await createFile(adminUrl, stagedTarget.resourceUrl, filename, altText);

  addLog('success', `Shopify: ${file?.id || 'OK'}`);
  return file;
}

async function shopifyGraphQL(url, query, variables) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await response.json();

  if (data.errors?.length) {
    throw new Error(`Shopify GraphQL: ${JSON.stringify(data.errors)}`);
  }

  return data.data;
}

async function createStagedUpload(adminUrl, filename, mimeType, fileSize) {
  const query = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    input: [{
      resource: 'FILE',
      filename,
      mimeType,
      fileSize: String(fileSize),
      httpMethod: 'POST',
    }],
  };

  const data = await shopifyGraphQL(adminUrl, query, variables);

  if (data.stagedUploadsCreate.userErrors?.length) {
    throw new Error(`Shopify stagedUploadsCreate: ${JSON.stringify(data.stagedUploadsCreate.userErrors)}`);
  }

  return data.stagedUploadsCreate.stagedTargets[0];
}

async function uploadToStagedTarget(target, fileData, filename) {
  const formData = new FormData();

  for (const param of target.parameters) {
    formData.append(param.name, param.value);
  }

  formData.append('file', new Blob([fileData]), filename);

  const response = await fetch(target.url, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Shopify staged upload (${response.status})`);
  }
}

async function createFile(adminUrl, resourceUrl, filename, altText) {
  const query = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          ... on GenericFile {
            id
            alt
            url
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    files: [{
      originalSource: resourceUrl,
      alt: altText || '',
    }],
  };

  const data = await shopifyGraphQL(adminUrl, query, variables);

  if (data.fileCreate.userErrors?.length) {
    throw new Error(`Shopify fileCreate: ${JSON.stringify(data.fileCreate.userErrors)}`);
  }

  return data.fileCreate.files[0];
}
