'use strict';
// Runs in <head> on every HBS client page, before the page paints.

// The home page hides the sections that fade in as they scroll into view (book.css, .js .reveal).
if ('IntersectionObserver' in window) document.documentElement.classList.add('js');

// Moving between HBS pages is a smooth cross-fade where the browser supports it (book.css,
// @view-transition). If the browser skips one, the page simply appears; nothing is reported as an error.
(() => {
  const quiet = (e) => {
    const vt = e.viewTransition;
    if (!vt) return;
    for (const p of [vt.updateCallbackDone, vt.ready, vt.finished]) if (p && p.catch) p.catch(() => {});
  };
  addEventListener('pagereveal', quiet);
  // Only the HBS client pages (the home page at / and everything under /book/) take part. Going
  // anywhere else, such as the stylist sign-up at /apply/, the page changes without a transition.
  addEventListener('pageswap', (e) => {
    quiet(e);
    const vt = e.viewTransition;
    const entry = e.activation && e.activation.entry;
    if (!vt || !entry || !entry.url) return;
    const path = new URL(entry.url).pathname;
    if (path !== '/' && !path.startsWith('/book/')) vt.skipTransition();
  });
})();
