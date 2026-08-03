# Best practices

This is the *why* behind every check the audit runs. The governing rule:

> **Every best practice here has an enforcing check.** If we believe something,
> the tool proves it on every run. A practice with no check is a *gap* (tracked
> at the bottom) — not a best practice yet.

So this doc and `tools/checks/*` move together: you don't add a practice without
baking a test, and you don't add a test without writing down why. Real sites being audited are the source of new practices — each problem worth
preventing everywhere becomes a permanent check.

**Baseline assumed.** The baseline Astro stack: Astro 7+, `output: 'static'`,
Cloudflare delivery (Image Transformations for R2 content, immutable hashed
assets), Orama client-side search. The tool validates compliance against this —
it never sets anything up or migrates.

**Severities.** 🔧 fix = required, fails the run · 🛑 = needs a human decision ·
💡 = advisory suggestion, never fails · ⏭ = not testable in this mode.

**Universal vs house style.** Not every practice here binds every Astro site.
A check is **universal** when ignoring it means a real defect — a broken build, a
measurable performance or accessibility problem, or missing SEO fundamentals
every crawler and social preview depends on. It's **house style** when a
reasonable site could make a different call and still be well built: which search
library, which host's cache-header file, whether there's an RSS or `llms.txt`
endpoint at all.

By default only universal checks are required; house-style ones report as
`💡 … [baseline]` and don't fail the run. `--strict` requires everything, which
is the right mode once you've adopted the baseline deliberately. The
classification is one table in `tools/lib/policy.mjs` — **when you add a
practice, classify it there too**, or it silently defaults to universal and
starts failing strangers' builds.

## How we add a practice

When an audited site hits a problem worth preventing everywhere:

1. **Understand the requirement.** Read the underlying integration/service docs
   via `context7` (Astro, Cloudflare, the relevant plugin) — encode the real
   contract, not a guess. This is a hard rule for Astro/Cloudflare specifics.
2. **Write the practice here** — what it is and *why* (the failure it prevents).
3. **Bake the check** into `tools/checks/<domain>.mjs`. Reuse `tools/lib/`
   helpers; keep detection precise so it doesn't false-positive on a legitimate
   variant (e.g. per-locale naming, a factored predicate helper).
3b. **Classify it** in `tools/lib/policy.mjs` — universal practice, or this
   project's house style? Unclassified means universal, which means it fails the
   build of every stranger who doesn't share the opinion. Ask: could a
   well-built Astro site reasonably do this differently?
