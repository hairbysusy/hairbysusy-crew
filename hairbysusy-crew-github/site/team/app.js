/* Susy's Crew. Built from the claude.ai version by build_team.py. */
(function(){
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const SPEED = {'Within the hour':0,'Same day':1,'Within 24 hours':2};
  const SPEED_CLASS = ['fast','mid','slow'];
  const BASE_CITIES = ['Los Angeles','New York'];

  let db = null, crewCol = null, jobsCol = null;
  let people = [], jobs = [], gotPeople = false, gotJobs = false;
  let view = 'jobs', statusF = 'all', q = '', openId = null;

  /* ---------- helpers ---------- */
  function toast(t){ const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2000); }
  async function copy(text, okMsg){
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch(e){ toast('Copy is blocked here. Press and hold to copy instead.'); }
  }
  const first = n => (n || '').trim().split(/\s+/)[0] || '';
  const cityKey = c => (c || '').trim().toLowerCase().replace(/\s+/g,' ').replace(/^nyc$|^new york city$|^brooklyn$|^manhattan$/, 'new york').replace(/^la$/, 'los angeles');
  const cityName = c => { const k = cityKey(c); if (!k) return 'No location'; return k.replace(/(^|[\s\-,.'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\bDc\b/, 'DC').replace(/\bUk\b/, 'UK').replace(/\bUsa\b/, 'USA'); };
  /* a person can work in several places, stored as one string joined with '; ' (a place may be "City, Country") */
  const locsOf = p => String((p && p.city) || '').split(';').map(x => x.trim()).filter(Boolean);
  const placeMain = c => cityKey(c).split(',')[0].trim();
  const worksIn = (p, c) => locsOf(p).some(l => placeMain(l) === placeMain(c));
  const locLabel = p => { const l = locsOf(p).map(cityName); return l.length ? l.join(' · ') : 'No location'; };
  const cleanLocs = t => [...new Set(String(t || '').split(';').map(x => cityName(x)).filter(x => x !== 'No location'))].join('; ');
  function e164(p, cty){
    let d = String(p || '').replace(/[^\d+]/g, '');
    const plus = d.startsWith('+'); d = d.replace(/\+/g, '');
    if (!d) return '';
    if (plus) return d;
    const k = cityKey(cty);
    if (d.length === 11 && d.startsWith('0') && /lagos|abuja|port harcourt|ibadan|nigeria/.test(k)) return '234' + d.slice(1);
    if (d.length === 11 && d.startsWith('07') && /london|manchester|birmingham|england|\buk\b/.test(k)) return '44' + d.slice(1);
    if (d.length === 10) return '1' + d;
    return d;
  }
  const idFor = p => { const d = e164(p.phone, p.city); return d.length >= 7 ? 'p' + d.slice(-15) : 'n' + (p.name || 'person').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40); };
  const safeISO = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toISOString(); };
  const isAssist = r => /assist|both/i.test(r || '');
  const isFull = r => /full|both/i.test(r || '');
  const roleMatch = (r, f) => f === 'assist' ? isAssist(r) : f === 'full' ? isFull(r) : true;
  const roleWord = (f, n) => f === 'assist' ? (n === 1 ? 'assistant' : 'assistants') : f === 'full' ? (n === 1 ? 'full-job stylist' : 'full-job stylists') : (n === 1 ? 'person' : 'people');
  const igUrl = h => { const s = String(h || '').replace(/^@/, '').trim(); return s ? 'https://www.instagram.com/' + encodeURIComponent(s) + '/' : ''; };
  const safeUrl = u => { u = String(u || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch(e){ return ''; } };
  function fmtDate(iso){ if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; return d.toLocaleDateString('en-US', {month:'short', day:'numeric'}); }
  function fmtTimeStamp(iso){ if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const today = new Date().toDateString() === d.toDateString(); return (today ? '' : fmtDate(iso) + ', ') + d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'}); }
  const todayISO = () => new Date().toLocaleDateString('en-CA');
  function dayLabel(ymd, long){
    if (!ymd) return 'Date not set';
    const d = new Date(ymd + 'T12:00:00'); if (isNaN(d)) return ymd;
    const t = new Date(todayISO() + 'T12:00:00'); const diff = Math.round((d - t) / 864e5);
    const base = d.toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'});
    if (long) return base;
    return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : base;
  }
  function timeLabel(hm){ if (!hm) return ''; const [h, m] = hm.split(':').map(Number); if (isNaN(h)) return ''; return new Date(2000,0,1,h,m||0).toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'}); }
  function jobMessage(j, firstName){
    let det = String(j.details || '').trim(); if (det && !/[.!?]$/.test(det)) det += '.';
    const when = dayLabel(j.date, true) + (j.time ? ' at ' + timeLabel(j.time) : '');
    return 'Hi ' + (firstName || '{name}') + ', this is the Hairbysusy team. Susy has a job in ' + cityName(j.city) + ' on ' + when + '.' + (det ? ' ' + det : '') + " Are you available? Reply YES or NO. If you're booked, Susy will call you with the brief.";
  }
  /* ---------- email (Gmail) for job offers, until texting is switched on ---------- */
  const GMAIL = 'https://mail.google.com/mail/?view=cm&fs=1';
  const hasEmail = p => !!p && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(p.email || '').trim());
  function jobEmail(j){
    let det = String(j.details || '').trim(); if (det && !/[.!?]$/.test(det)) det += '.';
    const when = dayLabel(j.date, true) + (j.time ? ' at ' + timeLabel(j.time) : '');
    return {
      subject: 'Job available: ' + cityName(j.city) + ', ' + when,
      body: 'Hi,\n\nThis is the Hairbysusy team. Susy has a job in ' + cityName(j.city) + ' on ' + when + '.' + (det ? '\n\n' + det : '') +
        '\n\nAre you available? Reply YES or NO to this email. If you\u2019re booked, Susy will call you with the brief.' +
        '\n\nReplying YES is a commitment. If you back out within 24 hours of the job or don\u2019t show up, you\u2019ll be permanently removed from the team.\n\nHairbysusy'
    };
  }
  const gmailLink = (bcc, m) => GMAIL + '&bcc=' + encodeURIComponent(bcc.join(',')) + '&su=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body);
  const mailLink = (bcc, m) => 'mailto:?bcc=' + encodeURIComponent(bcc.join(',')) + '&subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body);
  const emailsOf = list => [...new Set(list.filter(hasEmail).map(p => String(p.email).trim()))];

  /* ---------- let people know: booked, filled, cancelled ---------- */
  let nt = null; // the open "let people know" sheet: { id, items, lead }
  const jobWhen = j => dayLabel(j.date, true) + (j.time ? ' at ' + timeLabel(j.time) : '');
  function noticeEmail(kind, j, name){
    const where = cityName(j.city), when = jobWhen(j);
    let det = String(j.details || '').trim(); if (det && !/[.!?]$/.test(det)) det += '.';
    if (kind === 'booked') return {
      subject: 'You’re booked: ' + where + ', ' + when,
      body: 'Hi ' + (name || 'there') + ',\n\nYou’re booked for Susy’s job in ' + where + ' on ' + when + '.' + (det ? '\n\n' + det : '') +
        '\n\nThis is a confirmed job. If you back out within 24 hours of it or don’t show up, you’ll be permanently removed from the Hairbysusy On-Call Team.\n\nReply to this email if you have any questions before the job.\n\nHairbysusy'
    };
    if (kind === 'filled') return {
      subject: 'Job filled: ' + where + ', ' + when,
      body: 'Hi' + (name ? ' ' + name : '') + ',\n\nThe job in ' + where + ' on ' + when + ' has been filled, so you don’t need to hold that time.\n\nThank you. You’ll hear from us when the next job comes in.\n\nHairbysusy'
    };
    return {
      subject: 'Job cancelled: ' + where + ', ' + when,
      body: 'Hi' + (name ? ' ' + name : '') + ',\n\nThe job in ' + where + ' on ' + when + ' has been cancelled, so you don’t need to hold that time. This doesn’t count against you.\n\nYou’ll hear from us when the next job comes in.\n\nHairbysusy'
    };
  }
  function noticeText(kind, j, name){
    const lead = 'Hi ' + (name || 'there') + ', this is the Hairbysusy team. ', where = cityName(j.city), when = jobWhen(j);
    if (kind === 'booked') return lead + 'You’re booked for Susy’s job in ' + where + ' on ' + when + '. This is a confirmed job. If you back out within 24 hours of it or don’t show up, you’ll be permanently removed from the team.';
    if (kind === 'filled') return lead + 'The job in ' + where + ' on ' + when + ' has been filled, so you don’t need to hold that time. Thank you.';
    return lead + 'The job in ' + where + ' on ' + when + ' has been cancelled, so you don’t need to hold that time. This doesn’t count against you.';
  }
  // Who hears about it: filled = people who said yes or haven't replied (not the booked ones); cancelled = everyone who was asked except those who said no.
  function noticeRecipients(j, kind){
    const states = kind === 'filled' ? ['yes', 'asked'] : ['booked', 'yes', 'asked'];
    return Object.entries(j.people || {}).filter(([, x]) => states.includes(x.state || 'to_ask')).map(([pid, x]) => ({ pid, x, p: crewById(pid) || {} }));
  }
  const jobIsFull = j => Object.values(j.people || {}).filter(x => x.state === 'booked').length >= (Number(j.needed) || 1);
  const dateGone = j => !!(j.date && j.date < todayISO());
  function noticeItemsFor(j){
    if (j.status === 'cancelled') return [{ kind: 'cancelled' }];
    const items = Object.entries(j.people || {}).filter(([, x]) => x.state === 'booked' && !x.confirmed_at).map(([pid]) => ({ kind: 'booked', pid }));
    if (j.status === 'filled' || jobIsFull(j)) items.push({ kind: 'filled' });
    return items;
  }
  // How many people on this job haven't been told where they stand yet.
  function pendingNotices(j){
    if (j.sample || j.status === 'draft' || dateGone(j)) return 0;
    if (j.status === 'cancelled') return noticeRecipients(j, 'cancelled').filter(r => !r.x.cancelled_told_at).length;
    let n = Object.values(j.people || {}).filter(x => x.state === 'booked' && !x.confirmed_at).length;
    if (j.status === 'filled' || jobIsFull(j)) n += noticeRecipients(j, 'filled').filter(r => !r.x.filled_told_at).length;
    return n;
  }


  const isPastJob = j => j.status === 'filled' || j.status === 'cancelled' || (j.date && j.date < todayISO());
  const crewById = id => people.find(p => p.id === id);

  /* ---------- views ---------- */
  function setView(v){
    view = v;
    document.querySelectorAll('.wrap > .seg [data-view]').forEach(b => b.setAttribute('aria-selected', b.dataset.view === v ? 'true' : 'false'));
    document.querySelectorAll('section.view').forEach(s => s.classList.toggle('on', s.id === 'view-' + v));
    render();
  }
  document.querySelectorAll('.wrap > .seg [data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  const approved = () => people.filter(p => p.status === 'approved');

  function render(){
    if (!gotPeople || !gotJobs) return;
    const ap = approved(), nw = people.filter(p => p.status === 'new');
    const open = jobs.filter(j => !isPastJob(j));
    const yesWaiting = open.reduce((n, j) => n + Object.values(j.people || {}).filter(x => x.state === 'yes').length, 0);
    $('summary').innerHTML = '<b>' + ap.length + '</b> approved · <b>' + open.length + '</b> open ' + (open.length === 1 ? 'job' : 'jobs') + ' · <b>' + nw.length + '</b> to review';
    $('reviewCount').hidden = !nw.length; $('reviewCount').textContent = nw.length;
    $('yesCount').hidden = !yesWaiting; $('yesCount').textContent = yesWaiting;
    $('examples').hidden = !(people.some(p => p.sample) || jobs.some(j => j.sample));
    if (view === 'jobs') renderJobs();
    if (view === 'review') renderReview();
    if (view === 'all') renderAll();
    if (nt && $('noticeSheet').classList.contains('on')) renderNotices();
    if (mcp && wixLast && !wixBusy && wixPending().length) wixSoon();
  }

  /* ---------- jobs ---------- */
  function personRow(j, pid, x){
    const p = crewById(pid) || {};
    const name = x.name || p.name || 'Unknown';
    const phone = x.phone || p.phone || '';
    const num = e164(phone, p.city || j.city);
    const sp = SPEED[p.response_time] ?? -1;
    const tags = (sp >= 0 ? '<span class="pill ' + SPEED_CLASS[sp] + '">' + esc(p.response_time) + '</span>' : '') +
      String(p.specialties || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 3).map(s => '<span class="pill">' + esc(s) + '</span>').join('');
    const call = '<a class="btn small solid" href="tel:+' + esc(num) + '">Call ' + esc(first(name)) + '</a>';
    let acts = '', cls = '';
    const st = x.state || 'to_ask';
    const J = ' data-job="' + esc(j.id) + '" data-pid="' + esc(pid) + '"';
    if (st === 'booked') { cls = 'booked'; acts = call + (x.confirmed_at ? '' : '<button class="btn small" type="button" data-jact="confirm"' + J + '>Send confirmation</button>') + '<button class="btn small" type="button" data-act="yes"' + J + '>Undo</button>'; }
    else if (st === 'yes') { cls = 'yes'; acts = call + '<button class="btn small" type="button" data-act="booked"' + J + '>Booked</button>'; }
    else if (st === 'no') { cls = 'no'; acts = '<button class="btn small" type="button" data-act="asked"' + J + '>Undo</button>'; }
    else {
      const body = encodeURIComponent(jobMessage(j, first(name)));
      acts = (st === 'to_ask' ? '<a class="btn small" data-act="asked"' + J + ' href="sms:+' + esc(num) + '?&body=' + body + '">Text</a>' : '') +
        '<button class="btn small" type="button" data-act="yes"' + J + '>Yes</button><button class="btn small" type="button" data-act="no"' + J + '>No</button>';
    }
    const when = st === 'booked' ? (x.confirmed_at ? 'Confirmation sent ' + fmtTimeStamp(x.confirmed_at) : 'Confirmation not sent yet') : st === 'yes' || st === 'no' ? (x.replied_at ? 'Replied ' + fmtTimeStamp(x.replied_at) : '') : st === 'asked' ? (x.asked_at ? 'Asked ' + fmtTimeStamp(x.asked_at) : 'Asked') : st === 'to_ask' ? 'Not asked yet' : '';
    return '<div class="prow ' + cls + '"><span class="who">' + esc(name) + '</span><div class="acts">' + acts + '</div>' +
      (x.reply ? '<div class="reply">“' + esc(x.reply) + '”</div>' : '') +
      '<div class="info">' + tags + (when ? '<span>' + esc(when) + '</span>' : '') + '<span class="num">' + esc(phone) + '</span></div></div>';
  }

  function jobCard(j){
    const list = Object.entries(j.people || {});
    const by = s => list.filter(([, x]) => (x.state || 'to_ask') === s);
    const booked = by('booked'), yes = by('yes'), no = by('no'), waiting = list.filter(([, x]) => ['asked','to_ask'].includes(x.state || 'to_ask'));
    const need = Number(j.needed) || 1;
    let pill;
    if (j.status === 'cancelled') pill = '<span class="pill pass">Cancelled</span>';
    else if (j.status === 'filled' || booked.length >= need) pill = '<span class="pill new">Booked</span>';
    else if (j.status === 'draft') pill = '<span class="pill slow">Not sent yet</span>';
    else if (yes.length) pill = '<span class="pill ok">' + yes.length + ' available</span>';
    else pill = '<span class="pill mid">Waiting on replies</span>';
    const title = cityName(j.city) + ' · ' + dayLabel(j.date) + (j.time ? ' · ' + timeLabel(j.time) : '');
    let meta = [];
    if (j.status !== 'draft' && j.sent_at) meta.push('Sent ' + fmtTimeStamp(j.sent_at) + (j.sent_by === 'claude' ? ' by Claude' : j.sent_by === 'email' ? ' by email' : ''));
    if (j.last_checked) meta.push('Replies checked ' + fmtTimeStamp(j.last_checked));
    meta.push(list.length + ' asked · ' + yes.length + ' yes · ' + no.length + ' no');
    const J = ' data-job="' + esc(j.id) + '"';
    const group = (label, rows) => rows.length ? '<div class="grp"><p class="label">' + label + '</p>' + rows.map(([pid, x]) => personRow(j, pid, x)).join('') + '</div>' : '';
    const past = isPastJob(j);
    const toAsk = by('to_ask').map(([pid]) => crewById(pid)).filter(hasEmail);
    const m = jobEmail(j), bcc = emailsOf(toAsk);
    const askNote = !past && by('to_ask').length ? '<div class="draftnote"><span>' + (j.status === 'draft' ? 'Not sent yet.' : by('to_ask').length + ' not asked yet.') + '</span>' +
      (bcc.length ? '<div class="acts"><a class="btn small solid" target="_blank" rel="noopener" data-jact="emailed"' + J + ' href="' + esc(gmailLink(bcc, m)) + '">Email ' + bcc.length + ' in Gmail</a><a class="btn small" data-jact="emailed"' + J + ' href="' + esc(mailLink(bcc, m)) + '">Mail app</a></div>' : '') +
      '<span class="meta">' + (bcc.length < by('to_ask').length ? 'Anyone without an email: tap Text next to their name.' : 'Or tap Text next to each person to send from your phone.') + '</span></div>' : '';
    const owed = pendingNotices(j);
    const tellNote = owed ? '<div class="draftnote"><span>' + (j.status === 'cancelled' ? 'Job cancelled. ' : j.status === 'filled' || jobIsFull(j) ? 'Job filled. ' : '') +
      owed + (owed === 1 ? ' person doesn’t' : ' people don’t') + ' know where they stand yet.</span>' +
      '<div class="acts"><button class="btn small solid" type="button" data-jact="notify"' + J + '>Let them know</button></div></div>' : '';
    return '<article class="job' + (yes.length && !past ? ' hot' : '') + '">' +
      '<div class="jhead"><div><h3 class="jtitle">' + esc(title) + (j.sample ? ' <span class="u10 pill ex">Example</span>' : '') + '</h3>' +
        '<p class="jsub">Need ' + need + ' ' + roleWord(j.role, need) + '</p></div>' + pill + '</div>' +
      (j.details ? '<p class="jdetails">' + esc(j.details) + '</p>' : '') +
      askNote + tellNote +
      '<div class="jmeta">' + meta.map(m => '<span>' + esc(m) + '</span>').join('') + '</div>' +
      group('Booked', booked) + group('Available. Call them with the brief', yes) + group(j.status === 'draft' ? 'To ask' : 'Waiting', waiting) + group('Not available', no) +
      (past ? (j.status === 'cancelled' || j.status === 'filled' ? '<div class="jfoot"><button class="btn small" type="button" data-jact="reopen"' + J + '>Reopen</button><button class="btn small danger" type="button" data-jact="delete"' + J + '>Delete</button></div>' : '<div class="jfoot"><button class="btn small danger" type="button" data-jact="delete"' + J + '>Delete</button></div>')
        : '<div class="jfoot"><button class="btn small" type="button" data-jact="filled"' + J + '>Mark filled</button><button class="btn small danger" type="button" data-jact="cancel"' + J + '>Cancel job</button></div>') +
      '</article>';
  }

  function renderJobs(){
    // A filled or cancelled job stays up top until everyone on it has been told.
    const active = jobs.filter(j => !isPastJob(j) || pendingNotices(j) > 0).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)));
    const past = jobs.filter(j => isPastJob(j) && !(pendingNotices(j) > 0)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    $('jobsList').innerHTML = active.length ? active.map(jobCard).join('')
      : '<div class="empty"><b>No open jobs</b>Tap Job available to send one. Your crew gets the message, and whoever says yes shows up here.</div>';
    $('pastWrap').hidden = !past.length;
    $('pastSummary').textContent = 'Past jobs (' + past.length + ')';
    $('pastList').innerHTML = past.map(jobCard).join('');
  }

  async function updateJob(id, data){
    try { await jobsCol.doc(id).update(data); return true; } catch(e){ writeFail(e); return false; }
  }
  function onJobClick(e){
    const a = e.target.closest('[data-act],[data-jact]'); if (!a) return;
    const id = a.dataset.job, pid = a.dataset.pid, now = new Date().toISOString();
    if (a.dataset.act) {
      const act = a.dataset.act;
      const patch = { state: act };
      if (act === 'asked') patch.asked_at = now;
      if (act === 'yes' || act === 'no') patch.replied_at = now;
      if (act === 'booked') patch.booked_at = now;
      const extra = act === 'asked' && a.tagName === 'A' ? { status: 'sent', sent_at: (jobs.find(j => j.id === id) || {}).sent_at || now, sent_by: 'manual' } : {};
      if (a.tagName !== 'A') e.preventDefault();
      const before = jobs.find(x => x.id === id);
      updateJob(id, Object.assign({ people: { [pid]: patch } }, extra)).then(ok => {
        if (!ok || act !== 'booked') return;
        toast('Booked');
        if (!before) return;
        // Booking someone: send them a written confirmation. If that fills the job, tell the others too.
        const nb = Object.entries(before.people || {}).filter(([p, x]) => x.state === 'booked' && p !== pid).length + 1;
        const items = [{ kind: 'booked', pid }];
        if (nb >= (Number(before.needed) || 1) && before.status !== 'cancelled') items.push({ kind: 'filled' });
        openNotices(id, items, 'booked');
      });
      return;
    }
    const act = a.dataset.jact;
    if (act === 'confirm') return openNotices(id, [{ kind: 'booked', pid }], 'booked');
    if (act === 'notify') { const j = jobs.find(x => x.id === id); if (j) openNotices(id, noticeItemsFor(j)); return; }
    if (act === 'emailed') {
      const j = jobs.find(x => x.id === id); if (!j) return;
      const ppl = {}; Object.entries(j.people || {}).forEach(([p, x]) => { if ((x.state || 'to_ask') === 'to_ask' && hasEmail(crewById(p))) ppl[p] = { state: 'asked', asked_at: now, via: 'email' }; });
      updateJob(id, { status: 'sent', sent_at: j.sent_at || now, sent_by: j.sent_by || 'email', people: ppl });
      return toast('Your email is open. Press Send there.');
    }
    if (act === 'copyask') return copy(a.dataset.ask, 'Copied.');
    if (act === 'filled') return updateJob(id, { status: 'filled', closed_at: now }).then(ok => {
      if (!ok) return;
      const j = jobs.find(x => x.id === id);
      if (!j || !openNotices(id, noticeItemsFor(Object.assign({}, j, { status: 'filled' })))) toast('Job marked filled');
    });
    if (act === 'reopen') return updateJob(id, { status: 'sent' });
    if (act === 'cancel' || act === 'delete') {
      if (!a.dataset.armed) { a.dataset.armed = '1'; const t = a.textContent; a.textContent = 'Tap again to confirm'; setTimeout(() => { if (a.isConnected) { delete a.dataset.armed; a.textContent = t; } }, 3000); return; }
      if (act === 'cancel') return updateJob(id, { status: 'cancelled', closed_at: now }).then(ok => {
        if (ok && !openNotices(id, [{ kind: 'cancelled' }])) toast('Job cancelled');
      });
      jobsCol.doc(id).delete().then(() => toast('Job deleted')).catch(writeFail);
    }
  }
  $('jobsList').addEventListener('click', onJobClick);
  $('pastList').addEventListener('click', onJobClick);

  /* ---------- "let people know" sheet ---------- */
  const nameOf = r => r.x.name || r.p.name || '';
  const toldField = kind => kind === 'booked' ? 'confirmed_at' : kind + '_told_at';
  function listJoin(a){ return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function blockRecips(j, it){
    if (it.kind === 'booked') { const x = (j.people || {})[it.pid]; return x ? [{ pid: it.pid, x, p: crewById(it.pid) || {} }] : []; }
    // Someone just booked in this sheet may still read as "yes" for a moment; never tell them it's filled.
    const skip = new Set(nt ? nt.items.filter(i => i.kind === 'booked').map(i => i.pid) : []);
    return noticeRecipients(j, it.kind).filter(r => !skip.has(r.pid));
  }
  function noticeBlock(j, it){
    const recips = blockRecips(j, it); if (!recips.length) return '';
    const f = toldField(it.kind);
    const mailable = recips.filter(r => hasEmail(r.p)), textOnly = recips.filter(r => !hasEmail(r.p));
    const emails = emailsOf(mailable.map(r => r.p));
    const m = noticeEmail(it.kind, j, mailable.length === 1 ? first(nameOf(mailable[0])) : '');
    const allTold = recips.every(r => r.x[f]);
    const mailTold = mailable.length && mailable.every(r => r.x[f]);
    const label = it.kind === 'booked' ? 'Confirmation for ' + (first(nameOf(recips[0])) || 'them') : it.kind === 'filled' ? 'Tell the others it’s filled' : 'Tell everyone it’s cancelled';
    const names = recips.map(r => first(nameOf(r)) || 'someone');
    const who = names.length <= 3 ? listJoin(names) : names.slice(0, 2).join(', ') + ' and ' + (names.length - 2) + ' more';
    const D = ' data-nt="' + it.kind + '"' + (it.pid ? ' data-pid="' + esc(it.pid) + '"' : '');
    const toQ = emails.length === 1 ? '&to=' + encodeURIComponent(emails[0]) : '&bcc=' + encodeURIComponent(emails.join(','));
    const gm = GMAIL + toQ + '&su=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body);
    const ma = (emails.length === 1 ? 'mailto:' + encodeURIComponent(emails[0]) + '?' : 'mailto:?bcc=' + encodeURIComponent(emails.join(',')) + '&') +
      'subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body);
    const texts = textOnly.map(r => {
      const num = e164(r.x.phone || r.p.phone || '', r.p.city || j.city); if (!num) return '';
      const nm = first(nameOf(r)) || 'them';
      return '<a class="btn small' + (r.x[f] ? '' : ' solid') + '"' + D + ' data-tpid="' + esc(r.pid) + '" href="sms:+' + esc(num) + '?&body=' + encodeURIComponent(noticeText(it.kind, j, first(nameOf(r)))) + '">' + (r.x[f] ? 'Texted ' + esc(nm) + ' ✓' : 'Text ' + esc(nm)) + '</a>';
    }).join('');
    return '<div class="ntitem' + (allTold ? ' sent' : '') + '">' +
      '<p class="label">' + esc(label) + '</p>' +
      '<p class="ntto">To ' + esc(who) + (emails.length > 1 ? ' <span class="meta">(each sees only their own name)</span>' : '') + '</p>' +
      (emails.length ? '<p class="ntmsg">' + esc(m.subject + '\n\n' + m.body) + '</p>' +
        '<div class="acts"><a class="btn small' + (mailTold ? '' : ' solid') + '" target="_blank" rel="noopener"' + D + ' href="' + esc(gm) + '">' +
          (mailTold ? 'Open in Gmail again' : emails.length === 1 ? 'Email in Gmail' : 'Email ' + emails.length + ' in Gmail') + '</a>' +
          '<a class="btn small"' + D + ' href="' + esc(ma) + '">Mail app</a></div>' : '') +
      (texts ? (emails.length ? '<p class="u11 meta">No email on file for ' + esc(listJoin(textOnly.map(r => first(nameOf(r)) || 'someone'))) + '. Text instead:</p>' : '') + '<div class="acts">' + texts + '</div>' : '') +
      (allTold ? '<p class="ntsent">Sent</p>' : mailTold ? '<p class="ntsent">Email sent</p>' : '') +
    '</div>';
  }
  function renderNotices(){
    if (!nt) return false;
    const j = jobs.find(x => x.id === nt.id); if (!j) return false;
    const blocks = nt.items.map(it => noticeBlock(j, it)).filter(Boolean);
    if (!blocks.length) return false;
    const kinds = nt.items.map(i => i.kind), bk = nt.items.find(i => i.kind === 'booked');
    const bkName = bk ? first(((j.people || {})[bk.pid] || {}).name || (crewById(bk.pid) || {}).name) : '';
    let title, sub;
    if (kinds.includes('cancelled')) { title = 'Job cancelled'; sub = 'Tell everyone who was asked that they don’t need to hold the time.'; }
    else if (nt.lead === 'booked' && bkName) { title = bkName + ' is booked'; sub = 'Send the confirmation so it’s in writing.' + (kinds.includes('filled') ? ' Everyone you need is booked now, so tell the others too.' : ''); }
    else if (kinds.includes('filled')) { title = 'Job filled'; sub = bk ? 'Send the confirmation, then tell the others so they don’t hold the time.' : 'Tell the others so they don’t hold the time.'; }
    else { title = 'Send confirmations'; sub = 'So each booking is in writing.'; }
    $('ntTitle').textContent = title; $('ntSub').textContent = sub;
    $('ntList').innerHTML = blocks.join('');
    return true;
  }
  function openNotices(id, items, lead){
    if (!items || !items.length) return false;
    nt = { id, items, lead };
    if (!renderNotices()) { nt = null; return false; }
    openSheet('noticeSheet'); return true;
  }
  $('ntList').addEventListener('click', e => {
    const a = e.target.closest('[data-nt]'); if (!a || !nt) return;
    const j = jobs.find(x => x.id === nt.id); if (!j) return;
    const kind = a.dataset.nt, now = new Date().toISOString(), f = toldField(kind);
    const it = nt.items.find(i => i.kind === kind && (kind !== 'booked' || i.pid === a.dataset.pid)); if (!it) return;
    const pids = a.dataset.tpid ? [a.dataset.tpid] : blockRecips(j, it).filter(r => hasEmail(r.p)).map(r => r.pid);
    const ppl = {}; pids.forEach(p => { ppl[p] = { [f]: now }; });
    const data = { people: ppl };
    if (kind !== 'booked' && !a.dataset.tpid) data.told = { [kind]: now };
    if (kind === 'filled' && j.status !== 'filled' && j.status !== 'cancelled') Object.assign(data, { status: 'filled', closed_at: j.closed_at || now });
    updateJob(nt.id, data);
    if (a.target === '_blank') toast('Your email is open. Press Send there.');
  });

  /* ---------- new job sheet ---------- */
  const nj = { city: null, role: 'any', needed: 1, excluded: new Set() };
  function njCandidates(){ return approved().filter(p => worksIn(p, nj.city) && roleMatch(p.role, nj.role)).sort((a, b) => (SPEED[a.response_time] ?? 3) - (SPEED[b.response_time] ?? 3) || a.name.localeCompare(b.name)); }
  function njDraft(){ return { city: nj.city, role: nj.role, date: $('nj-date').value, time: $('nj-time').value, details: $('nj-details').value.trim(), needed: nj.needed }; }
  function renderNJ(){
    const counts = locCounts();
    const cities = [...new Set(BASE_CITIES.concat(Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))))];
    const typed = !cities.includes(nj.city);
    $('nj-city').innerHTML = cities.map(c => '<button type="button" class="chip" data-c="' + esc(c) + '" aria-pressed="' + (c === nj.city) + '">' + esc(c) + ' <span class="n">' + (counts[c] || 0) + '</span></button>').join('');
    if (!typed && document.activeElement !== $('nj-cityOther')) $('nj-cityOther').value = '';
    document.querySelectorAll('#nj-role [data-role]').forEach(b => b.setAttribute('aria-pressed', b.dataset.role === nj.role ? 'true' : 'false'));
    $('nj-needed').textContent = nj.needed;
    const cand = njCandidates();
    const picked = cand.filter(p => !nj.excluded.has(p.id));
    $('nj-peopleLabel').textContent = 'Ask these people · ' + picked.length + ' of ' + cand.length;
    const dayOff = n => { const t = new Date(); t.setDate(t.getDate() + n); return t.toLocaleDateString('en-CA'); };
    document.querySelectorAll('#nj-day [data-day]').forEach(b => b.setAttribute('aria-pressed', $('nj-date').value === dayOff(+b.dataset.day) ? 'true' : 'false'));
    const who = nj.role === 'assist' ? 'assistants' : nj.role === 'full' ? 'full-job stylists' : 'people';
    const n = picked.length;
    $('nj-goes').textContent = !nj.city ? 'Choose where the job is'
      : !n ? 'Nobody on your crew in ' + nj.city + ' yet'
      : 'Goes to ' + (n === cand.length ? (n === 1 ? 'your 1 ' : n === 2 ? 'both ' : 'all ' + n + ' ') : n + ' of ' + cand.length + ' ') + (n === 1 ? who.replace(/s$/, '').replace('people', 'person') : who) + ' in ' + nj.city + (nj.needed > 1 ? ' · need ' + nj.needed : '');
    const withEmail = emailsOf(picked), noEmail = picked.filter(p => !hasEmail(p));
    const em = jobEmail(njDraft());
    $('nj-save').textContent = withEmail.length ? 'Email ' + withEmail.length + (withEmail.length === 1 ? ' person' : ' people') + ' in Gmail' : n ? 'Save job' : 'Send';
    $('nj-save').href = withEmail.length ? gmailLink(withEmail, em) : '#';
    $('nj-save').setAttribute('aria-disabled', String(!n));
    $('nj-mailapp').href = withEmail.length ? mailLink(withEmail, em) : '#';
    $('nj-mailapp').hidden = !withEmail.length;
    $('nj-noemail').textContent = noEmail.length ? noEmail.map(p => first(p.name)).join(', ') + (noEmail.length === 1 ? ' has' : ' have') + ' no email on file. Text ' + (noEmail.length === 1 ? 'them' : 'them') + ' from the job card after you send.' : '';
    $('nj-people').innerHTML = cand.length ? cand.map(p => '<label class="pick"><input type="checkbox" data-pick="' + esc(p.id) + '"' + (nj.excluded.has(p.id) ? '' : ' checked') + '><span>' + esc(p.name) + (p.sample ? ' · Example' : '') + '</span><span class="meta">' + esc(p.response_time || p.role || '') + '</span></label>').join('')
      : '<div class="u12 empty">' + (nj.city ? 'Nobody approved in ' + esc(nj.city) + ' for this role yet.' : 'Choose a location.') + '</div>';
    const d = njDraft();
    const pm = jobEmail(d.date ? d : Object.assign({}, d, { date: '' }));
    $('nj-msg').innerHTML = '<b>' + esc(pm.subject).replace('Date not set', '[date]') + '</b><br><br>' + esc(pm.body).replace('on Date not set', 'on [date]').replace(/\n/g, '<br>');
  }
  function locCounts(){ const counts = {}; approved().forEach(p => locsOf(p).forEach(l => { const k = cityName(l); counts[k] = (counts[k] || 0) + 1; })); return counts; }
  $('nj-city').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; nj.city = b.dataset.c; $('nj-cityOther').value = ''; nj.excluded.clear(); renderNJ(); });
  $('nj-cityOther').addEventListener('input', e => { const t = cityName(String(e.target.value).replace(/;/g, ' ')); nj.city = t === 'No location' ? null : t; nj.excluded.clear(); renderNJ(); });
  $('nj-day').addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (!b) return; const t = new Date(); t.setDate(t.getDate() + Number(b.dataset.day)); $('nj-date').value = t.toLocaleDateString('en-CA'); renderNJ(); });
  $('nj-moreBtn').addEventListener('click', () => { const open = $('nj-more').hidden; $('nj-more').hidden = !open; $('nj-moreBtn').setAttribute('aria-expanded', String(open)); });
  $('nj-role').addEventListener('click', e => { const b = e.target.closest('[data-role]'); if (!b) return; nj.role = b.dataset.role; renderNJ(); });
  $('nj-people').addEventListener('change', e => { const c = e.target.closest('[data-pick]'); if (!c) return; c.checked ? nj.excluded.delete(c.dataset.pick) : nj.excluded.add(c.dataset.pick); renderNJ(); });
  $('nj-minus').addEventListener('click', () => { nj.needed = Math.max(1, nj.needed - 1); renderNJ(); });
  $('nj-plus').addEventListener('click', () => { nj.needed = Math.min(20, nj.needed + 1); renderNJ(); });
  ['nj-date','nj-time','nj-details'].forEach(id => $(id).addEventListener('input', () => { $('nj-result').textContent = ''; $('nj-result').className = 'result'; renderNJ(); }));
  $('newJobBtn').addEventListener('click', () => {
    const counts = locCounts();
    nj.city = nj.city || Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 'Los Angeles';
    if (!$('nj-date').value) { const t = new Date(); t.setDate(t.getDate() + 1); $('nj-date').value = t.toLocaleDateString('en-CA'); }
    $('nj-result').textContent = ''; $('nj-more').hidden = true; $('nj-moreBtn').setAttribute('aria-expanded', 'false'); renderNJ(); openSheet('jobSheet');
  });
  function njSend(e){
    const r = $('nj-result'); r.className = 'result';
    const fail = msg => { e.preventDefault(); r.className = 'result bad'; r.textContent = msg; };
    if (!jobsCol) return fail('Your list isn\u2019t connected yet. Reload and try again.');
    const d = njDraft();
    if (!d.date) return fail('Add the date of the job.');
    if (d.date < todayISO()) return fail('That date has already passed.');
    if (!d.time) return fail('Add the call time so nobody has to ask.');
    const picked = njCandidates().filter(p => !nj.excluded.has(p.id));
    if (!picked.length) return fail('Pick at least one person to ask.');
    const emailed = picked.filter(hasEmail);
    if (!emailed.length) e.preventDefault();
    const now = new Date().toISOString();
    const map = {};
    picked.forEach(p => { const sent = emailed.includes(p); map[p.id] = Object.assign({ name: p.name, phone: p.phone, state: sent ? 'asked' : 'to_ask' }, sent ? { asked_at: now, via: 'email' } : {}); });
    const id = 'j' + d.date.replace(/-/g, '') + '-' + cityKey(d.city).replace(/[^a-z]+/g, '').slice(0, 10) + '-' + Math.random().toString(36).slice(2, 7);
    const job = Object.assign(d, { status: emailed.length ? 'sent' : 'draft', people: map, created_at: now, created_by: 'page' }, emailed.length ? { sent_at: now, sent_by: 'email' } : {});
    jobsCol.doc(id).set(job).then(() => {
      closeSheets(); setView('jobs'); $('nj-details').value = ''; $('nj-time').value = ''; nj.excluded.clear(); nj.needed = 1;
      toast(emailed.length ? 'Your email is open. Press Send there.' : 'Job saved. Text each person from the job card.');
    }).catch(writeFail);
  }
  $('nj-save').addEventListener('click', njSend);
  $('nj-mailapp').addEventListener('click', njSend);

  /* ---------- review & crew ---------- */
  function factsHTML(p){
    const ig = igUrl(p.instagram), pf = safeUrl(p.portfolio);
    const rows = [
      ['Locations', [locLabel(p), p.travel].filter(Boolean).join(' · ')],
      ['Role', p.role], ['Specialties', p.specialties],
      ['Experience', [p.experience, p.licensed].filter(Boolean).join(' · ')],
      ['Confirms', p.response_time],
      ['Rate', [p.rate, p.rate_open ? 'open to discuss' : ''].filter(Boolean).join(' · ')],
      ['Mobile', p.phone + (p.old_phone ? ' (was ' + p.old_phone + ')' : '')], ['Email', p.email]
    ].filter(r => r[1]);
    let html = '<dl class="facts">' + rows.map(r => '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>').join('');
    if (ig) html += '<dt>Instagram</dt><dd><a href="' + esc(ig) + '" target="_blank" rel="noopener">' + esc(p.instagram) + '</a></dd>';
    if (pf) html += '<dt>Portfolio</dt><dd><a href="' + esc(pf) + '" target="_blank" rel="noopener">' + esc(String(p.portfolio).replace(/^https?:\/\/(www\.)?/i, '')) + '</a></dd>';
    if (p.applied_at) html += '<dt>' + (p.reapplied_at ? 'First applied' : 'Applied') + '</dt><dd>' + esc(fmtDate(p.applied_at)) + '</dd>';
    html += '</dl>';
    if (p.note) html += '<div class="note">' + esc(p.note) + '</div>';
    return html;
  }
  function toldNoteHTML(){
    const nt2 = notTold(); if (!nt2.length) return '';
    return '<div class="draftnote toldnote"><span>Approved but not told yet: ' + esc(listJoin(nt2.map(p => p.name))) + '.</span><div class="acts">' +
      nt2.slice(0, 4).map(p => '<button class="btn small solid" type="button" data-welcome="' + esc(p.id) + '">Tell ' + esc(first(p.name)) + '</button>').join('') + '</div></div>';
  }
  function renderReview(){
    const list = people.filter(p => p.status === 'new').sort((a, b) => String(b.reapplied_at || b.applied_at || '').localeCompare(String(a.reapplied_at || a.applied_at || '')));
    if (!list.length) { $('reviewList').innerHTML = toldNoteHTML() + '<div class="empty"><b>You’re caught up</b>New applications from the sign-up page arrive here through Wix. You can also import them with Add people.</div>'; return; }
    $('reviewList').innerHTML = toldNoteHTML() + list.map(p => {
      const id = esc(p.id), wasRemoved = p.before && p.before.status === 'removed', h = historyOf(p.id);
      const pill = p.sample ? '<span class="pill ex">Example</span>' : p.reapplied_at ? '<span class="pill ' + (wasRemoved ? 'bad' : 'new') + '">Applied again</span>' : '<span class="pill new">New</span>';
      const btns = wasRemoved
        ? '<button class="btn" type="button" data-status-set="approved" data-id="' + id + '">Approve anyway</button><button class="btn solid" type="button" data-status-set="removed" data-id="' + id + '">Keep removed</button>'
        : '<button class="btn" type="button" data-status-set="passed" data-id="' + id + '">Decline</button><button class="btn solid" type="button" data-status-set="approved" data-id="' + id + '">Approve</button>';
      return '<article class="rcard"><div class="rhead"><h3>' + esc(p.name) + '</h3>' + pill + '</div>' + flagHTML(p) + factsHTML(p) + (h.asked ? historyHTML(h) : '') +
        (p.team_notes ? '<div class="note"><b>Your notes:</b> ' + esc(p.team_notes) + '</div>' : '') +
        '<div class="ractions">' + btns + '</div></article>';
    }).join('');
  }
  $('reviewList').addEventListener('click', e => {
    const w = e.target.closest('[data-welcome]'); if (w) return openWelcome(w.dataset.welcome);
    const b = e.target.closest('[data-status-set]'); if (b) setStatus(b.dataset.id, b.dataset.statusSet);
  });
  /* ---------- the catalog: everyone who has applied or worked with Susy ---------- */
  const STATUS = { approved:['ok','Approved'], new:['new','To review'], passed:['pass','Declined'], removed:['bad','Removed'] };
  const REASONS = { backout:'Backed out within 24 hours', noshow:'Didn’t show up', other:'Other reason' };
  const jobLine = j => [dayLabel(j.date, true), cityName(j.city)].filter(Boolean).join(' · ');
  // Everything this person has done with the team, read from the jobs.
  function historyOf(id){
    const h = { asked: 0, yes: 0, no: 0, worked: [], upcoming: [] };
    jobs.forEach(j => {
      const x = (j.people || {})[id]; if (!x) return;
      const st = x.state || 'to_ask'; if (st === 'to_ask') return;
      h.asked++;
      if (st === 'yes' || st === 'booked') h.yes++;
      if (st === 'no') h.no++;
      if (st === 'booked' && j.status !== 'cancelled') (dateGone(j) || j.date === todayISO() ? h.worked : h.upcoming).push(j);
    });
    const newest = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));
    h.worked.sort(newest); h.upcoming.sort(newest);
    return h;
  }
  function historyHTML(h){
    const rows = h.upcoming.map(j => '<li><span>' + esc(jobLine(j)) + '</span><span>Booked</span></li>').concat(h.worked.map(j => '<li><span>' + esc(jobLine(j)) + '</span><span>Worked</span></li>'));
    return '<div class="hist"><p class="label">History with Susy</p>' +
      (h.asked ? '<p class="hstats">Offered ' + h.asked + (h.asked === 1 ? ' job' : ' jobs') + ' · said yes to ' + h.yes + ' · said no to ' + h.no + '</p>' : '<p class="hstats">No jobs offered yet.</p>') +
      (rows.length ? '<ul>' + rows.join('') + '</ul>' : '') + '</div>';
  }
  // A banner for anyone removed, or anyone who has applied again after being declined or removed.
  function flagHTML(p){
    if (p.status === 'removed') return '<div class="warn"><b>Removed' + (p.removed_at ? ' ' + esc(fmtDate(p.removed_at)) : '') + '.</b> ' + esc(REASONS[p.removed_reason] || '') + (p.removed_reason ? '. ' : '') + 'Don’t offer them jobs.</div>';
    if (p.reapplied_at && p.before) {
      const was = p.before.status === 'removed'
        ? 'They were removed from the team' + (p.before.at ? ' on ' + esc(fmtDate(p.before.at)) : '') + (p.before.reason && REASONS[p.before.reason] ? ' (' + esc(REASONS[p.before.reason].toLowerCase()) + ')' : '') + '. The team rule says removed people don’t come back.'
        : 'They were declined' + (p.before.at ? ' on ' + esc(fmtDate(p.before.at)) : '') + '.' + (p.recontact ? ' You marked them as someone to reach out to later.' : '');
      return '<div class="warn' + (p.before.status === 'removed' ? '' : ' soft') + '"><b>Applied again ' + esc(fmtDate(p.reapplied_at)) + '.</b> ' + was + '</div>';
    }
    return '';
  }
  let removeFor = null, notesBusy = false;
  function renderAll(){
    // Don't redraw under someone typing a note; it redraws when they finish.
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains('tnotes')) { notesBusy = true; return; }
    notesBusy = false;
    const H = {}; people.forEach(p => { H[p.id] = historyOf(p.id); });
    const match = { all: () => true, worked: p => H[p.id].worked.length > 0, later: p => p.status === 'passed' && p.recontact === true };
    document.querySelectorAll('#statusChips [data-status]').forEach(b => {
      if (!b.dataset.label) b.dataset.label = b.textContent.trim();
      const f = match[b.dataset.status] || (p => p.status === b.dataset.status);
      b.innerHTML = esc(b.dataset.label) + ' <span class="n">' + people.filter(f).length + '</span>';
    });
    const needle = q.trim().toLowerCase();
    let list = people.filter(match[statusF] || (p => p.status === statusF));
    if (needle) list = list.filter(p => [p.name, locLabel(p), p.specialties, p.role, p.instagram, p.email, p.team_notes].join(' ').toLowerCase().includes(needle));
    if (statusF === 'worked') list.sort((a, b) => String((H[b.id].worked[0] || {}).date || '').localeCompare(String((H[a.id].worked[0] || {}).date || '')));
    else list.sort((a, b) => locLabel(a).localeCompare(locLabel(b)) || String(a.name).localeCompare(String(b.name)));
    if (!list.length) { $('allList').innerHTML = '<div class="empty"><b>No one here yet</b>Try another name, location or filter.</div>'; return; }
    $('allList').innerHTML = list.map(p => {
      const h = H[p.id], id = esc(p.id);
      let [cls, txt] = STATUS[p.status] || ['pass', p.status];
      if (p.status === 'passed' && p.recontact) { cls = 'later'; txt = 'Reach out later'; }
      if (p.status === 'new' && p.reapplied_at) txt = 'Applied again';
      const workedTxt = h.worked.length ? 'Worked ' + h.worked.length + (h.worked.length === 1 ? ' job' : ' jobs') + ' · last ' + dayLabel(h.worked[0].date, true) : '';
      const open = openId === p.id;
      let acts = '';
      if (open) {
        const B = (cls2, attrs, label) => '<button class="btn small' + (cls2 ? ' ' + cls2 : '') + '" type="button" ' + attrs + ' data-id="' + id + '">' + label + '</button>';
        if (removeFor === p.id) {
          acts = '<div class="hist"><p class="label">Why are they being removed?</p><div class="reasons">' +
            Object.entries(REASONS).map(([k, v]) => B('', 'data-rm-reason="' + k + '"', esc(v))).join('') + B('', 'data-rm-cancel', 'Cancel') + '</div></div>';
        } else {
          const list2 = [];
          if (p.status === 'new') list2.push(B('solid', 'data-status-set="approved"', 'Approve'), B('', 'data-status-set="passed"', 'Decline'));
          if (p.status === 'approved') {
            list2.push(B(p.welcomed_at ? '' : 'solid', 'data-welcome="' + id + '"', p.welcomed_at ? esc(toldLine(p)) : 'Tell them they\u2019re approved'));
            list2.push(B('', 'data-rm-start', 'Remove from team'));
          }
          if (p.status === 'passed') {
            list2.push(B(p.recontact === true ? 'solid' : '', 'data-recontact="1" aria-pressed="' + (p.recontact === true) + '"', 'Reach out later'),
                       B(p.recontact === false ? 'solid' : '', 'data-recontact="0" aria-pressed="' + (p.recontact === false) + '"', 'Not a fit'),
                       B('', 'data-status-set="approved"', 'Approve'));
          }
          if (p.status === 'removed') list2.push(B('', 'data-status-set="approved"', 'Give another chance'));
          if (p.status !== 'new' && p.status !== 'removed') list2.push(B('', 'data-status-set="new"', 'Move to review'));
          list2.push('<button class="btn small danger" type="button" data-del="' + id + '">Delete details</button>');
          acts = '<div class="u13 pacts">' + list2.join('') + '</div>';
        }
      }
      const untold = p.status === 'approved' && !p.welcomed_at && !p.sample && !p.wix_skip ? 'Not told yet' : '';
      return '<div class="erow"><button type="button" data-open="' + id + '" aria-expanded="' + open + '"><b>' + esc(p.name) + (p.sample ? ' · Example' : '') + '</b><span class="pill ' + cls + '">' + esc(txt) + '</span><span class="meta">' + esc([untold, locLabel(p), p.role, workedTxt].filter(Boolean).join(' · ')) + '</span></button>' +
        (open ? '<div class="edetail">' + flagHTML(p) + factsHTML(p) + historyHTML(h) +
          '<div class="hist"><p class="label">Private notes</p><textarea class="tnotes" data-notes="' + id + '" maxlength="2000" placeholder="How they worked, who they worked with, anything to remember">' + esc(p.team_notes || '') + '</textarea></div>' +
          acts + '</div>' : '') + '</div>';
    }).join('');
  }
  $('allList').addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) { openId = openId === o.dataset.open ? null : o.dataset.open; removeFor = null; return renderAll(); }
    const s = e.target.closest('[data-status-set]'); if (s) return setStatus(s.dataset.id, s.dataset.statusSet);
    const w = e.target.closest('[data-welcome]'); if (w) return openWelcome(w.dataset.welcome);
    const rs = e.target.closest('[data-rm-start]'); if (rs) { removeFor = rs.dataset.id; return renderAll(); }
    const rc = e.target.closest('[data-rm-cancel]'); if (rc) { removeFor = null; return renderAll(); }
    const rr = e.target.closest('[data-rm-reason]');
    if (rr) {
      const now = new Date().toISOString(); removeFor = null;
      return crewCol.doc(rr.dataset.id).update({ status: 'removed', removed_at: now, removed_reason: rr.dataset.rmReason, reviewed_at: now })
        .then(() => toast('Removed from the team')).catch(writeFail);
    }
    const rk = e.target.closest('[data-recontact]');
    if (rk) return crewCol.doc(rk.dataset.id).update({ recontact: rk.dataset.recontact === '1' })
      .then(() => toast(rk.dataset.recontact === '1' ? 'Marked: reach out later' : 'Marked: not a fit')).catch(writeFail);
    const d = e.target.closest('[data-del]'); if (!d) return;
    if (d.dataset.armed) return remove(d.dataset.del);
    d.dataset.armed = '1'; d.textContent = 'Tap again to delete for good';
    setTimeout(() => { if (d.isConnected) { delete d.dataset.armed; d.textContent = 'Delete details'; } }, 3000);
  });
  $('allList').addEventListener('focusout', e => {
    const t = e.target; if (!t.classList || !t.classList.contains('tnotes')) return;
    const id = t.dataset.notes, v = t.value.slice(0, 2000), p = crewById(id);
    if (p && (p.team_notes || '') !== v) crewCol.doc(id).update({ team_notes: v, notes_at: new Date().toISOString() }).then(() => toast('Notes saved')).catch(writeFail);
    setTimeout(() => { if (notesBusy) renderAll(); }, 0);
  });
  $('search').addEventListener('input', e => { q = e.target.value; renderAll(); });
  document.querySelectorAll('#statusChips [data-status]').forEach(b => b.addEventListener('click', () => {
    statusF = b.dataset.status;
    document.querySelectorAll('#statusChips [data-status]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    renderAll();
  }));

  /* ---------- welcome email ---------- */
  let welId = null;
  function welcomeText(p){
    const l = locsOf(p).map(cityName), one = l.length === 1 ? l[0] : '';
    return {
      subject: "You're on the Hairbysusy On-Call Team",
      body: 'Hi ' + (first(p.name) || 'there') + ',\n\nYou\u2019ve been approved for the Hairbysusy On-Call Team' + (one ? ' in ' + one : '') + '.\n\nWhen Susy has a job in ' + (one || 'one of your locations') + ', you\u2019ll hear from the Hairbysusy team by email or text with the date and time. Reply YES if you\u2019re available, and Susy will call you with the brief.\n\nReplying YES is a commitment. If you back out of a confirmed job within 24 hours of it, including by opting out of texts, or don\u2019t show up, you\u2019ll be permanently removed from the team and won\u2019t be offered jobs again.\n\nHairbysusy never asks anyone to pay to join the team or to get a job.\n\nHairbysusy'
    };
  }
  // The same news by text, for people with no email, or when a text is quicker.
  function welcomeSMS(p){
    const l = locsOf(p).map(cityName), one = l.length === 1 ? l[0] : '';
    return 'Hi ' + (first(p.name) || 'there') + ', this is the Hairbysusy team. You’re approved for the Hairbysusy On-Call Team' + (one ? ' in ' + one : '') +
      '. When Susy has a job ' + (one ? 'in ' + one : 'in one of your locations') + ', we’ll email or text you the date and time. Replying YES is a commitment: if you back out within 24 hours of a confirmed job or don’t show up, you’ll be removed from the team.';
  }
  function openWelcome(id){
    const p = crewById(id); if (!p) return;
    welId = id;
    const mail = hasEmail(p), num = e164(p.phone || '', p.city);
    $('welTitle').textContent = p.status === 'approved' ? first(p.name) + ' is approved' : 'Tell them they’re approved';
    $('welSub').textContent = mail ? 'Send the email so the rules are in writing. You can call as well.' : 'There’s no email on file, so call or text them.';
    $('welEmailPart').hidden = !mail;
    ['welCopy', 'welMailApp', 'welSend'].forEach(k => { $(k).hidden = !mail; });
    if (mail) {
      const w = welcomeText(p);
      $('welTo').value = p.email; $('welSubject').value = w.subject; $('welBody').value = w.body;
      $('welSend').href = GMAIL + '&to=' + encodeURIComponent(p.email) + '&su=' + encodeURIComponent(w.subject) + '&body=' + encodeURIComponent(w.body);
      $('welMailApp').href = 'mailto:' + encodeURIComponent(p.email) + '?subject=' + encodeURIComponent(w.subject) + '&body=' + encodeURIComponent(w.body);
    }
    $('welCallLabel').textContent = mail ? 'Calling too? Say this' : 'Call them and say this';
    $('welScript').textContent = '“You’re approved for the Hairbysusy On-Call Team. Jobs come by email or text with the date and time; reply YES if you’re available and Susy calls you with the brief. Replying YES is a commitment: backing out within 24 hours of a confirmed job, or not showing up, means you’re removed from the team.”';
    $('welCallPart').hidden = num.length < 8;
    $('welCall').href = 'tel:+' + num; $('welCall').textContent = 'Call ' + (first(p.name) || 'them');
    $('welCall').className = 'btn small' + (mail ? '' : ' solid');
    $('welText').href = 'sms:+' + num + '?&body=' + encodeURIComponent(welcomeSMS(p));
    $('welText').textContent = 'Text ' + (first(p.name) || 'them');
    $('welCalled').hidden = true;
    $('welResult').textContent = ''; $('welResult').className = 'result';
    openSheet('welcomeSheet');
  }
  async function markWelcomed(via){
    if (!welId || !crewCol) return;
    try { await crewCol.doc(welId).update({ welcomed_at: new Date().toISOString(), welcomed_via: via }); } catch(e){}
  }
  $('welMailApp').addEventListener('click', () => markWelcomed('email'));
  $('welSend').addEventListener('click', () => { markWelcomed('email'); $('welResult').className = 'result ok'; $('welResult').textContent = 'If your email app didn’t open, tap Copy message and send it to ' + $('welTo').value + '.'; });
  $('welCopy').addEventListener('click', () => { copy('Subject: ' + $('welSubject').value + '\n\n' + $('welBody').value, 'Message copied'); markWelcomed('email'); });
  $('welText').addEventListener('click', () => { markWelcomed('text'); $('welResult').className = 'result ok'; $('welResult').textContent = 'Your messages app is open with the text written. Press Send there.'; });
  // A call only counts once they've picked up, so it waits for a tap.
  $('welCall').addEventListener('click', () => { $('welCalled').hidden = false; $('welResult').className = 'result'; $('welResult').textContent = 'If they don’t pick up, send the email or a text so it’s in writing.'; });
  $('welCalled').addEventListener('click', () => { markWelcomed('call'); $('welCalled').hidden = true; $('welResult').className = 'result ok'; $('welResult').textContent = 'Marked as told.'; });
  const notTold = () => people.filter(p => p.status === 'approved' && !p.welcomed_at && !p.sample && !p.wix_skip);
  const toldLine = p => p.welcomed_at ? 'Told ' + fmtDate(p.welcomed_at) + (p.welcomed_via === 'call' ? ' by phone' : p.welcomed_via === 'text' ? ' by text' : ' by email') : '';

  /* ---------- writes ---------- */
  function writeFail(e){ const c = e && e.code; toast(c === 'signed_out' ? 'You’re signed out, so that didn’t save. Sign in again.' : c === 'offline' ? 'No connection, so that didn’t save. Try again when you’re back online.' : c === 'busy' ? 'Someone else was saving the same thing. Try again.' : c === 'invalid' ? 'That couldn’t be saved: it’s too long or has something the list can’t keep.' : 'That didn’t save. Check your connection and try again.'); }
  async function setStatus(id, status){
    try {
      await crewCol.doc(id).update({ status, reviewed_at: new Date().toISOString() });
      const p = crewById(id);
      if (status === 'approved' && p && !p.welcomed_at) openWelcome(id);
      else toast({ approved: 'Approved', passed: 'Declined', removed: 'Kept removed', new: 'Moved to review' }[status] || 'Saved');
    }
    catch(e){ writeFail(e); }
  }
  async function remove(id){
    const p = crewById(id);
    // Take their Crew tags off in Wix first, or the next check would bring them back.
    if (p && p.wix_id) {
      if (!mcp) { toast('Still connecting. Try again in a moment.'); return; }
      try { await wixForget(p); } catch(e){ toast('Couldn\u2019t remove their Crew tags in Wix. Try again.'); return; }
    }
    try { await crewCol.doc(id).delete(); openId = null; toast('Details deleted'); } catch(e){ writeFail(e); }
  }
  $('clearExamples').addEventListener('click', async () => {
    for (const p of people.filter(p => p.sample)) { try { await crewCol.doc(p.id).delete(); } catch(e){ writeFail(e); return; } }
    for (const j of jobs.filter(j => j.sample)) { try { await jobsCol.doc(j.id).delete(); } catch(e){ writeFail(e); return; } }
    toast('Examples removed');
  });

  /* ---------- CSV import ---------- */
  function parseCSV(text){
    const rows = []; let row = [], cell = '', inQ = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += c; }
      else if (c === '"') inQ = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }
  const ALIASES = {
    name:['name','full_name','fullname'], phone:['phone','mobile','mobile_number','phone_number','number'], email:['email','email_address'],
    whatsapp:['whatsapp'], instagram:['instagram','ig','instagram_handle'], portfolio:['portfolio','website'], city:['locations','city','location'],
    travel:['travel'], role:['role'], specialties:['specialties','specialty','skills'], experience:['experience','years'],
    licensed:['licensed','license'], response_time:['response_time','response','confirms'], rate:['rate','day_rate'],
    rate_open:['rate_open'], note:['note','notes','message','description','about'], sms_consent:['sms_consent','consent'], commitment:['commitment'], applied_at:['created_at','submitted_at','date','created']
  };
  function rowsToPeople(rows){
    const head = rows[0].map(h => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    const idx = {};
    Object.entries(ALIASES).forEach(([k, al]) => { const i = head.findIndex(h => al.includes(h)); if (i >= 0) idx[k] = i; });
    if (idx.name == null || idx.phone == null) return { error: 'This file needs a name column and a phone column. Download the CSV from the crew form in Netlify and try again.' };
    const out = [];
    rows.slice(1).forEach(r => {
      const g = k => idx[k] == null ? '' : String(r[idx[k]] || '').trim();
      const c = cleanLocs(g('city'));
      const p = { name: g('name'), phone: g('phone'), email: g('email'), whatsapp: /^y/i.test(g('whatsapp')), instagram: g('instagram'), portfolio: g('portfolio'),
        city: c, travel: g('travel'), role: g('role'), specialties: g('specialties'), experience: g('experience'), licensed: g('licensed'),
        response_time: g('response_time'), rate: g('rate'), rate_open: /^y/i.test(g('rate_open')), note: g('note'), sms_consent: /^y/i.test(g('sms_consent')), commitment: /^y/i.test(g('commitment')), applied_at: safeISO(g('applied_at')) };
      if (p.name && p.phone) out.push(p);
    });
    return { people: out };
  }
  const normTxt = v => String(v || '').trim().toLowerCase();
  const igKey = v => normTxt(v).replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/[/?#].*$/, '');
  // The same person, even with a new number: match on number, then email, then Instagram.
  function findExisting(p){
    const id = idFor(p), em = normTxt(p.email), ig = igKey(p.instagram);
    return people.find(x => x.id === id) || (em && people.find(x => normTxt(x.email) === em)) || (ig && people.find(x => igKey(x.instagram) === ig)) || null;
  }
  // Puts applications in Review. Used by the CSV import and by new sign-ups from the form.
  async function importPeople(list, onStep){
    const have = new Set(people.map(p => p.id)); const r = { added: 0, skipped: 0, again: 0, failed: false };
    for (const p of list) {
      const id = idFor(p);
      const prior = findExisting(p);
      if (prior) {
        // Declined or removed before, and this application is newer: back to Review with their history showing.
        if ((prior.status === 'passed' || prior.status === 'removed') && p.applied_at && p.applied_at > (prior.reapplied_at || prior.applied_at || '')) {
          const fresh = {};
          ['phone','city','role','specialties','portfolio','instagram','email','note','response_time','travel','experience','licensed','rate'].forEach(k => { if (p[k]) fresh[k] = p[k]; });
          if (p.phone && e164(p.phone, p.city) !== e164(prior.phone || '', prior.city)) fresh.old_phone = prior.phone || '';
          fresh.sms_consent = p.sms_consent;
          try {
            await crewCol.doc(prior.id).update(Object.assign(fresh, { status: 'new', reapplied_at: p.applied_at,
              before: { status: prior.status, at: prior.status === 'removed' ? (prior.removed_at || prior.reviewed_at || '') : (prior.reviewed_at || ''), reason: prior.removed_reason || '' } }));
            r.again++;
          } catch(e){ writeFail(e); r.failed = true; break; }
        } else if (prior.from_wix && prior.status === 'new' && !prior.form_filled) {
          // Came in through Wix with only the basics: fill in the rest of their application.
          const fill = { form_filled: true };
          ['phone','city','role','specialties','portfolio','instagram','email','note','response_time','travel','experience','licensed','rate'].forEach(k => { if (p[k] && !prior[k]) fill[k] = p[k]; });
          ['sms_consent','commitment'].forEach(k => { if (p[k] === true) fill[k] = true; });
          if (p.applied_at) fill.applied_at = p.applied_at;
          try { await crewCol.doc(prior.id).update(fill); r.skipped++; } catch(e){ writeFail(e); r.failed = true; break; }
        } else r.skipped++;
        continue;
      }
      if (have.has(id)) { r.skipped++; continue; }
      if (onStep) onStep(p);
      try { await crewCol.doc(id).set(Object.assign(p, { status:'new', added_at: new Date().toISOString(), applied_at: p.applied_at || new Date().toISOString() })); have.add(id); r.added++; }
      catch(e){ writeFail(e); r.failed = true; break; }
    }
    return r;
  }
  async function importText(text){
    const res = $('importResult'); res.className = 'result'; res.textContent = '';
    if (!crewCol) { res.className = 'result bad'; res.textContent = 'Your list isn’t connected yet. Reload the page and try again.'; return; }
    let rows; try { rows = parseCSV(text); } catch(e){ rows = []; }
    if (rows.length < 2) { res.className = 'result bad'; res.textContent = 'No rows found. Make sure this is the CSV from Netlify.'; return; }
    let parsed; try { parsed = rowsToPeople(rows); } catch(e){ parsed = { error: 'This file couldn’t be read. Download it again from Netlify.' }; }
    if (parsed.error) { res.className = 'result bad'; res.textContent = parsed.error; return; }
    $('importBtn').disabled = true;
    const r = await importPeople(parsed.people, p => { res.textContent = 'Adding ' + p.name + '…'; });
    $('importBtn').disabled = false;
    if (r.failed) return;
    res.className = 'result ok';
    const parts = [];
    if (r.added) parts.push('Added ' + r.added + (r.added === 1 ? ' person' : ' people') + ' to Review.');
    if (r.again) parts.push(r.again + (r.again === 1 ? ' person' : ' people') + ' applied again after being declined or removed. They’re back in Review with their history.');
    if (r.skipped && parts.length) parts.push('Skipped ' + r.skipped + ' already on your list.');
    res.textContent = parts.length ? parts.join(' ') : 'Everyone in this file is already on your list.';
  }
  // New sign-ups wait in the app's private inbox until this page files them in Review.
  let inboxBusy = false; const inboxDone = new Set();
  async function takeInbox(items){
    if (inboxBusy || !crewCol || !gotPeople) return;
    inboxBusy = true;
    try {
      for (const it of items) {
        if (inboxDone.has(it.id)) continue;
        const f = (it.data && it.data.fields) || {};
        const keys = Object.keys(f).filter(k => typeof f[k] === 'string');
        let parsed; try { parsed = rowsToPeople([keys, keys.map(k => f[k])]); } catch(e){ parsed = { error: 'unreadable' }; }
        if (!parsed.error && parsed.people.length) {
          const r = await importPeople(parsed.people);
          if (r.failed) break;
          if (r.added || r.again) toast(parsed.people[0].name + ' applied. They’re in Review.');
        }
        try { await team.inboxDone(it.id); inboxDone.add(it.id); } catch(e){ break; }
      }
    } finally { inboxBusy = false; }
  }
  let fileText = '';
  $('csvFile').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; fileText = await f.text(); $('drop').querySelector('b').textContent = f.name; });
  const drop = $('drop');
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', async e => { const f = e.dataTransfer.files[0]; if (!f) return; fileText = await f.text(); drop.querySelector('b').textContent = f.name; });
  $('importBtn').addEventListener('click', () => importText(fileText || $('csvText').value));

  $('oneSave').addEventListener('click', async () => {
    const r = $('oneResult'); r.className = 'result';
    const p = { name: $('o-name').value.trim(), phone: $('o-phone').value.trim(), city: cleanLocs($('o-city').value), role: $('o-role').value,
      instagram: $('o-ig').value.trim() ? '@' + $('o-ig').value.trim().replace(/^@/, '') : '', specialties: $('o-spec').value.trim(), email: $('o-email').value.trim(), whatsapp: false };
    if (!p.name) { r.className = 'result bad'; r.textContent = 'Add a name.'; return; }
    const pd = p.phone.replace(/\D/g, '');
    if (p.phone.startsWith('+') ? pd.length < 8 || pd.length > 15 : pd.length < 10) { r.className = 'result bad'; r.textContent = 'Add a mobile number. Outside the US, start with + and the country code.'; return; }
    if (!p.city) { r.className = 'result bad'; r.textContent = 'Add at least one location.'; return; }
    const id = idFor(p);
    if (people.some(x => x.id === id)) { r.className = 'result bad'; r.textContent = 'Someone with this number is already on your list.'; return; }
    const same = findExisting(p);
    if (same && same.status === 'removed') { r.className = 'result bad'; r.textContent = same.name + ' was removed from the team. Find them in Crew \u2192 Removed if you want to give them another chance.'; return; }
    try {
      await crewCol.doc(id).set(Object.assign(p, { status:'approved', added_at:new Date().toISOString(), applied_at:new Date().toISOString(), portfolio:'', response_time:'', sms_consent:false, note:'' }));
      r.className = 'result ok'; r.textContent = p.name + ' is on your crew. Ask them to fill in the sign-up form so you have their texting consent on file.';
      ['o-name','o-phone','o-ig','o-spec','o-email'].forEach(i => $(i).value = '');
    } catch(e){ writeFail(e); }
  });

  /* ---------- sheets ---------- */
  function openSheet(id){ $(id).classList.add('on'); }
  function closeSheets(){ document.querySelectorAll('.scrim').forEach(s => s.classList.remove('on')); }
  $('addBtn').addEventListener('click', () => openSheet('addSheet'));
  $('shareBtn').addEventListener('click', () => openSheet('shareSheet'));
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheets));
  document.querySelectorAll('.scrim').forEach(s => s.addEventListener('click', e => { if (e.target === s) closeSheets(); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });
  document.querySelectorAll('#addSheet [data-pane]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#addSheet [data-pane]').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    $('pane-import').hidden = b.dataset.pane !== 'import'; $('pane-one').hidden = b.dataset.pane !== 'one';
  }));
  $('copyLink').addEventListener('click', () => copy($('signupUrl').value, 'Link copied'));

  /* ---------- Wix: the crew list also lives in Contacts in Susy's Wix site ----------
     Wix is where you browse and tag people from the Wix app; this page is where jobs run.
     When the page opens (and every few minutes while it's open) it reads every contact tagged "Crew":
       - someone there who isn't here yet (an application the sign-up site sent to Wix) joins Review;
       - a status tag changed in the Wix app is taken over here;
       - "Crew: Applied again" sends a declined or removed person back to Review.
     Every change made here (approve, decline, remove, reach out later, worked a job) goes back to
     their Wix tags. It calls Wix through the viewer's own Wix connector: no keys live in this page. */
  const WIX = { server: 'Wix', tool: 'CallWixSiteAPI', site: '245486a5-efc7-4e35-b583-f9b546f02080' };
  const WTAG = {
    crew: 'custom.crew-Q0l69', review: 'custom.crew-to-review-W5bBx', approved: 'custom.crew-approved-b6kAa',
    declined: 'custom.crew-declined-T4HJG', later: 'custom.crew-reach-out-later-KprOe', removed: 'custom.crew-removed-jiJ2a',
    worked: 'custom.crew-worked-with-392PR', again: 'custom.crew-applied-again-r2qnh'
  };
  const WFIELD = { instagram: 'custom.crew-instagram-ofnvvnythbjzltckrfbw', specialties: 'custom.crew-specialties-lwelwdzeaqxbpoijfl', role: 'custom.crew-role-vbfqqsoungotmexvlllxoicrg' };
  const STATUS_TO_TAG = { new: WTAG.review, approved: WTAG.approved, passed: WTAG.declined, removed: WTAG.removed };
  const STATUS_TAGS = Object.values(STATUS_TO_TAG);
  const OWN_TAGS = Object.values(WTAG);
  const WDOC = {
    labels: 'https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/find-or-create-label',
    labelsQuery: 'https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/query-labels',
    find: 'https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/skills/find-contacts',
    create: 'https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/create-contact',
    label: 'https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/label-contact',
    unlabel: 'https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/unlabel-contact'
  };
  let mcp = null, wixBusy = false, wixLast = 0, wixState = 'off', wixTimer = null;
  let wixTagNames = {}, wixPlaceKey = {};

  // Through the app's server, which holds the Wix key and allows only these crew requests.
  async function wixApi(method, url, body){ return team.wix(method, url, body); }
  const tagsOf = c => (((c && c.info) || {}).labelKeys || {}).items || [];
  const wixSig = (p, h) => [p.status, p.recontact === true ? 1 : 0, h.worked.length ? 1 : 0, locsOf(p).join(';')].join('|');
  const wixStatusOf = tags => tags.includes(WTAG.removed) ? 'removed' : tags.includes(WTAG.declined) ? 'passed' : tags.includes(WTAG.approved) ? 'approved' : tags.includes(WTAG.review) ? 'new' : null;

  async function wixLoadTags(){
    const r = await wixApi('POST', 'https://www.wixapis.com/contacts/v4/labels/query', { query: { filter: { namespace: 'custom' } } }, WDOC.labelsQuery);
    wixTagNames = {}; wixPlaceKey = {};
    (r.labels || []).forEach(l => {
      wixTagNames[l.key] = l.displayName;
      if (/^Crew: /.test(l.displayName) && !OWN_TAGS.includes(l.key)) wixPlaceKey[l.displayName.slice(6).toLowerCase()] = l.key;
    });
  }
  // "Crew: Los Angeles" and so on; made the first time a city shows up.
  async function wixPlaceTag(place){
    const k = place.toLowerCase();
    if (wixPlaceKey[k]) return wixPlaceKey[k];
    const r = await wixApi('POST', 'https://www.wixapis.com/contacts/v4/labels', { displayName: 'Crew: ' + place }, WDOC.labels);
    const key = r.label && r.label.key;
    if (key) { wixPlaceKey[k] = key; wixTagNames[key] = r.label.displayName; }
    return key;
  }
  async function wixGetTags(id){ return tagsOf((await wixApi('GET', 'https://www.wixapis.com/contacts/v4/contacts/' + id, undefined, WDOC.find)).contact); }
  async function wixFind(p){
    const tries = [];
    if (hasEmail(p)) tries.push({ 'email.email': String(p.email).trim() });
    const num = e164(p.phone || '', p.city); if (num.length >= 8) tries.push({ 'phone.phone': '+' + num });
    for (const filter of tries) {
      const r = await wixApi('POST', 'https://www.wixapis.com/contacts/v5/contacts/search', { search: { filter, cursorPaging: { limit: 2 } } }, WDOC.find);
      if (r.contacts && r.contacts[0]) return r.contacts[0].id;
    }
    return null;
  }
  async function wixCreate(p){
    const parts = String(p.name || 'Crew member').trim().split(/\s+/);
    const info = {
      name: { first: parts[0], last: parts.slice(1).join(' ') },
      jobTitle: 'Crew: ' + (p.role || 'member'),
      labelKeys: { items: [WTAG.crew].concat(STATUS_TO_TAG[p.status] ? [STATUS_TO_TAG[p.status]] : []) },
      extendedFields: { items: { [WFIELD.instagram]: String(p.instagram || ''), [WFIELD.specialties]: String(p.specialties || '').slice(0, 400), [WFIELD.role]: String(p.role || '') } }
    };
    if (hasEmail(p)) info.emails = { items: [{ tag: 'MAIN', email: String(p.email).trim() }] };
    const num = e164(p.phone || '', p.city); if (num.length >= 8) info.phones = { items: [{ tag: 'MOBILE', phone: '+' + num }] };
    try {
      const r = await wixApi('POST', 'https://www.wixapis.com/contacts/v4/contacts', { info }, WDOC.create);
      return { id: r.contact.id, tags: tagsOf(r.contact) };
    } catch(e){
      // Already a contact in Wix (a client, say): use that one.
      const m = /duplicateContactId\\?"\s*:\s*\\?"([0-9a-f-]{36})/.exec(String(e && e.message) + JSON.stringify((e && e.result) || ''));
      if (m) return { id: m[1], tags: null };
      throw e;
    }
  }
  async function wixPush(p){
    const h = historyOf(p.id);
    let id = p.wix_id || null, current = null;
    if (!id) id = await wixFind(p);
    if (!id) { const c = await wixCreate(p); id = c.id; current = c.tags; }
    if (!current) {
      try { current = await wixGetTags(id); }
      catch(e){
        if (!(e && e.data && e.data.status === 404)) throw e;
        // Deleted in Wix since: make the contact again.
        const c = await wixCreate(p); id = c.id; current = c.tags || await wixGetTags(id);
      }
    }
    const want = [WTAG.crew];
    if (STATUS_TO_TAG[p.status]) want.push(STATUS_TO_TAG[p.status]);
    if (p.status === 'passed' && p.recontact === true) want.push(WTAG.later);
    if (h.worked.length) want.push(WTAG.worked);
    for (const place of locsOf(p).slice(0, 10)) { const k = await wixPlaceTag(place); if (k) want.push(k); }
    const add = want.filter(k => !current.includes(k));
    const drop = current.filter(k => (STATUS_TAGS.includes(k) || k === WTAG.later || k === WTAG.again) && !want.includes(k));
    if (add.length) await wixApi('POST', 'https://www.wixapis.com/contacts/v4/contacts/' + id + '/labels', { labelKeys: add }, WDOC.label);
    if (drop.length) await wixApi('DELETE', 'https://www.wixapis.com/contacts/v4/contacts/' + id + '/labels', { labelKeys: drop }, WDOC.unlabel);
    await crewCol.doc(p.id).update({ wix_id: id, wix_status: p.status, wix_later: p.recontact === true, wix_sig: wixSig(p, h), wix_at: new Date().toISOString() });
  }
  // For "Delete details": take every Crew tag off them in Wix, so they don't come back on the next check.
  async function wixForget(p){
    if (!p.wix_id || !mcp) return;
    const tags = await wixGetTags(p.wix_id);
    const drop = tags.filter(k => OWN_TAGS.includes(k) || /^Crew: /.test(wixTagNames[k] || ''));
    if (drop.length) await wixApi('DELETE', 'https://www.wixapis.com/contacts/v4/contacts/' + p.wix_id + '/labels', { labelKeys: drop }, WDOC.unlabel);
  }
  async function wixTakeIn(c){
    const tags = tagsOf(c), info = c.info || {}, ext = (info.extendedFields || {}).items || {};
    const email = (c.primaryInfo || {}).email || '';
    const phone = (((info.phones || {}).items || []).find(x => x.primary) || ((info.phones || {}).items || [])[0] || {}).e164Phone || '';
    const places = tags.filter(k => !OWN_TAGS.includes(k) && /^Crew: /.test(wixTagNames[k] || '')).map(k => wixTagNames[k].slice(6));
    const ws = wixStatusOf(tags), now = new Date().toISOString();
    const p = people.find(x => x.wix_id === c.id) || findExisting({ phone, email, instagram: ext[WFIELD.instagram] || '', city: places.join('; ') });
    if (p && (p.wix_skip || p.sample)) return;
    if (p && p.wix_id && p.wix_id !== c.id) return;
    if (!p) {
      // New to this page: usually an application the sign-up site sent straight to Wix.
      const np = { name: [(info.name || {}).first, (info.name || {}).last].filter(Boolean).join(' ') || 'Crew applicant',
        phone, email, instagram: ext[WFIELD.instagram] || '', specialties: ext[WFIELD.specialties] || '', role: ext[WFIELD.role] || '',
        city: places.join('; '), portfolio: '', response_time: '', note: '', sms_consent: false,
        status: ws || 'new', applied_at: c.createdDate || now, added_at: now, from_wix: true, wix_id: c.id, wix_status: ws || 'new' };
      if (!np.phone && !np.email) return;
      const id = idFor(np);
      if (!people.some(x => x.id === id)) await crewCol.doc(id).set(np);
      return;
    }
    const patch = {};
    if (!p.wix_id) patch.wix_id = c.id;
    if (tags.includes(WTAG.again)) {
      patch.wix_sig = '';
      if (p.status === 'passed' || p.status === 'removed') Object.assign(patch, { status: 'new', reapplied_at: now,
        before: { status: p.status, at: p.status === 'removed' ? (p.removed_at || p.reviewed_at || '') : (p.reviewed_at || ''), reason: p.removed_reason || '' } });
    } else if (ws && ws !== p.status && ws !== p.wix_status) {
      // Changed in the Wix app since this page last wrote it: take it over.
      Object.assign(patch, { status: ws, reviewed_at: now, wix_status: ws });
      if (ws === 'removed' && !p.removed_at) Object.assign(patch, { removed_at: now, removed_reason: p.removed_reason || 'other' });
    }
    const later = tags.includes(WTAG.later);
    if (later !== (p.wix_later === true) && later !== (p.recontact === true)) Object.assign(patch, { recontact: later, wix_later: later });
    if (Object.keys(patch).length) await crewCol.doc(p.id).update(patch);
  }
  async function wixPull(){
    const body = { query: { filter: { 'info.labelKeys': { '$hasSome': [WTAG.crew] } }, sort: [{ fieldName: 'createdDate', order: 'ASC' }], paging: { limit: 1000, offset: 0 } } };
    const r = await wixApi('POST', 'https://www.wixapis.com/contacts/v4/contacts/query', body, WDOC.find);
    for (const c of (r.contacts || [])) await wixTakeIn(c);
  }
  const wixSkip = new Set();
  const wixPending = () => people.filter(p => !p.sample && !p.wix_skip && !wixSkip.has(p.id) && (!p.wix_id || p.wix_sig !== wixSig(p, historyOf(p.id))));
  async function wixPushAll(){
    if (!mcp || wixState === 'blocked' || wixState === 'missing' || wixState === 'reauth') return;
    if (wixBusy) return wixSoon();
    const todo = wixPending(); if (!todo.length) return;
    wixBusy = true; wixShow('busy');
    try {
      let failed = null;
      for (const p of todo) {
        try { await wixPush(p); }
        catch(e){ if (e && ['signed_out', 'offline', 'server_not_connected'].includes(e.code)) throw e; failed = failed || e; wixSkip.add(p.id); }
      }
      if (failed) throw failed;
      wixShow('ok');
    }
    catch(e){ wixFailed(e); }
    finally { wixBusy = false; }
  }
  function wixSoon(){ if (!mcp) return; clearTimeout(wixTimer); wixTimer = setTimeout(wixPushAll, 1500); }
  async function wixSync(){
    if (!mcp || wixBusy || !gotPeople || !gotJobs) return;
    wixBusy = true; wixShow('busy');
    try { await wixLoadTags(); await wixPull(); wixLast = Date.now(); wixBusy = false; wixShow('ok'); wixSoon(); }
    catch(e){ wixBusy = false; wixFailed(e); }
  }
  function wixFailed(e){
    const code = e && e.code;
    if (code === 'approval_required' || code === 'not_in_manifest' || code === 'consent_required') wixShow('blocked');
    else if (code === 'server_not_connected' || code === 'selection_required' || code === 'server_not_found') wixShow('missing');
    else if (code === 'needs_reauth') wixShow('reauth');
    else if (code === 'not_granted' || code === 'capability_disabled' || code === 'capability_removed') { mcp = null; $('wixLine').hidden = true; }
    else wixShow('error');
  }
  function wixShow(state){
    wixState = state;
    const el = $('wixLine'); el.hidden = false;
    const time = wixLast ? new Date(wixLast).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    const text = {
      busy: 'Updating Wix Contacts…',
      ok: 'Wix Contacts is up to date' + (time ? ' (checked ' + time + ')' : '') + '.',
      blocked: 'Wix isn’t connected to this page yet.',
      missing: 'Wix Contacts isn’t connected yet: the Wix key still needs adding in Netlify. Your list here is saved.',
      reauth: 'Wix needs the key renewed in Netlify. Your list here is saved.',
      error: 'Wix didn’t answer. Your changes here are saved and go to Wix on the next try.'
    }[state];
    el.className = 'wixline ' + (state === 'ok' ? 'ok' : state === 'busy' ? 'busy' : 'bad');
    el.innerHTML = '<span class="dot" aria-hidden="true"></span><span>' + esc(text) + '</span>' +
      (state === 'blocked' ? '<button class="btn small solid" type="button" id="wixConnect">Connect Wix</button>' : '') +
      (state === 'error' ? '<button class="btn small" type="button" id="wixRetry">Try again</button>' : '');
  }
  $('wixLine').addEventListener('click', e => { if (e.target.closest('#wixConnect, #wixRetry')) { wixState = 'off'; wixSkip.clear(); wixSync(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - wixLast > 60000 && wixState !== 'blocked') wixSync(); });
  setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - wixLast > 180000 && !['blocked', 'missing', 'reauth'].includes(wixState)) wixSync(); }, 60000);

  /* ---------- connect ---------- */
  const status = $('status');
  let team = null;
  (async () => {
    const timer = setTimeout(() => { if (!gotPeople || !gotJobs) { status.className = 'status err'; status.textContent = 'Your list can’t be reached right now. It will load when the connection returns.'; } }, 10000);
    try { team = await window.hbsTeam.ready; } catch(e){ clearTimeout(timer); return; }
    db = team;
    crewCol = team.collection('crew'); jobsCol = team.collection('jobs');
    const done = snap => { if (gotPeople && gotJobs && !snap.metadata.fromCache) { clearTimeout(timer); status.textContent = ''; status.className = 'status'; } };
    const fail = err => { clearTimeout(timer); status.className = 'status err'; status.textContent = err && err.code === 'offline' ? 'No connection. Reload when you’re back online.' : 'Your list didn’t load. Reload the page to try again.'; };
    let wixStarted = false;
    const startWix = () => { if (wixStarted || !mcp || !gotPeople || !gotJobs) return; wixStarted = true; wixSync(); };
    crewCol.onSnapshot(snap => { people = snap.docs.map(d => Object.assign({ id: d.id }, d.data())); gotPeople = true; done(snap); render(); startWix(); }, fail);
    jobsCol.onSnapshot(snap => { jobs = snap.docs.map(d => Object.assign({ id: d.id }, d.data())); gotJobs = true; done(snap); render(); startWix(); }, fail);
    team.onInbox(items => takeInbox(items));
    mcp = { server: true };
    startWix();
  })();
})();
