#!/usr/bin/env node
// Smoke test for the rider audit tool.
//
// Runs audit.mjs against the compliant fixture (examples/_fixture-i18n) and a
// non-Astro dir, and asserts the engine behaves. The fixture is compliant by
// construction, so any required finding (🔧/🛑) means the TOOL has a bug.
//
// Run: node tools/test.mjs   (exit 0 = all assertions pass)

import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { imageSize } from './lib/image-size.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const AUDIT = join(here, 'audit.mjs');
const FIXTURE = join(here, '..', 'examples', '_fixture-i18n');

// Every mkdtemp dir is registered so the run doesn't leak ~15 of them into $TMPDIR.
const tmpDirs = [];
function tmpProject(prefix) { const d = mkdtempSync(join(tmpdir(), prefix)); tmpDirs.push(d); return d; }
process.on('exit', () => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ok   ${name}`); }
  else { console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); failures++; }
}

// Every id any run in this file emits, so the rule catalogue can be checked for
// drift at the end: a new check must not ship uncatalogued.
const seenRuleIds = new Set();

function runJson(cwd, args = []) {
  const r = spawnSync('node', [AUDIT, '--json', ...args], { cwd, encoding: 'utf8' });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  for (const row of parsed?.results ?? []) if (row.id) seenRuleIds.add(row.id);
  return { code: r.status, json: parsed, stderr: r.stderr };
}

console.log('fixture is compliant → expect 0 required findings:');
const fix = runJson(FIXTURE);
check('exits 0', fix.code === 0, `exit ${fix.code}`);
check('parseable JSON output', fix.json != null);
if (fix.json) {
  const s = fix.json.summary;
  check('no 🔧 fixes', s.fix === 0, `${s.fix} fixes`);
  check('no 🛑 blocks', s.block === 0, `${s.block} blocks`);
  check('has passing checks', s.pass > 0, `${s.pass} passes`);
  check('all seven offline domains ran', new Set(fix.json.results.map(r => r.section)).size >= 7);
}

console.log('every finding carries a stable rule id:');
// The id is public API — agents filter, suppress and report by it. It must be
// present on every row and shaped `section/rule`, never carry a path.
if (fix.json) {
  const rows = fix.json.results;
  check('every row has an id', rows.every(r => typeof r.id === 'string' && r.id.length > 0));
  check('  …shaped section/rule, with no path or subject in it',
    rows.every(r => /^[a-z0-9]+\/[a-z0-9.-]+$/.test(r.id ?? '')),
    JSON.stringify(rows.filter(r => !/^[a-z0-9]+\/[a-z0-9.-]+$/.test(r.id ?? '')).map(r => r.id).slice(0, 3)));
  check('  …and one rule keeps one id across its instances',
    new Set(rows.filter(r => r.name?.startsWith('dep:')).map(r => r.id)).size === 1);
}

// Location belongs in file/line, not baked into the name string: an agent that
// reads a finding must not have to grep dist/ to learn which file it means.
const clsDir = tmpProject('rider-cls-');
writeFileSync(join(clsDir, 'package.json'), JSON.stringify({ name: 'fx', type: 'module', dependencies: { astro: '^7.1.6' } }));
writeFileSync(join(clsDir, 'astro.config.mjs'), "export default { output: 'static' };\n");
mkdirSync(join(clsDir, 'src', 'pages'), { recursive: true });
writeFileSync(join(clsDir, 'src', 'pages', 'index.astro'), '<p>x</p>\n<img src="/hero.png">\n');
const clsRow = runJson(clsDir, ['-s', 'perf']).json?.results.find(r => r.id === 'perf/cls-img-dimensions' && r.outcome === 'fix');
check('a located finding reports file + line as fields',
  clsRow?.file === 'src/pages/index.astro' && clsRow?.line === 2, JSON.stringify(clsRow));
check('  …and its name is just the rule', clsRow?.name === 'cls:img-dimensions');

console.log('section scoping (-s seo) returns only that domain:');
const scoped = runJson(FIXTURE, ['-s', 'seo']);
check('only seo results', scoped.json?.results.every(r => r.section === 'seo'));

console.log('non-Astro dir is rejected:');
const nonAstro = spawnSync('node', [AUDIT], { cwd: tmpdir(), encoding: 'utf8' });
check('exits 2', nonAstro.status === 2, `exit ${nonAstro.status}`);

console.log('imageSize reads OG-card dimensions from bytes (drives og:image:card):');
// PNG: 8-byte sig + IHDR length/type + width@16 + height@20 (big-endian uint32).
const png = (w, h) => Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,   // signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,   // IHDR chunk header
  (w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255,
  (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255,
]).buffer;
// JPEG: SOI + an APP0 segment to skip + SOF0 carrying height then width.
const jpeg = (w, h) => Uint8Array.from([
  0xff, 0xd8,                                       // SOI
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,               // APP0, len 4 (skipped)
  0xff, 0xc0, 0x00, 0x11, 0x08,                     // SOF0, len 17, precision 8
  (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, // height, width
  0x00, 0x00, 0x00,                                 // pad past the i+9 read window
]).buffer;
const real = imageSize(png(1200, 630));
check('PNG 1200×630 parsed', real?.w === 1200 && real?.h === 630, JSON.stringify(real));
const small = imageSize(png(320, 180));
check('PNG sub-minimum read (would fix: <600×315)', small?.w === 320 && small?.h === 180, JSON.stringify(small));
const jp = imageSize(jpeg(1200, 630));
check('JPEG 1200×630 parsed (segment skip)', jp?.w === 1200 && jp?.h === 630, JSON.stringify(jp));
check('non-image bytes → null', imageSize(Uint8Array.from([1, 2, 3, 4]).buffer) === null);

console.log('adapter checks are gated on on-demand rendering, not <Image> presence:');
// <Image> on a fully prerendered build is optimized at build time by Sharp → no
// adapter needed. The Cloudflare image service only matters when a route renders
// on demand, where Sharp can't run on Workers. Build throwaway projects and read
// just that result.
function mkProject({ output = 'static', withImage, withAdapter, adapterDep = '@astrojs/cloudflare', config, prerenderFalse = false } = {}) {
  const dir = tmpProject('rider-mod-');
  const deps = { astro: '^7.1.6' };
  if (withAdapter) deps[adapterDep] = '^14.1.7';
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx', type: 'module', dependencies: deps }));
  writeFileSync(join(dir, 'astro.config.mjs'),
    config ?? `export default { output: '${output}'${withAdapter ? ', adapter: adapter()' : ''} };\n`);
  mkdirSync(join(dir, 'src', 'pages'), { recursive: true });
  const body = withImage
    ? `---\nimport { Image } from 'astro:assets';\nimport shot from '../shot.png';\n---\n<Image src={shot} alt="x" />\n`
    : `<p>hi</p>\n`;
  writeFileSync(join(dir, 'src', 'pages', 'index.astro'), body);
  if (prerenderFalse) {
    mkdirSync(join(dir, 'src', 'pages', 'api'), { recursive: true });
    writeFileSync(join(dir, 'src', 'pages', 'api', 'contact.ts'),
      'export const prerender = false;\nexport const POST = () => new Response(null, { status: 303 });\n');
  }
  return dir;
}
const modRow = (opts, name) =>
  runJson(mkProject(opts), ['-s', 'modules', '--strict']).json?.results.find(r => r.name === name) ?? null;

const staticImg = modRow({ output: 'static', withImage: true, withAdapter: false }, 'adapter:cloudflare');
check('static + <Image>, no adapter → pass (build-time Sharp)', staticImg?.outcome === 'pass', JSON.stringify(staticImg));
const ssrAdapter = modRow({ output: 'server', withImage: true, withAdapter: true }, 'adapter:cloudflare');
check('SSR + <Image> + adapter → pass', ssrAdapter?.outcome === 'pass', JSON.stringify(ssrAdapter));
// No adapter at all is one defect, so it gets one finding — on adapter:on-demand,
// which is the rule that names it. adapter:cloudflare defers rather than
// reporting the same root cause a second time.
const ssrNoAdapter = modRow({ output: 'server', withImage: true, withAdapter: false }, 'adapter:on-demand');
check('SSR, no adapter → block on adapter:on-demand', ssrNoAdapter?.outcome === 'block', JSON.stringify(ssrNoAdapter));
check('  …and adapter:cloudflare defers instead of double-reporting it',
  modRow({ output: 'server', withImage: true, withAdapter: false }, 'adapter:cloudflare')?.outcome === 'skip');

// The false negative the starter exposed: output stays 'static' and ONE route
// opts out. That build fails without an adapter just as loudly as output:'server'.
const oneRoute = modRow({ output: 'static', prerenderFalse: true, withAdapter: false }, 'adapter:on-demand');
check('a single prerender = false route with no adapter → block', oneRoute?.outcome === 'block', JSON.stringify(oneRoute));
check('  …and it names the route, not just the output mode',
  /prerender = false/.test(oneRoute?.message ?? ''), JSON.stringify(oneRoute));
const oneRouteOk = modRow({ output: 'static', prerenderFalse: true, withAdapter: true }, 'adapter:on-demand');
check('  …satisfied by an adapter', oneRouteOk?.outcome === 'pass', JSON.stringify(oneRouteOk));
// Universal means universal: any adapter, not ours.
const nodeAdapter = modRow({ output: 'server', withAdapter: true, adapterDep: '@astrojs/node' }, 'adapter:on-demand');
check('  …by ANY adapter, not just Cloudflare', nodeAdapter?.outcome === 'pass', JSON.stringify(nodeAdapter));
check('all-prerendered → skip, nothing to require',
  modRow({ output: 'static' }, 'adapter:on-demand')?.outcome === 'skip');
// A commented-out opt-out is a note, not a route.
const commentedOut = mkProject({ output: 'static' });
writeFileSync(join(commentedOut, 'src', 'pages', 'index.astro'), '---\n// export const prerender = false\n---\n<p>hi</p>\n');
check('  …and a commented-out prerender = false does not demand one',
  runJson(commentedOut, ['-s', 'modules', '--strict']).json?.results
    .find(r => r.name === 'adapter:on-demand')?.outcome === 'skip');

// The billing trap: @astrojs/cloudflare's imageService default became
// 'cloudflare-binding', which provisions a paid product on deploy.
const noImageService = modRow({ output: 'server', withImage: true, withAdapter: true }, 'adapter:imageService');
check('adapter + <Image> with no explicit imageService → suggest (the billing trap)',
  noImageService?.outcome === 'suggest', JSON.stringify(noImageService));
const explicitImageService = modRow({
  output: 'server', withImage: true, withAdapter: true,
  config: "export default { output: 'server', adapter: cloudflare({ imageService: 'compile' }) };\n",
}, 'adapter:imageService');
check('  …and setting it explicitly → pass', explicitImageService?.outcome === 'pass', JSON.stringify(explicitImageService));
check('  …and it never fires without <Image>',
  modRow({ output: 'server', withImage: false, withAdapter: true }, 'adapter:imageService') === null);

console.log('Astro 7 migration checks fire on a v6-shaped project:');
// The fixture is compliant by construction, so it only proves these checks stay
// quiet. Build the known-bad counterpart and prove each one actually fires.
function mkLegacyProject({ deps = {}, config = '', src = '' } = {}) {
  const dir = tmpProject('rider-v7-');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'fx', type: 'module', engines: { node: '>=22' },
    dependencies: { astro: '^6.4.2', ...deps },
  }));
  writeFileSync(join(dir, 'astro.config.mjs'), `export default { output: 'static', ${config} };\n`);
  // Satisfy the *universal* checks so what's left is purely house style — that's
  // what makes the "default mode exits 0" assertion below mean anything.
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ extends: 'astro/tsconfigs/strict' }));
  mkdirSync(join(dir, 'src', 'pages'), { recursive: true });
  writeFileSync(join(dir, 'src', 'pages', 'index.astro'), src || `<p>hi</p>\n`);
  writeFileSync(join(dir, 'src', 'pages', '404.astro'), `<p>not found</p>\n`);
  return dir;
}
function modResult(opts, name) {
  const { json } = runJson(mkLegacyProject(opts), ['-s', 'modules', '--strict']);
  return json?.results.find(r => r.name === name) ?? null;
}

const oldAstro = modResult({}, 'astro:version');
check('astro ^6.4.2 → fix (baseline is ^7)', oldAstro?.outcome === 'fix', JSON.stringify(oldAstro));

const oldNode = modResult({}, 'engines.node');
check('engines.node ">=22" → fix (needs >=22.12.0)', oldNode?.outcome === 'fix', JSON.stringify(oldNode));

const ts7 = modResult({ deps: { typescript: '^7.0.2', '@astrojs/check': '^0.9.10' } }, 'typescript:version');
check('typescript ^7 with @astrojs/check → fix', ts7?.outcome === 'fix', JSON.stringify(ts7));
const ts6 = modResult({ deps: { typescript: '^6.0.3', '@astrojs/check': '^0.9.10' } }, 'typescript:version');
check('typescript ^6 with @astrojs/check → pass', ts6?.outcome === 'pass', JSON.stringify(ts6));

const staleFlags = modResult({ config: `experimental: { rustCompiler: true, cache: { provider: x } }` }, 'astro7:experimental');
check('stabilized experimental flags → fix', staleFlags?.outcome === 'fix', JSON.stringify(staleFlags));
check('  …and names the flags', /rustCompiler/.test(staleFlags?.message ?? '') && /cache/.test(staleFlags?.message ?? ''), staleFlags?.message);
const liveFlags = modResult({ config: `experimental: { fonts: {} }` }, 'astro7:experimental');
check('a still-experimental flag → pass (not flagged)', liveFlags?.outcome === 'pass', JSON.stringify(liveFlags));

const remarkNoPkg = modResult({ config: `markdown: { remarkPlugins: [a] }` }, 'astro7:markdown');
check('remarkPlugins without @astrojs/markdown-remark → fix', remarkNoPkg?.outcome === 'fix', JSON.stringify(remarkNoPkg));
const remarkWithPkg = modResult({
  deps: { '@astrojs/markdown-remark': '^7.2.2' },
  config: `markdown: { remarkPlugins: [a] }`,
}, 'astro7:markdown');
check('remarkPlugins with @astrojs/markdown-remark → pass', remarkWithPkg?.outcome === 'pass', JSON.stringify(remarkWithPkg));

const db = modResult({ deps: { '@astrojs/db': '^0.14.0' } }, 'astro7:db');
check('@astrojs/db installed → fix (removed in v7)', db?.outcome === 'fix', JSON.stringify(db));

const transitions = modResult({
  src: `---\nimport { TRANSITION_BEFORE_SWAP } from 'astro:transitions/client';\n---\n<p>x</p>\n`,
}, 'astro7:transitions');
check('removed astro:transitions internal → fix', transitions?.outcome === 'fix', JSON.stringify(transitions));
check('  …and names the API', /TRANSITION_BEFORE_SWAP/.test(transitions?.message ?? ''), transitions?.message);

console.log('house-style checks demote to 💡 unless --strict:');
// A stranger's Astro site should see real defects, not "you're not us". Universal
// checks keep their severity in both modes; baseline ones only bite under --strict.
const legacyDir = mkLegacyProject({});
const loose = runJson(legacyDir, ['-s', 'modules']);
const strict = runJson(legacyDir, ['-s', 'modules', '--strict']);
const find = (r, n) => r.json?.results.find(x => x.name === n) ?? null;

const looseVer = find(loose, 'astro:version');
check('default: astro:version → suggest, flagged houseStyle',
  looseVer?.outcome === 'suggest' && looseVer?.houseStyle === true, JSON.stringify(looseVer));
check('--strict: astro:version → fix', find(strict, 'astro:version')?.outcome === 'fix');
check('default exits 0 when only house-style findings remain', loose.code === 0, `exit ${loose.code}`);
check('--strict exits 1 on the same project', strict.code === 1, `exit ${strict.code}`);

// A universal check must NOT be demoted — that would hide real defects.
const universal = runJson(mkLegacyProject({ config: `experimental: { rustCompiler: true }` }), ['-s', 'modules']);
const exp = find(universal, 'astro7:experimental');
check('default: astro7:experimental stays a fix (universal)',
  exp?.outcome === 'fix' && !exp?.houseStyle, JSON.stringify(exp));

console.log('checks read the built artifact, not a proxy for it:');
// Six checks used to ask "is the package installed / does a file we named
// mention the right string". All five dogfood sites hand-wrote correct
// robots.txt, emitted rich JSON-LD and shipped working feeds — and were told
// they had none. dist/ is written by hand here: these checks read files, so a
// real astro build would only make the test slower.
function mkBuilt(files, { deps = {}, src = {} } = {}) {
  const dir = tmpProject('rider-dist-');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'fx', type: 'module', engines: { node: '>=22.12.0' },
    dependencies: { astro: '^7.1.6', ...deps },
  }));
  writeFileSync(join(dir, 'astro.config.mjs'), "export default { output: 'static' };\n");
  for (const [rel, body] of Object.entries({ 'src/pages/index.astro': '<p>hi</p>\n', ...src, ...files })) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}
const row = (dir, section, id) => runJson(dir, ['-s', section, '--strict']).json?.results.find(r => r.id === id) ?? null;

const PAGE_LD = (types) => `<html><head><link rel="canonical" href="/"><title>t</title>`
  + `<script type="application/ld+json">${JSON.stringify(types)}<\/script></head><body><h1>t</h1></body></html>`;

// robots.txt — the file, not astro-robots-txt. A generated endpoint is *better*
// than the package (and collides with it), so requiring the package was wrong.
const noRobots = row(mkBuilt({ 'dist/index.html': PAGE_LD({ '@type': 'WebSite' }) }), 'seo', 'seo/robots');
check('no robots.txt in dist → fix', noRobots?.outcome === 'fix', JSON.stringify(noRobots));
const bareRobots = row(mkBuilt({ 'dist/index.html': '<p>x</p>', 'dist/robots.txt': 'User-agent: *\nAllow: /\n' }), 'seo', 'seo/robots');
check('robots.txt with no Sitemap: line → fix', bareRobots?.outcome === 'fix', JSON.stringify(bareRobots));
const goodRobots = row(mkBuilt({ 'dist/index.html': '<p>x</p>', 'dist/robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://x.test/sitemap-index.xml\n' }), 'seo', 'seo/robots');
check('  …hand-written robots.txt with one → pass, with no package installed', goodRobots?.outcome === 'pass', JSON.stringify(goodRobots));

// sitemap lastmod — read the XML. "@astrojs/sitemap is configured" proved
// nothing: two dogfood sites shipped sitemaps with zero <lastmod> and passed.
const SITEMAP = (lastmod) => `<?xml version="1.0"?><urlset><url><loc>https://x.test/a</loc>${lastmod ? '<lastmod>2026-01-01</lastmod>' : ''}</url></urlset>`;
const noLastmod = row(mkBuilt({ 'dist/sitemap-0.xml': SITEMAP(false) }, { deps: { '@astrojs/sitemap': '^3.7.3' } }), 'seo', 'seo/sitemap-lastmod');
check('sitemap with no <lastmod> → suggest, even with @astrojs/sitemap installed',
  noLastmod?.outcome === 'suggest', JSON.stringify(noLastmod));
const withLastmod = row(mkBuilt({ 'dist/sitemap-0.xml': SITEMAP(true) }), 'seo', 'seo/sitemap-lastmod');
check('  …and one that carries it → pass', withLastmod?.outcome === 'pass', JSON.stringify(withLastmod));

// JSON-LD — parse the page. Requiring the literal "BlogPosting" in a file named
// src/lib/jsonld.ts told all five sites they had none.
const article = row(mkBuilt({ 'dist/index.html': PAGE_LD([{ '@type': 'WebSite' }, { '@type': 'Article' }]) }), 'data', 'data/jsonld-shapes');
check('Article (not BlogPosting) + WebSite in dist → pass, with no jsonld.ts helper',
  article?.outcome === 'pass', JSON.stringify(article));
const graph = row(mkBuilt({ 'dist/index.html': PAGE_LD({ '@graph': [{ '@type': 'TechArticle' }, { '@type': 'WebSite' }] }) }), 'data', 'data/jsonld-shapes');
check('  …and a @graph-wrapped pair is found too', graph?.outcome === 'pass', JSON.stringify(graph));
const siteOnly = row(mkBuilt({ 'dist/index.html': PAGE_LD({ '@type': 'WebSite' }) }), 'data', 'data/jsonld-shapes');
check('  …while WebSite alone → fix', siteOnly?.outcome === 'fix', JSON.stringify(siteOnly));
const brokenLd = row(mkBuilt({ 'dist/index.html': '<html><head><script type="application/ld+json">{"@type": "Article",}<\/script></head></html>' }), 'data', 'data/jsonld-parses');
check('  …and JSON-LD that does not parse is its own finding', brokenLd?.outcome === 'fix', JSON.stringify(brokenLd));

// search — optional since 2026-08-03. A site with no search at all used to
// report "Orama ✅"; then it reported a required finding for every dependency it
// had chosen not to install. Neither was true.
const noSearch = row(mkBuilt({}), 'modules', 'modules/search-engine');
check('no search library → skip, not a pass for Orama', noSearch?.outcome === 'skip', JSON.stringify(noSearch));
const orama = row(mkBuilt({}, { deps: { '@orama/orama': '^3.1.18' } }), 'modules', 'modules/search-engine');
check('  …Orama installed → pass', orama?.outcome === 'pass', JSON.stringify(orama));
const pagefind = row(mkBuilt({}, { deps: { pagefind: '^1.0.0' } }), 'modules', 'modules/search-engine');
check('  …one non-baseline engine → suggest, not fix', pagefind?.outcome === 'suggest', JSON.stringify(pagefind));
const twoEngines = row(mkBuilt({}, { deps: { '@orama/orama': '^3.1.18', pagefind: '^1.0.0' } }), 'modules', 'modules/search-engine');
check('  …but two engines at once → fix', twoEngines?.outcome === 'fix', JSON.stringify(twoEngines));
// Dropping @orama/orama from BASELINE_DEPS must not lose the coverage: a site
// that ships a search library and no index endpoint has a search box wired to
// nothing, and that is still a finding.
const oramaDeps = { '@orama/orama': '^3.1.18' };
const searchNoIndex = row(mkBuilt({}, { deps: oramaDeps }), 'data', 'data/search-index');
check('a search library with no index endpoint → fix', searchNoIndex?.outcome === 'fix', JSON.stringify(searchNoIndex));
const noSearchNoIndex = row(mkBuilt({}), 'data', 'data/search-index');
check('  …and no search library and no endpoint → skip, not a finding',
  noSearchNoIndex?.outcome === 'skip', JSON.stringify(noSearchNoIndex));
check('  …and @orama/orama is no longer a required baseline dep',
  runJson(mkBuilt({}), ['-s', 'modules', '--strict']).json?.results
    .every(r => !String(r.name).includes('@orama/orama')));

// RSS — the built feed, not getCollection() in the endpoint file. Factoring the
// query into a shared helper is good practice and used to fail the check.
const feed = row(mkBuilt({
  'dist/rss.xml': '<rss><channel><item><title>a</title></item></channel></rss>',
  'src/pages/rss.xml.ts': "import rss from '@astrojs/rss';\nimport { posts } from '../lib/posts';\nexport const GET = () => rss({ items: posts() });\n",
}), 'data', 'data/rss');
check('a built feed with items → pass, though the endpoint calls a helper not getCollection()',
  feed?.outcome === 'pass', JSON.stringify(feed));
const emptyFeed = row(mkBuilt({
  'dist/rss.xml': '<rss><channel></channel></rss>',
  'src/pages/rss.xml.ts': "export const GET = () => new Response('');\n",
}), 'data', 'data/rss');
check('  …and a feed that built empty → fix', emptyFeed?.outcome === 'fix', JSON.stringify(emptyFeed));

console.log('a check with nothing to look at skips, and defaults are not defects:');
// `output` defaults to 'static', so omitting it is correct — this was a
// required finding for writing less config than necessary.
function mkConfig(body) {
  const dir = tmpProject('rider-out-');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx', type: 'module', dependencies: { astro: '^7.1.6' } }));
  writeFileSync(join(dir, 'astro.config.mjs'), `export default { ${body} };\n`);
  mkdirSync(join(dir, 'src', 'pages'), { recursive: true });
  writeFileSync(join(dir, 'src', 'pages', 'index.astro'), '<p>hi</p>\n');
  return dir;
}
check('output omitted → pass (static is the default)',
  row(mkConfig('trailingSlash: "never"'), 'modules', 'modules/output-static')?.outcome === 'pass');
check('  …explicit static → pass', row(mkConfig("output: 'static'"), 'modules', 'modules/output-static')?.outcome === 'pass');
check('  …explicit server → fix', row(mkConfig("output: 'server'"), 'modules', 'modules/output-static')?.outcome === 'fix');

// "all content <img> go through a transform" on a page with no images is a pass
// for work never done. Sibling checks already used ⏭ for exactly this.
const noImgs = mkBuilt({ 'dist/index.html': '<html><body><p>no images here</p></body></html>' });
for (const [section, id] of [['images', 'images/routed'], ['images', 'images/alt'], ['perf', 'perf/cls-img-dimensions']]) {
  const r = row(noImgs, section, id);
  check(`${id} skips when there is nothing to check`, r?.outcome === 'skip', JSON.stringify(r));
}

// --quiet hides ✅ and nothing else. It used to swallow 💡 and ⏭ too, so a quiet
// run looked cleaner than it was — and contradicted --help.
const quiet = spawnSync('node', [AUDIT, '-s', 'images', '--quiet'], { cwd: noImgs, encoding: 'utf8' }).stdout;
check('--quiet hides ✅ lines', !quiet.includes('✅ images'));
check('  …and still prints ⏭', quiet.includes('⏭'), quiet.slice(0, 200));

console.log('detection accepts correct variants (the false-positive failure mode):');
// Each of these was a real defect: a compliant site got a required finding, or a
// real offender passed. They stay tested so the fix can't silently regress.
const { imgsMissingAlt } = await import('./lib/html.mjs');
check('> inside an attribute value does not hide alt',
  imgsMissingAlt('<img src="/a.png" data-x="a>b" alt="fine">').length === 0);
check('srcset-only image with no alt is still caught',
  imgsMissingAlt('<img srcset="/a.png 1x, /b.png 2x">').length === 1);

const { attrValue, hasAttr } = await import('./lib/html.mjs');
check('data-src does not satisfy src', attrValue('data-src="/a.png"', 'src') === null);
check('data-width does not satisfy width', hasAttr('data-width="8"', 'width') === false);
check('unquoted attribute values are read', attrValue('src=/a.png', 'src') === '/a.png');

// Astro serialises alt="" as a bare `alt`. Treating that as "no alt" reported
// every correctly-marked decorative image as a WCAG violation — in one dogfood
// run it was the only finding, so exit 1 was entirely spurious. Verbatim from a
// real build: dist/index.html of a site with a decorative aria-hidden hero.
check('bare alt (Astro\'s alt="") counts as present',
  hasAttr('src="/a.webp" alt sizes="90vw" aria-hidden="true"', 'alt') === true);
check('  …and imgsMissingAlt agrees',
  imgsMissingAlt('<img src="/a.webp" alt aria-hidden="true" width="16" height="9">').length === 0);
check('  …while a genuinely missing alt is still caught',
  imgsMissingAlt('<img src="/a.webp" width="16" height="9">').length === 1);
check('a bare attribute name does not match a longer one',
  hasAttr('widths="1"', 'width') === false);

// A site using BaseHead.astro rather than SEO.astro is not wrong. This used to
// emit required findings AND silently skip every meta:* check.
const headDir = tmpProject('rider-head-');
writeFileSync(join(headDir, 'package.json'), JSON.stringify({ name: 'fx', type: 'module', dependencies: { astro: '^7.1.6' } }));
writeFileSync(join(headDir, 'astro.config.mjs'), "export default { output: 'static' };\n");
mkdirSync(join(headDir, 'src', 'components'), { recursive: true });
mkdirSync(join(headDir, 'src', 'pages'), { recursive: true });
writeFileSync(join(headDir, 'src', 'components', 'BaseHead.astro'),
  '<link rel="canonical" href={u} />\n<meta property="og:type" content="website" />\n<meta property="og:url" content={u} />\n<meta property="og:image" content={i} />\n<meta property="og:image:width" content="1200" />\n<meta property="og:image:height" content="630" />\n');
writeFileSync(join(headDir, 'src', 'pages', 'index.astro'), '<p>hi</p>\n');
const headRun = runJson(headDir, ['-s', 'seo']);
const seoRows = headRun.json?.results.filter(r => r.section === 'seo') ?? [];
check('head meta found in BaseHead.astro (not just SEO.astro)',
  seoRows.find(r => r.name === 'SEO component')?.outcome === 'pass');
const META_NAMES = ['og:image','og:image:width','og:image:height','og:type','og:url','canonical'];
check('  …and every meta:* check actually ran',
  META_NAMES.every(n => seoRows.find(r => r.name === `meta:${n}`)?.outcome === 'pass'));

// The worst failure this tool can have: reporting *verified good* where nothing
// was checked. Bare-substring matching meant a component whose entire content
// was a TODO comment passed all six meta checks.
const todoDir = tmpProject('rider-todo-');
writeFileSync(join(todoDir, 'package.json'), JSON.stringify({ name: 'fx', type: 'module', dependencies: { astro: '^7.1.6' } }));
writeFileSync(join(todoDir, 'astro.config.mjs'), "export default { output: 'static' };\n");
mkdirSync(join(todoDir, 'src', 'components'), { recursive: true });
mkdirSync(join(todoDir, 'src', 'pages'), { recursive: true });
writeFileSync(join(todoDir, 'src', 'components', 'BaseHead.astro'),
  '---\n// TODO: emit og:image:width and og:image:height and og:type here.\n// Also rel="canonical" and og:url.\n---\n');
writeFileSync(join(todoDir, 'src', 'pages', 'index.astro'), '<p>hi</p>\n');
const todoRows = runJson(todoDir, ['-s', 'seo']).json?.results ?? [];
// og:image:width/height are a layout hint, so their absence is advice, not a
// defect — see META_TAGS in checks/seo.mjs. Everything else here is required.
const HINT_METAS = new Set(['og:image:width', 'og:image:height']);
const expectedMiss = (n) => (HINT_METAS.has(n) ? 'suggest' : 'fix');
check('a TODO comment does not satisfy any meta:* check',
  META_NAMES.every(n => todoRows.find(r => r.name === `meta:${n}`)?.outcome === expectedMiss(n)),
  JSON.stringify(todoRows.filter(r => r.name?.startsWith('meta:') && r.outcome !== 'fix')));
check('  …nor make the file count as a head-meta component',
  todoRows.find(r => r.name === 'SEO component')?.outcome === 'fix');

// …and a commented-out tag is not an emitted tag either.
writeFileSync(join(todoDir, 'src', 'components', 'BaseHead.astro'),
  '<title>t</title>\n<!-- <meta property="og:image" content="/a.png" /> -->\n/* <meta property="og:type" content="website" /> */\n');
const commentedRows = runJson(todoDir, ['-s', 'seo']).json?.results ?? [];
check('a commented-out meta tag does not count as emitted',
  ['og:image', 'og:type'].every(n => commentedRows.find(r => r.name === `meta:${n}`)?.outcome === 'fix'),
  JSON.stringify(commentedRows.filter(r => r.name?.startsWith('meta:') && r.outcome !== 'fix')));

const { stripComments } = await import('./lib/src-scan.mjs');
check('comment blanking preserves offsets and line count',
  stripComments('a // x\nb').length === 'a // x\nb'.length &&
  stripComments('a // x\nb').split('\n').length === 2);
check('  …and leaves a URL alone', /https:\/\/example\.com/.test(stripComments('const u = "https://example.com/x";')));

// Auditing a repo must never be equivalent to running it.
const rceDir = tmpProject('rider-rce-');
writeFileSync(join(rceDir, 'package.json'), JSON.stringify({ name: 'fx', type: 'module', dependencies: { astro: '^7.1.6' } }));
writeFileSync(join(rceDir, 'astro.config.mjs'), "export default { output: 'static' };\n");
mkdirSync(join(rceDir, 'scripts'), { recursive: true });
mkdirSync(join(rceDir, 'src', 'pages'), { recursive: true });
writeFileSync(join(rceDir, 'src', 'pages', 'index.astro'), '<p>hi</p>\n');
writeFileSync(join(rceDir, 'scripts', 'og.config.mjs'),
  "import { writeFileSync as w } from 'node:fs';\nw(new URL('./EXECUTED.txt', import.meta.url), 'x');\nexport const config = { brand: { siteName: 'S', siteUrl: 'https://s.test', tagline: 'T' } };\n");
runJson(rceDir, ['-s', 'seo']);
check('auditing a project does NOT execute its og.config.mjs',
  !existsSync(join(rceDir, 'scripts', 'EXECUTED.txt')));
const brandRows = runJson(rceDir, ['-s', 'seo']).json?.results ?? [];
check('  …and brand fields are still read from it',
  brandRows.find(r => r.name === 'brand.siteName')?.outcome === 'pass');

console.log('live domain runs against a served site (it had no coverage at all):');
// Both bugs this catches were scope errors that only surfaced on a real run: an
// undefined timeout constant and a `base` not in scope. The offline suite could
// not see them because it never executes live.mjs.
//
// The server must be its OWN process: runJson uses spawnSync, which blocks this
// process's event loop, so an in-process http server could never answer.
const srvDir = tmpProject('rider-srv-');
const srvFile = join(srvDir, 'server.mjs');
// A small site whose content lives at /wiki/, NOT /blog/. Discovery used to
// match `href=".../blog/..."` and nothing else, so on all five dogfood sites the
// whole post-only block silently never ran and the audit reported "clean".
writeFileSync(srvFile, `
import { createServer } from 'node:http';
const png = Buffer.concat([
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
  Buffer.from([0,0,0,13]), Buffer.from('IHDR'),
  Buffer.from([0,0,0x04,0xb0,0,0,0x02,0x76,8,6,0,0,0]),
]);
const head = (canonical, ld) => '<link rel="canonical" href="' + canonical + '"><title>t</title>'
  + '<meta name="description" content="d">'
  + '<meta property="og:title" content="t"><meta property="og:url" content="' + canonical + '">'
  + '<meta property="og:image" content="/og/card.png">'
  + '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
  + '<script type="application/ld+json">' + ld + '<\\/script>';
const home = '<!doctype html><html><head>' + head('/', '{"@type":"WebSite"}')
  + '<script src="/_astro/app.Ab12Cd34.js"><\\/script>'
  + '</head><body><h1>Home</h1><a href="/wiki">Wiki</a><a href="/wiki/kettle-clock">An entry</a></body></html>';
const entry = '<!doctype html><html><head>' + head('/wiki/kettle-clock', '{"@type":"TechArticle"}')
  + '</head><body><h1>Kettle clock</h1></body></html>';
const sitemapIndex = '<?xml version="1.0"?><sitemapindex><sitemap><loc>http://HOST/sitemap-0.xml</loc></sitemap></sitemapindex>';
const sitemap = '<?xml version="1.0"?><urlset><url><loc>http://HOST/</loc></url>'
  + '<url><loc>http://HOST/wiki</loc></url><url><loc>http://HOST/wiki/kettle-clock</loc></url></urlset>';
const srv = createServer((req, res) => {
  const host = req.headers.host;
  const send = (body, type) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    res.writeHead(200, { 'content-type': type, 'content-length': String(buf.length) });
    res.end(req.method === 'HEAD' ? undefined : buf);
  };
  const url = req.url.replace(/\\/$/, '') || '/';
  // Served no-cache, exactly as \`astro preview\` serves a hashed asset (measured).
  if (url.startsWith('/_astro/')) {
    const buf = Buffer.from('console.log(1)');
    res.writeHead(200, { 'content-type': 'text/javascript', 'content-length': String(buf.length), 'cache-control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : buf);
  }
  if (url.startsWith('/og/')) return send(png, 'image/png');
  if (url === '/sitemap-index.xml') return send(sitemapIndex.split('HOST').join(host), 'application/xml');
  if (url === '/sitemap-0.xml') return send(sitemap.split('HOST').join(host), 'application/xml');
  if (url === '/wiki/kettle-clock') return send(entry, 'text/html');
  if (url === '/') return send(home, 'text/html');
  res.writeHead(404, { 'content-type': 'text/html', 'content-length': '3' });
  res.end(req.method === 'HEAD' ? undefined : '404');
});
srv.listen(0, '127.0.0.1', function () { console.log(this.address().port); });
`);
const srv = spawn('node', [srvFile], { stdio: ['ignore', 'pipe', 'ignore'] });
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
  srv.stdout.once('data', (d) => { clearTimeout(timer); resolve(String(d).trim()); });
});
const live = runJson(tmpdir(), ['-s', 'live', '--url', `http://127.0.0.1:${port}`]);
const liveRows = live.json?.results ?? [];
check('live run completes without a tooling error', (live.json?.errors ?? ['?']).length === 0,
  JSON.stringify(live.json?.errors));
