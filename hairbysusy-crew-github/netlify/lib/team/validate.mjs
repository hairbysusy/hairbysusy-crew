// What the app may store. Anything outside these limits is refused before it reaches Wix.

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,79}$/;
const BANNED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 8;
const MAX_STRING = 20000;
const MAX_ENTRIES = 1000;
export const MAX_DOC_BYTES = 200 * 1024;

export class Invalid extends Error {
  constructor(why) { super('invalid'); this.why = why; }
}

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

// Returns a clean copy built only from allowed values; throws Invalid otherwise.
export function cleanValue(v, depth = 0) {
  if (depth > MAX_DEPTH) throw new Invalid('too deep');
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Invalid('bad number'); return v; }
  if (typeof v === 'string') { if (v.length > MAX_STRING) throw new Invalid('text too long'); return v; }
  if (Array.isArray(v)) {
    if (v.length > MAX_ENTRIES) throw new Invalid('list too long');
    return v.map((x) => cleanValue(x, depth + 1));
  }
  if (isPlainObject(v)) {
    const keys = Object.keys(v);
    if (keys.length > MAX_ENTRIES) throw new Invalid('too many fields');
    const out = {};
    for (const k of keys) {
      if (BANNED_KEYS.has(k) || !KEY_RE.test(k)) throw new Invalid('bad field name');
      out[k] = cleanValue(v[k], depth + 1);
    }
    return out;
  }
  throw new Invalid('bad value');
}

export function cleanDoc(v) {
  if (!isPlainObject(v)) throw new Invalid('not a record');
  const doc = cleanValue(v);
  delete doc.id; // the id lives outside the record
  return doc;
}

// Nested objects merge field by field; everything else (text, numbers, lists) is replaced.
export function deepMerge(target, patch) {
  const out = isPlainObject(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

export function checkSize(doc) {
  if (Buffer.byteLength(JSON.stringify(doc)) > MAX_DOC_BYTES) throw new Invalid('record too large');
  return doc;
}