4. **Verify.** `node tools/audit.mjs` in `examples/_fixture-i18n/` must stay
   `0 🔧` (in both default and `--strict`), and run it against at least one real site (drift there is expected and
   informational — it's how we confirm the check fires on the wild case).
5. **Ship it.** The check is now permanent.

Detection should accept *correct variants*, not just one spelling. The two
worst things a check can do are miss a real violation and flag a compliant site;
both erode trust in the tool, so a new practice isn't done until it's been run
against a known-good site and a known-bad one.

---

## modules — the baseline stack is present and wired

*Check file: `tools/checks/modules.mjs`. Source: `package.json`, `astro.config.*`,
`tsconfig.json`.*

- **Astro 7+.** Baseline features (content layer, `astro:assets`, current config
  shape) assume a modern Astro, and v7 is where the stack now sits: the Rust
  compiler, the Sätteri markdown pipeline, and Vite 8. Staying on 6.x means
  running a superseded compiler and markdown pipeline, and the v7-only config
  surface below can't be relied on. → `modules: astro:version`
  *(Baseline moved 6.3 → 7 on 2026-08-01; Astro 7.0 shipped 2026, latest 7.1.6.
  Migration guide: `docs.astro.build/en/guides/upgrade-to/v7`.)*
- **Node ≥ 22.12.0.** Astro 7's own `engines.node` floor — a lower declared
  floor lets a build land on a runtime Astro won't start on. →
  `modules: engines.node`
- **TypeScript ≤ 6.x while `@astrojs/check` is installed.** TS 7 is published as
  npm `latest`, but `@astrojs/check` peers on `typescript ^5 || ^6` — installing
  TS 7 breaks `astro check`, which is the type gate the baseline relies on. Pin
  `^6` until the peer range widens. → `modules: typescript:version`
- **Baseline integrations installed:** `@astrojs/mdx`, `@astrojs/sitemap`,
  `@astrojs/rss`, `@astrojs/check`, `@orama/orama`. Each backs a downstream
  practice (RSS feed, sitemap, type-checking, search). → `modules: dep:<name>`

  `astro-robots-txt` was on this list and no longer is. The practice is that the
  build *ships* a robots.txt pointing at the sitemap — a generated endpoint does
  that at least as well as the package, and collides with it if you have both.
  Requiring the package tested our habit, not the outcome. → `seo: robots`
- **Search is Orama, nothing else.** One client-side search engine fed by a
  content-driven index keeps bundle size and behavior predictable; a competing
  lib (Algolia, Pagefind, Fuse, Lunr, …) means two answers to the same question.
  The check judges what's *present*: Orama → pass, a competitor → fix, no search
  library at all → `⏭`. It used to pass on the mere absence of a competitor, so a
  site with no search was reported as "Orama ✅" — a pass for something that
  wasn't there. → `modules: search:engine` (pairs with `data: search:index`)
- **A fully static build.** `output` defaults to `'static'` (Astro configuration
  reference, verified 2026-08-02), so *omitting* it is correct and only an
  explicit `output: 'server'` is a departure. The check used to flag any config
  that didn't spell it out — a required finding for writing less config than
  necessary. → `modules: output:static`
- **Cloudflare adapter only for SSR `<Image>`.** On `output: 'static'` (the
  baseline), `astro:assets`' `<Image>` is optimized at *build time* by Sharp and
  emitted to `dist/` — no adapter exists or is needed. The Cloudflare image
  service only matters under `output: 'server'`, where pages render on-demand and
  Sharp can't run on Workers. So the check passes on any static build (with or
  without `<Image>`) and only flags an SSR site that uses `<Image>` without the
  adapter. → `modules: adapter:cloudflare`
- **Strict TypeScript.** `extends: astro/tsconfigs/strict` catches whole classes
  of content/schema bugs at build. → `modules: tsconfig:strict`
- **`<ClientRouter />` in the root layout.** View transitions / SPA-style nav. →
  `modules: ClientRouter`
- **Webfonts through Astro's own fonts API, not a font CDN.** `fonts:` in
  `astro.config` plus `<Font />` from `astro:assets` self-hosts the files,
  generates fallback metrics so the swap doesn't shift layout, and emits the
  preload link. A `fonts.googleapis.com` stylesheet costs an extra DNS+TLS
  round-trip on the critical path, ships no fallback metrics, and discloses every
  visitor's IP to the font host. Advisory by default — which fonts you use, and
  how, is a defensible choice. → `modules: fonts`
- **Custom `src/pages/404.astro`.** A branded 404, not the host default. →
  `modules: 404:custom`
- **Media domain in `image.remotePatterns`.** R2-hosted content (`media.<domain>`)
  must be allowlisted or transforms/`<Image>` on it fail. (Only checkable when
  `scripts/og.config.mjs` declares the media domain.) → `modules: remotePatterns`

### Astro 7 migration residue

Config and imports that were valid on Astro 6 and are *wrong* on 7 — the kind of
thing a version bump leaves behind. Each maps to a documented v7 breaking change.

- **No stabilized flags left under `experimental:`.** v7 promoted `logger`,
  `cache`, `routeRules`, `queuedRendering`, `rustCompiler` and `advancedRouting`
  out of experimental. Left in the `experimental` block they are unknown config
  keys, not harmless no-ops — `logger`/`cache`/`routeRules` move to the top
  level, the other three are simply the default now. →
  `modules: astro7:experimental`
- **Unified()-only markdown options are backed by `@astrojs/markdown-remark`.**
  v7 renders Markdown with Sätteri and no longer installs that package. The
  deprecated `markdown.remarkPlugins` / `rehypePlugins` / `remarkRehype` options
  still work, but *only* with it installed and `markdown.processor: unified()`
  set; otherwise the plugins silently never run. Sites with no remark/rehype
  plugins need nothing — Sätteri applies GFM and SmartyPants like before. →
  `modules: astro7:markdown`
