import { readFileSync } from 'fs';
import { basename } from 'path';
import { withRetry } from './retry.js';

export async function uploadToWordPress(filePath, altText, wpCreds) {
  const siteUrl = wpCreds?.siteUrl;
  const username = wpCreds?.username;
  const appPassword = wpCreds?.appPassword;

  if (!siteUrl || !username || !appPassword) {
    console.error('    ⚠ WordPress: destination sans identifiants complets, upload ignoré');
    return;
  }

  const fileData = readFileSync(filePath);
  const filename = basename(filePath);
  const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');

  console.log(`    [→] Upload WordPress...`);

  const media = await withRetry(async () => {
    const formData = new FormData();
    formData.append('file', new Blob([fileData]), filename);

    const uploadRes = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
      },
      body: formData,
    });

    if (!uploadRes.ok) {
      const body = await uploadRes.text();
      const err = new Error(`WordPress upload (${uploadRes.status}): ${body.slice(0, 300)}`);
      err.status = uploadRes.status;
      throw err;
    }

    return uploadRes.json();
  });

  if (altText) {
    const altRes = await fetch(`${siteUrl}/wp-json/wp/v2/media/${media.id}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ alt_text: altText }),
    });

    if (!altRes.ok) {
      console.error(`    ⚠ WordPress: alt_text non mis à jour (media #${media.id})`);
    }
  }

  console.log(`    [✓] WordPress: media #${media.id}`);
  return media;
}

// Vérifie les identifiants sans rien uploader: authentifie sur /users/me et
// s'assure que le compte a la permission de gérer des médias.
export async function testWordPress(wpCreds) {
  const siteUrl = wpCreds?.siteUrl;
  const username = wpCreds?.username;
  const appPassword = wpCreds?.appPassword;

  if (!siteUrl || !username || !appPassword) {
    throw new Error('URL du site, utilisateur et mot de passe application requis');
  }

  const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');
  let response;
  try {
    response = await fetch(`${siteUrl.replace(/\/$/, '')}/wp-json/wp/v2/users/me?context=edit`, {
      headers: { Authorization: `Basic ${credentials}` },
    });
  } catch (err) {
    throw new Error(`Site injoignable (${siteUrl}): ${err.message}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error('Identifiants refusés — utilisateur ou mot de passe application invalide');
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WordPress (${response.status}): ${body.slice(0, 200)}`);
  }

  const user = await response.json();
  if (!user.capabilities?.upload_files) {
    throw new Error(`Connecté en tant que "${user.name}", mais ce compte n'a pas la permission d'uploader des médias`);
  }

  return { ok: true, message: `Connecté en tant que "${user.name}" — upload de médias autorisé` };
}
