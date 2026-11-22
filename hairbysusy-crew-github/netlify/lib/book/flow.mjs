// How an HBS client job moves after it's paid, and what each person may see of it.
//
//   job status:     unpaid -> posted -> matched -> done        (or cancelled / refunded)
//   stylist states: asked -> yes | no;  yes -> booked | not_picked
//
// The team asks stylists and books them in the team app. A stylist answers on her own job page.
// Once enough stylists are booked the job is matched, and everyone else who said yes is told the
// job went to another stylist. The client sees each yes (no names), then the match.

import { dateLabel, timeLabel, dollars, cityNow, UNPAID_HOURS } from './rules.mjs';

export const JOB_ID_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;
export const PID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const PERSON_STATES = ['asked', 'yes', 'no', 'booked', 'not_picked'];

export class FlowError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const nowIso = () => new Date().toISOString();
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

export const bookedPids = (doc) => Object.entries(doc.people || {}).filter(([, x]) => x.state === 'booked').map(([p]) => p);

// An unpaid job can't be paid once it's 48 hours old, or once its call time has passed.
export function expired(doc, now = Date.now()) {
  if (now - Date.parse(doc.created_at) > UNPAID_HOURS * 3600000) return true;
  return callPassed(doc, now);
}

export function callPassed(doc, now = Date.now()) {
  const here = cityNow(doc.tz, new Date(now));
  if (doc.date < here.date) return true;
  const mins = Number(doc.time.slice(0, 2)) * 60 + Number(doc.time.slice(3, 5));
  return doc.date === here.date && mins <= here.minutes;
}

// The booked stylist gets the exact address from the day before the job (in the job's city).
export function addressOpen(doc, now = Date.now()) {
  const today = cityNow(doc.tz, new Date(now)).date;
  const [y, m, d] = doc.date.split('-').map(Number);
  const dayBefore = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  return today >= dayBefore;
}

// After any booking change: matched once enough stylists are booked (the others who said yes are
// told it went to someone else); back to posted if a booking is undone.
export function settleMatch(doc, at = nowIso()) {
  const need = Number(doc.count) || 1;
  const booked = bookedPids(doc).length;
  const people = { ...(doc.people || {}) };
  if (doc.status === 'posted' && booked >= need) {
    for (const [pid, x] of Object.entries(people)) {
      if (x.state === 'yes') people[pid] = { ...x, state: 'not_picked', decided_at: at, decided_by: 'match' };
    }
    return { ...doc, people, status: 'matched', matched_at: doc.matched_at || at };
  }
  if (doc.status === 'matched' && booked < need) {
    for (const [pid, x] of Object.entries(people)) {
      if (x.state === 'not_picked' && x.decided_by === 'match') {
        const { decided_at, decided_by, ...rest } = x;
        people[pid] = { ...rest, state: 'yes' };
      }
    }
    return { ...doc, people, status: 'posted', matched_at: null };
  }
  return doc;
}

const log = (doc, what, at) => (doc.log || []).concat({ at, what }).slice(-60);

// A change made by the team in the team app. Returns the new job, or throws FlowError.
export function teamChange(doc, op, args = {}, at = nowIso(), by = '') {
  const { pid, state, person } = args;
  const people = { ...(doc.people || {}) };
  const open = doc.status === 'posted' || doc.status === 'matched';

  if (op === 'ask') {
    if (!open) throw new FlowError('closed');
    if (!PID_RE.test(String(pid || '')) || !person) throw new FlowError('bad_person');
    const cur = people[pid];
    if (cur && cur.state !== 'asked') return doc; // already answered: asking again changes nothing
    people[pid] = { ...(cur || {}), state: 'asked', name: String(person.name || '').slice(0, 80), first: firstName(person.name).slice(0, 40), asked_at: at };
    return { ...doc, people, log: cur ? doc.log : log(doc, 'asked ' + people[pid].first, at) };
  }

  if (op === 'state') {
    if (!open) throw new FlowError('closed');
    if (!PERSON_STATES.includes(state)) throw new FlowError('bad_state');
    const cur = people[pid];
    if (!cur) throw new FlowError('not_asked');
    const next = { ...cur, state };
    if (state === 'yes') { next.yes_at = cur.yes_at || at; next.replied_at = at; }
    if (state === 'no') next.replied_at = at;
    if (state === 'booked') { next.booked_at = at; next.yes_at = cur.yes_at || at; }
    if (state === 'not_picked') { next.decided_at = at; next.decided_by = 'team'; }
    if (state !== 'not_picked') { delete next.decided_at; delete next.decided_by; }
    if (state !== 'booked') delete next.booked_at;
    people[pid] = next;
    const changed = { ...doc, people, log: log(doc, cur.first + ': ' + state + (by ? ' (' + by + ')' : ''), at) };
    return settleMatch(changed, at);
  }

  if (op === 'cancel') {
    if (!open) throw new FlowError('closed');
    return { ...doc, status: 'cancelled', cancelled_at: at, log: log(doc, 'cancelled' + (by ? ' by ' + by : ''), at) };
  }
  if (op === 'reopen') {
    if (doc.status !== 'cancelled' || !(doc.pay && doc.pay.paid_at)) throw new FlowError('cannot_reopen');
    return settleMatch({ ...doc, status: 'posted', cancelled_at: null, log: log(doc, 'reopened' + (by ? ' by ' + by : ''), at) }, at);
  }
  if (op === 'done') {
    if (doc.status !== 'matched') throw new FlowError('not_matched');
    return { ...doc, status: 'done', done_at: at, log: log(doc, 'marked done' + (by ? ' by ' + by : ''), at) };
  }
  throw new FlowError('bad_op');
}

