// HBS client jobs live in Susy's Wix site, in the "HBS: Client jobs" CMS collection (HbsClientJobs),
// which only site admins can open. Same Wix key and same approach as the team app (../team/wix.mjs).
//
// Each item: title and status (readable in the Wix CMS), json (the whole job), rev (for safe
// concurrent saves), keyHash (SHA-256 of the client's private link key; the key itself is never
// stored), ipHash (for the posting limit), createdAt (ms) and test (posted from a test link).

import { wixRequest, WixError } from '../team/wix.mjs';
import { dateLabel } from './rules.mjs';

export const COLLECTION = 'HbsClientJobs';

const titleOf = (doc) => [dateLabel(doc.date), doc.city, doc.hood, doc.kind, doc.test ? 'TEST' : '']
  .filter(Boolean).join(' · ').slice(0, 200);

function itemData(doc, meta, rev, by) {
  return {
    title: titleOf(doc),
    status: String(doc.status || '').slice(0, 40),
    json: JSON.stringify(doc),
    rev,
    updatedBy: String(by || '').slice(0, 120),
    keyHash: meta.keyHash,
    ipHash: meta.ipHash,
    createdAt: meta.createdAt,
    test: Boolean(meta.test),
  };
}

function toJob(item) {
  const d = (item && item.data) || {};
  let doc = null;
  try { doc = JSON.parse(d.json || 'null'); } catch { doc = null; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  return {
    id: item.id || d._id,
    rev: Number(d.rev) || 0,
    doc,
    meta: { keyHash: String(d.keyHash || ''), ipHash: String(d.ipHash || ''), createdAt: Number(d.createdAt) || 0, test: Boolean(d.test) },
  };
}

export async function insertJob(id, doc, meta) {
  await wixRequest('POST', '/wix-data/v2/items', {
    body: { dataCollectionId: COLLECTION, dataItem: { id, data: itemData(doc, meta, 1, 'client') } },
  });
}

export async function getJob(id) {
  const r = await wixRequest('POST', '/data/v2/items/query', {
    body: { dataCollectionId: COLLECTION, query: { filter: { _id: id }, paging: { limit: 1, offset: 0 } }, consistentRead: true },
  });
  const item = (r.dataItems || [])[0];
  return item ? toJob(item) : null;
}

// Saves a change without overwriting one made at the same moment: the write only lands if the
// revision is still the one read; otherwise it reads again and re-applies. makeDoc returns the new
// doc, or null to leave the job as it is.
export async function updateJob(id, makeDoc, by) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await getJob(id);
    if (!cur) return null;
    const next = makeDoc(cur.doc);
    if (next === null) return cur;
    try {
      await wixRequest('PUT', '/data/v2/items/' + encodeURIComponent(id), {
        body: {
          dataCollectionId: COLLECTION,
          dataItem: { id, data: itemData(next, cur.meta, cur.rev + 1, by) },
          condition: { filter: { rev: cur.rev } },
        },
      });
      return { ...cur, rev: cur.rev + 1, doc: next };
    } catch (e) {
      const raced = e instanceof WixError && (e.code === 'WDE0193' || e.code === 'WDE0074' || e.code === 'WDE0073');
      if (!raced) throw e;
      await new Promise((r) => setTimeout(r, 60 + Math.random() * 140));
    }
  }
  const e = new Error('busy'); e.code = 'busy'; throw e;
}

// How many jobs were posted since `since` (ms): from one sender, or from everyone.
export async function countSince(since, ipHash) {
  const filter = ipHash ? { $and: [{ ipHash }, { createdAt: { $gt: since } }] } : { createdAt: { $gt: since } };
  const r = await wixRequest('POST', '/data/v2/items/query', {
    body: { dataCollectionId: COLLECTION, query: { filter, paging: { limit: 100, offset: 0 } }, consistentRead: true },
  });
  return (r.dataItems || []).length;
}
