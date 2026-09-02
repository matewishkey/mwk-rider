// public/_headers — the Cloudflare Pages / Netlify rules file, parsed once.
//
// Two checks read it, from opposite directions. The offline `perf:_headers*`
// asks whether the file declares hashed assets immutable. The live
// `perf:cache:_astro` asks what a server actually returned — and needs the file
// to tell "this site's caching is broken" from "this server ignores the file",
// which is the difference between a real finding and a guaranteed one.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The hashed-asset rule, as written by any of the common conventions:
// `/_astro/*`, a renamed build.assets dir, or the full-URL Pages rule form.
const IMMUTABLE_PATH_RE = /(?:^|\/)_astro\/\*$/;
const ASSET_DIR_RE = /\/(?:_astro|assets|chunks|_?build)\/\*/;

export const MIN_IMMUTABLE_MAXAGE = 86400;
export const CANONICAL_MAXAGE = 31536000;

export function parseHeaders(text) {
  const blocks = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { path: line.trim(), headers: {} };
      blocks.push(current);
    } else if (current) {
      const idx = line.indexOf(':');
      if (idx > 0) current.headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
  }
  return blocks;
}

/** The /_astro/* block of a project's public/_headers, or null if there is none. */
export function astroBlock(root) {
  const path = join(root, 'public', '_headers');
  if (!existsSync(path)) return null;
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return null; }
  const blocks = parseHeaders(raw);
  // Exact-string matching missed correct configs: a site that renamed the asset
  // dir (build.assets) or wrote the full-URL Cloudflare Pages rule form was told
  // it had no rule at all. Match the hashed-asset directory however it's spelled.
  return blocks.find((b) => IMMUTABLE_PATH_RE.test(b.path))
      ?? blocks.find((b) => ASSET_DIR_RE.test(b.path))
      ?? null;
}

/** Does a Cache-Control value mark an asset immutable for long enough? */
export function isImmutable(cc) {
  const value = String(cc ?? '');
  return /\bimmutable\b/.test(value) && Number(value.match(/max-age=(\d+)/)?.[1] ?? 0) >= MIN_IMMUTABLE_MAXAGE;
}

/**
 * Does the project's own `_headers` already declare hashed assets immutable?
 *
 * When it does and a *local* server still serves them `no-cache`, the server is
 * ignoring the file — which is what `astro dev` and `astro preview` do, measured.
 * That makes the live finding guaranteed and unactionable, so it is skipped
 * rather than explained. `wrangler dev` of the same build applies the file
 * (measured: `public, max-age=31536000, immutable`), so it still gets judged.
 */
export function declaresImmutableAssets(root) {
  return isImmutable(astroBlock(root)?.headers['cache-control']);
}
