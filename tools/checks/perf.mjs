// perf — the page-speed levers checkable from source:
//   1. public/_headers marks content-hashed assets (/_astro/*) immutable, so
//      repeat visits don't re-validate every JS/CSS/font.
//   2. Content <img> tags carry width + height (no layout shift / CLS).
//      <Image> from astro:assets bakes these in; raw <img> without them shifts.
//   3. Render-blocking CSS + webfont weight, measured on the built output.
//   4. Heavy third-party embeds are behind a facade, not loaded with the page.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

import { attrValue, hasAttr, eachDistHtml } from '../lib/html.mjs';
import { SKIP_DIST, distDir, distRelative } from '../lib/dist.mjs';
import { astroBlock, MIN_IMMUTABLE_MAXAGE, CANONICAL_MAXAGE } from '../lib/headers.mjs';
import { embedProduct, fetchableMarkup } from '../lib/embed-hosts.mjs';
import { fontFamilies } from '../lib/fonts-config.mjs';

const SEC = 'perf';

const SCAN_EXTS = new Set(['.astro', '.tsx', '.jsx', '.html', '.md', '.mdx']);
const CONTENT_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);
const SVG_OR_FAVICON_RE = /\.(svg|ico)$|\bfavicon\b/i;

export async function run({ project, reporter }) {
  checkHeaders(project, reporter);
  checkCls(project, reporter);
  checkWeight(project, reporter);
  checkEmbeds(project, reporter);
  checkCrossOrigin(project, reporter);
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
  checkDeclaredFamilies(project, reporter, files);
}

/**
 * A declared family that can never paint, and one that ships italic for nothing.
 *
 * Both cost real bytes and neither shows up in a byte total, because the total
 * is correct — it is the *composition* that is wrong. tasmanvisa-web declared
 * `Inter` in `fonts[]` and put it second in the `--font-sans` stack, behind a
 * self-hosted, preloaded `Sora`. It could only ever render if Sora failed to
 * load, and it was downloaded eagerly on every page: 277 KB, 143 KB of it italic
 * faces nothing referenced.
 */
function checkDeclaredFamilies(project, reporter, files) {
  const families = fontFamilies(project.astroConfig);
  if (families.length === 0) {
    // Both, not just the first: a check that emits nothing is indistinguishable
    // from one that did not run.
    reporter.skip(SEC, 'font:unused-family', 'no fonts[] in astro.config — nothing declared to trace into the CSS');
    reporter.skip(SEC, 'font:styles', 'no fonts[] in astro.config — nothing declared whose styles could default to [normal, italic]');
    return;
  }

  const css = files.filter((f) => /\.(css|html)$/i.test(f))
    .map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } })
    .join('\n');

  const dead = [];
  const fallbackOnly = [];
  for (const fam of families) {
    if (!fam.cssVariable) continue;
    const positions = stackPositions(css, fam.cssVariable);
    if (positions.length === 0) dead.push(fam);
    else if (!positions.includes(0)) fallbackOnly.push(fam);
  }

  const named = (f) => `${f.name ?? '(unnamed)'} (${f.cssVariable})`;
  if (fallbackOnly.length === 0 && dead.length === 0) {
    reporter.pass(SEC, 'font:unused-family', `all ${families.length} declared famil${families.length === 1 ? 'y leads a' : 'ies lead a'} font-family stack`);
  }
  for (const f of fallbackOnly) {
    reporter.fix(SEC, 'font:unused-family', `${named(f)} never leads a font-family stack — it is a webfont downloaded on every page that can only render if the font ahead of it fails`, "drop it from fonts[] and let Astro's metric-adjusted local fallback do that job, or move it to the front of the stack if it is the font you meant");
  }
  for (const f of dead) {
    reporter.suggest(SEC, 'font:unused-family', `${named(f)} is declared in fonts[] but its variable appears in no font-family stack in the built CSS`, 'remove it from fonts[], or apply it — as declared it is downloaded and never used');
  }

  // `styles` defaults to ['normal','italic'] (astro/dist/assets/fonts/constants.js),
  // so a family declared without it silently doubles its file count.
  const implicit = families.filter((f) => !f.hasStyles);
  if (implicit.length === 0) {
    reporter.pass(SEC, 'font:styles', `all ${families.length} declared famil${families.length === 1 ? 'y sets' : 'ies set'} styles explicitly`);
    return;
  }
  // <em>, <i> and friends render italic from the UA stylesheet with no CSS at
  // all, so "no font-style: italic in the CSS" is not evidence on its own —
  // asserting it would flag a blog with emphasis in its prose.
  const italicUsed = /font-style\s*:\s*(italic|oblique)/i.test(css)
    || /<(?:em|i|cite|dfn|var|address)\b/i.test(css);
  if (italicUsed) {
    reporter.suggest(SEC, 'font:styles', `${implicit.length} declared famil${implicit.length === 1 ? 'y omits' : 'ies omit'} styles, so italic faces are built for ${implicit.length === 1 ? 'it' : 'them'} too (the default is [normal, italic]) — ${implicit.map(named).join(', ')}`, 'set styles: ["normal"] on the families that never render italic; the axis that costs bytes is family × style × subset, not weight (a variable font covers a whole weight range in one file)');
  } else {
    reporter.fix(SEC, 'font:styles', `${implicit.length} declared famil${implicit.length === 1 ? 'y omits' : 'ies omit'} styles, so italic faces ship (the default is [normal, italic]) — and nothing in the built output renders italic: no font-style: italic, no <em>/<i>/<cite> — ${implicit.map(named).join(', ')}`, 'set styles: ["normal"] on them; the axis that costs bytes is family × style × subset, not weight (a variable font covers a whole weight range in one file)');
  }
}