check('live actually produced findings', liveRows.length > 0, `${liveRows.length} rows`);
check('reachability is not blocked against a served site',
  !liveRows.find(r => r.name === 'reachability' && r.outcome === 'block'));
// The `project:offline-domains` notice is emitted before the live phase and is
// correctly tagged offline; everything the live domain itself reports is 'live'.
const fromLive = liveRows.filter(r => r.section !== 'project');
check('live rows are tagged source=live so --json keys do not collide',
  fromLive.length > 0 && fromLive.every(r => r.source === 'live'),
  JSON.stringify(fromLive.filter(r => r.source !== 'live').slice(0, 2)));

// The point of the /wiki/ shape: the post-only checks must actually run.
check('a content page outside /blog/ is discovered',
  liveRows.find(r => r.id === 'seo/post')?.outcome !== 'skip',
  JSON.stringify(liveRows.find(r => r.id === 'seo/post')));
check('  …so the post-only checks run on it',
  ['seo/title', 'seo/description', 'seo/og-title', 'data/post-jsonld']
    .every(id => liveRows.some(r => r.id === id)),
  JSON.stringify(liveRows.map(r => r.id)));
check('  …and TechArticle satisfies the Article-family shape',
  liveRows.find(r => r.id === 'data/post-jsonld')?.outcome === 'pass',
  JSON.stringify(liveRows.find(r => r.id === 'data/post-jsonld')));

