# Theme settings validation

From `tooling/`, run `npm ci` and `npm test` with Node 22 or newer.

For the rendered CSS checks, run `npm run test:browser`. The browser test uses
`CHROMIUM_PATH`, `/usr/bin/chromium` if present, or Playwright's bundled browser.
If needed, install that browser with `npx playwright install chromium` first.
It tests card typography, schemes, spacing and banner sizing at 375, 768 and
1440 pixels using rendered theme snippets and a platform-banner DOM fixture.

The tests validate theme and section schemas, preserve the existing setting IDs,
and render the shared typography, color, card and cookie-banner paths with
LiquidJS. Shopify-specific color/font filters are emulated for these focused
tests. Storelib's commit status remains the authoritative compiler and quality
check; these tests do not replace it.

## Editing controls

- Theme settings → Colors defines Soft surface, Inverse and Accent pairs.
  Sections can select a shared pair or keep Default / custom colors. A shared
  scheme controls text, background, buttons and inputs together. Choose text
  and background colors with sufficient contrast.
- Typography font pickers set the family and base weight. Paragraph and heading
  presets inherit that weight or use their own weight override. A chosen weight
  must be available in the font family for a matching font file to load.
- Product cards defaults to Theme settings for spacing, borders, title and price
  typography. Choose Custom in a product-card block for local styling. Image
  blocks have their own Use theme image settings switch.
- Cookie banner controls only style Shopify's native customer privacy banner.
  Configure consent, regions, text and policy links in the platform's privacy
  settings. A Storelib site needs its platform's consent integration; this theme
  does not invent a consent record or show a second banner.

Existing setting IDs and merchant values are retained. Shared section schemes
are opt-in. When coordinating sessions, fetch and reconcile incoming changes
before pushing; never force-push the theme.
