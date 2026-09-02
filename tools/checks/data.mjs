// data — the machine-readable surface other tools consume: structured data
// (JSON-LD), an LLM-friendly index (/llms.txt), a feed (RSS), and a search index
// (Orama). Endpoints are matched by *pattern*, not fixed filenames, so the
// canonical single-locale and per-locale naming shapes both pass:
//   rss.xml.ts | rss-[locale].xml.ts | rss.en.xml.ts | feed.xml.ts
//   llms.txt.ts (+ llms-[locale].txt.ts) — pass if SOME endpoint is content-driven
//   search-index.json.ts | search-index-[locale].json.ts

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readSrcFiles, stripComments } from '../lib/src-scan.mjs';
import { eachDistHtml } from '../lib/html.mjs';
import { distFiles, readDist, countMatches, sitemapPages, distRelative } from '../lib/dist.mjs';
import { collectJsonLd, ldTypes, hasArticleType } from '../lib/jsonld.mjs';
import { installedEngines, describeEngine } from '../lib/search-engines.mjs';

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
  // Returns WHICH form was found, not just that one was: a pass that names the
  // evidence is the difference between "checked and clean" and "never ran".
  const filterForm = (rel) => {
    const t = read(rel);
    const inline = /!\s*[\w.]*\bdraft\b/.test(t) && /!\s*[\w.]*\bpreviewOnly\b/.test(t);
    if (inline) return 'inline !draft && !previewOnly';
    // `.filter(isPublished)` passes the predicate by reference — the idiomatic
    // form, and the one the comment above already claims to accept.
    const helper = t.match(/\b(\w*[Pp]ublished)\s*[(,)\]]/) ?? t.match(/\bfilter\(\s*(\w*[Pp]ublished)\s*\)/);
    return helper ? `${helper[1]}() predicate` : null;
  };
  const hasFilter = (rel) => filterForm(rel) !== null;

  checkJsonLd(project, reporter);

  // /llms.txt — any llms*.txt endpoint; pass if SOME endpoint is content-driven.
  // (Multi-locale: root llms.txt is a thin index, llms-[locale].txt is the content one.)
  const llms = pages.filter((p) => /(^|\/)llms[-.a-z\[\]]*\.txt\.(ts|js)$/i.test(p));
  if (llms.length === 0) {
    reporter.fix(SEC, 'llms.txt', 'no src/pages/llms*.txt endpoint', 'add an llms.txt endpoint built from getCollection()');
  } else {
    const driven = llms.filter(contentDriven);
    if (driven.length === 0) reporter.fix(SEC, 'llms.txt', `endpoint(s) exist but none call getCollection() (${llms.map(short).join(', ')})`, 'build the index from getCollection() so it tracks published content');
    else reporter.pass(SEC, 'llms.txt', `content-driven (${driven.map(short).join(', ')})`);
    const filtered = driven.filter(hasFilter);
    if (filtered.length) reporter.pass(SEC, 'llms.txt:filter', `${filterForm(filtered[0])} in ${short(filtered[0])}`);
    else if (driven.length) reporter.fix(SEC, 'llms.txt:filter', 'no draft/preview filter on the content endpoint', 'exclude drafts/preview-only (!draft && !previewOnly)');
  }

  // RSS — the built feed is the artifact; the endpoint file is only how it got
  // there. Requiring getCollection() *in the endpoint* penalised the better
  // pattern of factoring the query into a shared helper.
  const rss = pages.filter((p) => /(^|\/)(rss|feed)[-.a-z\[\]]*\.xml\.(ts|js)$/i.test(p));
  const builtFeeds = project.hasDist ? distFiles(project.root, /(^|\/)(rss|feed|atom)[-.a-z0-9]*\.xml$/i) : [];
  if (builtFeeds.length) {
    const items = builtFeeds.reduce((n, f) => n + countMatches(readDist(project.root, f), /<(?:item|entry)\b/gi), 0);
    if (items > 0) reporter.pass(SEC, 'rss', `${items} item(s) in ${builtFeeds.length} built feed(s) (${builtFeeds.join(', ')})`);
    else reporter.fix(SEC, 'rss', `feed built but empty (${builtFeeds.join(', ')})`, 'the feed renders no items — check the collection query and the draft/preview filter');
  } else if (rss.length === 0) {
    reporter.fix(SEC, 'rss', `no rss/feed .xml endpoint${project.hasDist ? ' and no feed in dist/' : ''}`, 'add an RSS feed via @astrojs/rss built from getCollection()');
  } else if (project.hasDist) {
    reporter.fix(SEC, 'rss', `endpoint(s) exist but no feed in dist/ (${rss.map(short).join(', ')})`, 'the endpoint is not producing a feed — check it returns a Response and is not a draft route');
  } else if (rss.some((p) => /@astrojs\/rss|\brss\s*\(/.test(read(p)))) {
    reporter.pass(SEC, 'rss', `endpoint present (${rss.map(short).join(', ')}) — no dist/, so its output is unverified`);
  } else {
    reporter.fix(SEC, 'rss', `endpoint(s) exist but not via @astrojs/rss (${rss.map(short).join(', ')})`, 'build the feed with @astrojs/rss');
  }

  // Search — the index endpoint a client-side engine loads.
  //
  // Search is optional (see modules:search:engine), so a missing endpoint is
  // only a finding when the site actually ships a search library. That is the
  // coherence half of making search optional: dropping @orama/orama from the
  // baseline deps without this would mean nobody is ever told their search box
  // has nothing to search.
  const searchIdx = pages.filter((p) => /(^|\/)search-?index[-.a-z\[\]]*\.json\.(ts|js)$/i.test(p));
  const searchLibs = installedEngines(project.packageJson);
  // Only some engines read an index the SITE emits. Pagefind builds one from
  // dist/ at build time; Algolia, Meilisearch and Typesense host it. Demanding
  // a search-index endpoint of those is demanding a file they are designed not
  // to have — measured, it fired on a correct pagefind site and a correct
  // Algolia one.
  const needIndex = searchLibs.filter((e) => e.localIndex);
  if (searchIdx.length === 0 && searchLibs.length === 0) {
    reporter.skip(SEC, 'search:index', 'no search-index endpoint and no search library installed — search is optional, so there is nothing to check');
  } else if (searchIdx.length === 0 && needIndex.length === 0) {
    reporter.skip(SEC, 'search:index', `${searchLibs.map(describeEngine).join(', ')} builds or hosts its own index — a site using it is not expected to emit a search-index endpoint`);
  } else if (searchIdx.length === 0) {
    reporter.fix(SEC, 'search:index', `${needIndex.map(describeEngine).join(', ')} installed but no search-index*.json endpoint — the search UI has nothing to load`, 'add src/pages/search-index.json.ts (or per-locale) built from getCollection(), or drop the search dependency if the site has no search');
  } else if (searchIdx.some(contentDriven)) {
    reporter.pass(SEC, 'search:index', `Orama index source present (${searchIdx.map(short).join(', ')})`);
  } else {
    reporter.fix(SEC, 'search:index', `search-index endpoint(s) exist but none call getCollection() (${searchIdx.map(short).join(', ')})`, 'build the index from getCollection()');
  }

  checkContentSchema(project, reporter);
}

