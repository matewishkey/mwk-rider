// JSON-LD — read the structured data a page actually emits.
//
// Checking for the literal string "BlogPosting" in a helper file answered the
// wrong question twice over: it asked whether a *source file we named* mentions
// a type, not whether the shipped page carries one. Five independently built
// sites all emitted rich, valid JSON-LD and all five were told they had none —
// they wrote the helper somewhere else, or inlined it, or chose Article over
// BlogPosting. Parse the page instead.

// Schema.org types that mean "this page is an article". A site is not wrong for
// choosing Article, TechArticle or the CreativeWork superclass over BlogPosting;
// all of them earn the same rich results.
export const ARTICLE_TYPES = new Set([
  'Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'ScholarlyArticle',
  'LiveBlogPosting', 'Report', 'CreativeWork',
]);

/**
 * Every JSON-LD object in an HTML document, flattened.
 *
 * Unwraps the two nestings publishers actually use — a top-level array of
 * objects, and the `@graph` container — so a type nested inside either is found.
 * A block that doesn't parse is skipped rather than failing the audit: the point
 * is to report what IS there, and `jsonld:parses` reports the broken ones.
 */
export function collectJsonLd(html) {
  const objects = [], broken = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = m[1].trim();
    if (!raw) continue;
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { broken.push(raw.slice(0, 80)); continue; }
    for (const o of flatten(parsed)) objects.push(o);
  }
  return { objects, broken };
}

function flatten(node, out = []) {
  if (Array.isArray(node)) { for (const n of node) flatten(n, out); return out; }
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  if (node['@graph']) flatten(node['@graph'], out);
  return out;
}

/** Every @type in a set of JSON-LD objects (a node may declare several). */
export function ldTypes(objects) {
  const types = new Set();
  for (const o of objects) {
    const t = o['@type'];
    if (typeof t === 'string') types.add(t);
    else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') types.add(x);
  }
  return types;
}

export function hasArticleType(types) {
  for (const t of types) if (ARTICLE_TYPES.has(t)) return true;
  return false;
}
