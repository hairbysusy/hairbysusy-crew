// Runs by itself every time someone sends the crew form (Netlify's "submission-created" event).
// Netlify only calls it for real applications, never for ones it flagged as spam.
// It texts Susy and Victor through Sent so they know right away.
//
// Netlify environment variables it needs (Project configuration > Environment variables):
//   SENT_API_KEY            the key from the Sent dashboard. Secret: paste it in Netlify yourself.
//   SENT_ALERT_TEMPLATE_ID  the id of the approved "new application" template in Sent
//   ALERT_TO                who gets the text, in +country format, separated by commas,
//                           e.g. +13105550100,+2348030000000
// Until all three are set it does nothing, and the application is saved as normal either way.

const clean = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f<>{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export async function handler(event) {
  let payload;
  try {
    payload = JSON.parse(event.body || '{}').payload || {};
  } catch {
    return { statusCode: 200 };
  }
  if (payload.form_name !== 'crew') return { statusCode: 200 };

  const { SENT_API_KEY, SENT_ALERT_TEMPLATE_ID, ALERT_TO } = process.env;
  if (!SENT_API_KEY || !SENT_ALERT_TEMPLATE_ID || !ALERT_TO) {
    console.log('crew alert: texting is not set up yet');
    return { statusCode: 200 };
  }

  const to = ALERT_TO.split(',').map((n) => n.trim()).filter((n) => /^\+\d{8,15}$/.test(n));
  if (!to.length) {
    console.log('crew alert: ALERT_TO has no valid numbers');
    return { statusCode: 200 };
  }

  const d = payload.data || {};
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

  try {
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
  } catch {
    console.log('crew alert: could not reach Sent');
  }
  return { statusCode: 200 };
}
