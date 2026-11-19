// The confirm-your-city page's server: POST https://crew.hairbysusy.com/api/crew/city
//
// Applicants get an email with their own link: crew.hairbysusy.com/city/?k=<their Wix contact id>.
// They choose up to 2 cities where they take clients now. Saving replaces the cities they first picked:
//   - in Wix Contacts: their "Crew: <city>" tags, and the "Confirm city" tag that sent the email comes off;
//   - in the team app: their crew record, or their application if it is still waiting in the app's inbox.
// The link only works for contacts tagged Crew. Nothing about the person is sent back to the page.
//
// Uses the WIX_API_KEY Netlify variable, like the rest of the site.

import { wixReady, wixRequest, WixError, listRecords, writeRecord, replaceInboxFields, logActivity } from '../lib/team/wix.mjs';

const ORIGIN = 'https://crew.hairbysusy.com';
const MAX_BODY = 2048;
const MAX_CITIES = 2;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tag keys in Susy's Wix site. These are ids, not secrets.
const TAG = {
  crew: 'custom.crew-Q0l69',
  review: 'custom.crew-to-review-W5bBx',
  approved: 'custom.crew-approved-b6kAa',
  declined: 'custom.crew-declined-T4HJG',
  later: 'custom.crew-reach-out-later-KprOe',
  removed: 'custom.crew-removed-jiJ2a',
  worked: 'custom.crew-worked-with-392PR',
  again: 'custom.crew-applied-again-r2qnh',
  // "Confirm city": adding it sends the confirm-your-city email. Not a "Crew: " tag, so the
  // team app never mistakes it for a city.
  confirm: 'custom.confirm-city-gS6tm',
};
const NOT_CITIES = new Set(Object.values(TAG));
const PRESETS = ['New York', 'Los Angeles', 'Atlanta', 'Miami', 'Houston', 'Chicago', 'Washington DC', 'Las Vegas',
  'Toronto', 'London', 'Paris', 'Lagos', 'Abuja', 'Accra', 'Johannesburg', 'Dubai'];

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Type': 'application/json; charset=utf-8',
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: HEADERS });

