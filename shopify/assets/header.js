import { Component } from '@theme/component';
import { onDocumentLoaded, changeMetaThemeColor, setHeaderMenuStyle, calculateHeaderGroupHeight } from '@theme/utilities';
import {
  getScrollTop,
  getScrollEventTarget,
  getIntersectionRoot,
  scrollContainerMediaQuery,
} from '@theme/scroll-container';

/**
 * @typedef {Object} HeaderComponentRefs
 * @property {HTMLDivElement} headerDrawerContainer - The header drawer container element
 * @property {HTMLElement} headerMenu - The header menu element
 * @property {HTMLElement} headerRowTop - The header top row element
 */

/**
 * @typedef {CustomEvent<{ minimumReached: boolean }>} OverflowMinimumEvent
 */

/**
 * A custom element that manages the site header.
 *
 * @extends {Component<HeaderComponentRefs>}
 */

class HeaderComponent extends Component {
  requiredRefs = ['headerDrawerContainer', 'headerMenu', 'headerRowTop'];

  /**
   * An intersection observer for monitoring sticky header position
   * @type {IntersectionObserver | null}
   */
  #intersectionObserver = null;

  /** @type {EventTarget | null} */
  #scrollContainer = null;

  /**
   * The last recorded scrollTop of the document, when sticky behavior is 'scroll-up
   * @type {number}
   */
  #lastScrollTop = 0;

  /** @type {'up' | 'down' | 'none'} */
  #lastMovementDirection = 'none';

  /** @type {number} Scroll coordinate at the last reversal. */
  #directionAnchor = 0;

  /** Debounce small touchpad / inertial jitter before toggling visibility. */
  #scrollIntentThreshold = 12;

  /** Cache the measured height instead of forcing layout on every scroll. */
  #headerHeight = 60;

  /** @type {MediaQueryList} */
  #mobileNavigationQuery = window.matchMedia('(max-width: 749px)');

  /**
   * RAF ID for scroll handler throttling
   * @type {number | null}
   */
  #scrollRafId = null;

  /**
   * Keeps the global `--header-height` custom property up to date,
   * which other theme components can then consume
   */
  #resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry || !entry.borderBoxSize[0]) return;

