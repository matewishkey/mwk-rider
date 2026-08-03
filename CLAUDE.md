# Wish busterZ Rider (`rider`) — dev notes for this repo

This repo is **rider**: a single on-demand slash command (`/rider`) that checks an Astro site against baseline best practices. It is *not* a framework — it installs nothing into the sites it audits and never touches their `CLAUDE.md`. You run it when you want a compliance check; it prints findings and suggests fixes.


## What it is

- **One skill:** `skills/rider/SKILL.md` — orchestrates a run: load the project's details, run the tool, walk the findings. `install.sh` links that one file as both the skill and the `/rider` command, so the two cannot drift.
- **One tool:** `tools/audit.mjs` — the entry. Detects an Astro project, runs the offline domain checks, and (with `--url`) the live ones. Reports `✅ / 🔧 / 🛑 / 💡 / ⏭` and exits non-zero on findings.
- **Seven offline domains + three `--url` domains**, one module each under `tools/checks/`:
  - `modules` — baseline stack present + wired (version, integrations, `output: 'static'`, strict TS, adapter-iff-`<Image>`); search is optional, two engines at once is a finding.
  - `seo` — canonical SEO component (canonical URL, OG meta), no `keywords`, sitemap lastmod, one `<h1>` per content page (skipped levels = advisory).
  - `images` — content images routed through an image transform + not oversized (`src/assets/` and `dist/`); on built `dist/` HTML, flags Cloudflare transform params (`format=auto` not explicit; explicit `quality=`) + content `<img>` missing `alt`.
  - `perf` — `/_astro/*` immutable in `public/_headers`; `<img>` carry width/height (CLS).
  - `data` — JSON-LD (BlogPosting + WebSite), `/llms.txt` from the content store, RSS, a search-index endpoint iff a search library is installed, Zod-validated content schema. Endpoints match by pattern (single + per-locale).
  - `analytics` — `provider` reports what delivers analytics (Cloudflare Web Analytics by default — free, cookieless, no banner; Zaraz when you need a tag manager) and is **advisory by construction**: no 🔧/🛑 branch, in either mode. The finding is a hardcoded GA/GTM snippet in `src/`+`dist/`, which fires pre-consent. Both deliveries are edge-injectable, so `--url` is authoritative — see `live.mjs`. Patterns live in `tools/lib/analytics-signals.mjs`.
  - `content` — the pages a site is repeatedly asked for: a media kit and a design/styleguide page. Both house style, so `💡` unless `--strict`.
  - `live` (only with `--url`) — real headers, served bytes (browser-realistic `Accept`) + transform-param flags, rendered HTML — `tools/checks/live.mjs`.
  - `lighthouse` (only with `--url`) — measured PSI scores + Core Web Vitals — `tools/checks/lighthouse.mjs`. Needs a free PSI key in `$PAGESPEED_API_KEY`. Skips gracefully without one.
  - `browser` (only with `--url`) — what only a real browser sees: uncaught JS exceptions, failed sub-requests, measured CLS, images oversized for their rendered box — `tools/checks/browser.mjs`. Needs `playwright` installed in the audited project; skips without it.
- **Shared:** `tools/lib/project.mjs` (detect + load), `tools/lib/reporter.mjs` (outcomes + exit code; `💡 suggest` is advisory and never fails the run), `tools/lib/policy.mjs` (universal vs house style), `tools/lib/rules.mjs` (the `--rules` catalogue). PSI is the only place the tool talks to an external API, and the only operator secret it reads.

## Working rules

- **Assumes a baseline.** The checks encode the baseline Astro stack (Astro 7+, the integrations, Cloudflare delivery / image transforms, immutable hashed-asset caching). The tool validates compliance against it — it does not set anything up or migrate. The version floor is a deliberate, dated decision — see `BEST-PRACTICES.md` § modules before moving it, and re-verify against npm rather than assuming.
- **Command-driven, never passive.** No contract `@import`, no auto-loading, nothing written into audited projects. If you find yourself wanting an always-on hook or a contract, stop — that's the thing this repo was deliberately stripped of.
- **Surface, don't auto-fix.** Findings are suggestions. Only edit a project when the user asks.
- **Practice ⇒ check (the `BEST-PRACTICES.md` contract).** `BEST-PRACTICES.md` is the *why* behind every check and a living practice↔check registry. Every best practice there has an enforcing check in `tools/checks/*`; a practice with no check is a tracked *gap*, not a practice yet. Adding one = understand the integration (context7) → write the why in `BEST-PRACTICES.md` → bake the check → verify on the fixture (stays `0 🔧`) + a real site → ship. Keep `BEST-PRACTICES.md` § Gaps current.
- **Verify Astro/Cloudflare specifics via `context7`** before writing about them or generating config/code (hard rule).
- **Test against the fixture.** `examples/_fixture-i18n/` is a full compliant multi-locale Astro site — run `node tools/audit.mjs` inside it; it should pass clean. Testing/deploy discipline lives in `docs/DEVELOPING.md`.

## Install

`./install.sh` symlinks `skills/rider/SKILL.md` → `~/.claude/skills/rider/SKILL.md` and `~/.claude/commands/rider.md`, and the tools → `~/.claude/rider-tools`. Idempotent. Re-run after `git pull`.

