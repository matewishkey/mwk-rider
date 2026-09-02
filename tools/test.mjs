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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
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

// An out-of-flow image cannot shift the page, and inset/height:100% override the
// ratio box width/height would create — so demanding them is cargo cult. This is
// the shape rider's own background-image advice produces, and it fired 20 times
// on a page its browser domain measured at CLS 0.001.
const flowDir = tmpProject('rider-cls-flow-');
writeFileSync(join(flowDir, 'package.json'), JSON.stringify({ name: 'fx', type: 'module', dependencies: { astro: '^7.1.6' } }));
writeFileSync(join(flowDir, 'astro.config.mjs'), "export default { output: 'static' };\n");
mkdirSync(join(flowDir, 'src', 'components'), { recursive: true });
mkdirSync(join(flowDir, 'src', 'pages'), { recursive: true });
writeFileSync(join(flowDir, 'src', 'pages', 'index.astro'), '<p>x</p>\n');
writeFileSync(join(flowDir, 'src', 'components', 'CoverImage.astro'),
  '<div class="frame"><img class="cover-image" src="/hero.png" alt="" loading="lazy"></div>\n'
  + '<style>\n.frame { position: relative; aspect-ratio: 16/9; }\n.cover-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }\n</style>\n');
const flowRows = runJson(flowDir, ['-s', 'perf']).json?.results ?? [];
const flowRow = flowRows.find(r => r.id === 'perf/cls-img-dimensions');
check('an absolutely-positioned fill image is not a CLS finding',
  flowRow?.outcome === 'pass' && /absolutely positioned/.test(flowRow?.message ?? ''), JSON.stringify(flowRow));
// The carve-out has to stay narrow: the same tag with the positioning rule
// removed is still the defect the check exists for.
writeFileSync(join(flowDir, 'src', 'components', 'CoverImage.astro'),
  '<div class="frame"><img class="cover-image" src="/hero.png" alt="" loading="lazy"></div>\n'
  + '<style>\n.cover-image { width: 100%; object-fit: cover; }\n</style>\n');
check('  …while the same image in normal flow still is',
  runJson(flowDir, ['-s', 'perf']).json?.results.find(r => r.id === 'perf/cls-img-dimensions')?.outcome === 'fix');

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

// WebP is what an Astro build is actually made of, so images:srcset:missing can
// read the width of almost nothing without it. All three container shapes, from
// the RIFF spec. Verified against 131 real build artifacts by comparing each
// parsed width to the `768w` descriptor Astro independently wrote for it.
const RIFF = (chunk, payload) => {
  const head = [...'RIFF'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map(c => c.charCodeAt(0)), [...chunk].map(c => c.charCodeAt(0)), [0, 0, 0, 0]);
  return Uint8Array.from(head.concat(payload)).buffer;
};
// Lossy: 3-byte frame tag + 3-byte start code, then 14-bit LE width and height.
const webpLossy = (w, h) => RIFF('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, w & 255, (w >> 8) & 0x3f, h & 255, (h >> 8) & 0x3f]);
// Lossless: 0x2f signature, then (width-1, height-1) as 14 bits each, packed LE.
const webpLossless = (w, h) => {
  const v = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return RIFF('VP8L', [0x2f, v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255, 0, 0, 0, 0, 0]);
};
// Extended: flags + reserved, then canvas (width-1, height-1) as 24-bit LE.
const webpExtended = (w, h) => RIFF('VP8X', [0x10, 0, 0, 0,
  (w - 1) & 255, ((w - 1) >> 8) & 255, ((w - 1) >> 16) & 255,
  (h - 1) & 255, ((h - 1) >> 8) & 255, ((h - 1) >> 16) & 255]);
for (const [name, bytes] of [['VP8 lossy', webpLossy(1600, 900)], ['VP8L lossless', webpLossless(1600, 900)], ['VP8X extended', webpExtended(1600, 900)]]) {
  const got = imageSize(bytes);
  check(`WebP ${name} 1600×900 parsed`, got?.w === 1600 && got?.h === 900, JSON.stringify(got));
}
check('a RIFF container that is not WebP → null',
  imageSize(Uint8Array.from([...'RIFF', 0, 0, 0, 0, ...'WAVE'].map(c => typeof c === 'string' ? c.charCodeAt(0) : c)).buffer) === null);

// AVIF: an ISOBMFF box tree. The size is an `ispe` property under meta/iprp/ipco
// addressed by 1-based position, and `ipma` says which property belongs to which
// item — so a file can carry several sizes and only one of them is the image a
// browser paints. Built here rather than checked in as binary; the parser was
// verified against real encoder output first — libvips and ffmpeg files
// (including one with an alpha auxiliary item), then 80 real build artifacts
// from three sites re-encoded to avif, every parsed size matching both the webp
// the site actually shipped and what libvips reports back (0 mismatches).
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = s => [...s].map(c => c.charCodeAt(0));
const box = (type, payload) => [...u32(payload.length + 8), ...ascii(type), ...payload];
const fullBox = (type, version, payload) => box(type, [version, 0, 0, 0, ...payload]);
const ispe = (w, h) => fullBox('ispe', 0, [...u32(w), ...u32(h)]);
// items: [{ id, props }] where props are 1-based indices into the ipco children.
const avif = ({ brands = ['avif'], props, items, primary = 1, withIpma = true }) => {
  const ipma = fullBox('ipma', 0, [...u32(items.length),
    ...items.flatMap(it => [0, it.id, it.props.length, ...it.props])]);
  const meta = fullBox('meta', 0, [
    ...fullBox('pitm', 0, [0, primary]),
    ...box('iprp', [...box('ipco', props.flat()), ...(withIpma ? ipma : [])]),
  ]);
  return Uint8Array.from([
    ...box('ftyp', [...ascii(brands[0]), 0, 0, 0, 0, ...brands.slice(1).flatMap(ascii)]),
    ...meta,
    ...box('mdat', [0]),
  ]).buffer;
};
const oneItem = imageSize(avif({ props: [ispe(1600, 900)], items: [{ id: 1, props: [1] }] }));
check('AVIF 1600×900 parsed (ftyp → meta → iprp → ipco → ispe)',
  oneItem?.w === 1600 && oneItem?.h === 900, JSON.stringify(oneItem));
// The assertion that separates reading the association table from reading the
// first ispe and getting lucky: a thumbnail's size sits first, the primary
// item's second. Taking the first would understate every such image's width.
const thumbed = imageSize(avif({
  props: [ispe(320, 180), ispe(1600, 900)],
  items: [{ id: 1, props: [1] }, { id: 2, props: [2] }],
  primary: 2,
}));
check('AVIF with a thumbnail first reports the PRIMARY item, not the first ispe',
  thumbed?.w === 1600 && thumbed?.h === 900, JSON.stringify(thumbed));
const compat = imageSize(avif({ brands: ['mif1', 'avif'], props: [ispe(1200, 630)], items: [{ id: 1, props: [1] }] }));
check('AVIF declared by a compatible brand (major mif1) is still parsed',
  compat?.w === 1200 && compat?.h === 630, JSON.stringify(compat));
// No association table is malformed input. The first ispe errs small (a
// thumbnail, not the full image), and small is a missed finding, never a
// fabricated one — the same direction every unreadable format takes.
const noIpma = imageSize(avif({ props: [ispe(1600, 900)], items: [{ id: 1, props: [1] }], withIpma: false }));
check('AVIF with no ipma falls back to the first ispe', noIpma?.w === 1600, JSON.stringify(noIpma));
check('an ISOBMFF file that is not AVIF (ftyp mp42) → null',
  imageSize(Uint8Array.from(box('ftyp', [...ascii('mp42'), 0, 0, 0, 0])).buffer) === null);
check('a truncated AVIF → null, not a crash',
  imageSize(new Uint8Array(avif({ props: [ispe(1600, 900)], items: [{ id: 1, props: [1] }] })).slice(0, 40).buffer) === null);

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

// remotePatterns — checked as text, never evaluated. The starter derives the
// hostname from og.config (`hostname: brandConfig.mediaDomain`) so the domain
// has one home; demanding the literal would force a second copy. Undriven until
// 2026-09-02, when the starter's media lane tripped it.
const rpDir = (astroConfig) => {
  const dir = mkProject({ config: astroConfig });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'og.config.mjs'), "export const config = { mediaDomain: 'media.x.test', brand: { siteName: 'x' } };\n");
  return dir;
};
const rpRow = (astroConfig) => runJson(rpDir(astroConfig), ['-s', 'modules', '--strict']).json?.results.find(r => r.id === 'modules/remotepatterns') ?? null;
const rpLiteral = rpRow("export default { output: 'static', image: { remotePatterns: [{ protocol: 'https', hostname: 'media.x.test' }] } };\n");
check('media domain literal in image.remotePatterns → pass', rpLiteral?.outcome === 'pass', JSON.stringify(rpLiteral));
const rpDerived = rpRow("import { config as brandConfig } from './scripts/og.config.mjs';\nexport default { output: 'static', image: { remotePatterns: brandConfig.mediaDomain ? [{ protocol: 'https', hostname: brandConfig.mediaDomain }] : [] } };\n");
check('  …derived from og.config → pass, and says so', rpDerived?.outcome === 'pass' && /derived/.test(rpDerived.message ?? ''), JSON.stringify(rpDerived));
const rpMissing = rpRow("export default { output: 'static' };\n");
check('  …absent while og.config names a media domain → fix', rpMissing?.outcome === 'fix', JSON.stringify(rpMissing));
check('  …and with no media domain declared there is nothing to check',
  runJson(mkProject({}), ['-s', 'modules', '--strict']).json?.results.find(r => r.id === 'modules/remotepatterns') == null);
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

