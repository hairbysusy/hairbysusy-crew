'use strict';

(() => {
  // Sections fade up as they come into view (book.css, "Home page photos and motion"). If anything
  // here fails, the motion is switched off and every section simply shows.
  try {
    const items = document.querySelectorAll('.reveal');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.12 });
    items.forEach((el) => io.observe(el));
  } catch (e) {
    document.documentElement.classList.remove('js');
  }

  // The photo wall behind the hero (book.css, .mosaic) runs to just past the hero's bottom edge, so
  // the photos sit behind the hero's button on every screen and fade out at the edge. It follows the
  // hero as fonts load and the window changes size. If this fails, the wall keeps its book.css height.
  try {
    const wall = document.querySelector('.mosaic');
    const hero = document.querySelector('.hero');
    const fit = () => {
      const bottom = Math.ceil(hero.getBoundingClientRect().bottom + window.scrollY);
      if (bottom > 0) wall.style.height = (bottom + 16) + 'px';
    };
    new ResizeObserver(fit).observe(hero);
    fit();
  } catch (e) { /* keeps the book.css height */ }

  // The page starts as "Online booking opens soon", with Get a stylist buttons that email
  // info@hairbysusy.com (bookhbs.com until posting opens). Where clients can post (test links, or
  // bookhbs.com once open), it shows the Post a job buttons instead.
  if (window.HBS.open) {
    for (const id of ['menuPost', 'heroPost', 'againOpen', 'againPost']) document.getElementById(id).hidden = false;
    for (const id of ['heroSoon', 'againSoon', 'againMail']) document.getElementById(id).hidden = true;
  }

  const btn = document.getElementById('menuBtn');
  const menu = document.getElementById('menu');
  const close = (focusBtn) => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focusBtn) btn.focus();
  };
  btn.addEventListener('click', () => {
    const opening = menu.hidden;
    menu.hidden = !opening;
    btn.setAttribute('aria-expanded', String(opening));
    if (opening) menu.querySelector('a:not([hidden])').focus();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) close(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) close(true);
  });

  const last = window.HBS.lastJob();
  if (last) {
    const link = document.getElementById('yourJobLink');
    link.href = window.HBS.jobUrl(last.j, last.k);
    link.textContent = 'See your job' + (typeof last.label === 'string' && last.label ? ' · ' + last.label.slice(0, 60) : '');
    document.getElementById('yourJob').hidden = false;
  }
})();
