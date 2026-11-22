// Shared by the HBS client pages: the test-link label, the server calls, and the client's last job
// (kept on this device so "See your job" can find it again).
'use strict';

(() => {
  const host = location.hostname;
  const test = host === 'hairbysusy-crew.netlify.app' || /--hairbysusy-crew\.netlify\.app$/.test(host) || host === 'localhost' || host === '127.0.0.1';
  const flag = document.getElementById('testflag');
  if (flag && test) flag.hidden = false;

  const ID_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;
  const KEY_RE = /^[A-Za-z0-9_-]{24}$/;
  const CHECKOUT_HOSTS = ['www.hairbysusy.com', 'hairbysusy.com', 'www.wix.com'];

  async function api(path, body) {
    try {
      const r = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-HBS-Book': '1' },
        body: JSON.stringify(body),
      });
      let data = {};
      try { data = (await r.json()) || {}; } catch { data = {}; }
      return { status: r.status, data };
    } catch {
      return { status: 0, data: {} };
    }
  }

  window.HBS = {
    test,
    ID_RE,
    KEY_RE,
    api,
    jobUrl: (j, k) => '/book/job/?j=' + encodeURIComponent(j) + '&k=' + encodeURIComponent(k),
    lastJob() {
      try {
        const v = JSON.parse(localStorage.getItem('hbs.job') || 'null');
        return v && ID_RE.test(v.j) && KEY_RE.test(v.k) ? v : null;
      } catch { return null; }
    },
    saveJob(v) {
      try { localStorage.setItem('hbs.job', JSON.stringify(v)); } catch { /* storage off */ }
    },
    checkoutOk(u) {
      try {
        const x = new URL(u);
        return x.protocol === 'https:' && CHECKOUT_HOSTS.includes(x.hostname);
      } catch { return false; }
    },
  };
})();
