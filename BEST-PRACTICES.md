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
assets), and Cloudflare Web Analytics for measurement. The tool validates
compliance against this — it never sets anything up or migrates.

Two things left the baseline on **2026-08-03**, because both had become a wall
between a new site and a working one:

- **Search is optional.** It used to be a required dependency (`@orama/orama`),
  so a site that had deliberately shipped no search collected a finding for it.
  What binds now is coherence, not presence — see *Search* under `modules`.
- **Analytics is Cloudflare Web Analytics by default, not Zaraz.** Web Analytics
  is free, cookieless and needs no consent banner, so a site can be measured the
  day it deploys. Zaraz remains fully supported and fully documented below; it is
  the right answer when you need a tag *manager*, and it is a dashboard project
  before it is anything else. Nothing about analytics fails a run in either mode.

**Own it before you buy it (2026-09-02).** The baseline favours Cloudflare's own
services and the platform's own primitives over a third-party library or SaaS,
and this tool never *offers* a third party unless the user asks for one by name.
The starter is the existence proof: the contact form is a typed endpoint on
Cloudflare Email Service, not a form vendor; fonts self-host through Astro's
font API, not a font CDN; measurement is Web Analytics, not a tag; social cards
are drawn at build time, not fetched from a card service. For the small business
this stack is built for, a typed form is easier to write than a product is to
buy, integrate and pay for, and it is enough. The checks still *recognise*
third-party engines and hosts — a validator has to know what a site uses — but
recognising is not recommending, and the distinction is the whole rule.

**Severities.** 🔧 fix = required, fails the run · 🛑 = needs a human decision ·
💡 = advisory suggestion, never fails · ⏭ = not testable in this mode.

**Modes.** Every rule in the catalogue also carries `mode`: `offline` (reads
source and `dist/`) or `url` (needs a served site). **53 of the 141 are `url`** —
the `live`, `lighthouse` and `browser` domains entirely, plus the served-HTML
twins of offline checks, which is why `meta:og:image` and `og:image` are two rule
ids for one practice measured in two places. That is deliberate, not
duplication: served HTML is not always the built HTML, and the analytics domain
depends on the difference. What was *not* deliberate is that until 2026-09-01 the
only thing recording it was the phrase "Live only:" in a `why` string — fine for
a human, useless to the agent the catalogue exists for. It is a field now,
derived from the section plus that convention, with `tools/test.mjs` enforcing
the convention rather than trusting it.

**A catalogue entry nothing emits is a lie in the catalogue.** `--rules` is this
tool's answer to "what do you check", so a row with no check behind it is worse
than a missing row. `images/optimized` was one for months: the check was renamed
to `images: routed` and the entry stayed, because the suite asserted *emitted ⊆
catalogued* and never the reverse. Both directions are asserted now, with a
planted dead rule used to prove the detector fires rather than passing vacuously.

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