- **No `@astrojs/db`.** The package was removed in v7 and is unmaintained. Use
  `node:sqlite`, Drizzle, or a hosted DB. → `modules: astro7:db`
- **No removed `astro:transitions` internals.** `TRANSITION_*` constants,
  `isTransitionBeforePreparationEvent()`, `isTransitionBeforeSwapEvent()` and
  `createAnimationScope()` are gone; use the lifecycle event names directly
  (`'astro:before-preparation'`, `'astro:after-swap'`, …). An import of a removed
  export is a build failure, so this catches it before deploy. →
  `modules: astro7:transitions`

## seo — the discoverability surface

*Check file: `tools/checks/seo.mjs`. Source: `src/components/SEO.astro`,
`scripts/og.config.mjs`, `astro.config.*`. (Structured data lives under `data`.)*

- **One SEO component emits canonical + OG.** Every page gets a
  consistent head surface from a single component, not ad-hoc per-page tags:
  `canonical`, `og:image`, `og:image:width`/`height`, `og:type`, `og:url`.
  (Twitter/X falls back to the OG tags, so a dedicated `twitter:card` isn't
  required.) → `seo: meta:<tag>` (offline, scans the component source) +
  `seo: og:<tag>` (live, the rendered `<head>`)
- **The og:image is a real card, not just a 200.** A resolvable image URL
  (status + `image/*` content-type) is necessary but not sufficient: a generator
  that screenshots an *error* page uploads a perfectly valid PNG. That's the
  an incident on a real site incident — a site on `trailingSlash:'always'` had its generator
  request the no-trailing-slash `/preview/og/<slug>` → 404 → it screenshotted
  and shipped Astro's 404 page as the post's OG card, and status+content-type
  alone never caught it. The live check fetches the served bytes and verifies the
  intrinsic dimensions: at least the OG minimum (600×315, below which platforms
  crop or reject), and matching the declared `og:image:width`/`height`. →
  `seo: og:image:card` (live; 💡 `og:image:dimensions` when served ≠ declared).
  *Boundary:* the same-viewport case (a 404 shot at the real 1200×630 viewport)
  is indistinguishable from headers/bytes — the fix for that is a `resp.ok()`
  guard in the **generator** (assert a 200 before screenshotting), which lives in
  the audited site, not here. rider documents the practice; the site
  implements the guard.
- **The head meta is on every published page, not merely somewhere.** Coverage
  is measured over the pages the **sitemap** declares — the site's own answer to
  "what am I publishing". Every other denominator is wrong: "every file in
  `dist/`" counts OG-image templates and preview routes that correctly carry no
  canonical, and "pages that have a canonical" (which is what `isContentPage`
  means) makes the canonical check measure itself — delete the canonical from 18
  of 19 pages and the set shrinks to 1, which reports 1/1 ✅. A dogfood agent
  reproduced exactly that. All → pass, none → fix, some → 💡 naming the pages.
  → `seo: meta:*`
- **`og:image:width`/`height` are advice, not a requirement.** A card renders
  without them; they only let a platform reserve space before fetching it. Two
  independently-built, well-made dogfood sites had these two as their *only*
  required finding — which is the signal that the severity was wrong rather than
  the sites. → `seo: meta:og:image:width`, `seo: meta:og:image:height` (💡)
- **Each page's canonical is its own URL.** Presence is not enough: a site where
  twenty pages all declared the same canonical passed, and that markup asks
  crawlers to drop nineteen of them as duplicates — strictly worse than having no
  canonical at all. Only a value covering *more than half* the pages is reported,
  and only as advice, because deliberate duplicates are legitimate: the bundled
  i18n fixture shares a canonical between a locale fallback rewrite and the page
  it mirrors, which is correct. → `seo: canonical:unique`
- **No `<meta name="keywords">`.** Ignored by search engines and a weak spam
  signal — its presence is the anti-pattern. → `seo: no-keywords`
- **Brand fields set:** `siteName`, `siteUrl`, `tagline` feed the SEO meta. →
  `seo: brand.<field>` (and 💡 `brand:optional` for author/twitter handles)
