// HBS client jobs server (bookhbs.com): POST /api/book/jobs, /api/book/job, /api/book/pay
//
//   jobs  a client posts a job. It is saved unpaid in Susy's Wix site, then a Wix Payments checkout
//         is made for the booking fee (30% of the budget). Answers the job's private link and the
//         checkout address.
//   job   the client's job page asks how the job stands. While it is unpaid, the server looks for
//         the paid Wix order; once found, the job is posted.
//   pay   the client pays for an unpaid job again (closed the checkout, card declined).
//
// Each job has a private link key. Only its SHA-256 is stored, and the client page sends the key
// with every request. Clients see their own job only, and never anyone's phone, email or last name.
//
// Where it answers: bookhbs.com once that domain points here, and Netlify test links (deploy
// previews and branch deploys of this site). Jobs from test links are marked test and accept a
// budget from $5, so a real payment can be tried for $1.50 and refunded. Production hosts of this
// site (crew.hairbysusy.com, team.hairbysusy.com) never answer.

import crypto from 'node:crypto';
import { wixReady, logActivity } from '../lib/team/wix.mjs';
import { readJob, dollars, dateLabel, timeLabel, cityNow, UNPAID_HOURS } from '../lib/book/rules.mjs';
import { insertJob, getJob, updateJob, countSince } from '../lib/book/store.mjs';
import { createCheckout, findPayment, PayError } from '../lib/book/pay.mjs';

const LIVE_HOSTS = new Set(['bookhbs.com', 'www.bookhbs.com']);
const TEST_HOST_RE = /^(deploy-preview-\d{1,5}|[a-z][a-z0-9-]{0,40})--hairbysusy-crew\.netlify\.app$/;
const MAX_BODY = 4096;
const PER_SENDER_HOUR = 6; // jobs one sender can post in an hour
const ALL_HOUR = 60; // jobs everyone together can post in an hour
const MAX_CHECKOUTS = 8; // checkouts one job can open
const ID_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;
const KEY_RE = /^[A-Za-z0-9_-]{24}$/;
const ID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

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

