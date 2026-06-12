import { readFileSync } from 'fs';
import { basename } from 'path';

export async function uploadToWordPress(filePath, altText) {
  const { WP_SITE_URL, WP_APP_USERNAME, WP_APP_PASSWORD } = process.env;

  if (!WP_SITE_URL || !WP_APP_USERNAME || !WP_APP_PASSWORD) {
    console.error('    ⚠ WordPress: variables .env manquantes, upload ignoré');
    return;
  }

  const fileData = readFileSync(filePath);
  const filename = basename(filePath);
  const credentials = Buffer.from(`${WP_APP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64');

  console.log(`    [→] Upload WordPress...`);

  const formData = new FormData();
  formData.append('file', new Blob([fileData]), filename);

  const uploadRes = await fetch(`${WP_SITE_URL}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
    },
    body: formData,
  });

  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    throw new Error(`WordPress upload (${uploadRes.status}): ${body}`);
  }

  const media = await uploadRes.json();

  if (altText) {
    const altRes = await fetch(`${WP_SITE_URL}/wp-json/wp/v2/media/${media.id}`, {
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
