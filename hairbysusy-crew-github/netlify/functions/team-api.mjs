// The private team app's server: https://team.hairbysusy.com/api/team/...
//
// Who gets in: only the Google accounts listed in ALLOWED_EMAILS, after Google confirms the
// sign-in. Every request after that is checked against a sign-in record kept in Susy's Wix
// site, and against ALLOWED_EMAILS again, so taking someone off the list locks them out on
// the next deploy.
//
// Netlify environment variables (all required; paste secrets in Netlify yourself):
//   GOOGLE_CLIENT_ID      from Google Cloud > APIs & Services > Credentials (OAuth client, Web application)
//   GOOGLE_CLIENT_SECRET  from the same OAuth client. Secret.
//   ALLOWED_EMAILS        the Google accounts that may sign in, separated by commas
//   WIX_API_KEY           Wix API key (already used by the sign-up form). Secret.
//   TEAM_HOST             optional, defaults to team.hairbysusy.com

import { randomBytes, createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { allowedEmails, googleConfig, teamHost, teamOrigin, redirectUri, SESSION_DAYS } from '../lib/team/config.mjs';
import { authUrl, exchangeCode, verifyIdToken, safeEqual } from '../lib/team/google.mjs';
import {
  WixError, wixReady, listRecords, getRecord, writeRecord, removeRecord,
  insertSession, findSession, deleteSession, deleteExpiredSessions, logActivity,
} from '../lib/team/wix.mjs';
import { contactsOp } from '../lib/team/contacts.mjs';
import { Invalid, ID_RE, cleanDoc, deepMerge, checkSize } from '../lib/team/validate.mjs';
import { listJobs, updateJob, getJob } from '../lib/book/store.mjs';
import { getVoice } from '../lib/book/voice.mjs';
import { clientLink, stylistLink, linksReady } from '../lib/book/links.mjs';
import { teamChange, FlowError, JOB_ID_RE, PID_RE } from '../lib/book/flow.mjs';

const SESSION_COOKIE = '__Host-hbs_s';
const LOGIN_COOKIE = '__Host-hbs_login';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{22}$/;
const MAX_BODY = 300 * 1024;
const SESSION_CACHE_MS = 30_000;

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function respond(status, body, extra = {}, cookies = []) {
  const h = new Headers(SECURITY_HEADERS);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  for (const c of cookies) h.append('Set-Cookie', c);
  if (body === null) return new Response(null, { status, headers: h });
  h.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers: h });
}
const json = (status, body, cookies) => respond(status, body, {}, cookies);
const redirect = (to, cookies = [], status = 303) => respond(status, null, { Location: to }, cookies);