// perf:cache:_astro against a local server that ignores _headers. Measured:
// `astro dev` and `astro preview` serve /_astro/* no-cache whatever the file
// says, while `wrangler dev` of the same build returns the immutable header —
// so the verdict must turn on the SERVER, not on being local. Reported as a
// finding that could not have gone any other way.
const IMMUTABLE_HEADERS = '/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n';
const withHeaders = mkBuilt({ 'public/_headers': IMMUTABLE_HEADERS });
const localCache = runJson(withHeaders, ['-s', 'live', '--strict', '--url', `http://127.0.0.1:${port}`])
  .json?.results.find(r => r.id === 'perf/cache-astro');
check('a local server serving /_astro/* no-cache, with _headers correct → skip, not a finding',
  localCache?.outcome === 'skip', JSON.stringify(localCache));

const noHeaders = mkBuilt({});
const noHeadersCache = runJson(noHeaders, ['-s', 'live', '--strict', '--url', `http://127.0.0.1:${port}`])
  .json?.results.find(r => r.id === 'perf/cache-astro');
check('  …while the same response with no _headers to explain it still fires',
  noHeadersCache?.outcome === 'fix', JSON.stringify(noHeadersCache));

// When discovery genuinely fails, the ⏭ must name what did not run — "clean"
// and "didn't check" have to be distinguishable in the output.
const noPost = runJson(tmpdir(), ['-s', 'live', '--url', `http://127.0.0.1:${port}/wiki/kettle-clock`]);
srv.kill();
const skipRow = noPost.json?.results.find(r => r.id === 'seo/post' && r.outcome === 'skip');
check('an undiscoverable content page names the skipped checks',
  skipRow != null && /seo\/title/.test(skipRow.message) && /data\/post-jsonld/.test(skipRow.message),
  JSON.stringify(skipRow));

