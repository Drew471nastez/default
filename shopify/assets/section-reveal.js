/**
 * Animations > Sections on scroll.
 *
 * Sections below the first screen start hidden and come in as they are scrolled to. What the
 * page opens on is never hidden, and a section the builder draws again while editing is shown
 * as it is: only the page as it first loads animates. The look (fade, rise, zoom, slide, blur) and its speed
 * are the theme's CSS (snippets/theme-styles-variables), so changing them never reloads the page.
 */

const PENDING = 'pending';
const SHOWN = 'shown';
// The page's own sections only: the header and footer stay put.
const SELECTOR = '#MainContent > .shopify-section';

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
  const done = () => {
    section.removeEventListener('transitionend', ended);
    delete section.dataset.reveal;
    section.style.removeProperty('transition-delay');
  };
  // The section's own transition only: one ending inside it (a button's hover) is not this one.
  const ended = (/** @type {TransitionEvent} */ event) => {
    if (event.target === section && event.propertyName === 'opacity') done();
  };
  section.addEventListener('transitionend', ended);
  setTimeout(done, 2400);
}

const observer = new IntersectionObserver(
  (entries) => {
    // Sections that come into view together follow each other by a short step.
    let step = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const target = entry.target;
      if (target instanceof HTMLElement) target.style.transitionDelay = `${Math.min(step, 3) * 90}ms`;
      step += 1;
      show(target);
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

/**
 * The builder's live preview: a new animation, once chosen, plays once on the sections mostly in
 * view, so it can be seen. Nothing replays while a control is still moving, nor for a speed.
 */
function replay() {
  if (!enabled()) return;
  const fold = window.innerHeight;
  for (const section of document.querySelectorAll(SELECTOR)) {
    if (!(section instanceof HTMLElement) || section.dataset.reveal) continue;
    const box = section.getBoundingClientRect();
    const visible = Math.min(box.bottom, fold) - Math.max(box.top, 0);
    if (box.height === 0 || visible < 0.6 * Math.min(box.height, fold)) continue;
    section.dataset.reveal = PENDING;
    requestAnimationFrame(() => requestAnimationFrame(() => show(section)));
  }
}

document.addEventListener('storelib:settings-change', (event) => {
  const detail = /** @type {CustomEvent} */ (event).detail ?? {};
  if (detail.live || !('section_animation' in (detail.settings ?? {}))) return;
  // The canvas writes the new CSS first; read it on the next frame.
  requestAnimationFrame(replay);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
