// Post a job: six steps on one page (where, when, the job, budget, your details, review and pay).
// What the client types stays in this tab (sessionStorage) until the job is posted. The server
// (netlify/functions/book-api.mjs) checks everything again and makes the Wix checkout.
'use strict';

(() => {
  const H = window.HBS;

  // Same lists as netlify/lib/book/rules.mjs. Only open cities take jobs.
  const CITIES = [
    { name: 'New York', tz: 'America/New_York', short: 'NY', open: true },
    { name: 'Los Angeles', tz: 'America/Los_Angeles', short: 'CA', open: false },
    { name: 'Atlanta', tz: 'America/New_York', short: 'GA', open: false },
  ];
  const KINDS = ['Shoot', 'Event', 'Wedding', 'Appointment'];
  const HAIR = ['Silk press', 'Wig install', 'Braids', 'Locs', 'Natural styling', 'Updo', 'Cut & color'];
  const PRESETS = [150, 250, 350, 500];
  const MAX_STYLISTS = 6;
  const BUDGET_MIN = H.test ? 5 : 50;
  const BUDGET_MAX = 20000;
  const LEAD = 60; // minutes: a same-day call time must be at least this far ahead
  const LAST_SLOT = 23 * 60 + 55;
  const MAX_DAYS = 365;
  const STEPS = 6;
  const DRAFT = 'hbs.post.v1';
  const POSTED = 'hbs.posted';
  const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0C0C11" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  const $ = (id) => document.getElementById(id);

  // Came back from the checkout with the browser's back button: the job already exists, so go to
  // its page (which can pay for it) instead of posting it twice.
  function backFromCheckout() {
    try {
      const p = JSON.parse(sessionStorage.getItem(POSTED) || 'null');
      if (p && H.ID_RE.test(p.j) && H.KEY_RE.test(p.k)) {
        location.replace(H.jobUrl(p.j, p.k));
        return true;
      }
    } catch { /* storage off */ }
    return false;
  }
  if (backFromCheckout()) return;
  window.addEventListener('pageshow', (e) => { if (e.persisted) backFromCheckout(); });

  /* ---------------- state ---------------- */

  const BLANK = {
    city: 'New York', hood: '', day: '', date: '', time: '', mo: 0, kind: '', hair: [], count: 1,
    noteOpen: false, note: '', budget: 0, name: '', phone: '', email: '',
  };
  const S = { ...BLANK, ...loadDraft() };
  let step = 1;
  let busy = false;

  function loadDraft() {
    let v = null;
    try { v = JSON.parse(sessionStorage.getItem(DRAFT) || 'null'); } catch { v = null; }
    if (!v || typeof v !== 'object') return {};
    const out = {};
    for (const k of Object.keys(BLANK)) {
      const b = BLANK[k];
      if (Array.isArray(b)) { if (Array.isArray(v[k])) out[k] = v[k].filter((x) => HAIR.includes(x)); } else if (typeof v[k] === typeof b) out[k] = v[k];
    }
    if (!CITIES.some((c) => c.name === out.city && c.open)) delete out.city;
    if (out.kind && !KINDS.includes(out.kind)) delete out.kind;
    return out;
  }
  // Every change saves the draft and clears the last error message (the client is fixing it).
  function save() {
    try { sessionStorage.setItem(DRAFT, JSON.stringify(S)); } catch { /* storage off */ }
    const e = document.getElementById('err');
    if (e) e.hidden = true;
  }

  const city = () => CITIES.find((c) => c.name === S.city) || CITIES[0];

  /* ---------------- dates, in the job city's own time ---------------- */

  function cityNow(tz) {
    const p = {};
    for (const part of new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date())) p[part.type] = part.value;
    return { date: p.year + '-' + p.month + '-' + p.day, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
  }
  const parts = (iso) => iso.split('-').map(Number);
  function addDays(iso, n) {
    const [y, m, d] = parts(iso);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  function dayDiff(a, b) {
    const [y1, m1, d1] = parts(a);
    const [y2, m2, d2] = parts(b);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  }
  function fmt(iso, opts) {
    const [y, m, d] = parts(iso);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
  }
  const shortDate = (iso) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
  function timeLabel(hhmm) {
    const h = Number(hhmm.slice(0, 2));
    return (h % 12 || 12) + ':' + hhmm.slice(3, 5) + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const todayTooLate = () => cityNow(city().tz).minutes + LEAD > LAST_SLOT;

  // The calendar date the client chose. "Today" and "Tomorrow" are kept as the date they meant
  // when they tapped them, so a post sent just after midnight keeps the day they saw.
  const chosenDate = () => (S.day ? S.date : '');

  // Keeps the day rows true to the date: the row for a date that is no longer today or tomorrow
  // becomes "Another date" with that date on the calendar; a date now past is cleared.
  function settleDay() {
    const today = cityNow(city().tz).date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(S.date) || dayDiff(today, S.date) < 0) {
      S.date = '';
      if (S.day !== 'other') S.day = '';
      return;
    }
    if (S.day === 'today' || S.day === 'tomorrow') {
      S.day = S.date === today ? 'today' : S.date === addDays(today, 1) ? 'tomorrow' : 'other';
    }
  }

  /* ---------------- money ---------------- */

  const feeCents = () => S.budget * S.count * 30;
  function dollars(cents) {
    return cents % 100 === 0
      ? '$' + (cents / 100).toLocaleString('en-US')
      : '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function phoneOk(raw) {
    const plus = raw.trim().startsWith('+');
    const digits = raw.replace(/\D/g, '');
    if (!plus) return digits.length === 10 || (digits.length === 11 && digits[0] === '1');
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0';
  }
  const EMAIL_RE = /^[^\s@,;:<>()[\]"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

  /* ---------------- build the choices ---------------- */

  function rowButton(title, sub) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'row press';
    b.innerHTML = '<span class="t"><b></b><small hidden></small></span><span class="dot" aria-hidden="true">' + CHECK + '</span>';
    b.querySelector('b').textContent = title;
    const small = b.querySelector('small');
    if (sub) { small.textContent = sub; small.hidden = false; }
    return b;
  }

  for (const c of CITIES) {
    const b = rowButton(c.name, c.open ? '' : 'Opening soon');
    b.dataset.city = c.name;
    if (!c.open) { b.classList.add('closed'); b.disabled = true; }
    b.addEventListener('click', () => { if (c.open) { S.city = c.name; save(); render(); } });
    $('cities').appendChild(b);
  }

  const DAY_ROWS = [
    { key: 'today', title: 'Today' },
    { key: 'tomorrow', title: 'Tomorrow' },
    { key: 'other', title: 'Another date' },
  ];
  for (const d of DAY_ROWS) {
    const b = rowButton(d.title, ' ');
    b.dataset.day = d.key;
    b.addEventListener('click', () => {
      const today = cityNow(city().tz).date;
      if (d.key === 'today') S.date = today;
      if (d.key === 'tomorrow') S.date = addDays(today, 1);
      if (d.key === 'other') {
        if (S.day !== 'other') S.date = ''; // choose the date on the calendar
        S.mo = 0;
      }
      S.day = d.key;
      save(); render();
    });
    $('days').appendChild(b);
  }

  function chip(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip press';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }
  for (const k of KINDS) {
    const b = chip(k, () => { S.kind = k; save(); render(); });
    b.dataset.kind = k;
    $('kinds').appendChild(b);
  }
  for (const h of HAIR) {
    const b = chip(h, () => {
      S.hair = S.hair.includes(h) ? S.hair.filter((x) => x !== h) : HAIR.filter((x) => x === h || S.hair.includes(x));
      save(); render();
    });
    b.dataset.hair = h;
    $('hair').appendChild(b);
  }
  for (const v of PRESETS) {
    const b = chip('$' + v, () => { S.budget = v; save(); render(); });
    b.dataset.amount = String(v);
    $('presets').appendChild(b);
  }

  /* ---------------- inputs ---------------- */

  const bindText = (id, key) => {
    const el = $(id);
    el.value = S[key];
    el.addEventListener('input', () => { S[key] = el.value; save(); if (key === 'time') render(); });
  };
  bindText('hood', 'hood');
  bindText('time', 'time');
  bindText('note', 'note');
  bindText('name', 'name');
  bindText('phone', 'phone');
  bindText('email', 'email');

  $('fewer').addEventListener('click', () => { S.count = Math.max(1, S.count - 1); save(); render(); });
  $('more').addEventListener('click', () => { S.count = Math.min(MAX_STYLISTS, S.count + 1); save(); render(); });
  $('openNote').addEventListener('click', () => { S.noteOpen = true; save(); render(); $('note').focus(); });

  const budgetEl = $('budget');
  budgetEl.addEventListener('input', () => {
    const digits = budgetEl.value.replace(/\D/g, '').slice(0, 5);
    S.budget = digits ? Number(digits) : 0;
    if (budgetEl.value !== digits) budgetEl.value = digits;
    save(); render();
  });
  budgetEl.addEventListener('focus', () => { budgetEl.value = S.budget > 0 ? String(S.budget) : ''; });
  budgetEl.addEventListener('blur', () => { budgetEl.value = S.budget > 0 ? S.budget.toLocaleString('en-US') : ''; });
  $('up').addEventListener('click', () => { S.budget = Math.min(BUDGET_MAX, S.budget + 25); save(); render(); });
  $('down').addEventListener('click', () => { S.budget = Math.max(0, S.budget - 25); save(); render(); });

  $('prevMonth').addEventListener('click', () => { S.mo = Math.max(0, S.mo - 1); save(); render(); });
  $('nextMonth').addEventListener('click', () => { S.mo = Math.min(11, S.mo + 1); save(); render(); });

  /* ---------------- drawing ---------------- */

  function renderCalendar() {
    const today = cityNow(city().tz).date;
    const [ty, tm] = parts(today);
    const first = new Date(Date.UTC(ty, tm - 1 + S.mo, 1));
    const y = first.getUTCFullYear();
    const m = first.getUTCMonth();
    const total = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    $('monthLabel').textContent = first.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    $('prevMonth').disabled = S.mo <= 0;
    $('nextMonth').disabled = S.mo >= 11;
    const grid = $('calDays');
    grid.textContent = '';
    for (let i = 0; i < first.getUTCDay(); i++) grid.appendChild(document.createElement('span'));
    for (let d = 1; d <= total; d++) {
      const iso = new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
      const ahead = dayDiff(today, iso);
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(d);
      b.setAttribute('aria-label', fmt(iso, { weekday: 'long', month: 'long', day: 'numeric' }));
      b.setAttribute('aria-pressed', String(S.date === iso && S.day === 'other'));
      if (iso === today) b.classList.add('today');
      if (ahead < 0 || ahead > MAX_DAYS || (ahead === 0 && todayTooLate())) b.disabled = true;
      b.addEventListener('click', () => { S.date = iso; S.day = 'other'; save(); render(); });
      grid.appendChild(b);
    }
  }

  function render() {
    // header
    $('progress').style.width = (step / STEPS * 100).toFixed(3) + '%';
    $('stepno').textContent = String(step).padStart(2, '0') + ' / 0' + STEPS;
    $('stepsr').textContent = 'Step ' + step + ' of ' + STEPS;
    for (const sec of document.querySelectorAll('.step')) sec.hidden = Number(sec.dataset.step) !== step;

    // 1 where
    for (const b of $('cities').children) b.setAttribute('aria-pressed', String(b.dataset.city === S.city));

    // 2 when
    const tz = city().tz;
    const today = cityNow(tz).date;
    settleDay();
    if (S.day === 'today' && todayTooLate()) { S.day = ''; S.date = ''; }
    for (const b of $('days').children) {
      const key = b.dataset.day;
      const small = b.querySelector('small');
      if (key === 'today') {
        const late = todayTooLate();
        small.textContent = late ? 'Too late for a call time today' : shortDate(today);
        b.disabled = late;
        b.classList.toggle('closed', late);
      } else if (key === 'tomorrow') {
        small.textContent = shortDate(addDays(today, 1));
      } else {
        small.textContent = S.day === 'other' && S.date ? shortDate(S.date) : 'Choose on the calendar';
      }
      b.setAttribute('aria-pressed', String(S.day === key));
    }
    $('cal').hidden = S.day !== 'other';
    if (S.day === 'other') renderCalendar();
    $('timeHelp').textContent = 'The time your stylist must arrive, ready to work. ' + S.city + ' time.';

    // 3 the job
    for (const b of $('kinds').children) b.setAttribute('aria-pressed', String(b.dataset.kind === S.kind));
    for (const b of $('hair').children) b.setAttribute('aria-pressed', String(S.hair.includes(b.dataset.hair)));
    $('count').textContent = String(S.count);
    $('fewer').disabled = S.count <= 1;
    $('more').disabled = S.count >= MAX_STYLISTS;
    $('openNote').hidden = S.noteOpen;
    $('noteWrap').hidden = !S.noteOpen;

    // 4 budget
    if (document.activeElement !== budgetEl) budgetEl.value = S.budget > 0 ? S.budget.toLocaleString('en-US') : '';
    $('down').disabled = S.budget <= 0;
    for (const b of $('presets').children) b.setAttribute('aria-pressed', String(Number(b.dataset.amount) === S.budget));
    $('feeNow').textContent = dollars(feeCents());
    const feeFor = $('feeFor');
    feeFor.hidden = S.count < 2;
    feeFor.textContent = 'For ' + S.count + ' stylists at ' + dollars(S.budget * 100) + ' each.';

    // 6 review
    if (step === STEPS) {
      const date = chosenDate();
      $('rCity').textContent = S.city;
      $('rHood').textContent = S.hood.trim();
      $('rWhen').textContent = (date ? shortDate(date) : '') + (S.time ? ' · ' + timeLabel(S.time) : '');
      $('rJob').textContent = S.kind + ' · ' + S.hair.join(', ');
      $('rCountRow').hidden = S.count < 2;
      $('rCount').textContent = String(S.count);
      $('rPay').textContent = dollars(S.budget * 100) + (S.count > 1 ? ' each' : '');
      $('rFee').textContent = dollars(feeCents());
      $('rBudget').textContent = dollars(S.budget * S.count * 100);
      $('rBudgetNote').textContent = S.count > 1
        ? dollars(S.budget * 100) + ' each for ' + S.count + ' stylists. You pay your stylists directly.'
        : 'You pay your stylist directly.';
    }

    // the button
    const go = $('go');
    go.textContent = step < STEPS ? 'Continue' : 'Pay ' + dollars(feeCents()) + ' and post';
    $('fine').hidden = step !== STEPS;
  }

  /* ---------------- checking each step ---------------- */

  // Returns [message, element to focus] for the first problem on a step, or null.
  function problem(n) {
    if (n === 1) {
      if (!city().open) return ['Choose New York. Los Angeles and Atlanta open soon.', $('cities')];
      const hood = S.hood.trim();
      if (hood.length < 2 || !/\p{L}/u.test(hood)) return ['Add the neighborhood, for example Harlem.', $('hood')];
    }
    if (n === 2) {
      if (!S.day) return ['Choose the day.', $('days')];
      if (S.day === 'other' && !S.date) return ['Choose the date on the calendar.', $('calDays')];
      const date = chosenDate();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ['Choose the date again.', $('days')];
      const now = cityNow(city().tz);
      const ahead = dayDiff(now.date, date);
      if (ahead < 0 || ahead > MAX_DAYS) return ['Choose the date again.', $('days')];
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(S.time)) return ['Add the call time.', $('time')];
      if (ahead === 0 && minutesOf(S.time) < now.minutes + LEAD) return ['For today, choose a call time at least an hour from now.', $('time')];
    }
    if (n === 3) {
      if (!S.kind) return ["Choose what it's for.", $('kinds')];
      if (!S.hair.length) return ['Choose the hair.', $('hair')];
      if (S.noteOpen && S.note.length > 500) return ['Shorten the note to 500 characters.', $('note')];
    }
    if (n === 4) {
      if (S.budget < BUDGET_MIN) return ['Budgets start at ' + dollars(BUDGET_MIN * 100) + ' per stylist.', budgetEl];
      if (S.budget > BUDGET_MAX) return ['For a budget over $20,000, email info@hairbysusy.com.', budgetEl];
    }
    if (n === 5) {
      const name = S.name.trim();
      if (name.length < 2 || !/^[\p{L}\p{M}][\p{L}\p{M} .,'’-]*$/u.test(name)) return ['Add your name.', $('name')];
      if (!phoneOk(S.phone)) return ['Add a mobile number with the area code.', $('phone')];
      if (!EMAIL_RE.test(S.email.trim())) return ['Add a valid email.', $('email')];
    }
    return null;
  }

  function showErr(msg, focusEl) {
    const e = $('err');
    e.textContent = msg;
    e.hidden = false;
    if (focusEl) {
      if (!focusEl.matches('input, textarea, button')) {
        const first = focusEl.querySelector('button:not(:disabled)');
        if (first) { first.focus(); return; }
      }
      focusEl.focus();
    }
  }
  const hideErr = () => { $('err').hidden = true; };

  function goTo(n, push) {
    step = Math.min(STEPS, Math.max(1, n));
    if (push) history.pushState({ step }, '');
    hideErr();
    render();
    window.scrollTo(0, 0);
    const h = document.querySelector('.step[data-step="' + step + '"] h1');
    if (h) h.focus({ preventScroll: true });
  }

  /* ---------------- posting ---------------- */

  const FIELD_STEP = { city: 1, city_closed: 1, hood: 1, date: 2, time: 2, time_soon: 2, kind: 3, hair: 3, count: 3, note: 3, budget: 4, name: 5, phone: 5, email: 5 };

  async function submit() {
    for (let n = 1; n < STEPS; n++) {
      const p = problem(n);
      if (p) { goTo(n, true); showErr(p[0], p[1]); return; }
    }
    busy = true;
    const go = $('go');
    go.disabled = true;
    $('working').hidden = false;
    const r = await H.api('/api/book/jobs', {
      city: S.city, hood: S.hood.trim(), date: chosenDate(), time: S.time, kind: S.kind, hair: S.hair,
      count: S.count, note: S.noteOpen ? S.note : '', budget: S.budget,
      name: S.name.trim(), phone: S.phone.trim(), email: S.email.trim(), website: $('website').value,
    });
    const d = r.data || {};
    if (r.status === 201 && H.ID_RE.test(d.j) && H.KEY_RE.test(d.k)) {
      H.saveJob({ j: d.j, k: d.k, label: shortDate(chosenDate()) + ' · ' + S.city });
      try {
        sessionStorage.setItem(POSTED, JSON.stringify({ j: d.j, k: d.k }));
        sessionStorage.removeItem(DRAFT);
      } catch { /* storage off */ }
      if (d.payUrl && H.checkoutOk(d.payUrl)) { location.assign(d.payUrl); return; }
      location.assign(H.jobUrl(d.j, d.k) + '&e=' + encodeURIComponent(d.payError || 'payments_failed'));
      return;
    }
    busy = false;
    go.disabled = false;
    $('working').hidden = true;
    if (r.status === 400 && FIELD_STEP[d.error]) {
      const n = FIELD_STEP[d.error];
      const p = problem(n);
      goTo(n, true);
      if (d.error === 'time_soon') showErr('For today, choose a call time at least an hour from now.', $('time'));
      else if (d.error === 'city_closed') showErr('Choose New York. Los Angeles and Atlanta open soon.', $('cities'));
      else showErr(p ? p[0] : 'Check this step and try again.', p ? p[1] : null);
      return;
    }
    const msg = {
      429: d.error === 'busy' ? "We're getting a lot of jobs right now. Try again in a few minutes." : 'You posted several jobs in the last hour. Try again later, or email info@hairbysusy.com.',
      403: 'This page is out of date. Refresh it and try again.',
      404: "Posting isn't open on this address yet.",
      503: "Posting isn't open yet. Try again soon.",
      0: 'No connection. Check your internet and try again.',
    }[r.status];
    showErr(msg || 'Something went wrong on our side. Try again in a minute.');
  }

  $('go').addEventListener('click', () => {
    if (busy) return;
    const p = problem(step);
    if (p) { showErr(p[0], p[1]); return; }
    if (step < STEPS) goTo(step + 1, true);
    else submit();
  });

  document.querySelector('.steps').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input') && !e.isComposing) {
      e.preventDefault();
      $('go').click();
    }
  });

  $('back').addEventListener('click', () => {
    if (busy) return;
    if (step <= 1) { location.href = '/book/'; return; }
    if (history.state && history.state.step === step) history.back();
    else goTo(step - 1, false);
  });

  window.addEventListener('popstate', (e) => {
    if (busy) return;
    const n = e.state && Number.isInteger(e.state.step) ? e.state.step : 1;
    goTo(n, false);
  });

  window.addEventListener('pageshow', (e) => {
    if (e.persisted) { busy = false; $('go').disabled = false; $('working').hidden = true; }
  });

  // A reload keeps the step the client was on.
  const st = history.state && Number.isInteger(history.state.step) ? history.state.step : 1;
  step = Math.min(STEPS, Math.max(1, st));
  history.replaceState({ step }, '');
  render();
})();