console.log('optional browser domain degrades cleanly and the fonts check fires:');
// The browser domain must never become a hard requirement: without playwright
// installed it skips, and the run still exits 0.
const noPw = runJson(tmpdir(), ['-s', 'browser', '--url', 'https://example.com']);
const pwRow = noPw.json?.results.find(r => r.section === 'browser');
check('browser domain skips without playwright', pwRow?.outcome === 'skip', JSON.stringify(pwRow));
check('  …and the run still exits 0', noPw.code === 0, `exit ${noPw.code}`);

const fontDir = tmpProject('rider-font-');
writeFileSync(join(fontDir, 'package.json'), JSON.stringify({ name: 'fx', type: 'module', dependencies: { astro: '^7.1.6' } }));
writeFileSync(join(fontDir, 'astro.config.mjs'), "export default { output: 'static' };\n");
mkdirSync(join(fontDir, 'src', 'layouts'), { recursive: true });
writeFileSync(join(fontDir, 'src', 'layouts', 'Layout.astro'),
  '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">\n');
const fontRow = runJson(fontDir, ['-s', 'modules', '--strict']).json?.results.find(r => r.name === 'fonts');
check('font-CDN usage is flagged under --strict', fontRow?.outcome === 'fix', JSON.stringify(fontRow));
const fontLoose = runJson(fontDir, ['-s', 'modules']).json?.results.find(r => r.name === 'fonts');
check('  …and is advisory by default', fontLoose?.outcome === 'suggest');