    // The initial height is calculated using the .offsetHeight property, which returns an integer.
    // We round to the nearest integer to avoid unnecessaary reflows.
    const roundedHeaderHeight = Math.round(entry.borderBoxSize[0].blockSize);
    this.#headerHeight = roundedHeaderHeight;
    document.body.style.setProperty('--header-height', `${roundedHeaderHeight}px`);
  });

  /** Observes whether the "always" sticky header is at its natural position. */
  #observeStickyPosition = () => {
    if (this.#intersectionObserver) return;

    const config = {
      threshold: 1,
      root: getIntersectionRoot(),
    };

    this.#intersectionObserver = new IntersectionObserver(([entry]) => {
      if (!entry) return;

      const { isIntersecting } = entry;

      this.dataset.stickyState = isIntersecting ? 'inactive' : 'active';
      if (this.dataset.themeColor) changeMetaThemeColor(this.dataset.themeColor);
    }, config);

    this.#intersectionObserver.observe(this);
  };

  /**
   * The overflow-list still decides which links live under "More". It must NOT
   * replace the desktop header with a mobile drawer when items are numerous.
   * @param {OverflowMinimumEvent} _event
   */
  #handleOverflowMinimum = (_event) => {
    // Deliberate no-op: inline overflow is managed by overflow-list.
  };

  /** Close a previously opened mobile drawer when switching to desktop. */
  #handleNavigationBreakpointChange = () => {
    setHeaderMenuStyle();
    if (!this.#mobileNavigationQuery.matches) {
      const drawer = this.querySelector('header-drawer');
      if (drawer?.querySelector('#Details-menu-drawer-container[open]')) {
        drawer.close?.();
      }
    }
  };

  /**
   * Rebinds the scroll listener and IntersectionObserver when the viewport
   * crosses the squeeze breakpoint (990px). The scroll container switches
   * between `.page-wrapper` (desktop) and `document.scrollingElement` (mobile),
   * so cached bindings from initialization become stale after a resize.
   */
  #handleBreakpointChange = () => {
    const stickyMode = this.getAttribute('sticky');
    if (!stickyMode) return;

    // Rebind scroll listener
    if (this.#scrollContainer) {
      this.#scrollContainer.removeEventListener('scroll', this.#handleWindowScroll);
      this.#scrollContainer = getScrollEventTarget();
      this.#scrollContainer.addEventListener('scroll', this.#handleWindowScroll);
    }

    // Recreate IntersectionObserver with the new root
    this.#intersectionObserver?.disconnect();
    this.#intersectionObserver = null;
    // The scroll-up header stays sticky in CSS; it needs no intersection observer.
    if (stickyMode === 'always') this.#observeStickyPosition();
    this.#updateScrollState();
  };

  #handleWindowScroll = () => {
    if (this.#scrollRafId !== null) return;

    this.#scrollRafId = requestAnimationFrame(() => {
      this.#scrollRafId = null;
      this.#updateScrollState();
    });
  };

  #updateScrollState = () => {
    const stickyMode = this.getAttribute('sticky');
    const scrollTop = Math.max(0, getScrollTop());
    const difference = scrollTop - this.#lastScrollTop;

    if (stickyMode === 'always') {
      this.dataset.scrollDirection = scrollTop <= 2 ? 'none' : difference < 0 ? 'up' : 'down';
      this.#lastScrollTop = scrollTop;
      return;
    }

    if (stickyMode !== 'scroll-up') return;

    // At the top the header should occupy its original place without a jump.
    if (scrollTop <= 2) {
      this.dataset.stickyState = 'inactive';
      this.dataset.scrollDirection = 'none';
      this.#lastMovementDirection = 'none';
      this.#directionAnchor = 0;
      this.#lastScrollTop = scrollTop;
      return;
    }

    // Do not snap to visible/hidden for tiny touchpad or momentum oscillations.
    if (Math.abs(difference) < 0.8) return;
    const movementDirection = difference < 0 ? 'up' : 'down';
    if (movementDirection !== this.#lastMovementDirection) {
      this.#lastMovementDirection = movementDirection;
      this.#directionAnchor = this.#lastScrollTop;
    }
    this.#lastScrollTop = scrollTop;

    const headerHeight = this.#headerHeight;
    if (scrollTop < headerHeight + 8 && movementDirection === 'down') {
      // Still inside the header's original, in-flow position.
      this.dataset.stickyState = 'inactive';
      this.dataset.scrollDirection = 'none';
      return;
    }

    if (Math.abs(scrollTop - this.#directionAnchor) < this.#scrollIntentThreshold) return;

    const drawerOpen = Boolean(this.querySelector('#Details-menu-drawer-container[open]'));
    const menuOpen = Boolean(this.querySelector('header-menu[aria-expanded="true"]'));
    if (movementDirection === 'up' || drawerOpen || menuOpen) {
      this.dataset.stickyState = 'active';
      this.dataset.scrollDirection = 'up';
    } else {
      this.dataset.stickyState = 'idle';
      this.dataset.scrollDirection = 'down';
    }
  };

  connectedCallback() {
    super.connectedCallback();
    this.#headerHeight = this.offsetHeight || 60;
    this.#resizeObserver.observe(this);
    this.addEventListener('overflowMinimum', this.#handleOverflowMinimum);
    this.#mobileNavigationQuery.addEventListener('change', this.#handleNavigationBreakpointChange);
    this.#handleNavigationBreakpointChange();

    const stickyMode = this.getAttribute('sticky');
    if (stickyMode) {
      if (stickyMode === 'always') this.#observeStickyPosition();

      if (stickyMode === 'scroll-up' || stickyMode === 'always') {
        this.#scrollContainer = getScrollEventTarget();
        this.#scrollContainer.addEventListener('scroll', this.#handleWindowScroll);
      }

      scrollContainerMediaQuery.addEventListener('change', this.#handleBreakpointChange);
      // A restored scroll position can be below the header on first paint.
      this.#lastScrollTop = getScrollTop();
      this.#directionAnchor = this.#lastScrollTop;
      if (stickyMode === 'scroll-up' && this.#lastScrollTop > this.#headerHeight) {
        this.dataset.stickyState = 'idle';
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#resizeObserver.disconnect();
    this.#intersectionObserver?.disconnect();
    this.removeEventListener('overflowMinimum', this.#handleOverflowMinimum);
    this.#mobileNavigationQuery.removeEventListener('change', this.#handleNavigationBreakpointChange);
    scrollContainerMediaQuery.removeEventListener('change', this.#handleBreakpointChange);
    this.#scrollContainer?.removeEventListener('scroll', this.#handleWindowScroll);
    this.#scrollContainer = null;
    if (this.#scrollRafId !== null) {
      cancelAnimationFrame(this.#scrollRafId);
      this.#scrollRafId = null;
    }
    requestAnimationFrame(() => {
      if (!document.querySelector('header-component')) document.body.style.setProperty('--header-height', '0px');
    });
  }
}

if (!customElements.get('header-component')) {
  customElements.define('header-component', HeaderComponent);
}

onDocumentLoaded(() => {
  const headerGroup = document.querySelector('#header-group');
  if (!headerGroup) return;
  const targets = new Set();
  let frame;
  const measure = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const header = document.querySelector('header-component');
      const height = Math.round(calculateHeaderGroupHeight(header, headerGroup)) + 'px';
      if (document.body.style.getPropertyValue('--header-group-height') !== height) {
        document.body.style.setProperty('--header-group-height', height);
      }
    });
  };
  const resizeObserver = new ResizeObserver(measure);
  const reconcile = () => {
    const next = new Set([...headerGroup.children, document.querySelector('header-component')].filter(Boolean));
    for (const target of targets) if (!next.has(target)) { resizeObserver.unobserve(target); targets.delete(target); }
    for (const target of next) if (!targets.has(target)) { resizeObserver.observe(target); targets.add(target); }
    measure();
  };
  // Measure every child, not only the entries which happened to resize this frame.
  new MutationObserver(reconcile).observe(headerGroup, { childList: true, subtree: true });
  document.fonts?.addEventListener('loadingdone', measure);
  reconcile();
});
