---
description: Audit an Astro site against baseline best practices — modules, SEO, page-speed/images, and machine-readable data (JSON-LD, llms.txt, RSS, Orama search index). Run on demand from inside any Astro project. Optional argument is a live URL to also check the served site.
---

You are running an on-demand best-practices audit of the Astro project in the current directory. This is a compliance check, not a migration — surface findings and suggest fixes; **never auto-edit** the project unless the user asks.

The argument (if any) is a base URL to also audit live (e.g. `https://example.com` or `http://localhost:4321`).

## Step 1 — Load the details

Read enough to understand the site, then tell the user in one short paragraph what it is:

```bash
node ~/.claude/wishbusterz-rider-tools/audit.mjs --help   # confirm the tool is installed
```

Look at `astro.config.*`, `package.json`, and `src/content.config.ts` to summarize: Astro version, `output` mode, which integrations are installed, whether it's single- or multi-locale, and what content collections exist. Keep it to a few sentences — this orients the user before the findings.

## Step 2 — Run the audit

```bash
node ~/.claude/wishbusterz-rider-tools/audit.mjs
```

If the user passed a URL, add it:

```bash
node ~/.claude/wishbusterz-rider-tools/audit.mjs --url <the-url>
```

Scope to one domain when the user only cares about part of it: `-s seo`, `-s images`, `-s perf`, `-s modules`, `-s data`, `-s lighthouse`, `-s google` (repeatable). `--url` works from any directory — offline domains need an Astro project in cwd, but a live/lighthouse/google run only needs the URL.

The tool checks six offline domains, plus three that run with `--url`:

- **modules** — the baseline Astro stack is present and wired (version, integrations, `output: 'static'`, strict TS, adapter-iff-`<Image>`); search is Orama (no competing search lib).
- **seo** — a canonical SEO component emitting canonical URL + OG meta; no `keywords` anti-pattern; sitemap lastmod; exactly one `<h1>` per content page (skipped heading levels are an advisory 💡, since they're usually a shared header/footer level).
- **images** — content images routed through an image transform (resized/reformatted, not full-size), and not oversized in `src/assets/` or `dist/`. On built `dist/` HTML, also flags Cloudflare transform params (`format=auto` not an explicit single format; explicit `quality=`) and content `<img>` missing `alt`.
- **perf** — `/_astro/*` marked immutable in `public/_headers`; content `<img>` carry width/height (no CLS).
- **data** — machine-readable surface for other tools: JSON-LD (BlogPosting + WebSite), `/llms.txt` built from the content store, RSS, an Orama search-index endpoint, a Zod-validated content schema. Endpoints are matched by pattern, so single- and per-locale naming both pass.
- **analytics** — no hardcoded Google Analytics / GTM snippet in `src/` or `dist/` (`gtag.js`/`gtm.js`/`analytics.js`/`gtag(`/`GTM-…`/`UA-…`). The baseline delivers analytics through Cloudflare Zaraz, which loads GA at the edge behind its consent banner (CMP). The Zaraz loader is edge-injected, so the positive check (`/cdn-cgi/zaraz/` present) runs only under `--url` (see **live**).
- **live** (only with `--url`) — real Cache-Control headers, served image bytes (measured with a browser-realistic `Accept` so transforms negotiate AVIF/webp), rendered SEO + JSON-LD, `/llms.txt`, the Cloudflare Zaraz analytics loader (`/cdn-cgi/zaraz/`); also flags the transform-param anti-patterns on the rendered HTML. A plain `astro dev` server won't have cache headers — point `--url` at a `wrangler dev` of `dist/` or the deployed site for the cache check to be meaningful.
- **lighthouse** (only with `--url`) — measured PageSpeed Insights scores (Performance/SEO/Accessibility/Best-Practices) + Core Web Vitals. Needs a free PSI key (`$PAGESPEED_API_KEY`); `⏭ skips` without one. `--strategy desktop` switches from the default mobile. Note: a single run is noisy (lab scores swing) and PSI needs a publicly reachable URL — say so when you report a score rather than treating one number as final.

## Step 3 — Walk the findings

The tool prints one line per check: `✅` pass, `🔧` fixable (required), `🛑` needs a decision, `💡` optional suggestion, `⏭` skipped. Exit code is `0` when there are no `🔧`/`🛑` — `💡` suggestions don't count as failures.

For each `🔧`/`🛑`, present it to the user with the suggested fix and **let them decide**. List `💡` items separately as optional nice-to-haves — don't present them as things that must be fixed. Group by domain so it reads as a punch list. If everything required passes, say so plainly. Offer to apply specific fixes only if the user asks — and verify any Astro/Cloudflare specifics via `context7` before writing config or code.

The *why* behind each check (and the process for adding new ones) is in this repo's `BEST-PRACTICES.md` — cite it if the user asks why a finding matters, or when a new best practice should be baked into the tool.

`--json` is available if the user wants machine-readable output for their own tooling.
