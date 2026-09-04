// seo — the discoverability surface: a canonical SEO component emitting
// canonical URL, OG meta, and the brand fields they need.
// (Structured data / JSON-LD / llms.txt live in the data check.)

import { eachDistHtml, isContentPage, headingOutline, headingAudit } from '../lib/html.mjs';
import { readSrcFiles, headMetaFiles } from '../lib/src-scan.mjs';
import { distFiles, readDist, sitemapPages, sitemapPageFiles, sitemapEntries, decodePath, distRelative } from '../lib/dist.mjs';

const SEC = 'seo';

// A tag counts as emitted only when it appears as a real attribute —
// `property="og:image"`, never the bare word. Matching bare substrings meant a
// line of prose satisfied the check: a component containing nothing but
// `// TODO: emit og:image, og:type and rel="canonical"` passed six checks at
// once. Comments are blanked before matching too (see lib/src-scan.mjs), so
// both halves of that failure are closed.
const metaRe = (key) => new RegExp(`(?:property|name)\\s*=\\s*["']${key}["']`, 'i');
// The shipped-HTML twin: the tag must also carry a non-empty `content`. In
// source, `content={description}` is the correct and only possible spelling, so
// presence is all that can be asked there — but a built page whose meta
// description rendered as `content=""` has the tag and none of the value, and
// reading that as ✅ is how an empty <title> shipped on every page of a site
// while the audit said the head surface was complete. Lookaheads rather than a
// fixed attribute order: `<meta content="…" name="description">` is equally
// valid HTML and Astro's compressHTML has reordered attributes before.
// The closing quote is part of the pattern, and that is the whole subtlety:
// `content=""` against `content\\s*=\\s*["'][^"']*\\S` MATCHES, because `\\S` is
// happy to be the closing quote itself. An empty description read as ✅ until
// the value had to be bounded on both sides.
const metaFilled = (key) => new RegExp(
  `<meta(?=[^>]*\\b(?:property|name)\\s*=\\s*["']${key}["'])`
  + `(?=[^>]*\\bcontent\\s*=\\s*(?:"[^"]*\\S[^"]*"|'[^']*\\S[^']*'))[^>]*>`, 'i');