// JSON-LD properties — what is INSIDE the node. `jsonld:shapes` reads the @type
// and stops, so a BlogPosting with a bare-string author, a relative image and a
// formatted date passed every structured-data check the tool had. Google reads
// the type, finds the properties unusable and drops the rich result silently.
const GOOD_AUTHOR = { '@type': 'Person', name: 'Jane Doe', url: 'https://x.test/jane' };
const ARTICLE = (over = {}) => ({
  '@type': 'BlogPosting', headline: 'A post', author: GOOD_AUTHOR,
  image: 'https://x.test/og.png', datePublished: '2026-01-05T08:00:00+10:00', ...over,
});
const CRUMB = (items) => ({ '@type': 'BreadcrumbList', itemListElement: items });
const GOOD_CRUMB = CRUMB([
  { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://x.test/' },
  { '@type': 'ListItem', position: 2, name: 'A post', item: 'https://x.test/a' },
]);
const ldPage = (nodes, id) => row(mkBuilt({ 'dist/index.html': PAGE_LD(nodes) }), 'data', id);

const fullLd = ldPage([{ '@type': 'WebSite' }, ARTICLE(), GOOD_CRUMB], 'data/jsonld-article-props');
check('a complete Article node → article-props pass', fullLd?.outcome === 'pass', JSON.stringify(fullLd));
const noAuthor = ldPage([{ '@type': 'WebSite' }, ARTICLE({ author: undefined })], 'data/jsonld-article-props');
check('  …missing author → fix (Google documents it as required)', noAuthor?.outcome === 'fix', JSON.stringify(noAuthor));
const noImage = ldPage([{ '@type': 'WebSite' }, ARTICLE({ image: undefined })], 'data/jsonld-article-props');
check('  …missing only a recommended property → suggest, not fix', noImage?.outcome === 'suggest', JSON.stringify(noImage));

// The bare-string author is the single most common way to write this wrong, and
// it is invisible to any check that only asks whether `author` is present.
const strAuthor = ldPage([{ '@type': 'WebSite' }, ARTICLE({ author: 'Jane Doe' })], 'data/jsonld-author');
check('author as a bare string → fix', strAuthor?.outcome === 'fix' && /bare string/.test(strAuthor.message), JSON.stringify(strAuthor));
const orgAuthor = ldPage([{ '@type': 'WebSite' }, ARTICLE({ author: { '@type': 'Organization', name: 'Acme' } })], 'data/jsonld-author');
check('  …an Organization author → pass (not every author is a Person)', orgAuthor?.outcome === 'pass', JSON.stringify(orgAuthor));
const multiAuthor = ldPage([{ '@type': 'WebSite' }, ARTICLE({ author: [GOOD_AUTHOR, { '@type': 'Person', name: 'John' }] })], 'data/jsonld-author');
check('  …and an array of authors → pass (Google’s own example is an array)', multiAuthor?.outcome === 'pass', JSON.stringify(multiAuthor));

const badDate = ldPage([{ '@type': 'WebSite' }, ARTICLE({ datePublished: '5 January 2026' })], 'data/jsonld-dates');
check('a formatted date → fix', badDate?.outcome === 'fix', JSON.stringify(badDate));
const dateOnly = ldPage([{ '@type': 'WebSite' }, ARTICLE({ datePublished: '2026-01-05' })], 'data/jsonld-dates');
check('  …a date with no time → pass (legal ISO 8601; the offset is recommended, not required)', dateOnly?.outcome === 'pass', JSON.stringify(dateOnly));

// Advisory, never a fix: JSON-LD 1.1 resolves a relative IRI against the
// document base, so this markup works. An earlier draft called it broken.
const relUrl = ldPage([{ '@type': 'WebSite' }, ARTICLE({ image: '/og/default.png' })], 'data/jsonld-urls');
check('a relative image URL → suggest, never a fix (it is legal and it resolves)', relUrl?.outcome === 'suggest', JSON.stringify(relUrl));
const objImage = ldPage([{ '@type': 'WebSite' }, ARTICLE({ image: { '@type': 'ImageObject', url: 'https://x.test/og.png' } })], 'data/jsonld-urls');
check('  …an ImageObject rather than a string → pass, not a false positive', objImage?.outcome === 'pass', JSON.stringify(objImage));

// The last breadcrumb may omit `item` — Google's documented example does exactly
// that, so a naive implementation of this check fires on Google's own markup.
const docCrumb = CRUMB([
  { '@type': 'ListItem', position: 1, name: 'Books', item: 'https://x.test/books' },
  { '@type': 'ListItem', position: 2, name: 'Award Winners' },
]);
const okCrumb = ldPage([{ '@type': 'WebSite' }, ARTICLE(), docCrumb], 'data/jsonld-breadcrumb-shape');
check('the last breadcrumb may omit its item URL → pass', okCrumb?.outcome === 'pass', JSON.stringify(okCrumb));
const skewed = ldPage([{ '@type': 'WebSite' }, ARTICLE(), CRUMB([
  { '@type': 'ListItem', position: 2, name: 'Home', item: 'https://x.test/' },
  { '@type': 'ListItem', position: 1, name: 'A post', item: 'https://x.test/a' },
])], 'data/jsonld-breadcrumb-shape');
check('  …out-of-order positions → fix', skewed?.outcome === 'fix' && /positions are/.test(skewed.message), JSON.stringify(skewed));
const nameless = ldPage([{ '@type': 'WebSite' }, ARTICLE(), CRUMB([
  { '@type': 'ListItem', position: 1, item: 'https://x.test/' },
  { '@type': 'ListItem', position: 2, name: 'A post', item: 'https://x.test/a' },
])], 'data/jsonld-breadcrumb-shape');
check('  …a nameless item → fix', nameless?.outcome === 'fix', JSON.stringify(nameless));
const middleNoItem = ldPage([{ '@type': 'WebSite' }, ARTICLE(), CRUMB([
  { '@type': 'ListItem', position: 1, name: 'Home' },
  { '@type': 'ListItem', position: 2, name: 'A post', item: 'https://x.test/a' },
])], 'data/jsonld-breadcrumb-shape');
check('  …a non-final item with no URL → fix', middleNoItem?.outcome === 'fix', JSON.stringify(middleNoItem));

// Presence is house style, so it has to be driven in BOTH modes: `row` runs
// --strict, which is exactly the mode that hides a demotion bug.
const crumblessDir = mkBuilt({ 'dist/index.html': PAGE_LD([{ '@type': 'WebSite' }, ARTICLE()]) });
const crumbless = runJson(crumblessDir, ['-s', 'data']).json?.results.find(r => r.id === 'data/jsonld-breadcrumb');
check('an Article page with no BreadcrumbList → suggest by default', crumbless?.outcome === 'suggest', JSON.stringify(crumbless));
const crumblessStrict = row(crumblessDir, 'data', 'data/jsonld-breadcrumb');
check('  …and fix under --strict', crumblessStrict?.outcome === 'fix', JSON.stringify(crumblessStrict));

// Retired rich results. All three shapes are still valid markup, so the finding
// is advisory in both modes — Google states that leaving them causes no errors.
const searchAction = ldPage([ARTICLE(), {
  '@type': 'WebSite', potentialAction: { '@type': 'SearchAction', target: 'https://x.test/s?q={q}' },
}], 'data/jsonld-deprecated');
check('WebSite → SearchAction → suggest (sitelinks searchbox retired 2024-11-21)',
  searchAction?.outcome === 'suggest' && /searchbox/.test(searchAction.message), JSON.stringify(searchAction));
const howto = ldPage([{ '@type': 'WebSite' }, ARTICLE(), { '@type': 'HowTo', name: 'How' }], 'data/jsonld-deprecated');
check('  …HowTo too', howto?.outcome === 'suggest', JSON.stringify(howto));
const plainSite = ldPage([{ '@type': 'WebSite' }, ARTICLE()], 'data/jsonld-deprecated');
check('  …while a WebSite with no SearchAction → pass (only the action is dead, not WebSite)',
  plainSite?.outcome === 'pass', JSON.stringify(plainSite));
const deprecatedStrict = row(mkBuilt({ 'dist/index.html': PAGE_LD([ARTICLE(), {
  '@type': 'WebSite', potentialAction: { '@type': 'SearchAction', target: 'https://x.test/s?q={q}' },
}]) }), 'data', 'data/jsonld-deprecated');
check('  …and --strict does not promote it — there is no failing branch to promote',
  deprecatedStrict?.outcome === 'suggest', JSON.stringify(deprecatedStrict));

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

const { attrValue, hasAttr, srcsetUrls } = await import('./lib/html.mjs');
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

// A `/*` inside a string literal is not a comment opener. The Content Layer
// loader line is the common carrier, and the blanking used to run from it to
// the next real `*/` — swallowing the `schema:` key and reporting a fully
// schema'd collection as having none. Needs BOTH halves to reproduce.
const GLOB_CFG = [
  'const c = defineCollection({',
  "  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),",
  '  schema: z.object({',
  '    /** A perfectly ordinary JSDoc comment. */',
  '    title: z.string(),',
  '  }),',
  '});',
].join('\n');
check("a `/*` inside a string literal does not open a comment", /\bschema\s*:/.test(stripComments(GLOB_CFG)));
check('  …while a real block comment is still blanked',
  !/canonical/.test(stripComments('/* rel="canonical" */\nconst x = 1;')));
check("  …and an apostrophe in .astro prose cannot swallow the next line's comment",
  !/og:image/.test(stripComments("<p>don't</p>\n// og:image here\n<b>y</b>")));
check('  …an unterminated /* leaves the file readable rather than blanking it to EOF',
  /canonical/.test(stripComments('const p = 1; /* oops\nrel="canonical"')));

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
const AVIF_CARD_B64 = Buffer.from(new Uint8Array(avif({ props: [ispe(1200, 630)], items: [{ id: 1, props: [1] }] }))).toString('base64');
writeFileSync(srvFile, `
import { createServer } from 'node:http';
const avifCard = Buffer.from('${AVIF_CARD_B64}', 'base64');
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
// A glossary entry: DefinedTerm is the CORRECT markup, not a degraded Article.
const glossary = '<!doctype html><html><head>' + head('/glossary/agent', '{"@type":"DefinedTerm"}')
  + '</head><body><h1>Agent</h1></body></html>';
// Wrappers only — says nothing about what the page is, so it stays a finding.
const bare = '<!doctype html><html><head>' + head('/bare', '[{"@type":"WebPage"},{"@type":"WebSite"}]')
  + '</head><body><h1>Bare</h1></body></html>';
// A card served as AVIF. Its size is readable now, so the 600×315 minimum has to
// be verified rather than skipped as an unreadable container.
const avifCardPage = '<!doctype html><html><head>'
  + head('/avifcard', '{"@type":"TechArticle"}').split('/og/card.png').join('/og/card.avif')
  + '</head><body><h1>Avif card</h1></body></html>';
// Two images, both without width/height: one absolutely inset to fill a sized
// parent (out of flow, cannot shift anything) and one plain in-flow shot. Only
// the second is a CLS defect, and the rule that says so is inside an @media.
const cover = '<!doctype html><html><head>' + head('/cover', '{"@type":"TechArticle"}')
  + '<link rel="stylesheet" href="/_astro/cover.css">'
  + '</head><body><h1>Cover</h1>'
  + '<div class="frame"><img class="cover-image" src="/_astro/hero.png" alt=""></div>'
  + '<img class="inline-shot" src="/_astro/shot.png" alt="a shot">'
  + '</body></html>';
const coverCss = '.frame { position: relative; aspect-ratio: 16/9; }\\n'
  + '@media (min-width: 40em) { .cover-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; } }\\n';
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
  if (url === '/_astro/cover.css') return send(coverCss, 'text/css');
  if (url === '/_astro/hero.png' || url === '/_astro/shot.png') return send(png, 'image/png');
  // Served no-cache, exactly as \`astro preview\` serves a hashed asset (measured).
  if (url.startsWith('/_astro/')) {
    const buf = Buffer.from('console.log(1)');
    res.writeHead(200, { 'content-type': 'text/javascript', 'content-length': String(buf.length), 'cache-control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : buf);
  }
  if (url === '/og/card.avif') return send(avifCard, 'image/avif');
  if (url.startsWith('/og/')) return send(png, 'image/png');
  if (url === '/avifcard') return send(avifCardPage, 'text/html');
  if (url === '/sitemap-index.xml') return send(sitemapIndex.split('HOST').join(host), 'application/xml');
  if (url === '/sitemap-0.xml') return send(sitemap.split('HOST').join(host), 'application/xml');
  if (url === '/wiki/kettle-clock') return send(entry, 'text/html');
  if (url === '/glossary/agent') return send(glossary, 'text/html');
  if (url === '/bare') return send(bare, 'text/html');
  if (url === '/cover') return send(cover, 'text/html');
  // /llms.txt unlocks three live rules the suite never drove: served, h1 and
  // structure (#30). Grouped by ## section, which is the shape structure wants.
  if (url === '/llms.txt') return send(['# Kettle Clock', '', '## wiki', '', '- [Kettle clock](http://HOST/wiki/kettle-clock)', ''].join(String.fromCharCode(10)).split('HOST').join(host), 'text/plain');
  if (url === '/') return send(home, 'text/html');
  res.writeHead(404, { 'content-type': 'text/html', 'content-length': '3' });
  res.end(req.method === 'HEAD' ? undefined : '404');
});
// process.stdout.write, NOT console.log: the port is a NUMBER, and console.log
// runs a number through util.inspect, which colorizes it when FORCE_COLOR is
// set — as Claude Code and many CI runners do. The reader below then built
// "http://127.0.0.1:\x1b[33m40567\x1b[39m", every live assertion failed, and
// the run still said PASS on the 78 rule ids it had left. A gate that goes red
// (or silently narrows) because of the terminal it ran in is not a gate.
srv.listen(0, '127.0.0.1', function () { process.stdout.write(String(this.address().port) + '\\n'); });
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
check('a served /llms.txt is read, not just looked for',
  liveRows.find(r => r.id === 'data/llms-txt-served')?.outcome === 'pass',
  JSON.stringify(liveRows.find(r => r.id === 'data/llms-txt-served')));
check('  …its H1 and its grouping are both asserted',
  liveRows.find(r => r.id === 'data/llms-txt-h1')?.outcome === 'pass'
  && liveRows.find(r => r.id === 'data/llms-txt-structure')?.outcome === 'pass',
  JSON.stringify(liveRows.filter(r => /llms/.test(r.id ?? ''))));
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

// A glossary entry is a DefinedTerm and rewriting it as an Article would make
// the page worse — so reporting one as a *missing* Article is the check assuming
// every content page wants to be a blog post. Reported by matewishkey-web, whose
// /glossary/* pages were flagged while their /projects/* carried BlogPosting.
const glossary = runJson(tmpdir(), ['-s', 'live', '--url', `http://127.0.0.1:${port}`, '--post', '/glossary/agent'])
  .json?.results.find(r => r.id === 'data/post-jsonld');
check('a DefinedTerm page → pass, naming it as the page\'s own type',
  glossary?.outcome === 'pass' && /DefinedTerm is this page/.test(glossary.message ?? ''), JSON.stringify(glossary));
const wrapperOnly = runJson(tmpdir(), ['-s', 'live', '--url', `http://127.0.0.1:${port}`, '--post', '/bare'])
  .json?.results.find(r => r.id === 'data/post-jsonld');
check('  …while WebPage/WebSite wrappers alone still fail — they say nothing about what the page is',
  wrapperOnly?.outcome === 'fix', JSON.stringify(wrapperOnly));

// The og-card gate used to be PNG/JPEG only, and said so in a ⏭ that was true
// when it was written. A card in any container whose bytes we can read must be
// measured — skipping it is the 404-screenshot case going unverified again.
const avifCardRow = runJson(tmpdir(), ['-s', 'live', '--url', `http://127.0.0.1:${port}`, '--post', '/avifcard'])
  .json?.results.find(r => r.id === 'seo/og-image-card');
check('an AVIF og card is measured, not skipped as an unreadable container',
  avifCardRow?.outcome === 'pass' && /1200×630/.test(avifCardRow.message ?? ''), JSON.stringify(avifCardRow));

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

// The served-side twin of the perf carve-out: the positioning lives in a linked
// stylesheet (and inside an @media), so the check has to fetch and read it. On
// tasmanvisa-web the un-carved version reported 20 of these, all on one shape,
// on a page measured at CLS 0.001 — hence one aggregated finding, not one per tag.
const coverCls = runJson(tmpdir(), ['-s', 'live', '--url', `http://127.0.0.1:${port}`, '--post', '/cover'])
  .json?.results.find(r => r.id === 'images/cls');
srv.kill();
check('a linked stylesheet positioning an image out of flow spares it the CLS finding',
  coverCls?.outcome === 'fix' && /^1 content <img>/.test(coverCls?.message ?? '')
  && /1 absolutely positioned/.test(coverCls?.message ?? ''), JSON.stringify(coverCls));
check('  …and the in-flow image it does report is named once, not per page',
  /shot\.png/.test(coverCls?.url ?? ''), JSON.stringify(coverCls?.url));
const skipRow = noPost.json?.results.find(r => r.id === 'seo/post' && r.outcome === 'skip');
check('an undiscoverable content page names the skipped checks',
  skipRow != null && /seo\/title/.test(skipRow.message) && /data\/post-jsonld/.test(skipRow.message),
  JSON.stringify(skipRow));

console.log('the "it did not parse / would not start" branches actually fire:');
// These are the paths where a silent regression is invisible: a check that
// stops firing on a broken project looks exactly like a project that is fine.
// They were catalogued, had emitters, and no test drove any of them (#30).
// Detection is `astro.config.* exists OR deps.astro exists`, so each fixture
// below is deliberately detected-but-broken rather than simply not-a-project.
function brokenProject(files) {
  const d = tmpProject('rider-broken-');
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(d, dirname(rel)), { recursive: true });
    writeFileSync(join(d, rel), body);
  }
  return d;
}
const brokenRow = (files, id) => runJson(brokenProject(files), ['-s', 'modules'])
  .json?.results.find(r => r.id === id);

