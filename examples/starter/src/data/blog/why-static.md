---
title: Why this site is static
date: 2026-07-24
dateModified: 2026-07-28
tags: [meta, hosting]
excerpt: A content site has no good reason to run a server on every request, and several good reasons not to. What that buys you, and the one exception here.
---

Every page on this site is built once and served as a file. Nothing runs when
you visit it.

## What that buys

**It cannot go down in the interesting ways.** There is no process to crash, no
connection pool to exhaust, no memory leak to find at 2am. A file either exists
or it doesn't.

**It is fast without effort.** The bytes are already there, sitting on an edge
node near you. No cold start, no query, no template render.

**It costs approximately nothing.** Static assets are the cheapest thing any
host sells, and often free below a threshold you will not reach.

## The one exception

The contact form has to run somewhere. `src/pages/api/contact.ts` is the single
route that renders on demand — one endpoint, marked `prerender = false`, while
every page around it stays a file.

That is worth knowing, because it is the line that requires an adapter. Add a
second dynamic route and nothing changes; remove that one and you can drop the
adapter entirely.

## What you give up

Anything genuinely per-visitor: logged-in state, a shopping cart, personalised
content. If you need those, you need a server, and none of the above applies.
Most content sites don't.
