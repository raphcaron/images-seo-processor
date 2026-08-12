import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

function profilesPath(rootDir) {
  return join(rootDir, 'profiles.json');
}

export function loadProfiles(rootDir) {
  const path = profilesPath(rootDir);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveProfiles(rootDir, profiles) {
  writeFileSync(profilesPath(rootDir), JSON.stringify(profiles, null, 2));
}

export function getProfile(rootDir, id) {
  return loadProfiles(rootDir).find((p) => p.id === id) || null;
}

export function createProfile(rootDir, data) {
  const profiles = loadProfiles(rootDir);
  const profile = {
    id: randomUUID(),
    name: data.name,
    platform: data.platform,
    wp: data.platform === 'wordpress' ? {
      siteUrl: data.wp?.siteUrl || '',
      username: data.wp?.username || '',
      appPassword: data.wp?.appPassword || '',
    } : undefined,
    shopify: data.platform === 'shopify' ? {
      store: data.shopify?.store || '',
      accessToken: data.shopify?.accessToken || '',
      apiVersion: data.shopify?.apiVersion || '2025-01',
    } : undefined,
  };
  profiles.push(profile);
  saveProfiles(rootDir, profiles);
  return profile;
}

export function updateProfile(rootDir, id, data) {
  const profiles = loadProfiles(rootDir);
  const profile = profiles.find((p) => p.id === id);
  if (!profile) return null;

  if (data.name !== undefined) profile.name = data.name;

  if (profile.platform === 'wordpress') {
    profile.wp = profile.wp || {};
    if (data.wp?.siteUrl !== undefined) profile.wp.siteUrl = data.wp.siteUrl;
    if (data.wp?.username !== undefined) profile.wp.username = data.wp.username;
    if (data.wp?.appPassword) profile.wp.appPassword = data.wp.appPassword;
  } else if (profile.platform === 'shopify') {
    profile.shopify = profile.shopify || {};
    if (data.shopify?.store !== undefined) profile.shopify.store = data.shopify.store;
    if (data.shopify?.accessToken) profile.shopify.accessToken = data.shopify.accessToken;
    if (data.shopify?.apiVersion !== undefined) profile.shopify.apiVersion = data.shopify.apiVersion;
  }

  saveProfiles(rootDir, profiles);
  return profile;
}

export function deleteProfile(rootDir, id) {
  const profiles = loadProfiles(rootDir);
  const next = profiles.filter((p) => p.id !== id);
  saveProfiles(rootDir, next);
  return next.length !== profiles.length;
}

function maskSecret(v) {
  return v && v.length > 10 ? v.slice(0, 6) + '***' + v.slice(-4) : v ? '***' : '';
}

export function maskProfile(p) {
  const base = { id: p.id, name: p.name, platform: p.platform };
  if (p.platform === 'wordpress') {
    base.wp = {
      siteUrl: p.wp?.siteUrl || '',
      username: p.wp?.username || '',
      passwordSet: !!p.wp?.appPassword,
    };
  } else if (p.platform === 'shopify') {
    base.shopify = {
      store: p.shopify?.store || '',
      apiVersion: p.shopify?.apiVersion || '2025-01',
      tokenSet: !!p.shopify?.accessToken,
      tokenMasked: maskSecret(p.shopify?.accessToken),
    };
  }
  return base;
}

// Migration ponctuelle: si profiles.json n'existe pas encore et que des
// identifiants WordPress/Shopify sont déjà présents dans .env (ancien modèle
// mono-destination), on les convertit en un premier profil pour ne pas les
// perdre lors de la mise à jour vers le système multi-destinations.
export function migrateLegacyEnvProfile(rootDir, config) {
  if (existsSync(profilesPath(rootDir))) return null;

  const { WP_SITE_URL, WP_APP_USERNAME, WP_APP_PASSWORD, SHOPIFY_STORE, SHOPIFY_ACCESS_TOKEN } = process.env;

  let migrated = null;
  if (SHOPIFY_STORE && SHOPIFY_ACCESS_TOKEN) {
    migrated = createProfile(rootDir, {
      name: 'Profil existant (Shopify)',
      platform: 'shopify',
      shopify: { store: SHOPIFY_STORE, accessToken: SHOPIFY_ACCESS_TOKEN, apiVersion: config.shopifyApiVersion },
    });
  } else if (WP_SITE_URL && WP_APP_USERNAME && WP_APP_PASSWORD) {
    migrated = createProfile(rootDir, {
      name: 'Profil existant (WordPress)',
      platform: 'wordpress',
      wp: { siteUrl: WP_SITE_URL, username: WP_APP_USERNAME, appPassword: WP_APP_PASSWORD },
    });
  }

  return migrated;
}