const badJson = brokenRow({ 'astro.config.mjs': 'export default {};\n', 'package.json': '{ "name": "x", }\n' }, 'modules/package-json');
check('a package.json that is present but unparseable is a block, not "missing"',
  badJson?.outcome === 'block' && /not valid JSON/.test(badJson?.message ?? ''), JSON.stringify(badJson));

const noPkg = brokenRow({ 'astro.config.mjs': 'export default {};\n' }, 'modules/package-json');
check('  …and an absent one says missing',
  noPkg?.outcome === 'block' && /missing/.test(noPkg?.message ?? ''), JSON.stringify(noPkg));

const noAstro = brokenRow({ 'astro.config.mjs': 'export default {};\n', 'package.json': JSON.stringify({ name: 'x', type: 'module', dependencies: {} }) }, 'modules/astro-installed');
check('  …an Astro config with no astro dependency is a block',
  noAstro?.outcome === 'block', JSON.stringify(noAstro));

const noCfg = brokenRow({ 'package.json': JSON.stringify({ name: 'x', type: 'module', dependencies: { astro: '^7.2.6' } }) }, 'modules/astro-config');
check('  …and an astro dependency with no config is a block',
  noCfg?.outcome === 'block', JSON.stringify(noCfg));

console.log('an installed integration has to be one the loader can reach:');
// Both example sites shipped `@astrojs/mdx` with a `**/*.md` glob until
// 2026-09-01 — required of every audited site, unusable on the two that are
// supposed to prove it. Issue #29.
function mdxProject(pattern) {
  const d = tmpProject('rider-mdx-');
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'mx', type: 'module',
    dependencies: { astro: '^7.2.6', '@astrojs/mdx': '^8.0.0', '@astrojs/sitemap': '^3.7.3', '@astrojs/rss': '^4.0.19', '@astrojs/check': '^0.9.10' } }));
  writeFileSync(join(d, 'astro.config.mjs'), "export default { output: 'static' };\n");
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'src', 'content.config.ts'),
    'import { defineCollection, z } from "astro:content";\nimport { glob } from "astro/loaders";\n'
    + `const blog = defineCollection({ loader: glob({ pattern: ${pattern}, base: "./src/data" }), schema: z.object({ title: z.string() }) });\n`
    + 'export const collections = { blog };\n');
  return d;
}
const mdxRow = (pattern) => runJson(mdxProject(pattern), ['-s', 'modules', '--strict'])
  .json?.results.find(r => r.id === 'modules/mdx-reachable');

