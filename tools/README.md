# wishbusterz-rider tools

The engine behind `/wishbusterz-rider`. Detects an Astro project, runs domain checks, reports `✅ / 🔧 / 🛑 / ⏭`, exits non-zero on findings. Zero dependencies — Node 22 built-ins only.

## Usage

```bash
cd ~/projects/<some-astro-site>

node ~/.claude/wishbusterz-rider-tools/audit.mjs            # every offline domain
node ~/.claude/wishbusterz-rider-tools/audit.mjs -s seo -s images   # subset
node ~/.claude/wishbusterz-rider-tools/audit.mjs --url https://site # add live checks
node ~/.claude/wishbusterz-rider-tools/audit.mjs --json     # machine-readable
node ~/.claude/wishbusterz-rider-tools/audit.mjs --quiet    # only findings, no ✅
node ~/.claude/wishbusterz-rider-tools/audit.mjs --help
```

## Domains

| Domain | Checks |
|---|---|
| `modules` | Astro 7+, Node ≥ 22.12, TypeScript ≤ 6.x, baseline integrations, `output: 'static'`, strict TS, `<ClientRouter>`, custom 404, adapter iff `<Image>` under SSR, remotePatterns (if og.config declares a media domain), Astro 7 migration residue (`astro7:experimental`, `astro7:markdown`, `astro7:db`, `astro7:transitions`) |
| `seo` | SEO component emits canonical + OG meta; no `keywords` anti-pattern; sitemap lastmod; brand fields (if og.config present) |
| `images` | `<img>` + CSS `background-image` routed through an image transform; no oversized raster in `src/assets/`; no oversized built image in `dist/` |
| `perf` | `public/_headers` marks `/_astro/*` immutable; content `<img>` carry width/height (CLS) |
| `analytics` | Flags a hardcoded Google Analytics / GTM snippet in `src/` + `dist/`; the positive "Zaraz loader present" check is live-only |
| `data` | JSON-LD emitted + a BlogPosting/WebSite helper; `/llms.txt` from `getCollection()` with a draft/preview filter; RSS; Zod-validated content schema |
| `live` | Only with `--url`: real Cache-Control, served image bytes, rendered SEO + JSON-LD, `/llms.txt` |
| `lighthouse` | Only with `--url`: measured PageSpeed Insights scores (perf/seo/a11y/best-practices) + Core Web Vitals. Needs a PSI key (see below); skips without one |

It **assumes the baseline stack is in place** and validates compliance — it does not set anything up.

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
    cf-image.mjs         Cloudflare transform-URL param parsing (shared offline + live)
    html.mjs             dist/served HTML scanning — headings, alt text, content-page gate
  checks/
    modules.mjs          baseline stack
    seo.mjs              discoverability meta
    images.mjs           image delivery + sizes (source + dist)
    perf.mjs             cache headers + CLS
    data.mjs             JSON-LD, llms.txt, RSS, content schema
    analytics.mjs        no hardcoded GA/GTM snippet (delivered via Zaraz)
    live.mjs             HTTP checks against a served site (--url)
    lighthouse.mjs       measured PSI scores + Core Web Vitals (--url + key)
```