- **`robots.txt` served, pointing at the sitemap.** The built site must carry a
  `robots.txt` with a `Sitemap:` line — that line is how a crawler that starts at
  the root finds the full URL list. Read from `dist/robots.txt`, so any way of
  producing it counts: an endpoint, a `public/` file, or an integration.
  → `seo: robots` (`⏭` with no `dist/`)
- **Sitemap carries lastmod.** Read from the built `sitemap*.xml`: how many
  `<url>` entries carry a `<lastmod>`. `@astrojs/sitemap` emits none unless a
  `serialize()` supplies one (verified against the integration docs), so the
  integration being configured proves nothing — the old check inferred it from
  `astro.config` and passed two dogfood sites whose sitemaps had zero `lastmod`.
  Advisory: a crawler tolerates its absence, it just can't tell what changed.
  → `seo: sitemap:lastmod` (`⏭` with no `dist/`)
- **Exactly one `<h1>` per content page.** The `<h1>` is the page title; zero
  means no main heading, more than one dilutes the document outline for search
  engines and screen readers. Checked on built `dist/` HTML (pages with a
  canonical link — so OG-template / preview routes are excluded) and live on
  home + a content page. → `seo: headings:h1` (required)
- **Don't skip heading levels.** A sequential outline (h2→h3→h4, never h2→h4)
  is a WCAG 1.3.1 expectation. Advisory, not required — a skip is most often a
  shared header/footer using a deeper level, not a content bug, so it shouldn't
  fail an otherwise-clean run. → 💡 `seo: headings:order`

## images — content images delivered well

*Check files: `tools/checks/images.mjs` (offline: source + built `dist/`) and
`tools/checks/live.mjs` (served HTML). Shared param logic: `tools/lib/cf-image.mjs`.*

- **Content images go through an image transform.** Either Astro build-time
  optimization for local assets (`/_astro/…`) or Cloudflare Image
  Transformations for R2 content (`/cdn-cgi/image/…`) — never a raw full-size
  `<img>` to the media domain. → `images: routed`, `images: background-image`
- **No oversized rasters at the source or in the build.** A >500 KB PNG/JPG in
  `src/assets/`, or a >300 KB content image in `dist/`, means something never got
  resized. → `images: assets:size`, `images: dist:size`
- **Transforms use `format=auto`, not an explicit format.** `format=auto` lets
  Cloudflare negotiate AVIF/webp per the browser's `Accept`; an explicit
  `format=webp` (the default Astro emits for bare markdown `![]()`) means no AVIF
  *and* a raw-source fallback for clients that don't accept that format (via
  `onerror=redirect`). → `images: transform:format` (offline + live)
- **Transforms set an explicit `quality=`.** Cloudflare defaults to 85; an
  explicit cap (e.g. `quality=80`) is usually a large win on photographic
  content. Advisory. → 💡 `images: transform:quality`
- **Measure served bytes the way a browser sees them.** The live byte check
  sends a real `Accept: image/avif,image/webp,…` so a `format=auto` transform
  negotiates the format an actual visitor downloads — not the raw source a
  headerless probe would trigger. → `images: bytes` (live)
- **Content images carry alt text.** Every content `<img>` needs an `alt`
  attribute (WCAG 1.1.1). `alt=""` is allowed — it signals a decorative image —
  but a *missing* attribute is the violation. `<Image>` from astro:assets
  enforces this at build; raw `<img>` and bare markdown can slip through.
  Checked on built `dist/` HTML and live. → `images: alt` (required)

## perf — page-speed levers

*Check file: `tools/checks/perf.mjs` (offline) and cache checks in
`tools/checks/live.mjs` (served).*

  Every `<img>` tag counts, on every page. The check used to de-duplicate by
  `src` across the whole build, so the *first* occurrence of an image decided the
  verdict for all of them: the same photo used with alt on the homepage and
  without alt on a post was reported as fine. Four of five independent dogfood
  builds found that — a silent false negative with exit 0, which is the worst
  outcome this tool has. Each offending page is now its own finding, named.