const mdxOnlyMd = mdxRow("'**/*.md'");
check('mdx installed with a .md-only loader glob is a finding',
  mdxOnlyMd?.outcome === 'fix', JSON.stringify(mdxOnlyMd));
check('  …and a widened glob passes',
  mdxRow("'**/*.{md,mdx}'")?.outcome === 'pass');

// A pattern ARRAY is one loader matching any of them — flagging it because the
// first element excludes .mdx was this check's first bug, on a correct site.
check('  …and an array of globs is a union, not a set of requirements',
  mdxRow("['**/*.md', '**/*.mdx']")?.outcome === 'pass',
  JSON.stringify(mdxRow("['**/*.md', '**/*.mdx']")));

// An unreadable pattern is a missed finding; a guessed one is a wrong finding.
const mdxVar = mdxRow('PATTERNS');
check('  …and a non-literal pattern is reported as unread, never guessed',
  mdxVar?.outcome === 'skip' && /not a literal/.test(mdxVar?.message ?? ''), JSON.stringify(mdxVar));

console.log('one search engine is one engine, however many packages it ships as:');
// Both of these fired on sites that were built CORRECTLY, which is the only
// kind of false positive worth writing a test for.
const SEARCH_BASE = { astro: '^7.1.6', '@astrojs/mdx': '^7.0.5', '@astrojs/sitemap': '^3.7.3', '@astrojs/rss': '^4.0.19', '@astrojs/check': '^0.9.10' };
function searchProject(extra) {
  const d = tmpProject('rider-search-');
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'sx', type: 'module', dependencies: { ...SEARCH_BASE, ...extra } }));
  writeFileSync(join(d, 'astro.config.mjs'), "export default { output: 'static' };\n");
  mkdirSync(join(d, 'src', 'pages'), { recursive: true });
  return d;
}
const rowOf = (dir, section, id) => runJson(dir, ['-s', section, '--strict']).json?.results.find(r => r.id === id);

