# Theme settings audit

This is a repository and local-browser audit, not a certification of Storelib's hosted editor or services.

## Recording and fixes

The supplied recording shows header position changes briefly stacking the navigation links vertically and pushing the hero down. The shadow menu depended on an asynchronously loaded stylesheet. Its structural styles are now present in the shadow template before that stylesheet arrives. A browser regression deliberately delays the stylesheet while changing Left, Center and Right positions. The previous template fails that test; the updated template passes.

Overflow menus also reject stale initialization after an editor replacement, remove their reflow listeners on disconnect, and recover when a stylesheet request fails. Editor documents no longer opt into storefront page-navigation transitions or hold the hero's first paint for those transitions.

All unrestricted `@theme` child declarations have been replaced with explicit supported types. Existing non-static children in saved pages and presets remain allowed. Static product galleries, account-service screens and generated search results are not offered as arbitrary content blocks. The source whitelist is tested; Storelib's generated picker still needs live confirmation after import.

The old `color_palette` declaration is now a hidden, read-only compatibility paragraph rather than the special widget that generates Color 1 / Color 2. Its ID and saved palette object are preserved. Background, Text, Borders and Field text remain the editable site-color controls. Do not hand-edit the generated `settings_panel.json`.

## Coverage

All 182 declared global setting IDs have source-consumer coverage, including dynamic font and legacy color families. This establishes a rendering connection, not exhaustive behavioral coverage of every possible combination.

| Area | Local checks and ownership |
| --- | --- |
| Brand/logo and header | Delayed image loading, normal/alternate logos, sticky/hover swaps, repeated wide/narrow uploads, delayed menu CSS and position changes; desktop/mobile and text directions. |
| Site colors | Shared/custom colors, readable contrast, nested inheritance, border and field colors; compatibility data retained. |
| Fonts, layout and spacing | Heading 1–6 controls and weights, font-face loading, responsive text, all page-width presets, centered content, zero spacing and spacing scales. |
| Buttons, form fields, icons | Global appearance/font variables, focus outline and hover speed, minimum button height and form typography; source consumers checked. |
| Product cards, badges and product pages | Shared/local card appearance, image ratio/fit, secondary-image crossfade, reduced motion, quick-add flags and price contexts. Product-page layout/media controls remain in the Product information section and its blocks. Badge appearance consumes shared variables. |
| Prices, cart, drawers, popups/dialogs | Independent currency contexts and zero prices; cart formatting compatibility; appearance variables and scoped surface colors. Real checkout, discounts and payment operations are not emulated. |
| Swatches, product options and search | Source-consumer checks for sizing, borders, colors and search styling; search product cards share global card appearance. Generated search results do not accept arbitrary blocks. |
| Customer accounts | Header links, login/signup/account presentation, disabled/signed-in states, mobile layouts and built-in account-route handoff. Real authentication remains a Storelib service. |
| Motion and cookie banner | Crossfade/reduced motion and editor transition suppression; banner appearance tested against the theme's supported banner DOM. Actual regional consent and hosted banner behavior require Storelib verification. |

## Platform boundaries

- `storelib_button_hover_effect` is saved by Storelib but is not declared by this theme. The platform-injected Hover & focus panel cannot be reorganized or fully tested from this checkout.
- Parent-editor refresh scheduling, the generated library/sidebar, account authentication, consent and commerce services require a live Storelib check. The theme does not invent editor message protocols or replace these services.
- GitHub's commit-status endpoint has returned HTTP 403 in this environment. A successful Git push is not proof that Storelib accepted every changed file. Check the Storelib import result before publishing.

Run `npm test` and `npm run test:browser` from `tooling/`. No storefront was published by this work.

## Follow-up: live product-card settings

Shared card appearance values were embedded as literals in every card's inline style. They now live once in the global stylesheet; grid and search cards reference those variables. Shared price blocks explicitly fill the card width, so the title, regular/sale price pair and supporting price text follow the same alignment. Custom card styles remain independent.

The browser regression changes only that stylesheet after rendering the cards. Radius, padding, gap, price size and title/price alignment update on the existing nodes while preserving scroll position on both the document and desktop page-wrapper scroller. It tests the theme's response to a style update, not delivery of updates from Storelib's sidebar.

The requested end-to-end live preview is **not resolved by this theme patch**. This checkout has no sidebar-settings event transport, preview reload scheduling or five-second reload call. The parent editor must deliver updated global styles and re-render server-formatted currency markup without replacing the preview document. Currency context tests verify which money filter is selected; they do not emulate Storelib's editor, money formatter or save pipeline. The Storelib editor/app repository or documented integration contract is needed to finish that work. No undocumented message protocol, repeated polling or navigation interception was added.

## Follow-up: scroll position across editor reloads

When a setting change reloads the preview, the page went back to the top. On desktop the page scrolls inside `.page-wrapper`, which browsers never restore, and the theme's own `history.state` restore is lost when the editor resets the frame's address. In design mode only, `theme-editor.js` now keeps the position per page in sessionStorage and puts it back as late content grows the page. It stops as soon as the creator scrolls, clicks or types. The browser regression covers a plain reload and an address reset at 375 and 1440 pixels, fails on the previous script and passes on this one.

This does not stop the reload or shorten the delay before it. Those are the builder's.