// A declared family that can never paint. tasmanvisa-web put Inter second in
// the --font-sans stack behind a preloaded Sora: it could only render if Sora
// failed, and shipped eagerly on every page — 277 KB, 143 KB of it italic faces
// nothing referenced. Neither shows up in a byte total, because the total is
// right and the composition is wrong.
console.log('a declared family has to be one that can actually paint:');
const FONTS_CFG = (families) => `export default { output: 'static', fonts: [${families}] };\n`;
const SORA = `{ name: 'Sora', cssVariable: '--font-sans', styles: ['normal'] }`;
const INTER = `{ name: 'Inter', cssVariable: '--font-inter', styles: ['normal'] }`;
const fontProject = (config, css) => {
  const dir = tmpProject('rider-fam-');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx', type: 'module', dependencies: { astro: '^7.1.6' } }));
  writeFileSync(join(dir, 'astro.config.mjs'), config);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'index.html'), `<html><head><style>${css}</style></head><body><p>x</p></body></html>`);
  return dir;
};
const declaredFamRow = (config, css, id = 'perf/font-unused-family') =>
  runJson(fontProject(config, css), ['-s', 'perf', '--strict']).json?.results.find(r => r.id === id) ?? null;

const behind = declaredFamRow(FONTS_CFG(`${SORA}, ${INTER}`), 'body { font-family: var(--font-sans), var(--font-inter), sans-serif; }');
check('a family that only ever sits second in a stack → fix, naming it',
  behind?.outcome === 'fix' && /Inter/.test(behind.message ?? ''), JSON.stringify(behind));
check('  …while both leading their own stack → pass',
  declaredFamRow(FONTS_CFG(`${SORA}, ${INTER}`),
    'body { font-family: var(--font-sans), sans-serif; } code { font-family: var(--font-inter), monospace; }')?.outcome === 'pass');
check('  …and one declared but never referenced at all → suggest',
  declaredFamRow(FONTS_CFG(SORA), 'body { color: red; }')?.outcome === 'suggest');

// styles defaults to ['normal','italic'] — read off
// astro/dist/assets/fonts/constants.js, not recalled.
const implicitStyles = `{ name: 'Sora', cssVariable: '--font-sans' }`;
const noItalic = declaredFamRow(FONTS_CFG(implicitStyles), 'body { font-family: var(--font-sans), sans-serif; }', 'perf/font-styles');
check('a family with no styles, on a build that renders no italic → fix',
  noItalic?.outcome === 'fix' && /normal, italic/.test(noItalic.message ?? ''), JSON.stringify(noItalic));
// <em> renders italic from the UA stylesheet with no CSS at all, so asserting
// "no font-style: italic" would flag any blog with emphasis in its prose.
const emUsed = fontProject(FONTS_CFG(implicitStyles), 'body { font-family: var(--font-sans), sans-serif; }');
writeFileSync(join(emUsed, 'dist', 'index.html'), '<html><head><style>body { font-family: var(--font-sans), sans-serif; }</style></head><body><p>an <em>emphasis</em></p></body></html>');
check('  …but <em> in the built HTML makes it advisory, not a finding',
  runJson(emUsed, ['-s', 'perf', '--strict']).json?.results.find(r => r.id === 'perf/font-styles')?.outcome === 'suggest');
check('  …and declaring styles explicitly → pass',
  declaredFamRow(FONTS_CFG(SORA), 'body { font-family: var(--font-sans), sans-serif; }', 'perf/font-styles')?.outcome === 'pass');

console.log('the new practices fire on a known-bad build and stay quiet on a good one:');
// House style: advisory by default, binding under --strict. Both halves matter —
// a check that can only ever suggest never binds, and one that always binds
// fails the build of every stranger who does not share the opinion.
const MEDIA_OK = `<html><head><link rel="canonical" href="/media-kit"></head><body><h1>Media kit</h1>
  <p>${'x'.repeat(130)}</p>
  <a href="/brand/logo.svg" download>logo</a>
  <a href="mailto:press@example.test">press@example.test</a></body></html>`;
const DESIGN_OK = `<html><head><link rel="canonical" href="/design"></head><body><h1>Design</h1>
  <h2>Colour</h2><h2>Type</h2><h2>Buttons</h2><h2>Forms</h2>
  <span style="background: var(--c-bg)"></span><span style="background: var(--c-fg)"></span>
  <span style="background: var(--c-accent)"></span><span style="background: var(--c-border)"></span>
  <span style="background: #123456"></span></body></html>`;

const noPages = mkBuilt({ 'dist/index.html': '<html><body><h1>hi</h1></body></html>' });
for (const id of ['content/mediakit', 'content/designkit']) {
  check(`${id} suggests by default and binds under --strict`,
    runJson(noPages, ['-s', 'content']).json?.results.find(r => r.id === id)?.outcome === 'suggest' &&
    row(noPages, 'content', id)?.outcome === 'fix');
}
const good = mkBuilt({ 'dist/media-kit/index.html': MEDIA_OK, 'dist/design/index.html': DESIGN_OK });
check('a real media kit passes', row(good, 'content', 'content/mediakit')?.outcome === 'pass',
  JSON.stringify(row(good, 'content', 'content/mediakit')));
check('  …and a design page rendering tokens passes', row(good, 'content', 'content/designkit')?.outcome === 'pass',
  JSON.stringify(row(good, 'content', 'content/designkit')));
const stub = mkBuilt({
  'dist/press/index.html': '<html><body><h1>Press</h1><p>Email us.</p></body></html>',
  'dist/styleguide/index.html': '<html><body><h1>Styleguide</h1><p>Coming soon.</p></body></html>',
});
check('a media-kit page with no logo or boilerplate is not a pass',
  row(stub, 'content', 'content/mediakit')?.outcome === 'fix');
check('  …nor is a design page that is a stub',
  row(stub, 'content', 'content/designkit')?.outcome === 'fix');

// Astro's Fonts API emits a second @font-face per family carrying fallback
// metrics, and inlines the same block into every page. Counting either naively
// reported both real two-font sites as having four families.
const FACE = (fam) => `@font-face{font-family:"${fam}";src:url(/f/${fam}.woff2) format("woff2")}`;
const FALLBACK = (fam) => `@font-face{font-family:"${fam} fallback: Arial";src:local("Arial")}`;
const fontCss = [FACE('outfit-cce106cc3d487109'), FALLBACK('outfit-cce106cc3d487109'),
                 FACE('playfair-32c490a4574b0743'), FALLBACK('playfair-32c490a4574b0743')].join('\n');
const twoFonts = mkBuilt({
  'dist/index.html': `<html><head><style>${fontCss}</style></head><body><h1>a</h1></body></html>`,
  'dist/about/index.html': `<html><head><style>${fontCss}</style></head><body><h1>b</h1></body></html>`,
  'dist/f/outfit-cce106cc3d487109.woff2': 'x'.repeat(20 * 1024),
  'dist/f/playfair-32c490a4574b0743.woff2': 'x'.repeat(20 * 1024),
});
const famRow = row(twoFonts, 'perf', 'perf/font-families');
check('two families with Astro fallback faces, inlined on every page → 2, not 4',
  famRow?.outcome === 'pass' && /\b2 font families\b/.test(famRow?.message ?? ''), JSON.stringify(famRow));
const ttf = mkBuilt({ 'dist/index.html': '<html><body>x</body></html>', 'dist/f/x.ttf': 'x'.repeat(1024) });
check('a .ttf served to browsers is flagged (universal, not house style)',
  runJson(ttf, ['-s', 'perf']).json?.results.find(r => r.id === 'perf/font-format')?.outcome === 'fix');
const fatCss = mkBuilt({
  'dist/index.html': `<html><head><link rel="stylesheet" href="/a.css"></head><body>x</body></html>`,
  'dist/a.css': 'a{color:red}'.padEnd(300 * 1024, ' '),
});
check('260 KB of render-blocking CSS on one page → fix',
  runJson(fatCss, ['-s', 'perf']).json?.results.find(r => r.id === 'perf/css-bytes')?.outcome === 'fix');

console.log('the dogfood round-2 defects stay fixed:');
// Every one of these was found by an independent agent auditing a site it had
// built without reading this repo. Four of the five found the alt one.
const PAGE = (body) => `<html><head><link rel="canonical" href="/x"><title>t</title></head><body>${body}</body></html>`;

// De-duplicating by src let the FIRST occurrence decide the verdict for all of
// them — a silent false negative with exit 0.
const altMix = mkBuilt({
  'dist/index.html': '<html><body><img src="/a.webp" alt="described" width="16" height="9"></body></html>',
  'dist/post/index.html': '<html><body><img src="/a.webp" width="16" height="9"></body></html>',
});
const altRow = runJson(altMix, ['-s', 'images']).json?.results.find(r => r.id === 'images/alt' && r.outcome === 'fix');
check('an image with alt on one page and without on another is still caught',
  altRow != null && altRow.file === 'dist/post/index.html', JSON.stringify(altRow));

