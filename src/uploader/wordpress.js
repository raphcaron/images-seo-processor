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
