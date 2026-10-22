# Theme settings validation

From `tooling/`, run `npm ci` and `npm test` with Node 22 or newer.

For the rendered CSS checks, run `npm run test:browser`. The browser test uses
`CHROMIUM_PATH`, `/usr/bin/chromium` if present, or Playwright's bundled browser.
If needed, install that browser with `npx playwright install chromium` first.
It tests card typography, schemes, spacing, fields, cart bubbles, banner sizing
and account navigation at 375, 768 and 1440 pixels. Surface tests also cover RTL.
Banner DOM and the account-service destination are fixtures: these tests do not
record cookie consent, authenticate customers, or create accounts.

The tests validate theme and section schemas, preserve the existing setting IDs,
and render the shared typography, color, card and cookie-banner paths with
LiquidJS. Shopify-specific color/font filters are emulated for these focused
tests. Storelib's commit status remains the authoritative compiler and quality
check; these tests do not replace it.

## Editing controls

- Site colors defines Page colors, Soft surface, Inverse and Accent pairs and
  the default scheme. Sections follow that default unless they choose a named
  scheme or Custom colors. Groups follow their parent section. Named schemes
  control text, background, buttons and inputs together; Page colors and Custom
  retain the global button/field colors. Contrast protection chooses black or
  white for unreadable surface text unless disabled. Individual text blocks can
  still override inherited colors.
- Fonts & text styles sets the family and base weight. Paragraph and heading
  presets inherit that weight or use their own weight override. A chosen weight
  must be available in the font family for a matching font file to load.
- Product cards defaults to Theme settings for spacing, borders, title and price
  typography, including product cards in search. Choose Custom in a product-card block for local styling. Image
  blocks have their own Use theme image settings switch.
- Cookie banner controls only style Shopify's native customer privacy banner.
  Configure consent, regions, text and policy links in the platform's privacy
  settings. A Storelib site needs its platform's consent integration; this theme
  does not invent a consent record or show a second banner.
- Layout & spacing sets the page width and scales larger spacing values.
  Spacing helpers accept both Shopify hyphenated keys and editor underscore keys.
- Form fields → Field text style applies the shared preset to inputs/selects.
  Fields stay at least 16px to prevent mobile focus zoom.
- Customer accounts configures header visibility, entry-page links, colors and
  layout. `/login`, `/signup` and `/customer-account` use `customer-access`.
  Signed-out actions hand off to `routes.account_url` (the built-in `/account`
  route); Storelib owns authentication and account creation. Signed-in screens
  show only server-provided profile details and hand off account management.
  Disabling platform accounts removes the authentication action.

Existing setting IDs and stored merchant values are retained; missing global
defaults are materialized, and the homepage's deliberate local backgrounds are
marked Custom. The white page-text value is retained, with automatic contrast
protection making it readable on its white background. The header's transparent
state can still use that original light text.

The authoritative editable schemas are `shopify/config/settings_schema.json` and
each `.storelib` file's `shopify` schema. Storelib regenerates the other builder
panel fields; do not hand-edit those generated copies or settings_panel.json.

When coordinating sessions, fetch and reconcile incoming changes before pushing;
never force-push the theme. A local pass does not establish a Storelib import or
an end-to-end login: check the platform commit status and built-in account flow.