- **Hashed assets are immutable.** `public/_headers` marks `/_astro/*`
  `public, max-age=31536000, immutable` so repeat visits don't re-validate every
  JS/CSS/font. (A plain `astro dev` server doesn't apply `_headers` — the live
  check needs `wrangler dev` of `dist/` or the deployed site.) →
  `perf: _headers:/_astro/*`, live `perf: cache:_astro`
- **HTML revalidates.** HTML routes must *not* be immutable, or deploys won't
  show until the cache expires. → live `perf: cache:html`
- **Content `<img>` carry width + height.** Explicit dimensions (or `<Image>`,
  which bakes them) prevent layout shift (CLS). → `perf: cls:img-dimensions`

- **Render-blocking CSS stays small.** Measured on the *heaviest single page*:
  the bytes of every `<link rel="stylesheet">` it pulls plus its inlined
  `<style>` blocks. Per page, not per `dist/` — Astro emits a stylesheet per
  route, so a 484-page site legitimately has dozens of `.css` files while any one
  page links two, and totalling the directory would punish a site for having
  pages. `💡` over 100 KB, `🔧` over 250 KB. Four real Astro builds measured
  8–25 KB on their heaviest page, so the soft budget has four times the headroom
  a well-built site needs and the hard one only catches an unpurged framework.
  → `perf: css:bytes`
- **Few render-blocking stylesheets.** Each one is a separate round-trip before
  first paint. `💡` over 3 on a single page (the measured sites sit at 1–2).
  House style. → `perf: css:files`
- **Fonts stay light.** Total `.woff2`/`.woff`/`.ttf`/`.otf` bytes in `dist/`:
  `💡` over 200 KB, `🔧` over 500 KB (measured sites: 42 KB and 107 KB). Two
  families is enough for a content site — one for headings, one for body — and a
  variable font covers a whole weight range in one file.
  → `perf: font:bytes`, `perf: font:families` (`💡` over 2),
  `perf: font:faces` (`💡` over 4)

  **Counting `@font-face` needs two corrections**, both found by measuring real
  builds rather than reasoning about them. Blocks are deduped *by content*: Astro
  inlines the same block into every page's `<style>`, so a naive count returned
  2904 for one 484-page site. And Astro's Fonts API emits a second face per
  family carrying fallback metrics, whose `font-family` contains `fallback:` —
  counting those as real families reported both correctly-configured two-font
  sites as having four, which is exactly the false positive that gets a tool
  uninstalled.
- **woff2, not ttf/otf.** Universally supported for years and roughly half the
  bytes. Serving a raw font format to browsers is a defect on anyone's site, so
  this one is universal. → `perf: font:format`

## content — pages a site is repeatedly asked for

*Check file: `tools/checks/content.mjs`. Reads built `dist/` HTML, so any routing
convention counts — detection is on what the page renders, not its filename.*

Both practices here are **house style**. A personal Astro blog is not broken for
lacking either, and a tool that says otherwise gets uninstalled. They report
`💡 [baseline]` by default and bind under `--strict`.

- **A media kit.** A small business or project site is regularly asked for "your
  logo and a short description". Without one canonical page that becomes an email
  thread and inconsistent assets in the wild — the wrong logo, a stale
  description, someone's screenshot. It is the one URL you hand to press,
  partners, sponsors and directories. A route matching `/media-kit`, `/press` or
  `/presskit` must carry three things to be worth linking: a downloadable logo
  asset, a paste-ready paragraph of boilerplate, and a contact route or `mailto:`.
  → `content: mediakit` (`⏭` with no `dist/`)
- **A design reference page.** This is the one that pays off for the agent
  audience. A `/design` (or `/styleguide`, `/design-kit`, `/tokens`) route that
  renders the site's *actual* tokens and components — colours, type scale,
  spacing, buttons, cards, form controls — lets an agent or a new contributor see
  what exists and where it is used without reading every component file. It also
  makes drift visible: rendered from the real tokens, a divergent hardcoded
  colour shows up next to the swatch it should have matched.

  The check asks only that the route exists and renders more than a heading —
  design tokens referenced, colour swatches, or several component sections.
  Detection is deliberately loose, because the risk here is false-positiving on a
  legitimate variant. The strongest version of this page generates itself *from*
  the token source so it cannot drift, but that is site-side work: the auditor
  checks the page is there and is not a stub, and does not try to generate it.
  → `content: designkit` (`⏭` with no `dist/`)