// astro-pagefind is the Astro integration that WRAPS pagefind; installing both
// is the documented setup, and pagefind indexes dist/ rather than reading an
// endpoint the site emits.
const pfDir = searchProject({ pagefind: '^1.4.0', 'astro-pagefind': '^1.8.3' });
const pfEngine = rowOf(pfDir, 'modules', 'modules/search-engine');
check('pagefind + astro-pagefind is ONE engine, not two',
  pfEngine?.outcome !== 'fix' && !/2 search engines/.test(pfEngine?.message ?? ''), JSON.stringify(pfEngine));
const pfIndex = rowOf(pfDir, 'data', 'data/search-index');
check('  …and it is not asked for a search-index endpoint it never reads',
  pfIndex?.outcome === 'skip', JSON.stringify(pfIndex));

// Algolia keeps the index on Algolia's servers; @docsearch/js is its UI.
const algDir = searchProject({ algoliasearch: '^5.0.0', '@docsearch/js': '^3.6.0' });
const algEngine = rowOf(algDir, 'modules', 'modules/search-engine');
check('algoliasearch + @docsearch/js is ONE engine, not two',
  algEngine?.outcome !== 'fix' && !/2 search engines/.test(algEngine?.message ?? ''), JSON.stringify(algEngine));
const algIndex = rowOf(algDir, 'data', 'data/search-index');
check('  …and a hosted index is not a missing endpoint',
  algIndex?.outcome === 'skip', JSON.stringify(algIndex));

// The check still has to do its job: two genuinely different engines.
const twoDir = searchProject({ '@orama/orama': '^3.1.18', 'fuse.js': '^7.0.0' });
const twoEngine = rowOf(twoDir, 'modules', 'modules/search-engine');
check('two genuinely different engines is still a finding',
  twoEngine?.outcome === 'fix' && /2 search engines/.test(twoEngine?.message ?? ''), JSON.stringify(twoEngine));

// And an engine that DOES read a site-emitted index still has to have one.
const orDir = searchProject({ '@orama/orama': '^3.1.18' });
const orIndex = rowOf(orDir, 'data', 'data/search-index');
check('an engine that reads a site-emitted index still needs one',
  orIndex?.outcome === 'fix', JSON.stringify(orIndex));

console.log('optional browser domain degrades cleanly and the fonts check fires:');
// The browser domain must never become a hard requirement: without playwright
// installed it skips, and the run still exits 0.
const noPw = runJson(tmpdir(), ['-s', 'browser', '--url', 'https://example.com']);
const pwRow = noPw.json?.results.find(r => r.section === 'browser');
check('browser domain skips without playwright', pwRow?.outcome === 'skip', JSON.stringify(pwRow));
check('  …and the run still exits 0', noPw.code === 0, `exit ${noPw.code}`);

// nav:reach is the one check here that needs a real browser, and playwright is
// deliberately not a dependency of this repo. Run it where the fixture has
// installed one; where it has not, SAY so — a silent pass for work that never
// happened is the failure mode this whole suite exists to avoid.
const FIXTURE_DIR = join(here, '..', 'examples', '_fixture-i18n');
const hasPlaywright = (() => {
  try { createRequire(join(FIXTURE_DIR, 'package.json')).resolve('playwright'); return true; }
  catch { return false; }
})();

if (!hasPlaywright) {
  console.log('  ⏭ nav:reach not exercised — no playwright in examples/_fixture-i18n (npm i there to cover it)');
} else {
  // One stylesheet, three pages. Below 960px the bar's own links go; what
  // differs is whether anything brings them back.
  const NAV = '<a href="/one">One</a><a href="/two">Two</a>';
  const CSS = '<style>details{display:none}.mtoggle{display:none}#panel{display:none}'
    + '@media (max-width:960px){header nav > a{display:none}details{display:block}'
    + '.mtoggle{display:block}#panel[data-open]{display:block}}</style>';
  const shell = (inNav, after = '') =>
    `<!doctype html><title>t</title>${CSS}<header><nav>${NAV}${inNav}</nav></header><main><h1>t</h1></main>${after}`;
  const PAGES = {
    // The bar is hidden and nothing reveals it: no navigation on a phone.
    '/broken': shell(''),
    // A <details> hamburger carrying the same list — the correct shape.
    '/menu': shell(`<details><summary>Menu</summary><div>${NAV}</div></details>`),
    // Only one link in the menu, the other in the footer. Still REACHABLE, so
    // it must not be a finding — moving a link to the footer is a normal call.
    '/footer': shell('<details><summary>Menu</summary><div><a href="/one">One</a></div></details>',
      '<footer><a href="/two">Two</a></footer>'),
    // Same as /footer, except the footer spells the route with a trailing
    // slash. One route, two spellings — must not read as unreachable.
    '/slash': shell('<details><summary>Menu</summary><div><a href="/one">One</a></div></details>',
      '<footer><a href="/two/">Two</a></footer>'),
    // A search button carrying aria-controls, inside a form, next to a menu
    // that is perfectly fine. Clicking it would submit and navigate away.
    '/submit': shell('<form action="/search"><button aria-controls="r">Go</button></form>'
      + `<details><summary>Menu</summary><div>${NAV}</div></details>`),
    // A menu BUILT by script 600ms after the click. "Wait for the DOM to stop
    // changing" passes this page as broken: at the moment it is opened nothing
    // has happened yet, so two consecutive polls agree on zero links and the
    // page looks settled and empty.
    '/slowjs': shell('<button class="mtoggle" aria-controls="panel">Menu</button><div id="panel"></div>')
      + `<script>document.querySelector('.mtoggle').addEventListener('click', function () {
        var p = document.getElementById('panel');
        p.setAttribute('data-open', '');
        setTimeout(function () { p.innerHTML = '${NAV}'; }, 600);
      });</script>`,
  };
  // The server has to be its OWN process. `runJson` uses spawnSync, which
  // blocks this process's event loop for the whole audit — an in-process
  // server would never get to answer a single request, and every assertion
  // below would fail against a page that was never served.
  const navDir = mkdtempSync(join(tmpdir(), 'rider-nav-'));
  const navFile = join(navDir, 'server.mjs');
  writeFileSync(navFile, `import { createServer } from 'node:http';
const PAGES = ${JSON.stringify(PAGES)};
createServer((req, res) => {
  // No regex here on purpose: this source is written out THROUGH a template
  // literal, which eats the backslash in /\\/$/ and emits an invalid one.
  let u = req.url.split('?')[0];
  if (u.length > 1 && u.endsWith('/')) u = u.slice(0, -1);
  const body = PAGES[u === '/' ? '/broken' : u];
  if (!body) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(Buffer.byteLength(body)) });
  res.end(body);
}).listen(0, '127.0.0.1', function () { process.stdout.write(String(this.address().port) + '\\n'); });
`);
  const navSrv = spawn('node', [navFile], { stdio: ['ignore', 'pipe', 'ignore'] });
  const navPort = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('nav server did not start')), 10000);
    navSrv.stdout.once('data', (d) => { clearTimeout(timer); resolve(String(d).trim()); });
  });

  const rowsFor = (path) => runJson(FIXTURE_DIR, ['-s', 'browser', '--url', `http://127.0.0.1:${navPort}${path}`])
    .json?.results ?? [];
  const reach = (path) => rowsFor(path).find(r => r.id === 'browser/nav-reach');

  // Resolving the playwright PACKAGE is not the same as having a browser: `npm
  // ci` installs the module, `npx playwright install chromium` fetches the
  // ~150 MB binary, and CI does the first without the second all the time. When
  // the launch fails the domain returns before nav:reach ever runs, so every
  // assertion below would fail about a check that was never reached. Say which
  // it was instead.
  const firstRows = rowsFor('/broken');
  const launchFailed = firstRows.some(r => r.id === 'browser/launch' && r.outcome === 'skip');
  const broken = firstRows.find(r => r.id === 'browser/nav-reach');
  if (launchFailed) {
    console.log('  ⏭ nav:reach not exercised — playwright is installed but Chromium is not (npx playwright install chromium)');
  } else {
  check('a nav that vanishes below the breakpoint with no menu control is a finding',
    broken?.outcome === 'fix' && /no menu control/.test(broken?.message ?? ''), JSON.stringify(broken));

  const menu = reach('/menu');
  check('  …and a <details> hamburger carrying the same links passes',
    menu?.outcome === 'pass', JSON.stringify(menu));

  // The regression that matters most: Chromium leaves a closed <details>'s
  // children with a non-zero bounding box, so a rect-based visibility test
  // scores a menu that never opens as a pass. If this check ever reports a
  // pass WITHOUT having opened a control, that bug is back.
  check('  …having actually opened it, not counted a collapsed menu as visible',
    /1 menu control\(s\) opened/.test(menu?.message ?? ''), JSON.stringify(menu?.message));

  const footer = reach('/footer');
  check('  …and a link that moved to the footer is reachable, not missing',
    footer?.outcome === 'pass', JSON.stringify(footer));

  // Two ways to invent a finding out of nothing, both measured before they were
  // fixed: `/about` vs `/about/` reported the header copy unreachable, and a
  // form's submit button matching the toggle test navigated away, after which
  // every link is missing because the page is gone.
  const slash = reach('/slash');
  check('  …and a trailing-slash spelling is the same route, not a missing one',
    slash?.outcome === 'pass', JSON.stringify(slash));

  const submit = reach('/submit');
  check('  …and a form submit button is never clicked looking for a menu',
    submit?.outcome === 'pass', JSON.stringify(submit));

  // The wait has to be for the LINKS, not for the DOM to go quiet.
  const slowjs = reach('/slowjs');
  check('  …and a menu whose links are built by script 600ms later still passes',
    slowjs?.outcome === 'pass', JSON.stringify(slowjs));
  }

  navSrv.kill();
  rmSync(navDir, { recursive: true, force: true });
}

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

