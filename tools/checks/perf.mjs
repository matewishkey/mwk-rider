// perf — the page-speed levers checkable from source:
//   1. public/_headers marks content-hashed assets (/_astro/*) immutable, so
//      repeat visits don't re-validate every JS/CSS/font.
//   2. Content <img> tags carry width + height (no layout shift / CLS).
//      <Image> from astro:assets bakes these in; raw <img> without them shifts.
//   3. Render-blocking CSS + webfont weight, measured on the built output.
//   4. Heavy third-party embeds are behind a facade, not loaded with the page.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

import { attrValue } from '../lib/html.mjs';
import { eachDistHtml } from '../lib/html.mjs';
import { SKIP_DIST, distDir, distRelative } from '../lib/dist.mjs';
import { astroBlock, MIN_IMMUTABLE_MAXAGE, CANONICAL_MAXAGE } from '../lib/headers.mjs';
import { embedProduct, fetchableMarkup } from '../lib/embed-hosts.mjs';

const SEC = 'perf';

const SCAN_EXTS = new Set(['.astro', '.tsx', '.jsx', '.html', '.md', '.mdx']);
const CONTENT_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);
const SVG_OR_FAVICON_RE = /\.(svg|ico)$|\bfavicon\b/i;

export async function run({ project, reporter }) {
  checkHeaders(project, reporter);
  checkCls(project, reporter);
  checkWeight(project, reporter);
  checkEmbeds(project, reporter);
}

// 1. public/_headers — hashed assets immutable -------------------------------

function checkHeaders(project, reporter) {
  const path = join(project.root, 'public', '_headers');
  if (!existsSync(path)) {
    reporter.fix(SEC, '_headers', 'public/_headers missing — hashed bundles served max-age=0 (every repeat visit re-validates all JS/CSS)', 'add public/_headers marking /_astro/* immutable');
    return;
  }

  const block = astroBlock(project.root);
  if (!block) {
    reporter.fix(SEC, '_headers:/_astro/*', 'no /_astro/* rule — content-hashed bundles not marked immutable', 'add a /_astro/* block to public/_headers');
    return;
  }

  const cc = block.headers['cache-control'] ?? '';
  const hasImmutable = /\bimmutable\b/.test(cc);
  const maxAge = Number(cc.match(/max-age=(\d+)/)?.[1] ?? 0);
  if (hasImmutable && maxAge >= MIN_IMMUTABLE_MAXAGE) {
    reporter.pass(SEC, '_headers:/_astro/*', maxAge >= CANONICAL_MAXAGE ? '1yr immutable' : `${maxAge}s immutable`);
  } else {
    const missing = [
      !hasImmutable ? 'immutable' : null,
      maxAge < MIN_IMMUTABLE_MAXAGE ? `max-age (${maxAge}s, need ≥${MIN_IMMUTABLE_MAXAGE})` : null,
    ].filter(Boolean).join(' + ');
    reporter.fix(SEC, '_headers:/_astro/*', `Cache-Control missing ${missing}`, 'set "Cache-Control: public, max-age=31536000, immutable" on /_astro/*');
  }
}

// 2. CLS — content <img> tags need width + height ----------------------------

function checkCls(project, reporter) {
  const offenders = [];
  let scanned = 0;
  walkSource(project.root, (relPath) => {
    if (!SCAN_EXTS.has(extname(relPath).toLowerCase())) return;
    let text;
    try { text = readFileSync(join(project.root, relPath), 'utf8'); }
    catch { return; }   // unreadable file — skip it, never lose the domain
    const re = /<img\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const attrs = m[1];
      const src = attrValue(attrs, 'src') ?? '';
      if (!isContentImageRef(src)) continue;
      scanned++;
      // A *value* is required here, not mere presence: a bare `width` reserves
      // no space, so it cannot prevent the layout shift this check exists for.
      if (attrValue(attrs, 'width') == null || attrValue(attrs, 'height') == null) {
        offenders.push({ file: relPath, line: lineOf(text, m.index), src });
      }
    }
  });

  if (scanned === 0) {
    reporter.skip(SEC, 'cls:img-dimensions', 'no raw content <img> in src/ — nothing to check (<Image> bakes dimensions in)');
  } else if (offenders.length === 0) {
    reporter.pass(SEC, 'cls:img-dimensions', `all ${scanned} content <img> carry width + height`);
  } else {
    for (const o of offenders) {
      reporter.fix(SEC, 'cls:img-dimensions', `<img src="${truncate(o.src, 60)}"> lacks width/height → layout shift (CLS)`, 'use <Image> from astro:assets (bakes width/height), or add explicit width + height', { file: o.file, line: o.line });
    }
  }
}

function isContentImageRef(src) {
  if (!src || SVG_OR_FAVICON_RE.test(src)) return false;
  if (src.startsWith('data:') || src.startsWith('blob:')) return false;
  const ext = extname(src.split('?')[0]).toLowerCase();
  if (CONTENT_IMAGE_EXTS.has(ext)) return true;
  if (/^https?:\/\/media\./.test(src)) return true;
  return false;
}

