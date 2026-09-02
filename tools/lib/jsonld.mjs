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

/**
 * Page types that describe a page's content without being articles.
 *
 * A glossary entry is a `DefinedTerm`; an FAQ is an `FAQPage`; a recipe is a
 * `Recipe`. Each is the *correct* markup for that page, and rewriting it as an
 * Article would make the page worse. Reporting one as a missing Article is the
 * check assuming every content page wants to be a blog post — reported by
 * matewishkey-web, whose `/glossary/*` pages were flagged while their project
 * and update pages carried BlogPosting all along.
 *
 * Deliberately excludes the generic wrappers — `WebPage`, `WebSite`,
 * `BreadcrumbList`, `Organization`, `SearchAction`. Those say nothing about what
 * the page *is*, so accepting them would turn this check into "has any JSON-LD",
 * which `jsonld:emitted` already answers.
 */
export const CONTENT_PAGE_TYPES = new Set([
  'DefinedTerm', 'DefinedTermSet', 'FAQPage', 'QAPage', 'HowTo', 'Recipe',
  'Event', 'Product', 'Course', 'JobPosting', 'VideoObject', 'PodcastEpisode',
  'SoftwareApplication', 'Book', 'Review', 'Dataset',
]);

/**
 * How this page describes itself: an article, another legitimate content type,
 * or nothing that says what it is.
 *
 * Returns `{ kind: 'article' | 'content' | 'none', type }`.
 */
export function classifyPage(types) {
  for (const t of types) if (ARTICLE_TYPES.has(t)) return { kind: 'article', type: t };
  for (const t of types) if (CONTENT_PAGE_TYPES.has(t)) return { kind: 'content', type: t };
  return { kind: 'none', type: null };
}
