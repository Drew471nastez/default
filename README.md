# Horizon

This repository is a Storelib website, imported from another store's theme. Storelib writes the whole theme here, and a push to `claude/theme-settings-realtime-preview-3dfgg9` comes back into the site as a draft within seconds. Nothing is live until the creator presses Publish.

Start with AGENTS.md if you are an AI agent (Claude Code and Codex read it on their own).

## What is where

| Path | What it is | Read back by Storelib |
| --- | --- | --- |
| config/settings.json | The theme's settings: colours, fonts, the values the theme editor shows. Under `shopify` are the imported theme's own settings. | Yes |
| templates/<page>.json | Each page's own sections, their settings and blocks, in order. `home.json` is the home page. | Yes |
| sections/header-group.json, footer-group.json | The header and footer, once, for every page. | Yes |
| sections/*.storelib | Each section's markup and schema, converted from the theme's own code. Edit the code between the `<template compat="shopify">` lines. Its settings, blocks and presets are the theme's own schema, under `shopify` in `<schema>`: change them there, and the builder's settings panel (the rest of `<schema>`) is made from it. | Yes |
| blocks/, snippets/, layout/ | The theme's blocks, snippets and page shell, the same way. | Yes |
| shopify/ | The theme's own files as they were imported: templates for account pages, config, locales, CSS, JavaScript and fonts. `shopify/config/settings_schema.json` is the theme settings; the builder's Theme settings are made from it. | Yes, pictures excepted |
| shopify/assets/<pictures> | The theme's pictures and videos, to look at. Upload a new one in Storelib's Files. | No |
| config/storelib_settings_schema.json | The settings Storelib adds to Theme settings (Hover and focus): ids, types, labels, options, defaults and the group each shows in. Their values are in `config/settings.json` under `shopify`. | No, the values are |
| README.md, AGENTS.md, CLAUDE.md, storelib.json | Written by Storelib each time it sends the theme. | No |

Anything else in this repository is yours, and Storelib leaves it alone.

## Changing a built-in section

Every section here is the theme's own. Change it in place.

## Settings Storelib adds

Theme settings in the builder show the theme's own groups and then Storelib's Hover and focus: buttons on hover (background, text, border, effect), links on hover, and fields (border, focus ring, corner radius). `config/storelib_settings_schema.json` lists each one with its id, type, label, options, default and group. Their values are in `config/settings.json` under `shopify`, each written out, defaults included; change a value there and push. If the theme's own `shopify/config/settings_schema.json` declares one of these ids, the builder draws it where the theme puts it instead.

## Live preview

In the builder, a change is drawn in the canvas without reloading the page. A script of the theme's hears it:

- `storelib:settings-change`: fired on `document`, detail `{ settings, live }`: the ids and new values of the settings that changed, on every value while a slider or colour is dragged (`live: true`) and once more on release. The canvas applies the change without reloading the page; a script that read a setting once can read it again here.
- `storelib:section-load`: fired on the section's own element and bubbles to `document`, detail `{ sectionId }`: the section was drawn again in place after a change. A script that sets a section up once (a slider, a menu, a drawer) sets it up again for that section here.

## Adding a section

Add `sections/<type>.storelib` (lower case, digits, `_` and `-`). To put it on a page, add it to that page's `templates/<page>.json` in the same push, or leave that to the creator in the builder. The format is at https://storelib.com/developers/sections, and the schema settings at https://storelib.com/developers/schema.

## When a push does not work

Each push gets a commit status named Storelib, and a comment on the commit lists every file that was not taken, with the line and what to fix. The other files in the same push are still taken. The builder shows the same list on GitHub in Website settings, Connections.
