// Minimal HTML helpers for scanning built (dist/) and served HTML — shared by the
// images (alt text) and seo (heading order) checks so both read pages the same way.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Walk dist/**/*.html, calling cb(relPath, html) for each file.
export function eachDistHtml(root, cb) {
  const dist = join(root, 'dist');
  if (!existsSync(dist)) return;
  const stack = [dist];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name.endsWith('.html')) {
        try { cb(relative(root, full), readFileSync(full, 'utf8')); }
        catch {}
      }
    }
  }
}

// A real, indexable content page emits the canonical SEO component (and thus a
// <link rel="canonical">). Tooling routes — OG-image templates, component
// preview shelves — don't, so this gate keeps heading checks off non-content HTML.
export function isContentPage(html) {
  return /rel=["']canonical["']/.test(html);
}

// Heading levels in document order, e.g. "<h1>…<h2>…<h2>…<h3>" → [1, 2, 2, 3].
export function headingLevels(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<template\b[\s\S]*?<\/template>/gi, '');
  return [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
}

// Outline audit for a content page, split by severity:
//   h1   — must be exactly one <h1> (the page title). Required: 0 or >1 is a real
//          SEO/a11y problem. → null when sound, else a message.
//   skip — a level skipped on the way down (h2→h4 misses h3). Advisory: real, but
//          often caused by a shared header/footer's heading level, not the content.
//          → null when sound, else a message.
export function headingAudit(levels) {
  const count = levels.filter((l) => l === 1).length;
  const h1 = count === 0 ? 'no <h1>'
           : count > 1   ? `${count} <h1> tags (expected exactly 1)`
           : null;
  let skip = null, prev = 0;
  for (const l of levels) {
    if (prev && l > prev + 1) { skip = `jumps h${prev}→h${l} (skips a level)`; break; }
    prev = l;
  }
  return { h1, skip };
}

// Attribute helpers. Anchor on an attribute-name boundary (start or whitespace),
// never \b — \b matches inside `data-src`/`data-width`/`data-alt`, which both
// invents findings for tags that lack the real attribute and lets a genuine
// offender pass because its `data-` twin satisfied the test.
export function attrValue(attrs, name) {
  return attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'\`])([^"'\`]*)\\1`, 'i'))?.[2]
      ?? attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*([^\\s>"'\`]+)`, 'i'))?.[1]
      ?? null;
}
// Present, with or without a value. An attribute written with an empty value is
// serialised bare: Astro emits `<img alt="" aria-hidden="true">` as `<img alt
// aria-hidden="true">`, and per the HTML spec that bare `alt` IS the empty
// string. Requiring `=` reported every correctly-marked decorative image as an
// accessibility violation — advice that, if followed, adds alt text to an image
// deliberately hidden from assistive tech. The trailing lookahead keeps
// `width` from matching `widths`; the leading one keeps it off `data-width`.
export function hasAttr(attrs, name) {
  return new RegExp(`(?:^|\\s)${name}(?=\\s|=|/|$)`, 'i').test(attrs);
}

// Content <img> tags with no alt attribute at all. `alt=""` is intentional
// (decorative) and passes; a missing attribute is the WCAG 1.1.1 violation.
export function imgsMissingAlt(html) {
  const out = [];
  // `[^>]*` truncates at a `>` inside an attribute value (data-x="a>b"), which
  // hid the real alt attribute and invented a violation. Consume quoted values.
  for (const m of html.matchAll(/<img\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi)) {
    const attrs = m[1];
    // Anchor on an attribute-name boundary (start or whitespace), NOT \b — \b
    // matches inside `data-alt`/`data-src`, which would mask a real missing alt.
    if (hasAttr(attrs, 'alt')) continue;
    // srcset-only images are still content images; fall back to its first URL.
    const src = attrValue(attrs, 'src')
             ?? (attrValue(attrs, 'srcset') ?? '').split(',')[0]?.trim().split(/\s+/)[0]
             ?? '';
    if (!src || /\.(svg|ico)(\?|#|$)|\bfavicon\b/i.test(src)) continue;
    if (src.startsWith('data:') || src.startsWith('blob:')) continue;
    out.push(src);
  }
  return out;
}
