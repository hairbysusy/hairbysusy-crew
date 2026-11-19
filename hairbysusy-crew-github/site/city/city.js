// The confirm-your-city page (crew.hairbysusy.com/city/?k=...). The key in the link is the person's
// own; it is taken out of the address bar right away and only ever sent to this site's server.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const MAX = 2;
  const FULL = 'Choose up to 2 cities.';
  const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const key = new URLSearchParams(location.search).get('k') || new URLSearchParams(location.hash.slice(1)).get('k') || '';
  const demo = key === 'demo';
  if (location.search || location.hash) history.replaceState(null, '', location.pathname);

  const show = (id) => ['ask', 'done', 'bad'].forEach((s) => { $(s).hidden = s !== id; });
  if (!demo && !KEY_RE.test(key)) { show('bad'); return; }
  if (demo) {
    const b = document.createElement('div');
    b.className = 'preview';
    b.textContent = 'Preview · nothing is saved from here';
    document.body.appendChild(b);
    document.body.classList.add('is-preview');
  }

  const presets = [...document.querySelectorAll('#ask [data-value]')];
  let custom = [];
  const picked = () => presets.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.value).concat(custom);
  const setErr = (msg) => { $('err').textContent = msg; };
  const clearErr = () => { $('err').textContent = ''; };

  presets.forEach((b) => {
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') === 'true';
      if (!on && picked().length >= MAX) return setErr(FULL);
      b.setAttribute('aria-pressed', on ? 'false' : 'true');
      clearErr();
    });
  });

  // Same clean-up as the sign-up form's "Somewhere else?" box.
  function cleanLoc(t) {
    t = String(t || '').replace(/;+/g, ' ').replace(/[^\p{L}\p{M} .,'\-]/gu, '').replace(/\s*,[\s,]*/g, ', ').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').slice(0, 40);
    if (t && t === t.toLowerCase()) t = t.replace(/(^|[\s\-])\p{L}/gu, (m) => m.toUpperCase());
    return t.replace(/,\s*(\p{L}{2})$/u, (m, c) => ', ' + c.toUpperCase()); // "Charlotte, nc" -> "Charlotte, NC"
  }
  function drawCustom() {
    const box = $('customLocs');
    box.textContent = '';
    custom.forEach((name) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-pressed', 'true');
      b.setAttribute('aria-label', 'Remove ' + name);
      const t = document.createElement('span'); t.className = 'tick'; t.textContent = '✓';
      const x = document.createElement('span'); x.className = 'x'; x.setAttribute('aria-hidden', 'true'); x.textContent = '×';
      b.append(t, document.createTextNode(name), x);
      b.addEventListener('click', () => { custom = custom.filter((n) => n !== name); drawCustom(); clearErr(); });
      box.appendChild(b);
    });
  }
  // Returns false when the city couldn't be added (the reason shows under the cities).
  function addLoc() {
    const name = cleanLoc($('otherLoc').value);
    if (!name) { $('otherLoc').value = ''; return true; }
    const preset = presets.find((b) => b.dataset.value.toLowerCase() === name.toLowerCase());
    const already = preset ? preset.getAttribute('aria-pressed') === 'true' : custom.some((n) => n.toLowerCase() === name.toLowerCase());
    if (!already && picked().length >= MAX) { setErr(FULL); return false; }
    $('otherLoc').value = '';
    if (preset) preset.setAttribute('aria-pressed', 'true');
    else if (!already) { custom.push(name); drawCustom(); }
    clearErr();
    return true;
  }
  $('addLoc').addEventListener('click', addLoc);
  $('otherLoc').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLoc(); } });
  $('otherLoc').addEventListener('input', clearErr);

  const say = (list) => (list.length === 1 ? list[0] : list[0] + ' and ' + list[1]);
  let busy = false;
  $('save').addEventListener('click', async () => {
    if (busy) return;
    if ($('otherLoc').value.trim() && !addLoc()) return;
    let cities = picked();
    if (!cities.length) return setErr('Choose the city where you take clients, or add your own.');
    if (cities.length > MAX) return setErr(FULL);
    busy = true;
    $('save').disabled = true;
    $('save').textContent = 'Saving…';
    try {
      if (!demo) {
        const r = await fetch('/api/crew/city', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ k: key, cities }),
          credentials: 'omit',
          cache: 'no-store',
        });
        if (r.status === 404) { show('bad'); return; }
        const out = await r.json().catch(() => ({}));
        if (!r.ok || !out.ok) throw new Error('not saved');
        if (Array.isArray(out.cities) && out.cities.length) cities = out.cities;
      }
      $('doneText').textContent = 'We’ve saved ' + say(cities) + '. Once you’re approved, you’ll hear from us when there’s a job there.';
      show('done');
      window.scrollTo(0, 0);
    } catch (e) {
      setErr('That didn’t save. Check your connection and try again.');
    } finally {
      busy = false;
      $('save').disabled = false;
      $('save').textContent = 'Save';
    }
  });
})();
