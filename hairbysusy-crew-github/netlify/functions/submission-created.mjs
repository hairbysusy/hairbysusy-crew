// Runs by itself every time someone sends the crew form (Netlify's "submission-created" event).
// Netlify only calls it for real applications, never for ones it flagged as spam.
// It does two separate jobs, so one failing never stops the other:
//   1. Adds the applicant to Contacts in Susy's Wix site, tagged "Crew" and "Crew: To review",
//      plus a "Crew: <city>" tag for each location. Susy's Crew picks them up from there.
//   2. Texts Susy and Victor through Sent so they know right away.
//
// Netlify environment variables (Project configuration > Environment variables):
//   WIX_API_KEY             a Wix API key with Contacts permissions. Secret: paste it in Netlify yourself.
//   WIX_SITE_ID             the Hair By Susy site id (not secret)
//   SENT_API_KEY            the key from the Sent dashboard. Secret: paste it in Netlify yourself.
//   SENT_ALERT_TEMPLATE_ID  the id of the approved "new application" template in Sent
//   ALERT_TO                who gets the text, in +country format, separated by commas
// Each job switches on only when its variables are set. The application is saved in Netlify either way.

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

async function wixCall(method, path, body) {
  const res = await fetch('https://www.wixapis.com' + path, {
    method,
    headers: {
      Authorization: process.env.WIX_API_KEY,
      'wix-site-id': process.env.WIX_SITE_ID,
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

async function addToWix(d) {
  const { WIX_API_KEY, WIX_SITE_ID } = process.env;
  if (!WIX_API_KEY || !WIX_SITE_ID) {
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
        [FIELD.specialties]: clean(d.specialties, 400),
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

  const results = await Promise.allSettled([addToWix(d), textAlert(payload, d)]);
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.log((i === 0 ? 'crew wix' : 'crew alert') + ': failed');
  });
  return { statusCode: 200 };
}