/**
 * Where `var(--x)` sits in each comma-separated stack it appears in.
 *
 * Index 0 means it leads a stack — the font that actually paints. Anything else
 * means it only renders if everything before it fails to load, which for a
 * self-hosted webfont means never.
 */
function stackPositions(css, cssVariable) {
  const out = [];
  const useRe = new RegExp(`var\\(\\s*${cssVariable.replace(/[-]/g, '\\-')}\\s*[,)]`, 'g');
  for (const m of css.matchAll(useRe)) {
    // Back up to the start of this declaration's value, then count the commas
    // that are not inside a var()/quotes before our position.
    const declStart = Math.max(css.lastIndexOf(':', m.index), css.lastIndexOf(';', m.index), css.lastIndexOf('{', m.index));
    const value = css.slice(declStart + 1, m.index);
    let depth = 0, commas = 0;
    for (const ch of value) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) commas++;
    }
    out.push(commas);
  }
  return out;
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

// 5. Cross-origin images: preconnect, and a preload that matches -------------

/**
 * Images from another origin need the connection opened early.
 *
 * The browser only starts DNS + TLS for a host once it parses a URL pointing at
 * it, so on a 150 ms-RTT mobile link that is several round trips of dead time
 * before a single byte of the LCP image moves. tasmanvisa-web served every blog
 * hero and card from `media.tasmanvisa.com` with no preconnect anywhere: blog
 * index LCP 5424 ms, and ~3500 ms once a preconnect plus a matching head preload
 * were added.
 *
 * The site's own origin is read from each page's canonical link — the page's own
 * statement of where it lives — falling back to `site:` in astro.config. A page
 * that declares neither cannot be judged and is not counted.
 */