// Reported by tasmanvisa-web (issue #17): a 🔧 for a missing media kit, on a
// site serving a full bilingual one at /media/. A fixed list of three English
// literals was the whole bug — the `data` domain next door already matches its
// endpoints by pattern, which is why per-locale `rss.hu.xml` passes cleanly.
for (const route of ['media', 'media-kit', 'press', 'presskit', 'newsroom', 'brand-kit']) {
  check(`/${route}/ counts as a media kit`,
    row(mkBuilt({ [`dist/${route}/index.html`]: MEDIA_OK }), 'content', 'content/mediakit')?.outcome === 'pass');
}
// A locale-prefixed TRANSLATED slug can never match an English name list,
// however long it gets — but the site itself already says the two pages are the
// same page, in the hreflang block it emits for search engines. Reading that is
// a general answer; a dictionary of the word "press" per language is not.
const HU = MEDIA_OK.replace('<head>', '<head><link rel="alternate" hreflang="hu" href="https://x.test/hu/sajto/">');
const bilingual = mkBuilt({
  'dist/media/index.html': HU.replace(/<a href="\/brand\/logo\.svg" download>logo<\/a>/, ''),
  'dist/hu/sajto/index.html': MEDIA_OK,
});
check('a translated slug counts when the site links it as an hreflang alternate',
  row(bilingual, 'content', 'content/mediakit')?.outcome === 'pass',
  JSON.stringify(row(bilingual, 'content', 'content/mediakit')));
// Broadening the name list means a page can match on route and not be the media
// kit. Taking whichever the dist walk hit first would turn a site's real media
// kit into "page exists but is missing a downloadable logo asset" — a wrong
// finding, which is worse than the missed one it replaced.
const twoCandidates = mkBuilt({
  'dist/media/index.html': '<html><body><h1>Media</h1><p>Photo gallery.</p></body></html>',
  'dist/press-kit/index.html': MEDIA_OK,
});
check('  …and with two matching routes the best candidate decides, not the first',
  row(twoCandidates, 'content', 'content/mediakit')?.outcome === 'pass',
  JSON.stringify(row(twoCandidates, 'content', 'content/mediakit')));
// An x-default alternate pointing at `/` must not nominate the homepage: a
// homepage with a logo, a long paragraph and a contact link would then pass this
// check for a page that does not exist — a false ✅.
const rootDefault = mkBuilt({
  'dist/index.html': MEDIA_OK.replace('<head>', '<head><link rel="alternate" hreflang="x-default" href="/">'),
  'dist/press/index.html': '<html><body><h1>Press</h1><p>Email us.</p>'
    + '<link rel="alternate" hreflang="x-default" href="/"></body></html>',
});
check('  …and an x-default pointing at / does not nominate the homepage',
  row(rootDefault, 'content', 'content/mediakit')?.outcome === 'fix',
  JSON.stringify(row(rootDefault, 'content', 'content/mediakit')));

// The finding text lists the names it accepts, and that list is hand-written
// next to the pattern — so assert every name in it actually matches.
const absent = row(mkBuilt({ 'dist/index.html': '<html><body><h1>hi</h1></body></html>' }), 'content', 'content/mediakit');
for (const named of (absent?.message ?? '').match(/\/[a-z-]+/g) ?? []) {
  check(`  …and the finding's own list is honest: ${named}`,
    row(mkBuilt({ [`dist${named}/index.html`]: MEDIA_OK }), 'content', 'content/mediakit')?.outcome === 'pass');
}

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
// Trimmed from a real PSI response (a live site, mobile, 2026-08-03), with
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

// The positive half of the same practice: a large image with NO ladder at all.
// The thresholds were measured across three real builds (issue #12) — the whole
// risk here is flagging a logo or a diagram that is legitimately one size, so
// every guard gets its own assertion.
console.log('a large image shipping one fixed width should have a ladder:');
// imageSize reads the header only, so trailing bytes set the file's weight
// without touching its dimensions — which is exactly the two-axis input needed.
const webpFile = (w, h, kb) => {
  const head = new Uint8Array(webpLossy(w, h));
  const out = new Uint8Array(Math.max(head.length, kb * 1024));
  out.set(head);
  return Buffer.from(out);
};
const singleRows = (files, html) => runJson(mkBuilt({ 'dist/index.html': html, ...files }), ['-s', 'images', '--strict'])
  .json?.results.filter(r => r.id === 'images/srcset-missing') ?? [];
const ONE_IMG = (src) => `<html><body><img src="${src}" alt="a" width="16" height="9"></body></html>`;

const wide = singleRows({ 'dist/hero.webp': webpFile(1600, 900, 120) }, ONE_IMG('/hero.webp'));
check('a 1600px 120 KB <img> with no srcset → suggest, naming the width',
  wide[0]?.outcome === 'suggest' && /1600px/.test(wide[0]?.message ?? ''), JSON.stringify(wide[0]));
check('  …advisory even under --strict — the promotion condition is a wider sweep',
  wide.every(r => r.outcome !== 'fix' && r.outcome !== 'block'));
check('  …and a /cdn-cgi/image/ URL is judged on the width it pins',
  singleRows({}, ONE_IMG('https://media.x.test/cdn-cgi/image/width=1600,format=auto,quality=80/hero.jpg'))[0]?.outcome === 'suggest');