// dist:size judges a responsive image as a LADDER. Reported by tasmanvisa-web:
// the top rung of a srcset is flagged though no phone downloads it, and Astro
// emits the intrinsic width unconditionally — so the only way to comply was to
// downscale the source and degrade retina desktop.
console.log('dist:size judges the ladder, not the rung:');
const KB = (n) => 'x'.repeat(n * 1024);
const sizeRows = (dir) => runJson(dir, ['-s', 'images', '--strict']).json?.results
  .filter(r => r.id === 'images/dist-size') ?? [];

// The real numbers from the report: 67 / 138 / 227 / 333 KB, only the top over.
const ladder = mkBuilt({
  'dist/_astro/i_640.webp': KB(67),
  'dist/_astro/i_960.webp': KB(138),
  'dist/_astro/i_1280.webp': KB(227),
  'dist/_astro/i_1600.webp': KB(333),
  'dist/index.html': PAGE('<img src="/_astro/i_1600.webp" srcset="/_astro/i_640.webp 640w, /_astro/i_960.webp 960w, /_astro/i_1280.webp 1280w, /_astro/i_1600.webp 1600w" alt="a">'),
});
check('a srcset whose top rung is over budget → pass (the phone gets 67 KB)',
  sizeRows(ladder).every(r => r.outcome === 'pass'), JSON.stringify(sizeRows(ladder)));

const fatLadder = mkBuilt({
  'dist/_astro/f_800.webp': KB(420),
  'dist/_astro/f_1600.webp': KB(780),
  'dist/index.html': PAGE('<img src="/_astro/f_1600.webp" srcset="/_astro/f_800.webp 800w, /_astro/f_1600.webp 1600w" alt="a">'),
});
const fatRow = sizeRows(fatLadder).find(r => r.outcome === 'fix');
check('  …while a ladder whose SMALLEST rung is over budget → fix, pointing at that rung',
  fatRow != null && /420 KB/.test(fatRow.message ?? '') && fatRow.file === 'dist/_astro/f_800.webp',
  JSON.stringify(fatRow));

const solo = mkBuilt({
  'dist/_astro/solo.webp': KB(900),
  'dist/index.html': PAGE('<img src="/_astro/solo.webp" alt="a">'),
});
check('  …and a single image in no srcset is still judged on its own bytes',
  sizeRows(solo).some(r => r.outcome === 'fix' && r.file === 'dist/_astro/solo.webp'),
  JSON.stringify(sizeRows(solo)));

// Heavy third-party embeds. cypruspokerbrisbane.com sat at mobile Performance
// 70 because a Maps iframe in the second section pulled ~360 KB across ~20
// requests; a facade took it to 97. `loading="lazy"` was present the whole time.
console.log('a heavy third-party embed is only invisible behind a facade:');
const embedRow = (files) => runJson(mkBuilt(files), ['-s', 'perf', '--strict']).json?.results
  .find(r => r.id === 'perf/embed-eager') ?? null;

const maps = embedRow({ 'dist/index.html': PAGE('<iframe src="https://www.google.com/maps?q=x&output=embed" loading="lazy"></iframe>') });
check('a Maps embed in the built HTML → fix, even with loading="lazy"',
  maps?.outcome === 'fix' && /lazy/.test(maps.message ?? ''), JSON.stringify(maps));
check('  …and a YouTube embed too',
  embedRow({ 'dist/index.html': PAGE('<iframe src="https://www.youtube.com/embed/abc"></iframe>') })?.outcome === 'fix');

// The compliant pattern must not read as the defect: a facade keeps the real
// frame in an inert <template>, and <noscript> is its no-JS fallback.
check('  …while the same frame inside <template> (a facade) → pass',
  embedRow({ 'dist/index.html': PAGE('<div class="map-facade"></div><template><iframe src="https://www.youtube.com/embed/abc"></iframe></template>') })?.outcome === 'pass');
check('  …and inside <noscript> → pass',
  embedRow({ 'dist/index.html': PAGE('<noscript><iframe src="https://www.youtube.com/embed/abc"></iframe></noscript>') })?.outcome === 'pass');
check('  …and a same-origin iframe is not the tool\'s business',
  embedRow({ 'dist/index.html': PAGE('<iframe src="/widgets/toc.html"></iframe>') })?.outcome === 'pass');

// A stuck PSI score is not diagnosable on its own, and calling a bad one "lab
// noise" is a real failure mode: cypruspokerbrisbane's 5.5s LCP was dismissed
// as a harness artifact when the cause was a 360 KB Maps iframe. These are the
// three fields that settled it, which the check used to discard.
//
// Parsing is asserted against a hand-built response in the documented PSI shape.
// It does NOT cover the API call — this box has no $PAGESPEED_API_KEY.
console.log('the PSI score comes with what it means:');
const { reportDiagnostics } = await import('./checks/lighthouse.mjs');
const collect = () => {
  const rows = [];
  const push = (outcome) => (section, name, message, fix) => rows.push({ outcome, name, message, fix });
  return { rows, pass: push('pass'), fix: push('fix'), suggest: push('suggest'), skip: push('skip') };
};
// Two shapes, because Lighthouse renamed this family and PSI serves whatever
// its deployed version emits. Reading only one set is not a loud failure — it is
// a permanent ⏭, which reads exactly like "this page is fine". A live run on
// 2026-08-03 returned ONLY the *-insight ids; the legacy ones were absent.
const PSI_LEGACY = {
  audits: {
    'largest-contentful-paint': { numericValue: 5500 },
    'first-contentful-paint': { numericValue: 3500 },
    'largest-contentful-paint-element': { details: { items: [{ node: { snippet: '<img src="/hero.webp">' } }] } },
    'third-party-summary': { details: { items: [
      { entity: 'Google Maps', transferSize: 368640, blockingTime: 120 },
      { entity: 'Google Fonts', transferSize: 40960, blockingTime: 0 },
    ] } },
    metrics: { details: { items: [{ observedFirstContentfulPaint: 1500, observedLargestContentfulPaint: 2000 }] } },
  },
};
// Trimmed from a real PSI response (wishbusterz.com, mobile, 2026-08-03), with
// the failing-checklist entry flipped so the failure path is covered too.
const PSI_INSIGHT = {
  audits: {
    'largest-contentful-paint': { numericValue: 5500 },
    'first-contentful-paint': { numericValue: 3500 },
    'lcp-discovery-insight': { details: { type: 'list', items: [
      { type: 'checklist', items: {
        priorityHinted: { value: true, label: 'fetchpriority=high applied' },
        eagerlyLoaded: { value: false, label: 'LCP resources should not use loading=lazy' },
        requestDiscoverable: { value: true, label: 'Request is discoverable in initial document' },
      } },
      { nodeLabel: 'Hero', snippet: '<img src="/_astro/hero.webp" alt="A long alt that would eat the truncation budget on its own" data-astro-cid-nlow4r3u="true" loading="lazy" fetchpriority="low" width="1200" height="630">' },
    ] } },
    'third-parties-insight': { details: { type: 'table', items: [
      { entity: 'Google Maps', transferSize: 368640, mainThreadTime: 120 },
      { entity: 'Google Fonts', transferSize: 40960, mainThreadTime: 4 },
    ] } },
    metrics: { details: { items: [{ observedFirstContentfulPaint: 1500, observedLargestContentfulPaint: 2000 }] } },
  },
};
const diag = collect();
reportDiagnostics(PSI_INSIGHT, diag, 'mobile');
const byName = (frag) => diag.rows.find(r => r.name.includes(frag)) ?? null;
check('the LCP element is named, not just the number',
  /hero\.webp/.test(byName('lcp:element')?.message ?? ''), JSON.stringify(byName('lcp:element')));
// Raw-truncating the snippet spent the whole budget on src/alt/data-astro-cid
// and cut off at `loa…`, dropping the one attribute worth reading. Found by
// dogfooding against a real site, not by the fixtures.
const lcpMsg = byName('lcp:element')?.message ?? '';
check('  …summarised by the attributes that explain it, not by truncating the tag',
  /loading=/.test(lcpMsg) && /fetchpriority/.test(lcpMsg) && !/data-astro-cid/.test(lcpMsg), lcpMsg);
check('  …naming an absent attribute rather than omitting it, so silence is not ambiguous',
  /no sizes/.test(lcpMsg), lcpMsg);
check('  …the heaviest third parties are listed, largest first',
  /Google Maps 360 KB/.test(byName('third-party:payload')?.message ?? ''), JSON.stringify(byName('third-party:payload')));
check('  …and simulated is shown against observed, which is what tells the two cases apart',
  /3500 ms simulated \/ 1500 ms observed/.test(byName('metrics:observed')?.message ?? ''),
  JSON.stringify(byName('metrics:observed')));
check('  …the LCP discovery checklist names what is failing, in Lighthouse\'s own words',
  /loading=lazy/.test(byName('lcp:element')?.message ?? ''), JSON.stringify(byName('lcp:element')));
check('  …all three advisory: a diagnosis is a fact about the run, not a verdict',
  diag.rows.every(r => r.outcome === 'suggest' || r.outcome === 'skip'), JSON.stringify(diag.rows.map(r => r.outcome)));

// The legacy ids must keep working — PSI serves whatever Lighthouse it runs.
const legacy = collect();
reportDiagnostics(PSI_LEGACY, legacy, 'mobile');
const legacyBy = (frag) => legacy.rows.find(r => r.name.includes(frag)) ?? null;
check('  …and the pre-rename audit ids parse identically, so an older PSI is not a silent ⏭',
  /hero\.webp/.test(legacyBy('lcp:element')?.message ?? '')
  && /Google Maps 360 KB/.test(legacyBy('third-party:payload')?.message ?? ''),
  JSON.stringify(legacy.rows.map(r => [r.name, r.outcome])));

const empty = collect();
reportDiagnostics({ audits: {} }, empty, 'mobile');
check('  …and a response carrying none of it skips, naming what was absent',
  empty.rows.length === 3 && empty.rows.every(r => r.outcome === 'skip' && r.message),
  JSON.stringify(empty.rows));

