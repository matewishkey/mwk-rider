// seo — the discoverability surface: a canonical SEO component emitting
// canonical URL, OG meta, and the brand fields they need.
// (Structured data / JSON-LD / llms.txt live in the data check.)

import { eachDistHtml, isContentPage, headingLevels, headingAudit } from '../lib/html.mjs';
import { readSrcFiles, headMetaFiles } from '../lib/src-scan.mjs';

const SEC = 'seo';

// A tag counts as emitted only when it appears as a real attribute —
// `property="og:image"`, never the bare word. Matching bare substrings meant a
// line of prose satisfied the check: a component containing nothing but
// `// TODO: emit og:image, og:type and rel="canonical"` passed six checks at
// once. Comments are blanked before matching too (see lib/src-scan.mjs), so
// both halves of that failure are closed.
const metaRe = (key) => new RegExp(`(?:property|name)\\s*=\\s*["']${key}["']`, 'i');
const CANONICAL_RE = /rel\s*=\s*["']canonical["']/i;
const META_TAGS = [
  ['og:image',        metaRe('og:image')],
  ['og:image:width',  metaRe('og:image:width')],
  ['og:image:height', metaRe('og:image:height')],
  ['og:type',         metaRe('og:type')],
  ['og:url',          metaRe('og:url')],
  ['canonical',       CANONICAL_RE],
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
  checkMetaTags(project, reporter, head);

  // Anti-pattern: <meta name="keywords"> (ignored by search engines, signals spam)
  const kw = srcFiles.find((f) => /name=["']keywords["']/.test(f.code));
  if (kw) reporter.fix(SEC, 'no-keywords', `<meta name="keywords"> in ${kw.path} (anti-pattern)`, 'remove the keywords meta');
  else    reporter.pass(SEC, 'no-keywords');

  // Brand fields (only checkable when scripts/og.config.mjs declares them)
  const brand = project.ogConfig?.brand ?? project.ogConfig;
  if (brand) {
    const required = ['siteName', 'siteUrl', 'tagline'];
    for (const k of required) {
      if (brand[k]) reporter.pass(SEC, `brand.${k}`);
      else          reporter.fix(SEC, `brand.${k}`, 'missing (used by SEO meta)', `set brand.${k} in scripts/og.config.mjs`);
    }
    const optional = ['authorName', 'authorUrl', 'twitterSite', 'twitterCreator'];
    const missing = optional.filter((k) => !brand[k]);
    if (missing.length) reporter.suggest(SEC, 'brand:optional', `missing: ${missing.join(', ')}`, 'set for richer SEO/social cards (optional)');
  }

  // Sitemap lastmod (advisory — @astrojs/sitemap defaults to file mtime)
  const cfg = project.astroConfig ?? '';
  if (/serialize\s*:/.test(cfg) && !/lastmod/.test(cfg)) {
    reporter.suggest(SEC, 'sitemap:lastmod', 'custom sitemap serializer present without lastmod', 'emit entry.data.dateModified ?? entry.data.date from the serializer');
  } else if (/@astrojs\/sitemap/.test(cfg)) {
    reporter.pass(SEC, 'sitemap:lastmod', '@astrojs/sitemap defaults applied');
  } else {
    reporter.skip(SEC, 'sitemap:lastmod', 'no @astrojs/sitemap in astro.config — nothing to check');
  }

  // Heading outline on built content pages: exactly one <h1>, no skipped levels.
  // Scoped to pages with a canonical link, so OG-template / preview routes (no
  // canonical) don't get flagged for legitimately having no <h1>.
  if (project.hasDist) checkHeadings(project, reporter);
}

/**
 * Are the head tags actually emitted? Assert against `dist/` when it exists —
 * that is the artifact that ships, and it contains no comments, no unreachable
 * branches and no aspirational TODOs. Source is the fallback for an unbuilt
 * project, and is matched comment-blanked.
 *
 * Presence is judged across the whole build (a tag emitted anywhere counts),
 * mirroring the source semantics. Coverage is reported separately for the og:*
 * tags: how many *content* pages omit one. Canonical gets no coverage line —
 * a content page is *defined* as one carrying a canonical, so it would be
 * measuring itself.
 */
function checkMetaTags(project, reporter, headSrc) {
  const all = [], content = [];
  if (project.hasDist) {
    eachDistHtml(project.root, (rel, html) => {
      all.push({ rel, html });
      if (isContentPage(html)) content.push({ rel, html });
    });
  }

  if (all.length === 0) {
    const where = project.hasDist ? 'dist/ has no HTML' : 'no dist/';
    for (const [name, re] of META_TAGS) {
      if (re.test(headSrc)) reporter.pass(SEC, `meta:${name}`, `emitted in src/ (${where} — build to check the shipped HTML)`);
      else                  reporter.fix(SEC, `meta:${name}`, `tag not emitted anywhere in src/ (${where}, so source is all there is to read)`, `emit the ${name} tag from the component that renders <head>`);
    }
    return;
  }

  for (const [name, re] of META_TAGS) {
    if (!all.some((p) => re.test(p.html))) {
      reporter.fix(SEC, `meta:${name}`, `not emitted on any of the ${all.length} built page(s)`, `emit the ${name} tag from the component that renders <head>`);
      continue;
    }
    const missing = name === 'canonical' ? [] : content.filter((p) => !re.test(p.html));
    if (missing.length === 0) {
      reporter.pass(SEC, `meta:${name}`, `emitted in dist/ (${content.length} content page(s))`);
    } else {
      reporter.suggest(SEC, `meta:${name}`, `${missing.length}/${content.length} content page(s) omit it — ${sampleOf(missing.map((p) => p.rel))}`, `emit ${name} on every content page, not just some`);
    }
  }
}

function checkHeadings(project, reporter) {
  const h1bad = [], skipbad = [];
  let pages = 0;
  eachDistHtml(project.root, (rel, html) => {
    if (!isContentPage(html)) return;
    pages++;
    const a = headingAudit(headingLevels(html));
    if (a.h1) h1bad.push(`${rel} (${a.h1})`);
    if (a.skip) skipbad.push(`${rel} (${a.skip})`);
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

function sampleOf(list, n = 3) {
  return list.slice(0, n).join('; ') + (list.length > n ? ' …' : '');
}
