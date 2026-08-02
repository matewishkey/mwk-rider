// data — the machine-readable surface other tools consume: structured data
// (JSON-LD), an LLM-friendly index (/llms.txt), a feed (RSS), and a search index
// (Orama). Endpoints are matched by *pattern*, not fixed filenames, so the
// canonical single-locale and per-locale naming shapes both pass:
//   rss.xml.ts | rss-[locale].xml.ts | rss.en.xml.ts | feed.xml.ts
//   llms.txt.ts (+ llms-[locale].txt.ts) — pass if SOME endpoint is content-driven
//   search-index.json.ts | search-index-[locale].json.ts

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SEC = 'data';

export async function run({ project, reporter }) {
  const pages = listPages(project.root);
  const read = (rel) => { try { return readFileSync(join(project.root, rel), 'utf8'); } catch { return ''; } };
  const contentDriven = (rel) => /getCollection\s*\(/.test(read(rel));
  // The baseline filter predicate is `!draft && !previewOnly` (the documented
  // invariant shared by llms/rss/search-index). Accept either form:
  //  - inline: a negated draft AND a negated previewOnly, allowing any dotted
  //    accessor before the field (e.g. `!p.data.draft`, `!entry.data.previewOnly`)
  //  - a shared publish predicate factored into a helper (e.g. `isPublished(data)`)
  const hasFilter = (rel) => {
    const t = read(rel);
    const inline = /!\s*[\w.]*\bdraft\b/.test(t) && /!\s*[\w.]*\bpreviewOnly\b/.test(t);
    const helper = /\b\w*[Pp]ublished\s*\(/.test(t);
    return inline || helper;
  };

  // JSON-LD emitted by the SEO component
  const seoPath = pickFirst(project.root, ['src/components/SEO.astro', 'src/components/Seo.astro']);
  if (seoPath && /application\/ld\+json/.test(read(seoPath))) reporter.pass(SEC, 'jsonld:emitted');
  else reporter.fix(SEC, 'jsonld:emitted', 'no <script type="application/ld+json"> in the SEO component', 'emit JSON-LD structured data from the SEO component');

  // JSON-LD helper covering the two core shapes
  const jsonldPath = pickFirst(project.root, ['src/lib/jsonld.ts', 'src/lib/jsonld.js']);
  if (jsonldPath) {
    const t = read(jsonldPath);
    const blog = /BlogPosting/.test(t), site = /WebSite/.test(t);
    if (blog && site) reporter.pass(SEC, 'jsonld:shapes');
    else reporter.fix(SEC, 'jsonld:shapes', `missing shape(s) — BlogPosting:${blog} WebSite:${site}`, 'build both a BlogPosting (per post) and a WebSite (site-wide) shape');
  } else {
    reporter.fix(SEC, 'jsonld:shapes', 'no src/lib/jsonld.ts helper', 'add a jsonld helper building BlogPosting + WebSite');
  }

  // /llms.txt — any llms*.txt endpoint; pass if SOME endpoint is content-driven.
  // (Multi-locale: root llms.txt is a thin index, llms-[locale].txt is the content one.)
  const llms = pages.filter((p) => /(^|\/)llms[-.a-z\[\]]*\.txt\.(ts|js)$/i.test(p));
  if (llms.length === 0) {
    reporter.fix(SEC, 'llms.txt', 'no src/pages/llms*.txt endpoint', 'add an llms.txt endpoint built from getCollection()');
  } else {
    const driven = llms.filter(contentDriven);
    if (driven.length === 0) reporter.fix(SEC, 'llms.txt', `endpoint(s) exist but none call getCollection() (${llms.map(short).join(', ')})`, 'build the index from getCollection() so it tracks published content');
    else reporter.pass(SEC, 'llms.txt', `content-driven (${driven.map(short).join(', ')})`);
    if (driven.some(hasFilter)) reporter.pass(SEC, 'llms.txt:filter');
    else if (driven.length) reporter.fix(SEC, 'llms.txt:filter', 'no draft/preview filter on the content endpoint', 'exclude drafts/preview-only (!draft && !previewOnly)');
  }

  // RSS — any rss*/feed* .xml endpoint using @astrojs/rss + getCollection
  const rss = pages.filter((p) => /(^|\/)(rss|feed)[-.a-z\[\]]*\.xml\.(ts|js)$/i.test(p));
  if (rss.length === 0) {
    reporter.fix(SEC, 'rss', 'no rss/feed .xml endpoint', 'add an RSS feed via @astrojs/rss built from getCollection()');
  } else if (rss.some((p) => /@astrojs\/rss|\brss\s*\(/.test(read(p)) && contentDriven(p))) {
    reporter.pass(SEC, 'rss', `feed present (${rss.map(short).join(', ')})`);
  } else {
    reporter.fix(SEC, 'rss', `endpoint(s) exist but not via @astrojs/rss + getCollection (${rss.map(short).join(', ')})`, 'build the feed with @astrojs/rss from getCollection()');
  }

  // Search — Orama index source. The @orama/orama dep is asserted in `modules`.
  const searchIdx = pages.filter((p) => /(^|\/)search-?index[-.a-z\[\]]*\.json\.(ts|js)$/i.test(p));
  if (searchIdx.length === 0) {
    reporter.fix(SEC, 'search:index', 'no search-index*.json endpoint — baseline search is Orama, fed by a content-driven index', 'add src/pages/search-index.json.ts (or per-locale) built from getCollection(); load it client-side with @orama/orama');
  } else if (searchIdx.some(contentDriven)) {
    reporter.pass(SEC, 'search:index', `Orama index source present (${searchIdx.map(short).join(', ')})`);
  } else {
    reporter.fix(SEC, 'search:index', `search-index endpoint(s) exist but none call getCollection() (${searchIdx.map(short).join(', ')})`, 'build the index from getCollection()');
  }

  // Content collection is schema-validated (stable shape for consumers)
  if (project.contentConfig && /z\.object\(/.test(project.contentConfig)) reporter.pass(SEC, 'content:schema', 'collection has a Zod schema');
  else reporter.fix(SEC, 'content:schema', 'content collection has no Zod schema', 'define a Zod schema in src/content.config.ts');
}

function listPages(root) {
  const dir = join(root, 'src', 'pages');
  if (!existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else out.push(relative(root, full));
    }
  }
  return out;
}

function pickFirst(root, rels) {
  for (const r of rels) if (existsSync(join(root, r))) return r;
  return null;
}

function short(rel) { return rel.replace(/^src\/pages\//, ''); }
