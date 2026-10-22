// Theme editor specific logic
import { updateAllHeaderCustomProperties } from '@theme/utilities';
import { getScrollContainer } from '@theme/scroll-container';

/**
 * Keeps the preview's scroll position when the editor reloads the page after a setting change.
 *
 * history.state only survives a same-entry reload that fires pagehide. An editor that resets the
 * frame's address or replaces the frame loses it, and on desktop `.page-wrapper` is the scroller,
 * which the browser never restores natively. The position is kept per page in sessionStorage and
 * re-applied once the page is tall enough, until the visitor scrolls themselves.
 */
(function editorScrollKeeper() {
  const KEY = 'editor-scroll-position';
  const MAX_AGE = 30 * 60 * 1000;
  const SETTLE_TIME = 4000;
  const page = location.pathname + location.search;

  const read = () => {
    try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
  };
  const write = (value) => {
    try { value ? sessionStorage.setItem(KEY, JSON.stringify(value)) : sessionStorage.removeItem(KEY); } catch {}
  };

  let restoring = false;
  let saveFrame;
  const save = () => {
    if (restoring) return;
    write({ page, top: getScrollContainer().scrollTop, time: Date.now() });
  };
  const scheduleSave = () => {
    if (saveFrame) return;
    saveFrame = requestAnimationFrame(() => {
      saveFrame = undefined;
      save();
    });
  };

  const saved = read();
  if (saved?.page === page && Date.now() - saved.time < MAX_AGE && saved.top > 0) {
    restoring = true;
    const stop = () => {
      if (!restoring) return;
      restoring = false;
      resizeObserver.disconnect();
      clearTimeout(timer);
      for (const name of ['wheel', 'touchstart', 'keydown', 'pointerdown']) removeEventListener(name, stop, true);
      save();
    };
    const apply = () => {
      if (!restoring) return;
      const container = getScrollContainer();
      const max = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTo({ top: Math.min(saved.top, max), behavior: 'instant' });
    };
    // Late images, fonts and sections grow the page; follow them until the target is reachable.
    const resizeObserver = new ResizeObserver(apply);
    const timer = setTimeout(stop, SETTLE_TIME);
    for (const name of ['wheel', 'touchstart', 'keydown', 'pointerdown']) addEventListener(name, stop, { capture: true, passive: true });
    resizeObserver.observe(document.body);
    const wrapper = document.querySelector('.page-wrapper');
    if (wrapper) {
      resizeObserver.observe(wrapper);
      for (const child of wrapper.children) resizeObserver.observe(child);
    }
    apply();
    addEventListener('load', apply, { once: true });
  }

  // Element scroll events do not bubble; capture sees `.page-wrapper` and the document alike.
  document.addEventListener('scroll', scheduleSave, { capture: true, passive: true });
  addEventListener('pagehide', save);
})();

/** @type {{ activeSlideIndex: number | null }} */
const layeredSlideshowState = {
  activeSlideIndex: null,
};

/** @type {{ activeSlideIndex: number | null }} */
const carouselState = {
  activeSlideIndex: null,
};

/** @type {{ activeSlideIndex: number | null }} */
const slideshowState = {
  activeSlideIndex: null,
};

/**
 * @param {Event} event
 */
