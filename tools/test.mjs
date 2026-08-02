#!/usr/bin/env node
// Smoke test for the wishbusterz-rider audit tool.
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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
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

function runJson(cwd, args = []) {
  const r = spawnSync('node', [AUDIT, '--json', ...args], { cwd, encoding: 'utf8' });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
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
  check('all six domains ran', new Set(fix.json.results.map(r => r.section)).size >= 6);
}

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

console.log('adapter:cloudflare is gated on SSR, not <Image> presence:');
// <Image> on a static build is optimized at build time by Sharp → no adapter
// needed. The Cloudflare image service only matters under output:'server', where
// Sharp can't run on Workers. Build throwaway projects and read just that result.
function mkProject({ output, withImage, withAdapter }) {
  const dir = tmpProject('wishbusterz-rider-mod-');
  const deps = { astro: '^7.1.6' };
  if (withAdapter) deps['@astrojs/cloudflare'] = '^14.1.7';
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx', type: 'module', dependencies: deps }));
  writeFileSync(join(dir, 'astro.config.mjs'), `export default { output: '${output}' };\n`);
  mkdirSync(join(dir, 'src', 'pages'), { recursive: true });
  const body = withImage
    ? `---\nimport { Image } from 'astro:assets';\nimport shot from '../shot.png';\n---\n<Image src={shot} alt="x" />\n`
    : `<p>hi</p>\n`;
  writeFileSync(join(dir, 'src', 'pages', 'index.astro'), body);
  return dir;
}
function adapterResult(opts) {
  const { json } = runJson(mkProject(opts), ['-s', 'modules', '--strict']);
  return json?.results.find(r => r.name === 'adapter:cloudflare') ?? null;
}
const staticImg = adapterResult({ output: 'static', withImage: true, withAdapter: false });
check('static + <Image>, no adapter → pass (build-time Sharp)', staticImg?.outcome === 'pass', JSON.stringify(staticImg));
const ssrNoAdapter = adapterResult({ output: 'server', withImage: true, withAdapter: false });
check('SSR + <Image>, no adapter → block', ssrNoAdapter?.outcome === 'block', JSON.stringify(ssrNoAdapter));
const ssrAdapter = adapterResult({ output: 'server', withImage: true, withAdapter: true });
check('SSR + <Image> + adapter → pass', ssrAdapter?.outcome === 'pass', JSON.stringify(ssrAdapter));

console.log('Astro 7 migration checks fire on a v6-shaped project:');
// The fixture is compliant by construction, so it only proves these checks stay
// quiet. Build the known-bad counterpart and prove each one actually fires.
function mkLegacyProject({ deps = {}, config = '', src = '' } = {}) {
  const dir = tmpProject('wishbusterz-rider-v7-');
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

// A site using BaseHead.astro rather than SEO.astro is not wrong. This used to
// emit required findings AND silently skip every meta:* check.
const headDir = tmpProject('wishbusterz-rider-head-');
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
check('  …and every meta:* check actually ran',
  ['og:image','og:image:width','og:image:height','og:type','og:url','canonical']
    .every(n => seoRows.find(r => r.name === `meta:${n}`)?.outcome === 'pass'));

// Auditing a repo must never be equivalent to running it.
const rceDir = tmpProject('wishbusterz-rider-rce-');
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
const srvDir = tmpProject('wishbusterz-rider-srv-');
const srvFile = join(srvDir, 'server.mjs');
writeFileSync(srvFile, `
import { createServer } from 'node:http';
const png = Buffer.concat([
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
  Buffer.from([0,0,0,13]), Buffer.from('IHDR'),
  Buffer.from([0,0,0x04,0xb0,0,0,0x02,0x76,8,6,0,0,0]),
]);
const page = '<!doctype html><html><head><link rel="canonical" href="/"><title>t</title>'
  + '<meta property="og:image" content="/og/card.png">'
  + '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
  + '<script type="application/ld+json">{"@type":"WebSite"}<\\/script>'
  + '</head><body><h1>Home</h1></body></html>';
createServer((req, res) => {
  const png_ = req.url.startsWith('/og/');
  const body = png_ ? png : Buffer.from(page);
  res.writeHead(200, { 'content-type': png_ ? 'image/png' : 'text/html', 'content-length': String(body.length) });
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(0, '127.0.0.1', function () { console.log(this.address().port); });
`);
const srv = spawn('node', [srvFile], { stdio: ['ignore', 'pipe', 'ignore'] });
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
  srv.stdout.once('data', (d) => { clearTimeout(timer); resolve(String(d).trim()); });
});
const live = runJson(tmpdir(), ['-s', 'live', '--url', `http://127.0.0.1:${port}`]);
srv.kill();
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

console.log('');
if (failures === 0) { console.log('PASS — all assertions ok'); process.exit(0); }
else { console.log(`FAIL — ${failures} assertion(s) failed`); process.exit(1); }
