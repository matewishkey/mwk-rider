// dist/ — read the build output. Several checks moved from "is the package
// installed / does the source mention it" to "did the build actually produce
// it", and they all need the same two primitives.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Files under dist/ whose dist-relative path matches, sorted. */
export function distFiles(root, re) {
  const dist = join(root, 'dist');
  if (!existsSync(dist)) return [];
  const out = [];
  const stack = [dist];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (re.test(relative(dist, full))) out.push(relative(dist, full));
    }
  }
  return out.sort();
}

/** Text of a dist-relative file, or '' if it can't be read. */
export function readDist(root, rel) {
  try { return readFileSync(join(root, 'dist', rel), 'utf8'); }
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
        if (existsSync(join(root, 'dist', candidate))) { paths.add(candidate); break; }
      }
    }
  }
  return paths.size ? paths : null;
}