// The blind spot this check shipped with (issue #21): a site whose build emits
// avif reached the same `⏭ nothing to check` as a site with no images at all,
// because no candidate's width could be read. Identical image, other container.
const avifFile = (w, h, kb) => {
  const head = new Uint8Array(avif({ props: [ispe(w, h)], items: [{ id: 1, props: [1] }] }));
  const out = new Uint8Array(Math.max(head.length, kb * 1024));
  out.set(head);
  return Buffer.from(out);
};
const wideAvif = singleRows({ 'dist/hero.avif': avifFile(1600, 900, 120) }, ONE_IMG('/hero.avif'));
check('an avif build is judged on its own widths, not skipped as unreadable',
  wideAvif[0]?.outcome === 'suggest' && /1600px/.test(wideAvif[0]?.message ?? ''), JSON.stringify(wideAvif[0]));
check('  …and its guards work the same — a 640px avif portrait is still no finding',
  singleRows({ 'dist/face.avif': avifFile(640, 640, 120) }, ONE_IMG('/face.avif'))[0]?.outcome === 'pass');

// Guard 1: the measured width floor. Every single-width image in three real
// builds that was MEANT to be one came in at or under 720px.
check('a 640px portrait is not a finding (the measured floor is 1000px)',
  singleRows({ 'dist/face.webp': webpFile(640, 640, 120) }, ONE_IMG('/face.webp'))[0]?.outcome === 'pass');
// Guard 2: the byte floor — a wide flat graphic has little to gain from a ladder.
check('  …nor is a wide but 25 KB graphic, the shape of a brand lockup',
  singleRows({ 'dist/mark.webp': webpFile(1594, 352, 25) }, ONE_IMG('/mark.webp'))[0]?.outcome === 'pass');
// Guard 3: the name filter — and it must survive being heavy, since a transform
// URL carries no weight to judge.
check('  …nor a heavy one whose path says logo/badge/icon',
  singleRows({ 'dist/press/site-lockup.webp': webpFile(1594, 352, 120) }, ONE_IMG('/press/site-lockup.webp'))[0]?.outcome === 'pass'
  && singleRows({}, ONE_IMG('/cdn-cgi/image/width=1600,format=auto/badges/partner.png'))[0]?.outcome === 'pass');
// The exempt ones are counted, so the pass line cannot imply nothing was wide.
const exemptRow = singleRows({ 'dist/mark.webp': webpFile(1594, 352, 25) }, ONE_IMG('/mark.webp'))[0];
check('  …and the pass line says how many were wide-but-exempt',
  /1 of them wider than 1000px/.test(exemptRow?.message ?? ''), JSON.stringify(exemptRow));

// An <img> already in a ladder, or one whose width nothing can know offline,
// must never be a finding — the false positive is the only failure mode here.
check('an <img> with a srcset is not a candidate',
  singleRows({ 'dist/hero.webp': webpFile(1600, 900, 120) },
    '<html><body><img src="/hero.webp" srcset="/hero.webp 1600w" alt="a"></body></html>')[0]?.outcome === 'skip');
check('  …nor is one inside a <picture>, whose <source> is the ladder',
  singleRows({ 'dist/hero.webp': webpFile(1600, 900, 120) },
    '<html><body><picture><source srcset="/hero.webp 1600w"><img src="/hero.webp" alt="a"></picture></body></html>')[0]?.outcome === 'skip');
check('  …nor a remote image whose width is unknowable offline',
  singleRows({}, ONE_IMG('https://media.x.test/hero.jpg'))[0]?.outcome === 'skip');
check('  …nor an SVG routed through a transform — it has no ladder to be missing',
  singleRows({}, ONE_IMG('/cdn-cgi/image/width=1600,format=auto/diagram.svg'))[0]?.outcome === 'skip');

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

// The trap: a preconnect that looks like the fix and is not — one whose CORS
// mode does not match the images'. Until 2026-09-02 this check had it backwards
// and demanded `crossorigin` on every image-host preconnect; a plain <img> is a
// no-cors fetch and cannot reuse an anonymous CORS connection (MDN: match the
// resource's CORS and credentials mode). Both directions are driven here.
const PRE = '<link rel="preconnect" href="https://media.x.test">';
const PRE_CORS = '<link rel="preconnect" href="https://media.x.test" crossorigin>';
const TWO_REMOTE_CORS = TWO_REMOTE.replace(/<img /g, '<img crossorigin ');
const bareOk = perfRow('perf/preconnect-crossorigin', TWO_REMOTE, PRE);
check('plain <img> + bare preconnect → pass (a no-cors fetch reuses a no-cors connection)',
  bareOk?.outcome === 'pass' && perfRow('perf/preconnect', TWO_REMOTE, PRE)?.outcome === 'pass', JSON.stringify(bareOk));
const corsOnPlain = perfRow('perf/preconnect-crossorigin', TWO_REMOTE, PRE_CORS);
check('  …plain <img> + crossorigin preconnect → fix (the trap this check used to prescribe)',
  corsOnPlain?.outcome === 'fix' && /cannot reuse/.test(corsOnPlain.message ?? ''), JSON.stringify(corsOnPlain));
check('  …<img crossorigin> + crossorigin preconnect → pass',
  perfRow('perf/preconnect-crossorigin', TWO_REMOTE_CORS, PRE_CORS)?.outcome === 'pass');
const bareOnCors = perfRow('perf/preconnect-crossorigin', TWO_REMOTE_CORS, PRE);
check('  …<img crossorigin> + bare preconnect → fix (the other direction is just as dead)',
  bareOnCors?.outcome === 'fix', JSON.stringify(bareOnCors));
check('  …and the missing-preconnect suggestion prescribes the matching form, bare for plain <img>',
  !/crossorigin/.test(perfRow('perf/preconnect', TWO_REMOTE)?.fix ?? perfRow('perf/preconnect', TWO_REMOTE)?.suggestion ?? 'crossorigin'));

// A preload that disagrees with its <img> downloads the image twice.
const IMG = '<img src="/h.webp" srcset="/h-800.webp 800w, /h-1600.webp 1600w" sizes="(max-width: 700px) 100vw, 700px" alt="h">';
const mismatched = perfRow('perf/preload-pair', IMG,
  '<link rel="preload" as="image" imagesrcset="/h-800.webp 800w, /h-1600.webp 1600w" imagesizes="100vw">');
check('a preload as="image" whose imagesizes differ from the tag → fix',
  mismatched?.outcome === 'fix' && /imagesizes/.test(mismatched.message ?? ''), JSON.stringify(mismatched));
check('  …while a byte-identical pair reports nothing',
  perfRow('perf/preload-pair', IMG,
    '<link rel="preload" as="image" imagesrcset="/h-800.webp 800w, /h-1600.webp 1600w" imagesizes="(max-width: 700px) 100vw, 700px">') === null);

// A Cloudflare transform path carries commas, so splitting a srcset on `,` made
// every transformed image on the page share the fragment `format=auto`. The
// preload then paired with an arbitrary unrelated <img> and its srcset "differed"
// — the check firing hardest on the delivery this baseline recommends.
const CF = (w, f) => `/cdn-cgi/image/width=${w},format=auto,quality=80/${f}`;
check('a Cloudflare transform URL is one srcset candidate, not three',
  JSON.stringify(srcsetUrls(`${CF(400, 'a.jpg')} 400w, ${CF(800, 'a.jpg')} 800w`)) ===
  JSON.stringify([CF(400, 'a.jpg'), CF(800, 'a.jpg')]));
check('  …and the descriptor-less form still splits (a.webp, b.webp)',
  JSON.stringify(srcsetUrls('/a.webp, /b.webp')) === JSON.stringify(['/a.webp', '/b.webp']));
check('  …while no-space commas are one URL, exactly as a browser reads them',
  JSON.stringify(srcsetUrls('/a.webp,b.webp')) === JSON.stringify(['/a.webp,b.webp']));
