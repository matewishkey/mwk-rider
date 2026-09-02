# This site — how it is built, and how to keep it that way

This file ships with the site. It is here so that anyone picking the project up
— you, a collaborator, an agent — makes the same choices the site was built on,
instead of a new set every time.

## New here? Start with these three files

1. **`scripts/og.config.mjs`** — the site's name, URL, tagline, contact address
   and analytics token. Editing this one file rebrands the whole site. Nothing
   else needs touching to make it yours.
2. **`src/layouts/RootLayout.astro`** — the shell every page renders inside:
   `<head>`, header, footer, the analytics beacon. If something appears on every
   page, it is here.
3. **`src/data/blog/hello-world.md`** — a post. Adding another markdown file
   next to it is the entire publishing workflow.

After that: `src/pages/` is one file per route, and `src/styles/global.css` is
the whole design system (rendered live at `/design`).

## The rules this site is built on

**Prefer boring and readable over clever.** Someone will read this in a year with
no context, and that someone may be you. A plain `<form method="POST">` that
works with JavaScript disabled beats a clever fetch-and-render. Every file here
should be understandable on its own.

**Prefer Cloudflare.** Not out of loyalty — because using one platform for
hosting, mail, analytics and abuse protection means one account, one bill, one
set of docs, and no integrations to keep alive:

| Need | Use | Why |
|---|---|---|
| Hosting | Cloudflare Workers + Static Assets | The build output is files; the one dynamic route rides along |
| Contact form | Email Service (`send_email` binding) | Free to a verified address, and no API key to store |
| Analytics | Web Analytics | Free, cookieless — so no consent banner to build |
| Spam | Turnstile | When the honeypot stops being enough |
| Large media | R2 | If images outgrow the repo |

Reach outside this list when there is a real reason, and write the reason down.

**Static by default.** Every route is prerendered except
`src/pages/api/contact.ts`. That single `prerender = false` is the only reason
an adapter is installed. Before adding a second one, check whether the thing
genuinely has to run per-request — most things don't.

**Say what is true.** Don't add a tracking script "for later", don't put a fake
token in a config, don't claim the site is deployed before it is. An unset
`cloudflareAnalyticsToken` is honest; a made-up one looks configured and
measures nothing.

**No dependency without a reason you could defend.** Every package is a thing
that can break, need updating, or change hands. The site ships with seven, and
each one earns it.

## Operator steps — the things nobody can do from the code

Two dashboard tasks, once each. Until they are done the site works and the
contact form fails closed.

1. **Cloudflare Web Analytics.** Dashboard → Web Analytics → add this site, copy
   the site token into `scripts/og.config.mjs`. Free, cookieless, no banner.
   Note that Cloudflare's *automatic* injection only rewrites proxied static
   responses — this site is served by a Worker, so the `<script>` in
   `RootLayout.astro` is how the beacon gets there. Auto-install will silently do
   nothing while still showing the site as set up.
2. **Cloudflare Email Service.** Onboard the sending domain, then verify the
   destination address in `wrangler.jsonc` → `send_email[0].destination_address`.
   Sending to a verified destination is free on any plan.

## Working on it

```bash
npm run dev       # local dev server
npm run build     # build to dist/
npm run preview   # wrangler dev — the real Worker, with _headers applied
npm run check     # astro check (types)
npm run deploy    # build + wrangler deploy
```

`astro dev` and `astro preview` do **not** apply `public/_headers`, so cache
behaviour there tells you nothing. Judge it on `npm run preview` or the deployed
site.

## Before you ship a change

Run the auditor — `/mwk-rider:audit` in Claude Code, or from a checkout of the
tool:

```bash
git clone --depth 1 https://github.com/matewishkey/mwk-rider.git /tmp/mwk-rider
node /tmp/mwk-rider/tools/audit.mjs --strict
```

It should stay at `0 🔧 / 0 🛑`. The one standing `💡` is the analytics beacon
reporting that its token is unset — expected until step 1 above is done.

What each rule is and why lives in the tool, not here:
`node /tmp/mwk-rider/tools/audit.mjs --rules --json`.
