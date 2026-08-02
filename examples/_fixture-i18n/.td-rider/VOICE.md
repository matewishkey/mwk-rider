# Voice (fixture stub)

This is the multi-locale fixture for the td-rider framework — a test bed, not a real publication. There is no voice to follow: posts are written to exercise contract patterns at depth, not to communicate ideas.

This file exists so that `td-rider check` (and any future tooling that gates on `.td-rider/` presence) treats the fixture as a managed-site shape.

## Images

Inline + hero images are not used in fixture posts. OG generation runs in **fixture mode** — `og.config.mjs` sets `mediaDomain: null` and OGs land in `public/og/<locale>/<slug>.png` rather than R2.

## Translation

Locales: `en` (default at `/`) + `hu` (at `/hu/`). Paired translations share `translationKey:`. Locale-only posts (`en/standalone.md`, `hu/csak-magyar.md`) deliberately omit `translationKey:` to exercise the "no peer" path in `SEO.astro` hreflang generation.