document.addEventListener('shopify:block:select', function (event) {
  if (event.target instanceof HTMLElement) {
    // Check if the selected element is specifically a product-card block itself
    // Not a child block within the product card

    // First, remove data-no-navigation from any previously selected product cards
    document.querySelectorAll('product-card[data-no-navigation]').forEach((card) => {
      if (card instanceof HTMLElement) {
        card.removeAttribute('data-no-navigation');
      }
    });

    if (event.target.tagName === 'PRODUCT-CARD') {
      const section = event.target.closest('.shopify-section');

      if (section) {
        const productCardsInSection = section.querySelectorAll('product-card');

        productCardsInSection.forEach((card) => {
          if (card instanceof HTMLElement) {
            card.setAttribute('data-no-navigation', 'true');
          }
        });
      }
    }

    // Keep track of the selected slide for the slideshow
    const slide = event.target.closest('slideshow-slide');

    if (slide) {
      /** @type {import('./slideshow').Slideshow | null} */
      const slideshow = slide.closest('slideshow-component');

      if (slideshow) {
        const index = Array.from(slide.parentElement?.children ?? []).indexOf(slide);

        if (index === -1) return;

        // Compare before updating to detect if same slide is selected again
        const isAlreadyActive = index === slideshowState.activeSlideIndex;
        slideshowState.activeSlideIndex = index;
        // Pause autoplay
        slideshow.pause();
        slideshow.select(index, undefined, { animate: isAlreadyActive ? false : true });
      }
    }

    // Keep track of the selected slide for the carousel
    const carouselCard = event.target.closest('[data-carousel-card]');

    if (carouselCard) {
      /** @type {import('./slideshow').Slideshow | null} */
      const slideshow = carouselCard.closest('slideshow-component');

      if (slideshow) {
        const cards = Array.from(carouselCard.parentElement?.children ?? []);
        if (!cards) return;

        const index = cards.indexOf(carouselCard);

        if (index === -1) return;

        // Compare before updating to detect if same slide is selected again
        const isAlreadyActive = index === carouselState.activeSlideIndex;
        carouselState.activeSlideIndex = index;
        const targetCard = cards[index];

        if (targetCard instanceof HTMLElement) {
          targetCard.scrollIntoView({ behavior: isAlreadyActive ? 'instant' : 'smooth', inline: 'center' });
        }
      }
    }

    // Keep track of the selected slide for the layered slideshow
    const layeredSlideshowPanel = event.target.closest('layered-slideshow-component [role="tabpanel"]');

    if (layeredSlideshowPanel) {
      /** @type {import('./layered-slideshow').LayeredSlideshowComponent | null} */
      const layeredSlideshow = layeredSlideshowPanel.closest('layered-slideshow-component');
      if (!layeredSlideshow) return;

      const index = Array.from(layeredSlideshow.querySelectorAll('[role="tabpanel"]')).indexOf(layeredSlideshowPanel);
      if (index === -1) return;

      // Compare before updating to detect if same slide is selected again
      const isAlreadyActive = index === layeredSlideshowState.activeSlideIndex;
      layeredSlideshowState.activeSlideIndex = index;

      // Use instant transition if the same slide is selected again
      layeredSlideshow.select(index, { instant: isAlreadyActive });
    }
  }
});

document.addEventListener('shopify:block:deselect', function (event) {
  if (event.target instanceof HTMLElement) {
    // Remove data-no-navigation when product card is deselected
    if (event.target.tagName === 'PRODUCT-CARD') {
      event.target.removeAttribute('data-no-navigation');
    }

    /** @type {import('./slideshow').Slideshow | null} */
    const slideshow = event.target.closest('slideshow-component');

    if (slideshow) {
      // Resume playback
      slideshow.resume();
    }
  }
});

// Reconcile once per frame, after section replacement has finished.
let headerFrame;
function scheduleHeaderUpdate() {
  if (headerFrame) return;
  headerFrame = requestAnimationFrame(() => {
    headerFrame = undefined;
    updateAllHeaderCustomProperties();
  });
}
for (const name of ['load', 'unload', 'reorder']) {
  document.addEventListener('shopify:section:' + name, scheduleHeaderUpdate);
}
document.fonts?.addEventListener('loadingdone', scheduleHeaderUpdate);

/**
 * When in the theme editor, it can be frustrating to be tweaking the design of features that are implemented as a dialog
 * or any sort of overlay, because the theme editor will refresh the page and close the dialog.
 *
 * This script is used to save the state of these features and restore it when the page is refreshed, to make things a little more seamless.
 */

