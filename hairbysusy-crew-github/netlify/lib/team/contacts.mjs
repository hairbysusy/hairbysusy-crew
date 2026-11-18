// Keeps Wix Contacts in step with the crew list. The app can only ask for these eight things,
// each checked here, and gets back only the fields it needs. It cannot list Susy's other
// contacts (her clients), delete anyone, or reach any other part of her Wix site.

import { wixRequest } from './wix.mjs';
import { Invalid } from './validate.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LABEL_RE = /^custom\.[A-Za-z0-9._-]{1,100}$/;
export const CREW_LABEL = 'custom.crew-Q0l69';
const FIELDS = new Set([
  'custom.crew-instagram-ofnvvnythbjzltckrfbw',
  'custom.crew-specialties-lwelwdzeaqxbpoijfl',
  'custom.crew-role-vbfqqsoungotmexvlllxoicrg',
]);

// Text from the public form goes to Wix tidied: no control characters or angle brackets.
const text = (v, max, why) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > 4000) throw new Invalid(why);
  return v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
};
const contactId = (v) => { if (typeof v !== 'string' || !UUID_RE.test(v)) throw new Invalid('bad contact id'); return v; };
const labelKeys = (v) => {
  if (!Array.isArray(v) || !v.length || v.length > 20 || !v.every((k) => typeof k === 'string' && LABEL_RE.test(k))) throw new Invalid('bad tags');
  return v;
};
const tagsOnly = (c) => ({ id: c.id, info: { labelKeys: { items: (((c.info || {}).labelKeys || {}).items || []).filter((k) => typeof k === 'string') } } });

function crewContact(c) {
  const info = c.info || {};
  const ext = (info.extendedFields || {}).items || {};
  const keptExt = {};
  for (const k of FIELDS) if (typeof ext[k] === 'string') keptExt[k] = ext[k];
  return {
    id: c.id,
    createdDate: c.createdDate,
    primaryInfo: { email: (c.primaryInfo || {}).email || '' },
    info: {
      name: { first: (info.name || {}).first || '', last: (info.name || {}).last || '' },
      phones: { items: ((info.phones || {}).items || []).map((p) => ({ e164Phone: p.e164Phone || '', primary: p.primary === true })) },
      extendedFields: { items: keptExt },
      labelKeys: { items: ((info.labelKeys || {}).items || []).filter((k) => typeof k === 'string') },
    },
  };
}

export async function contactsOp(req) {
  if (!req || typeof req !== 'object') throw new Invalid('bad request');
  switch (req.op) {
    case 'labels': {
      const r = await wixRequest('POST', '/contacts/v4/labels/query', { body: { query: { filter: { namespace: 'custom' } } } });
      return { labels: (r.labels || []).map((l) => ({ key: l.key, displayName: l.displayName })) };
    }
    case 'label_create': {
      const name = text(req.displayName, 80, 'bad tag name');
      if (!/^Crew: \S/.test(name)) throw new Invalid('bad tag name');
      const r = await wixRequest('POST', '/contacts/v4/labels', { body: { displayName: name } });
      return { label: r.label ? { key: r.label.key, displayName: r.label.displayName } : null };
    }
    case 'tags': {
      const r = await wixRequest('GET', '/contacts/v4/contacts/' + contactId(req.id));
      return { contact: r.contact ? tagsOnly(r.contact) : null };
    }
    case 'find': {
      const f = req.filter || {};
      const keys = Object.keys(f);
      let filter;
      if (keys.length === 1 && keys[0] === 'email.email') filter = { 'email.email': text(f['email.email'], 254, 'bad email') };
      else if (keys.length === 1 && keys[0] === 'phone.phone' && /^\+\d{7,15}$/.test(String(f['phone.phone']))) filter = { 'phone.phone': f['phone.phone'] };
      else throw new Invalid('bad search');
      const r = await wixRequest('POST', '/contacts/v5/contacts/search', { body: { search: { filter, cursorPaging: { limit: 2 } } } });
      return { contacts: (r.contacts || []).map((c) => ({ id: c.id })) };
    }
    case 'create': {
      const i = req.info || {};
      const info = {
        name: { first: text((i.name || {}).first, 100, 'bad name'), last: text((i.name || {}).last, 100, 'bad name') },
        jobTitle: text(i.jobTitle, 100, 'bad role'),
        labelKeys: { items: labelKeys(((i.labelKeys || {}).items) || []) },
        extendedFields: { items: {} },
      };
      if (!info.name.first || !/^Crew: /.test(info.jobTitle)) throw new Invalid('bad contact');
      const ext = ((i.extendedFields || {}).items) || {};
      for (const [k, v] of Object.entries(ext)) {
        if (!FIELDS.has(k)) throw new Invalid('bad field');
        // Wix keeps at most 200 characters in these fields; longer lists are cut at a comma.
        const t = text(v, 4000, 'bad field');
        info.extendedFields.items[k] = t.length <= 200 ? t : t.slice(0, 200).replace(/,[^,]*$/, '');
      }
      const email = (((i.emails || {}).items || [])[0] || {}).email;
      if (email) info.emails = { items: [{ tag: 'MAIN', email: text(email, 254, 'bad email') }] };
      const phone = (((i.phones || {}).items || [])[0] || {}).phone;
      if (phone) {
        if (!/^\+\d{7,15}$/.test(String(phone))) throw new Invalid('bad phone');
        info.phones = { items: [{ tag: 'MOBILE', phone }] };
      }
      const r = await wixRequest('POST', '/contacts/v4/contacts', { body: { info } });
      return { contact: r.contact ? tagsOnly(r.contact) : null };
    }
    case 'label_add': {
      await wixRequest('POST', '/contacts/v4/contacts/' + contactId(req.id) + '/labels', { body: { labelKeys: labelKeys(req.labelKeys) } });
      return {};
    }
    case 'label_remove': {
      const keys = labelKeys(req.labelKeys);
      const q = new URLSearchParams();
      keys.forEach((k) => q.append('labelKeys', k));
      await wixRequest('DELETE', '/contacts/v4/contacts/' + contactId(req.id) + '/labels', { query: q, body: { labelKeys: keys } });
      return {};
    }
    case 'crew': {
      const body = { query: { filter: { 'info.labelKeys': { $hasSome: [CREW_LABEL] } }, sort: [{ fieldName: 'createdDate', order: 'ASC' }], paging: { limit: 1000, offset: 0 } } };
      const r = await wixRequest('POST', '/contacts/v4/contacts/query', { body });
      return { contacts: (r.contacts || []).map(crewContact) };
    }
    default:
      throw new Invalid('unknown request');
  }
}