// headings:order reported dist/wiki/index.html when the skipped level was
// written in a shared component. The built page is the artifact; the component
// is what someone has to edit.
console.log('a heading finding points at the component that wrote it:');
const SKIPPED = '<html><head><link rel="canonical" href="/x"></head><body>'
  + '<h1>Page</h1><h2>Section</h2><h4>Buried subsection</h4></body></html>';
const headingRow = (src) => runJson(mkBuilt({ 'dist/index.html': SKIPPED }, { src }), ['-s', 'seo'])
  .json?.results.find(r => r.id === 'seo/headings-order') ?? null;

const traced = headingRow({ 'src/components/Aside.astro': '<div>\n  <h4>Buried subsection</h4>\n</div>\n' });
check('a skipped level traced to the one component that emits it → file:line',
  /src\/components\/Aside\.astro:2/.test(traced?.message ?? ''), JSON.stringify(traced));
check('  …and it still names the built page it showed up on',
  /dist\/index\.html/.test(traced?.message ?? ''));

// A confidently wrong pointer is worse than the artifact path, so ambiguity and
// absence both fall back to the built page.
const ambiguous = headingRow({
  'src/components/A.astro': '<h4>Buried subsection</h4>\n',
  'src/components/B.astro': '<h4>Buried subsection</h4>\n',
});
check('  …while two components matching the same text → no source claimed',
  !/src\/components/.test(ambiguous?.message ?? '') && /dist\/index\.html/.test(ambiguous?.message ?? ''),
  JSON.stringify(ambiguous));
check('  …and an interpolated heading, which has no literal to find, keeps the page',
  /dist\/index\.html/.test(headingRow({ 'src/components/C.astro': '<h4>{title}</h4>\n' })?.message ?? ''));

// The two Astro 7 changes that broke tasmanvisa-web both build clean, typecheck
// clean, and ship visibly wrong output. Neither is something a person reliably
// catches by reading a 333-page guide.
console.log('the Astro 7 changes that build clean and ship wrong:');
const v7 = (config, tsconfig) => {
  const dir = tmpProject('rider-v7c-');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx', type: 'module', dependencies: { astro: '^7.1.6' } }));
  writeFileSync(join(dir, 'astro.config.mjs'), config);
  if (tsconfig) writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig));
  return runJson(dir, ['-s', 'modules', '--strict']).json?.results ?? [];
};
const v7row = (id, config, tsconfig) => v7(config, tsconfig).find(r => r.id === id) ?? null;

// Measured on astro@7.1.6: with compressHTML unset, `the website\n<a>x</a>.`
// builds as `the websitex.`; with compressHTML: true the space survives.
const unset = v7row('modules/compresshtml', "export default { output: 'static' };\n");
check('compressHTML unset on Astro 7 → fix, naming the new default',
  unset?.outcome === 'fix' && /jsx/.test(unset.message ?? ''), JSON.stringify(unset));
check('  …and set explicitly → pass, whichever value',
  v7row('modules/compresshtml', "export default { output: 'static', compressHTML: true };\n")?.outcome === 'pass'
  && v7row('modules/compresshtml', "export default { output: 'static', compressHTML: 'jsx' };\n")?.outcome === 'pass');
const v6 = tmpProject('rider-v6c-');
writeFileSync(join(v6, 'package.json'), JSON.stringify({ name: 'fx', type: 'module', dependencies: { astro: '^6.3.7' } }));
writeFileSync(join(v6, 'astro.config.mjs'), "export default { output: 'static' };\n");
check('  …and it does not fire on Astro 6, whose default is still true',
  runJson(v6, ['-s', 'modules', '--strict']).json?.results.find(r => r.id === 'modules/compresshtml') === undefined);

// astro check type-checking dist/ produced ~70 spurious warnings out of a built
// chart.js on cypruspokerbrisbane, and 0/0/0 once dist was excluded again.
const STRICT_TS = { extends: 'astro/tsconfigs/strict' };
check('a tsconfig whose own exclude drops dist → fix',
  v7row('modules/tsconfig-exclude-dist', "export default {};\n", { ...STRICT_TS, exclude: ['tests'] })?.outcome === 'fix');
check('  …while one that keeps it → pass',
  v7row('modules/tsconfig-exclude-dist', "export default {};\n", { ...STRICT_TS, exclude: ['tests', 'dist'] })?.outcome === 'pass');
check('  …and no exclude at all is fine — astro/tsconfigs already excludes dist',
  v7row('modules/tsconfig-exclude-dist', "export default {};\n", STRICT_TS)?.outcome === 'pass');

// Sätteri and remark disagree on an ambiguous straight quote: six Hungarian
// posts shipped „bespoke“ where the pairing is „…”. Advisory in every mode,
// because correct prose can mix the two as well.
const quoteRow = (md) => {
  const dir = mkBuilt({ 'src/data/blog/a.md': md });
  return runJson(dir, ['-s', 'content', '--strict']).json?.results.find(r => r.id === 'content/quotes-ambiguous') ?? null;
};
const mixed = quoteRow('---\ntitle: t\n---\n\nA „bespoke" service for everyone.\n');
check('a straight quote sharing a line with a directional one → suggest, never a finding',
  mixed?.outcome === 'suggest', JSON.stringify(mixed));
check('  …and it stays advisory under --strict, which is the whole point',
  mixed?.outcome !== 'fix' && mixed?.outcome !== 'block');
check('  …while straight quotes alone are not ambiguous',
  quoteRow('---\ntitle: t\n---\n\nA "bespoke" service.\n')?.outcome === 'pass');
check('  …and a fenced code block is not prose',
  quoteRow('---\ntitle: t\n---\n\nSome „prose”.\n\n```js\nconst a = "x";\n```\n')?.outcome === 'pass');
// Both found by dogfood round 3, which put 19 findings on one real site — every
// one of them a possessive apostrophe inside a quoted YAML description.
check('  …nor is YAML frontmatter, whose values are delimited by straight quotes',
  quoteRow('---\ndescription: "the final everyone’s been waiting for"\n---\n\nPlain body.\n')?.outcome === 'pass');
check('  …and an apostrophe is not a quotation mark',
  quoteRow('---\ntitle: t\n---\n\nHere’s the "seating chart" for day one.\n')?.outcome === 'pass');

// A CSS background gets neither srcset nor lazy loading, so a pinned width is
// what every device downloads. tasmanvisa-web had QuoteCTA pinned at width=1600
// for a 393px viewport: ~1.1 MB on the home page, audited `images ✅ all`.
console.log('a CSS background can use neither srcset nor lazy loading:');
const bgRow = (css) => runJson(mkBuilt({ 'src/components/X.astro': css }), ['-s', 'images', '--strict'])
  .json?.results.find(r => r.id === 'images/background-image-fixed-width') ?? null;

const pinned = bgRow('<style>.cta { background-image: url("/cdn-cgi/image/width=1600,format=auto/hero.jpg"); }</style>');
check('a background pinned to width=1600 → fix, naming the width',
  pinned?.outcome === 'fix' && /width=1600/.test(pinned.message ?? ''), JSON.stringify(pinned));
check('  …the ?w= and /w_N/ spellings too',
  bgRow('<style>.a { background: url("https://media.x.test/a.jpg?w=1600"); }</style>')?.outcome === 'fix'
  && bgRow('<style>.b { background-image: url("https://res.x.test/w_1280/a.jpg"); }</style>')?.outcome === 'fix');
check('  …while image-set() is exempt (it does DPR selection at least)',
  bgRow('<style>.c { background-image: image-set(url("/cdn-cgi/image/width=1600/a.jpg") 1x, url("/cdn-cgi/image/width=3200/a.jpg") 2x); }</style>')?.outcome === 'pass');
check('  …and a small decorative texture is not worth a finding',
  bgRow('<style>.d { background-image: url("/cdn-cgi/image/width=320,format=auto/dots.png"); }</style>')?.outcome === 'pass');

// Cross-origin images. tasmanvisa-web served every hero and card from
// media.tasmanvisa.com with no preconnect: blog index LCP 5424 ms, ~3500 ms once
// a preconnect and a matching preload were added. The audit passed perf ✅ all.
console.log('a cross-origin image host needs its connection opened early:');
const CANON = '<link rel="canonical" href="https://x.test/">';
const perfRows = (body, head = '') => runJson(
  mkBuilt({ 'dist/index.html': `<html><head>${CANON}${head}</head><body>${body}</body></html>` }),
  ['-s', 'perf', '--strict'],
).json?.results ?? [];
const perfRow = (id, body, head) => perfRows(body, head).find(r => r.id === id) ?? null;

const TWO_REMOTE = '<img src="https://media.x.test/a.webp" alt="a"><img src="https://media.x.test/b.webp" alt="b">';
const noPre = perfRow('perf/preconnect', TWO_REMOTE);
check('two images from another origin with no preconnect → fix, naming the origin',
  noPre?.outcome === 'fix' && /https:\/\/media\.x\.test/.test(noPre.message ?? ''), JSON.stringify(noPre));
check('  …while a single incidental image from one → suggest, not a build failure',
  perfRow('perf/preconnect', '<img src="https://media.x.test/a.webp" alt="a">')?.outcome === 'suggest');
check('  …and same-origin images need nothing',
  perfRow('perf/preconnect', '<img src="/local.webp" alt="a">')?.outcome === 'pass');

// The trap: a preconnect that looks like the fix and is not.
const bare = perfRow('perf/preconnect-crossorigin', TWO_REMOTE, '<link rel="preconnect" href="https://media.x.test">');
check('a preconnect with no crossorigin → fix (images cannot reuse that connection)',
  bare?.outcome === 'fix', JSON.stringify(bare));
check('  …and with it → pass, with the preconnect check satisfied too',
  perfRow('perf/preconnect-crossorigin', TWO_REMOTE, '<link rel="preconnect" href="https://media.x.test" crossorigin>')?.outcome === 'pass'
  && perfRow('perf/preconnect', TWO_REMOTE, '<link rel="preconnect" href="https://media.x.test" crossorigin>')?.outcome === 'pass');