## data — the machine-readable surface

*Check file: `tools/checks/data.mjs`. Source: `src/components/SEO.astro`,
`src/lib/jsonld.*`, `src/pages/**`, `src/content.config.ts`. Endpoints are matched
by **pattern**, so single-locale and per-locale naming both pass.*

- **Every collection is schema-validated**, not just one of them. The check was
  a whole-file `/z\.object\(/` on the raw text of `content.config.ts`: two
  collections where only one had a schema passed, and so did a file whose only
  mention of Zod was in a *comment* — the exact failure mode this repo had
  already fixed for meta tags and then repeated here. All five dogfood builds
  found it. Now: comments blanked, each `defineCollection` body checked for a
  `schema:`, and the unschema'd ones named. → `data: content:schema`
- **JSON-LD emitted, covering both core shapes.** The built pages carry
  `application/ld+json` with an Article-family type per post and a site-wide
  `WebSite`. Read from `dist/` and **parsed**, not grepped: the old check required
  a file at `src/lib/jsonld.ts` containing the literal string `BlogPosting`, so
  five independently built sites that all emit rich, valid JSON-LD were all told
  they had none — they named the module differently, inlined it, or chose
  `Article`. Any of `Article`, `BlogPosting`, `NewsArticle`, `TechArticle`,
  `ScholarlyArticle`, `LiveBlogPosting`, `Report`, `CreativeWork` counts; all earn
  the same rich results. `@graph` and top-level arrays are unwrapped.
  → `data: jsonld:emitted`, `data: jsonld:shapes` (`⏭` with no `dist/`)
  Coverage uses the sitemap denominator too. "More than zero" was the old bar:
  one page out of nineteen reported ✅ and exit 0, printing a ratio with no
  threshold to read it against.
- **The JSON-LD parses.** A block that isn't valid JSON is discarded whole by
  search engines while looking perfectly fine in the source — worse than emitting
  none. → `data: jsonld:parses`
- **`/llms.txt`, content-driven.** Some `llms*.txt` endpoint is built from
  `getCollection()` (a multi-locale root may be a thin index pointing at
  per-locale variants — pass if *any* endpoint is content-driven). →
  `data: llms.txt`
- **Published-only filter on the content index.** Drafts and preview-only
  entries must be excluded — accepted as inline `!draft && !previewOnly` *or* a
  factored `isPublished()`-style helper. → `data: llms.txt:filter`
- **RSS feed with items in it.** Judged on the built `rss*/feed*/atom*.xml`:
  does it contain `<item>`s? The endpoint file is only how the feed got there, so
  requiring `getCollection()` *inside* it penalised the better pattern of
  factoring the collection query into a shared helper. Without a `dist/` the
  endpoint's existence is reported, and the message says its output is unverified.
  → `data: rss`
- **An Orama search-index endpoint.** A `search-index*.json` endpoint built from
  `getCollection()` is the source the client-side Orama search loads. →
  `data: search:index` (pairs with `modules: search:engine`)

**Shared invariant:** one publish predicate — `!draft && !previewOnly` — across
llms, RSS, and search-index, so all three discovery surfaces agree on what's
public.

## analytics — measured privately, behind consent

*Check files: `tools/checks/analytics.mjs` (offline: source + built `dist/`) and
the `analytics` checks in `tools/checks/live.mjs` (served HTML, `--url`).*

