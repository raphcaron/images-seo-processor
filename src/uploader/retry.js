// Retente un appel réseau en cas d'erreur transitoire (5xx, timeout réseau).
// Les erreurs 4xx (identifiants invalides, requête malformée, crédits
// épuisés, etc.) ne sont jamais retentées: réessayer ne changerait rien.
export async function withRetry(fn, { attempts = 3, delayMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isTransient(err)) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

function isTransient(err) {
  if (err.status && err.status >= 500) return true;
  if (err.transient) return true;
  return false;
}