// Detect when page is about to unload
// This helps distinguish between theme editor refreshes (which don't trigger beforeunload)
// and actual navigation (which does trigger beforeunload)
window.addEventListener('beforeunload', function (_event) {
  // Set a flag to indicate that an actual unload is happening (not just a refresh)
  try { sessionStorage.setItem('editor-page-unloading', 'true'); } catch { /* Storage can be blocked in an embedded editor. */ }
});

// Check if the device is iOS as Safari on iOS doesn't support the beforeunload event
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

if (window.Shopify?.designMode && !isIOS) {
  // Skip editor state management on iOS devices
  (function editorStateManager() {
    const EDITOR_PREFIX = 'editor-save-state';
    // A blocked storage area must not break the rest of the theme editor.
    const storage = {
      get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
      set(key, value) { try { if (sessionStorage.getItem(key) !== value) sessionStorage.setItem(key, value); } catch {} },
      remove(key) { try { sessionStorage.removeItem(key); } catch {} },
      keys() { try { return Object.keys(sessionStorage); } catch { return []; } },
    };

    /**
     * Check if the page just unloaded (actual navigation) vs a refresh
     * @returns {boolean}
     */
    function wasPageUnloading() {
      const unloading = storage.get('editor-page-unloading') === 'true';
      // Clear the flag after checking
      if (unloading) {
        storage.remove('editor-page-unloading');
      }
      return unloading;
    }

    /**
     * Clear all saved editor states
     */
    function clearAllEditorStates() {
      const keys = storage.keys();
      keys.forEach((key) => {
        if (key.startsWith(EDITOR_PREFIX)) {
          storage.remove(key);
        }
      });
    }

    /**
     * @param {string} name
     */
    function getEditorState(name) {
      const state = storage.get(`${EDITOR_PREFIX}-${name}`);
      try { return state ? JSON.parse(state) : null; } catch { return null; }
    }

    /**
     * @param {string} name
     * @param {boolean} isOpen
     * @param {string | undefined} instanceId
     */
    function saveEditorState(name, isOpen, instanceId) {
      storage.set(`${EDITOR_PREFIX}-${name}`, JSON.stringify({ isOpen, instanceId }));
    }

    /** @type {{name: string, selector: string, matches: (el: Element) => boolean, isOpen: (el: Element) => boolean, open: (el: Element, instanceId?: string) => void, getInstanceId?: (el: Element) => string | undefined}[]} */
    const features = [
      {
        name: 'account-popover',
        selector: 'shopify-account',
        matches(el) {
          return !!el.closest(this.selector);
        },
        isOpen: (el) => {
          const shadowRoot = el.shadowRoot;
          if (!shadowRoot) return false;

          // The polyfill does not patch ShadowRoot.querySelector; it marks open popovers with a class instead.
          const openPopoverSelector = Theme.supportsNativePopover
            ? '[popover]:popover-open'
            : '[popover].\\:popover-open';
          return shadowRoot.querySelector(`dialog[open], ${openPopoverSelector}`) != null;
        },
        async open(el) {
          await customElements.whenDefined('shopify-account');
          const shadowRoot = el.shadowRoot;
          if (shadowRoot) {
            const button =
              shadowRoot.querySelector('button[popovertarget], button[aria-haspopup]') ??
              shadowRoot.querySelector('button');
            if (button instanceof HTMLElement) {
              button.click();
              return;
            }
          }
          if (el instanceof HTMLElement) el.click();
        },
      },
      {
        name: 'localization-dropdown',
        selector: 'dropdown-localization-component',
        matches(el) {
          return !!el.closest(this.selector);
        },
        isOpen: (el) => el.getAttribute('aria-expanded') === 'true',
        // @ts-ignore
        open: (el) => el.showPanel(),
      },
      {
        name: 'search-modal',
        selector: '.search-modal',
        matches(el) {
          return !!el.closest(this.selector);
        },
        isOpen: (el) => el.getAttribute('open') != null,
        // @ts-ignore
        open: (el) => el.showDialog(),
      },
      {
        name: 'header-drawer',
        selector: 'header-drawer',
        matches(el) {
          return !!el.closest(this.selector);
        },
        isOpen: (el) => el.getAttribute('open') != null,
        open: (el) => {
          // @ts-ignore
          el.open();
          // @ts-ignore
          el.refs.details.setAttribute('open', '');
        },
      },
      {
        name: 'local-pickup-modal',
        selector: '.pickup-location__dialog',
        matches(el) {
          return el.matches(this.selector);
        },
        isOpen: (el) => el.getAttribute('open') != null,
        open: (el) => {
          // @ts-ignore
          el.closest('dialog-component').toggleDialog();
        },
      },
      {
        name: 'quick-add-modal',
        getInstanceId: (el) => {
          // @ts-ignore
          return el.querySelector('product-price')?.dataset?.productId;
        },
        selector: '.quick-add-modal',
        matches(el) {
          return el.matches(this.selector);
        },
        isOpen: (el) => el.getAttribute('open') != null,
        open: (el, instanceId) => {
          const button = document.querySelector(
            `quick-add-component[data-product-id="${instanceId}"] .quick-add__button--choose`
          );

          // @ts-ignore
          button?.click();
        },
      },
      {
        name: 'floating-panel-component',
        getInstanceId: (el) => {
          return el.id;
        },
        selector: '.facets__panel',
        matches(el) {
          return el.matches(this.selector);
        },
        isOpen: (el) => el.getAttribute('open') != null,
        open: (el, instanceId) => document.querySelector(`#${instanceId}`)?.setAttribute('open', ''),
      },
      {
        name: 'facets-panel',
        selector: '.facets--drawer',
        matches(el) {
          return el.matches(this.selector);
        },
        isOpen: (el) => el.getAttribute('open') != null,
        open: (el) => el?.setAttribute('open', ''),
      },
    ];

    // On page load, restore the state of the features
    // Skip restoration if the page just unloaded (actual navigation happened)
    if (wasPageUnloading()) {
      // Clear all saved states since we navigated away
      clearAllEditorStates();
    } else {
      features.forEach((feature) => {
        const el = document.querySelector(feature.selector);
        if (!el) return;

        const state = getEditorState(feature.name);
        const shouldBeOpen = state?.isOpen;
        const instanceId = state?.instanceId;

        if (shouldBeOpen) {
          // Prevents race condition with the open methods not always being available immediately
          setTimeout(() => {
            feature.open(el, instanceId);
          });
        }
      });
    }

    /** @param {Element} el */
    const update = (el) => {
      const feature = features.find((f) => f.matches(el));
      if (!feature) return;

      const isOpen = feature.isOpen(el);
      const instanceId = feature.getInstanceId?.(el);

      saveEditorState(feature.name, isOpen, instanceId);
    };

    const trackedAttributes = ['open', 'aria-expanded'];

    // Track state changes via attribute changes
    const pending = new Set();
    let stateFrame;
    const observer = new MutationObserver((list) => {
      for (const mutation of list) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName &&
          trackedAttributes.includes(mutation.attributeName)
        ) {
          const element = /** @type {Element} */ (mutation.target);
          pending.add(element);
        }
      }
      if (!stateFrame && pending.size) stateFrame = requestAnimationFrame(() => {
        stateFrame = undefined;
        for (const element of pending) if (element.isConnected) update(element);
        pending.clear();
      });
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: trackedAttributes,
      subtree: true,
    });

    // To track shopify-account state changes
    (async () => {
      // A Storelib import uses a same-origin account link, not Shopify's widget.
      const el = document.querySelector('shopify-account');
      if (!el) return;
      await customElements.whenDefined('shopify-account');
      if (!el.shadowRoot) return;

      const shadowObserver = new MutationObserver(() => {
        update(el);
      });

      shadowObserver.observe(el.shadowRoot, {
        attributes: true,
        attributeFilter: ['open'],
        subtree: true,
      });

      // Popover API's toggle event has composed: true, so it crosses the shadow boundary
      el.addEventListener('toggle', () => update(el), true);
    })();
  })();
}
