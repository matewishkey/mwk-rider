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
  const files = sitemapPageFiles(root);
  return files.size ? new Set(files.values()) : null;
}

/**
 * Sitemap `<loc>` → the built HTML file that serves it, for the entries whose
 * file exists. Same resolution as sitemapPages(), kept as one map because the
 * sitemap checks need the URL alongside the file: "which page is this" and
 * "what did that page declare about itself" are the same question.
 */
export function sitemapPageFiles(root) {
  const out = new Map();
  for (const { loc } of sitemapEntries(root).entries) {
    let pathname;
    try { pathname = new URL(loc).pathname; } catch { continue; }
    if (/\.xml$/i.test(pathname)) continue;    // a sitemap index listing sitemaps
    // Percent-decoded, because that is how the file sits on disk. Astro writes
    // `hu/blog/tag/architektúra/index.html`; the sitemap declares the same URL
    // as `architekt%C3%BAra`, and `new URL().pathname` hands back the encoded
    // form. Comparing the two dropped every non-ASCII URL from the denominator
    // — silently, which is the bad kind: two fixture pages were invisible to
    // every coverage check for as long as the fixture has had Hungarian tags.
    const clean = decodePath(pathname).replace(/^\/+|\/+$/g, '');
    // Astro writes either `about/index.html` or `about.html` depending on
    // build.format; accept whichever exists.
    for (const candidate of clean ? [`${clean}/index.html`, `${clean}.html`] : ['index.html']) {
      if (existsSync(join(distDir(root), candidate))) { out.set(loc, candidate); break; }
    }
  }
  return out;
}

/** A percent-decoded pathname, or the original when it is not valid encoding. */
export function decodePath(pathname) {
  try { return decodeURIComponent(pathname); } catch { return pathname; }
}

/**
 * The built sitemap(s), parsed once: the files, their entries, and their size.
 *
 * Every sitemap check needs some slice of this — the URL list, the <lastmod>
 * values, the hreflang alternates, the uncompressed byte count Google caps at
 * 50 MB — and re-reading the XML per check made each one cheap to write and the
 * set of them quietly quadratic on a large site.
 *
 * `alternates` is the `<xhtml:link rel="alternate">` set @astrojs/sitemap emits
 * for a localized entry, and it is load-bearing rather than informational: it is
 * what tells a deliberate locale consolidation from a page disclaiming the URL
 * the sitemap declares. See `sitemap:canonical` in checks/seo.mjs.
 */
export function sitemapEntries(root) {
  const files = distFiles(root, /sitemap[-a-z0-9]*\.xml$/i);
  const entries = [];
  // Per file, because Google's 50 MB cap is per sitemap, not per site — a total
  // would flag a correctly-split set of small files and miss one oversized one.
  const sizes = new Map();
  for (const file of files) {
    const xml = readDist(root, file);
    sizes.set(file, Buffer.byteLength(xml, 'utf8'));
    for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
      const block = m[1];
      const loc = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1];
      if (!loc) continue;
      entries.push({
        file,
        loc: decodeEntities(loc),
        lastmod: block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1] ?? null,
        changefreq: /<changefreq>/i.test(block),
        priority: /<priority>/i.test(block),
        alternates: [...block.matchAll(/<xhtml:link[^>]+href=["']([^"']+)["']/gi)].map((a) => decodeEntities(a[1])),
      });
    }
  }
  return { files, entries, sizes };
}

// Sitemap values are entity-escaped by the spec, so `?a=1&amp;b=2` is one URL
// written correctly — not a URL containing the five characters `&amp;`.
function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" })[e]);
}
