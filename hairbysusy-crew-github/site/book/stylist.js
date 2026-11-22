// A stylist's own page for one HBS client job: /book/s/?j=<job>&t=<her key>
// She sees the post and answers ("I'm available" or "Not this time"), then where she stands:
// waiting while HBS checks, booked (the client's first name, and the address from the day
// before), or not picked.
'use strict';

(() => {
  const H = window.HBS;
  const $ = (id) => document.getElementById(id);
  const VIEWS = ['vLoading', 'vOpen', 'vYes', 'vBooked', 'vEnd'];

  const q = new URLSearchParams(location.search);
  const j = q.get('j') || '';
  const t = q.get('t') || '';
  let timer = 0;
  let busy = false;
  let last = null;

  function show(id) {
    for (const v of VIEWS) $(v).hidden = v !== id;
    $('openActions').hidden = id !== 'vOpen';
    $('otherActions').hidden = id === 'vOpen' || id === 'vLoading';
  }

  function end(eyebrow, title, text) {
    $('endEyebrow').textContent = eyebrow;
    $('endTitle').textContent = title;
    $('endText').textContent = text;
    show('vEnd');
  }

  if (!H.ID_RE.test(j) || !/^[A-Za-z0-9_-]{22}$/.test(t)) {
    end('Your job', "This link isn't complete.", 'Open the full link from your text. If it still doesn’t work, email info@hairbysusy.com.');
    return;
  }

  const money = (n) => '$' + Number(n || 0).toLocaleString('en-US');
  function ago(iso) {
    const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
    if (!Number.isFinite(mins) || mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    const hours = Math.floor(mins / 60);
    return hours < 24 ? hours + ' hr ago' : Math.floor(hours / 24) + ' d ago';
  }

  function fill(v) {
    const values = {
      hood: v.hood,
      city: v.city,
      pay: money(v.budget),
      when: v.dateLabel + ' · Call ' + v.timeLabel,
      jobline: v.kind + ' · ' + v.hair.join(', ') + ' · ' + v.count + (v.count === 1 ? ' stylist' : ' stylists'),
      note: v.note,
      client: v.client,
      paywho: money(v.budget) + ' · the client pays you',
    };
    for (const el of document.querySelectorAll('[data-f]')) el.textContent = values[el.dataset.f] || '';
    for (const el of document.querySelectorAll('[data-note]')) el.hidden = !v.note;
    $('postedLine').textContent = 'New job · Posted ' + ago(v.postedAt);
  }

  function render(v) {
    last = v;
    fill(v);
    $('err').hidden = true;
    if (v.status === 'open') { show('vOpen'); return; }
    if (v.status === 'yes') { show('vYes'); return; }
    if (v.status === 'booked') {
      $('beThere').textContent = 'Be there at ' + v.timeLabel + ' on ' + v.dateLabel + ', ready to work.';
      const text = $('addrText');
      const sub = $('addrSub');
      sub.textContent = '';
      if (v.address) {
        text.textContent = v.address;
        text.classList.remove('muted');
        sub.append(v.hood + ', ' + v.city + ' · ');
        const a = document.createElement('a');
        a.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(v.address + ', ' + v.city);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = 'Get directions';
        sub.append(a);
      } else {
        text.textContent = v.addressState === 'day_before' ? 'The day before the job' : 'Waiting for the client';
        text.classList.add('muted');
        sub.textContent = v.hood + ', ' + v.city + (v.addressState === 'day_before' ? '' : '. It shows here as soon as the client adds it.');
      }
      show('vBooked');
      return;
    }
    if (v.status === 'not_picked') return end(v.hood + ' · ' + v.dateLabel, 'This job went to another stylist.', "Thank you for saying yes. We'll send you the next job in " + v.city + '.');
    if (v.status === 'no') return end(v.hood + ' · ' + v.dateLabel, 'Got it. Not this time.', "We'll send you the next job in " + v.city + '.');
    if (v.status === 'cancelled') return end(v.hood + ' · ' + v.dateLabel, 'This job was cancelled.', "You don't need to hold that time. This doesn't count against you.");
    return end(v.hood + ' · ' + v.dateLabel, 'This job is closed.', "It's filled, or its time has passed. We'll send you the next job.");
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(load, ms);
  }

  async function load() {
    if (busy) return;
    const r = await H.api('/api/book/stylist', { j, t });
    if (r.status === 200 && r.data.job) {
      render(r.data.job);
      if (['open', 'yes', 'booked'].includes(r.data.job.status)) schedule(r.data.job.status === 'yes' ? 30000 : 120000);
      return;
    }
    if (r.status === 404) return end('Your job', "We can't find this job.", 'Open the full link from your text. If it still doesn’t work, email info@hairbysusy.com.');
    if (!last) { $('loadingText').textContent = r.status === 0 ? 'No connection. Retrying…' : "We couldn't load the job. Retrying…"; show('vLoading'); }
    schedule(10000);
  }

  async function answer(which) {
    if (busy) return;
    busy = true;
    $('yesBtn').disabled = true;
    $('noBtn').disabled = true;
    const r = await H.api('/api/book/answer', { j, t, answer: which });
    busy = false;
    $('yesBtn').disabled = false;
    $('noBtn').disabled = false;
    if (r.data && r.data.job) {
      render(r.data.job);
      window.scrollTo(0, 0);
      if (r.status === 409) {
        const e = $('err');
        e.textContent = 'This job just closed, so your answer wasn’t needed.';
        e.hidden = false;
      }
      if (r.data.job.status === 'yes') schedule(30000);
      return;
    }
    const e = $('err');
    e.textContent = r.status === 0 ? 'No connection. Check your internet and try again.' : 'That didn’t go through. Try again in a minute.';
    e.hidden = false;
  }

  $('yesBtn').addEventListener('click', () => answer('yes'));
  $('noBtn').addEventListener('click', () => answer('no'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !busy) load();
    else clearTimeout(timer);
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) load(); });

  load();
})();
