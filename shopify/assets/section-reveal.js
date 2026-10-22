/**
 * Animations > Sections on scroll.
 *
 * Sections below the first screen start hidden and come in as they are scrolled to. What the
 * page opens on is never hidden, and a section the builder draws again while editing is shown
 * as it is: only the page as it first loads animates. The look (fade, rise, zoom) and its speed
 * are the theme's CSS (snippets/theme-styles-variables), so changing them never reloads the page.
 */

const PENDING = 'pending';
const SHOWN = 'shown';
const SELECTOR = '#MainContent > .shopify-section, footer > .shopify-section';

const root = document.documentElement;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

/** @returns {boolean} */
function enabled() {
  return getComputedStyle(root).getPropertyValue('--theme-section-animation').trim() === '1' && !reduced.matches;
}

/** @param {Element} section */
function show(section) {
  if (!(section instanceof HTMLElement) || section.dataset.reveal !== PENDING) return;
  section.dataset.reveal = SHOWN;
  // Once in place nothing is left on the section (a transform would hold sticky children).
  section.addEventListener('transitionend', () => delete section.dataset.reveal, { once: true });
  setTimeout(() => delete section.dataset.reveal, 2000);
}

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      show(entry.target);
    }
  },
  { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
);

function start() {
  if (!enabled()) return;
  const fold = window.innerHeight;
  for (const section of document.querySelectorAll(SELECTOR)) {
    if (!(section instanceof HTMLElement) || section.dataset.reveal) continue;
    if (section.getBoundingClientRect().top < fold) continue;
    section.dataset.reveal = PENDING;
    observer.observe(section);
  }
}

/** The builder's live preview: a new look or speed is played once on what is in view. */
function replay() {
  if (!enabled()) return;
  const fold = window.innerHeight;
  for (const section of document.querySelectorAll(SELECTOR)) {
    if (!(section instanceof HTMLElement) || section.dataset.reveal === PENDING) continue;
    const box = section.getBoundingClientRect();
    if (box.bottom < 0 || box.top > fold) continue;
    section.dataset.reveal = PENDING;
    requestAnimationFrame(() => requestAnimationFrame(() => show(section)));
  }
}

document.addEventListener('storelib:settings-change', (event) => {
  const changed = /** @type {CustomEvent} */ (event).detail?.settings ?? {};
  if ('section_animation' in changed || 'section_animation_speed' in changed) {
    // The canvas writes the new CSS first; read it on the next frame.
    requestAnimationFrame(replay);
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