const cookie = (name, value, { maxAge, sameSite = 'Strict' }) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${maxAge}`;
const clearCookie = (name, sameSite = 'Strict') => cookie(name, '', { maxAge: 0, sameSite });

function readCookie(req, name) {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

const rand = () => randomBytes(32).toString('base64url');
const hashToken = (t) => createHash('sha256').update(t).digest('hex');

// Session tokens carry a short signature, so made-up tokens are turned away here without
// a trip to Wix. The signing key is derived from the Google client secret.
const tagKey = () => Buffer.from(hkdfSync('sha256', googleConfig().clientSecret, 'hbs-team', 'session-tag-v1', 32));
const tagOf = (r) => createHmac('sha256', tagKey()).update(r).digest().subarray(0, 16).toString('base64url');
const newToken = () => { const r = rand(); return r + '.' + tagOf(r); };
function tokenLooksOurs(token) {
  if (!TOKEN_RE.test(token) || !googleConfig().clientSecret) return false;
  const [r, tag] = token.split('.');
  const want = Buffer.from(tagOf(r)), got = Buffer.from(tag);
  return want.length === got.length && timingSafeEqual(want, got);
}
const later = (context, p) => {
  const q = Promise.resolve(p).catch((e) => console.error('team: background task failed', e && e.message));
  if (context && typeof context.waitUntil === 'function') context.waitUntil(q);
  return q;
};
const deviceOf = (req) => {
  const ua = req.headers.get('user-agent') || '';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other';
  const br = /CriOS|Chrome\//.test(ua) && !/Edg\//.test(ua) ? 'Chrome' : /Edg\//.test(ua) ? 'Edge' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  return os + ' · ' + br;
};

/* ---------------- who is asking ---------------- */

const sessionCache = new Map();

async function currentUser(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!tokenLooksOurs(token)) return null;
  const id = hashToken(token);
  const now = Date.now();
  let s = sessionCache.get(id);
  if (!s || now - s.at > SESSION_CACHE_MS) {
    const found = await findSession(id);
    s = found ? { ...found, at: now } : null;
    if (s) sessionCache.set(id, s); else sessionCache.delete(id);
    if (sessionCache.size > 500) sessionCache.clear();
  }
  if (!s || s.expires <= now) return null;
  if (!allowedEmails().has(s.email)) return null;
  return { email: s.email, sessionId: id };
}

// Requests that change anything must come from the app's own page.
function fromOurPage(req, needsBody) {
  if (req.headers.get('x-hbs-team') !== '1') return false;
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = req.headers.get('origin');
  if (needsBody) {
    if (origin !== teamOrigin()) return false;
    if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return false;
  } else if (origin && origin !== teamOrigin()) return false;
  return true;
}

async function readJson(req) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new Invalid('too large');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Invalid('too large');
  try { return JSON.parse(text); } catch { throw new Invalid('bad json'); }
}

/* ---------------- sign in / out ---------------- */

async function startLogin() {
  const g = googleConfig();
  if (!g.ready || !allowedEmails().size || !wixReady()) return redirect('/team/?signin=setup', [], 302);
  const state = rand(), nonce = rand(), verifier = rand();
  const to = authUrl({ clientId: g.clientId, redirectUri: redirectUri(), state, nonce, verifier });
  return redirect(to, [cookie(LOGIN_COOKIE, `${state}.${nonce}.${verifier}`, { maxAge: 600, sameSite: 'Lax' })], 302);
}

async function finishLogin(req, url, context) {
  const g = googleConfig();
  const clear = [clearCookie(LOGIN_COOKIE, 'Lax')];
  const [state, nonce, verifier] = readCookie(req, LOGIN_COOKIE).split('.');
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) return redirect('/team/?signin=cancelled', clear);
  if (!g.ready || !state || !nonce || !verifier || !safeEqual(url.searchParams.get('state') || '', state) || code.length > 2048) {
    return redirect('/team/?signin=expired', clear);
  }
  let email;
  try {
    const idToken = await exchangeCode({ code, clientId: g.clientId, clientSecret: g.clientSecret, redirectUri: redirectUri(), verifier });
    ({ email } = await verifyIdToken(idToken, { clientId: g.clientId, nonce }));
  } catch (e) {
    console.error('team: sign-in check failed', e && e.message, e && e.detail);
    return redirect('/team/?signin=failed', clear);
  }
  if (!allowedEmails().has(email)) {
    await logActivity(email, 'sign-in refused', '', 'not on the allowed list').catch(() => {});
    return redirect('/team/?signin=denied', clear);
  }
  const token = newToken();
  try {
    await insertSession(hashToken(token), email, Date.now() + SESSION_DAYS * 86400_000, deviceOf(req));
  } catch (e) {
    console.error('team: could not save sign-in', e && e.message);
    return redirect('/team/?signin=failed', clear);
  }
  await logActivity(email, 'signed in', '', deviceOf(req)).catch(() => {});
  later(context, deleteExpiredSessions());
  return redirect('/team/', clear.concat(cookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400 })));
}

/* ---------------- the app's data ---------------- */

const COLS = new Set(['crew', 'jobs']);

async function loadAll() {
  const [crew, jobs, inbox, clients] = await Promise.all([
    listRecords('crew'), listRecords('jobs'), listRecords('inbox'),
    listJobs().catch((e) => { console.error('team: client jobs did not load', e && (e.code || e.message)); return null; }),
  ]);
  return {
    crew: crew.map((r) => ({ id: r.id, data: r.doc })),
    jobs: jobs.map((r) => ({ id: r.id, data: r.doc })),
    clients: clients === null ? null : clients.map((c) => clientOut(c, crew)),
    inbox: inbox.map((item) => {
      let fields = {};
      try { fields = JSON.parse((item.data || {}).json || '{}'); } catch { fields = {}; }
      return { id: item.id, data: { fields, received_at: (item.data || {}).receivedAt || '' } };
    }),
  };
}

async function write(body, user, context) {
  const { op, col, id } = body || {};
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Invalid('bad id');
  if (op === 'delete' && (COLS.has(col) || col === 'inbox')) {
    await removeRecord(col, id);
    if (col !== 'inbox') later(context, logActivity(user.email, 'deleted', col + '/' + id));
    return;
  }
  if (!COLS.has(col)) throw new Invalid('bad list');
  if (op === 'set') {
    const doc = checkSize(cleanDoc(body.data));
    await writeRecord(col, id, () => doc, user.email);
    later(context, logActivity(user.email, 'saved', col + '/' + id, Object.keys(doc).slice(0, 20).join(', ')));
    return;
  }
  if (op === 'update') {
    const patch = cleanDoc(body.data);
    await writeRecord(col, id, (cur) => (cur ? checkSize(deepMerge(cur, patch)) : null), user.email);
    later(context, logActivity(user.email, 'changed', col + '/' + id, Object.keys(patch).slice(0, 20).join(', ')));
    return;
  }
  throw new Invalid('bad request');
}

/* ---------------- HBS client jobs (bookhbs.com) ---------------- */

// Who can take a client job: approved crew who do full jobs and take clients in the job's city.
// The same city rules as the team app's own list (site/team/app.js: cityKey, placeMain, worksIn).
const cityKey = (c) => String(c || '').trim().toLowerCase().replace(/\s+/g, ' ')
  .replace(/^nyc$|^new york city$|^brooklyn$|^manhattan$/, 'new york').replace(/^la$/, 'los angeles');
const placeMain = (c) => cityKey(c).split(',')[0].trim();
const worksIn = (p, c) => String((p && p.city) || '').split(';').map((x) => x.trim()).filter(Boolean).some((l) => placeMain(l) === placeMain(c));
const doesFullJobs = (p) => /full|both/i.test(String((p && p.role) || ''));

// A client job as the team app gets it: the whole job, the client's link, and a link for each
// stylist who can be asked (or already was).
function clientOut(job, crew) {
  const doc = job.doc;
  const pids = new Set(Object.keys(doc.people || {}));
  if (doc.status === 'posted' || doc.status === 'matched') {
    for (const c of crew) {
      if (c.doc && c.doc.status === 'approved' && doesFullJobs(c.doc) && worksIn(c.doc, doc.city)) pids.add(c.id);
    }
  }
  const links = { client: '', stylists: {} };
  if (linksReady() && doc.status !== 'unpaid') {
    links.client = clientLink(doc, job.id);
    for (const pid of pids) if (PID_RE.test(pid)) links.stylists[pid] = stylistLink(doc, job.id, pid);
  }
  return { id: job.id, data: doc, links };
}

// A client's voice note, for the team to play: { type, secs, data (base64) }.
async function clientVoice(id) {
  if (typeof id !== 'string' || !JOB_ID_RE.test(id)) throw new Invalid('bad id');
  const job = await getJob(id);
  const note = job && job.doc.voice ? await getVoice(id, job.doc.voice) : null;
  return note;
}

const CLIENT_OPS = new Set(['ask', 'state', 'cancel', 'reopen', 'done']);

async function clientChange(body, user, context) {
  const { op, id, pid, state } = body || {};
  if (typeof id !== 'string' || !JOB_ID_RE.test(id)) throw new Invalid('bad id');
  if (!CLIENT_OPS.has(op)) throw new Invalid('bad request');
  if ((op === 'ask' || op === 'state') && (typeof pid !== 'string' || !PID_RE.test(pid))) throw new Invalid('bad person');
  let person = null;
  if (op === 'ask') {
    const rec = await getRecord('crew', pid);
    if (!rec || !rec.doc) throw new Invalid('not on the crew');
    person = { name: rec.doc.name };
  }
  let refused = null;
  const saved = await updateJob(id, (cur) => {
    try {
      const next = teamChange(cur, op, { pid, state, person }, new Date().toISOString(), user.email);
      return next === cur ? null : next;
    } catch (e) {
      if (e instanceof FlowError) { refused = e.code; return null; }
      throw e;
    }
  }, user.email);
  if (!saved) { const e = new Error('not_found'); e.code = 'not_found'; throw e; }
  if (refused) throw new Invalid(refused);
  later(context, logActivity(user.email, 'client job: ' + op + (op === 'state' ? ' ' + state : ''), 'client/' + id, person ? person.name : ''));
  return { id, data: saved.doc };
}

/* ---------------- router ---------------- */

function failure(e) {
  if (e instanceof Invalid) return json(400, { error: 'invalid', why: e.why });
  if (e && e.code === 'not_found') return json(404, { error: 'not_found' });
  if (e && e.code === 'busy') return json(409, { error: 'busy' });
  if (e && e.code === 'wix_not_set') return json(503, { error: 'wix_not_set' });
  if (e instanceof WixError) {
    console.error('team: wix answered', e.status, e.code);
    return json(502, { error: 'wix', status: e.status, detail: e.text.slice(0, 600) });
  }
  console.error('team: failed', e && e.message);
  return json(500, { error: 'server' });
}

export default async (req, context) => {
  const url = new URL(req.url);
  const host = (req.headers.get('host') || url.host).toLowerCase().replace(/:\d+$/, '');
  if (host !== teamHost()) return json(404, { error: 'not_found' });
  const route = url.pathname.replace(/^\/api\/team\/?/, '').replace(/\/$/, '');
  const method = req.method.toUpperCase();

  try {
    if (route === 'login' && method === 'GET') return await startLogin();
    if (route === 'callback' && method === 'GET') return await finishLogin(req, url, context);

    const needsBody = method === 'POST';
    if (!['GET', 'POST'].includes(method)) return json(405, { error: 'method' });
    if (!fromOurPage(req, needsBody)) return json(403, { error: 'forbidden' });

    const user = await currentUser(req);
    if (!user) return json(401, { error: 'signed_out' }, [clearCookie(SESSION_COOKIE)]);

    if (route === 'me' && method === 'GET') return json(200, { email: user.email });
    if (route === 'data' && method === 'GET') return json(200, await loadAll());
    if (route === 'write' && method === 'POST') { await write(await readJson(req), user, context); return json(200, { ok: true }); }
    if (route === 'wix' && method === 'POST') return json(200, { ok: true, result: await contactsOp(await readJson(req)) });
    if (route === 'client' && method === 'POST') return json(200, { ok: true, job: await clientChange(await readJson(req), user, context) });
    if (route === 'voice' && method === 'GET') {
      const id = url.searchParams.get('id');
      const note = await clientVoice(id);
      if (!note) return json(404, { error: 'not_found' });
      await logActivity(user.email, 'played voice note', 'client/' + id).catch(() => {}); // who listened, and when
      return json(200, note);
    }
    if (route === 'logout' && method === 'POST') {
      sessionCache.delete(user.sessionId);
      await deleteSession(user.sessionId);
      await logActivity(user.email, 'signed out', '').catch(() => {});
      return json(200, { ok: true }, [clearCookie(SESSION_COOKIE)]);
    }
    return json(404, { error: 'not_found' });
  } catch (e) {
    return failure(e);
  }
};

export const config = { path: '/api/team/*' };
