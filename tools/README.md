# wishbusterz-rider tools

The engine behind `/wishbusterz-rider`. Detects an Astro project, runs domain checks, reports `✅ / 🔧 / 🛑 / ⏭`, exits non-zero on findings. Zero dependencies — Node 22 built-ins only.

## Usage

```bash
cd ~/projects/<some-astro-site>

node ~/.claude/wishbusterz-rider-tools/audit.mjs            # every offline domain
node ~/.claude/wishbusterz-rider-tools/audit.mjs -s seo -s images   # subset
node ~/.claude/wishbusterz-rider-tools/audit.mjs --url https://example.com # add live checks
node ~/.claude/wishbusterz-rider-tools/audit.mjs --url … --post /wiki/x     # audit that page, not a discovered one
node ~/.claude/wishbusterz-rider-tools/audit.mjs --url … --strategy desktop # Lighthouse on desktop (default: mobile)
node ~/.claude/wishbusterz-rider-tools/audit.mjs --strict    # require the house-style baseline too
node ~/.claude/wishbusterz-rider-tools/audit.mjs --json     # machine-readable
node ~/.claude/wishbusterz-rider-tools/audit.mjs --quiet    # hide ✅ lines; findings, 💡 and ⏭ still print
node ~/.claude/wishbusterz-rider-tools/audit.mjs --help
```

## Domains

| Domain | Checks |
|---|---|
| `modules` | Astro 7+, Node ≥ 22.12, TypeScript ≤ 6.x, baseline integrations, `output: 'static'`, strict TS, `<ClientRouter>`, custom 404, adapter iff `<Image>` under SSR, remotePatterns (if og.config declares a media domain), Astro 7 migration residue (`astro7:experimental`, `astro7:markdown`, `astro7:db`, `astro7:transitions`) |
| `seo` | Head meta emitted (asserted against `dist/` when built, source otherwise); no `keywords` anti-pattern; `dist/robots.txt` with a `Sitemap:` line; `<lastmod>` in the built sitemap; one `<h1>` per content page; brand fields (if og.config present) |
| `images` | `<img>` + CSS `background-image` routed through an image transform; no oversized raster in `src/assets/`; no oversized built image in `dist/` |
| `perf` | `public/_headers` marks `/_astro/*` immutable; content `<img>` carry width/height (CLS); render-blocking CSS on the heaviest page and total webfont weight stay inside budget; woff2 not ttf/otf |
| `content` | A media-kit page (logo, paste-ready boilerplate, a contact route) and a design/styleguide page that renders the real tokens. Both house style — `💡` unless `--strict` |
| `analytics` | Flags a hardcoded Google Analytics / GTM snippet in `src/` + `dist/`; the positive "Zaraz loader present" check is live-only |
| `data` | JSON-LD parsed out of `dist/` (an Article-family type + `WebSite`, and it must be valid JSON); `/llms.txt` from `getCollection()` with a draft/preview filter; the built RSS feed has items; Zod-validated content schema |
| `live` | Only with `--url`: real Cache-Control, served image bytes, rendered SEO + JSON-LD, `/llms.txt`. The content page is discovered from the sitemap → homepage links → `/llms.txt`, or forced with `--post` |
| `lighthouse` | Only with `--url`: measured PageSpeed Insights scores (perf/seo/a11y/best-practices) + Core Web Vitals. Needs a PSI key (see below); skips without one |
| `browser` | Only with `--url`: what a real browser sees — uncaught JS errors, failed/404 sub-requests, measured CLS, images far larger than their rendered box, heavy third-party origins. Needs `playwright` installed; skips cleanly without it |

It **assumes a baseline stack** and validates compliance — it does not set anything up.

"The baseline" throughout these docs means: Astro 7+, `output: 'static'`, Cloudflare
delivery (Image Transformations, immutable hashed assets), Orama client-side search,
analytics via Cloudflare Zaraz. Checks that only make sense on that stack report as
`💡 [baseline]` by default and are required only under `--strict` — so a site built
differently still gets useful answers. See `../BEST-PRACTICES.md`.

## Lighthouse key resolution

The `lighthouse` domain calls the PageSpeed Insights API and needs a free key, resolved in order:
Set `$PAGESPEED_API_KEY`.

No key → the domain `⏭ skips` (everything else still runs). Score → outcome: `≥90 ✅`, `50–89 💡`, `<50 🔧`. Transient PSI `500`s get up to 3 attempts (2 retries).


## Outcomes

```
✅  pass      compliant
🔧  fix       mechanically fixable (required)
🛑  block     needs a decision (required)
💡  suggest   optional / nice-to-have (advisory)
⏭   skip      not run / not testable here
```

Exit: `0` clean (💡 suggestions don't count) · `1` findings (🔧/🛑) · `2` tooling error.

## Files

```
tools/
  audit.mjs              entry — arg parsing, project detection, domain dispatch
  lib/
    project.mjs          cwd → Astro-project detection + config/source loading
    policy.mjs           universal vs house-style classification (drives --strict)
    image-size.mjs       PNG/JPEG intrinsic dimensions from raw bytes
    src-scan.mjs         read src/ once; find head-meta by behaviour, not filename
    reporter.mjs         outcome collection, human/JSON output, exit code
    rules.mjs            the rule catalogue behind --rules --json
    untrusted.mjs        fence bytes fetched from an audited site before printing
    cf-image.mjs         Cloudflare transform-URL param parsing (shared offline + live)
    html.mjs             dist/served HTML scanning — headings, alt text, content-page gate
    dist.mjs             read the build output (find + read files under dist/)
    jsonld.mjs           parse the JSON-LD a page emits; Article-family types
  checks/
    modules.mjs          baseline stack
    seo.mjs              discoverability meta
    images.mjs           image delivery + sizes (source + dist)
    perf.mjs             cache headers + CLS
    data.mjs             JSON-LD, llms.txt, RSS, content schema
    content.mjs          media-kit + design reference pages
    analytics.mjs        no hardcoded GA/GTM snippet (delivered via Zaraz)
    live.mjs             HTTP checks against a served site (--url)
    lighthouse.mjs       measured PSI scores + Core Web Vitals (--url + key)
    browser.mjs          real-Chromium runtime checks (--url + playwright)
```