function checkCrossOrigin(project, reporter) {
  if (!project.hasDist) {
    reporter.skip(SEC, 'preconnect', 'no dist/ — build the site to check cross-origin image hosts');
    return;
  }
  const configSite = project.astroConfig?.match(/\bsite\s*:\s*(['"`])(https?:\/\/[^'"`]+)\1/)?.[2]
    ?? project.ogConfig?.siteUrl ?? null;

  // host → { images: Set<url>, preconnect: 'crossorigin' | 'bare' | null, page }
  const hosts = new Map();
  const preloadIssues = [];
  let pagesJudged = 0;

  eachDistHtml(project.root, (rel, html) => {
    const origin = pageOrigin(html, configSite);
    if (!origin) return;
    pagesJudged++;
    const page = distRelative(project.root, rel);
    const head = html.split(/<\/head>/i)[0] ?? html;
    const links = [...head.matchAll(/<link\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi)].map((m) => m[1]);

    for (const url of imageUrls(html)) {
      let host;
      try { host = new URL(url, origin); } catch { continue; }
      if (host.origin === origin) continue;
      const entry = hosts.get(host.origin) ?? { images: new Set(), preconnect: null, page };
      entry.images.add(host.href);
      hosts.set(host.origin, entry);
    }

    for (const attrs of links) {
      if (!/(?:^|\s)preconnect(?:\s|$)/i.test(attrValue(attrs, 'rel') ?? '')) continue;
      const href = attrValue(attrs, 'href');
      if (!href) continue;
      let target;
      try { target = new URL(href, origin).origin; } catch { continue; }
      const entry = hosts.get(target) ?? { images: new Set(), preconnect: null, page };
      // crossorigin wins: one page declaring it correctly is enough, since the
      // finding is about the connection the browser opens for that host.
      if (hasAttr(attrs, 'crossorigin')) entry.preconnect = 'crossorigin';
      else entry.preconnect ??= 'bare';
      hosts.set(target, entry);
    }

    collectPreloadMismatches(head, html, page, preloadIssues);
  });

  reportPreconnect(hosts, pagesJudged, reporter);
  reportPreloadPairs(preloadIssues, reporter);
}

function pageOrigin(html, configSite) {
  const canonical = html.match(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i)?.[0];
  const href = canonical ? attrValue(canonical.replace(/^<link/i, ''), 'href') : null;
  for (const candidate of [href, configSite]) {
    if (!candidate) continue;
    try { return new URL(candidate).origin; } catch { /* relative canonical — try the next */ }
  }
  return null;
}

/** Every image URL a document references: <img src|srcset>, <source srcset>, inline background-image. */
function imageUrls(html) {
  const out = [];
  for (const m of html.matchAll(/<(?:img|source)\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi)) {
    const src = attrValue(m[1], 'src');
    if (src) out.push(src);
    const srcset = attrValue(m[1], 'srcset');
    if (srcset) out.push(...srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean));
  }
  for (const m of html.matchAll(/background(?:-image)?\s*:[^;"'}]*?url\(\s*(["'`]?)([^"'`)]+)\1\s*\)/gi)) {
    out.push(m[2]);
  }
  return out.filter((u) => u && !u.startsWith('data:') && !u.startsWith('blob:'));
}

function reportPreconnect(hosts, pagesJudged, reporter) {
  const imageHosts = [...hosts.entries()].filter(([, v]) => v.images.size > 0);
  if (pagesJudged === 0) {
    reporter.skip(SEC, 'preconnect', 'no built page declares a canonical URL and astro.config sets no site — cannot tell which hosts are cross-origin');
    return;
  }
  if (imageHosts.length === 0) {
    reporter.pass(SEC, 'preconnect', `every image on the ${pagesJudged} built page(s) is same-origin — no connection to open early`);
    return;
  }

  const missing = imageHosts.filter(([, v]) => v.preconnect === null);
  // A host serving a single incidental image (one avatar, one badge) is not
  // what cost tasmanvisa 900 ms of LCP; advising it is right, failing a build
  // over it is not.
  const heavy = missing.filter(([, v]) => v.images.size >= 2);
  const incidental = missing.filter(([, v]) => v.images.size === 1);

  for (const [origin, v] of heavy) {
    reporter.fix(SEC, 'preconnect', `${v.images.size} images load from ${origin} with no <link rel="preconnect"> — DNS + TLS only start when the parser reaches the first one`, `add <link rel="preconnect" href="${origin}" crossorigin> to <head>`, { file: v.page });
  }
  for (const [origin, v] of incidental) {
    reporter.suggest(SEC, 'preconnect', `1 image loads from ${origin} with no <link rel="preconnect">`, `add <link rel="preconnect" href="${origin}" crossorigin> to <head> if it is on the critical path`, { file: v.page });
  }
  if (missing.length === 0) {
    reporter.pass(SEC, 'preconnect', `all ${imageHosts.length} cross-origin image host(s) are preconnected (${imageHosts.map(([o]) => o).join(', ')})`);
  }

  // A preconnect without `crossorigin` is the trap: images are CORS-mode
  // fetches, so the anonymous connection it opens is not the one the image can
  // use, and the browser opens a second. It looks fixed and is not.
  const bare = imageHosts.filter(([, v]) => v.preconnect === 'bare');
  if (bare.length === 0) {
    if (imageHosts.some(([, v]) => v.preconnect === 'crossorigin')) {
      reporter.pass(SEC, 'preconnect:crossorigin', `every preconnect to an image host carries crossorigin`);
    }
  } else {
    for (const [origin, v] of bare) {
      reporter.fix(SEC, 'preconnect:crossorigin', `<link rel="preconnect" href="${origin}"> has no crossorigin attribute — images are CORS-mode fetches, so the connection it opens is not the one they reuse`, `write it as <link rel="preconnect" href="${origin}" crossorigin>`, { file: v.page });
    }
  }
}

/**
 * A head `<link rel="preload" as="image">` has to match the `<img>` it is for,
 * byte for byte. If `imagesrcset`/`imagesizes` differ from the tag's
 * `srcset`/`sizes`, the browser resolves two different candidates and downloads
 * the image twice — the preload makes the page slower than none at all.
 */
function collectPreloadMismatches(head, html, page, out) {
  for (const m of head.matchAll(/<link\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi)) {
    const attrs = m[1];
    if (!/(?:^|\s)preload(?:\s|$)/i.test(attrValue(attrs, 'rel') ?? '')) continue;
    if ((attrValue(attrs, 'as') ?? '').toLowerCase() !== 'image') continue;
    const imagesrcset = attrValue(attrs, 'imagesrcset');
    const href = attrValue(attrs, 'href');
    const imagesizes = attrValue(attrs, 'imagesizes');

    // Find the <img> this preload is for: the one sharing a URL with it. No
    // match means the image is injected at runtime or lives on another page —
    // not something a static read can call a defect.
    const wanted = new Set([...(imagesrcset ? srcsetKeys(imagesrcset) : []), ...(href ? [href] : [])]);
    for (const tag of html.matchAll(/<img\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi)) {
      const srcset = attrValue(tag[1], 'srcset');
      const src = attrValue(tag[1], 'src');
      const keys = new Set([...(srcset ? srcsetKeys(srcset) : []), ...(src ? [src] : [])]);
      if (![...keys].some((k) => wanted.has(k))) continue;

      const sizes = attrValue(tag[1], 'sizes');
      const srcsetDiffers = imagesrcset != null && srcset != null && norm(imagesrcset) !== norm(srcset);
      const sizesDiffers = imagesizes != null && sizes != null && norm(imagesizes) !== norm(sizes);
      if (srcsetDiffers || sizesDiffers) {
        const which = [srcsetDiffers ? 'imagesrcset ≠ srcset' : null, sizesDiffers ? 'imagesizes ≠ sizes' : null].filter(Boolean).join(' and ');
        out.push({ page, which, preload: truncate(imagesrcset ?? href ?? '', 70), tag: truncate(srcset ?? src ?? '', 70) });
      }
      break;
    }
  }
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const srcsetKeys = (s) => s.split(',').map((e) => e.trim().split(/\s+/)[0]).filter(Boolean);

function reportPreloadPairs(issues, reporter) {
  if (issues.length === 0) return;   // nothing to say when no preload as=image exists
  for (const i of issues) {
    reporter.fix(SEC, 'preload:pair', `preload as="image" does not match the <img> it preloads (${i.which}) — the browser resolves two candidates and downloads the image twice`, 'make the preload\'s imagesrcset/imagesizes byte-identical to the tag\'s srcset/sizes', { file: i.page });
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
