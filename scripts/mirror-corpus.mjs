#!/usr/bin/env node
/**
 * Mirror live sites into throwaway Astro-shaped trees, to audit against.
 *
 *   node scripts/mirror-corpus.mjs <out-dir> <url…>
 *   PAGES=20 node scripts/mirror-corpus.mjs /tmp/corpus https://example.com
 *
 * ## Why this exists
 *
 * A check is only trustworthy once it has met sites nobody here wrote — ours
 * share our habits and so cannot contain the shape a false positive needs
 * (`docs/DEVELOPING.md` § Testing, rounds 7-9). Cloning and building a
 * stranger's repo works but is slow and runs their postinstall; for any check
 * that reads `dist/` HTML you can instead fetch the pages and write them into a
 * `dist/` with a stub `package.json` and `astro.config.mjs`. No build, no code
 * executed, ~30 sites in minutes.
 *
 * `https://astro.build/showcase/` is a ready-made list of real Astro sites and
 * is what rounds 8 and 9 used.
 *
 * ## The rule that governs it
 *
 * **A sampled mirror is only valid for PER-PAGE checks.** Anything whose subject
 * is the link graph or cross-page uniqueness — `seo: links:internal`,
 * `seo: links:orphan`, `seo: sitemap:coverage`, `seo: meta:unique:title` — needs
 * a COMPLETE corpus, because every page you did not fetch looks like a broken
 * link or a missing sitemap entry. An 8-page sample of a 57-page site once
 * reported 115 false broken links; the complete mirror of it reported zero. Set
 * PAGES high enough to take the whole sitemap, or confine yourself to the
 * per-page checks.
 *
 * The sample is spread across the sitemap rather than taken from the front,
 * because the first N URLs of a docs site are all one section.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const PAGES_PER_SITE = Number(process.env.PAGES || 12);
const [outRoot, ...sites] = process.argv.slice(2);

if (!outRoot || sites.length === 0) {
  console.error('usage: node scripts/mirror-corpus.mjs <out-dir> <url…>   (env: PAGES=12)');
  process.exit(2);
}

async function get(url, timeout = 20000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    return r.ok ? { url: r.url, body: await r.text() } : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

const locsIn = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);

/** Page URLs for a site: its sitemap if it has one, else same-origin links off the homepage. */
async function pageUrls(origin) {
  const found = [];
  const robots = await get(new URL('/robots.txt', origin).href);
  const maps = robots ? [...robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
  if (!maps.length) maps.push(new URL('/sitemap.xml', origin).href, new URL('/sitemap-index.xml', origin).href);

  for (const map of maps.slice(0, 3)) {
    const r = await get(map);
    if (!r) continue;
    if (/<sitemapindex/i.test(r.body)) {
      for (const sub of locsIn(r.body).slice(0, 2)) {
        const s = await get(sub);
        if (s) found.push(...locsIn(s.body));
      }
    } else found.push(...locsIn(r.body));
    if (found.length) break;
  }

  if (!found.length) {
    const home = await get(origin);
    if (home) {
      for (const m of home.body.matchAll(/href="(\/[^"#?]*)"/g)) {
        try { found.push(new URL(m[1], origin).href); } catch { /* not a URL */ }
      }
    }
  }

  const sameOrigin = [...new Set(found)].filter((u) => {
    try { return new URL(u).origin === new URL(origin).origin; } catch { return false; }
  });
  const step = Math.max(1, Math.floor(sameOrigin.length / PAGES_PER_SITE));
  const spread = [];
  for (let i = 0; i < sameOrigin.length && spread.length < PAGES_PER_SITE; i += step) spread.push(sameOrigin[i]);
  return [origin, ...spread.filter((u) => u !== origin)].slice(0, PAGES_PER_SITE);
}

for (const site of sites) {
  const name = new URL(site).hostname.replace(/^www\./, '');
  const dir = join(outRoot, name);
  if (existsSync(join(dir, '.mirrored'))) { console.log(`skip   ${name} (already mirrored)`); continue; }

  const urls = await pageUrls(site);
  let written = 0;
  for (const u of urls) {
    const r = await get(u);
    if (!r) continue;
    let path = new URL(u).pathname;
    if (path.endsWith('/')) path += 'index.html';
    else if (!/\.html?$/.test(path)) path += '/index.html';
    const file = join(dir, 'dist', path.replace(/^\//, ''));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, r.body);
    written++;
  }
  if (written === 0) { console.log(`FAIL   ${name} — no pages fetched`); continue; }

  // The minimum that makes lib/project.mjs treat this as an Astro project.
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'),
    `${JSON.stringify({ name, private: true, dependencies: { astro: '^7.0.0' } }, null, 2)}\n`);
  writeFileSync(join(dir, 'astro.config.mjs'),
    `import { defineConfig } from 'astro/config';\nexport default defineConfig({ site: '${site}', output: 'static' });\n`);
  writeFileSync(join(dir, '.mirrored'), `${new Date().toISOString()}\n${written} pages\n`);
  console.log(`ok     ${name} — ${written} pages`);
}
