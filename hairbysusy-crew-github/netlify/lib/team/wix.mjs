// Everything the team app keeps lives in Susy's Wix site, in CMS collections that only
// site admins can open, plus her Wix Contacts. This file is the only code that talks to Wix.
// It uses the WIX_API_KEY Netlify variable; the key never reaches a browser.

import { env, WIX_SITE_ID_DEFAULT, COLLECTIONS } from './config.mjs';

const BASE = 'https://www.wixapis.com';

export class WixError extends Error {
  constructor(status, text) {
    super('wix_' + status);
    this.status = status;
    this.text = String(text || '').slice(0, 2000);
    let code = '';
    try { code = JSON.parse(this.text)?.details?.applicationError?.code || ''; } catch { /* not JSON */ }
    this.code = code;
  }
}

export const wixReady = () => Boolean(env('WIX_API_KEY'));

export async function wixRequest(method, path, { body, query, timeout = 8000 } = {}) {
  const key = env('WIX_API_KEY');
  if (!key) { const e = new Error('wix_not_set'); e.code = 'wix_not_set'; throw e; }
  let url = BASE + path;
  if (query) url += '?' + query.toString();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: key,
      'wix-site-id': env('WIX_SITE_ID') || WIX_SITE_ID_DEFAULT,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  if (!res.ok) throw new WixError(res.status, text);
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

/* ---------------- stored records (crew, jobs) ---------------- */

const titleOf = (col, doc) => String(
  col === 'crew' ? doc.name || '' : [doc.date, doc.city, doc.details || doc.title || ''].filter(Boolean).join(' · '),
).slice(0, 200);
const statusOf = (doc) => String(doc.status || '').slice(0, 40);

function toRecord(item) {
  const d = item.data || {};
  let doc = {};
  try { doc = JSON.parse(d.json || '{}'); } catch { doc = {}; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) doc = {};
  return { id: item.id || d._id, rev: Number(d.rev) || 0, doc };
}

export async function listRecords(colKey) {
  const out = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const r = await wixRequest('POST', '/data/v2/items/query', {
      body: { dataCollectionId: COLLECTIONS[colKey], query: { paging: { limit: 1000, offset } }, consistentRead: true },
    });
    for (const item of r.dataItems || []) out.push(colKey === 'inbox' ? item : toRecord(item));
    if (!(r.pagingMetadata && r.pagingMetadata.hasNext)) break;
  }
  return out;
}

export async function getRecord(colKey, id) {
  const r = await wixRequest('POST', '/data/v2/items/query', {
    body: { dataCollectionId: COLLECTIONS[colKey], query: { filter: { _id: id }, paging: { limit: 1, offset: 0 } }, consistentRead: true },
  });
  const item = (r.dataItems || [])[0];
  return item ? toRecord(item) : null;
}

function itemData(colKey, doc, rev, email) {
  return { title: titleOf(colKey, doc), status: statusOf(doc), json: JSON.stringify(doc), rev, updatedBy: email };
}

async function insertRecord(colKey, id, doc, email) {
  await wixRequest('POST', '/wix-data/v2/items', {
    body: { dataCollectionId: COLLECTIONS[colKey], dataItem: { id, data: itemData(colKey, doc, 1, email) } },
  });
}

async function replaceIfUnchanged(colKey, id, doc, rev, email) {
  await wixRequest('PUT', '/data/v2/items/' + encodeURIComponent(id), {
    body: {
      dataCollectionId: COLLECTIONS[colKey],
      dataItem: { id, data: itemData(colKey, doc, rev + 1, email) },
      condition: { filter: { rev } },
    },
  });
}

// Two people saving at the same moment never overwrite each other: every write checks the
// revision it read, and if someone else saved in between, it reads again and re-applies.
export async function writeRecord(colKey, id, makeDoc, email) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await getRecord(colKey, id);
    const next = makeDoc(current ? current.doc : null);
    if (next === null) { const e = new Error('not_found'); e.code = 'not_found'; throw e; }
    try {
      if (current) await replaceIfUnchanged(colKey, id, next, current.rev, email);
      else await insertRecord(colKey, id, next, email);
      return next;
    } catch (e) {
      const raced = e instanceof WixError && (e.code === 'WDE0193' || e.code === 'WDE0074' || e.code === 'WDE0073');
      if (!raced) throw e;
      await new Promise((r) => setTimeout(r, 60 + Math.random() * 140));
    }
  }
  const e = new Error('busy'); e.code = 'busy'; throw e;
}

export async function removeRecord(colKey, id) {
  const q = new URLSearchParams({ dataCollectionId: COLLECTIONS[colKey] });
  try {
    await wixRequest('DELETE', '/data/v2/items/' + encodeURIComponent(id), { query: q });
  } catch (e) {
    if (!(e instanceof WixError && e.code === 'WDE0073')) throw e; // already gone
  }
}

/* ---------------- new applications from the sign-up form ---------------- */

export async function addToInbox(id, title, fields, receivedAt) {
  await wixRequest('POST', '/wix-data/v2/items', {
    body: {
      dataCollectionId: COLLECTIONS.inbox,
      dataItem: { id, data: { title: String(title).slice(0, 200), json: JSON.stringify(fields), receivedAt } },
    },
  });
}

/* ---------------- sign-in sessions ---------------- */

export async function insertSession(idHash, email, expires, device) {
  await wixRequest('POST', '/wix-data/v2/items', {
    body: {
      dataCollectionId: COLLECTIONS.sessions,
      dataItem: { id: idHash, data: { email, expires, createdAt: new Date().toISOString(), device: String(device || '').slice(0, 160) } },
    },
  });
}

export async function findSession(idHash) {
  const r = await wixRequest('POST', '/data/v2/items/query', {
    body: { dataCollectionId: COLLECTIONS.sessions, query: { filter: { _id: idHash }, paging: { limit: 1, offset: 0 } }, consistentRead: true },
  });
  const d = ((r.dataItems || [])[0] || {}).data;
  return d ? { email: String(d.email || ''), expires: Number(d.expires) || 0 } : null;
}

export async function deleteSession(idHash) { await removeRecord('sessions', idHash); }

export async function deleteExpiredSessions() {
  const r = await wixRequest('POST', '/data/v2/items/query', {
    body: { dataCollectionId: COLLECTIONS.sessions, query: { filter: { expires: { $lt: Date.now() } }, paging: { limit: 50, offset: 0 } } },
  });
  for (const item of r.dataItems || []) await removeRecord('sessions', item.id);
}

/* ---------------- activity log ---------------- */

export async function logActivity(email, action, target, detail) {
  const at = new Date().toISOString();
  await wixRequest('POST', '/wix-data/v2/items', {
    body: {
      dataCollectionId: COLLECTIONS.log,
      dataItem: { data: { at, email: String(email || '').slice(0, 254), action: String(action).slice(0, 60), target: String(target || '').slice(0, 120), detail: String(detail || '').slice(0, 300) } },
    },
  });
}
