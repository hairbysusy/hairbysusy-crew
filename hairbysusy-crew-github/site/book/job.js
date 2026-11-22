// The client's private job page: /book/job/?j=<job>&k=<key>
// Shows the job as it stands. Right after the checkout it waits for Wix to confirm the payment;
// an unpaid job can be paid from here.
'use strict';

(() => {
  const H = window.HBS;
  const $ = (id) => document.getElementById(id);
  const VIEWS = ['vLoading', 'vPosted', 'vUnpaid', 'vConfirm', 'vEnd'];

  const q = new URLSearchParams(location.search);
  const j = q.get('j') || '';
  const k = q.get('k') || '';
  const justPaid = q.get('paid') === '1';
  const postError = q.get('e') || '';
  let confirmTries = justPaid ? 0 : Infinity;
  let timer = 0;
  let busy = false;
  let last = null;

  try { sessionStorage.removeItem('hbs.posted'); } catch { /* storage off */ }

  function show(id) {
    for (const v of VIEWS) $(v).hidden = v !== id;
  }
  function buttons({ pay = '', newJob = false } = {}) {
    $('payBtn').hidden = !pay;
    $('payBtn').textContent = pay;
    $('newJob').hidden = !newJob;
  }
  function end(eyebrow, title, text, job) {
    $('endEyebrow').textContent = eyebrow;
    $('endTitle').textContent = title;
    $('endText').textContent = text;
    meta(job);
    show('vEnd');
    buttons({ newJob: true });
  }

  if (!H.ID_RE.test(j) || !H.KEY_RE.test(k)) {
    end('Your job', "This link isn't complete.", 'Open the full link to your job page, or email info@hairbysusy.com and we will send it again.', null);
    return;
  }
  // Keep only the job's own link in the address bar (and in a bookmark).
  history.replaceState(null, '', H.jobUrl(j, k));

  function meta(job) {
    const line = job
      ? job.hood + ', ' + job.state + ' · ' + job.dateLabel + ' · ' + job.timeLabel + ' · $' + Number(job.budget).toLocaleString('en-US')
        + (job.count > 1 ? ' each · ' + job.count + ' stylists' : '')
      : '';
    for (const el of document.querySelectorAll('[data-meta]')) {
      el.textContent = line;
      el.hidden = !line;
    }
  }

  function ago(iso) {
    const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
    if (!Number.isFinite(mins) || mins < 1) return 'Just now';
    if (mins < 60) return mins + ' min ago';
    const hours = Math.floor(mins / 60);
    return hours < 24 ? hours + ' hr ago' : Math.floor(hours / 24) + ' d ago';
  }

  function renderPosted(job) {
    meta(job);
    const yes = Array.isArray(job.yes) ? job.yes : [];
    const matched = job.status === 'matched';
    $('postedTitle').textContent = matched ? "You're matched." : 'Job posted.';
    const stage = matched ? 3 : 1; // 0 posted, 1 saying yes, 2 we check, 3 matched
    ['tPosted', 'tYes', 'tCheck', 'tMatched'].forEach((id, i) => {
      const li = $(id);
      li.className = i < stage ? 'done' : i === stage ? 'now' : '';
      if (i === stage) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    $('nextLine').textContent = matched ? "You're matched with a stylist our team checked." : 'Next, our team checks their work and calls them.';
    $('yesNum').textContent = String(yes.length);
    $('yesLbl').textContent = yes.length === 1 ? 'stylist said yes' : 'stylists said yes';
    $('yesCity').textContent = job.city;
    const list = $('yesList');
    list.textContent = '';
    for (const y of yes.slice().reverse()) {
      const li = document.createElement('li');
      li.innerHTML = '<span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>A stylist said yes</span><span></span>';
      li.lastChild.textContent = ago(y.at);
      list.appendChild(li);
    }
    list.hidden = !yes.length;
    $('yesWaiting').hidden = yes.length > 0;
    show('vPosted');
    buttons();
  }

  const PAY_MESSAGES = {
    payments_off: "Payments aren't switched on yet. Your job is saved, and you can pay here once they are.",
    payments_failed: "We couldn't open the checkout. Tap Pay to try again.",
    too_many: "The checkout was opened too many times for this job. Email info@hairbysusy.com and we'll help.",
    expired: 'This job can no longer be paid for.',
  };

  function renderUnpaid(job, note) {
    meta(job);
    $('uFee').textContent = job.fee;
    const err = $('payErr');
    err.textContent = note || '';
    err.hidden = !note;
    show('vUnpaid');
    buttons({ pay: 'Pay ' + job.fee });
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(load, ms);
  }

  function render(data) {
    const job = data.job;
    last = job;
    H.saveJob({ j, k, label: job.dateLabel + ' · ' + job.city });
    clearTimeout(timer);
    if (job.status === 'posted' || job.status === 'matched') {
      renderPosted(job);
      schedule(60000);
    } else if (job.status === 'unpaid') {
      if (data.payment === 'pending') {
        meta(job);
        $('confirmText').textContent = "Your payment is processing. We'll post your job as soon as it clears. You don't need to pay again.";
        show('vConfirm');
        buttons();
        schedule(15000);
      } else if (confirmTries < 15) {
        confirmTries += 1;
        meta(job);
        $('confirmText').textContent = 'This takes a few seconds.';
        show('vConfirm');
        buttons();
        schedule(3000);
      } else {
        let note = PAY_MESSAGES[postError] || '';
        if (justPaid && confirmTries !== Infinity) note = "We haven't received your payment yet. If you just paid, wait a minute and refresh this page before paying again.";
        if (data.payment === 'payments_off') note = PAY_MESSAGES.payments_off;
        renderUnpaid(job, note);
      }
    } else if (job.status === 'expired') {
      end('Not posted', 'This job expired.', "The booking fee wasn't paid within 48 hours, or the call time passed. Nothing was charged.", job);
    } else if (job.status === 'refunded') {
      end('Refunded', 'Booking fee refunded.', 'Your booking fee was refunded in full. It can take a few business days to show on your card.', job);
    } else {
      end('Closed', 'This job is closed.', 'Questions? Email info@hairbysusy.com.', job);
    }
  }

  async function load() {
    if (busy) return;
    const r = await H.api('/api/book/job', { j, k });
    if (r.status === 200 && r.data && r.data.job) { render(r.data); return; }
    if (r.status === 404) {
      end('Your job', "We can't find this job.", 'Check that you opened the full link, or email info@hairbysusy.com.', null);
      return;
    }
    if (!last) {
      $('loadingText').textContent = r.status === 0 ? 'No connection. Retrying…' : "We couldn't load your job. Retrying…";
      show('vLoading');
    }
    schedule(10000);
  }

  $('payBtn').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    $('payBtn').disabled = true;
    $('payWorking').hidden = false;
    const r = await H.api('/api/book/pay', { j, k });
    const d = r.data || {};
    if (r.status === 200 && d.payUrl && H.checkoutOk(d.payUrl)) {
      location.assign(d.payUrl);
      return;
    }
    busy = false;
    $('payBtn').disabled = false;
    $('payWorking').hidden = true;
    if (d.job) { confirmTries = Infinity; render({ job: d.job, payment: d.payment || '' }); }
    if (d.error === 'pending' || (r.status === 200 && d.job)) return;
    if (d.error === 'expired') return;
    const err = $('payErr');
    err.textContent = PAY_MESSAGES[d.error] || (r.status === 0 ? 'No connection. Check your internet and try again.' : "We couldn't open the checkout. Try again in a minute.");
    err.hidden = false;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !busy) load();
    else clearTimeout(timer);
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) { busy = false; $('payBtn').disabled = false; $('payWorking').hidden = true; load(); }
  });

  load();
})();
