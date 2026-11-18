// Runs by itself every time someone sends the crew form (Netlify's "submission-created" event).
// Netlify only calls it for real applications, never for ones it flagged as spam.
// It does three separate jobs, so one failing never stops the others:
//   1. Puts the full application in the team app's private inbox (a Wix CMS collection only
//      site admins can open). The team app at team.hairbysusy.com moves it into Review.
//   2. Adds the applicant to Contacts in Susy's Wix site, tagged "Crew" and "Crew: To review",
//      plus a "Crew: <city>" tag for each location.
//   3. Texts Susy and Victor through Sent so they know right away.
//
// Netlify environment variables (Project configuration > Environment variables):
//   WIX_API_KEY             a Wix API key with Contacts permissions. Secret: paste it in Netlify yourself.
//   WIX_SITE_ID             optional: the Hair By Susy site id is built in below (it isn't secret)
//   SENT_API_KEY            the key from the Sent dashboard. Secret: paste it in Netlify yourself.
//   SENT_ALERT_TEMPLATE_ID  the id of the approved "new application" template in Sent
//   ALERT_TO                who gets the text, in +country format, separated by commas
// Each job switches on only when its variables are set. The application is saved in Netlify either way.

import { randomBytes } from 'node:crypto';
import { addToInbox } from '../lib/team/wix.mjs';

