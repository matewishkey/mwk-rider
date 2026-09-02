---
title: Hello world
date: 2026-08-01
tags: [meta, writing]
excerpt: The first post on a new site, and a short tour of where everything lives so the second one takes five minutes instead of an afternoon.
---

This is a markdown file in `src/data/blog/`. Adding another one is the whole
publishing workflow — no database, no admin panel, no deploy button.

## What the frontmatter does

Every field above is validated against a schema in `src/content.config.ts`
before the site builds. Misspell `date` and the build stops with a clear error,
rather than shipping a page with an empty `<time>` in it.

The `excerpt` has a length bound on purpose: it is what a search result and a
social card show, and both truncate. Finding that out while writing beats
finding out after someone shares the link.

## Where the rest lives

- `src/pages/` — one file per route
- `src/layouts/RootLayout.astro` — the shell every page renders inside
- `src/components/SEO.astro` — everything that goes in `<head>`
- `src/styles/global.css` — the design tokens, rendered live at `/design`
- `scripts/og.config.mjs` — the one file to edit to make this site yours

## What to do next

Delete this post, write your own, and run the audit. It will tell you what is
missing before anyone else notices.
