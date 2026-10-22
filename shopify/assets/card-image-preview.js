// A decoded overlay crossfades without changing the carousel or selected variant.
const previews = new WeakMap();

export async function previewCardImage(card) {
  const gallery = card.querySelector('.card-gallery');
  const slides = card.refs?.slideshow?.slides;
  if (!gallery || !slides?.length) return;
  const current = card.refs.slideshow.current || 0;
  const source = slides[(current + 1) % slides.length]?.querySelector('img');
  if (!source || slides.length < 2) return;
  let state = previews.get(card);
  if (state?.source !== source || !gallery.contains(state.image)) {
    disposeCardImagePreview(card);
    const image = document.createElement('img');
    image.className = 'card-gallery__hover-image';
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.decoding = 'async';
    image.style.objectFit = getComputedStyle(source).objectFit;
    if (source.sizes) image.sizes = source.sizes;
    if (source.srcset) image.srcset = source.srcset;
    image.src = source.currentSrc || source.src;
    gallery.append(image);
    state = { source, image, active: false, token: 0 };
    previews.set(card, state);
  }
  state.active = true;
  const token = ++state.token;
  try {
    await state.image.decode();
    // Ensure the initial opacity is painted before starting the transition.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (state.active && state.token === token && card.isConnected) state.image.dataset.visible = 'true';
    }));
  } catch {
    // Keep the original image if the secondary image cannot load.
  }
}

export function resetCardImage(card) {
  const state = previews.get(card);
  if (!state) return;
  state.active = false;
  state.token++;
  delete state.image.dataset.visible;
}

export function disposeCardImagePreview(card) {
  resetCardImage(card);
  previews.get(card)?.image.remove();
  previews.delete(card);
}