// Which site this request came to: { origin, test }, or null when this host doesn't take jobs.
export function siteOf(req, context) {
  let url;
  try { url = new URL(req.url); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const deployContext = context && context.deploy && context.deploy.context;
  if (LIVE_HOSTS.has(host)) {
    if (deployContext && deployContext !== 'production') return null;
    return { origin: 'https://' + host, test: false };
  }
  if (TEST_HOST_RE.test(host) && !host.startsWith('main--')) {
    if (deployContext === 'production') return null;
    return { origin: 'https://' + host, test: true };
  }
  return null;
}

// Only the HBS pages themselves may call (a browser always says where a request came from).
function fromOurPage(req, site) {
  if (req.headers.get('origin') !== site.origin) return false;
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') return false;
  if (req.headers.get('x-hbs-book') !== '1') return false;
  return (req.headers.get('content-type') || '').toLowerCase().startsWith('application/json');
}

async function readBody(req) {
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return null;
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch { return null; }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function newId() {
  const bytes = crypto.randomBytes(10);
  let id = '';
  for (const b of bytes) id += ID_CHARS[b % ID_CHARS.length];
  return id;
}

const newKey = () => crypto.randomBytes(18).toString('base64url');

// What the client's own job page may know about the job.
function viewOf(id, doc, now = Date.now()) {
  let status = doc.status;
  if (status === 'unpaid' && expired(doc, now)) status = 'expired';
  return {
    j: id,
    status,
    test: Boolean(doc.test),
    city: doc.city,
    state: doc.state,
    hood: doc.hood,
    date: doc.date,
    dateLabel: dateLabel(doc.date),
    time: doc.time,
    timeLabel: timeLabel(doc.time),
    kind: doc.kind,
    hair: doc.hair,
    count: doc.count,
    budget: doc.budget,
    fee: dollars(doc.fee_cents),
    first: (doc.client && doc.client.first) || '',
    yes: Array.isArray(doc.yes) ? doc.yes.map((y) => ({ at: y.at })) : [],
    paidAt: (doc.pay && doc.pay.paid_at) || null,
  };
}

// An unpaid job can't be paid once it's 48 hours old, or once its call time has passed.
function expired(doc, now = Date.now()) {
  if (now - Date.parse(doc.created_at) > UNPAID_HOURS * 3600000) return true;
  const here = cityNow(doc.tz, new Date(now));
  if (doc.date < here.date) return true;
  const mins = Number(doc.time.slice(0, 2)) * 60 + Number(doc.time.slice(3, 5));
  return doc.date === here.date && mins <= here.minutes;
}

// Looks for the paid Wix order; once found, the job is posted. Answers the job as it now stands
// and what Wix said: 'paid', 'pending' (an order exists, not paid yet), 'refunded' or 'none'.
async function settle(id, job) {
  const p = await findPayment(id, job.doc);
  if (p.state === 'paid') {
    const saved = await updateJob(id, (cur) => {
      if (cur.status !== 'unpaid') return null;
      return {
        ...cur,
        status: 'posted',
        pay: { ...(cur.pay || {}), paid_at: p.at, order_id: p.orderId, order_number: p.number, paid_cents: p.cents },
        log: (cur.log || []).concat({ at: new Date().toISOString(), what: 'booking fee paid, order ' + p.number }).slice(-50),
      };
    }, 'payment check');
    if (saved && saved.doc.status === 'posted' && job.doc.status === 'unpaid') {
      await logActivity('client page', 'booking fee paid', 'client/' + id, 'order ' + p.number + (job.doc.test ? ' (test)' : '')).catch(() => {});
      console.log('book: paid', id, job.doc.test ? 'test' : 'live');
    }
    return { job: saved || job, payment: 'paid' };
  }
  if (p.state === 'refunded') {
    const saved = await updateJob(id, (cur) => (cur.status === 'unpaid' ? { ...cur, status: 'refunded' } : null), 'payment check');
    return { job: saved || job, payment: 'refunded' };
  }
  return { job, payment: p.state };
}

async function openCheckout(site, id, key) {
  const { id: sessionId, url } = await createCheckout({ id, doc: (await getJob(id)).doc, key, origin: site.origin });
  const saved = await updateJob(id, (cur) => ({
    ...cur,
    pay: { ...(cur.pay || {}), sessions: ((cur.pay && cur.pay.sessions) || []).concat({ id: sessionId, at: new Date().toISOString() }) },
  }), 'client page');
  if (!saved) throw new PayError('payments_failed', 'job gone');
  return url;
}

async function postJob(req, site, context) {
  const body = await readBody(req);
  if (!body) return json(400, { error: 'form' });
  if (typeof body.website === 'string' && body.website.trim()) return json(400, { error: 'form' }); // filled by bots only
  const { job, error } = readJob(body, { test: site.test });
  if (error) return json(400, { error });

  const ip = String((context && context.ip) || req.headers.get('x-nf-client-connection-ip') || '');
  const ipHash = sha256('hbs-book|' + ip).slice(0, 32);
  const hourAgo = Date.now() - 3600000;
  if ((await countSince(hourAgo, ipHash)) >= PER_SENDER_HOUR) return json(429, { error: 'too_many' });
  if ((await countSince(hourAgo)) >= ALL_HOUR) return json(429, { error: 'busy' });

  const key = newKey();
  const now = new Date();
  const doc = {
    v: 1,
    status: 'unpaid',
    test: site.test,
    created_at: now.toISOString(),
    ...job,
    pay: { sessions: [] },
    yes: [],
    log: [{ at: now.toISOString(), what: 'posted' + (site.test ? ' from a test link' : '') }],
  };
  const meta = { keyHash: sha256(key), ipHash, createdAt: now.getTime(), test: site.test };
  let id = '';
  for (let attempt = 0; attempt < 3 && !id; attempt++) {
    const tryId = newId();
    try {
      await insertJob(tryId, doc, meta);
      id = tryId;
    } catch (e) {
      if (!(e && e.code === 'WDE0074') || attempt === 2) throw e; // WDE0074: that id is taken
    }
  }
  await logActivity('client page', 'client job posted', 'client/' + id, doc.city + (site.test ? ' (test)' : '')).catch(() => {});
  console.log('book: job saved', id, site.test ? 'test' : 'live');

  try {
    const payUrl = await openCheckout(site, id, key);
    return json(201, { j: id, k: key, payUrl });
  } catch (e) {
    const code = e instanceof PayError ? e.code : 'payments_failed';
    console.error('book: checkout failed', id, e && (e.detail || e.code || e.message));
    return json(201, { j: id, k: key, payUrl: null, payError: code });
  }
}

async function loadOwn(body) {
  const j = typeof body.j === 'string' ? body.j : '';
  const k = typeof body.k === 'string' ? body.k : '';
  if (!ID_RE.test(j) || !KEY_RE.test(k)) return null;
  const job = await getJob(j);
  if (!job || !job.meta.keyHash || !sameHash(job.meta.keyHash, sha256(k))) return null;
  return { id: j, key: k, job };
}

async function jobStatus(req) {
  const body = await readBody(req);
  if (!body) return json(400, { error: 'form' });
  const own = await loadOwn(body);
  if (!own) return json(404, { error: 'not_found' });
  let { job } = own;
  let payment = '';
  if (job.doc.status === 'unpaid') {
    try {
      ({ job, payment } = await settle(own.id, job));
    } catch (e) {
      payment = e instanceof PayError && e.code === 'payments_off' ? 'payments_off' : 'unknown';
      console.error('book: payment check failed', own.id, e && (e.detail || e.code || e.message));
    }
  }
  return json(200, { job: viewOf(own.id, job.doc), payment });
}

async function payAgain(req, site) {
  const body = await readBody(req);
  if (!body) return json(400, { error: 'form' });
  const own = await loadOwn(body);
  if (!own) return json(404, { error: 'not_found' });
  let { job } = own;
  let payment = '';
  try {
    ({ job, payment } = await settle(own.id, job));
  } catch (e) {
    if (e instanceof PayError && e.code === 'payments_off') return json(503, { error: 'payments_off' });
    // can't check right now: don't risk a second payment
    return json(503, { error: 'payments_failed' });
  }
  if (job.doc.status !== 'unpaid') return json(200, { job: viewOf(own.id, job.doc), payment });
  if (payment === 'pending') return json(409, { error: 'pending', job: viewOf(own.id, job.doc), payment });
  if (expired(job.doc)) return json(409, { error: 'expired', job: viewOf(own.id, job.doc) });
  if (((job.doc.pay && job.doc.pay.sessions) || []).length >= MAX_CHECKOUTS) return json(429, { error: 'too_many' });
  try {
    const payUrl = await openCheckout(site, own.id, own.key);
    return json(200, { payUrl });
  } catch (e) {
    const code = e instanceof PayError ? e.code : 'payments_failed';
    console.error('book: checkout failed', own.id, e && (e.detail || e.code || e.message));
    return json(503, { error: code });
  }
}

export default async (req, context) => {
  const site = siteOf(req, context);
  if (!site) return json(404, { error: 'not_found' });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  if (!fromOurPage(req, site)) return json(403, { error: 'forbidden' });
  if (!wixReady()) return json(503, { error: 'not_ready' });
  const route = new URL(req.url).pathname.replace(/\/+$/, '');
  try {
    if (route === '/api/book/jobs') return await postJob(req, site, context);
    if (route === '/api/book/job') return await jobStatus(req);
    if (route === '/api/book/pay') return await payAgain(req, site);
    return json(404, { error: 'not_found' });
  } catch (e) {
    console.error('book: failed', route, e && (e.code || e.status || e.message));
    return json(502, { error: 'failed' });
  }
};

export const config = { path: ['/api/book/jobs', '/api/book/job', '/api/book/pay'] };
