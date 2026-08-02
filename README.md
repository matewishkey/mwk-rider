# wishbusterz-rider

An on-demand best-practices auditor for **Astro** sites. One slash command (`/td-rider`), one zero-dependency script, nine domains (six offline + three live). No framework, no contract, nothing installed into the sites it audits — it reports, you decide.

```
✅ modules: astro:version — ^7.1.6
🔧 seo: meta:canonical — no <link rel="canonical"> in the SEO component
     fix: emit <link rel="canonical" href={canonicalURL}> from src/components/SEO.astro
💡 seo: heading:outline — /about skips from <h1> to <h3>

38 ✅   1 🔧   0 🛑   1 💡   0 ⏭
audit complete — 1 finding to address (exit 1).
```

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
| **google** | With `--url`: the operator-provisioned Google state no source file shows — the domain is a verified **Search Console** property with a sitemap submitted, a **GA4** property + web data stream exists for it (→ measurement ID), and that ID is wired into the zone's **Zaraz** config. Needs a Google service-account key (below). Verifies, never provisions. |

The static domains answer *"is it wired right?"*; `lighthouse` answers *"what's the real score?"*; `google` answers *"is it registered and measured?"* — complementary layers.

**This tool assumes a specific baseline** (Astro 7+, static output, Cloudflare delivery, Orama search) and validates compliance against it. It does not set anything up or migrate. If your stack differs, the checks are small and readable — fork and adjust.

**The *why* behind every check lives in [`BEST-PRACTICES.md`](BEST-PRACTICES.md)** — a living practice↔check registry. The governing rule: every practice there has an enforcing check, and a practice with no check is a tracked *gap*, not a practice.

## Install

```bash
git clone https://github.com/mergodon/wishbusterz-rider.git
cd wishbusterz-rider && ./install.sh
```

This symlinks the `/td-rider` command and its tools into `~/.claude/`. It installs nothing into any project and never touches a project's `CLAUDE.md`. Re-run `./install.sh` after `git pull` to update.

Requires **Node 22+**. No `npm install` — the tool uses Node built-ins only.

## Use

From inside any Astro project, in [Claude Code](https://claude.com/claude-code):

```
/td-rider                 # offline: source + dist checks
/td-rider https://site    # also check the live/served site
```

Or call the script directly — it's a plain CLI, Claude Code is optional:

```bash
node ~/.claude/td-rider-tools/audit.mjs --help
node ~/.claude/td-rider-tools/audit.mjs                     # everything offline
node ~/.claude/td-rider-tools/audit.mjs -s seo -s images    # scope to domains
node ~/.claude/td-rider-tools/audit.mjs --url https://site  # add live + lighthouse
node ~/.claude/td-rider-tools/audit.mjs --json              # machine-readable
```

`--url` works from **any directory** — the offline domains need an Astro project in the cwd, but a live/lighthouse run only needs the URL.

Outcomes: `✅` pass · `🔧` fixable (required) · `🛑` needs a decision · `💡` optional suggestion · `⏭` skipped. Exit `0` if clean (suggestions don't count), `1` if any required findings, `2` on tooling error — so it drops into CI as-is.

## Optional API keys

Both live-API domains skip gracefully when their key is absent; everything else still runs.

**PageSpeed Insights** (`lighthouse`) — a [free PSI key](https://developers.google.com/speed/docs/insights/v5/get-started), resolved from `$PAGESPEED_API_KEY`, or sops-decrypted from `$TD_RIDER_PSI_SOPS_FILE`. Note that a single Lighthouse run is **noisy** (lab scores swing run-to-run) and the API needs a **publicly reachable** URL.

**Google service account** (`google`) — resolved from `$GOOGLE_SERVICE_ACCOUNT_JSON` (the key JSON, raw or base64), `$GOOGLE_APPLICATION_CREDENTIALS` (path to the key file), or `$TD_RIDER_SA_SOPS_FILE`. One-time setup: a Google Cloud project with the **Search Console**, **Site Verification**, and **Analytics Admin** APIs enabled, and a service account granted read access to your GA account. The Zaraz leg additionally uses `$CLOUDFLARE_API_TOKEN` (Zaraz read + zone read) and skips independently.

The tool only ever *reads* through these APIs. It never provisions, never writes.

## Layout

```
commands/td-rider.md       the slash command (orchestration)
tools/
  audit.mjs                  entry: detect project, run domains, report
  test.mjs                   the gate: fixture + known-bad synthetic projects
  checks/{modules,seo,images,perf,data,analytics,live,lighthouse,google}.mjs
  lib/{project,reporter,cf-image,html,image-size,google-auth}.mjs
examples/_fixture-i18n/      a compliant multi-locale Astro site — the test target
install.sh                   symlink command + tools into ~/.claude
```

## Contributing

Adding a check is a five-step contract, documented in [`BEST-PRACTICES.md`](BEST-PRACTICES.md#how-we-add-a-practice): understand the requirement from the real docs → write down *why* → bake the check → verify it stays quiet on the compliant fixture **and** fires on a known-bad project → ship.

`node tools/test.mjs` is the gate — run it before any commit touching `tools/**`. See [`docs/DEVELOPING.md`](docs/DEVELOPING.md).

## Licence

[MIT](LICENSE).
