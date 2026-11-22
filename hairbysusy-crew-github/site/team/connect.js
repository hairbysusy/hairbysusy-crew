/* Susy's Crew: connects this page to its server at /api/team/.
   Sign-in is checked on the server for every request; this file only shows the sign-in
   screen, keeps a copy of the list for the page, and sends changes one at a time. */
(function () {
  'use strict';
  var API = '/api/team/';
  var POLL_MS = 15000;
  var $ = function (id) { return document.getElementById(id); };
  var clone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
  var isObj = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  function deepMerge(target, patch) {
    var out = isObj(target) ? Object.assign({}, target) : {};
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
    });
    return out;
  }

  /* ---------- talking to the server ---------- */
  var signedOut = false;
  async function call(path, body) {
    var opt = { method: body === undefined ? 'GET' : 'POST', headers: { 'x-hbs-team': '1' }, credentials: 'same-origin', cache: 'no-store', redirect: 'error' };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    var res, data = null;
    try { res = await fetch(API + path, opt); } catch (e) { var off = new Error('offline'); off.code = 'offline'; throw off; }
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401) { showGate('signedout'); var so = new Error('signed_out'); so.code = 'signed_out'; throw so; }
    if (!res.ok) {
      var er = new Error((data && (data.detail || data.error)) || ('error ' + res.status));
      er.code = (data && data.error) || ('http_' + res.status); er.status = res.status; er.data = data;
      throw er;
    }
    return data;
  }

  /* ---------- the sign-in screen ---------- */
  var MESSAGES = {
    denied: 'That Google account doesn’t have access. Sign in with the Google account Susy or Victor uses for the team.',
    cancelled: 'Sign-in was cancelled.',
    expired: 'That sign-in took too long or was opened in another window. Try again.',
    failed: 'Google didn’t confirm the sign-in. Try again.',
    setup: 'Sign-in isn’t switched on yet. Victor needs to finish the setup in Netlify.',
    signedout: 'You’re signed out. Sign in again to keep going.',
    offline: 'No connection. Check your internet and reload.'
  };
  function showGate(reason) {
    signedOut = true;
    $('boot').hidden = true;
    $('appRoot').hidden = true;
    $('gate').hidden = false;
    var msg = $('gateMsg');
    msg.textContent = MESSAGES[reason] || '';
    msg.hidden = !MESSAGES[reason];
  }
  function showApp(email) {
    signedOut = false;
    $('boot').hidden = true;
    $('gate').hidden = true;
    $('appRoot').hidden = false;
    $('whoEmail').textContent = email;
  }

  /* ---------- the list, kept in step with the server ---------- */
  var store = { crew: new Map(), jobs: new Map() };
  var listeners = { crew: [], jobs: [] };
  var inboxListeners = [];
  // HBS client jobs (bookhbs.com): read with the rest of the list, changed only through /client.
  var clients = null, clientsJson = '', clientListeners = [];
  function emitClients() {
    clientListeners.slice().forEach(function (cb) { try { cb(clone(clients || [])); } catch (e) { console.error(e); } });
  }
  var loaded = false, queue = [], busy = false, epoch = 0, idleWaiters = [], resync = false;

  function snapshot(col) {
    var docs = [];
    store[col].forEach(function (data, id) { docs.push({ id: id, data: function () { return clone(data); } }); });
    return { docs: docs, metadata: { fromCache: false, hasPendingWrites: busy || queue.length > 0 } };
  }
  function emit(col) {
    listeners[col].slice().forEach(function (l) { try { l.cb(snapshot(col)); } catch (e) { console.error(e); } });
  }
  function apply(data) {
    ['crew', 'jobs'].forEach(function (col) {
      var next = new Map((data[col] || []).map(function (x) { return [x.id, x.data]; }));
      var before = JSON.stringify(Array.from(store[col]));
      store[col] = next;
      if (!loaded || JSON.stringify(Array.from(next)) !== before) emit(col);
    });
    loaded = true;
    if (data.clients !== null && data.clients !== undefined) {
      var cj = JSON.stringify(data.clients);
      if (cj !== clientsJson) { clientsJson = cj; clients = data.clients; emitClients(); }
    }
    var inbox = data.inbox || [];
    if (inbox.length) inboxListeners.forEach(function (cb) { try { cb(clone(inbox)); } catch (e) { console.error(e); } });
  }
  function idle() { return busy || queue.length ? new Promise(function (r) { idleWaiters.push(r); }) : Promise.resolve(); }

  var fetching = null, again = false, firstError = null;
  function refresh() {
    if (signedOut) return Promise.resolve();
    if (fetching) { again = true; return fetching; }
    fetching = (async function () {
      do {
        again = false;
        var start = epoch, data;
        try { data = await call('data'); }
        catch (e) {
          if (!loaded) ['crew', 'jobs'].forEach(function (c) { listeners[c].forEach(function (l) { if (l.err) l.err(e); }); });
          firstError = e;
          break;
        }
        // Something was changed on this page while the list was loading: wait for it to save, then load again.
        if (epoch !== start || busy || queue.length) { again = true; await idle(); continue; }
        firstError = null;
        apply(data);
      } while (again);
    })().finally(function () { fetching = null; });
    return fetching;
  }
  var refreshTimer = null;
  function refreshSoon(ms) { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, ms); }

  function enqueue(op, col, id, data) {
    if (signedOut) { var so = new Error('signed_out'); so.code = 'signed_out'; return Promise.reject(so); }
    data = clone(data);
    var cur = store[col].get(id);
    if (op === 'update' && !cur) { var nf = new Error('not_found'); nf.code = 'not_found'; return Promise.reject(nf); }
    epoch++;
    if (op === 'set') store[col].set(id, data);
    else if (op === 'update') store[col].set(id, deepMerge(cur, data));
    else store[col].delete(id);
    queueMicrotask(function () { emit(col); });
    return new Promise(function (resolve, reject) { queue.push({ op: op, col: col, id: id, data: data, resolve: resolve, reject: reject }); pump(); });
  }
  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      var w = queue.shift();
      try { await call('write', { op: w.op, col: w.col, id: w.id, data: w.data }); w.resolve(); }
      catch (e) { resync = true; w.reject(e); }
    }
    busy = false;
    idleWaiters.splice(0).forEach(function (r) { r(); });
    refreshSoon(resync ? 0 : 900);
    resync = false;
  }

  function collection(col) {
    return {
      doc: function (id) {
        return {
          set: function (d) { return enqueue('set', col, String(id), d); },
          update: function (d) { return enqueue('update', col, String(id), d); },
          delete: function () { return enqueue('delete', col, String(id)); }
        };
      },
      onSnapshot: function (cb, err) {
        var l = { cb: cb, err: err };
        listeners[col].push(l);
        if (loaded) queueMicrotask(function () { cb(snapshot(col)); });
        return function () { listeners[col] = listeners[col].filter(function (x) { return x !== l; }); };
      }
    };
  }

  /* ---------- Wix Contacts, through the server ---------- */
  async function wix(method, url, body) {
    var path = new URL(url).pathname, b = body || {}, req;
    var seg = path.split('/');
    if (method === 'POST' && path === '/contacts/v4/labels/query') req = { op: 'labels' };
    else if (method === 'POST' && path === '/contacts/v4/labels') req = { op: 'label_create', displayName: b.displayName };
    else if (method === 'GET' && /^\/contacts\/v4\/contacts\/[0-9a-f-]{36}$/.test(path)) req = { op: 'tags', id: seg[4] };
    else if (method === 'POST' && path === '/contacts/v5/contacts/search') req = { op: 'find', filter: (b.search || {}).filter };
    else if (method === 'POST' && path === '/contacts/v4/contacts') req = { op: 'create', info: b.info };
    else if (method === 'POST' && /^\/contacts\/v4\/contacts\/[0-9a-f-]{36}\/labels$/.test(path)) req = { op: 'label_add', id: seg[4], labelKeys: b.labelKeys };
    else if (method === 'DELETE' && /^\/contacts\/v4\/contacts\/[0-9a-f-]{36}\/labels$/.test(path)) req = { op: 'label_remove', id: seg[4], labelKeys: b.labelKeys };
    else if (method === 'POST' && path === '/contacts/v4/contacts/query') req = { op: 'crew' };
    else { var un = new Error('unsupported'); un.code = 'unsupported'; throw un; }
    try { return (await call('wix', req)).result || {}; }
    catch (e) {
      if (e.code === 'wix_not_set') e.code = 'server_not_connected';
      else if (e.code !== 'signed_out' && e.code !== 'offline') e.code = 'wix_error';
      throw e;
    }
  }

  /* ---------- start ---------- */
  var resolveReady, rejectReady;
  var ready = new Promise(function (res, rej) { resolveReady = res; rejectReady = rej; });
  ready.catch(function () {});

  async function signOut() {
    try { await call('logout', {}); } catch (e) { /* signed out either way */ }
    store.crew.clear(); store.jobs.clear(); clients = null; clientsJson = '';
    showGate('signedout');
    $('gateMsg').textContent = 'Signed out.';
  }

  async function start() {
    var params = new URLSearchParams(location.search);
    var reason = params.get('signin');
    if (reason) history.replaceState(null, '', location.pathname);
    $('signOut').addEventListener('click', signOut);
    var me;
    try { me = await call('me'); }
    catch (e) {
      if (e.code === 'signed_out') { showGate(MESSAGES[reason] ? reason : undefined); signedOut = true; }
      else { showGate(e.code === 'offline' ? 'offline' : 'failed'); }
      rejectReady(e);
      return;
    }
    showApp(me.email);
    resolveReady({
      collection: collection, wix: wix, email: me.email,
      onInbox: function (cb) { inboxListeners.push(cb); },
      inboxDone: function (id) { return call('write', { op: 'delete', col: 'inbox', id: id }); },
      onClients: function (cb) { clientListeners.push(cb); if (clients) queueMicrotask(function () { cb(clone(clients)); }); },
      // A change to a client job: saved on the server first, then shown.
      client: async function (body) {
        var r = await call('client', body);
        if (r && r.job && clients) {
          clients = clients.map(function (c) { return c.id === r.job.id ? Object.assign({}, c, { data: r.job.data }) : c; });
          clientsJson = JSON.stringify(clients);
          emitClients();
        }
        refreshSoon(900);
        return r && r.job;
      }
    });
    refresh();
    setInterval(function () { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refresh(); });
  }

  window.hbsTeam = { ready: ready, refresh: refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
