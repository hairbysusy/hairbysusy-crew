// Private links for HBS client jobs: the client's job page and each stylist's own job page.
//
// Links are signed, not stored: each key is an HMAC of the job (and stylist) under a key derived
// from the GOOGLE_CLIENT_SECRET Netlify variable. The team app can rebuild any link to send it
// again, and nothing in Wix can be turned into a working link. Changing that secret changes every
// stylist link (client links also keep working through the hash saved with each job).

import crypto from 'node:crypto';
import { env } from '../team/config.mjs';

let cached = { secret: '', key: null };
function linkKey() {
  const secret = env('GOOGLE_CLIENT_SECRET').trim();
  if (!secret) return null;
  if (cached.secret !== secret) {
    cached = { secret, key: Buffer.from(crypto.hkdfSync('sha256', secret, 'hbs-book', 'links-v1', 32)) };
  }
  return cached.key;
}

export const linksReady = () => Boolean(linkKey());

function sign(message, length) {
  const key = linkKey();
  if (!key) { const e = new Error('links_not_set'); e.code = 'links_not_set'; throw e; }
  return crypto.createHmac('sha256', key).update(message).digest('base64url').slice(0, length);
}

export const clientKey = (id) => sign('client|' + id, 24);
export const stylistKey = (id, pid) => sign('stylist|' + id + '|' + pid, 22);

export function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Where a job's pages live: the address it was posted from (bookhbs.com, or the test link).
const ORIGIN_RE = /^https:\/\/(bookhbs\.com|www\.bookhbs\.com|hairbysusy-crew\.netlify\.app|[a-z0-9-]+--hairbysusy-crew\.netlify\.app)$/;
export const originOf = (doc) => (doc && ORIGIN_RE.test(doc.origin || '') ? doc.origin : 'https://hairbysusy-crew.netlify.app');

export const clientLink = (doc, id) => originOf(doc) + '/book/job/?j=' + encodeURIComponent(id) + '&k=' + encodeURIComponent(clientKey(id));
export const stylistLink = (doc, id, pid) => originOf(doc) + '/book/s/?j=' + encodeURIComponent(id) + '&t=' + encodeURIComponent(stylistKey(id, pid));