There is a third, much smaller category: **advisory**. A handful of checks report
a *fact* rather than a verdict and have no `🔧`/`🛑` branch at all — `--strict`
does not promote them because there is nothing to promote. `analytics: provider`
is the one that matters. They are listed separately in `policy.mjs` so
`--rules` can label them `[advisory]` instead of `[universal]`, which would read
as "required by default".

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
4. **Verify.** `node ../../tools/audit.mjs` in **both** `examples/_fixture-i18n/` and
   `examples/starter/` must stay
   `0 🔧 / 0 🛑` (in both default and `--strict`), and run it against at least one real site (drift there is expected and
   informational — it's how we confirm the check fires on the wild case).
5. **Ship it.** The check is now permanent.

Detection should accept *correct variants*, not just one spelling. The two
worst things a check can do are miss a real violation and flag a compliant site;
both erode trust in the tool, so a new practice isn't done until it's been run
against a known-good site and a known-bad one.

**Every outcome names its evidence — passes included.** `✅ seo: no-keywords`
with nothing after it is indistinguishable from a check that ran over zero files
and reported success, which is this tool's worst failure mode wearing a tick.
Say what was looked at and how much of it (`not emitted by any of the 23 source
file(s) under src/`). `tools/test.mjs` asserts this as an invariant over the
whole fixture run, so a new check cannot quietly reintroduce a mute pass.

---

## modules — the baseline stack is present and wired

*Check file: `tools/checks/modules.mjs`. Source: `package.json`, `astro.config.*`,
`tsconfig.json`.*

- **Astro 7+.** Baseline features (content layer, `astro:assets`, current config
  shape) assume a modern Astro, and v7 is where the stack now sits: the Rust
  compiler, the Sätteri markdown pipeline, and Vite 8. Staying on 6.x means
  running a superseded compiler and markdown pipeline, and the v7-only config
  surface below can't be relied on. → `modules: astro:version`
  *(Baseline moved 6.3 → 7 on 2026-08-01; Astro 7.0 shipped 2026. Migration
  guide: `docs.astro.build/en/guides/upgrade-to/v7`.)*

  **The examples declare `^7.2.6`, not `^7`, since 2026-09-01** — not a new
  check (`astro:version` still only asks for major 7), but the floor
  `@astrojs/mdx@8` peers on. Astro 7.2.10 pins `@astrojs/markdown-satteri@0.4.0`,
  which is the other half of that peer, so the two move together or not at all.
  Deliberately *not* restated as a number anywhere else: `npm view astro version`
  is the current release and this sentence would be stale the week after it was
  written — as the line it replaced was.
- **Node ≥ 22.12.0.** Astro 7's own `engines.node` floor — a lower declared
  floor lets a build land on a runtime Astro won't start on. →
  `modules: engines.node`
- **TypeScript ≤ 6.x while `@astrojs/check` is installed.** TS 7 is published as
  npm `latest`, but `@astrojs/check` peers on `typescript ^5 || ^6` — installing
  TS 7 breaks `astro check`, which is the type gate the baseline relies on. Pin
  `^6` until the peer range widens. → `modules: typescript:version`
- **Baseline integrations installed:** `@astrojs/mdx`, `@astrojs/sitemap`,
  `@astrojs/rss`, `@astrojs/check`. Each backs a downstream practice (RSS feed,
  sitemap, type-checking). → `modules: dep:<name>`

  ⚠ **An installed integration is not a working one, and `@astrojs/mdx` was
  neither example's for as long as both existed.** Both content loaders globbed
  `'**/*.md'`, so an `.mdx` post produced no page and no error — the audit
  required the dependency of every site it ran on while its own two reference
  sites could not have used it. Fixed on 2026-09-01: the pattern is
  `'**/*.{md,mdx}'`, `generateId` strips either extension, and the fixture now
  carries one genuine `.mdx` post whose exported expression is evaluated at
  build time, so a regression stops the build rather than passing quietly.
  This is the same shape as the search checks — *presence* is cheap to assert
  and worth almost nothing next to *coherence*. → `modules: mdx:reachable`

  The check reads every `pattern:` in `content.config.ts` and asks one question:
  **can MDX be loaded anywhere?** Not "does every collection take it" — a site
  may quite reasonably let only one collection hold MDX, and a pattern *array*
  is one loader matching any of its globs. Conflating those two unions was the
  check's first bug, and it fired on a correct site: `['**/*.md', '**/*.mdx']`
  reported as excluding `.mdx` because its first element does.

  A pattern that is not a string literal — a variable, a spread, something built
  at runtime — is reported as **unread**, not guessed at. An unreadable pattern
  is a missed finding; a guessed one is a wrong finding on a site that is fine,
  and this file's whole bias is that the second costs more.

  `astro-robots-txt` was on this list and no longer is. The practice is that the
  build *ships* a robots.txt pointing at the sitemap — a generated endpoint does
  that at least as well as the package, and collides with it if you have both.
  Requiring the package tested our habit, not the outcome. → `seo: robots`

  `@orama/orama` left the list on 2026-08-03 for a different reason: it was
  requiring a *feature*, not an integration. See below.
- **Search is optional; two search engines is not.** A content site of a few
  dozen pages is served fine by the browser's own find-in-page, and shipping an
  index it never uses is bundle weight for nothing. So no search library at all
  is `⏭` — there is nothing to check. One is fine whichever it is: Orama is the
  baseline's, and gets `✅`; Pagefind, Fuse, Lunr, Algolia and the rest get a
  `💡` saying so and nothing more.

  What is a defect on anyone's site is *two* engines installed at once — two
  indexes to build, two bundles to ship, and two different answers to the same
  query. That is the only branch that still reports `🔧`.
  → `modules: search:engine` (pairs with `data: search:index`)

  ⚠ **One engine ships as several packages, and counting package names got this
  backwards.** `astro-pagefind` is the Astro integration that wraps `pagefind`,
  and installing both is the documented setup; `algoliasearch` + `@docsearch/js`
  are one product too. A flat list of names called each pair "2 search engines
  installed — two indexes to build" on a site building exactly one. So an engine
  is a *family* of package names in `tools/lib/search-engines.mjs`, and matching
  several of a family is still one engine. Measured on a correct Pagefind site
  and a correct Algolia one, both of which the flat list had two findings about.

  This is what "softening" has to mean if it is to be honest: the requirement
  moved from *presence* to *coherence*. Dropping the dependency without moving
  `data: search:index` to match would have removed the check entirely, so a site
  could ship a search box wired to nothing and hear about it from nobody.
- **A fully static build.** `output` defaults to `'static'` (Astro configuration
  reference, verified 2026-08-02), so *omitting* it is correct and only an
  explicit `output: 'server'` is a departure. The check used to flag any config
  that didn't spell it out — a required finding for writing less config than
  necessary. → `modules: output:static`
- **Rendering on demand means an adapter — any adapter.** A route that renders
  per-request needs one, and without it the build fails outright. The trap is
  that "renders on demand" is *not* the same as `output: 'server'`: a single
  `export const prerender = false` page in an otherwise static site is enough,
  and that is exactly the shape a contact form takes. The check tests for both,
  and names the route it found rather than just the output mode.

  It accepts **any** adapter — Cloudflare, Node, Vercel, Netlify, Deno, or a
  third-party one declared as `adapter:` in `astro.config`. The build fails
  identically on all of them, so naming ours would be house style wearing a
  universal badge. Classified universal for the same reason: a build that cannot
  run is a defect on anyone's site. → `modules: adapter:on-demand`
- **The Cloudflare adapter specifically, only for on-demand `<Image>`.** On a
  fully prerendered build, `astro:assets`' `<Image>` is optimized at *build time*
  by Sharp and emitted to `dist/` — no adapter exists or is needed. The Cloudflare
  image service only matters where pages render on demand *on Workers*, since
  Sharp can't run there.

  This check used to test `output: 'server'` alone, which was a false negative
  with real consequences: a static build with one `prerender = false` page using
  `<Image>` renders on Workers and was never flagged. Widened to the same
  on-demand definition as above. When there is no adapter at all it defers —
  `adapter:on-demand` already reports that, and one defect should produce one
  finding. → `modules: adapter:cloudflare`
- **Set `imageService` explicitly, or you may be buying something.** The
  Cloudflare adapter's `imageService` default changed from `'compile'` to
  `'cloudflare-binding'` (Astro's Cloudflare adapter docs, verified 2026-08-03).
  That service transforms images at runtime through the Cloudflare Images
  binding, which is *"automatically provisioned upon deployment"* — a paid
  product. So installing the adapter for something unrelated (a contact form,
  say) can silently move image transforms from free build-time Sharp onto a
  billed runtime service, with nothing in the build output saying so.

  A `💡` rather than a `🔧`: `'cloudflare-binding'` is a legitimate choice, and
  the only defect is making it by accident. Fires only when the adapter and
  `<Image>` are both present. → `modules: adapter:imageService`
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
- **`compressHTML` is set explicitly.** v7 changed the default from `true` to
  `'jsx'`, which strips whitespace by JSX rules — including the newline between
  prose and an inline element. Measured on astro@7.1.6:

  ```astro
  Tasman Visa operates the website
  <a href="…">tasmanvisa.com</a>. Your privacy is important to us.
  ```

  builds as `operates the websitetasmanvisa.com.` with the default, and keeps the
  space with `compressHTML: true`. It builds clean, typechecks clean, and is
  wrong only in the rendered text — tasmanvisa-web had it live on their privacy
  page. → `modules: compressHTML`

  The check accepts **either value**. What it refuses is the field being unset,
  because inheriting a changed default is not choosing one. The baseline itself
  takes `true`: a content site is exactly where prose meets inline elements
  constantly.
- **`tsconfig.json`'s own `exclude` still covers `dist`.** Astro's shipped
  tsconfigs exclude it, but a project that declares its own `exclude` *replaces*
  that list rather than adding to it, and `astro check` then type-checks the
  built bundle. cypruspokerbrisbane got ~70 spurious warnings out of a built
  `chart.js` this way, and 0/0/0 once `dist` went back in. No `exclude` at all is
  correct and passes. → `modules: tsconfig:exclude-dist`
- **The upgrade is verified mechanically, not by reading.** The guide is 333
  pages and the two changes above are both silent, so `astro:version`'s fix hint
  now carries the procedure that actually caught them: build on the old version,
  snapshot `dist/`, upgrade, rebuild, and diff the rendered visible text **with
  tags stripped to empty** — not to a space, which masks precisely the
  `compressHTML` change. That took tasmanvisa-web from "hope it is fine" to "332
  of 333 pages byte-identical, and the one difference is a fix".

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

  **The finding names the component, not the built page.** Reporting
  `dist/wiki/index.html` for a level written in a shared layout leaves the reader
  the actual work — the built page is where it showed up, the component is what
  they have to edit. The offending heading's *text* is matched back against
  `src/`, and a location is claimed only when **exactly one** source file
  matches: a heading rendered from frontmatter (`<h2>{title}</h2>`) has no
  literal to find, and two components sharing a heading text are ambiguous. Both
  fall back to the built path, because a confidently wrong pointer is worse than
  the artifact.

## images — content images delivered well

*Check files: `tools/checks/images.mjs` (offline: source + built `dist/`) and
`tools/checks/live.mjs` (served HTML). Shared param logic: `tools/lib/cf-image.mjs`.*

- **Where media lives (2026-09-02).** Two lanes, and which one is not a
  preference. *Site chrome* — logo, favicon, one hero, the OG cards — is a
  handful of files that never change, lives in the repo under `src/assets/`,
  and goes through Astro's `<Image>` at build, which is what lets the starter
  build with no Cloudflare account. *Content media* — photos in posts, anything
  editorial, anything that grows — never enters git. It goes to one R2 bucket
  per site behind `media.<domain>`, and every page requests it through
  Cloudflare's transform URL (`/cdn-cgi/image/width=…,quality=80,format=auto/…`)
  so the edge produces each size on demand and nothing is resized at build.
  Git stores every version of every binary forever, so a photo edited twice
  costs three copies in every clone, and it drags optimisation back into the
  build. **The bucket is the media repo**; `wrangler r2 object list` is the
  inventory and there is no manifest to drift. A post references a *key*
  (`blog/<id>/cover.jpg`), never a URL, so the domain has one home. Keys follow
  the content so a post and its media share a name. The one thing the build
  cannot do for a file it never sees is read its dimensions, so the upload path
  records them into the frontmatter — reading a number, not resizing — and the
  tag carries width/height like any other. In the starter: `Cover.astro` renders
  either lane, `src/lib/media.ts` builds the URLs, `npm run media` uploads and
  prints the frontmatter, `astro.config` derives `remotePatterns` from the same
  brand file. No new check: the delivery half is already every rule below plus
  `modules: remotePatterns`, `perf: preconnect`, and the live image loop that
  fetches every served content image with a browser Accept header. Exercised
  by setting a media domain and a key on a starter post: the audit found the
  missing preconnect and the missing remote pattern in the first run, and a
  wrong `crossorigin` rule in the second — all three fixed in the same change.
- **Content images go through an image transform.** Either Astro build-time
  optimization for local assets (`/_astro/…`) or Cloudflare Image
  Transformations for R2 content (`/cdn-cgi/image/…`) — never a raw full-size
  `<img>` to the media domain. → `images: routed`, `images: background-image`
- **No oversized rasters at the source or in the build.** A >500 KB PNG/JPG in
  `src/assets/`, or a >300 KB content image in `dist/`, means something never got
  resized. → `images: assets:size`, `images: dist:size`

  **A responsive image is judged as a ladder, not as files.** The browser
  downloads exactly one rung of a `srcset`, so the budget applies to the
  *smallest* rung — what a phone actually gets — not to the largest. Flagging the
  top rung was a false positive with no legal fix: Astro emits the intrinsic
  width unconditionally (`image.breakpoints` only adds widths *below* it), so the
  only way to satisfy it was to downscale the source and degrade retina desktop
  to improve a number no user experiences. A ladder is a defect when even its
  smallest rung is over budget; a single image referenced by no `srcset` is still
  judged on its own bytes. Ladders are read out of the built HTML — an `<img>`'s
  `srcset` plus its `src` fallback, and each `<source>` in a `<picture>`.
  Reported by `tasmanvisa-web`, 2026-08-02.
- **A CSS background does not pin a width.** `background-image` gets neither
  `srcset` nor lazy loading, and neither is recoverable: whatever width is
  hardcoded is what every device downloads, and the fetch starts as soon as the
  rule matches an element — so cards four screens down compete with the LCP image
  for bandwidth. tasmanvisa-web had `QuoteCTA` pinned at `width=1600`, so phones
  fetched a 1600 px photo for a 393 px viewport; the home page shipped ~1.1 MB of
  CSS backgrounds and audited `images ✅ all`. Converting 19 of them took that
  page from 1834 KB to 925 KB. → `images: background-image:fixed-width`

  The fix is an absolutely-inset `<img>` with `srcset`/`sizes`/`loading="lazy"`
  inside a positioned parent. `image-set()` is exempt — it does DPR selection,
  which is less than an `<img>` gets but more than nothing. Scanned in source
  rather than `dist/`, because the fix is a template edit and that is where the
  finding should point. Widths under 640 px are not flagged: a pinned width that
  small is roughly what a phone wants anyway, and flagging a decorative texture
  is the noise that gets a tool ignored.
- **A large image ships a ladder, not one fixed width.** Everything above judges
  responsive images that already exist — the smallest rung of a `srcset`, a CSS
  background that can never have one, an overstated `sizes` measured in a
  browser. None of them says the thing that is arguably worth more: *this image
  is large and ships as a single width, so every phone downloads the desktop
  file*. That is this check. → 💡 `images: srcset:missing`

  A candidate is a built `<img>` with no `srcset` and no `<picture>` ancestor
  (its `<source>` siblings are the ladder) whose delivered width is knowable —
  the width a `/cdn-cgi/image/` URL pins, or the intrinsic width of the file it
  resolves to in `dist/`. PNG, JPEG, WebP and AVIF are all readable from their
  own bytes (`tools/lib/image-size.mjs`); a remote host is unknowable offline,
  and an unknown width is never a finding.

  AVIF was the exception until issue #21, and it was the expensive kind of
  silence: a build that emits avif produced `⏭ nothing to check` — the same line
  a site with no images gets — because every candidate's width was unreadable.
  Reading it means walking ISOBMFF boxes to the `ispe` the primary item claims,
  not the first one in the file, since a thumbnail or an alpha plane carries its
  own and taking the wrong one understates the width the browser paints.

  **The trap, and why this took three attempts to ship.** A legitimately
  fixed-width image is common and *correct*: a logo, an avatar, an icon, a
  diagram rendered at exactly one size. Flagging those is the crying-wolf
  failure `tools/lib/policy.mjs` exists to prevent, and it is worse than not
  having the check. So the thresholds are measured rather than chosen. Across
  three real builds (tasmanvisa-web, matevisky-web, mergodon-com-web), every
  single-width image that was *meant* to be one came in at ≤ 720 px — badge
  strips at 200–300, portraits at 240–640, footer logos at 220 — while every one
  that should have had a ladder was a 1200–1600 px photograph. Hence **1000 px**,
  which sits in the empty gap between the two populations rather than at a round
  number someone liked. Two further guards cover the wide-but-legitimate case: a
  **50 KB** floor when the bytes are knowable (the same build's 1594 px brand
  lockups are 21 and 25 KB, while its wide photographs start at 46 KB), and a
  name filter for `logo`/`lockup`/`badge`/`icon`/`avatar`-shaped paths. Each of
  the two real false positives the sweep produced is excluded by *both*.

  Exempted images are counted, not discarded, so the pass line can say "none
  needed a ladder (2 of them wider than 1000px, but …)" instead of implying
  nothing wide was there — which would be a false statement about precisely the
  images the guards exist for.

  **Advisory in every mode**, and that is the shipping condition issue #12 set:
  it earns a `🔧` only if a wider real-site sweep shows it staying quiet on
  correct code. The measured sweep so far: silent on tasmanvisa-web (9 candidates,
  0 findings) and matevisky-web (7, 0); 7 true findings on mergodon-com-web, all
  blog and hero photographs pinned to a single desktop width.
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

  Every `<img>` tag counts, on every page. The check used to de-duplicate by
  `src` across the whole build, so the *first* occurrence of an image decided the
  verdict for all of them: the same photo used with alt on the homepage and
  without alt on a post was reported as fine. Four of five independent dogfood
  builds found that — a silent false negative with exit 0, which is the worst
  outcome this tool has. Each offending page is now its own finding, named.

## perf — page-speed levers

*Check file: `tools/checks/perf.mjs` (offline) and cache checks in
`tools/checks/live.mjs` (served).*
- **Hashed assets are immutable.** `public/_headers` marks `/_astro/*`
  `public, max-age=31536000, immutable` so repeat visits don't re-validate every
  JS/CSS/font. (A plain `astro dev` server doesn't apply `_headers` — the live
  check needs `wrangler dev` of `dist/` or the deployed site.) →
  `perf: _headers:/_astro/*`, live `perf: cache:_astro`
- **HTML revalidates.** HTML routes must *not* be immutable, or deploys won't
  show until the cache expires. → live `perf: cache:html`
- **Content `<img>` carry width + height.** Explicit dimensions (or `<Image>`,
  which bakes them) prevent layout shift (CLS). → `perf: cls:img-dimensions`,
  live `images: cls`

  **…unless CSS takes the image out of flow, in which case demanding them is
  cargo cult.** An absolutely-positioned image has no siblings to push, and
  `inset: 0` + `height: 100%` override the intrinsic-ratio box the attributes
  would establish — adding them changes nothing a browser does. Both checks now
  read the project's CSS (`<style>` blocks and `.css` under `src/` offline;
  the page's linked stylesheets when `--url`) and skip an `<img>` whose class,
  id or inline style puts it at `position: absolute`/`fixed`.

  This is not a corner case, it is the shape rider's *own* advice produces:
  `images: background-image` pushes a site off CSS backgrounds, and the
  replacement it names is precisely an absolutely-inset `object-fit: cover`
  `<img>` — so the more compliant the site, the more of these it has.
  tasmanvisa-web reported 20 of them, **20 of the 21 required findings in the
  whole live run**, on a page rider itself measured at CLS 0.001 (`browser`) and
  0 (`lighthouse`). A heuristic that a measurement in the same run contradicts
  that loudly is a bug in the heuristic. The reader is a selector scan, not a
  cascade — it answers the weaker "does any rule take this out of flow?" and errs
  toward silence, because missing one shifting image costs a finding while crying
  wolf twenty times costs the domain its credibility (`tools/lib/css-flow.mjs`).

  The live finding is also **aggregated**, one line naming a count and an
  example, not one per tag. A shared component puts the same defect on every card
  on the page; twenty findings for one fix is what buried the other one.

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
- **Every declared family is one that can actually paint.** A family in
  `fonts[]` whose `cssVariable` never *leads* a `font-family` stack can only
  render if the font ahead of it fails to load — which, for a self-hosted,
  preloaded webfont, means never. It is downloaded eagerly on every page anyway.
  tasmanvisa-web had `Inter` sitting second behind `Sora`: **277 KB**, 143 KB of
  it italic faces nothing referenced. → `perf: font:unused-family`

  Neither this nor the next one shows up in a byte total, which is why
  `font:bytes` passed the whole time: the total was correct, the *composition*
  was wrong. The correct fallback is the metric-adjusted local one Astro already
  generates (`optimizedFallbacks`, on by default), not a second webfont.

  A variable that appears in no stack at all is `💡` rather than `🔧` — the
  weaker evidence of the two, since it could equally be a gap in how the tool
  reads the CSS.
- **A family that never renders italic says so.** `styles` defaults to
  `['normal', 'italic']` — read off `astro/dist/assets/fonts/constants.js` in
  astro@7.1.6, not recalled — so declaring a family without it silently doubles
  its file count. Three of tasmanvisa's four families were shipping italic files
  for nothing. → `perf: font:styles`

  `🔧` only when the built output renders no italic *at all*. `<em>`, `<i>` and
  `<cite>` are italic from the UA stylesheet with no CSS involved, so testing for
  `font-style: italic` alone would flag every blog with emphasis in its prose;
  when any of those is present the finding drops to `💡`.

  **The fix hints name family × style × subset, never "drop unused weights".**
  Weights are free with a variable font — Sora 300–700 is one file — so pruning
  them is wasted effort, and advice to do it would be actively misleading. Nor is
  `subsets` safe to trim on a bilingual site: `latin-ext` is mandatory for
  Hungarian ő/ű.
- **Heavy third-party embeds sit behind a facade.** A Maps, YouTube, Vimeo,
  Spotify, Calendly or Typeform `<iframe>` pulls hundreds of kilobytes over
  dozens of requests from an origin you don't control, and it starts the moment
  the page loads. The fix is a facade: render a static placeholder — an image, or
  a styled box with a play button — and inject the real `<iframe>` from an
  `IntersectionObserver` when the reader scrolls near it. → `perf: embed:eager`

  **`loading="lazy"` is not a substitute, and the check deliberately does not
  accept it.** Native lazy loading only defers frames far enough down the page.
  On cypruspokerbrisbane.com (2026-05-31) the Maps `output=embed` iframe was in
  the *second section* — inside the threshold — so the attribute was present and
  the ~360 KB across ~20 requests was fetched anyway. Under PageSpeed's simulated
  Slow-4G that saturated bandwidth before first paint: mobile Performance 70,
  FCP 3.5 s, LCP 5.5 s. Behind an IntersectionObserver facade the same page
  measured 97 / 1.5 s / 2.0 s.

  Detection is "is the frame in the built HTML at all", because a facade injects
  it at runtime and so leaves nothing to find. Markup a browser does not fetch is
  excluded first — `<template>` (inert, and exactly what a facade clones) and
  `<noscript>` (the correct no-JS fallback *for* a facade) — since flagging those
  would report the fix as the defect. The host table lives in
  `tools/lib/embed-hosts.mjs`; a same-origin or small third-party frame is not
  what this is about.
- **Cross-origin image hosts are preconnected.** A browser only starts DNS + TLS
  for a host once it parses a URL pointing at it, so on a 150 ms-RTT mobile link
  that is several round trips of dead time before a byte of the LCP image moves.
  tasmanvisa-web served every blog hero and card from `media.tasmanvisa.com` with
  no preconnect anywhere: blog index LCP **5424 ms**, ~3500 ms once a preconnect
  plus a matching head preload were added — and the audit reported `perf ✅ all`
  throughout. → `perf: preconnect`

  A host serving one incidental image (an avatar, a badge) is `💡`, not `🔧`:
  the advice is still right, but it is not what cost 900 ms, and failing a build
  over it is the crying-wolf failure `policy.mjs` exists to prevent.
- **A preconnect to an image host matches its images' CORS mode.** A browser
  pools connections by credentials mode. A plain `<img>` is a no-cors,
  credentialed fetch; a `<link rel="preconnect" … crossorigin>` opens an
  anonymous CORS connection that fetch cannot reuse, so the browser opens a
  second and the hint bought nothing. The reverse is just as dead: an
  `<img crossorigin>` with a bare preconnect. It is a separate finding precisely
  because it *looks* fixed — worse than missing. → `perf: preconnect:crossorigin`
  **Corrected 2026-09-02.** Until then this check demanded `crossorigin` on every
  image-host preconnect, on the claim that "images are CORS-mode fetches". They
  are not, unless the tag says so; that rule is right for fonts and `fetch()`
  and wrong for nearly every image on a content site. MDN's preconnect example
  for a generic origin is bare, and the rule it states is *match the resource's
  CORS and credentials mode*. The starter's own media lane tripped it.
- **A preload for an image matches the tag byte for byte.** A head
  `<link rel="preload" as="image">` whose `imagesrcset`/`imagesizes` differ from
  the `<img>`'s `srcset`/`sizes` makes the browser resolve two different
  candidates and download the image twice, so the preload leaves the page slower
  than no preload at all. → `perf: preload:pair`

  **A `srcset` is not `split(',')`, and getting that wrong made this check fire
  on correct code.** A candidate URL may contain commas, and on the delivery this
  baseline recommends it always does:
  `/cdn-cgi/image/width=800,format=auto,quality=80/hero.webp` shattered into
  three fragments, one of which — `format=auto` — was shared by *every*
  transformed image on the page. Pairing a preload to an `<img>` by shared
  fragment then matched an arbitrary unrelated image, whose srcset naturally
  differed, and the check reported a mismatch on a byte-identical pair. Worse, it
  routed around the no-match branch that exists exactly for the reporter's case:
  a preload whose image is a CSS `background-image` has no `<img>` to pair with,
  and "not something a static read can call a defect" was the correct outcome.
  All srcset reading now goes through one spec-shaped parser
  (`srcsetUrls` in `tools/lib/html.mjs`) — a URL is a run of non-whitespace and
  only a *trailing* comma ends a candidate, exactly as a browser reads it.
  Reported by tasmanvisa-web.

  Which page is "cross-origin" is decided per page from its own canonical link
  (falling back to `site:` in astro.config): a page declaring neither is not
  counted, because guessing the site's origin from the build would invent
  findings on a site that renders absolute self-URLs.
- **`sizes` describes the box, not the ambition.** `sizes`, not the layout, is
  what picks the srcset rung — so `sizes="100vw"` on a card that renders at
  355 px in a 393 px viewport makes the browser fetch 1280w/167 KB where
  1000w/133 KB was correct. This needs a rendered measurement, so it lives in the
  `browser` domain: when an image is served far larger than its box *and* its
  `sizes` claims the full viewport, the finding names the attribute as the cause
  rather than reporting the bytes as the symptom. → `browser: images:rendered-size`

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
  partners, sponsors and directories. A route matching `/media`, `/media-kit`,
  `/press`, `/presskit`, `/newsroom` or `/brand-kit` must carry three things to be
  worth linking: a downloadable logo asset, a paste-ready paragraph of
  boilerplate, and a contact route or `mailto:`.
  → `content: mediakit` (`⏭` with no `dist/`)

  **The route list is the check's weak point, and it has failed once.**
  tasmanvisa-web got a `🔧` for a missing media kit while serving a full
  bilingual one at `/media/` — the single plain-English name that was not in a
  list of three (issue #17). Two things came out of that. Bare `/media` is now
  accepted, and with a **locale-prefixed translated slug** the name list can never
  be the answer: `/hu/sajto/` matches nothing in English however long the list
  gets. So the check reads the `hreflang` alternates a matching page emits and
  accepts those pages too — the site already declares which pages are each
  other's translations, for search engines, and reading that beats a per-language
  dictionary of the word "press". Broadening a name list also means a page can
  match the *route* and not be the thing (`/media/` as a photo gallery), so among
  several matches the **best** candidate decides, never the first one the walk
  hits: otherwise a site's real media kit gets reported as "page exists but is
  missing a downloadable logo asset", which is a wrong finding rather than a
  missed one.
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
- **Quotes are written, not guessed at.** Astro 7 renders Markdown with Sätteri
  instead of remark, and the two resolve an *ambiguous* straight `"` differently.
  On tasmanvisa-web's Hungarian content the closing quotes flipped to opening
  ones: six posts shipped `„bespoke“` where the pairing is `„…”`. Nothing in the
  build said a word. Writing the quote you mean fixes it permanently, for any
  engine. → `💡 content: quotes:ambiguous`

  **Advisory in every mode** (`policy.mjs` `ADVISORY`, no `🔧` branch at all).
  Correct prose can legitimately mix a straight quote with a directional one — an
  inch mark, an attribute quoted mid-sentence — so this is the one check here
  that can fire on a compliant site, and a check that fails a compliant site is
  what this repo refuses to ship. It reports *where the two engines would
  disagree*; whether that is a bug is the author's call.

  Fenced code and inline backticks are excluded first: no engine touches those,
  and a `const a = "x"` on a page about typography would otherwise be a finding.
  Markdown is found by walking `src/`, not `src/content/` — the starter keeps its
  posts in `src/data/blog/`, and hardcoding the other path is the mistake that
  once made a whole SEO domain silently not run.

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

  **Blanking comments requires knowing what is a comment**, and the regex that
  did it read a `/*` inside a *string literal* as an opener. The carrier is the
  single most idiomatic line in a Content Layer config —
  `loader: glob({ pattern: '**/*.md' })` — so the blanking ran from the glob
  pattern to the next real `*/`, swallowing the `schema:` key a few lines below
  and reporting a ~35-field Zod schema as absent. It needs *both* halves to
  fire, which is why every two-line test of it looked fine. The scanner is now
  string-aware (`stripComments` in `tools/lib/src-scan.mjs`), and string state
  resets at each newline on purpose: an apostrophe in `.astro` prose ("don't")
  is not a string opener, and letting one span lines would suppress comment
  stripping for the rest of the file — reintroducing the
  comment-satisfies-a-check failure above, which is the worse of the two.
  The blast radius was every `src-scan` consumer, not this check alone.
  Reported by tasmanvisa-web.
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
- **The Article node carries the properties Google documents.** Reading the
  `@type` and stopping is where structured-data checking usually ends, and it is
  not enough: a `BlogPosting` whose `author` is a bare string, whose `image` is
  relative and whose `datePublished` is `toLocaleDateString()` output declares
  itself correctly and earns nothing. Google reads the type, finds the properties
  unusable, and drops the rich result — no error in the page, none in Search
  Console, none in an audit that only counted types. `author` and `headline` are
  the required half; `image` and `datePublished` are recommended, and each one
  visibly changes the result (no image is no thumbnail, no date is no date), so
  their absence is a suggestion rather than a finding.
  → `data: jsonld:article-props`
  **No headline length is asserted.** Google removed the 110-character limit on
  2023-01-03 and now says only that long titles may be truncated on some devices.
  A check for a limit that no longer exists would flag compliant pages.
- **The author is a typed Person or Organization.** `"author": "Jane Doe"` is the
  most common way to write this wrong and it is invisible to any check that only
  asks whether the property is present — a bare string cannot carry the `@type`
  that distinguishes a person from a publisher. An array of authors is correct
  and passes; Google's own example is one. → `data: jsonld:author`
- **Dates are ISO 8601.** A formatted date is not a date to a parser. A date with
  no time (`2026-01-05`) is legal ISO 8601 and passes; the offset is recommended,
  not required, so its absence is not a finding. → `data: jsonld:dates`
- **A breadcrumb trail on content pages.** It is what puts the site's hierarchy
  in the result instead of a bare URL. *Wanting* one is house style — a flat blog
  has no hierarchy to describe — so presence is demoted by default and required
  under `--strict`. Being **malformed** is not house style, and is a separate
  check: positions must run 1..n in order and every item needs a name, because
  Google drops the whole list rather than guessing when either is wrong. The last
  item may omit its `item` URL, where Google defaults to the current page — the
  naive version of this check fires on Google's own documented example.
  → `data: jsonld:breadcrumb` (house), `data: jsonld:breadcrumb-shape` (universal)
- **Absolute URLs, as advice only.** A relative URL in JSON-LD is *not* broken,
  and an earlier draft of this check said it was. JSON-LD 1.1 resolves relative
  IRIs against the base IRI, which for a block embedded in HTML is the document's
  own location, so a compliant processor reads `/og/default.png` exactly as
  intended. Google documents no rule either way — grepping `sd-policies`,
  `intro-structured-data`, `article` and `breadcrumb` for "absolute" and
  "relative URL" returns nothing, and what *is* documented is that image URLs
  must be crawlable, which is a different property. So this is advisory in every
  mode: absolute values survive syndication, a feed, or any reader that never saw
  the page; relative ones work only while the block sits on its original URL.
  → `data: jsonld:urls` (advisory)
- **No markup for rich results that no longer exist.** Three were retired while
  the markup requesting them stayed valid, so sites keep emitting them and keep
  believing they do something: the **sitelinks searchbox** (`WebSite` →
  `SearchAction`, removed from results 2024-11-21), **HowTo** (desktop results
  ended 2023-09-13), and **FAQPage** (restricted to authoritative government and
  health sites in September 2023, retired outright 2026-05-07). All three doc
  pages now redirect to their removal entries in Google's changelog. Google is
  explicit that removing them is optional and that leaving them causes no errors,
  which is exactly why this reports and never fails — the markup is not wrong, it
  is just no longer paid for. `--strict` does not promote it; there is no failing
  branch to promote. Only the `SearchAction` is dead, not `WebSite`, which still
  carries the site name. Our own fixture was emitting one, which is how this
  check earned its keep on the day it shipped.
  → `data: jsonld:deprecated` (advisory)
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
- **A search-index endpoint, if the site has search *and the engine reads one*.**
  A `search-index*.json` endpoint built from `getCollection()` is what a
  client-side engine loads. Since search became optional the check is
  dependency-aware: no endpoint *and* no search library is `⏭`; no endpoint
  *with* an index-reading library installed is a finding, because the site ships
  a search UI with nothing to feed it.

  ⚠ **"Has search" is not the same question as "emits an index".** Pagefind
  indexes the *built HTML in `dist/`* as a build step; Algolia, Meilisearch and
  Typesense keep the index on a server. Asking any of them for a
  `search-index.json` endpoint is asking for a file the engine is designed not to
  have — and the check did, on correct sites, until each engine started carrying
  a `localIndex` fact alongside its packages. An engine that hosts or builds its
  own index now `⏭`s and says which it does. → `data: search:index`
  (pairs with `modules: search:engine`)

**Shared invariant:** one publish predicate — `!draft && !previewOnly` — across
llms, RSS, and search-index, so all three discovery surfaces agree on what's
public.

## analytics — measured privately, and measured at all

*Check files: `tools/checks/analytics.mjs` (offline: source + built `dist/`) and
the `analytics` checks in `tools/checks/live.mjs` (served HTML, `--url`). The
patterns both read live in `tools/lib/analytics-signals.mjs`, so the two cannot
drift.*

**Nothing in this section fails a run.** `analytics: provider` is *advisory by
construction* — it has no `🔧`/`🛑` branch at all, in either mode, and
`tools/lib/policy.mjs` lists it as such so `--rules` says `[advisory]` rather
than implying `--strict` would promote it. Whether a site measures its traffic
is a business decision. The tool reports what delivers analytics — including
when the answer is nothing — and moves on. `tools/test.mjs` asserts the
invariant under `--strict`, because a future refactor could otherwise turn every
unmeasured site into a build failure without a single test going red.

### The default: Cloudflare Web Analytics

- **Cloudflare Web Analytics is the baseline's analytics layer.** It is free, it
  is cookieless, and it does not require a consent banner — so a site can be
  measured the day it deploys, with no dashboard project in front of it. One
  script tag in the root layout:

  ```html
  <script type="module"
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token": "<SITE_TOKEN>"}'></script>
  ```

  (Cloudflare `web-analytics/faq`, verified 2026-08-03. A `?token=…` query-string
  form exists too, for tag managers that cannot set attributes.) The beacon
  reports to `/cdn-cgi/rum` on the site's own origin.
  → `analytics: provider`
- **Offline can only ever be advisory about its presence, and not because of the
  severity.** For a proxied site Cloudflare injects the beacon *at the edge* —
  automatic setup is on by default — so a correctly-measured site can have no
  trace of it in `src/` or `dist/`. The served page is the authoritative reader.
  The offline check therefore says what it saw and names `--url` as the thing
  that settles it, rather than concluding.
- **A beacon wired behind an unset token measures nothing.** The common shape is
  a root layout that renders the script only when a token is configured. That is
  correct — but it means "the code is there" and "data is flowing" are different
  claims. When the beacon is in `src/` and in none of the built pages, the check
  says so in those words. `examples/_fixture-i18n` is the standing example: it is
  localhost-only, its token is genuinely `null`, and it carries this `💡`
  permanently rather than being given a fake token to look clean.
- **Auto-install does not reach a Worker.** Cloudflare's automatic injection
  rewrites HTML for proxied *static* responses. A site served by a Worker — which
  is what a Cloudflare Pages/Workers deploy of an Astro build is — is not
  rewritten, so auto-install silently does nothing and the dashboard still shows
  the site as set up. **On a Workers-served site the `<script>` in the root
  layout is mandatory.** This is the single most expensive thing to get wrong
  here, because every surface reports success: the dashboard says installed, the
  build says fine, and no data arrives. Confirm it the only way that means
  anything — `--url` against the deployed site, which reads the served HTML.
  → `analytics: provider` (live)

### The alternative, fully supported: Cloudflare Zaraz

Zaraz is a tag *manager*. Reach for it when you need to run Google Analytics or
other third-party tools and want them gated behind a consent CMP. It is not
worse than Web Analytics; it is a bigger thing, and it is no longer what a site
must set up before it measures anything.

- **Zaraz loads tags at the edge, behind its own consent gate.** It loads Google
  Analytics (and Cloudflare's own analytics) at the edge and holds every tag
  behind its Consent Management Platform — the cookie banner — so nothing fires
  before the visitor agrees. → `analytics: zaraz` (live)
- **The Zaraz loader is only visible at serve time.** Because Zaraz injects at
  the edge, the loader (`/cdn-cgi/zaraz/i.js`) shows up only in served HTML. With
  `--url`, its presence confirms analytics is Zaraz-managed. Without `--url` the
  check reports `⏭`, and says which.
- **The live probe must look like a browser to see Zaraz.** Zaraz has a "Block
  bot initiated requests" setting (bot-score based: block none / automated /
  automated + likely) and Bot Fight Mode does the same — a headerless `fetch` is
  bot-scored as automated, so the edge *correctly* suppresses the loader
  injection for it. A curl-shaped probe therefore never sees Zaraz on a protected
  site, even when it is configured right. So the live GET carries a full browser
  navigation signature (`NAV_HEADERS` in `live.mjs`: Chrome UA, `Sec-Fetch-*`,
  `Sec-Ch-Ua`, `Accept: text/html…`) to get the fully-injected page a real
  visitor receives. Without this the check skips with a false negative.
  → drives `analytics: zaraz`
- **The cookie banner is Zaraz's CMP — no custom banner in the site.** Zaraz
  ships a built-in Consent Management Platform: enable it in the dashboard,
  assign each tool a *purpose*, and Zaraz auto-renders the consent modal, gates
  every tag until the visitor agrees, localises by `Accept-Language`, and is
  styleable via custom CSS. So a site using Zaraz should **not** hand-roll a
  cookie banner — that duplicates what the CMP already does and risks tags firing
  outside consent. The Consent API (`zaraz.consent.*`, the `cf_consent` cookie,
  the `zarazConsentAPIReady` event) is the escape hatch *only* for advanced needs
  — region-scoped modals (e.g. EU-only) or integrating a third-party CMP. (No
  enforcing check: a custom banner isn't reliably detectable in static HTML, and
  the CMP render itself is a Gap below — runtime, needs a browser.)
- **A site on Web Analytics needs no banner at all.** This is the practical
  reason it is the default: cookieless measurement has nothing to consent to, so
  the entire CMP question — build it, configure it, style it, test that tags
  actually hold — does not arise.

### The finding: a snippet that fires before consent

- **No hardcoded Google Analytics / GTM snippet.** A GA or Tag Manager snippet
  pasted into the source fires immediately, outside any consent gate, and
  bypasses Zaraz entirely. The offline check flags it
  (`gtag.js`/`gtm.js`/`analytics.js`/`gtag(`/`GTM-…`/`UA-…`) in `src/` or
  `dist/`. It has two fixes, and the check names both: drop GA for cookieless Web
  Analytics, or deliver GA through Zaraz so the CMP gates it.
  → `analytics: no-hardcoded-ga`
- **Live, only a third-party *loader* counts.** A bare `gtag()` call is not
  flagged against served HTML: when Zaraz delivers GA it injects that bootstrap
  into the rendered page itself, so keying on the call — as the offline scan
  correctly does for *source* — would flag every compliant site. Only a script
  fetched from a Google origin proves the site went around the edge. That is its
  own rule in both branches: reporting the no-Zaraz case under the `zaraz` id
  gave one id three meanings, so nothing could be filtered or suppressed by it.
  → `analytics: ga:raw`
- **Comments are blanked before matching.** A `{/* Cloudflare Web Analytics
  beacon */}` note above an unwired block must not satisfy the *positive* check —
  that would be the tool reporting verified-good where nothing is emitted, which
  is the worst failure it has. The check reads `code` from `lib/src-scan.mjs`,
  not raw text. This class of bug has now been fixed three times in this repo
  (meta tags, then content schemas, then here), which is why it is written down.

> **Not enforced: Google Tag Gateway.** Cloudflare's Google Tag Gateway (serving
> the Google tag first-party from a reserved path instead of `googletagmanager.com`)
> earns its keep when ad-spend measurement / ad-blocker signal recovery is the
> point — paid acquisition, conversion optimisation. For a content/info site that
> signal isn't acted on, so the gateway is overkill: a per-zone moving part to
> maintain for no payoff. First-party serving is a deliberate non-goal, not a
> gap. (Considered + dropped 2026-05-30.)

> **Manual setup (operator step, not in the repo).** Both deliveries are
> configured in the Cloudflare dashboard, per zone: for Web Analytics, creating
> the site and getting its token; for Zaraz, the tools it loads, the property ID,
> the consent CMP config, auto-inject, and the bot-request policy. None of it
> lives in the audited site's source, so the audit can only *verify it is present
> and firing* at serve time (`--url`); it can never provision it. Treat it like
> the PSI key: an operator manual setup the tool checks, not one it owns.


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
- **The sampled page is one the site itself calls an article.** Discovery reads
  the **feed first** — RSS/Atom is the site's own list of what it considers a
  post — and only falls back to the sitemap, homepage links and `/llms.txt`. The
  sitemap lists every indexable page equally, so "deepest path wins" picked
  whatever sorted first: on matewishkey-web that was `/glossary/agent/`, while
  the `BlogPosting`-carrying `/projects/*` sat right beside it in the same
  sitemap.
- **A page type that isn't an Article is not a missing Article.** A glossary
  entry is a `DefinedTerm`, an FAQ is an `FAQPage`, a recipe is a `Recipe` —
  each is the *correct* markup, and rewriting it as an Article would make the
  page worse. `data: post:jsonld` passes on any of them and says which was
  found, so "this is a definition" and "this is a post" stay distinguishable.

  The generic wrappers are deliberately **not** accepted — `WebPage`,
  `WebSite`, `BreadcrumbList`, `Organization`. They say nothing about what the
  page is, so accepting them would collapse this check into "has any JSON-LD",
  which `jsonld:emitted` already answers. The list lives in
  `tools/lib/jsonld.mjs` (`CONTENT_PAGE_TYPES`). Reported by matewishkey-web.
- **A finding that could not have gone the other way is not a finding.** Neither
  `astro dev` nor `astro preview` applies `public/_headers` — both serve
  `/_astro/*` as `no-cache` whatever the file says — so `perf: cache:_astro`
  against one was guaranteed, unactionable, and (under `--strict`) run-failing.
  It now `⏭`s when the project's own `_headers` declares hashed assets immutable
  *and* the server is local *and* it returned otherwise: three facts that
  together mean "this server ignores the file", not "this site is misconfigured".

  Being local is deliberately not sufficient. `wrangler dev` of the same build
  returns `public, max-age=31536000, immutable` (measured, 2026-08-03, wrangler
  4.118.0 against `examples/starter`), so skipping on host alone would hide the
  finding on the one local server able to produce it. For the same reason the
  *pass* carries no dev-server caveat: an immutable response is something only a
  server that applied the rule can return, so it is proof wherever it came from.
  The caveat now attaches to `perf: cache:html` only when the asset probe showed
  the server ignoring `_headers`.

## lighthouse (`--url`) — the measured score

*Check file: `tools/checks/lighthouse.mjs`. Needs a PSI key.* Where the static
checks confirm "is it wired right?", this answers "what's the real score?" —
PageSpeed Insights Performance/SEO/Accessibility/Best-Practices + lab Core Web
Vitals (LCP/TBT/CLS), plus CrUX field data when the site has enough traffic.
Lab scores are noisy — treat one run as a sample, not a verdict.

- **A score comes with what it means.** "Lab noise" is a real answer and also a
  dangerous one: cypruspokerbrisbane's 5.5 s LCP was dismissed as a harness
  artifact when the cause was a 360 KB Maps iframe. Pulling the full PSI JSON
  settled it in one read, so the three fields that settled it are reported
  instead of discarded — the **LCP element** (what the number is waiting for),
  the **heaviest third-party origins** (weight the site owner did not write), and
  **simulated vs observed** FCP/LCP.
  → `💡 lighthouse: lcp:element`, `third-party:payload`, `metrics:observed`

  The pair is what tells the two cases apart. ~0 ms TTFB with a high FCP means
  the render is blocked by *payload* — go looking for an embed. A completed load
  with an idle main thread but a late **observed** paint is harness variance, and
  the proof in that case was that observed FCP got *slower* after the page got
  lighter.

  All three are advisory by construction (`policy.mjs` `ADVISORY`): they are
  facts about the run, not verdicts. The scores beside them are the verdict.

  **Audit ids are read under both the current and the legacy names, and that is
  load-bearing.** Lighthouse renamed this family to `*-insight`, and PSI serves
  whatever its deployed Lighthouse emits. Measured 2026-08-03 against a live key:
  the response carried `lcp-discovery-insight`, `lcp-breakdown-insight` and
  `third-parties-insight`, and **none** of `largest-contentful-paint-element` or
  `third-party-summary`. The failure mode is the quiet one — a renamed id doesn't
  error, it produces a permanent `⏭`, which reads exactly like "nothing to report
  here". Both id sets are parsed and both are asserted in `tools/test.mjs`.

  The insight shape pays for itself: `lcp-discovery-insight` also carries a
  checklist of the three things that delay an LCP image regardless of its bytes —
  `fetchpriority=high` applied, not `loading="lazy"`, discoverable in the initial
  document. Failures are quoted in Lighthouse's own words rather than re-worded,
  since it is the authority on its own check.


## browser (`--url`) — what only a real browser sees

*Check file: `tools/checks/browser.mjs`. Needs `playwright` installed in the
audited project.* Every other domain reads bytes — source files, built HTML, or
the HTML a server hands back. A page is not its bytes. A script that throws, an
asset that 404s only once the page asks for it, an image downloaded at 4× the box
it lands in, the layout jumping as a font swaps: none of that is in the response,
and all of it is what users actually report. This domain loads the page in
Chromium and measures what happened.

- **`playwright` is deliberately not a dependency of this tool.** It is imported
  dynamically, and the whole domain `⏭`s with the install command when it isn't
  there — the same shape as `lighthouse` without a key. `git clone && node
  audit.mjs` has to keep working with no install step and no browser download; a
  headless Chromium is ~150 MB and cannot be the price of an offline SEO check.
  Resolving from **the audited project** is the load-bearing half: rider is
  normally a clone somewhere else entirely, so a bare `import('playwright')`
  looks in the wrong `node_modules` and reports "not installed" about a project
  that installed it. Playwright's entry is CommonJS, so its exports arrive on
  `default` under ESM — destructuring `{ chromium }` yields `undefined`, which is
  indistinguishable from absent. Both resolutions are tried, and both spellings
  read. → `⏭ browser: playwright`, `browser: launch`

  **This is the tool's one exception to "never executes the audited project's
  code", and it is disclosed rather than hidden.** Importing a driver out of the
  project's `node_modules` means a hostile repository can reach the auditor
  process — which four documents flatly denied until issue #19. The exception is
  bounded: `--url` only (the offline audit never gets here), the auditor's own
  tree is resolved **first** so a project copy loads only when there is no other,
  and the run announces which copy it loaded. Distrust the repo? Omit `--url`.
  → `⏭ browser: playwright:source`, and `SECURITY.md`
- **A measured page is one page, and the output says which.** Everything below
  is measured on the single URL that was loaded, so the domain announces it up
  front rather than letting a homepage sample read as a site-wide verdict. Pass
  `--post <path>` to measure a content page instead. → `⏭ browser: scope`
- **It is measured at a phone's width, because that is what `--strategy` already
  claimed.** Lighthouse has always defaulted to `mobile`; this domain used to
  take Playwright's default and measure at 1280×720 regardless, so one run
  reported a mobile score and a desktop measurement and never said so. Worse,
  `--strategy desktop` silently did nothing here. Both viewports now come from
  the flag (`mobile` 393×852, `desktop` 1280×800), `isMobile` is set so the
  page's `<meta viewport>` and the `pointer`/`hover` media queries behave the way
  a phone reads them, and the scope line prints the width it used. A CLS number,
  an oversized-image ratio and a third-party weight are all viewport-dependent —
  a measurement that does not name its viewport is not a measurement.
  → `⏭ browser: scope`
- **Nothing is measured until the page actually loads.** A navigation that times
  out, hangs on a pending request, or returns a non-2xx is a `🛑 block`, not a
  quiet run of zero findings — a domain that reports "no errors" about a page it
  never opened is the failure this whole file exists to prevent.
  → `browser: load`
- **An uncaught exception is a defect even when the HTML is perfect.** A script
  that throws leaves buttons dead, menus shut and forms inert while every static
  check still passes: the markup it was supposed to animate is right there. It is
  a `🔧`. Console errors are a separate, softer signal — each one is something
  the page tried to do and could not, but plenty are third-party noise, so they
  are `💡`. → `browser: js:errors` (`🔧`), `browser: console` (`💡`)
- **A request the browser could not complete is a missing asset.** 404s on
  sub-resources are invisible to a static read — the HTML referencing them is
  well-formed, and only fetching the page's own request list finds them. A
  connection-level failure is reported differently on purpose: it may be the
  network the audit ran on (an ad blocker, a DNS filter, a captive portal), not
  the site, and the fix text says to re-check from elsewhere before treating it
  as a site bug. Blaming a site for the auditor's network is how a tool loses
  trust. → `browser: requests`
- **"Oversized" means oversized *for its box*, which only a browser knows.** The
  offline checks compare bytes to a fixed budget; a 1280w hero is fine and a
  1280w thumbnail is not, and nothing in the bytes distinguishes them.
  `naturalWidth` over the rendered width does. Over 2.5× is reported.

  The finding names the **cause, not the symptom**, when it can see it: `sizes`
  — not the layout — is what picks a srcset rung, so an overstated `sizes` is
  usually the whole explanation. tasmanvisa-web claimed `100vw` for a card
  rendering at 355 px in a 393 px viewport, and the browser dutifully fetched
  1280w/167 KB where 1000w/133 KB was correct. Advisory: the ratio is a
  heuristic, and art direction can justify it. → `💡 browser: images:rendered-size`
- **Measured CLS outranks inferred CLS.** `perf: cls:img-dimensions` and
  `images: cls` infer shift risk from missing `width`/`height`. This is the real
  number, from `PerformanceObserver`, and it includes what the static reads
  cannot see at all: font swaps, late-injected DOM, embeds that resize
  themselves. Graded on the Core Web Vitals bands (good ≤ 0.1, poor > 0.25).

  When the two disagree, the measurement is the one that is right, and the
  disagreement is a bug in the heuristic. That is not hypothetical: 20 static
  `images: cls` findings landed on a page this check measured at 0.001, all on
  absolutely-positioned fill images that cannot shift anything. The heuristic now
  reads the CSS — see `perf` above and `tools/lib/css-flow.mjs`.
  → `browser: cls:measured`
- **A third party is a domain you don't own, not an origin that isn't this one.**
  `media.example.com` serving your own images is not third-party weight; counting
  it as such would flag the cross-origin image host `perf: preconnect` exists to
  recommend. The comparison is on the registrable domain (approximated —
  this tool ships no Public Suffix List). Over 250 KB per origin is reported,
  advisory: third-party weight blocks your own content, but the call on whether
  a given tag is worth it is the site owner's. → `💡 browser: third-party`
- **Every route the wide nav offers has to be reachable on a phone.** This is
  the failure nothing else in this file can see. The HTML carries the links, no
  request fails, nothing throws, CLS is clean — and below the breakpoint the CSS
  hides the bar while the control meant to bring it back is missing, unstyled or
  empty. Every static check reads perfect markup; the page has no navigation on
  a phone. That is how a broken hamburger ships, and it shipped.

  It is judged as **reach, not presence**, which is the whole design. A link
  that leaves the bar and turns up in the footer is still reachable, and moving
  it there is a normal, deliberate call — a check that flagged it would be
  uninstalled within a week. So the comparison is: the visible nav links at
  1280px, against everything visible *anywhere on the page* at 393px, after
  opening whatever in the header looks like a menu (`<details>` by property, a
  toggle carrying `aria-expanded`/`aria-controls`, a checkbox hack). Only a
  route reachable from **nowhere** is a `🔧`.

  ⚠ **The visibility test is the load-bearing part, and the obvious one is
  wrong.** Chromium skips a closed `<details>`'s subtree with
  `content-visibility` rather than zeroing its boxes, so the links inside a
  collapsed hamburger measure 58×17 and a bounding-rect test reads them as on
  screen — a menu that never opens would score a clean pass, which is precisely
  the bug. `Element.checkVisibility()` answers correctly (verified both ways
  against an open and a closed `<details>`, 2026-09-01). `tools/test.mjs` asserts
  the pass came *with* a control actually opened, so the regression cannot
  return quietly.

  Two more ways to invent a finding out of nothing, both of which fired before
  they were fixed, and both on pages that were **fine**: `/about` and `/about/`
  are one route that a nav and a footer routinely spell differently, so the
  comparison normalises the trailing slash; and a form's submit button carrying
  `aria-controls` matches the toggle test exactly, so clicking it navigated away
  and left every link looking unreachable. Buttons bound to a form are never
  clicked, and if the URL moves anyway the check reports that it could not tell
  rather than guessing. **The bar for this check is not "does it catch a broken
  hamburger" — it is "does it stay silent on the hundreds of correct ones".**
  ⚠ **Waiting for a menu is waiting for its LINKS, not for the page to go
  quiet.** A menu is often built by script after it opens, and "has the DOM
  stopped changing" cannot tell a page that has not started from one that has
  finished — both look settled on two consecutive polls. Measured: a menu whose
  links were injected 600 ms after the click settled instantly at zero links and
  was reported unreachable. The wait polls for the links the verdict is made of
  instead, stopping the moment they are all present, so only a menu that never
  delivers pays the full budget. → `browser: nav:reach`
- **Console text and asset URLs are written by the page being audited.** They
  land in whatever reads this output, agent or human, so they are truncated and
  fenced like every other untrusted string the tool relays.
  → `⏭ browser: untrusted-input`

## Gaps / candidate practices (not yet enforced)

The queue. Each becomes a real check when a reporter hits it or we decide it's
worth it — following *How we add a practice* above. Listed so we don't lose them.

**The live queue is the issue tracker**, not this list:
[matewishkey/mwk-rider issues](https://github.com/matewishkey/mwk-rider/issues). Seven
came in from audited sites and were closed on 2026-08-03 by shipped checks —
eager third-party embeds, `dist:size` flagging srcset rungs, CSS
`background-image` (no srcset, no lazy loading), the two remaining font-hygiene
traps, cross-origin `preconnect`, the two Astro 7 changes that build clean and
ship wrong, and a glossary `DefinedTerm` page read as a missing Article. A second
round — three false-firing checks, the missing § browser section, the positive
`srcset` assertion (§ images), a media-kit route list that missed `/media/`
(§ content), and a threat-model claim four files made that the `browser` domain
broke (`SECURITY.md`) — closed on 2026-08-05, when the branch that had been
stranded locally finally reached `main` (PR #20). Only three of those closed
themselves: `Closes #N` fires on the number, and one commit wrote "closes the
four actionable open issues" as prose, so #13–#16 had to be closed by hand.
Worth remembering the next time a commit means to close something.
What is below is the older, quieter half
— plus, where a gap is still open as an issue, the issue is the live record and
the bullet here is only its summary.

- **Astro scoped CSS does not reach `innerHTML`-injected DOM.** A component's
  scoped styles are keyed on a `data-astro-cid-*` attribute the compiler stamps
  on markup it emits; nodes built at runtime and inserted with `innerHTML` carry
  no such attribute, so the rules simply do not apply. It fails silently and
  completely — cypruspokerbrisbane shipped unstyled search rows and an entirely
  unstyled `/search` page this way. The fix is `<style is:global>` namespaced
  under a unique class. Not checked: telling a legitimate `innerHTML` from one
  that needed styling means knowing what the injected markup is, which is a
  runtime question. Worth knowing about; not worth a false positive.
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
- ~~**Responsive `srcset`/`sizes`.**~~ Closed by `💡 images: srcset:missing` —
  the practice is § images above. The thresholds that kept it in this list came
  out of a three-build measurement rather than taste; it ships advisory, and
  earns a `🔧` only if a wider sweep shows it staying quiet on correct code.
- **Offline heading scan beyond the canonical gate (see also `headings:order`,
  which now names the component rather than the built page).** Today the offline outline
  check only inspects pages with a `<link rel="canonical">`; a page that should
  be indexable but lacks canonical is invisible to it (the live check still
  covers home + a post).
- **No-negotiation fallback probe (live).** A second `Accept: */*` image probe
  would surface a large raw-source fallback directly; today the offline
  `transform:format` check catches the same `format=webp` smell more cheaply.
- ~~**BreadcrumbList JSON-LD.**~~ Closed by `data: jsonld:breadcrumb` +
  `jsonld:breadcrumb-shape` — the practice is § data above. Presence is house
  style, malformation is universal, and the starter grew a trail to match.
- ~~**Runtime behaviour needs a headless browser.**~~ Closed by the `browser`
  domain — the practice is § browser above.
- **Zaraz consent banner actually renders + GA waits for consent.** The
  `analytics` live check confirms the Zaraz loader is present, but the consent
  modal and whether tags hold until consent are decided by client JS at runtime
  (`zarazConsentAPIReady`, the `cf_consent` cookie) — invisible to a `fetch` of
  the HTML, and never to be faked from static HTML. It *used* to be listed here
  as impossible: the tool ran no browser. The `browser` domain does, so what
  keeps this open is that nobody has written the check, not that it can't be
  written — and whoever does should note that `analytics` is advisory by
  construction (`tools/lib/policy.mjs`), so a consent finding is a `💡` however
  certain the browser is about it.
