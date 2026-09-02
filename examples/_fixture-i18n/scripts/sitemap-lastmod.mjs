// lastmod for the sitemap, read from the content itself.
//
// @astrojs/sitemap only emits <lastmod> when serialize() supplies one, so a
// sitemap can be perfectly well configured and still tell crawlers nothing about
// what changed. This builds a URL → date map from the blog frontmatter and hands
// it to serialize(); pages that aren't posts fall back to the build time, which
// is the honest answer for a static route that shipped in this build.
//
// astro.config can't import `astro:content`, so the frontmatter is read off
// disk. Only the two date fields are needed — no YAML parser required.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const CONTENT_DIR = 'src/data/blog';

/** { '/blog/welcome': '2026-05-18T00:00:00.000Z', '/hu/blog/welcome': … } */
export function postLastmods(root, { defaultLocale = 'en' } = {}) {
  const base = join(root, CONTENT_DIR);
  const out = {};
  for (const file of walk(base)) {
    const id = relative(base, file).replace(/\.mdx?$/, '');
    const [locale, ...rest] = id.split('/');
    const slug = rest.join('/');
    // Drafts and preview-only posts never reach the sitemap.
    if (!slug || slug.startsWith('_')) continue;
    const fm = frontmatter(file);
    if (fm.draft === 'true') continue;
    const date = fm.dateModified ?? fm.date;
    if (!date) continue;
    const path = locale === defaultLocale ? `/blog/${slug}` : `/${locale}/blog/${slug}`;
    out[path] = new Date(date).toISOString();
  }
  return out;
}

/**
 * A serialize() for @astrojs/sitemap: content dates for posts, build time for
 * everything else. Pass the result of postLastmods().
 */
export function lastmodSerializer(lastmods, buildTime = new Date().toISOString()) {
  return (item) => {
    const path = new URL(item.url).pathname.replace(/\/$/, '') || '/';
    item.lastmod = lastmods[path] ?? buildTime;
    return item;
  };
}

function frontmatter(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return {}; }
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const out = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^(date|dateModified|draft)\s*:\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function walk(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.mdx?$/.test(e.name) && statSync(full).isFile()) out.push(full);
  }
  return out;
}
