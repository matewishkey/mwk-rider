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
| `data` | JSON-LD emitted + a BlogPosting/WebSite helper; `/llms.txt` from `getCollection()` with a draft/preview filter; RSS; Zod-validated content schema |
| `live` | Only with `--url`: real Cache-Control, served image bytes, rendered SEO + JSON-LD, `/llms.txt` |
| `lighthouse` | Only with `--url`: measured PageSpeed Insights scores (perf/seo/a11y/best-practices) + Core Web Vitals. Needs a PSI key (see below); skips without one |
| `google` | Only with `--url`: Search Console verified-property + sitemap, a GA4 property/web-stream for the domain, and that measurement ID wired into Zaraz. Needs a Google service-account key (see below); Zaraz leg uses `$CLOUDFLARE_API_TOKEN`; each leg skips independently |

It **assumes the baseline stack is in place** and validates compliance — it does not set anything up.

## Lighthouse key resolution

The `lighthouse` domain calls the PageSpeed Insights API and needs a free key, resolved in order:
1. `$PAGESPEED_API_KEY`
2. sops-decrypt `PAGESPEED_API_KEY` from `$WISHBUSTERZ_RIDER_PSI_SOPS_FILE` (opt-in; unset = skip) — uses `sops` + your age key; `SOPS_AGE_KEY_FILE` defaults to `~/.config/sops/age/keys.txt` if unset

No key, no `sops`, or decrypt failure → the domain `⏭ skips` (everything else still runs). Score → outcome: `≥90 ✅`, `50–89 💡`, `<50 🔧`. Transient PSI `500`s are retried (up to 3×).

## Google (Search Console + Analytics) key resolution

The `google` domain mints a service-account access token (zero-dep RS256 JWT via built-in `crypto`) for the Search Console + GA Admin APIs. The key is resolved in order:
1. `$GOOGLE_SERVICE_ACCOUNT_JSON` — the downloaded key file's JSON, raw or base64
2. `$GOOGLE_APPLICATION_CREDENTIALS` — path to the JSON key file (Google's own convention)
3. sops-decrypt `GOOGLE_SERVICE_ACCOUNT_JSON` from `$WISHBUSTERZ_RIDER_SA_SOPS_FILE` (opt-in; unset = skip)

No key → the Search Console + GA legs `⏭ skip`. The Zaraz leg is independent: it needs `$CLOUDFLARE_API_TOKEN` (Zaraz read + zone read) and resolves the zone from the domain; without it that one leg skips. One-time operator setup: a GCloud project with the Search Console / Site Verification / Analytics Admin APIs enabled and the SA granted read access to your GA account.

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
    reporter.mjs         outcome collection, human/JSON output, exit code
    cf-image.mjs         Cloudflare transform-URL param parsing (shared offline + live)
    html.mjs             dist/served HTML scanning — headings, alt text, content-page gate
    google-auth.mjs      service-account → OAuth access token (zero-dep RS256 JWT)
  checks/
    modules.mjs          baseline stack
    seo.mjs              discoverability meta
    images.mjs           image delivery + sizes (source + dist)
    perf.mjs             cache headers + CLS
    data.mjs             JSON-LD, llms.txt, RSS, content schema
    analytics.mjs        no hardcoded GA/GTM snippet (delivered via Zaraz)
    live.mjs             HTTP checks against a served site (--url)
    lighthouse.mjs       measured PSI scores + Core Web Vitals (--url + key)
    google.mjs           Search Console + GA4 + Zaraz-wiring verification (--url + SA key)
```