// Same clean-up as the sign-up form's "Somewhere else?" box; a listed city keeps its usual spelling.
function cleanCity(raw) {
  let t = String(raw || '').replace(/;+/g, ' ').replace(/[^\p{L}\p{M} .,'\-]/gu, '').replace(/\s*,[\s,]*/g, ', ')
    .replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').slice(0, 40);
  if (t && t === t.toLowerCase()) t = t.replace(/(^|[\s\-])\p{L}/gu, (m) => m.toUpperCase());
  t = t.replace(/,\s*(\p{L}{2})$/u, (m, c) => ', ' + c.toUpperCase()); // "Charlotte, nc" -> "Charlotte, NC"
  return PRESETS.find((p) => p.toLowerCase() === t.toLowerCase()) || t;
}

// 1 or 2 cities, cleaned; null when the list isn't usable.
export function readCities(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_CITIES) return null;
  const out = [];
  for (const r of raw) {
    if (typeof r !== 'string' || r.length > 80) return null;
    const c = cleanCity(r);
    if (!c || !/\p{L}/u.test(c)) return null;
    if (!out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
  }
  return out;
}

// Only the confirm page itself may save (a browser always says where a request came from).
function fromOurPage(req) {
  if (req.headers.get('origin') !== ORIGIN) return false;
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  return (req.headers.get('content-type') || '').toLowerCase().startsWith('application/json');
}

async function readBody(req) {
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return null;
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch { return null; }
}

const last10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);

// Which of the contact's tags are "Crew: <city>" tags.
async function cityTagsOf(keys) {
  const maybe = keys.filter((k) => typeof k === 'string' && k.startsWith('custom.') && !NOT_CITIES.has(k));
  if (!maybe.length) return [];
  const r = await wixRequest('POST', '/contacts/v4/labels/query', {
    body: { query: { filter: { key: { $in: maybe } }, paging: { limit: 1000, offset: 0 } } },
  });
  return (r.labels || []).filter((l) => /^Crew: /.test(l.displayName || '')).map((l) => l.key);
}

async function retag(contactId, keys, cities) {
  const want = [];
  for (const c of cities) {
    const r = await wixRequest('POST', '/contacts/v4/labels', { body: { displayName: 'Crew: ' + c } });
    if (r.label && r.label.key && !want.includes(r.label.key)) want.push(r.label.key);
  }
  if (want.length !== cities.length) throw new Error('city tag missing');
  const current = await cityTagsOf(keys);
  const add = want.filter((k) => !keys.includes(k));
  const drop = current.filter((k) => !want.includes(k)).concat(keys.includes(TAG.confirm) ? [TAG.confirm] : []);
  if (add.length) {
    await wixRequest('POST', '/contacts/v4/contacts/' + encodeURIComponent(contactId) + '/labels', { body: { labelKeys: add } });
  }
  if (drop.length) {
    const q = new URLSearchParams();
    drop.forEach((k) => q.append('labelKeys', k));
    await wixRequest('DELETE', '/contacts/v4/contacts/' + encodeURIComponent(contactId) + '/labels', { query: q, body: { labelKeys: drop } });
  }
}

// The team app: their crew record, or their application still waiting in the inbox.
async function updateApp(contact, cities) {
  const info = contact.info || {};
  const primary = contact.primaryInfo || {};
  const emails = new Set([primary.email, ...(((info.emails || {}).items) || []).map((e) => e.email)]
    .map((e) => String(e || '').trim().toLowerCase()).filter(Boolean));
  const phones = new Set([primary.phone, ...(((info.phones || {}).items) || []).flatMap((p) => [p.phone, p.e164Phone])]
    .map(last10).filter(Boolean));
  const isThem = (d) => (d.email && emails.has(String(d.email).trim().toLowerCase())) || (last10(d.phone) && phones.has(last10(d.phone)));
  const cityText = cities.join('; ');
  const now = new Date().toISOString();

  const crew = await listRecords('crew');
  const rec = crew.find((r) => r.doc.wix_id === contact.id) || crew.find((r) => !r.doc.wix_skip && !r.doc.sample && isThem(r.doc));
  if (rec) {
    await writeRecord('crew', rec.id, (cur) => {
      if (!cur) return null;
      const next = { ...cur, city: cityText, city_confirmed_at: now };
      if (cur.city_before === undefined && (cur.city || '') !== cityText) next.city_before = cur.city || '';
      // Wix now has these cities too, so the app's record of what Wix holds moves with them.
      const sig = typeof cur.wix_sig === 'string' ? cur.wix_sig.split('|') : [];
      if (sig.length >= 4) next.wix_sig = sig.slice(0, 3).concat(cities.join(';')).join('|');
      return next;
    }, 'confirm-city page');
    return 'crew/' + rec.id;
  }
  for (const item of await listRecords('inbox')) {
    let f = {};
    try { f = JSON.parse((item.data || {}).json || '{}'); } catch { f = {}; }
    if (isThem(f)) {
      await replaceInboxFields(item, { ...f, locations: cityText });
      return 'inbox/' + item.id;
    }
  }
  return 'wix only';
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  if (!fromOurPage(req)) return json(403, { error: 'forbidden' });
  if (!wixReady()) return json(503, { error: 'not_ready' });
  const body = await readBody(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'invalid' });
  const k = typeof body.k === 'string' ? body.k : '';
  if (!ID_RE.test(k)) return json(404, { error: 'not_found' });
  const cities = readCities(body.cities);
  if (!cities) return json(400, { error: 'invalid' });

  try {
    let contact = null;
    try {
      contact = (await wixRequest('GET', '/contacts/v4/contacts/' + encodeURIComponent(k))).contact || null;
    } catch (e) {
      if (e instanceof WixError && (e.status === 404 || e.status === 400)) return json(404, { error: 'not_found' });
      throw e;
    }
    const keys = ((((contact || {}).info || {}).labelKeys || {}).items) || [];
    if (!contact || !contact.id || !keys.includes(TAG.crew)) return json(404, { error: 'not_found' });

    await retag(contact.id, keys, cities);
    const where = await updateApp(contact, cities);
    await logActivity('confirm-city page', 'city confirmed', where, 'city').catch(() => {});
    console.log('crew city: saved (' + where.split('/')[0] + ')');
    return json(200, { ok: true, cities });
  } catch (e) {
    console.error('crew city: failed', e && (e.code || e.status || e.message));
    return json(502, { error: 'failed' });
  }
};

export const config = { path: '/api/crew/city' };