// A preload that disagrees with its <img> downloads the image twice.
const IMG = '<img src="/h.webp" srcset="/h-800.webp 800w, /h-1600.webp 1600w" sizes="(max-width: 700px) 100vw, 700px" alt="h">';
const mismatched = perfRow('perf/preload-pair', IMG,
  '<link rel="preload" as="image" imagesrcset="/h-800.webp 800w, /h-1600.webp 1600w" imagesizes="100vw">');
check('a preload as="image" whose imagesizes differ from the tag → fix',
  mismatched?.outcome === 'fix' && /imagesizes/.test(mismatched.message ?? ''), JSON.stringify(mismatched));
check('  …while a byte-identical pair reports nothing',
  perfRow('perf/preload-pair', IMG,
    '<link rel="preload" as="image" imagesrcset="/h-800.webp 800w, /h-1600.webp 1600w" imagesizes="(max-width: 700px) 100vw, 700px">') === null);

// A pass with no message is indistinguishable from a check that never ran —
// the failure mode this tool cares most about. Asserted as an invariant rather
// than per-check, so a new check cannot reintroduce it.
const fixturePasses = fix.json?.results.filter(r => r.outcome === 'pass') ?? [];
const mute = fixturePasses.filter(r => !r.message).map(r => `${r.section}:${r.name}`);
check(`every one of the ${fixturePasses.length} passes on the fixture says what it looked at`,
  mute.length === 0, mute.join(', '));

// A whole-file /z\.object\(/ passed two collections where only one had a schema,
// and passed a file whose only mention of Zod was in a comment.
const SCHEMA_CONFIG = `import { defineCollection, z } from 'astro:content';
const blog = defineCollection({ loader: glob({}), schema: z.object({ title: z.string() }) });
const wiki = defineCollection({ loader: glob({}) });
export const collections = { blog, wiki };`;
const halfSchema = mkBuilt({ 'src/content.config.ts': SCHEMA_CONFIG });
const schemaRow = row(halfSchema, 'data', 'data/content-schema');
check('one collection of two with no schema → fix, naming it',
  schemaRow?.outcome === 'fix' && /wiki/.test(schemaRow?.message ?? ''), JSON.stringify(schemaRow));
const commentSchema = mkBuilt({
  'src/content.config.ts': "import { defineCollection } from 'astro:content';\n// TODO: add schema: z.object({ title: z.string() })\nconst blog = defineCollection({ loader: glob({}) });\nexport const collections = { blog };",
});
check('  …and a schema mentioned only in a comment does not count',
  row(commentSchema, 'data', 'data/content-schema')?.outcome === 'fix');

// "More than zero" was the bar for both of these.
const thinLd = mkBuilt({
  'dist/index.html': PAGE('') .replace('</head>', '<script type="application/ld+json">{"@type":"WebSite"}<\/script></head>'),
  'dist/a/index.html': PAGE('<p>a</p>'),
  'dist/b/index.html': PAGE('<p>b</p>'),
});
check('JSON-LD on 1 page of 3 is not a pass',
  runJson(thinLd, ['-s', 'data']).json?.results.find(r => r.id === 'data/jsonld-emitted')?.outcome === 'suggest');

// The canonical check used to define its own denominator as "pages that have a
// canonical", so deleting canonical from every page but one reported 1/1 ✅.
const thinCanonical = mkBuilt({
  'dist/index.html': '<html><head><link rel="canonical" href="/"><title>t</title></head><body><h1>a</h1></body></html>',
  'dist/a/index.html': '<html><head><title>t</title></head><body><h1>a</h1></body></html>',
  'dist/b/index.html': '<html><head><title>t</title></head><body><h1>b</h1></body></html>',
});
check('a canonical on 1 page of 3 is not a pass',
  runJson(thinCanonical, ['-s', 'seo']).json?.results.find(r => r.id === 'seo/meta-canonical')?.outcome === 'suggest');

// Presence-only passed a site whose every page claimed one canonical URL.
const sameCanonical = mkBuilt(Object.fromEntries(
  ['index', 'a/index', 'b/index', 'c/index'].map(n =>
    [`dist/${n}.html`, '<html><head><link rel="canonical" href="https://x.test/"><title>t</title></head><body><h1>x</h1></body></html>'])));
check('every page declaring the same canonical URL is reported',
  runJson(sameCanonical, ['-s', 'seo']).json?.results.find(r => r.id === 'seo/canonical-unique')?.outcome === 'suggest');

// A scan that opened nothing is not a clean bill of health.
const emptyProject = tmpProject('rider-empty-');
writeFileSync(join(emptyProject, 'package.json'), JSON.stringify({ name: 'fx', type: 'module', dependencies: { astro: '^7.1.6' } }));
writeFileSync(join(emptyProject, 'astro.config.mjs'), "export default { output: 'static' };\n");
check('analytics does not pass on a project with nothing to scan',
  runJson(emptyProject, ['-s', 'analytics']).json?.results.find(r => r.id === 'analytics/no-hardcoded-ga')?.outcome === 'skip');

console.log('the starter is the baseline, made copyable:');
// The anti-drift mechanism. examples/starter/ is what create-mode copies, and
// the checks are what define the baseline — so if a check changes and the
// starter stops complying, this goes red on the same commit rather than months
// later when someone scaffolds from it.
//
// Deliberately cheap: no npm install, no build. Unbuilt, most dist/-reading
// checks ⏭ — the CI matrix builds both sites and audits them properly. What
// this catches is the source-level regression, on every run, in a second.
const STARTER = join(here, '..', 'examples', 'starter');
for (const mode of [[], ['--strict']]) {
  const label = mode.length ? '--strict' : 'default';
  const run = runJson(STARTER, mode);
  const s = run.json?.summary;
  check(`the unbuilt starter has no required findings (${label})`,
    s?.fix === 0 && s?.block === 0, JSON.stringify(s));
  check(`  …and exits 0 (${label})`, run.code === 0, `exit ${run.code}`);
}
// The starter must actually install what the baseline asks for. Reading it off
// the check rather than a second list is the point: add a baseline dep and this
// fails until the starter has it.
const { BASELINE_DEPS } = await import('./checks/modules.mjs');
const starterPkg = JSON.parse(readFileSync(join(STARTER, 'package.json'), 'utf8'));
const starterDeps = { ...starterPkg.dependencies, ...starterPkg.devDependencies };
const missingBaseline = BASELINE_DEPS.filter((d) => !starterDeps[d]);
check('the starter installs every baseline dependency',
  missingBaseline.length === 0, missingBaseline.join(', '));
// It is the thing create-mode copies, so it must not carry an invented secret.
check('  …and ships no invented token or credential',
  /cloudflareAnalyticsToken:\s*null/.test(readFileSync(join(STARTER, 'scripts', 'og.config.mjs'), 'utf8')));

console.log('analytics is reported, never demanded:');
// The invariant the 2026-08-03 softening rests on. `analytics/provider` answers
// "what delivers analytics here" — including "nothing" — and must never fail a
// run, in either mode. Assert it rather than trust it: reporter.suggest() has no
// this.strict reference today, and a future refactor that gave it one would turn
// every site with no analytics into a build failure without a single test going
// red. Checked under --strict, which is the mode that would break it.
const noAnalytics = mkBuilt({ 'dist/index.html': '<html><head><title>t</title></head><body><h1>t</h1></body></html>' });
for (const mode of [[], ['--strict']]) {
  const label = mode.length ? '--strict' : 'default';
  const rows = runJson(noAnalytics, ['-s', 'analytics', ...mode]).json?.results ?? [];
  const provider = rows.find(r => r.id === 'analytics/provider');
  check(`a site with no analytics at all still gets 💡, not a finding (${label})`,
    provider?.outcome === 'suggest', JSON.stringify(provider));
}
// The whole-suite version: nothing anywhere may promote this rule.
const strictAnalytics = runJson(FIXTURE, ['--strict']).json?.results
  .filter(r => r.id === 'analytics/provider') ?? [];
check('  …and no analytics/provider row is ever fix/block under --strict',
  strictAnalytics.length > 0 && strictAnalytics.every(r => r.outcome !== 'fix' && r.outcome !== 'block'),
  JSON.stringify(strictAnalytics));
// The fixture wires the beacon behind a null token, so it is the standing
// example of "wired but no data flows" — a 💡 that is honest and permanent.
check('  …and the fixture reports its beacon as wired-but-unset',
  strictAnalytics.some(r => r.outcome === 'suggest' && /token/i.test(r.message ?? '')),
  JSON.stringify(strictAnalytics));
// Comments must not satisfy the positive check. This is the third time this
// class of bug has been fixed in this repo (meta tags, then content schemas).
const commentOnly = mkBuilt({}, { src: {
  'src/pages/index.astro': '---\n// TODO: add the static.cloudflareinsights.com/beacon.min.js script\n---\n<p>hi</p>\n',
} });
const commented = row(commentOnly, 'analytics', 'analytics/provider');
check('a beacon named only in a comment is not wiring',
  commented?.outcome === 'suggest' && !/wired/.test(commented?.message ?? ''), JSON.stringify(commented));

console.log('--rules is the catalogue, and it does not drift:');
// The catalogue is what an agent reads to learn what this tool checks. If a
// check can fire with an id the catalogue doesn't list, the catalogue is a lie.
const { ruleCatalogue, knownRuleIds } = await import('./lib/rules.mjs');
const catalogue = ruleCatalogue();
check('--rules --json lists rules with id, severity and a reason',
  catalogue.length > 50 && catalogue.every(r => r.id && r.why && ['universal', 'house', 'advisory'].includes(r.severity)));
const rulesRun = spawnSync('node', [AUDIT, '--rules', '--json'], { cwd: tmpdir(), encoding: 'utf8' });
check('  …and it runs outside an Astro project', rulesRun.status === 0, `exit ${rulesRun.status}`);
const known = knownRuleIds();
const uncatalogued = [...seenRuleIds].filter(id => !known.has(id)).sort();
check(`every rule id emitted by this suite is catalogued (${seenRuleIds.size} seen)`,
  uncatalogued.length === 0, uncatalogued.join(', '));

console.log('');
if (failures === 0) { console.log('PASS — all assertions ok'); process.exit(0); }
else { console.log(`FAIL — ${failures} assertion(s) failed`); process.exit(1); }