- **Analytics ships through Cloudflare Zaraz, not a hardcoded snippet.** Zaraz is
  the tag manager: it loads Google Analytics (and Cloudflare's own analytics) at
  the edge and gates every tag behind its Consent Management Platform — the
  cookie banner — so nothing fires before the visitor agrees. A Google
  Analytics / GTM snippet pasted into the source fires immediately, outside
  consent, and bypasses Zaraz. The offline check flags that snippet
  (`gtag.js`/`gtm.js`/`analytics.js`/`gtag(`/`GTM-…`/`UA-…`) in `src/` or `dist/`.
  → `analytics: no-hardcoded-ga`
- **Zaraz loader present on the served page.** Because Zaraz injects at the edge,
  the loader (`/cdn-cgi/zaraz/i.js`) only shows up at serve time. With `--url`,
  its presence confirms analytics is Zaraz-managed. The flag is a GA tag loaded
  *third-party* from `googletagmanager.com`/`google-analytics.com` (instead of, or
  alongside, the loader) — that fires outside the consent gate. A bare `gtag()`
  *call* is **not** flagged live: Zaraz injects the bootstrap into the rendered
  HTML, so keying on the call (as the offline scan does for *source*) would
  false-flag every compliant served page. → `analytics: zaraz`, `analytics: ga:raw`
- **The live probe must look like a browser to see Zaraz.** Zaraz has a "Block
  bot initiated requests" setting (bot-score based: block none / automated /
  automated + likely) and Bot Fight Mode does the same — a headerless `fetch` is
  bot-scored as automated, so the edge *correctly* suppresses the loader injection
  for it. A curl-shaped probe therefore never sees Zaraz on a protected site, even
  when it's configured right. So the live GET carries a full browser navigation
  signature (`NAV_HEADERS` in `live.mjs`: Chrome UA, `Sec-Fetch-*`, `Sec-Ch-Ua`,
  `Accept: text/html…`) to get the fully-injected page a real visitor receives.
  Without this the check skips with a false negative. → drives `analytics: zaraz`
- **The cookie banner is Zaraz's CMP — no custom banner in the site.** Zaraz ships
  a built-in Consent Management Platform: enable it in the dashboard, assign each
  tool a *purpose*, and Zaraz auto-renders the consent modal, gates every tag until
  the visitor agrees, localises by `Accept-Language`, and is styleable via custom
  CSS. So a baseline site should **not** hand-roll a cookie banner — that duplicates
  what the CMP already does and risks tags firing outside consent. The Consent API
  (`zaraz.consent.*`, the `cf_consent` cookie, the `zarazConsentAPIReady` event) is
  the escape hatch *only* for advanced needs — region-scoped modals (e.g. EU-only)
  or integrating a third-party CMP. (No enforcing check: a custom banner isn't
  reliably detectable in static HTML, and the CMP render itself is the consent Gap
  below — runtime, needs a browser.)
> **Not enforced: Google Tag Gateway.** Cloudflare's Google Tag Gateway (serving
> the Google tag first-party from a reserved path instead of `googletagmanager.com`)
> earns its keep when ad-spend measurement / ad-blocker signal recovery is the
> point — paid acquisition, conversion optimisation. For a content/info
> sites that signal isn't acted on, so the gateway is overkill: a per-zone moving
> part to maintain for no payoff. The baseline is Zaraz loading GTM/GA behind
> consent; first-party serving is a deliberate non-goal, not a gap. (Considered +
> dropped 2026-05-30.)

> **Manual setup (operator step, not in the repo).** Zaraz itself and the Google
> tag (GA4) it loads — the property ID, the consent CMP / cookie-banner config,
> auto-inject, and the bot-request policy — are all configured in the Cloudflare
> dashboard, per zone. None of it lives in the audited site's source, so the audit
> can only *verify it is present and firing* at serve time (`--url`); it can never
> provision it. Treat it like the PSI key: an operator manual setup the tool
> checks, not one it owns.

*Why Zaraz over the old `cloudflareinsights` beacon / Partytown+GA escape-hatch:
Zaraz unifies GA + Cloudflare analytics under one edge loader and one consent
gate, which is what "promote Zaraz + GA + cookie banner" asks for. The CF Web
Analytics beacon stays valid (and can itself run via Zaraz); see the Cloudflare Zaraz docs.*

## live (`--url`) — what only exists at serve time

*Check file: `tools/checks/live.mjs`. Hits a running/deployed URL.* Re-verifies
the source-level practices against reality: reachability, the real `Cache-Control`
headers, served image bytes (with a browser `Accept`) and transform params, the
rendered SEO surface + JSON-LD on home and a content page, and `/llms.txt`
(served, has an H1, grouped/indexed). Page fetches carry a full browser
navigation signature so edge logic gated on bot score — notably the Zaraz loader
injection — behaves as it does for a real visitor (see `analytics`). Point `--url`
at `wrangler dev` of `dist/` or the deployed site — a plain `astro dev` won't have
the cache headers.

