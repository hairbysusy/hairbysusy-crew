// Client voice notes. While posting a job, a client can explain it by voice (up to a minute). Only
// the HBS team hears it, in the team app; stylists never do. Each note lives in Susy's Wix site, in
// the CMS collection "HBS: Voice notes" (HbsVoiceNotes), which only site admins can open. A note is
// split into parts small enough for one CMS item each (Wix items must stay under 500 KB).
//
// Each part: title (job id and part number, readable in the Wix CMS), job (the job id), stamp (one
// upload; a newer note for the same job gets a new stamp), part and parts, type and secs, data (this
// part of the note, base64), createdAt (ms) and test (posted from a test link). A part's id is
// job-stamp-part, so two uploads never write over each other; the job record says which stamp is
// current, and the parts of the note it replaced are removed.

import crypto from 'node:crypto';
import { wixRequest, WixError } from '../team/wix.mjs';

export const VOICE_COLLECTION = 'HbsVoiceNotes';
export const VOICE_MAX_SECS = 60;
export const VOICE_MAX_BYTES = 1_200_000; // about a minute of speech, whichever format the phone records
export const VOICE_MAX_BODY = Math.ceil(VOICE_MAX_BYTES / 3) * 4 + 2048; // the base64 note plus the rest of the request
const VOICE_MIN_BYTES = 800;
const PART_CHARS = 240_000;
const MAX_PARTS = Math.ceil(Math.ceil(VOICE_MAX_BYTES / 3) * 4 / PART_CHARS);
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const STAMP_RE = /^[a-f0-9]{16}$/;

// The formats phones and browsers record, and the first bytes of each, so nothing else gets in.
const FORMATS = {
  'audio/webm': (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  'audio/ogg': (b) => b.subarray(0, 4).toString('latin1') === 'OggS',
  'audio/mp4': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp',
  'audio/aac': (b) => b[0] === 0xff && (b[1] & 0xf6) === 0xf0,
  'audio/mpeg': (b) => b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
};
const ALIASES = { 'audio/x-m4a': 'audio/mp4', 'audio/m4a': 'audio/mp4', 'video/mp4': 'audio/mp4', 'video/webm': 'audio/webm', 'audio/mp3': 'audio/mpeg' };

const partId = (jobId, stamp, n) => jobId + '-' + stamp + '-' + n;

// Reads a voice note sent by the posting page: { type, secs, bytes } or { error }.
export function readVoice(body) {
  let type = typeof body.type === 'string' ? body.type.split(';')[0].trim().toLowerCase() : '';
  type = ALIASES[type] || type;
  if (!FORMATS[type]) return { error: 'voice_type' };
  const secs = Math.round(Number(body.secs));
  if (!Number.isFinite(secs) || secs < 1 || secs > VOICE_MAX_SECS + 2) return { error: 'voice_length' };
  const data = typeof body.data === 'string' ? body.data : '';
  if (!data || data.length > VOICE_MAX_BODY || data.length % 4 !== 0 || !B64_RE.test(data)) return { error: 'voice_data' };
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length < VOICE_MIN_BYTES || bytes.length > VOICE_MAX_BYTES) return { error: 'voice_size' };
  if (!FORMATS[type](bytes)) return { error: 'voice_type' };
  return { type, secs: Math.min(secs, VOICE_MAX_SECS), bytes };
}

async function removePart(id) {
  const q = new URLSearchParams({ dataCollectionId: VOICE_COLLECTION });
  try {
    await wixRequest('DELETE', '/data/v2/items/' + encodeURIComponent(id), { query: q });
  } catch (e) {
    if (!(e instanceof WixError && e.code === 'WDE0073')) throw e; // already gone
  }
}

// Saves a note for a job. Answers what the job keeps about it: { stamp, parts, type, secs, bytes, at }.
// If any part fails to save, the parts that did are removed and the error is thrown.
export async function saveVoice(jobId, note, { test = false } = {}) {
  const data = note.bytes.toString('base64');
  const parts = Math.max(1, Math.ceil(data.length / PART_CHARS));
  const stamp = crypto.randomBytes(8).toString('hex');
  const at = new Date().toISOString();
  const createdAt = Date.now();
  const ids = Array.from({ length: parts }, (_, i) => partId(jobId, stamp, i + 1));
  const results = await Promise.allSettled(ids.map((id, i) => wixRequest('POST', '/wix-data/v2/items', {
    body: {
      dataCollectionId: VOICE_COLLECTION,
      dataItem: {
        id,
        data: {
          title: jobId + ' · voice note' + (parts > 1 ? ' · part ' + (i + 1) + ' of ' + parts : '') + (test ? ' · TEST' : ''),
          job: jobId, stamp, part: i + 1, parts, type: note.type, secs: note.secs,
          data: data.slice(i * PART_CHARS, (i + 1) * PART_CHARS), createdAt, test: Boolean(test),
        },
      },
    },
  })));
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) {
    await Promise.allSettled(ids.filter((_, i) => results[i].status === 'fulfilled').map(removePart));
    throw failed.reason;
  }
  return { stamp, parts, type: note.type, secs: note.secs, bytes: note.bytes.length, at };
}

// How many notes everyone has sent since `since` (ms). A note replaced by a newer one is gone, so
// it isn't counted. Only each note's first part is read, and only one field of it.
export async function countVoiceSince(since) {
  const r = await wixRequest('POST', '/data/v2/items/query', {
    body: {
      dataCollectionId: VOICE_COLLECTION,
      query: { filter: { $and: [{ part: 1 }, { createdAt: { $gt: since } }] }, fields: ['part'], paging: { limit: 100, offset: 0 } },
      consistentRead: true,
    },
  });
  return (r.dataItems || []).length;
}

// Removes a note's parts (the one a newer note replaced, or one that never reached the job record).
export async function dropVoice(jobId, voice) {
  if (!voice || !STAMP_RE.test(String(voice.stamp || '')) || !(voice.parts >= 1 && voice.parts <= MAX_PARTS)) return;
  await Promise.allSettled(Array.from({ length: voice.parts }, (_, i) => removePart(partId(jobId, voice.stamp, i + 1))));
}

// The whole note for a job, as the job record describes it: { type, secs, data (base64) }, or null.
export async function getVoice(jobId, voice) {
  if (!voice || !STAMP_RE.test(String(voice.stamp || '')) || !(voice.parts >= 1 && voice.parts <= MAX_PARTS)) return null;
  const found = await Promise.all(Array.from({ length: voice.parts }, async (_, i) => {
    const r = await wixRequest('POST', '/data/v2/items/query', {
      body: {
        dataCollectionId: VOICE_COLLECTION,
        query: { filter: { _id: partId(jobId, voice.stamp, i + 1) }, paging: { limit: 1, offset: 0 } },
        consistentRead: true,
      },
    });
    const d = ((r.dataItems || [])[0] || {}).data || {};
    const ok = d.job === jobId && d.stamp === voice.stamp && Number(d.part) === i + 1 && typeof d.data === 'string';
    return ok ? d.data : null;
  }));
  if (found.some((p) => p === null)) return null; // a part is missing: better nothing than half a note
  return { type: String(voice.type || 'audio/webm'), secs: Number(voice.secs) || 0, data: found.join('') };
}
