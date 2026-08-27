import { readFileSync } from 'fs';
import { basename, extname } from 'path';
import { addLog } from '../state.js';
import { withRetry } from './retry.js';

const MEDIA_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

export async function uploadToShopify(filePath, altText, shopifyCreds) {
  const store = shopifyCreds?.store;
  const accessToken = shopifyCreds?.accessToken;

  if (!store || !accessToken) {
    addLog('warn', 'Shopify: destination sans identifiants complets, upload ignoré');
    return;
  }

  const fileData = readFileSync(filePath);
  const filename = basename(filePath);
  const ext = extname(filename).replace('.', '').toLowerCase();
  const mimeType = MEDIA_TYPES[ext] || 'image/jpeg';
  const apiVersion = shopifyCreds?.apiVersion || '2025-01';
  const adminUrl = `https://${store}/admin/api/${apiVersion}/graphql.json`;

  addLog('info', `Upload Shopify: ${filename}`);

  const stagedTarget = await createStagedUpload(adminUrl, accessToken, filename, mimeType, fileData.length);
  await uploadToStagedTarget(stagedTarget, fileData, filename);
  const file = await createFile(adminUrl, accessToken, stagedTarget.resourceUrl, filename, altText);

  addLog('success', `Shopify: ${file?.id || 'OK'}`);
  return file;
}

// Vérifie le store/token sans rien uploader: interroge le shop et les scopes
// accordés à l'app, et s'assure que la permission write_files est présente.
export async function testShopify(shopifyCreds) {
  const store = shopifyCreds?.store;
  const accessToken = shopifyCreds?.accessToken;

  if (!store || !accessToken) {
    throw new Error('Store et Access Token requis');
  }

  const apiVersion = shopifyCreds?.apiVersion || '2025-01';
  const adminUrl = `https://${store}/admin/api/${apiVersion}/graphql.json`;
  const query = `
    query {
      shop { name }
      currentAppInstallation {
        accessScopes { handle }
      }
    }
  `;

  let response;
  try {
    response = await fetch(adminUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query }),
    });
  } catch (err) {
    throw new Error(`Store injoignable (${store}): ${err.message}`);
  }

  if (response.status === 401) {
    throw new Error('Access Token invalide');
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  if (data.errors?.length) {
    throw new Error(`Shopify: ${JSON.stringify(data.errors).slice(0, 200)}`);
  }

  const scopes = data.data?.currentAppInstallation?.accessScopes?.map((s) => s.handle) || [];
  if (!scopes.includes('write_files')) {
    throw new Error(`Connecté à "${data.data.shop.name}", mais le token n'a pas la permission write_files (upload de fichiers)`);
  }

  return { ok: true, message: `Connecté à "${data.data.shop.name}" — upload de fichiers autorisé` };
}

async function shopifyGraphQL(url, accessToken, query, variables) {
  return withRetry(async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok && response.status >= 500) {
      const err = new Error(`Shopify GraphQL (${response.status})`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();

    if (data.errors?.length) {
      throw new Error(`Shopify GraphQL: ${JSON.stringify(data.errors)}`);
    }

    return data.data;
  });
}

async function createStagedUpload(adminUrl, accessToken, filename, mimeType, fileSize) {
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

  const data = await shopifyGraphQL(adminUrl, accessToken, query, variables);

  if (data.stagedUploadsCreate.userErrors?.length) {
    throw new Error(`Shopify stagedUploadsCreate: ${JSON.stringify(data.stagedUploadsCreate.userErrors)}`);
  }

  return data.stagedUploadsCreate.stagedTargets[0];
}

async function uploadToStagedTarget(target, fileData, filename) {
  await withRetry(async () => {
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
      const err = new Error(`Shopify staged upload (${response.status})`);
      err.status = response.status;
      throw err;
    }
  });
}

async function createFile(adminUrl, accessToken, resourceUrl, filename, altText) {
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

  const data = await shopifyGraphQL(adminUrl, accessToken, query, variables);

  if (data.fileCreate.userErrors?.length) {
    throw new Error(`Shopify fileCreate: ${JSON.stringify(data.fileCreate.userErrors)}`);
  }

  return data.fileCreate.files[0];
}
