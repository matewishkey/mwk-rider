// seo — the discoverability surface: a canonical SEO component emitting
// canonical URL, OG meta, and the brand fields they need.
// (Structured data / JSON-LD / llms.txt live in the data check.)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eachDistHtml, isContentPage, headingLevels, headingAudit } from '../lib/html.mjs';
import { readSrcFiles, headMetaFiles } from '../lib/src-scan.mjs';

const SEC = 'seo';

export async function run({ project, reporter }) {
  // The head-meta surface, found by behaviour rather than filename. A site may
  // put this in SEO.astro, BaseHead.astro, or straight into a layout — all are
  // correct, so search every source file and report against the union.
  const srcFiles = readSrcFiles(project.root);
  const headFiles = headMetaFiles(srcFiles);
  const head = headFiles.map((f) => f.text).join('\n');

  if (headFiles.length === 0) {
    reporter.fix(SEC, 'SEO component', 'no source file emits head metadata (canonical, OG tags or <title>)', 'add an SEO/head component that every page renders in <head>');
  } else {
    reporter.pass(SEC, 'SEO component', headFiles.map((f) => f.path).join(', '));
  }

  // Individual tags run whether or not a dedicated component exists — an absent
  // component must not silently skip them.
  const required = [
    ['og:image',        /og:image/],
    ['og:image:width',  /og:image:width/],
    ['og:image:height', /og:image:height/],
    ['og:type',         /og:type/],
    ['og:url',          /og:url/],
    ['canonical',       /rel=["']canonical["']/],
  ];
  for (const [name, re] of required) {
    if (re.test(head)) reporter.pass(SEC, `meta:${name}`);
    else               reporter.fix(SEC, `meta:${name}`, 'tag not emitted anywhere in src/', `emit a ${name} tag from the component that renders <head>`);
  }
  // Anti-pattern: <meta name="keywords"> (ignored by search engines, signals spam)
  const kw = srcFiles.find((f) => /name=["']keywords["']/.test(f.text));
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

function pickFirst(paths) {
  for (const p of paths) if (existsSync(p)) return p;
  return null;
}
