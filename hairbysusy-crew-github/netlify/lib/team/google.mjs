// Sign in with Google: the standard authorization-code flow with PKCE, done on the server.
// The browser never sees a Google token. Every ID token is checked here: signature against
// Google's published keys, issuer, audience (our client ID), expiry, the one-time nonce,
// and a verified email address.

import { createPublicKey, verify as rsaVerify, createHash, timingSafeEqual } from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const sha256 = (s) => createHash('sha256').update(s).digest();

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function authUrl({ clientId, redirectUri, state, nonce, verifier }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state,
    nonce,
    code_challenge: b64url(sha256(verifier)),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return AUTH_URL + '?' + p.toString();
}

export async function exchangeCode({ code, clientId, clientSecret, redirectUri, verifier }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }).toString(),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!res.ok || typeof data.id_token !== 'string') {
    const e = new Error('google_token_exchange_failed');
    e.detail = res.status + ' ' + String(data.error || '').slice(0, 60);
    throw e;
  }
  return data.id_token;
}

// Google's signing keys, cached the way Google asks (Cache-Control max-age).
let keyCache = { keys: new Map(), until: 0, fetchedAt: 0 };

export function _resetKeyCache() { keyCache = { keys: new Map(), until: 0, fetchedAt: 0 }; }

async function loadKeys(force) {
  const now = Date.now();
  if (!force && keyCache.until > now) return;
  if (force && now - keyCache.fetchedAt < 60_000) return; // don't let unknown key ids hammer Google
  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error('google_keys_unavailable');
  const body = await res.json();
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  const maxAge = Math.min(Math.max(m ? Number(m[1]) : 3600, 300), 6 * 3600);
  const keys = new Map();
  for (const k of body.keys || []) {
    if (k && k.kty === 'RSA' && typeof k.kid === 'string' && typeof k.n === 'string' && typeof k.e === 'string') {
      keys.set(k.kid, createPublicKey({ key: { kty: 'RSA', n: k.n, e: k.e }, format: 'jwk' }));
    }
  }
  keyCache = { keys, until: now + maxAge * 1000, fetchedAt: now };
}

async function keyFor(kid) {
  await loadKeys(false);
  if (!keyCache.keys.has(kid)) await loadKeys(true);
  const key = keyCache.keys.get(kid);
  if (!key) throw new Error('unknown_signing_key');
  return key;
}

function decodePart(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('bad_token');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export async function verifyIdToken(token, { clientId, nonce, now = Date.now() }) {
  if (typeof token !== 'string' || token.length > 8192) throw new Error('bad_token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('bad_token');
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit) throw new Error('bad_alg');
  const key = await keyFor(header.kid);
  if (!/^[A-Za-z0-9_-]+$/.test(parts[2])) throw new Error('bad_token');
  const ok = rsaVerify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('bad_signature');

  const t = Math.floor(now / 1000);
  if (!ISSUERS.has(claims.iss)) throw new Error('bad_issuer');
  const audOk = Array.isArray(claims.aud) ? claims.aud.includes(clientId) && claims.azp === clientId : claims.aud === clientId;
  if (!clientId || !audOk) throw new Error('bad_audience');
  if (typeof claims.exp !== 'number' || claims.exp < t - 30) throw new Error('expired');
  if (typeof claims.iat !== 'number' || claims.iat > t + 120 || claims.iat < t - 600) throw new Error('bad_iat');
  if (!nonce || !safeEqual(String(claims.nonce || ''), nonce)) throw new Error('bad_nonce');
  if (!(claims.email_verified === true || claims.email_verified === 'true')) throw new Error('email_not_verified');
  if (typeof claims.email !== 'string' || claims.email.length > 254) throw new Error('no_email');
  return { email: claims.email.trim().toLowerCase(), sub: String(claims.sub || '') };
}