function walkSource(root, callback) {
  const src = join(root, 'src');
  if (!existsSync(src)) return;
  const stack = [src];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else callback(relative(root, full));
    }
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// 3. Payload weight — CSS and fonts -------------------------------------------
//
// Both are render-blocking and both are trivially measurable from dist/. Nothing
// checked either: modules:fonts only detects a third-party font *CDN*.
//
// CSS is measured PER PAGE, not across dist/. Astro emits a stylesheet per route,
// so a 484-page site legitimately has dozens of .css files while any single page
// links two — totalling the directory would punish a site for having pages.

const CSS_BYTES_SUGGEST = 100 * 1024;
const CSS_BYTES_FIX     = 250 * 1024;
const CSS_LINKS_SUGGEST = 3;
const FONT_FAMILIES_SUGGEST = 2;
const FONT_FACES_SUGGEST    = 4;
const FONT_BYTES_SUGGEST = 200 * 1024;
const FONT_BYTES_FIX     = 500 * 1024;

const FONT_FILE_RE = /\.(woff2|woff|ttf|otf|eot)$/i;
const LEGACY_FONT_RE = /\.(ttf|otf|eot)$/i;

export function checkWeight(project, reporter) {
  if (!project.hasDist) {
    reporter.skip(SEC, 'css:bytes', 'no dist/ — build the site to measure the CSS it ships');
    reporter.skip(SEC, 'font:bytes', 'no dist/ — build the site to measure the fonts it ships');
    return;
  }
  const files = distTree(distDir(project.root));
  checkCssWeight(project, reporter, files);
  checkFontWeight(project, reporter, files);
}