// A stylist answers on her own job page: 'yes' (I'm available) or 'no' (not this time).
export function stylistAnswer(doc, pid, answer, at = nowIso()) {
  const cur = (doc.people || {})[pid];
  if (!cur) throw new FlowError('not_asked');
  if (doc.status !== 'posted') throw new FlowError('closed');
  if (answer === 'yes' && (cur.state === 'asked' || cur.state === 'no')) {
    const people = { ...doc.people, [pid]: { ...cur, state: 'yes', yes_at: cur.yes_at || at, replied_at: at } };
    return { ...doc, people, log: log(doc, cur.first + ' said yes', at) };
  }
  if (answer === 'no' && cur.state === 'asked') {
    const people = { ...doc.people, [pid]: { ...cur, state: 'no', replied_at: at } };
    return { ...doc, people, log: log(doc, cur.first + ': not this time', at) };
  }
  return doc;
}

const baseView = (id, doc) => ({
  j: id,
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
});

// What the client's own job page may know: each yes (when, never who), and once matched the
// stylists' first names. Never a stylist's phone, email or last name.
export function clientView(id, doc, now = Date.now()) {
  let status = doc.status;
  if (status === 'unpaid' && expired(doc, now)) status = 'expired';
  const people = Object.values(doc.people || {});
  const yes = people.filter((x) => x.yes_at).map((x) => ({ at: x.yes_at })).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const matched = status === 'matched' || status === 'done';
  return {
    ...baseView(id, doc),
    status,
    fee: dollars(doc.fee_cents),
    first: (doc.client && doc.client.first) || '',
    yes,
    stylists: matched ? people.filter((x) => x.state === 'booked').map((x) => ({ first: x.first || '' })) : [],
    address: matched && doc.address ? doc.address.text : '',
    addressOpen: matched && !callPassed(doc, now),
    paidAt: (doc.pay && doc.pay.paid_at) || null,
  };
}

// What a stylist's own job page may know. Once booked: the client's first name, and from the day
// before the job the exact address. Never the client's phone, email or last name.
export function stylistView(id, doc, pid, now = Date.now()) {
  const me = (doc.people || {})[pid] || {};
  const gone = doc.status === 'cancelled' || doc.status === 'refunded';
  const filled = doc.status === 'matched' || doc.status === 'done';
  let status = 'open';
  if (me.state === 'booked') status = gone ? 'cancelled' : 'booked';
  else if (gone) status = 'cancelled';
  else if (me.state === 'not_picked') status = 'not_picked';
  else if (filled) status = me.state === 'yes' ? 'not_picked' : me.state === 'no' ? 'no' : 'closed';
  else if (me.state === 'no') status = 'no';
  else if (doc.status !== 'posted' || callPassed(doc, now)) status = 'closed';
  else if (me.state === 'yes') status = 'yes';
  const booked = status === 'booked';
  const open = booked && addressOpen(doc, now);
  return {
    ...baseView(id, doc),
    status,
    note: doc.note || '',
    first: me.first || '',
    postedAt: (doc.pay && doc.pay.paid_at) || doc.created_at,
    client: booked ? ((doc.client && doc.client.first) || '') : '',
    address: open && doc.address ? doc.address.text : '',
    addressState: !booked ? 'after_booking' : !open ? 'day_before' : doc.address ? 'ready' : 'waiting',
  };
}

// The exact address a client adds after the match: 5 to 200 characters, one line.
export function readAddress(raw) {
  if (typeof raw !== 'string' || raw.length > 800) return '';
  const text = raw.replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  return text.length >= 5 && /\p{L}/u.test(text) ? text : '';
}
