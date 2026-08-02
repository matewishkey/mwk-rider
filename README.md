# Wish BusterZ Rider

<sub>`wishbusterz-rider`</sub>

An on-demand best-practices auditor for **Astro** sites. One slash command (`/wishbusterz-rider`), one zero-dependency script, eight domains (six offline + two live). No framework, no contract, nothing installed into the sites it audits — it reports, you decide.

```
✅ modules: astro:version — ^7.1.6
🔧 seo: meta:canonical — no <link rel="canonical"> in the SEO component
     fix: emit <link rel="canonical" href={canonicalURL}> from src/components/SEO.astro
💡 seo: headings:order — 1/4 content page(s) skip a heading level

38 ✅   1 🔧   0 🛑   1 💡   0 ⏭
audit complete — 1 finding to address (exit 1).
```

## Quickstart

No install, no dependencies, no API key. From the root of any Astro project:

```bash
git clone --depth 1 https://github.com/mergodon/wishbusterz-rider.git /tmp/rider
npm run build          # optional, but the image + perf checks read dist/
node /tmp/rider/tools/audit.mjs
```

That's the whole thing. You get findings like:

```
🔧 perf: cls:img-dimensions (src/pages/index.astro:140) — <img src="/shot.png"> lacks width/height → layout shift (CLS)
     fix: use <Image> from astro:assets (bakes width/height), or add explicit width + height
🔧 data: jsonld:emitted — no <script type="application/ld+json"> in the SEO component
     fix: emit JSON-LD structured data from the SEO component
🔧 data: content:schema — content collection has no Zod schema
     fix: define a Zod schema in src/content.config.ts

16 ✅   5 🔧   0 🛑   12 💡   0 ⏭
12 of the 💡 are [baseline] — this project's house style (Cloudflare, Orama, llms.txt …),
not universal practice. Re-run with --strict to treat them as required.
audit complete — 5 findings to address (exit 1).
```

