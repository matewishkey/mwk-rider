# wishbusterz-rider — dev notes for this repo

This repo is **wishbusterz-rider**: a single on-demand slash command (`/td-rider`) that checks an Astro site against baseline best practices. It is *not* a framework — it installs nothing into the sites it audits and never touches their `CLAUDE.md`. You run it when you want a compliance check; it prints findings and suggests fixes.

> Note: td-rider used to be a content-ops *framework* (an always-on contract + skills + migrate commands). It was repurposed into this compliance tool on 2026-05-28 — same name, new purpose.

## What it is

- **One command:** `commands/td-rider.md` — orchestrates a run: load the project's details, run the tool, walk the findings.
- **One tool:** `tools/audit.mjs` — the entry. Detects an Astro project, runs the offline domain checks, and (with `--url`) the live ones. Reports `✅ / 🔧 / 🛑 / ⏭` and exits non-zero on findings.
- **Six offline domains + three `--url` domains**, one module each under `tools/checks/`:
  - `modules` — baseline stack present + wired (version, integrations, `output: 'static'`, strict TS, adapter-iff-`<Image>`); search is Orama (flags competing search libs).
  - `seo` — canonical SEO component (canonical URL, OG meta), no `keywords`, sitemap lastmod, one `<h1>` per content page (skipped levels = advisory).
  - `images` — content images routed through an image transform + not oversized (`src/assets/` and `dist/`); on built `dist/` HTML, flags Cloudflare transform params (`format=auto` not explicit; explicit `quality=`) + content `<img>` missing `alt`.
  - `perf` — `/_astro/*` immutable in `public/_headers`; `<img>` carry width/height (CLS).
  - `data` — JSON-LD (BlogPosting + WebSite), `/llms.txt` from the content store, RSS, Orama search-index endpoint, Zod-validated content schema. Endpoints match by pattern (single + per-locale).
  - `analytics` — flags a hardcoded Google Analytics / GTM snippet in `src/`+`dist/` (`gtag.js`/`gtm.js`/`analytics.js`/`gtag(`/`GTM-…`/`UA-…`); the baseline delivers analytics via Cloudflare Zaraz behind its consent CMP). The `/cdn-cgi/zaraz/` loader is edge-injected, so the positive check is live-only — see `live.mjs`.
  - `live` (only with `--url`) — real headers, served bytes (browser-realistic `Accept`) + transform-param flags, rendered HTML — `tools/checks/live.mjs`.
  - `lighthouse` (only with `--url`) — measured PSI scores + Core Web Vitals — `tools/checks/lighthouse.mjs`. Needs a free PSI key: `$PAGESPEED_API_KEY`, or a sops-encrypted env file via `$TD_RIDER_PSI_SOPS_FILE`. Skips gracefully without one.
  - `google` (only with `--url`) — the operator-provisioned Google state no source file shows: Search Console verified-property + sitemap, a GA4 property/web-stream for the domain, and that measurement ID wired into Zaraz — `tools/checks/google.mjs` (+ `tools/lib/google-auth.mjs`, which mints a service-account token zero-dep via built-in `crypto`). Needs a Google service-account key (`$GOOGLE_SERVICE_ACCOUNT_JSON` / `$GOOGLE_APPLICATION_CREDENTIALS` / `$TD_RIDER_SA_SOPS_FILE`); the Zaraz leg reuses `$CLOUDFLARE_API_TOKEN`. Each leg skips independently; verifies, never provisions.
- **Shared:** `tools/lib/project.mjs` (detect + load), `tools/lib/reporter.mjs` (outcomes + exit code; `💡 suggest` is advisory and never fails the run), `tools/lib/google-auth.mjs` (service-account → access token). PSI + Google SA are the only places the tool talks to an external API + an operator secret.

## Working rules

- **Assumes a baseline.** The checks encode the baseline Astro stack (Astro 7+, the integrations, Cloudflare delivery / image transforms, immutable hashed-asset caching). The tool validates compliance against it — it does not set anything up or migrate. The version floor is a deliberate, dated decision — see `BEST-PRACTICES.md` § modules before moving it, and re-verify against npm rather than assuming.
- **Command-driven, never passive.** No contract `@import`, no auto-loading, nothing written into audited projects. If you find yourself wanting an always-on hook or a contract, stop — that's the thing this repo was deliberately stripped of.
- **Surface, don't auto-fix.** Findings are suggestions. Only edit a project when the user asks.
- **Practice ⇒ check (the `BEST-PRACTICES.md` contract).** `BEST-PRACTICES.md` is the *why* behind every check and a living practice↔check registry. Every best practice there has an enforcing check in `tools/checks/*`; a practice with no check is a tracked *gap*, not a practice yet. Adding one = understand the integration (context7) → write the why in `BEST-PRACTICES.md` → bake the check → verify on the fixture (stays `0 🔧`) + a real site → ship. Keep `BEST-PRACTICES.md` § Gaps current.
- **Verify Astro/Cloudflare specifics via `context7`** before writing about them or generating config/code (hard rule).
- **Test against the fixture.** `examples/_fixture-i18n/` is a full compliant multi-locale Astro site — run `node tools/audit.mjs` inside it; it should pass clean. Testing/deploy discipline lives in `docs/DEVELOPING.md`.

## Install

`./install.sh` symlinks the command → `~/.claude/commands/td-rider.md` and the tools → `~/.claude/td-rider-tools`. Idempotent; prunes the old td-rider symlinks. Re-run after `git pull`.

