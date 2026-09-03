// Minimal HTML helpers for scanning built (dist/) and served HTML — shared by the
// images (alt text) and seo (heading order) checks so both read pages the same way.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SKIP_DIST, distDir } from './dist.mjs';

// Walk dist/**/*.html, calling cb(relPath, html) for each file.
export function eachDistHtml(root, cb) {
  const dist = distDir(root);
  if (!existsSync(dist)) return;
  const stack = [dist];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIST.has(e.name)) continue;
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
  return headingOutline(html).map((h) => h.level);
}

/**
 * Headings in document order as { level, text }.
 *
 * The text is what lets a finding point at the component that *emitted* the
 * heading rather than at the built page it landed on — the built page is the
 * artifact, and a shared layout is usually the cause.
 */
export function headingOutline(html) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<template\b[\s\S]*?<\/template>/gi, '');
  return [...clean.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>|<h([1-6])\b/gi)].map((m) => ({
    level: Number(m[1] ?? m[3]),
    // Inner markup (a link, an anchor icon) is not part of the heading's text.
    text: (m[2] ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
  }));
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
  // `skipAt` is the index of the offending heading in the same array, so a
  // caller holding the outline can name it — and trace it back to source.
  let skip = null, skipAt = null, prev = 0;
  for (const [i, l] of levels.entries()) {
    if (prev && l > prev + 1) { skip = `jumps h${prev}→h${l} (skips a level)`; skipAt = i; break; }
    prev = l;
  }
  return { h1, skip, skipAt };
}

// Attribute helpers. Anchor on an attribute-name boundary (start or whitespace),
// never \b — \b matches inside `data-src`/`data-width`/`data-alt`, which both
// invents findings for tags that lack the real attribute and lets a genuine
// offender pass because its `data-` twin satisfied the test.
// A quoted value ends at the quote that OPENED it, not at any quote. Excluding
// all three from the value class — which is what this did — meant an attribute
// carrying the other quote matched nothing, and a non-match is indistinguishable
// from an absent attribute: `alt="it's"` read as no alt, `src="mate's dog.webp"`
// dropped the image out of every content-image check that resolves it by src.
// An apostrophe inside a double-quoted attribute is ordinary HTML.
export function attrValue(attrs, name) {
  return attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'\`])((?:(?!\\1)[\\s\\S])*)\\1`, 'i'))?.[2]
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

/**
 * The URLs in a `srcset`, in order — "a.webp 480w, b.webp 800w" → ["a.webp", "b.webp"].
 *
 * NOT `split(',')`. A srcset URL may contain commas, and on the delivery this
 * baseline recommends it always does: `/cdn-cgi/image/width=800,format=auto,
 * quality=80/hero.webp` shatters into three fragments, one of which —
 * `format=auto` — is shared by every transformed image on the page. `perf:
 * preload:pair` paired preloads to arbitrary unrelated `<img>` on that
 * collision and reported byte-identical pairs as mismatched.
 *
 * This is the HTML spec's own algorithm: a candidate's URL is a run of
 * non-whitespace, and only a *trailing* comma ends it (the descriptor-less
 * `a.webp, b.webp` form). So `a.webp,b.webp` is one URL, exactly as a browser
 * reads it, and a comma inside a transform path stays where it belongs.
 */
export function srcsetUrls(srcset) {
  const s = String(srcset ?? '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;           // between candidates
    const start = i;
    while (i < s.length && !/\s/.test(s[i])) i++;             // the URL
    const url = s.slice(start, i);
    if (!url) break;
    if (url.endsWith(',')) { out.push(url.replace(/,+$/, '')); continue; }
    out.push(url);
    while (i < s.length && s[i] !== ',') i++;                 // skip its descriptor
  }
  return out.filter(Boolean);
}

/**
 * Content <img> tags in a document, as { src, hasAlt }.
 *
 * The total matters as much as the offenders: a check that reports "all content
 * <img> carry an alt attribute" on a page with no images is a pass for work it
 * never did. Callers count what came back before deciding pass vs skip.
 */
export function contentImgs(html) {
  const out = [];
  // `[^>]*` truncates at a `>` inside an attribute value (data-x="a>b"), which
  // hid the real alt attribute and invented a violation. Consume quoted values.
  for (const m of html.matchAll(/<img\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi)) {
    const attrs = m[1];
    // srcset-only images are still content images; fall back to its first URL.
    const src = attrValue(attrs, 'src') ?? srcsetUrls(attrValue(attrs, 'srcset'))[0] ?? '';
    if (!src || /\.(svg|ico)(\?|#|$)|\bfavicon\b/i.test(src)) continue;
    if (src.startsWith('data:') || src.startsWith('blob:')) continue;
    // Anchor on an attribute-name boundary (start or whitespace), NOT \b — \b
    // matches inside `data-alt`/`data-src`, which would mask a real missing alt.
    out.push({ src, hasAlt: hasAttr(attrs, 'alt') });
  }
  return out;
}

// Content <img> with no alt attribute at all. `alt=""` is intentional
// (decorative) and passes; a missing attribute is the WCAG 1.1.1 violation.
export function imgsMissingAlt(html) {
  return contentImgs(html).filter((i) => !i.hasAlt).map((i) => i.src);
}
