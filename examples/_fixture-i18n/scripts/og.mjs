#!/usr/bin/env node
/**
 * OG generator stub for _fixture-i18n.
 *
 * The full Playwright-driven generator (per §9.2 + §18.9) is wired in
 * Phase 2 once the localhost review approves the fixture. For now this
 * stub keeps the `npm run og` script defined (per §3 ⚖ check) but does
 * nothing — the dev server review uses the live HTML template page at
 * /preview/og/<locale>/<id> as the visual OG preview, not generated
 * PNGs on disk.
 *
 * To run the real generator in Phase 2:
 *   - Wire Playwright to spawn astro dev
 *   - Fetch /preview/og/list.json (already in place)
 *   - For each (locale, slug): screenshot /preview/og/<locale>/<slug>
 *     and write to public/og/<locale>/<slug>.png
 */
console.log('og.mjs — stub for _fixture-i18n.');
console.log('OG visuals are reviewed live via /preview/og/<locale>/<id>.');
console.log('Phase 2 will wire the full Playwright generator.');
