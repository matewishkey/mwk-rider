// perf — the page-speed levers checkable from source:
//   1. public/_headers marks content-hashed assets (/_astro/*) immutable, so
//      repeat visits don't re-validate every JS/CSS/font.
//   2. Content <img> tags carry width + height (no layout shift / CLS).
//      <Image> from astro:assets bakes these in; raw <img> without them shifts.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

import { attrValue, hasAttr } from '../lib/html.mjs';

const SEC = 'perf';

const SCAN_EXTS = new Set(['.astro', '.tsx', '.jsx', '.html', '.md', '.mdx']);
const CONTENT_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);
const SVG_OR_FAVICON_RE = /\.(svg|ico)$|\bfavicon\b/i;

const MIN_IMMUTABLE_MAXAGE = 86400;
const CANONICAL_MAXAGE = 31536000;

export async function run({ project, reporter }) {
  checkHeaders(project, reporter);
  checkCls(project, reporter);
}

// 1. public/_headers — hashed assets immutable -------------------------------

function checkHeaders(project, reporter) {
  const path = join(project.root, 'public', '_headers');
  if (!existsSync(path)) {
    reporter.fix(SEC, '_headers', 'public/_headers missing — hashed bundles served max-age=0 (every repeat visit re-validates all JS/CSS)', 'add public/_headers marking /_astro/* immutable');
    return;
  }

  let headersRaw;
  try { headersRaw = readFileSync(path, 'utf8'); }
  catch { return null; }
  const blocks = parseHeaders(headersRaw);
  const astroBlock = blocks.find((b) => b.path === '/_astro/*');
  if (!astroBlock) {
    reporter.fix(SEC, '_headers:/_astro/*', 'no /_astro/* rule — content-hashed bundles not marked immutable', 'add a /_astro/* block to public/_headers');
    return;
  }

  const cc = astroBlock.headers['cache-control'] ?? '';
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

function parseHeaders(text) {
  const blocks = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { path: line.trim(), headers: {} };
      blocks.push(current);
    } else if (current) {
      const idx = line.indexOf(':');
      if (idx > 0) current.headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
  }
  return blocks;
}

// 2. CLS — content <img> tags need width + height ----------------------------

function checkCls(project, reporter) {
  const offenders = [];
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
      if (!hasAttr(attrs, 'width') || !hasAttr(attrs, 'height')) {
        offenders.push({ file: relPath, line: lineOf(text, m.index), src });
      }
    }
  });

  if (offenders.length === 0) {
    reporter.pass(SEC, 'cls:img-dimensions', 'all content <img> carry width + height (or use <Image>)');
  } else {
    for (const o of offenders) {
      reporter.fix(SEC, `cls:img-dimensions (${o.file}:${o.line})`, `<img src="${truncate(o.src, 60)}"> lacks width/height → layout shift (CLS)`, 'use <Image> from astro:assets (bakes width/height), or add explicit width + height');
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