/**
 * Every collection is schema-validated, not just one of them.
 *
 * The old check was a whole-file `/z\.object\(/` on the raw text of
 * content.config.ts. Two collections where only one had a schema passed; so did
 * a file whose only mention of Zod was in a comment — the exact failure this
 * repo had already fixed for meta tags and then repeated here. All five dogfood
 * builds found it.
 */
function checkContentSchema(project, reporter) {
  if (!project.contentConfig) {
    reporter.fix(SEC, 'content:schema', 'no src/content.config.ts (or src/content/config.ts)', 'define your collections with a Zod schema so consumers get a validated, stable shape');
    return;
  }
  const code = stripComments(project.contentConfig);
  // `const blog = defineCollection({…})` and `{ blog: defineCollection({…}) }`
  // are both idiomatic; take the text up to the next definition as the body.
  const defs = [...code.matchAll(/(?:const\s+(\w+)\s*=|(\w+)\s*:)\s*defineCollection\s*\(/g)];
  if (defs.length === 0) {
    reporter.fix(SEC, 'content:schema', 'content.config.ts defines no collections (no defineCollection call outside comments)', 'define each collection with defineCollection({ loader, schema })', { file: 'src/content.config.ts' });
    return;
  }
  const unschemad = [];
  for (const [i, m] of defs.entries()) {
    const end = i + 1 < defs.length ? defs[i + 1].index : code.length;
    const body = code.slice(m.index, end);
    if (!/\bschema\s*:/.test(body)) unschemad.push(m[1] ?? m[2] ?? '(unnamed)');
  }
  if (unschemad.length === 0) {
    reporter.pass(SEC, 'content:schema', `${defs.length} collection(s), each with a schema`, { file: 'src/content.config.ts' });
  } else {
    reporter.fix(SEC, 'content:schema', `${unschemad.length}/${defs.length} collection(s) have no schema: ${unschemad.join(', ')}`, 'give every collection a Zod schema — an unvalidated one has no guaranteed shape for any consumer', { file: 'src/content.config.ts' });
  }
}

/**
 * Structured data, judged on what the pages emit.
 *
 * The old check required a file at `src/lib/jsonld.ts` containing the literal
 * strings "BlogPosting" and "WebSite". Sites that emit perfectly good JSON-LD
 * from a differently-named module, or inline, or using Article instead of
 * BlogPosting, were all told they had none. Read dist/ and parse it.
 */
function checkJsonLd(project, reporter) {
  if (!project.hasDist) {
    // No artifact to read: say what could not be checked rather than passing or
    // failing on a proxy. The source-side signal is still worth reporting.
    const ld = readSrcFiles(project.root).find((f) => /application\/ld\+json/.test(f.code));
    if (ld) reporter.pass(SEC, 'jsonld:emitted', `${ld.path} — no dist/, so the emitted shapes are unverified`);
    else reporter.fix(SEC, 'jsonld:emitted', 'no <script type="application/ld+json"> anywhere in src/', 'emit JSON-LD structured data from the component that renders <head>');
    reporter.skip(SEC, 'jsonld:shapes', 'no dist/ — build the site to check the JSON-LD it actually emits (Article-family + WebSite)');
    return;
  }

  // Judged over the pages the site declares in its sitemap, for the same reason
  // seo's coverage checks are: "every built page" counts OG templates.
  const declared = sitemapPages(project.root);
  const objects = [], broken = [], without = [];
  let pages = 0, pagesWithLd = 0;
  eachDistHtml(project.root, (rel, html) => {
    if (declared && !declared.has(distRelative(project.root, rel))) return;
    pages++;
    const found = collectJsonLd(html);
    if (found.objects.length) pagesWithLd++;
    else without.push(rel);
    objects.push(...found.objects);
    for (const b of found.broken) broken.push(`${rel}: ${b}`);
  });

  if (pages === 0) {
    reporter.skip(SEC, 'jsonld:emitted', 'dist/ has no HTML — nothing to read');
    reporter.skip(SEC, 'jsonld:shapes', 'dist/ has no HTML — nothing to read');
    return;
  }

  // "More than zero" was the bar: 1 page out of 19 reported ✅ and exit 0, with
  // the ratio printed but no threshold to read it against.
  const scope = declared ? 'sitemap page(s)' : 'built page(s)';
  if (pagesWithLd === 0) {
    reporter.fix(SEC, 'jsonld:emitted', `no JSON-LD on any of the ${pages} ${scope}`, 'emit JSON-LD structured data from the component that renders <head>');
  } else if (without.length) {
    reporter.suggest(SEC, 'jsonld:emitted', `${without.length}/${pages} ${scope} emit no JSON-LD — ${without.slice(0, 3).join('; ')}${without.length > 3 ? ' …' : ''}`, 'emit it from the shared head component so every published page carries it, not just some');
  } else {
    reporter.pass(SEC, 'jsonld:emitted', `on all ${pages} ${scope}`);
  }

  // Invalid JSON-LD is worse than none: search engines discard the block, but
  // nothing in the source hints that anything is wrong.
  if (broken.length) {
    reporter.fix(SEC, 'jsonld:parses', `${broken.length} JSON-LD block(s) are not valid JSON`, 'serialise with JSON.stringify and set:html — hand-written JSON-LD in a template usually breaks on quoting', { file: broken[0].split(':')[0] });
  }

  const types = ldTypes(objects);
  const article = hasArticleType(types);
  const site = types.has('WebSite');
  if (article && site) {
    reporter.pass(SEC, 'jsonld:shapes', `emitted: ${[...types].sort().join(', ')}`);
  } else {
    const missing = [!article ? 'an Article-family type (Article/BlogPosting/NewsArticle/TechArticle…)' : null, !site ? 'WebSite' : null].filter(Boolean).join(' and ');
    reporter.fix(SEC, 'jsonld:shapes', `dist/ emits ${types.size ? [...types].sort().join(', ') : 'no @type at all'} — missing ${missing}`, 'emit an Article-family shape per post and a site-wide WebSite shape');
  }
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

function short(rel) { return rel.replace(/^src\/pages\//, ''); }