check('a preload for an image with no <img> on the page pairs with nothing',
  perfRow('perf/preload-pair',
    `<img src="${CF(400, 'sydney.jpg')}" srcset="${CF(400, 'sydney.jpg')} 400w, ${CF(800, 'sydney.jpg')} 800w" sizes="50vw" alt="s">`,
    `<link rel="preload" as="image" imagesrcset="${CF(800, 'hero.webp')} 1x" imagesizes="100vw">`) === null);

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
// End to end for the string-literal `/*` bug: the real config shape, where the
// glob pattern and a JSDoc comment together used to hide the schema entirely.
const globSchema = mkBuilt({
  'src/content.config.ts': "import { defineCollection, z } from 'astro:content';\nimport { glob } from 'astro/loaders';\nconst blog = defineCollection({\n  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),\n  schema: z.object({\n    /** The post title. */\n    title: z.string(),\n  }),\n});\nexport const collections = { blog };",
});
check("  …while a glob('**/*.md') loader above a JSDoc'd schema is still seen as schema'd",
  row(globSchema, 'data', 'data/content-schema')?.outcome === 'pass');

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
const { ruleCatalogue, knownRuleIds, ruleNames } = await import('./lib/rules.mjs');
const catalogue = ruleCatalogue();
check('--rules --json lists rules with id, severity and a reason',
  catalogue.length > 50 && catalogue.every(r => r.id && r.why && ['universal', 'house', 'advisory'].includes(r.severity)));
const rulesRun = spawnSync('node', [AUDIT, '--rules', '--json'], { cwd: tmpdir(), encoding: 'utf8' });
check('  …and it runs outside an Astro project', rulesRun.status === 0, `exit ${rulesRun.status}`);
const known = knownRuleIds();
const uncatalogued = [...seenRuleIds].filter(id => !known.has(id)).sort();
check(`every rule id emitted by this suite is catalogued (${seenRuleIds.size} seen)`,
  uncatalogued.length === 0, uncatalogued.join(', '));

// …and the REVERSE, which is the direction that was missing. Only checking
// emitted ⊆ catalogued lets a dead entry sit forever: when `images: optimized`
// was renamed to `images: routed`, the old row survived for months and
// `--rules` promised a check that could not fire. The catalogue is this tool's
// answer to "what do you check" — a row nothing emits is a lie in it. A rule is
// alive if some check calls the reporter with its name: as a literal, inside a
// template (`lcp:element (${strategy})`), by a dynamic suffix (`brand.${k}`),
// or under an explicit `id:` override.
const checkSrc = readdirSync(join(here, 'checks'))
  .filter(f => f.endsWith('.mjs'))
  .map(f => readFileSync(join(here, 'checks', f), 'utf8'))
  .concat(readFileSync(join(here, 'audit.mjs'), 'utf8'))
  .join('\n');
const isAlive = ({ id, name }) => {
  if (checkSrc.includes(`'${name}'`) || checkSrc.includes(`"${name}"`)) return true;
  if (checkSrc.includes(`id: '${id}'`)) return true;
  if (checkSrc.includes('`' + name)) return true;
  // A dynamic name — `meta:${name}`, `brand.${k}`, `dep:${dep}`. Try EVERY
  // prefix boundary, not just the last: `meta:og:image` is emitted as
  // `meta:${name}`, so the prefix that matters is `meta:`, and a greedy
  // match on the final separator reported five live rules as dead.
  for (let i = 0; i < name.length; i++) {
    if ((name[i] === ':' || name[i] === '.')
      && checkSrc.includes('`' + name.slice(0, i + 1) + '${')) return true;
  }
  return false;
};
const orphaned = ruleNames().filter(r => !isAlive(r)).map(r => r.id).sort();
check(`every catalogued rule is emitted by some check (${ruleNames().length} rules)`,
  orphaned.length === 0, `no emitter for: ${orphaned.join(', ')}`);

// `mode` tells an agent whether a rule can fire in the run it is about to do.
// It is derived from the section plus the "Live only:" convention, so the way it
// goes wrong is a url-only check written without that prefix, which would
// quietly advertise itself as reachable offline. An offline run is the control:
// nothing it emits may claim to need --url.
const modeOf = new Map(catalogue.map(r => [r.id, r.mode]));
const mislabelled = [...new Set((runJson(FIXTURE).json?.results ?? []).map(r => r.id).filter(Boolean))]
  .filter(id => modeOf.get(id) === 'url').sort();
check('no rule emitted by an offline run is catalogued as needing --url',
  mislabelled.length === 0, mislabelled.join(', '));
check('  …and the catalogue reports both modes',
  new Set(catalogue.map(r => r.mode)).size === 2 &&
  catalogue.every(r => ['offline', 'url'].includes(r.mode)));

console.log('the plugin wiring resolves — a broken path here is a dead command:');
// The commands and the skill router reach their instructions by PATH, and a
// path is only checked when someone runs the command. Nothing else in this file
// would notice a renamed reference file: the audit tool would still pass every
// assertion above while `/mwk-rider:audit` loaded nothing.
const ROOT = join(here, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
check('plugin.json and marketplace.json parse, and agree on the plugin name',
  manifest.name === 'mwk-rider' && market.plugins.some(p => p.name === manifest.name),
  `${manifest.name} vs ${market.plugins.map(p => p.name).join(', ')}`);

// ${CLAUDE_PLUGIN_ROOT} is expanded before the model reads the file, so the
// literal string is what we resolve against the repo root here.
const modeCommands = ['audit.md', 'create.md'];
for (const name of modeCommands) {
  const body = readFileSync(join(ROOT, 'commands', name), 'utf8');
  const refs = [...body.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+)/g)].map(m => m[1]);
  check(`commands/${name} inlines at least one plugin file, and every path exists`,
    refs.length > 0 && refs.every(r => existsSync(join(ROOT, r))),
    refs.filter(r => !existsSync(join(ROOT, r))).join(', ') || `${refs.length} ref(s)`);
}
// The two mode commands are not the only commands, and a path in any of them is
// just as dead. Enumerate rather than list, so a command added later is covered
// the day it lands instead of the day someone remembers to add it here.
const allCommands = readdirSync(join(ROOT, 'commands')).filter(f => f.endsWith('.md'));
const badRef = [], noDesc = [];
for (const name of allCommands) {
  const body = readFileSync(join(ROOT, 'commands', name), 'utf8');
  for (const m of body.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s`"')]+)/g)) {
    if (!existsSync(join(ROOT, m[1]))) badRef.push(`${name} → ${m[1]}`);
  }
  // Without a description the command is invisible in the / menu.
  if (!/^---\n(?:.*\n)*?description:\s*\S/m.test(body)) noDesc.push(name);
}
check(`every plugin-root path in commands/ resolves (${allCommands.length} command(s))`,
  badRef.length === 0, badRef.join(', '));
check('  …and every command declares a description',
  noDesc.length === 0, noDesc.join(', '));
const router = readFileSync(join(ROOT, 'skills', 'rider', 'SKILL.md'), 'utf8');
const routed = [...router.matchAll(/`references\/([A-Z]+\.md)`/g)].map(m => m[1]);
check('the skill router names both modes, and both files are there',
  routed.length === 2 && routed.every(f => existsSync(join(ROOT, 'skills', 'rider', 'references', f))),
  routed.join(', '));
// The commands must load the SAME files the router sends an agent to, or a typed
// command and an inferred mode quietly become two different products.
const inlined = modeCommands.flatMap(name =>
  [...readFileSync(join(ROOT, 'commands', name), 'utf8').matchAll(/references\/([A-Z]+\.md)/g)].map(m => m[1]));
check('  …and the commands inline those same two files, not copies of them',
  routed.every(f => inlined.includes(f)), `router: ${routed.join(', ')} | commands: ${inlined.join(', ')}`);

console.log('');
if (failures === 0) { console.log('PASS — all assertions ok'); process.exit(0); }
else { console.log(`FAIL — ${failures} assertion(s) failed`); process.exit(1); }
