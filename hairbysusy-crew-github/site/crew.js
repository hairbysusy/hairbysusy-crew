(function(){
  const LIVE = /(^|\.)hairbysusy\.com$|(^|\.)bookhbs\.com$|\.netlify\.app$/.test(location.hostname);
  const form = document.getElementById('form');
  const steps = [...document.querySelectorAll('.step')];
  const names = steps.map(s => s.dataset.step);
  const LAST_Q = names.indexOf('review');
  const $ = id => document.getElementById(id);
  const next = $('next'), back = $('back'), top = $('top'), bar = $('bar'), count = $('count'), foot = $('foot'), keyhint = $('keyhint');
  let at = 0, fromReview = false, sending = false;

  if (!LIVE) {
    const b = document.createElement('div');
    b.className = 'preview';
    b.textContent = 'Preview · applications are not sent from here';
    document.body.appendChild(b);
    document.body.classList.add('is-preview');
  }

  /* ---------- chips & cards ---------- */
  document.querySelectorAll('[data-field]').forEach(group => {
    const hidden = $('h-' + group.dataset.field);
    const multi = group.hasAttribute('data-multi');
    group.querySelectorAll('[data-value]').forEach(btn => {
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => {
        if (multi) {
          const on = btn.getAttribute('aria-pressed') === 'true';
          if (!on && group.dataset.field === 'locations' && pickedLocs() >= MAX_LOCS) return setErr('locations', LOCS_FULL);
          btn.setAttribute('aria-pressed', on ? 'false' : 'true');
        } else {
          group.querySelectorAll('[data-value]').forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
        }
        refresh(group.dataset.field);
        clearErr(group.dataset.field);
        if (group.hasAttribute('data-advance')) setTimeout(go, 320);
      });
    });
  });
  function refresh(field){
    const vals = [...document.querySelectorAll('[data-field="' + field + '"] [aria-pressed="true"]')].map(b => b.dataset.value);
    $('h-' + field).value = (field === 'locations' ? vals.concat(customLocs) : vals).join(sep(field));
  }

  /* ---------- locations: add your own (joined with '; ' so a place can be 'City, Country') ---------- */
  const sep = field => field === 'locations' ? '; ' : ', ';
  let customLocs = [];
  const presetLocs = [...document.querySelectorAll('[data-field="locations"] [data-value]')];
  // Where they take clients now: at most 2 cities, counting the ones they add themselves.
  const MAX_LOCS = 2, LOCS_FULL = 'Choose up to 2 cities.';
  function pickedLocs(){ return presetLocs.filter(b => b.getAttribute('aria-pressed') === 'true').length + customLocs.length; }
  function cleanLoc(t){
    t = String(t || '').replace(/;+/g, ' ').replace(/[^\p{L}\p{M} .,'\-]/gu, '').replace(/\s*,[\s,]*/g, ', ').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').slice(0, 40);
    if (t && t === t.toLowerCase()) t = t.replace(/(^|[\s\-])\p{L}/gu, m => m.toUpperCase());
    return t.replace(/,\s*(\p{L}{2})$/u, (m, c) => ', ' + c.toUpperCase()); // "Charlotte, nc" -> "Charlotte, NC"
  }
  function drawCustom(){
    const box = $('customLocs'); box.innerHTML = '';
    customLocs.forEach(name => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-pressed', 'true');
      b.setAttribute('aria-label', 'Remove ' + name);
      const t = document.createElement('span'); t.className = 'tick'; t.textContent = '\u2713';
      const x = document.createElement('span'); x.className = 'x'; x.setAttribute('aria-hidden', 'true'); x.textContent = '\u00d7';
      b.append(t, document.createTextNode(name), x);
      b.addEventListener('click', () => { customLocs = customLocs.filter(n => n !== name); drawCustom(); refresh('locations'); clearErr('locations'); });
      box.appendChild(b);
    });
  }
  // Returns false when the city couldn't be added (the reason is shown under the cities).
  function addLoc(){
    const name = cleanLoc($('otherLoc').value);
    if (!name) { $('otherLoc').value = ''; return true; }
    const preset = presetLocs.find(b => b.dataset.value.toLowerCase() === name.toLowerCase());
    const already = preset ? preset.getAttribute('aria-pressed') === 'true' : customLocs.some(n => n.toLowerCase() === name.toLowerCase());
    if (!already && pickedLocs() >= MAX_LOCS) { setErr('locations', LOCS_FULL); return false; }
    $('otherLoc').value = '';
    if (preset) preset.setAttribute('aria-pressed', 'true');
    else if (!already) { customLocs.push(name); drawCustom(); }
    refresh('locations'); clearErr('locations');
    return true;
  }
  $('addLoc').addEventListener('click', addLoc);
  $('otherLoc').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addLoc(); } });

  document.querySelectorAll('input[data-hidden]').forEach(sw => {
    sw.addEventListener('change', () => { $(sw.dataset.hidden).value = sw.checked ? 'Yes' : 'No'; });
  });
  form.querySelectorAll('.input').forEach(el => el.addEventListener('input', () => clearErr(el.id)));
  $('consent').addEventListener('change', () => clearErr('consent'));
  $('commit').addEventListener('change', () => clearErr('commit'));

  function syncUI(){
    const lv = $('h-locations').value.split('; ').filter(Boolean);
    customLocs = lv.filter(n => !presetLocs.some(b => b.dataset.value === n)).map(cleanLoc).filter(Boolean).slice(0, MAX_LOCS);
    drawCustom();
    document.querySelectorAll('[data-field]').forEach(group => {
      const vals = $('h-' + group.dataset.field).value.split(sep(group.dataset.field)).filter(Boolean);
      group.querySelectorAll('[data-value]').forEach(b => b.setAttribute('aria-pressed', vals.includes(b.dataset.value) ? 'true' : 'false'));
    });
    document.querySelectorAll('input[data-hidden]').forEach(sw => { sw.checked = $(sw.dataset.hidden).value === 'Yes'; });
  }

  /* ---------- validation ---------- */
  function setErr(key, msg){
    const e = $('err-' + key); if (e) e.textContent = msg;
    const sec = steps[at]; sec.classList.remove('shake'); void sec.offsetWidth; sec.classList.add('shake');
  }
  function clearErr(key){ const e = $('err-' + key); if (e) e.textContent = ''; }
  const v = id => ($(id).value || '').trim();
  const digits = s => s.replace(/\D/g, '');
  function cleanHandle(s){
    s = s.trim().replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/^@+/, '');
    return s ? '@' + s : '';
  }
  function cleanLink(s){
    s = s.trim(); if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try { const u = new URL(s); return (u.protocol === 'https:' || u.protocol === 'http:') && /\.[a-z]{2,}$/i.test(u.hostname) ? u.href : ''; } catch (e) { return ''; }
  }
  function showLinks(){
    const h = cleanHandle(v('instagram'));
    $('lc-instagram').textContent = h.length > 1 ? '\u2713 instagram.com/' + h.slice(1) : '';
    const u = cleanLink(v('portfolio'));
    $('lc-portfolio').textContent = u ? '\u2713 Opens ' + (u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').slice(0, 60)) : '';
  }
  $('instagram').addEventListener('input', showLinks);
  $('portfolio').addEventListener('input', showLinks);
  /* ---------- the On-Call Team rule, shown before anyone starts ---------- */
  let rulesOK = false, rulesFrom = null;
  const rulesEl = document.getElementById('rules');
  function openRules(){
    rulesFrom = document.activeElement;
    rulesEl.hidden = false; form.inert = true; document.body.classList.add('modal-open');
    document.getElementById('rulesOk').focus();
  }
  function closeRules(){
    rulesEl.hidden = true; form.inert = false; document.body.classList.remove('modal-open');
    if (rulesFrom && rulesFrom.focus) rulesFrom.focus();
  }
  document.getElementById('rulesOk').addEventListener('click', () => { rulesOK = true; closeRules(); go(); });
  document.getElementById('rulesBack').addEventListener('click', closeRules);
  rulesEl.addEventListener('click', e => { if (e.target === rulesEl) closeRules(); });
  rulesEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeRules(); return; }
    if (e.key !== 'Tab') return;
    const f = [...rulesEl.querySelectorAll('button')], i = f.indexOf(document.activeElement);
    e.preventDefault(); f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
  });

  const checks = {
    welcome(){ if (!rulesOK) { openRules(); return false; } return true; },
    name(){ if (v('name').split(/\s+/).length < 2) return setErr('name', 'Add your first and last name.'), false; return true; },
    contact(){
      let ok = true;
      const pd = digits(v('phone'));
      const phoneOk = v('phone').startsWith('+') ? pd.length >= 8 && pd.length <= 15 : pd.length === 10 || (pd.length === 11 && pd[0] === '1');
      if (!phoneOk) { setErr('phone', 'Enter a mobile number Susy can text. Outside the US, start with + and your country code.'); ok = false; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v('email'))) { setErr('email', 'Enter a valid email address.'); ok = false; }
      return ok;
    },
    work(){
      let ok = true;
      const h = cleanHandle(v('instagram'));
      if (h.length < 2) { setErr('instagram', 'Add your Instagram handle.'); ok = false; } else $('instagram').value = h;
      if (v('portfolio')) {
        const u = cleanLink(v('portfolio'));
        if (!u) { setErr('portfolio', 'That link doesn\u2019t look right. Check it, or leave it blank.'); ok = false; } else $('portfolio').value = u;
      }
      return ok;
    },
    locations(){
      if (v('otherLoc') && !addLoc()) return false;
      if (!$('h-locations').value) return setErr('locations', 'Choose the city where you take clients, or add your own.'), false;
      if (pickedLocs() > MAX_LOCS) return setErr('locations', LOCS_FULL), false;
      return true;
    },
    role(){ if (!$('h-role').value) return setErr('role', 'Choose one to continue.'), false; return true; },
    license(){
      const st = $('h-license_status').value;
      if (!st) return setErr('license_status', 'Choose one to continue.'), false;
      const where = v('licenseWhere');
      $('h-licensed').value = st === 'Licensed' && where ? 'Licensed (' + where + ')' : st;
      return true;
    },
    specialties(){ if (!$('h-specialties').value) return setErr('specialties', 'Choose at least one.'), false; return true; },
    response(){ if (!$('h-response_time').value) return setErr('response_time', 'Choose one to continue.'), false; return true; },
    rate(){ return true; },
    review(){
      let ok = true;
      if (!$('consent').checked) { setErr('consent', 'Check the box so Susy can text you about jobs.'); ok = false; }
      if (!$('commit').checked) { setErr('commit', 'Check the box to confirm you understand the rule.'); ok = false; }
      return ok;
    }
  };

  /* ---------- review ---------- */
  function buildReview(){
    const rows = [
      ['Name', v('name'), 'name'],
      ['Mobile', v('phone'), 'contact'],
      ['Email', v('email'), 'contact'],
      ['Instagram', v('instagram'), 'work'],
      ['Portfolio', v('portfolio').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '') || '—', 'work'],
      ['Takes clients in', $('h-locations').value, 'locations'],
      ['Role', $('h-role').value, 'role'],
      ['License', $('h-licensed').value, 'license'],
      ['Specialties', $('h-specialties').value, 'specialties'],
      ['Confirms', $('h-response_time').value, 'response'],
      ['Day rate', [v('rate'), $('rateOpen').checked ? 'open to discuss' : ''].filter(Boolean).join(' · ') || '—', 'rate']
    ];
    const dl = $('review'); dl.innerHTML = '';
    rows.forEach(([label, value, step]) => {
      const row = document.createElement('div'); row.className = 'row';
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = value;
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Edit';
      b.setAttribute('aria-label', 'Edit ' + label);
      b.addEventListener('click', () => { fromReview = true; show(names.indexOf(step), -1); });
      row.append(dt, dd, b); dl.appendChild(row);
    });
  }

  /* ---------- navigation ---------- */
  function show(n, dir){
    steps[at].classList.remove('on', 'rev', 'shake');
    at = n;
    const s = steps[at];
    if (dir < 0) s.classList.add('rev');
    s.classList.add('on');
    const name = names[at];
    const q = Math.min(at, LAST_Q);
    top.classList.toggle('hidden', name === 'welcome' || name === 'done');
    document.body.classList.toggle('welcome', name === 'welcome');
    bar.style.width = (q / LAST_Q * 100) + '%';
    count.textContent = (name === 'welcome' || name === 'done') ? '' : at + ' of ' + LAST_Q;
    document.documentElement.style.setProperty('--glow', (0.28 + 0.5 * q / LAST_Q).toFixed(2));
    next.textContent = name === 'welcome' ? 'Start application' : name === 'review' ? 'Send application' : (fromReview ? 'Save and review' : 'Continue');
    const cardStep = s.querySelector('.cards[data-advance]');
    next.style.display = name === 'done' ? 'none' : '';
    keyhint.style.display = (name === 'welcome' || name === 'review' || name === 'done' || cardStep) ? 'none' : '';
    $('igLink').hidden = name !== 'done';
    if (name === 'review') buildReview();
    const first = s.querySelector('input.input:not([data-nofocus]), textarea.input');
    if (first && matchMedia('(hover:hover)').matches) setTimeout(() => first.focus({preventScroll:true}), 260);
    else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    window.scrollTo(0, 0);
  }

  function go(){
    if (sending) return;
    const name = names[at];
    if (checks[name] && !checks[name]()) return;
    if (name === 'review') return submit();
    if (fromReview) { fromReview = false; return show(LAST_Q, 1); }
    show(at + 1, 1);
  }

  next.addEventListener('click', go);
  back.addEventListener('click', () => {
    if (fromReview) { fromReview = false; return show(LAST_Q, -1); }
    if (at > 0) show(at - 1, -1);
  });
  form.addEventListener('submit', e => { e.preventDefault(); go(); });
  form.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); go(); }
  });

  /* ---------- submit ---------- */
  async function submit(){
    sending = true; next.disabled = true; next.textContent = 'Sending…';
    const body = new URLSearchParams(new FormData(form)).toString();
    try {
      if (LIVE) {
        // Sent to the form's own page, /apply/: Netlify Forms only takes an application at an address
        // no redirect rule touches, and on bookhbs.com the address '/' is the HBS home page.
        const r = await fetch('/apply/', { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body });
        if (!r.ok) throw new Error(r.status);
      } else {
        await new Promise(r => setTimeout(r, 700));
      }
      const first = v('name').split(/\s+/)[0];
      const locs = $('h-locations').value.split('; ').filter(Boolean);
      $('doneText').textContent = 'Thank you, ' + first + '. Susy’s team reviews every application. Once you’re approved, you’ll hear from us when there’s a job in ' + (locs.length === 1 ? locs[0] : locs.length === 2 ? locs[0] + ' or ' + locs[1] : 'one of your cities') + '.';
      document.body.classList.add('bloom');
      show(names.indexOf('done'), 1);
      document.documentElement.style.setProperty('--glow', '1');
    } catch (err) {
      setErr('consent', 'Your application didn’t send. Check your connection and tap Send again.');
      next.textContent = 'Send application';
    } finally {
      sending = false; next.disabled = false;
    }
  }

  /* ---------- keep place across a republish (preview only) ---------- */
  function snapshot(){
    const values = {};
    form.querySelectorAll('input[name], textarea[name]').forEach(el => {
      if (el.name === 'form-name' || el.name === 'bot-field') return;
      values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return { at, values };
  }
  function start(data){
    if (data && data.values) {
      Object.entries(data.values).forEach(([k, val]) => {
        const el = form.querySelector('[name="' + k + '"]'); if (!el) return;
        if (el.type === 'checkbox') el.checked = !!val; else el.value = val;
      });
      syncUI();
      if (typeof data.at === 'number' && data.at > 0 && data.at < steps.length) { show(data.at, 1); return; }
    }
    show(0, 1);
  }
  try { window.claude?.hot?.snapshot(snapshot); } catch (e) {}
  if (window.claude?.hot?.ready) window.claude.hot.ready(start); else start(window.claude?.hot?.data ?? {});
})();
