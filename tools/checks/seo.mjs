// seo — the discoverability surface: a canonical SEO component emitting
// canonical URL, OG meta, and the brand fields they need.
// (Structured data / JSON-LD / llms.txt live in the data check.)

import { eachDistHtml, isContentPage, headingOutline, headingAudit } from '../lib/html.mjs';
import { readSrcFiles, headMetaFiles } from '../lib/src-scan.mjs';
import { distFiles, readDist, countMatches, sitemapPages, distRelative } from '../lib/dist.mjs';

const SEC = 'seo';

// A tag counts as emitted only when it appears as a real attribute —
// `property="og:image"`, never the bare word. Matching bare substrings meant a
// line of prose satisfied the check: a component containing nothing but
// `// TODO: emit og:image, og:type and rel="canonical"` passed six checks at
// once. Comments are blanked before matching too (see lib/src-scan.mjs), so
// both halves of that failure are closed.
const metaRe = (key) => new RegExp(`(?:property|name)\\s*=\\s*["']${key}["']`, 'i');
const CANONICAL_RE = /rel\s*=\s*["']canonical["']/i;
// The fourth field is severity when the tag is absent. og:image:width/height
// are a layout hint — a card renders fine without them, platforms just can't
// reserve space before fetching it. Two well-built dogfood sites had exactly
// these two as their ONLY required finding, which is the signal that the
// severity was wrong rather than the sites.
const META_TAGS = [
  ['og:image',        metaRe('og:image'),        'fix'],
  ['og:image:width',  metaRe('og:image:width'),  'suggest'],
  ['og:image:height', metaRe('og:image:height'), 'suggest'],
  ['og:type',         metaRe('og:type'),         'fix'],
  ['og:url',          metaRe('og:url'),          'fix'],
  ['canonical',       CANONICAL_RE,              'fix'],
];

export async function run({ project, reporter }) {
  // The head-meta surface, found by behaviour rather than filename. A site may
  // put this in SEO.astro, BaseHead.astro, or straight into a layout — all are
  // correct, so search every source file and report against the union.
  const srcFiles = readSrcFiles(project.root);
  const headFiles = headMetaFiles(srcFiles);
  const head = headFiles.map((f) => f.code).join('\n');

  if (headFiles.length === 0) {
    reporter.fix(SEC, 'SEO component', 'no source file emits head metadata (canonical, OG tags or <title>)', 'add an SEO/head component that every page renders in <head>');
  } else {
    reporter.pass(SEC, 'SEO component', headFiles.map((f) => f.path).join(', '));
  }

  // Individual tags run whether or not a dedicated component exists — an absent
  // component must not silently skip them.
  checkMetaTags(project, reporter, head, headFiles.map((f) => f.path));

  // Anti-pattern: <meta name="keywords"> (ignored by search engines, signals spam)
  const kw = srcFiles.find((f) => /name=["']keywords["']/.test(f.code));
  if (kw) reporter.fix(SEC, 'no-keywords', `<meta name="keywords"> in ${kw.path} (anti-pattern)`, 'remove the keywords meta');
  else    reporter.pass(SEC, 'no-keywords', `not emitted by any of the ${srcFiles.length} source file(s) under src/`);

  // Brand fields (only checkable when scripts/og.config.mjs declares them)
  const brand = project.ogConfig?.brand ?? project.ogConfig;
  if (brand) {
    const required = ['siteName', 'siteUrl', 'tagline'];
    for (const k of required) {
      // The value, not a bare tick: these render straight into head meta, so
      // "set" and "set to something sensible" are different verdicts and only
      // the reader can tell them apart.
      if (brand[k]) reporter.pass(SEC, `brand.${k}`, truncate(String(brand[k]), 60));
      else          reporter.fix(SEC, `brand.${k}`, 'missing (used by SEO meta)', `set brand.${k} in scripts/og.config.mjs`);
    }
    const optional = ['authorName', 'authorUrl', 'twitterSite', 'twitterCreator'];
    const missing = optional.filter((k) => !brand[k]);
    if (missing.length) reporter.suggest(SEC, 'brand:optional', `missing: ${missing.join(', ')}`, 'set for richer SEO/social cards (optional)');
    else reporter.pass(SEC, 'brand:optional', `all set: ${optional.join(', ')}`);
  }

  checkRobots(project, reporter);
  checkSitemap(project, reporter);

  // Heading outline on built content pages: exactly one <h1>, no skipped levels.
  // Scoped to pages with a canonical link, so OG-template / preview routes (no
  // canonical) don't get flagged for legitimately having no <h1>.
  if (project.hasDist) checkHeadings(project, reporter, srcFiles);
}

/**
 * Are the head tags actually emitted? Assert against `dist/` when it exists —
 * that is the artifact that ships, and it contains no comments, no unreachable
 * branches and no aspirational TODOs. Source is the fallback for an unbuilt
 * project, and is matched comment-blanked.
 *
 * Coverage, not mere presence. "Emitted anywhere in the build" passed a site
 * that had a canonical on one page out of nineteen. Every tag is now judged
 * across the site's declared pages: all → pass, none → fix, some → suggest,
 * naming the pages that omit it.
 */
function checkMetaTags(project, reporter, headSrc, headFilePaths = []) {
  const all = [];
  if (project.hasDist) eachDistHtml(project.root, (rel, html) => all.push({ rel, html }));

  // The denominator is the sitemap when there is one — the site's own list of
  // what it publishes. Falling back to "every built page" counts OG templates
  // and preview routes; using "pages that have a canonical" made the canonical
  // check measure itself.
  const declared = project.hasDist ? sitemapPages(project.root) : null;
  const pages = declared
    ? all.filter((p) => declared.has(distRelative(project.root, p.rel)))
    : all;
  const denominator = declared ? 'sitemap page(s)' : 'built page(s)';

  // Name the file rather than "the component that renders <head>": the same run
  // already identified it, and making the reader go and find it again is work
  // the tool could have done.
  const where2 = headFilePaths.length ? ` (${headFilePaths.join(', ')})` : '';
  const emitFrom = `emit it from the component that renders <head>${where2}`;

  if (all.length === 0) {
    const where = project.hasDist ? 'dist/ has no HTML' : 'no dist/';
    for (const [name, re, severity] of META_TAGS) {
      if (re.test(headSrc)) reporter.pass(SEC, `meta:${name}`, `emitted in src/ (${where} — build to check the shipped HTML)`);
      else reporter[severity](SEC, `meta:${name}`, `tag not emitted anywhere in src/ (${where}, so source is all there is to read)`, emitFrom);
    }
    return;
  }

  const judged = pages.length ? pages : all;
  for (const [name, re, severity] of META_TAGS) {
    const missing = judged.filter((p) => !re.test(p.html));
    if (missing.length === judged.length) {
      reporter[severity](SEC, `meta:${name}`, `not emitted on any of the ${judged.length} ${denominator}`, emitFrom);
    } else if (missing.length === 0) {
      reporter.pass(SEC, `meta:${name}`, `on all ${judged.length} ${denominator}`);
    } else {
      // Partial coverage is the interesting case and used to be invisible: a
      // tag on one page out of nineteen read as ✅.
      reporter.suggest(SEC, `meta:${name}`, `${missing.length}/${judged.length} ${denominator} omit it — ${sampleOf(missing.map((p) => p.rel))}`, `emit ${name} on every published page, not just some`);
    }
  }

  checkCanonicalValues(reporter, judged, denominator);
}

/**
 * A canonical link is only doing its job if it differs per page.
 *
 * Presence alone passed a site where twenty pages all declared the same
 * canonical URL — which tells a crawler nineteen of them are duplicates of the
 * twentieth and should be dropped from the index. That is strictly worse than
 * having no canonical at all, and it read as ✅.
 *
 * Only a value covering MORE THAN HALF the pages is reported, and only as
 * advice. Sharing a canonical across a few pages is a legitimate, deliberate
 * thing to do — the bundled i18n fixture does it, because a locale fallback
 * rewrite serves the default locale's content and *is* a duplicate of it. A
 * site-wide constant is the failure; a handful of intentional duplicates is not.
 */
function checkCanonicalValues(reporter, pages, denominator) {
  const byValue = new Map();
  for (const p of pages) {
    const href = p.html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/)?.[1];
    if (!href) continue;
    if (!byValue.has(href)) byValue.set(href, []);
    byValue.get(href).push(p.rel);
  }
  if (byValue.size < 2 && pages.length < 2) return;   // nothing to compare
  // No page carries a canonical at all. `meta:canonical` reports that; what this
  // must not do is print "✅ 0 distinct canonical URL(s)" underneath it, which is
  // a green tick for a comparison that had nothing to compare — the pass-for-work-
  // never-done that CONTRIBUTING § "never let a check silently not run" forbids.
  if (byValue.size === 0) {
    reporter.skip(SEC, 'canonical:unique', `none of the ${pages.length} ${denominator} declares a canonical URL — nothing to compare (see seo: meta:canonical)`);
    return;
  }
  const worst = [...byValue.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (worst[1].length * 2 <= pages.length) {
    reporter.pass(SEC, 'canonical:unique', `${byValue.size} distinct canonical URL(s) across ${pages.length} ${denominator}`);
    return;
  }
  reporter.suggest(SEC, 'canonical:unique', `${worst[1].length} of ${pages.length} pages declare the SAME canonical URL (${worst[0]}) — that asks crawlers to drop ${worst[1].length - 1} of them as duplicates: ${sampleOf(worst[1])}`, "compute the canonical from each page's own URL rather than a site-wide constant (unless these really are deliberate duplicates, e.g. locale fallbacks)");
}

/**
 * robots.txt — the file, not the package that might have written it.
 *
 * This was `modules:dep:astro-robots-txt`: a required finding for anyone who
 * hadn't installed one specific integration. All five dogfood sites shipped a
 * correct robots.txt without it — three as a generated endpoint, which is
 * *better* than the package and would collide with it. What matters is that the
 * built site serves one and that it points crawlers at the sitemap.
 */
function checkRobots(project, reporter) {
  if (!project.hasDist) {
    reporter.skip(SEC, 'robots', 'no dist/ — build the site to check it serves a robots.txt with a Sitemap: line');
    return;
  }
  const text = readDist(project.root, 'robots.txt');
  if (!text.trim()) {
    reporter.fix(SEC, 'robots', 'dist/robots.txt is missing or empty', 'ship a robots.txt — a src/pages/robots.txt.ts endpoint, a public/robots.txt, or the astro-robots-txt integration', { file: 'dist/robots.txt' });
    return;
  }
  if (!/^\s*Sitemap:\s*\S+/im.test(text)) {
    reporter.fix(SEC, 'robots', 'dist/robots.txt has no Sitemap: line — crawlers are not pointed at the sitemap', 'add "Sitemap: https://<site>/sitemap-index.xml"', { file: 'dist/robots.txt' });
    return;
  }
  reporter.pass(SEC, 'robots', 'served with a Sitemap: line', { file: 'dist/robots.txt' });
}

/**
 * Sitemap lastmod — read the built XML.
 *
 * The old check inferred it from astro.config: "@astrojs/sitemap is configured"
 * passed. Two dogfood sites shipped sitemaps with zero <lastmod> and passed.
 * @astrojs/sitemap emits lastmod only when a serialize() supplies it, so the
 * config's presence proves nothing about the file.
 */
function checkSitemap(project, reporter) {
  if (!project.hasDist) {
    reporter.skip(SEC, 'sitemap:lastmod', 'no dist/ — build the site to check <lastmod> in the sitemap');
    return;
  }
  // Index files list other sitemaps and legitimately carry no <url>.
  const maps = distFiles(project.root, /sitemap[-a-z0-9]*\.xml$/i)
    .filter((f) => countMatches(readDist(project.root, f), /<url>/gi) > 0);
  if (maps.length === 0) {
    reporter.fix(SEC, 'sitemap:lastmod', 'no sitemap with <url> entries in dist/', 'add @astrojs/sitemap (or an endpoint that emits one) so search engines get a full URL list');
    return;
  }
  let urls = 0, lastmods = 0;
  for (const f of maps) {
    const xml = readDist(project.root, f);
    urls += countMatches(xml, /<url>/gi);
    lastmods += countMatches(xml, /<lastmod>/gi);
  }
  if (lastmods >= urls) {
    reporter.pass(SEC, 'sitemap:lastmod', `${lastmods}/${urls} entries carry <lastmod> (${maps.join(', ')})`);
  } else {
    reporter.suggest(SEC, 'sitemap:lastmod', `${lastmods}/${urls} sitemap entries carry <lastmod> (${maps.join(', ')})`, 'set item.lastmod in @astrojs/sitemap\'s serialize(item) hook, from whichever date field your own frontmatter uses. If you already have a serialize(), it is not reaching these URLs — the callback receives only { url, changefreq, lastmod, priority, links }, so a per-page date has to be looked up by URL');
  }
}

function checkHeadings(project, reporter, srcFiles) {
  const h1bad = [], skipbad = [];
  let pages = 0;
  eachDistHtml(project.root, (rel, html) => {
    if (!isContentPage(html)) return;
    pages++;
    const outline = headingOutline(html);
    const a = headingAudit(outline.map((h) => h.level));
    if (a.h1) h1bad.push(`${rel} (${a.h1})`);
    if (a.skip) {
      // The built page is where it showed up; the component is where it was
      // written, and that is what someone has to edit.
      const offender = outline[a.skipAt];
      const source = offender ? traceHeadingToSource(srcFiles, offender) : null;
      skipbad.push(source
        ? `${source} (${a.skip}, at "${truncate(offender.text, 40)}") — via ${rel}`
        : `${rel} (${a.skip}${offender?.text ? `, at "${truncate(offender.text, 40)}"` : ''})`);
    }
  });

  if (pages === 0) {
    reporter.skip(SEC, 'headings', 'no built content pages (with canonical) in dist/ — nothing to check');
    return;
  }

  // Exactly one <h1> — required.
  if (h1bad.length === 0) {
    reporter.pass(SEC, 'headings:h1', `${pages} content page(s) have exactly one <h1>`);
  } else {
    reporter.fix(SEC, 'headings:h1', `${h1bad.length}/${pages} content page(s) — ${sampleOf(h1bad)}`, 'exactly one <h1> per page (the page title)');
  }

  // No skipped levels — advisory (often a shared header/footer heading level).
  if (skipbad.length === 0) {
    reporter.pass(SEC, 'headings:order', 'no skipped heading levels');
  } else {
    reporter.suggest(SEC, 'headings:order', `${skipbad.length}/${pages} content page(s) skip a heading level — ${sampleOf(skipbad)}`, 'keep the outline sequential (h2→h3→h4); a shared header/footer using a deeper level is the usual cause');
  }
}

/**
 * The source file and line that emitted a built heading, or null.
 *
 * `null` is the common and correct answer: a heading rendered from frontmatter
 * (`<h2>{title}</h2>`) has no literal text to find. A confidently wrong pointer
 * is worse than the artifact path, so this returns a location only when
 * **exactly one** source matches — several matches, or none, and the caller
 * keeps reporting the built page.
 */
function traceHeadingToSource(srcFiles, { level, text }) {
  if (!text || text.length < 4) return null;
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The tag, then any inline wrappers (a link, an anchor icon), then the text.
  const tag = new RegExp(`<h${level}\\b[^>]*>\\s*(?:<[^>]+>\\s*)*${escaped}`, 'i');
  // …or the markdown that compiles to it.
  const md = new RegExp(`^\\s{0,3}#{${level}}\\s+${escaped}\\s*$`, 'im');

  const hits = [];
  for (const f of srcFiles) {
    const body = f.code ?? f.text;
    const m = tag.exec(body) ?? md.exec(body);
    if (m) hits.push(`${f.path}:${body.slice(0, m.index).split('\n').length}`);
    if (hits.length > 1) return null;   // ambiguous — say less, not more
  }
  return hits.length === 1 ? hits[0] : null;
}

function sampleOf(list, n = 3) {
  return list.slice(0, n).join('; ') + (list.length > n ? ' …' : '');
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
