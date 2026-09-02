#!/usr/bin/env node
/**
 * verify-example — build an example site, serve it for real, audit it live.
 *
 * The gate audited both examples OFFLINE only until this existed, so `live`,
 * `lighthouse` and `browser` — three of the ten domains — were never exercised
 * against the two sites that are supposed to be the baseline's existence proof.
 * That was not theoretical: the fixture was `0 🔧` offline and `1 🔧` live for
 * months, because its pages declared an `og:image` that nothing generated
 * (issue #25). On the starter it is the difference between 55 checks and 89.
 *
 * **Serving it correctly is the whole trick, and getting it wrong is silent.**
 * `@astrojs/cloudflare` splits the build into `dist/client` + `dist/server`, so
 * pointing a static server at `dist/` hands out a DIRECTORY LISTING and every
 * check passes against nothing — a clean run that measured no site at all.
 * That happened twice while this was still a manual recipe. So: a site with an
 * adapter is served by `wrangler dev`, which is also the only way the `_headers`
 * file is actually applied and the cache checks mean anything. A plain static
 * build is served from `dist/` by the little server below.
 *
 *   node ../../tools/verify-example.mjs [--strict] [extra audit flags…]
 *
 * Exits with the audit's own exit code, so CI fails on a finding.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const AUDIT = join(dirname(fileURLToPath(import.meta.url)), 'audit.mjs');
const cwd = process.cwd();
const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const usesAdapter = Object.keys(deps).some((d) => /^@astrojs\/(cloudflare|vercel|netlify|node|deno)$/.test(d));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

/**
 * A static server over dist/, resolving a directory to its index.html.
 *
 * It runs in a CHILD process, and that is not incidental: the audit below is
 * `spawnSync`, which blocks this process's event loop for the entire run, so an
 * in-process server would never answer a single request. The first version did
 * exactly that and reported `🛑 browser: load — Timeout 30000ms exceeded`
 * against a site that was fine — a tool for finding false positives, generating
 * one.
 */
function serveStaticInProcess(root) {
  return new Promise((ready) => {
    const srv = createServer((req, res) => {
      let p = resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
      if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p) && existsSync(p + '.html')) p += '.html';
      if (!existsSync(p) || statSync(p).isDirectory()) {
        const nf = join(root, '404.html');
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(existsSync(nf) ? readFileSync(nf) : 'not found');
      }
      res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
      createReadStream(p).pipe(res);
    });
    srv.listen(0, '127.0.0.1', function () { ready(this.address().port); });
  });
}

// `--serve <root>` is this file re-entered as the child. It prints its port on
// stdout and then just serves until it is killed.
if (process.argv[2] === '--serve') {
  const port = await serveStaticInProcess(resolve(process.argv[3]));
  process.stdout.write(String(port) + '\n');
} else {

/** Spawn the static server as a child and wait for it to announce its port. */
function serveStatic(root) {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve', root],
      { stdio: ['ignore', 'pipe', 'inherit'] });
    const timer = setTimeout(() => { child.kill(); fail(new Error('static server did not start')); }, 15_000);
    child.stdout.once('data', (d) => {
      clearTimeout(timer);
      ok({ url: `http://127.0.0.1:${String(d).trim()}`, stop: () => child.kill() });
    });
  });
}

/** wrangler dev, waited for by polling rather than by parsing its output. */
async function serveWrangler() {
  const port = 8000 + Math.floor(Math.random() * 1000);
  const proc = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1'],
    { cwd, stdio: 'ignore', detached: true });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return { url, stop: () => { try { process.kill(-proc.pid); } catch {} } };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  try { process.kill(-proc.pid); } catch {}
  throw new Error(`wrangler dev did not answer on ${url} within 90s`);
}

console.log(`verify: building ${pkg.name}…`);
if (spawnSync('npm', ['run', 'build'], { cwd, stdio: 'inherit' }).status !== 0) {
  console.error('verify: build failed'); process.exit(1);
}

const distRoot = join(cwd, 'dist');
// A `dist/client` means the adapter split the build. Serving `dist` itself here
// is the directory-listing trap described above.
const staticRoot = existsSync(join(distRoot, 'client')) ? join(distRoot, 'client') : distRoot;

let server;
try {
  server = usesAdapter ? await serveWrangler() : await serveStatic(staticRoot);
} catch (err) {
  console.error(`verify: ${err.message}`); process.exit(1);
}
console.log(`verify: serving on ${server.url} (${usesAdapter ? 'wrangler dev' : 'static ' + staticRoot.replace(cwd, '.')})`);

const args = process.argv.slice(2);
const run = spawnSync('node', [AUDIT, '--url', server.url, ...args], { cwd, stdio: 'inherit' });
server.stop();
process.exit(run.status ?? 1);

}