const clean = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f<>{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

// Tag keys in Susy's Wix site (created Nov 17, 2026). These are ids, not secrets.
const TAG = {
  crew: 'custom.crew-Q0l69',
  review: 'custom.crew-to-review-W5bBx',
  approved: 'custom.crew-approved-b6kAa',
  declined: 'custom.crew-declined-T4HJG',
  later: 'custom.crew-reach-out-later-KprOe',
  removed: 'custom.crew-removed-jiJ2a',
  again: 'custom.crew-applied-again-r2qnh',
};
const FIELD = {
  instagram: 'custom.crew-instagram-ofnvvnythbjzltckrfbw',
  specialties: 'custom.crew-specialties-lwelwdzeaqxbpoijfl',
  role: 'custom.crew-role-vbfqqsoungotmexvlllxoicrg',
};
const STATUS_TAGS = [TAG.review, TAG.approved, TAG.declined, TAG.later, TAG.removed];
const SITE_ID = process.env.WIX_SITE_ID || '245486a5-efc7-4e35-b583-f9b546f02080'; // Hair By Susy

async function wixCall(method, path, body) {
  const res = await fetch('https://www.wixapis.com' + path, {
    method,
    headers: {
      Authorization: process.env.WIX_API_KEY,
      'wix-site-id': SITE_ID,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  return { status: res.status, data };
}

function phoneOf(raw) {
  const p = clean(raw, 30);
  const digits = p.replace(/\D/g, '');
  if (p.startsWith('+')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return p;
}

const fit200 = (v) => (v.length <= 200 ? v : v.slice(0, 200).replace(/,[^,]*$/, ''));

async function addToWix(d) {
  if (!process.env.WIX_API_KEY) {
    console.log('crew wix: not set up yet');
    return;
  }
  const name = clean(d.name, 80) || 'Crew applicant';
  const parts = name.split(' ');
  const email = clean(d.email, 120);
  const phone = phoneOf(d.phone);
  const places = clean(d.locations || d.city, 400)
    .split(';').map((s) => clean(s, 40)).filter(Boolean).slice(0, 10);

  // One "Crew: <city>" tag per location; creates the tag the first time a city shows up.
  const placeTags = (await Promise.allSettled(
    places.map((place) => wixCall('POST', '/contacts/v4/labels', { displayName: 'Crew: ' + place })),
  )).map((r) => (r.status === 'fulfilled' && r.value.data.label ? r.value.data.label.key : null)).filter(Boolean);

  const info = {
    name: { first: parts[0], last: parts.slice(1).join(' ') },
    jobTitle: 'Crew: ' + (clean(d.role, 20) || 'applicant'),
    labelKeys: { items: [TAG.crew, TAG.review] },
    extendedFields: {
      items: {
        [FIELD.instagram]: clean(d.instagram, 60),
        [FIELD.specialties]: fit200(clean(d.specialties, 400)), // Wix allows 200 characters
        [FIELD.role]: clean(d.role, 20),
      },
    },
  };
  if (email) info.emails = { items: [{ tag: 'MAIN', email }] };
  if (phone) info.phones = { items: [{ tag: 'MOBILE', phone }] };

  let contactId = null;
  let add = [];
  const created = await wixCall('POST', '/contacts/v4/contacts', { info });
  if (created.status === 200 && created.data.contact) {
    contactId = created.data.contact.id;
  } else if (created.status === 409) {
    // Already a Wix contact (a past client, or someone who applied before).
    const dup = (((created.data.details || {}).applicationError || {}).data || {}).duplicateContactId;
    if (dup) {
      contactId = dup;
      const got = await wixCall('GET', '/contacts/v4/contacts/' + dup);
      const tags = (((got.data.contact || {}).info || {}).labelKeys || {}).items || [];
      const hasStatus = tags.some((t) => STATUS_TAGS.includes(t));
      // Declined, removed or already on the team: keep their status and mark that they applied again.
      add = hasStatus ? [TAG.crew, TAG.again] : [TAG.crew, TAG.review];
    }
  } else {
    console.log('crew wix: could not add contact (' + created.status + ')');
    return;
  }
  add = add.concat(placeTags);
  if (contactId && add.length) {
    const tagged = await wixCall('POST', '/contacts/v4/contacts/' + contactId + '/labels', { labelKeys: add });
    if (tagged.status !== 200) console.log('crew wix: could not tag contact (' + tagged.status + ')');
  }
  console.log('crew wix: added');
}

// The form's own fields, as typed (the team app escapes everything it shows).
const FORM_FIELDS = ['name', 'phone', 'email', 'instagram', 'portfolio', 'locations', 'role', 'specialties',
  'response_time', 'description', 'sms_consent', 'commitment'];

async function addToTeamInbox(payload, d) {
  if (!process.env.WIX_API_KEY) {
    console.log('crew inbox: WIX_API_KEY is not set yet');
    return;
  }
  const fields = {};
  for (const k of FORM_FIELDS) {
    const v = d[k];
    if (v === undefined || v === null) continue;
    fields[k] = String(Array.isArray(v) ? v.join(', ') : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').slice(0, 4000);
  }
  const at = new Date(payload.created_at || Date.now());
  fields.created_at = isNaN(at) ? new Date().toISOString() : at.toISOString();
  const sid = String(payload.id || '');
  const id = /^[A-Za-z0-9_-]{8,60}$/.test(sid) ? 'a' + sid : 'a' + randomBytes(12).toString('hex');
  try {
    await addToInbox(id, clean(d.name, 120) || 'Applicant', fields, fields.created_at);
    console.log('crew inbox: added');
  } catch (e) {
    // Netlify can call this twice for one application; the second copy is refused by id.
    if (e && e.code === 'WDE0074') console.log('crew inbox: already there');
    else console.log('crew inbox: failed (' + ((e && (e.code || e.status)) || 'error') + ')');
  }
}

async function textAlert(payload, d) {
  const { SENT_API_KEY, SENT_ALERT_TEMPLATE_ID, ALERT_TO } = process.env;
  if (!SENT_API_KEY || !SENT_ALERT_TEMPLATE_ID || !ALERT_TO) {
    console.log('crew alert: texting is not set up yet');
    return;
  }
  const to = ALERT_TO.split(',').map((n) => n.trim()).filter((n) => /^\+\d{8,15}$/.test(n));
  if (!to.length) {
    console.log('crew alert: ALERT_TO has no valid numbers');
    return;
  }
  const request = {
    to,
    template: {
      id: SENT_ALERT_TEMPLATE_ID,
      parameters: {
        name: clean(d.name, 40) || 'Someone',
        locations: clean(d.locations || d.city, 60) || 'no location given',
        role: clean(d.role, 20) || 'role not given',
      },
    },
    channel: ['sms', 'whatsapp'],
  };
  const res = await fetch('https://api.sent.dm/v3/messages', {
    method: 'POST',
    headers: {
      'x-api-key': SENT_API_KEY,
      'Content-Type': 'application/json',
      // Same application never texts twice, even if Netlify retries.
      'Idempotency-Key': 'crew-application-' + (clean(payload.id, 64) || crypto.randomUUID()),
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) console.log('crew alert: Sent answered ' + res.status);
}

export async function handler(event) {
  let payload;
  try {
    payload = JSON.parse(event.body || '{}').payload || {};
  } catch {
    return { statusCode: 200 };
  }
  if (payload.form_name !== 'crew') return { statusCode: 200 };
  const d = payload.data || {};

  const results = await Promise.allSettled([addToTeamInbox(payload, d), addToWix(d), textAlert(payload, d)]);
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.log(['crew inbox', 'crew wix', 'crew alert'][i] + ': failed');
  });
  return { statusCode: 200 };
}