- **The content page is discovered, not assumed to be under `/blog/`.** Order:
  the sitemap (the site's own declaration of its URLs) → same-origin `<a>` links
  on the homepage → `/llms.txt`. Index routes, pagination, tag/category listings
  and non-page extensions are excluded, and the deepest remaining path wins — a
  leaf article over a section landing page. The old check matched `/blog/` only,
  so five sites using `/projects/` and `/wiki/` had ~10 live checks silently not
  run, and two runs printed "audit clean — exit 0" having checked almost nothing.
- **A skip names what it skipped.** When no content page can be found, the `⏭`
  lists the rule ids that did not run. Silence must never be indistinguishable
  from a pass. → `seo: post`

## lighthouse (`--url`) — the measured score

*Check file: `tools/checks/lighthouse.mjs`. Needs a PSI key.* Where the static
checks confirm "is it wired right?", this answers "what's the real score?" —
PageSpeed Insights Performance/SEO/Accessibility/Best-Practices + lab Core Web
Vitals (LCP/TBT/CLS), plus CrUX field data when the site has enough traffic.
Lab scores are noisy — treat one run as a sample, not a verdict.


## Gaps / candidate practices (not yet enforced)

The queue. Each becomes a real check when a reporter hits it or we decide it's
worth it — following *How we add a practice* above. Listed so we don't lose them.

- **`compressHTML: 'jsx'` whitespace regressions (Astro 7).** v7 changed the
  default from `true` to `'jsx'`, so whitespace between inline elements is
  stripped by JSX rules — `<span>hello</span><em>world</em>` now renders
  "helloworld". Real but invisible to static analysis: telling a deliberate
  `{" "}` from a swallowed space needs rendered-output diffing against a v6
  build. Caught by eye or by the live check, not by a config assertion.
- **`src/fetch.ts` reserved (Astro 7).** Advanced routing is on by default and
  reserves the filename; a pre-existing `src/fetch.ts` that means something else
  must be renamed or `fetchFile` configured. Not checked because a *legitimate*
  v7 advanced-routing handler has exactly the same shape — the check would flag
  compliant sites, which is the one thing a check must never do.
- **Rust compiler HTML strictness (Astro 7).** Unclosed non-void tags now error
  instead of being auto-corrected. Detecting it properly means parsing every
  `.astro` template, which the no-deps tool doesn't do — the build itself is the
  honest gate here.
- **hreflang alternates on multi-locale pages.** Paired-locale posts should emit
  `rel="alternate" hreflang=…` (+ `x-default`); single-locale posts should omit
  the block entirely. The fixture smoke test checks this; the audit doesn't yet.
- **Responsive `srcset`/`sizes`.** Large content images should ship responsive
  variants, not a single fixed width.
- **Offline heading scan beyond the canonical gate.** Today the offline outline
  check only inspects pages with a `<link rel="canonical">`; a page that should
  be indexable but lacks canonical is invisible to it (the live check still
  covers home + a post).
- **No-negotiation fallback probe (live).** A second `Accept: */*` image probe
  would surface a large raw-source fallback directly; today the offline
  `transform:format` check catches the same `format=webp` smell more cheaply.
- **BreadcrumbList JSON-LD.** The fixture emits it; not asserted by `data`.
- ~~**Runtime behaviour needs a headless browser.**~~ Closed by the `browser`
  domain: uncaught exceptions, failed/404 sub-requests, measured CLS, and images
  oversized relative to their rendered box are now checked with real Chromium
  (optional — `playwright` is not a dependency of this tool).
- **Zaraz consent banner actually renders + GA waits for consent.** The
  `analytics` live check confirms the Zaraz loader is present, but the consent
  modal and whether tags hold until consent are decided by client JS at runtime
  (`zarazConsentAPIReady`, the `cf_consent` cookie) — invisible to a `fetch` of
  the HTML. Truly verifying them needs a headless browser, which the no-deps tool
  doesn't run. Tracked here rather than faked from static HTML.
