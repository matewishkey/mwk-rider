# Wish busterZ Rider

<sub>`rider`</sub>

An on-demand best-practices auditor for **Astro** sites — and a compliant site to start from. One slash command (`/rider`), one zero-dependency script, ten domains (seven offline + three live). No framework, no contract, nothing installed into the sites it audits — it reports, you decide.

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
git clone --depth 1 https://github.com/wishbusterz/rider.git /tmp/rider
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
12 of the 💡 are [baseline] — this project's house style (Cloudflare delivery, llms.txt, RSS …),
not universal practice. Re-run with --strict to treat them as required.
audit complete — 5 findings to address (exit 1).
```

*(That's a real run against an off-baseline Astro 5 site — not a mock-up.)*

**Want measured PageSpeed scores too?** One free API key ([2 minutes, no billing](https://developers.google.com/speed/docs/insights/v5/get-started)) against a publicly reachable URL:

```bash
export PAGESPEED_API_KEY=…
node /tmp/rider/tools/audit.mjs -s lighthouse --url https://example.com
```

**Want to test the running site in a real browser?** Install Playwright in *your* project and the `browser` domain switches itself on:

```bash
npm i -D playwright && npx playwright install chromium
node /tmp/rider/tools/audit.mjs -s browser --url https://example.com
```

That catches what no static check can: scripts that throw, assets that 404 only when requested, real measured layout shift, and images served at 4× the size they're displayed.

See [`.env.example`](.env.example) for every optional key, and [`examples/ci/audit.yml`](examples/ci/audit.yml) for a copy-paste CI job.

## Required vs suggested

This tool ships an **opinionated baseline** — Cloudflare delivery, Cloudflare Web Analytics, RSS + `llms.txt` endpoints, a particular file layout. Those are defensible choices, but your site isn't *broken* for making different ones.

So by default only **universal practice** is required (`🔧`): missing canonical/OG meta, images without dimensions, no structured data, oversized assets, unschema'd content collections, Astro 7 config that will break your build. Everything that's just house style reports as `💡 … [baseline]` and doesn't fail the run.

```bash
node audit.mjs             # universal practice only — 5 🔧, 12 💡 on a typical site
node audit.mjs --strict    # require the full baseline too — 17 🔧
```

Use `--strict` when you've adopted the baseline deliberately and want it enforced. What counts as which — and why — is one readable table in [`tools/lib/policy.mjs`](tools/lib/policy.mjs); disagree with a call and it's a one-line edit.

A few checks report a *fact* rather than a verdict and are `[advisory]` in **both** modes — `--strict` doesn't promote them, because they have no failing branch at all. `analytics: provider` is the one that matters: it tells you what's delivering analytics, including when the answer is nothing, and never fails a run. Whether you measure your traffic is your call.

`node audit.mjs --rules --json` is the authoritative list of every rule and which of the three it is. Prefer it over any summary written down elsewhere, including this one.

## What it checks

| Domain | What it looks for |
|---|---|
| **modules** | Baseline stack present + wired: Astro 7+, Node ≥ 22.12, the expected integrations, `output: 'static'`, strict TS (≤ 6.x, the `@astrojs/check` peer ceiling), an adapter iff any route renders on demand (`output: 'server'` **or** a single `prerender = false` page) and an explicit `imageService` so the Cloudflare adapter can't opt you into paid image billing; search is optional, but two search engines at once is a finding. Plus Astro 7 migration residue — stabilized `experimental` flags, unified()-only markdown options without `@astrojs/markdown-remark`, `@astrojs/db`, removed `astro:transitions` internals, a `tsconfig` `exclude` that stopped covering `dist`, and `compressHTML` left unset (v7's new `'jsx'` default strips the whitespace between prose and an inline element — it builds clean and ships wrong text). |
| **seo** | A canonical SEO component emitting canonical URL + OG meta; no `keywords` anti-pattern; sitemap lastmod; one `<h1>` per content page (no skipped heading levels — advisory, and it names the component that emitted the heading rather than the built page whenever exactly one source matches). |
| **images** | Content images routed through an image transform (resized/reformatted, not full-size) and not oversized in `src/assets/` or the built `dist/` — a responsive image is judged as a **ladder** on its smallest rung, the one a phone actually downloads, not on the top rung Astro emits unconditionally. A CSS `background-image` pinned to a fixed width is its own finding, since it can use neither srcset nor lazy loading. On built HTML, flags Cloudflare transform params (`format=auto` instead of an explicit format; explicit `quality=`) and content `<img>` missing `alt`. |
| **perf** | `/_astro/*` marked immutable in `public/_headers`; content `<img>` carry width/height (no layout shift); render-blocking CSS on the heaviest page and total webfont weight stay in budget, in woff2. Heavy third-party embeds (Maps, YouTube, Vimeo…) sit behind a facade rather than loading with the page — `loading="lazy"` doesn't count, it won't defer a frame high on the page. Cross-origin image hosts carry a `preconnect` **with `crossorigin`** (without it the connection isn't reusable — it looks fixed and isn't), and a head `preload` matches its `<img>` byte for byte or the image downloads twice. Every declared font family leads a `font-family` stack and sets `styles`, since the API default `['normal','italic']` builds italic faces nothing may render. |
| **content** | The pages a site is repeatedly asked for: a media kit (logo, paste-ready boilerplate, a contact route) and a design/styleguide page rendering the real tokens. Both house style, so `💡` unless `--strict`. Plus a prose lint for a straight quote sharing a line with a directional one — the input Sätteri and remark resolve differently — advisory in **every** mode, because correct prose can do it too. |
| **data** | The machine-readable surface other tools consume: JSON-LD (BlogPosting + WebSite), `/llms.txt` built from the content store, RSS, a search-index endpoint if the site ships a search library, a Zod-validated content schema. Endpoints match by pattern, so single- and per-locale naming both pass. |
| **analytics** | What delivers analytics here — **advisory in every mode**, because whether you measure traffic is your call, not a defect. The baseline default is Cloudflare Web Analytics: free, cookieless, no consent banner. Zaraz is fully supported for when you need a tag manager, and its loader is edge-injected so `--url` is what confirms it. The one *finding* is a hardcoded GA/GTM snippet, which fires before consent. |
| **live** | With `--url`: real Cache-Control headers, served image bytes (measured with a browser-realistic `Accept`) + transform-param flags, rendered SEO + JSON-LD, `/llms.txt` — against a running or deployed site. |
| **browser** | With `--url`: what only a real browser sees — uncaught JS exceptions, requests that failed or 404'd, **measured** CLS, images downloaded far larger than they're displayed, heavy third-party origins. Needs `playwright` installed **in the site you're auditing**; skips cleanly without it. |
| **lighthouse** | With `--url`: real **measured** scores via the PageSpeed Insights API — Performance/SEO/Accessibility/Best-Practices + Core Web Vitals (LCP/TBT/CLS) — plus what makes a stuck score readable rather than dismissable as lab noise: the LCP element, the heaviest third-party payloads, and simulated vs *observed* FCP/LCP. Needs a free PSI key (below); skips gracefully without one. |

The static domains answer *"is it wired right?"*; `lighthouse` answers *"what's the real score?"* — complementary layers.

**This tool assumes a specific baseline** (Astro 7+, static output, Cloudflare delivery, Cloudflare Web Analytics) and validates compliance against it. It does not set anything up or migrate. If your stack differs, the checks are small and readable — fork and adjust.

**The *why* behind every check lives in [`BEST-PRACTICES.md`](BEST-PRACTICES.md)** — a living practice↔check registry. The governing rule: every practice there has an enforcing check, and a practice with no check is a tracked *gap*, not a practice.

## Install

```bash
git clone https://github.com/wishbusterz/rider.git
cd rider && ./install.sh
```

This symlinks the `/rider` command and its tools into `~/.claude/`. It installs nothing into any project and never touches a project's `CLAUDE.md`. Re-run `./install.sh` after `git pull` to update.

Requires **Node 22+**. No `npm install` — the tool uses Node built-ins only.

## Use

From inside any Astro project, in [Claude Code](https://claude.com/claude-code):

```
/rider                 # offline: source + dist checks
/rider https://example.com    # also check the live/served site
```

In an **empty** directory the same command scaffolds instead. It asks three
questions — site name and domain, contact email, a one-line tagline — then copies
[`examples/starter/`](examples/starter), edits those four values, builds, and runs
the audit on what it just made. That last step is the point: the starter is kept
at `0 🔧 / 0 🛑` under `--strict` by this repo's own CI, so a scaffolded site is
compliant by construction rather than by intention.

You get a working blog, a contact form that sends real email through Cloudflare
Email Service (free to a verified address, no API key to store), cookieless
analytics, a media kit, a design reference page, RSS, `/llms.txt` and a sitemap
with real `<lastmod>`. Two dashboard steps are left for you, and it says which.

Or call the script directly — it's a plain CLI, Claude Code is optional:

```bash
node ~/.claude/rider-tools/audit.mjs --help
node ~/.claude/rider-tools/audit.mjs                     # everything offline
node ~/.claude/rider-tools/audit.mjs -s seo -s images    # scope to domains
node ~/.claude/rider-tools/audit.mjs --url https://example.com  # add live + lighthouse
node ~/.claude/rider-tools/audit.mjs --json              # machine-readable
```

`--url` works from **any directory** — the offline domains need an Astro project in the cwd, but a live/lighthouse run only needs the URL.

Outcomes: `✅` pass · `🔧` fixable (required) · `🛑` needs a decision · `💡` optional suggestion · `⏭` skipped. Exit `0` if clean (suggestions don't count), `1` if any required findings, `2` on tooling error — so it drops into CI as-is.

## Optional: `scripts/og.config.mjs`

A few checks read brand details from an optional file at `scripts/og.config.mjs` in the audited project. **You don't need it** — without it, those checks simply don't run. If you have one, this is the shape the tool looks for:

```js
export const config = {
  brand: {
    siteName: 'Example',                 // required by seo: brand.siteName
    siteUrl:  'https://example.com',     // required by seo: brand.siteUrl
    tagline:  'What the site is about',  // required by seo: brand.tagline
    mediaDomain: 'media.example.com',    // enables modules: remotePatterns
    authorName: 'Example',               // optional, richer social cards
    authorUrl: 'https://example.com',
    twitterSite: '@example',
    twitterCreator: '@example',
  },
};
```

Creating this file **adds** required checks (`brand.siteName`, `brand.siteUrl`, `brand.tagline`), so add it only if you want them enforced. The file is read as text and never executed — see [`SECURITY.md`](SECURITY.md).

## Optional API keys

Both live-API domains skip gracefully when their key is absent; everything else still runs.

**PageSpeed Insights** (`lighthouse`) — set `$PAGESPEED_API_KEY` to a [free PSI key](https://developers.google.com/speed/docs/insights/v5/get-started). Note that a single Lighthouse run is **noisy** (lab scores swing run-to-run) and the API needs a **publicly reachable** URL.

The tool only ever *reads* through this API. It never provisions, never writes.

## Layout

```
skills/rider/
  SKILL.md                   how an agent picks a mode, then runs and reports an
                             audit (install.sh links it as BOTH the skill and the
                             /rider command — one file, no drift)
  references/CREATE.md       the steps for create mode, kept out of SKILL.md so
                             the file an agent always loads stays short
tools/
  audit.mjs                  entry: detect project, run domains, report
  test.mjs                   the gate: fixture + known-bad synthetic projects
  checks/{modules,seo,images,perf,data,analytics,content,live,lighthouse,browser}.mjs
  lib/{project,reporter,policy,rules,cf-image,html,dist,jsonld,image-size,
       src-scan,untrusted,analytics-signals,search-engines}.mjs
examples/starter/            the reference site: single-locale, compliant under
                             --strict, and what `/rider` copies to create a site
examples/_fixture-i18n/      a compliant multi-locale Astro site — the harder
                             test target (i18n, search, preview routes)
examples/ci/audit.yml        copy-paste GitHub Actions job for your own site
BEST-PRACTICES.md            the why behind every check + the practice/check registry
docs/DEVELOPING.md           testing discipline and design decisions
.env.example                 the optional API keys
install.sh                   symlink the skill, the command, the tools and the
                             starter into ~/.claude
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The short version: `node tools/test.mjs` is the gate, a new check needs both test halves (stays quiet on the compliant example sites **and** fires on a known-bad project), it must be classified in [`tools/lib/policy.mjs`](tools/lib/policy.mjs) or it will start failing strangers' builds, and anything that moves the baseline updates **both** `examples/` sites in the same commit.

Security issues: please use [private reporting](SECURITY.md), not a public issue.

## Safety

The tool is meant to be pointed at projects you don't control, so it **never executes the audited project's code** — config is read as text and parsed, never `import()`ed. It never writes to the project, and makes no network requests unless you pass `--url`. Details in [`SECURITY.md`](SECURITY.md).

## Licence

[MIT](LICENSE) — © 2026 Mergodon Limited. **Wish busterZ** is a brand of Mergodon Limited. Use it, fork it, sell it; just keep the notice.

The auditor itself has **zero dependencies**, so nothing third-party is redistributed here. The example fixture installs its own dependencies from npm under their respective licences (predominantly MIT, with Apache-2.0, ISC, MPL-2.0 and LGPL-3.0 transitives) — those are fetched at install time, not vendored into this repo.

Not affiliated with or endorsed by Google, Cloudflare, or the Astro project. Product names are used only to identify what is being checked.