const CANONICAL_RE = /rel\s*=\s*["']canonical["']/i;
// [name, source matcher, built-HTML matcher, severity when absent].
//
// og:image:width/height are a layout hint — a card renders fine without them,
// platforms just can't reserve space before fetching it. Two well-built dogfood
// sites had exactly these two as their ONLY required finding, which is the
// signal that the severity was wrong rather than the sites.
//
// title/description/og:title were live-only until 2026-09-04, which meant the
// DEFAULT (offline) audit never checked them at all: a site could ship every
// page with an empty <title> and no description, pass `seo` clean, and hear
// about it only from whoever remembered to pass --url. They are the three tags
// a search result is literally made of, so they are judged over the same
// sitemap denominator as the rest.
const META_TAGS = [
  ['title',           /<title[\s>]/i,           /<title>[^<]*\S[^<]*<\/title>/i, 'fix'],
  ['description',     metaRe('description'),    metaFilled('description'),      'fix'],
  ['og:title',        metaRe('og:title'),       metaFilled('og:title'),         'fix'],
  ['og:image',        metaRe('og:image'),       null,                           'fix'],
  ['og:image:width',  metaRe('og:image:width'), null,                           'suggest'],
  ['og:image:height', metaRe('og:image:height'),null,                           'suggest'],
  ['og:type',         metaRe('og:type'),        null,                           'fix'],
  ['og:url',          metaRe('og:url'),         null,                           'fix'],
  ['canonical',       CANONICAL_RE,             null,                           'fix'],
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
  checkHreflang(project, reporter);

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
    for (const [name, re, , severity] of META_TAGS) {
      if (re.test(headSrc)) reporter.pass(SEC, `meta:${name}`, `emitted in src/ (${where} — build to check the shipped HTML)`);
      else reporter[severity](SEC, `meta:${name}`, `tag not emitted anywhere in src/ (${where}, so source is all there is to read)`, emitFrom);
    }
    return;
  }

  const judged = pages.length ? pages : all;
  for (const [name, srcRe, distRe, severity] of META_TAGS) {
    const re = distRe ?? srcRe;
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
 *
 * The `Sitemap:` value is checked as a URL, not as a non-empty string. The spec
 * requires an absolute one, and a relative `Sitemap: /sitemap-index.xml` is the
 * mistake that looks most correct — every other line in the file is a path.
 */
function checkRobots(project, reporter) {
  if (!project.hasDist) {
    reporter.skip(SEC, 'robots', 'no dist/ — build the site to check it serves a robots.txt with a Sitemap: line');
    return;
  }
  const text = readDist(project.root, 'robots.txt');
  if (!text.trim()) {
    // No third-party integration named here. Both platform primitives do the
    // job, and this tool does not send anyone shopping (BEST-PRACTICES.md,
    // "Own it before you buy it").
    reporter.fix(SEC, 'robots', 'dist/robots.txt is missing or empty', 'ship a robots.txt — a src/pages/robots.txt.ts endpoint that emits the Sitemap: line from `site`, or a static public/robots.txt', { file: 'dist/robots.txt' });
    return;
  }
  const line = text.match(/^\s*Sitemap:\s*(\S+)/im);
  if (!line) {
    reporter.fix(SEC, 'robots', 'dist/robots.txt has no Sitemap: line — crawlers are not pointed at the sitemap', 'add "Sitemap: https://<site>/sitemap-index.xml"', { file: 'dist/robots.txt' });
    return;
  }
  let target;
  try { target = new URL(line[1]); } catch {
    reporter.fix(SEC, 'robots', `dist/robots.txt declares a relative sitemap URL (Sitemap: ${line[1]}) — the spec requires an absolute one and crawlers discard this line`, 'write the full URL: "Sitemap: https://<site>/sitemap-index.xml"', { file: 'dist/robots.txt' });
    return;
  }
  // Does that URL actually exist in this build? On a static site dist/ IS the
  // served surface, so a Sitemap: line pointing at a file the build never wrote
  // is Search Console's "Sitemap could not be read" before anyone deploys. Only
  // advisory: the sitemap may legitimately be served from elsewhere, and the
  // origin here is whatever `site` was set to, which this tool cannot resolve.
  const wanted = decodePath(target.pathname).replace(/^\/+/, '');
  const built = distFiles(project.root, /sitemap[-a-z0-9]*\.xml$/i);
  if (wanted && built.length && !built.includes(wanted)) {
    reporter.suggest(SEC, 'robots', `dist/robots.txt points at /${wanted}, which this build did not write — it emitted ${built.join(', ')}`, `point the Sitemap: line at ${built.includes('sitemap-index.xml') ? '/sitemap-index.xml' : `/${built[0]}`} (@astrojs/sitemap writes an index plus numbered parts, not /sitemap.xml)`, { file: 'dist/robots.txt' });
    return;
  }
  reporter.pass(SEC, 'robots', `served with a Sitemap: line → ${line[1]}`, { file: 'dist/robots.txt' });
}

// Every sitemap rule, so that "no dist/" skips them by name instead of leaving
// them silently unrun — CONTRIBUTING.md, "never let a check silently not run".
const SITEMAP_RULES = ['sitemap:urls', 'sitemap:lastmod', 'sitemap:hints', 'sitemap:noindex', 'sitemap:blocked', 'sitemap:canonical'];

function skipAll(reporter, names, why) {
  for (const n of names) reporter.skip(SEC, n, why);
}

/**
 * The sitemap, judged against what Google actually does with it.
 *
 * Verified against Google's "Build and submit a sitemap" (2026-09-04) rather
 * than from memory, because two of the four things people tune in a sitemap are
 * read by nobody: `<changefreq>` and `<priority>` are documented as ignored, and
 * a site that sets them is maintaining a fiction. What is left that matters is
 * small and checkable: absolute URLs, the size caps, and a `<lastmod>` that
 * parses.
 */
function checkSitemap(project, reporter) {
  if (!project.hasDist) {
    skipAll(reporter, SITEMAP_RULES, 'no dist/ — build the site to read the sitemap it ships');
    return;
  }
  const { entries, sizes } = sitemapEntries(project.root);
  if (entries.length === 0) {
    reporter.fix(SEC, 'sitemap:lastmod', 'no sitemap with <url> entries in dist/', 'add @astrojs/sitemap (or an endpoint that emits one) so search engines get a full URL list');
    skipAll(reporter, SITEMAP_RULES.filter((n) => n !== 'sitemap:lastmod'), 'no sitemap with <url> entries in dist/ — nothing to read');
    return;
  }
  // Only the files that actually carried <url> entries. A sitemap INDEX lists
  // other sitemaps and contributes none, so naming it as the source of "43/43
  // entries" is a small lie in every message that follows.
  const where = [...new Set(entries.map((e) => e.file))].join(', ');

  checkSitemapUrls(reporter, entries, sizes, where);
  checkSitemapLastmod(reporter, entries, where);
  checkSitemapHints(reporter, entries, where);
  checkSitemapPages(project, reporter, entries);
}

/**
 * Structure: absolute URLs, one origin, inside Google's caps.
 *
 * 50,000 URLs and 50 MB uncompressed per file are hard limits — over either and
 * the file is rejected whole, so a site that grew past one loses its entire
 * sitemap rather than the overflow. @astrojs/sitemap splits at `entryLimit`
 * (45,000 by default), which is why this is a cheap check that almost never
 * fires and is worth having anyway: it fires on the sites that hand-rolled an
 * endpoint instead.
 */
function checkSitemapUrls(reporter, entries, sizes, where) {
  const relative = entries.filter((e) => !/^[a-z][a-z0-9+.-]*:/i.test(e.loc));
  if (relative.length) {
    reporter.fix(SEC, 'sitemap:urls', `${relative.length}/${entries.length} <loc> values are not absolute URLs — ${sampleOf(relative.map((e) => e.loc))}`, 'emit fully-qualified URLs (https://host/path); set `site` in astro.config so @astrojs/sitemap can build them');
    return;
  }
  const MAX_URLS = 50000, MAX_BYTES = 50 * 1024 * 1024;
  const perFile = new Map();
  for (const e of entries) perFile.set(e.file, (perFile.get(e.file) ?? 0) + 1);
  const over = [...perFile].filter(([, n]) => n > MAX_URLS);
  if (over.length) {
    reporter.fix(SEC, 'sitemap:urls', `${over.map(([f, n]) => `${f} has ${n} URLs`).join('; ')} — over Google's 50,000 limit, so the file is rejected whole`, 'split it: @astrojs/sitemap does this automatically via entryLimit, and writes a sitemap index');
    return;
  }
  const heavy = [...sizes].filter(([, n]) => n > MAX_BYTES);
  if (heavy.length) {
    reporter.fix(SEC, 'sitemap:urls', `${heavy.map(([f, n]) => `${f} is ${(n / 1048576).toFixed(1)} MB`).join('; ')} uncompressed — over Google's 50 MB limit`, 'lower entryLimit so @astrojs/sitemap writes more, smaller files');
    return;
  }
  // Cross-domain URLs are legal once both properties are verified in Search
  // Console, so this is advice rather than a finding — but it is far more often
  // a stale `site` value than a deliberate cross-post.
  const origins = new Set(entries.map((e) => originOf(e.loc)).filter(Boolean));
  if (origins.size > 1) {
    reporter.suggest(SEC, 'sitemap:urls', `${entries.length} URLs span ${origins.size} origins (${[...origins].join(', ')})`, 'a sitemap covering more than one origin only works when every one of them is verified in Search Console — if that was not deliberate, check `site` in astro.config');
    return;
  }
  const total = [...sizes.values()].reduce((a, b) => a + b, 0);
  reporter.pass(SEC, 'sitemap:urls', `${entries.length} absolute URL(s) on ${[...origins][0] ?? 'one origin'}, ${(total / 1024).toFixed(0)} KB (${where})`);
}

/**
 * <lastmod>, counted only where it parses.
 *
 * Google reads lastmod "if it's consistently and verifiably accurate", and the
 * value has to be a W3C datetime — `March 3, 2026` is not a date to a parser,
 * it is a string that gets the whole element ignored. So a malformed lastmod is
 * counted as the absence it effectively is, rather than as a separate finding:
 * making it its own 🔧 while a *missing* lastmod stays 💡 would tell a site it
 * is better off deleting the element than fixing it.
 */
function checkSitemapLastmod(reporter, entries, where) {
  const present = entries.filter((e) => e.lastmod);
  const invalid = present.filter((e) => !W3C_DATETIME.test(e.lastmod));
  const valid = present.length - invalid.length;
  const badNote = invalid.length
    ? ` — ${invalid.length} value(s) are not W3C datetime and are ignored (${sampleOf(invalid.map((e) => e.lastmod))})`
    : '';

  if (valid >= entries.length) {
    reporter.pass(SEC, 'sitemap:lastmod', `${valid}/${entries.length} entries carry a valid <lastmod> (${where})`);
    return;
  }
  reporter.suggest(SEC, 'sitemap:lastmod', `${valid}/${entries.length} sitemap entries carry a valid <lastmod> (${where})${badNote}`, "set item.lastmod in @astrojs/sitemap's serialize(item) hook, from whichever date field your own frontmatter uses, as an ISO 8601 string (new Date(d).toISOString()). If you already have a serialize(), it is not reaching these URLs — the callback receives only { url, changefreq, lastmod, priority, links }, so a per-page date has to be looked up by URL");
}

/** W3C datetime, the format the sitemap spec names: a date, optionally a time. */
const W3C_DATETIME = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;

/**
 * <changefreq> and <priority>: bytes Google throws away.
 *
 * Both are in the sitemap spec and both are documented as ignored, which makes
 * them the one thing in a sitemap that is purely cost — and the one people most
 * often hand-tune, because a `priority` of 1.0 on the homepage feels like it
 * must be doing something. Advisory by construction: shipping them is not a
 * defect, it is just work that buys nothing.
 */
function checkSitemapHints(reporter, entries, where) {
  const cf = entries.filter((e) => e.changefreq).length;
  const pr = entries.filter((e) => e.priority).length;
  if (!cf && !pr) {
    reporter.pass(SEC, 'sitemap:hints', `no <changefreq>/<priority> (${where}) — Google ignores both`);
    return;
  }
  const parts = [cf && `${cf} <changefreq>`, pr && `${pr} <priority>`].filter(Boolean);
  reporter.suggest(SEC, 'sitemap:hints', `${parts.join(' and ')} in ${where} — Google's sitemap documentation lists both as ignored`, 'drop the changefreq/priority options from the sitemap config; <lastmod> is the only hint that is read');
}

/**
 * The sitemap against the pages it declares — three contradictions.
 *
 * A sitemap is a request to index every URL in it, so the interesting failures
 * are the ones where the site says the opposite somewhere else. All three are
 * named errors in Search Console, and none is visible from either half alone:
 *
 * - `noindex` on a submitted URL ("Submitted URL marked 'noindex'"). Usually a
 *   staging value that survived, and the highest-consequence SEO defect there
 *   is — the page is asking to be dropped from the index while the sitemap asks
 *   for it to be added.
 * - blocked by robots.txt: the crawler is told to fetch it and told not to.
 * - a canonical pointing elsewhere: the URL is submitted and then disclaimed by
 *   the page it resolves to.
 */
function checkSitemapPages(project, reporter, entries) {
  const files = sitemapPageFiles(project.root);
  if (files.size === 0) {
    skipAll(reporter, ['sitemap:noindex', 'sitemap:blocked', 'sitemap:canonical'], `none of the ${entries.length} sitemap URL(s) resolves to a built page — nothing to cross-check`);
    return;
  }
  const robots = readDist(project.root, 'robots.txt');
  const disallow = robotsRules(robots);
  const byLoc = new Map(entries.map((e) => [e.loc, e]));

  const noindex = [], blocked = [], mismatch = [], slashOnly = [];
  for (const [loc, file] of files) {
    const html = readDist(project.root, file);
    if (NOINDEX_RE.test(html)) noindex.push(`${file} (${loc})`);

    let path;
    try { path = decodePath(new URL(loc).pathname) || '/'; } catch { path = null; }
    if (path && disallow.length && isBlocked(disallow, path)) blocked.push(`${loc} (matched ${isBlocked(disallow, path)})`);

    const declared = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/)?.[1];
    if (!declared) continue;
    const a = normalizeUrl(declared), b = normalizeUrl(loc);
    if (!a || !b || (a.origin === b.origin && a.path === b.path)) continue;
    // A localized entry legitimately points at a shared canonical: the fallback
    // rewrite at /hu/design serves the English page and correctly canonicalises
    // to /design. The sitemap says so itself — that URL is in the entry's own
    // <xhtml:link> alternates — so consolidation that the sitemap already
    // declares is not a contradiction. Without this the bundled i18n fixture,
    // which is correct, collected two required findings.
    const alt = (byLoc.get(loc)?.alternates ?? []).some((h) => {
      const n = normalizeUrl(h);
      return n && n.origin === a.origin && n.path === a.path;
    });
    if (alt) continue;
    (a.origin === b.origin && a.path.replace(/\/$/, '') === b.path.replace(/\/$/, '') ? slashOnly : mismatch)
      .push(`${loc} → canonical ${declared}`);
  }

  if (noindex.length) reporter.fix(SEC, 'sitemap:noindex', `${noindex.length}/${files.size} sitemap page(s) carry a noindex robots meta — ${sampleOf(noindex)}`, 'a page cannot be submitted and withheld at once: drop the noindex, or exclude the page from the sitemap (@astrojs/sitemap filter)');
  else reporter.pass(SEC, 'sitemap:noindex', `none of the ${files.size} sitemap page(s) carries a noindex robots meta`);

  if (!disallow.length) reporter.pass(SEC, 'sitemap:blocked', `robots.txt disallows nothing for *, so no sitemap URL can be blocked by it`);
  else if (blocked.length) reporter.fix(SEC, 'sitemap:blocked', `${blocked.length}/${files.size} sitemap page(s) are Disallow'd in robots.txt — ${sampleOf(blocked)}`, "the sitemap asks for these to be crawled and robots.txt forbids it: exclude them from the sitemap (@astrojs/sitemap filter) or drop the Disallow");
  else reporter.pass(SEC, 'sitemap:blocked', `no sitemap page matches a robots.txt Disallow (${disallow.length} rule(s) for *)`);

  if (mismatch.length) reporter.fix(SEC, 'sitemap:canonical', `${mismatch.length}/${files.size} sitemap page(s) declare a different canonical — ${sampleOf(mismatch)}`, 'a sitemap should list canonical URLs only: either list the canonical instead, or drop the page from the sitemap');
  else if (slashOnly.length) reporter.suggest(SEC, 'sitemap:canonical', `${slashOnly.length}/${files.size} sitemap page(s) differ from their canonical only by a trailing slash — ${sampleOf(slashOnly)}`, 'these are two URLs to a crawler: make `site`, trailingSlash and the canonical agree');
  else reporter.pass(SEC, 'sitemap:canonical', `all ${files.size} resolvable sitemap page(s) declare themselves canonical`);
}

// `noindex` from either the generic robots meta or googlebot's. Matched on the
// tag, not the bare word, so the string "noindex" in a paragraph is not a
// finding — the built page is where prose lives.
const NOINDEX_RE = /<meta(?=[^>]*\bname\s*=\s*["'](?:robots|googlebot)["'])(?=[^>]*\bcontent\s*=\s*["'][^"']*\bnoindex\b)[^>]*>/i;

/**
 * The Disallow/Allow rules that apply to `*`, in declaration order.
 *
 * Both are collected because Disallow alone gets the answer wrong: the standard
 * resolves a path by the LONGEST matching rule, with Allow winning a tie, so a
 * site with `Disallow: /blog` and `Allow: /blog/public/` is not blocking
 * /blog/public/ — and reporting that it does would be a finding against a
 * correct file. A group ends at the next User-agent line that follows a rule.
 */
function robotsRules(text) {
  const rules = [];
  let agents = [], afterRule = false;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const ua = line.match(/^User-agent\s*:\s*(\S+)/i);
    if (ua) {
      if (afterRule) { agents = []; afterRule = false; }
      agents.push(ua[1]);
      continue;
    }
    const rule = line.match(/^(Allow|Disallow)\s*:\s*(\S*)/i);
    if (!rule) continue;
    afterRule = true;
    if (!agents.includes('*') || !rule[2]) continue;   // empty Disallow: means "allow everything"
    rules.push({ allow: /^allow$/i.test(rule[1]), path: rule[2] });
  }
  return rules;
}

/** The blocking rule's path, or null. Longest match wins; Allow wins a tie. */
function isBlocked(rules, path) {
  let best = null;
  for (const r of rules) {
    if (!robotsMatch(r.path, path)) continue;
    const len = r.path.replace(/\*/g, '').length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { ...r, len };
  }
  return best && !best.allow ? best.path : null;
}

// robots.txt pattern matching: `*` is any run of characters, `$` anchors the
// end, everything else is a literal prefix.
function robotsMatch(pattern, path) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

/** Origin + path, with the root's empty path spelled `/`. */
function normalizeUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  return { origin: u.origin, path: decodePath(u.pathname) || '/' };
}

/**
 * hreflang alternates on a multi-locale site.
 *
 * Only runs when the config declares two or more locales — on a single-language
 * site there is nothing to alternate between, and firing there would be the one
 * thing a check must never do. Either carrier counts: @astrojs/sitemap's `i18n`
 * option writes <xhtml:link rel="alternate"> into the sitemap, and a per-page
 * <link rel="alternate" hreflang> in the document head says the same thing.
 * Without one of them, each locale competes with its own translations.
 */
function checkHreflang(project, reporter) {
  const locales = declaredLocales(project.astroConfig);
  if (locales.size < 2) {
    reporter.skip(SEC, 'hreflang', `astro.config declares ${locales.size === 1 ? 'a single locale' : 'no locales'} — a single-language site has no alternates to declare`);
    return;
  }
  if (!project.hasDist) {
    reporter.skip(SEC, 'hreflang', `${locales.size} locales declared, but no dist/ — build the site to check it emits alternates`);
    return;
  }
  const inSitemap = sitemapEntries(project.root).entries.filter((e) => e.alternates.length).length;
  if (inSitemap) {
    reporter.pass(SEC, 'hreflang', `${inSitemap} sitemap entries carry <xhtml:link rel="alternate"> for ${locales.size} locales`);
    return;
  }
  let pages = 0;
  eachDistHtml(project.root, (rel, html) => { if (HREFLANG_RE.test(html)) pages++; });
  if (pages) reporter.pass(SEC, 'hreflang', `${pages} built page(s) carry <link rel="alternate" hreflang> for ${locales.size} locales`);
  else reporter.fix(SEC, 'hreflang', `${locales.size} locales declared (${[...locales].join(', ')}) but no hreflang alternates in the sitemap or any built page`, 'pass the i18n option to @astrojs/sitemap ({ defaultLocale, locales }) so every entry lists its translations, or emit <link rel="alternate" hreflang> from the head component');
}

const HREFLANG_RE = /<link[^>]+rel=["']alternate["'][^>]*\bhreflang\s*=/i;

/**
 * The locale codes any `locales:` block in astro.config names.
 *
 * Read from config TEXT (the config is never executed — lib/project.mjs has the
 * why), and deliberately not scoped to Astro's own `i18n` block: the sitemap
 * integration takes a `locales` map of its own, and either one appearing with
 * two or more codes means the same thing for this check. Both spellings are
 * covered — `['en','hu']` and `{ en: 'en-US', hu: 'hu-HU' }`.
 */
function declaredLocales(configText) {
  const text = String(configText ?? '');
  const out = new Set();
  for (const m of text.matchAll(/\blocales\s*:\s*([[{])/g)) {
    const open = m[1], close = open === '[' ? ']' : '}';
    let depth = 0, end = -1;
    for (let i = m.index + m[0].length - 1; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close && --depth === 0) { end = i; break; }
    }
    if (end < 0) continue;
    for (const q of text.slice(m.index, end).matchAll(/['"`]([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)['"`]/gi)) {
      out.add(q[1].toLowerCase().split('-')[0]);
    }
  }
  return out;
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
