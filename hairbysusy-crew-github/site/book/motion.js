'use strict';
// Runs in <head>, before the page paints: turns on the home page's scroll motion (book.css, "Home
// page photos and motion"). Without it, every section simply shows.
if ('IntersectionObserver' in window) document.documentElement.classList.add('js');