function checkCssWeight(project, reporter, files) {
  const dist = distDir(project.root);
  const pages = files.filter((f) => f.endsWith('.html'));
  if (pages.length === 0) {
    reporter.skip(SEC, 'css:bytes', 'no built HTML — nothing to measure');
    return;
  }

  let worst = { bytes: 0, page: null }, mostLinks = { n: 0, page: null };
  for (const page of pages) {
    let html;
    try { html = readFileSync(page, 'utf8'); } catch { continue; }
    const hrefs = [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)]
      .map((m) => m[0].match(/href=["']([^"']+)["']/)?.[1])
      .filter(Boolean);
    let bytes = 0;
    for (const href of hrefs) {
      if (/^https?:/i.test(href)) continue;   // a third-party sheet: not ours to size
      bytes += sizeOf(join(dist, href.replace(/^\//, '')));
    }
    // Inlined <style> counts: Astro inlines small stylesheets, and those bytes
    // are just as render-blocking as a linked file.
    for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) bytes += Buffer.byteLength(m[1], 'utf8');
    const rel = relative(project.root, page);
    if (bytes > worst.bytes) worst = { bytes, page: rel };
    if (hrefs.length > mostLinks.n) mostLinks = { n: hrefs.length, page: rel };
  }

  const at = worst.page ? { file: worst.page } : {};
  if (worst.bytes > CSS_BYTES_FIX) {
    reporter.fix(SEC, 'css:bytes', `${humanKB(worst.bytes)} of render-blocking CSS on the heaviest page — over the ${humanKB(CSS_BYTES_FIX)} budget`, 'this is usually an unpurged framework: enable the purge/content scan so only used rules ship', at);
  } else if (worst.bytes > CSS_BYTES_SUGGEST) {
    reporter.suggest(SEC, 'css:bytes', `${humanKB(worst.bytes)} of render-blocking CSS on the heaviest page (soft budget ${humanKB(CSS_BYTES_SUGGEST)})`, 'check whether a framework is shipping rules the page never uses', at);
  } else {
    reporter.pass(SEC, 'css:bytes', `heaviest page ships ${humanKB(worst.bytes)} of CSS`, at);
  }

  if (mostLinks.n > CSS_LINKS_SUGGEST) {
    reporter.fix(SEC, 'css:files', `${mostLinks.n} render-blocking stylesheets on one page`, 'each one is a separate round-trip before first paint — bundle them', { file: mostLinks.page });
  } else {
    reporter.pass(SEC, 'css:files', `at most ${mostLinks.n} stylesheet link(s) per page`);
  }
}

function checkFontWeight(project, reporter, files) {
  const fontFiles = files.filter((f) => FONT_FILE_RE.test(f));
  const bytes = fontFiles.reduce((s, f) => s + sizeOf(f), 0);

  // @font-face blocks, deduped by content: the same block is repeated in every
  // page's inlined <style>, so counting occurrences across dist/ multiplies by
  // the page count (2904 of them on a real 484-page site).
  const blocks = new Set();
  for (const f of files) {
    if (!/\.(css|html)$/i.test(f)) continue;
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/@font-face\s*\{[\s\S]*?\}/gi)) blocks.add(m[0].replace(/\s+/g, ' '));
  }

  // Astro's Fonts API emits a second @font-face per family carrying fallback
  // metrics — its family name contains "fallback:". Counting those as real
  // families reported every correctly-configured two-font site as having four.
  const real = [...blocks].filter((b) => !/font-family\s*:\s*["']?[^;"'}]*fallback:/i.test(b));
  const families = new Set();
  for (const b of real) {
    const name = b.match(/font-family\s*:\s*["']?([^;"'}]+)/i)?.[1]?.trim().toLowerCase();
    // Astro hashes the family name (`outfit-cce106cc3d487109`); one family, one name.
    if (name) families.add(name.replace(/-[0-9a-f]{8,}$/, ''));
  }

  if (fontFiles.length === 0 && real.length === 0) {
    reporter.skip(SEC, 'font:bytes', 'no webfonts in dist/ — nothing to measure');
    return;
  }

  if (bytes > FONT_BYTES_FIX) {
    reporter.fix(SEC, 'font:bytes', `${humanKB(bytes)} of webfonts in ${fontFiles.length} file(s) — over the ${humanKB(FONT_BYTES_FIX)} budget`, 'subset to the characters actually used, drop unused weights, and prefer one variable font over four static ones');
  } else if (bytes > FONT_BYTES_SUGGEST) {
    reporter.suggest(SEC, 'font:bytes', `${humanKB(bytes)} of webfonts in ${fontFiles.length} file(s) (soft budget ${humanKB(FONT_BYTES_SUGGEST)})`, 'subsetting or a variable font usually halves this');
  } else {
    reporter.pass(SEC, 'font:bytes', `${humanKB(bytes)} of webfonts in ${fontFiles.length} file(s)`);
  }

  if (families.size > FONT_FAMILIES_SUGGEST) {
    reporter.fix(SEC, 'font:families', `${families.size} font families (${[...families].join(', ')})`, 'two families — one for headings, one for body — is enough for almost any content site');
  } else {
    reporter.pass(SEC, 'font:families', `${families.size} font ${families.size === 1 ? 'family' : 'families'}`);
  }

  if (real.length > FONT_FACES_SUGGEST) {
    reporter.fix(SEC, 'font:faces', `${real.length} @font-face declarations`, 'each is a separate file to download — a variable font covers a whole weight range in one');
  } else {
    reporter.pass(SEC, 'font:faces', `${real.length} @font-face declaration(s)`);
  }

  const legacy = fontFiles.filter((f) => LEGACY_FONT_RE.test(f));
  if (legacy.length) {
    reporter.fix(SEC, 'font:format', `${legacy.length} font file(s) served as ttf/otf/eot`, 'convert to woff2 — universally supported for years and roughly half the bytes', { file: relative(project.root, legacy[0]) });
  } else {
    reporter.pass(SEC, 'font:format', 'all webfonts are woff2/woff');
  }
}

// 4. Heavy third-party embeds behind a facade --------------------------------

/**
 * A heavy third-party iframe in the built HTML is, by definition, loaded with
 * the page — a facade injects the frame at scroll time, so a compliant site has
 * nothing here to find.
 *
 * `loading="lazy"` deliberately does not exempt one. It defers only frames far
 * enough down, and the measured case (cypruspokerbrisbane.com) had the map in
 * the *second section*, inside the threshold: the attribute was present, the
 * 360 KB was fetched anyway, and mobile Performance sat at 70 until the embed
 * went behind an IntersectionObserver facade (then 97).
 */
function checkEmbeds(project, reporter) {
  if (!project.hasDist) {
    reporter.skip(SEC, 'embed:eager', 'no dist/ — build the site to check for eagerly-loaded third-party embeds');
    return;
  }

  let iframes = 0;
  const found = [];
  const seen = new Set();
  eachDistHtml(project.root, (rel, html) => {
    for (const m of fetchableMarkup(html).matchAll(/<iframe\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi)) {
      iframes++;
      const src = attrValue(m[1], 'src') ?? attrValue(m[1], 'data-src');
      if (!src) continue;
      const product = embedProduct(src);
      if (!product) continue;
      // One finding per embed, not per page: a component rendered on 400 pages
      // is one edit. First page wins as the place to look.
      const key = `${product}|${src.split(/[?#]/)[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ product, src, page: distRelative(project.root, rel), lazy: /\bloading\s*=\s*["']?lazy/i.test(m[1]) });
    }
  });

  if (found.length === 0) {
    reporter.pass(SEC, 'embed:eager', iframes === 0
      ? 'no <iframe> in the built pages'
      : `none of the ${iframes} built <iframe>(s) is a heavy third-party embed`);
    return;
  }
  for (const f of found) {
    const lazyNote = f.lazy
      ? ' — loading="lazy" does not defer it: native lazy loading has a generous near-viewport threshold, and an embed high on the page falls inside it (measured)'
      : '';
    reporter.fix(
      SEC,
      'embed:eager',
      `${f.product} embed loads with the page${lazyNote} (${truncate(f.src, 90)})`,
      'replace it with a facade — render a static placeholder (an image or a styled box) and inject the <iframe> from an IntersectionObserver when the user scrolls near it. Keeping the real frame in a <template> or <noscript> is fine; neither is fetched',
      { file: f.page },
    );
  }
}

function distTree(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIST.has(e.name)) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

function sizeOf(p) {
  try { return statSync(p).size; } catch { return 0; }
}

function humanKB(bytes) {
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}
