#!/usr/bin/env node
/**
 * Put a photo in the site's media bucket and print the frontmatter for it.
 *
 *   npm run media -- <file> <key>
 *   npm run media -- ~/Pictures/shopfront.jpg blog/opening-day/cover.jpg
 *
 * Content media never enters git. It goes to one R2 bucket per site, behind a
 * custom domain, and pages request it through Cloudflare's transform URL so the
 * edge produces every size on demand. This script is the whole upload path:
 *
 *   1. read the image's dimensions — the one thing the build cannot do for a
 *      file it never sees, and without them the page shifts when it loads;
 *   2. upload the ORIGINAL, unresized, with a long immutable cache header;
 *   3. print the `cover:` block to paste into the post.
 *
 * Keys follow the content — `blog/<post id>/<name>.<ext>` — so a post and its
 * media share a name, and `wrangler r2 object list` is the inventory. There is
 * no manifest to drift.
 *
 * Needs `mediaBucket` and `mediaDomain` in scripts/og.config.mjs and a logged-in
 * wrangler (CLAUDE.md § Operator steps). It refuses to run without them rather
 * than uploading somewhere you did not mean.
 */
import { statSync } from 'node:fs';
import { extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { config } from './og.config.mjs';

const [file, key] = process.argv.slice(2);
const usage = 'usage: npm run media -- <file> <key>   e.g. npm run media -- photo.jpg blog/<post-id>/cover.jpg';
if (!file || !key) fail(usage);
if (!/^[\w./-]+$/.test(key) || key.startsWith('/') || key.includes('..')) fail(`key "${key}" — use letters, digits, ./-_ and no leading slash`);
if (!config.mediaBucket || !config.mediaDomain) fail('set mediaBucket and mediaDomain in scripts/og.config.mjs first (CLAUDE.md § Operator steps)');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' };
const type = MIME[extname(key).toLowerCase()];
if (!type) fail(`key "${key}" — extension must be one of ${Object.keys(MIME).join(' ')}`);

let meta;
try { meta = await sharp(file).metadata(); } catch (e) { fail(`cannot read ${file}: ${e.message}`); }
const { width, height } = meta;
if (!width || !height) fail(`${file}: no dimensions readable`);
const kb = Math.round(statSync(file).size / 1024);
// The edge never upscales, so a source narrower than the widest srcset rung
// caps what any screen can get. Say so; do not block.
if (width < 1600) console.warn(`note: ${width}px wide — the responsive ladder tops out at 1600, so large screens get this size. Fine for most photos.`);

// `--remote` is not optional: wrangler 4 writes to a LOCAL emulation of the
// bucket by default and prints "Resource location: local" in the noise. The
// first run of this script did exactly that, reported success, and the edge
// served a 404. Measured on wrangler 4.118, 2026-09-02.
const r = spawnSync('npx', ['wrangler', 'r2', 'object', 'put', `${config.mediaBucket}/${key}`, '--remote',
  '--file', file, '--content-type', type, '--cache-control', 'public, max-age=31536000, immutable'],
  { stdio: 'inherit' });
if (r.status !== 0) fail(`upload failed (wrangler exit ${r.status}) — is wrangler logged in, and does the bucket exist?`);

console.log(`
uploaded ${file} (${width}×${height}, ${kb} KB) → https://${config.mediaDomain}/${key}

paste into the post's frontmatter:

cover:
  key: ${key}
  width: ${width}
  height: ${height}
coverAlt: <what the photo shows, in one sentence>
`);

function fail(msg) { console.error(msg); process.exit(1); }