*(That's a real run against an off-baseline Astro 5 site — not a mock-up.)*

**Want measured PageSpeed scores too?** One free API key ([2 minutes, no billing](https://developers.google.com/speed/docs/insights/v5/get-started)) against a publicly reachable URL:

```bash
export PAGESPEED_API_KEY=…
node /tmp/rider/tools/audit.mjs -s lighthouse --url https://your-site.com
```

See [`.env.example`](.env.example) for every optional key, and [`.github/workflows/audit.yml`](.github/workflows/audit.yml) for a copy-paste CI job.

## Required vs suggested

This tool ships an **opinionated baseline** — Cloudflare delivery, Orama search, Zaraz analytics, RSS + `llms.txt` endpoints, a particular file layout. Those are defensible choices, but your site isn't *broken* for making different ones.

So by default only **universal practice** is required (`🔧`): missing canonical/OG meta, images without dimensions, no structured data, oversized assets, unschema'd content collections, Astro 7 config that will break your build. Everything that's just house style reports as `💡 … [baseline]` and doesn't fail the run.

```bash
node audit.mjs             # universal practice only — 5 🔧, 12 💡 on a typical site
node audit.mjs --strict    # require the full baseline too — 17 🔧
```

Use `--strict` when you've adopted the baseline deliberately and want it enforced. What counts as which — and why — is one readable table in [`tools/lib/policy.mjs`](tools/lib/policy.mjs); disagree with a call and it's a one-line edit.

## What it checks

| Domain | What it looks for |
|---|---|
| **modules** | Baseline stack present + wired: Astro 7+, Node ≥ 22.12, the expected integrations, `output: 'static'`, strict TS (≤ 6.x, the `@astrojs/check` peer ceiling), `@astrojs/cloudflare` iff `<Image>` is used under SSR; search is Orama (flags competing search libs). Plus Astro 7 migration residue — stabilized `experimental` flags, unified()-only markdown options without `@astrojs/markdown-remark`, `@astrojs/db`, removed `astro:transitions` internals. |
| **seo** | A canonical SEO component emitting canonical URL + OG meta; no `keywords` anti-pattern; sitemap lastmod; one `<h1>` per content page (no skipped heading levels — advisory). |
| **images** | Content images routed through an image transform (resized/reformatted, not full-size) and not oversized in `src/assets/` or the built `dist/`. On built HTML, flags Cloudflare transform params (`format=auto` instead of an explicit format; explicit `quality=`) and content `<img>` missing `alt`. |
| **perf** | `/_astro/*` marked immutable in `public/_headers`; content `<img>` carry width/height (no layout shift). |
| **data** | The machine-readable surface other tools consume: JSON-LD (BlogPosting + WebSite), `/llms.txt` built from the content store, RSS, an Orama search-index endpoint, a Zod-validated content schema. Endpoints match by pattern, so single- and per-locale naming both pass. |
| **analytics** | No hardcoded Google Analytics / GTM snippet in `src/` or `dist/` — the baseline delivers analytics via Cloudflare Zaraz, which loads GA at the edge behind its consent banner (CMP). The Zaraz loader (`/cdn-cgi/zaraz/`) is edge-injected, so the positive "Zaraz present" check runs under `--url`. |
| **live** | With `--url`: real Cache-Control headers, served image bytes (measured with a browser-realistic `Accept`) + transform-param flags, rendered SEO + JSON-LD, `/llms.txt` — against a running or deployed site. |
| **lighthouse** | With `--url`: real **measured** scores via the PageSpeed Insights API — Performance/SEO/Accessibility/Best-Practices + Core Web Vitals (LCP/TBT/CLS). Needs a free PSI key (below); skips gracefully without one. |

The static domains answer *"is it wired right?"*; `lighthouse` answers *"what's the real score?"* — complementary layers.

**This tool assumes a specific baseline** (Astro 7+, static output, Cloudflare delivery, Orama search) and validates compliance against it. It does not set anything up or migrate. If your stack differs, the checks are small and readable — fork and adjust.

**The *why* behind every check lives in [`BEST-PRACTICES.md`](BEST-PRACTICES.md)** — a living practice↔check registry. The governing rule: every practice there has an enforcing check, and a practice with no check is a tracked *gap*, not a practice.

## Install

```bash
git clone https://github.com/mergodon/wishbusterz-rider.git
cd wishbusterz-rider && ./install.sh
```

This symlinks the `/wishbusterz-rider` command and its tools into `~/.claude/`. It installs nothing into any project and never touches a project's `CLAUDE.md`. Re-run `./install.sh` after `git pull` to update.

Requires **Node 22+**. No `npm install` — the tool uses Node built-ins only.

## Use

From inside any Astro project, in [Claude Code](https://claude.com/claude-code):

```
/wishbusterz-rider                 # offline: source + dist checks
/wishbusterz-rider https://site    # also check the live/served site
```

Or call the script directly — it's a plain CLI, Claude Code is optional:

```bash
node ~/.claude/wishbusterz-rider-tools/audit.mjs --help
node ~/.claude/wishbusterz-rider-tools/audit.mjs                     # everything offline
node ~/.claude/wishbusterz-rider-tools/audit.mjs -s seo -s images    # scope to domains
node ~/.claude/wishbusterz-rider-tools/audit.mjs --url https://site  # add live + lighthouse
node ~/.claude/wishbusterz-rider-tools/audit.mjs --json              # machine-readable
```

`--url` works from **any directory** — the offline domains need an Astro project in the cwd, but a live/lighthouse run only needs the URL.

Outcomes: `✅` pass · `🔧` fixable (required) · `🛑` needs a decision · `💡` optional suggestion · `⏭` skipped. Exit `0` if clean (suggestions don't count), `1` if any required findings, `2` on tooling error — so it drops into CI as-is.

## Optional API keys

Both live-API domains skip gracefully when their key is absent; everything else still runs.

**PageSpeed Insights** (`lighthouse`) — set `$PAGESPEED_API_KEY` to a [free PSI key](https://developers.google.com/speed/docs/insights/v5/get-started). Note that a single Lighthouse run is **noisy** (lab scores swing run-to-run) and the API needs a **publicly reachable** URL.

The tool only ever *reads* through this API. It never provisions, never writes.

## Layout

```
commands/wishbusterz-rider.md       the slash command (orchestration)
tools/
  audit.mjs                  entry: detect project, run domains, report
  test.mjs                   the gate: fixture + known-bad synthetic projects
  checks/{modules,seo,images,perf,data,analytics,live,lighthouse}.mjs
  lib/{project,reporter,policy,cf-image,html,image-size,src-scan}.mjs
examples/_fixture-i18n/      a compliant multi-locale Astro site — the test target
examples/ci/audit.yml        copy-paste GitHub Actions job for your own site
BEST-PRACTICES.md            the why behind every check + the practice/check registry
docs/DEVELOPING.md           testing discipline and design decisions
.env.example                 the optional API keys
install.sh                   symlink command + tools into ~/.claude
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The short version: `node tools/test.mjs` is the gate, a new check needs both test halves (stays quiet on the compliant fixture **and** fires on a known-bad project), and it must be classified in [`tools/lib/policy.mjs`](tools/lib/policy.mjs) or it will start failing strangers' builds.

Security issues: please use [private reporting](SECURITY.md), not a public issue.

## Safety

The tool is meant to be pointed at projects you don't control, so it **never executes the audited project's code** — config is read as text and parsed, never `import()`ed. It never writes to the project, and makes no network requests unless you pass `--url`. Details in [`SECURITY.md`](SECURITY.md).

## Licence

[MIT](LICENSE) — © 2026 Mergodon Limited. **Wish BusterZ** is a brand of Mergodon Limited. Use it, fork it, sell it; just keep the notice.

The auditor itself has **zero dependencies**, so nothing third-party is redistributed here. The example fixture installs its own dependencies from npm under their respective licences (predominantly MIT, with Apache-2.0, ISC, MPL-2.0 and LGPL-3.0 transitives) — those are fetched at install time, not vendored into this repo.

Not affiliated with or endorsed by Google, Cloudflare, or the Astro project. Product names are used only to identify what is being checked.
