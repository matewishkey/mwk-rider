// dist/ — read the build output. Several checks moved from "is the package
// installed / does the source mention it" to "did the build actually produce
// it", and they all need the same two primitives.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Never walked inside the static root.
 *
 * `_worker.js` is the server bundle some adapter versions emit — a DIRECTORY,
 * despite the name — and it contains copies of built assets plus server-side
 * HTML. Walking it double-counts every image, font and stylesheet against a byte
 * budget, and reads pages that are never served as files. Nothing under it
 * reaches a browser as a static asset.
 */
export const SKIP_DIST = new Set(['_worker.js']);

/**
 * Where the *served* files actually are.
 *
 * A fully static build writes them straight to `dist/`. Add an adapter — which
 * one `prerender = false` route is enough to require — and the build splits:
 * `dist/client/` is what a browser gets, `dist/server/` (or `dist/_worker.js/`)
 * is the bundle that runs. Assuming `dist/` is the static root on such a build
 * is wrong in both directions: byte budgets count the server bundle's copy of
 * every asset, and `dist/index.html` is not where the homepage is, so the
 * sitemap denominator silently collapses to "every built page".
 *
 * Resolved once, here, so no walker has to know. Falls back to `dist/` — which
 * is right for every static build, and is what this returned before adapters
 * were part of the baseline.
 */
export function distDir(root) {
  const dist = join(root, 'dist');
  const client = join(dist, 'client');
  // Both halves must be there. A site that merely has a `dist/client/` page
  // route is not an adapter build, and must not have its root moved.
  if (existsSync(client) && (existsSync(join(dist, 'server')) || existsSync(join(dist, '_worker.js')))) {
    return client;
  }
  return dist;
}

/**
 * A path reported relative to the project root (`dist/client/about/index.html`),
 * re-based on the static root (`about/index.html`) so it can be compared with
 * what the sitemap declares.
 */
export function distRelative(root, rel) {
  const prefix = `${relative(root, distDir(root))}/`;
  return rel.startsWith(prefix) ? rel.slice(prefix.length) : rel.replace(/^dist\//, '');
}

/** Files under the static root whose relative path matches, sorted. */
export function distFiles(root, re) {
  const dist = distDir(root);
  if (!existsSync(dist)) return [];
  const out = [];
  const stack = [dist];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIST.has(e.name)) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (re.test(relative(dist, full))) out.push(relative(dist, full));
    }
  }
  return out.sort();
}

/** Text of a file relative to the static root, or '' if it can't be read. */
export function readDist(root, rel) {
  try { return readFileSync(join(distDir(root), rel), 'utf8'); }
  catch { return ''; }
}

export function countMatches(text, re) {
  return (text.match(re) ?? []).length;
}

/**
 * The pages the site itself declares as indexable, as dist-relative HTML paths.
 *
 * Coverage checks need a denominator, and every obvious choice is wrong.
 * "Every HTML file in dist/" counts OG-image templates and component preview
 * routes that legitimately carry no canonical. "Pages that have a canonical" —
 * which is what `isContentPage` means — makes the canonical check measure
 * itself: delete the canonical from 18 of 19 pages and the set shrinks to 1,
 * which then reports 1/1 ✅. Reproduced exactly that way on a dogfood build.
 *
 * The sitemap is the site's own answer to "which pages are you publishing", so
 * it is the honest denominator. Returns null when there is no sitemap, and the
 * caller falls back to every built page.
 */
export function sitemapPages(root) {
  const maps = distFiles(root, /sitemap[-a-z0-9]*\.xml$/i);
  const paths = new Set();
  for (const f of maps) {
    for (const m of readDist(root, f).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      let pathname;
      try { pathname = new URL(m[1]).pathname; } catch { continue; }
      if (/\.xml$/i.test(pathname)) continue;    // a sitemap index listing sitemaps
      const clean = pathname.replace(/^\/+|\/+$/g, '');
      // Astro writes either `about/index.html` or `about.html` depending on
      // build.format; accept whichever exists.
      for (const candidate of clean ? [`${clean}/index.html`, `${clean}.html`] : ['index.html']) {
        if (existsSync(join(distDir(root), candidate))) { paths.add(candidate); break; }
      }
    }
  }
  return paths.size ? paths : null;
}
