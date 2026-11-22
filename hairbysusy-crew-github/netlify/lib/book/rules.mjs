// HBS client jobs (bookhbs.com): the rules a posted job must meet, and the booking fee.
// The posting page (site/book/post.js) shows the same choices; this file is what the server enforces.

// Client posting on bookhbs.com opens on Susy's word. Until then bookhbs.com shows the HBS pages but
// takes no jobs; the test link still does. To open: set this to true, set LIVE_OPEN in
// site/book/common.js to true, and remove the two "/book/post" lines for bookhbs.com in _redirects.
export const LIVE_OPEN = false;

// Cities where clients can post. Only open cities take jobs and booking fees.
// To open a city, set open: true here and in site/book/post.js (CITIES).
export const CITIES = {
  'New York': { tz: 'America/New_York', short: 'NY', open: true },
  'Los Angeles': { tz: 'America/Los_Angeles', short: 'CA', open: false },
  'Atlanta': { tz: 'America/New_York', short: 'GA', open: false },
};

export const KINDS = ['Shoot', 'Event', 'Wedding', 'Appointment'];
export const HAIR = ['Silk press', 'Wig install', 'Braids', 'Locs', 'Natural styling', 'Updo', 'Cut & color'];
export const MAX_STYLISTS = 6;

// Budget per stylist, in whole US dollars. Test links accept from $5, so a real end-to-end
// payment can be tried for $1.50 and refunded.
export const BUDGET = { min: 50, testMin: 5, max: 20000 };

// The booking fee: 30% of the client's total budget (budget per stylist x number of stylists).
export const FEE_PERCENT = 30;
export const feeCents = (budget, count) => budget * count * FEE_PERCENT; // dollars x 30 = cents, exact
export const money = (cents) => (cents / 100).toFixed(2);
export const dollars = (cents) => (cents % 100 === 0
  ? '$' + (cents / 100).toLocaleString('en-US')
  : '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export const LEAD_MINUTES = 60; // a same-day call time must be at least this far ahead
export const MAX_DAYS_AHEAD = 365;
export const UNPAID_HOURS = 48; // an unpaid job can be paid for this long, then it expires

const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;

function line(raw, max) {
  if (typeof raw !== 'string' || raw.length > max * 4) return '';
  return raw.replace(CTRL, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function para(raw, max) {
  if (typeof raw !== 'string' || raw.length > max * 4) return '';
  return raw.replace(/\r\n?/g, '\n').replace(CTRL, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

// Today's date and the minutes since midnight in a city's own time zone.
export function cityNow(tz, now = new Date()) {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)) p[part.type] = part.value;
  return { date: p.year + '-' + p.month + '-' + p.day, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

function validDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function phoneE164(raw) {
  if (typeof raw !== 'string' || raw.length > 40) return '';
  const plus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!plus && digits.length === 10) return '+1' + digits;
  if (!plus && digits.length === 11 && digits[0] === '1') return '+' + digits;
  if (plus && digits.length >= 8 && digits.length <= 15 && digits[0] !== '0') return '+' + digits;
  return '';
}

const EMAIL_RE = /^[^\s@,;:<>()[\]"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

// Checks a posted job. Returns { job } or { error: '<field>' } naming the first field that's wrong.
export function readJob(body, { test = false, now = new Date() } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'form' };

  const city = typeof body.city === 'string' ? body.city : '';
  const c = Object.prototype.hasOwnProperty.call(CITIES, city) ? CITIES[city] : null;
  if (!c) return { error: 'city' };
  if (!c.open) return { error: 'city_closed' };

  const hood = line(body.hood, 60);
  if (hood.length < 2 || !/\p{L}/u.test(hood) || /[<>{}[\]\\|`~^$#@*=_]/.test(hood)) return { error: 'hood' };

  const date = typeof body.date === 'string' ? body.date : '';
  const time = typeof body.time === 'string' ? body.time : '';
  if (!validDate(date)) return { error: 'date' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'time' };
  const here = cityNow(c.tz, now);
  const ahead = dayNumber(date) - dayNumber(here.date);
  if (ahead < 0 || ahead > MAX_DAYS_AHEAD) return { error: 'date' };
  const mins = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  if (ahead === 0 && mins < here.minutes + LEAD_MINUTES) return { error: 'time_soon' };

  const kind = typeof body.kind === 'string' && KINDS.includes(body.kind) ? body.kind : '';
  if (!kind) return { error: 'kind' };
  if (!Array.isArray(body.hair) || body.hair.length < 1 || body.hair.length > HAIR.length) return { error: 'hair' };
  const hair = HAIR.filter((h) => body.hair.includes(h));
  if (hair.length !== new Set(body.hair).size) return { error: 'hair' };

  const count = body.count;
  if (!Number.isInteger(count) || count < 1 || count > MAX_STYLISTS) return { error: 'count' };

  const note = body.note === undefined || body.note === null ? '' : para(body.note, 500);
  if (typeof body.note === 'string' && body.note.trim() && !note) return { error: 'note' };

  const budget = body.budget;
  const min = test ? BUDGET.testMin : BUDGET.min;
  if (!Number.isInteger(budget) || budget < min || budget > BUDGET.max) return { error: 'budget' };

  const name = line(body.name, 80);
  if (name.length < 2 || !/^[\p{L}\p{M}][\p{L}\p{M} .,'’-]*$/u.test(name)) return { error: 'name' };
  const first = name.split(' ')[0].replace(/[.,]+$/, '');
  const last = name.split(' ').slice(1).join(' ');

  const phone = phoneE164(body.phone);
  if (!phone) return { error: 'phone' };

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL_RE.test(email)) return { error: 'email' };

  return {
    job: {
      city, state: c.short, tz: c.tz, hood, date, time, kind, hair, count, note, budget,
      fee_cents: feeCents(budget, count),
      client: { name, first, last, phone, email },
    },
  };
}

// "Sat, Nov 28" and "7:30 AM", the way clients and stylists read them.
export function dateLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

export function timeLabel(hhmm) {
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  return (h % 12 || 12) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM');
}
