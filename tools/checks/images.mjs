// images — content images are delivered well: routed through an image transform
// (so they're resized + reformatted, not shipped at full size), and not oversized
// at the source or in the built output.
//
//   1. <img src> referencing a content image not going through /cdn-cgi/image/
//      (SVG, favicon, OG meta excluded)
//   2. CSS background-image: url(...) for a >200 KB raster not going through a transform
//   3. PNG/JPG over ~500 KB sitting in src/assets/
//   4. (if dist/ present) built content images over the byte budget — "big images
//      that never got resized". A responsive image is judged as a LADDER, not as
//      individual files: see judgeDistSizes.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { transformSmells } from '../lib/cf-image.mjs';
import { eachDistHtml, contentImgs, attrValue, srcsetUrls } from '../lib/html.mjs';
import { imageSize } from '../lib/image-size.mjs';
import { SKIP_DIST, distDir } from '../lib/dist.mjs';

const SEC = 'images';

const SCAN_EXTS = new Set(['.astro', '.tsx', '.ts', '.jsx', '.js', '.mdx', '.md', '.css', '.scss', '.sass']);
const CONTENT_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);

const SIZE_WARN_BG = 200 * 1024;     // CSS background raster without a transform
// Below this a pinned width is roughly what a phone wants anyway, so the
// srcset it can't have would buy little — and flagging a small decorative
// texture is the noise that gets a tool ignored.
const BG_PINNED_WIDTH_MIN = 640;
const SIZE_WARN_ASSET = 500 * 1024;  // PNG/JPG in src/assets/
const SIZE_WARN_DIST = 300 * 1024;   // built content image byte budget

// --- the positive srcset assertion (issue #12) --------------------------------
// A legitimately fixed-width image is common and CORRECT — a logo, an avatar, an
// icon, a diagram rendered at exactly one size. Flagging those is the crying-wolf
// failure lib/policy.mjs exists to prevent, and worse than not checking at all.
// So these numbers are measured, not chosen: across three real builds, every
// single-width image that was genuinely meant to be one came in at ≤ 720 px
// (badge strips at 200–300, portraits at 240–640, footer logos at 220), while
// every one that should have had a ladder was a 1200–1600 px photograph.
// See BEST-PRACTICES.md § images for the full measurement.
const SRCSET_MIN_WIDTH = 1000;
// Second, independent guard, for the local-file case where bytes are knowable.
// A wide flat graphic is cheap — tasmanvisa-web's 1594 px brand lockups are 21
// and 25 KB — and the phone rung of a ladder it doesn't have would save a
// handful of KB. The wide *photographs* in the same build start around 46 KB.
const SRCSET_MIN_BYTES = 50 * 1024;
// Third guard: what the file calls itself. Named by the issue's own sketch, and
// it independently excludes both real-world false positives the measurement
// turned up (`/assets/press/…-lockup.png`, `/assets/images/badges/…`).
const FIXED_WIDTH_OK_RE = /\b(logos?|lockups?|wordmarks?|icons?|badges?|sprites?|avatars?|emblems?|favicons?|qr)\b/i;

const IT_PREFIX_RE = /\/cdn-cgi\/image\//;
const SVG_OR_FAVICON_RE = /\.(svg|ico)$|\bfavicon\b/i;

export async function run({ project, reporter }) {
  const findings = {
    imgNotRouted: [],
    bgNotRouted: [],
    bgFixedWidth: [],
    oversizedAssets: [],
    oversizedDist: [],
    oversizedLadders: [],
    // Every built content image and its size, plus the responsive ladders the
    // built HTML actually references. `dist:size` needs both: a file's size
    // alone can't tell an oversized hero from the top rung of a srcset that no
    // phone ever requests.
    distSizes: new Map(),
    ladders: [],
    transformParams: [],
    transformTotal: 0,
    altMissing: [],
    // Built <img> that ship a single width with no srcset, and the subset of
    // them wide enough that a phone is downloading a desktop image.
    singleWidth: [],
    singleWidthTotal: 0,
    singleWidthExempt: 0,
    singleWidthUnknown: [],
    // Totals, so "nothing was wrong" and "there was nothing to look at" report
    // differently. `✅ routed — all content <img> go through a transform` on a
    // page with no images is a pass for work never done.
    imgTotal: 0,
    bgTotal: 0,
    assetTotal: 0,
    distImgTotal: 0,
    altTotal: 0,
  };

  walkDir(join(project.root, 'src'), (relPath) => {
    const ext = extname(relPath).toLowerCase();
    if (!SCAN_EXTS.has(ext)) return;
    let text;
    try { text = readFileSync(join(project.root, relPath), 'utf8'); }
    catch { return; }   // unreadable file — skip it, never lose the domain
    scanImgTags(text, relPath, findings);
    scanBackgroundImages(text, relPath, project.root, findings);
  }, project.root);

  scanOversizedAssets(project.root, findings);
  if (project.hasDist) {
    scanDist(project.root, findings);
    scanDistHtml(project.root, findings);
    judgeDistSizes(findings);
  }

  // Report

  if (findings.imgTotal === 0) {
    reporter.skip(SEC, 'routed', 'no content <img> in src/ — nothing to check');
  } else if (findings.imgNotRouted.length === 0) {
    reporter.pass(SEC, 'routed', `all ${findings.imgTotal} content <img> go through an image transform`);
  } else {
    for (const f of findings.imgNotRouted) {
      reporter.fix(SEC, 'routed', `<img src="${truncate(f.src, 80)}"> not routed through an image transform`, '<Image> from astro:assets (adds width/height too), or a /cdn-cgi/image/width=,format=auto,quality=80/… URL', { file: f.file, line: f.line });
    }
  }

  if (findings.bgTotal === 0) {
    reporter.skip(SEC, 'background-image', 'no background-image refs to a content image — nothing to check');
  } else if (findings.bgNotRouted.length === 0) {
    reporter.pass(SEC, 'background-image', `all ${findings.bgTotal} background-image refs go through an image transform`);
  } else {
    for (const f of findings.bgNotRouted) {
      const sizeLabel = f.sizeBytes != null ? ` (${humanSize(f.sizeBytes)})` : '';
      reporter.fix(SEC, 'background-image', `background-image: url(${truncate(f.url, 80)})${sizeLabel} not routed through a transform`, 'rewrite as image-set() with /cdn-cgi/image/width=,format=auto,quality=80/…', { file: f.file, line: f.line });
    }
  }

  // Routed is not the same as delivered well. A CSS background gets neither
  // srcset nor lazy loading, so whatever width is pinned is what every device
  // downloads, and it starts as soon as the rule matches an element.
  if (findings.bgTotal === 0) {
    reporter.skip(SEC, 'background-image:fixed-width', 'no background-image refs to a content image — nothing to check');
  } else if (findings.bgFixedWidth.length === 0) {
    reporter.pass(SEC, 'background-image:fixed-width', `none of the ${findings.bgTotal} background-image ref(s) pins a width of ${BG_PINNED_WIDTH_MIN}px or more`);
  } else {
    for (const f of findings.bgFixedWidth) {
      reporter.fix(
        SEC,
        'background-image:fixed-width',
        `background-image pinned to width=${f.width} — a CSS background can use neither srcset nor lazy loading, so every phone downloads the ${f.width}px file and starts as soon as the rule matches (${truncate(f.url, 70)})`,
        'render an absolutely-inset <img> with srcset/sizes/loading="lazy" inside a positioned parent instead; image-set() is the smaller fix if it must stay CSS (DPR selection only, still no lazy)',
        { file: f.file, line: f.line },
      );
    }
  }

  if (findings.assetTotal === 0) {
    reporter.skip(SEC, 'assets:size', 'no raster images in src/assets/ — nothing to check');
  } else if (findings.oversizedAssets.length === 0) {
    reporter.pass(SEC, 'assets:size', `none of the ${findings.assetTotal} image(s) in src/assets/ is over ${humanSize(SIZE_WARN_ASSET)}`);
  } else {
    for (const f of findings.oversizedAssets) {
      const refLabel = f.references.length === 0 ? 'unused' : `referenced by: ${f.references.slice(0, 3).join(', ')}${f.references.length > 3 ? ` (+${f.references.length - 3} more)` : ''}`;
      if (f.imported) {
        // Imported through astro:assets → optimized at build time. Flagging this
        // as a defect contradicts the `routed` pass in the same run.
        reporter.suggest(SEC, 'assets:size', `${humanSize(f.sizeBytes)} source — ${refLabel}; imported via astro:assets, so Astro ships an optimized derivative, not this file`, 'fine to leave; shrink the source only to keep the repo light', { file: f.assetPath });
      } else if (f.references.length === 0) {
        reporter.fix(SEC, 'assets:size', `${humanSize(f.sizeBytes)} — unused`, 'delete (unused large raster in src/assets/)', { file: f.assetPath });
      } else {
        reporter.fix(SEC, 'assets:size', `${humanSize(f.sizeBytes)} — ${refLabel}, referenced without an astro:assets import`, 'import it so <Image> optimizes it at build time, or serve it through an image transform', { file: f.assetPath });
      }
    }
  }

  if (project.hasDist) {
    const ladderNote = findings.ladders.length
      ? `; ${findings.ladders.length} srcset ladder(s) judged by their smallest rung`
      : '';
    if (findings.distImgTotal === 0) {
      reporter.skip(SEC, 'dist:size', 'no content images in dist/ — nothing to check');
    } else if (findings.oversizedDist.length === 0 && findings.oversizedLadders.length === 0) {
      reporter.pass(SEC, 'dist:size', `none of the ${findings.distImgTotal} built content image(s) is over ${humanSize(SIZE_WARN_DIST)}${ladderNote}`);
    } else {
      for (const f of findings.oversizedDist) {
        reporter.fix(SEC, 'dist:size', `${humanSize(f.sizeBytes)} shipped — over ${humanSize(SIZE_WARN_DIST)}`, 'resize at build (<Image> width=) or serve via an image transform; a hero should be 50–250 KB', { file: f.path });
      }
      for (const l of findings.oversizedLadders) {
        const rungs = l.rungs.map((r) => humanSize(r.sizeBytes)).join(', ');
        reporter.fix(SEC, 'dist:size', `every rung of a srcset ladder is over ${humanSize(SIZE_WARN_DIST)} — smallest is ${humanSize(l.rungs[0].sizeBytes)} (${l.rungs.length} rungs: ${rungs})`, 'the smallest rung is what a phone downloads — add narrower widths (<Image widths={[...]}> or image.breakpoints), or downscale the source', { file: l.rungs[0].path });
      }
    }

    // Transform-param anti-patterns on built HTML (catches the markdown ![]()
    // defaults Astro's Cloudflare image service emits, before deploy).
    if (findings.transformTotal === 0) {
      reporter.skip(SEC, 'transform:params', 'no /cdn-cgi/image transform URLs in dist/ — nothing to check');
    } else {
      const badFormat = findings.transformParams.filter((f) => f.explicitFormat);
      if (badFormat.length === 0) {
        reporter.pass(SEC, 'transform:format', `all ${findings.transformTotal} transform URL(s) use format=auto`);
      } else {
        const fmts = [...new Set(badFormat.map((f) => f.explicitFormat))].join(', ');
        reporter.fix(SEC, 'transform:format', `${badFormat.length} transform URL(s) force format=${fmts} instead of format=auto — no AVIF, and onerror=redirect serves the raw source to clients that don't accept it (e.g. ${truncate(badFormat[0].url, 90)})`, 'emit format=auto so Cloudflare negotiates AVIF/webp and never falls back to the raw source');
      }
      const noQuality = findings.transformParams.filter((f) => f.missingQuality);
      if (noQuality.length > 0) {
        reporter.suggest(SEC, 'transform:quality', `${noQuality.length} transform URL(s) set no quality= (Cloudflare defaults to 85) (e.g. ${truncate(noQuality[0].url, 90)})`, 'add an explicit quality (e.g. quality=80) to cap output size on photographic content');
      }
    }

    // The positive assertion: a large image shipping one fixed width. Promoted
    // from advisory to a house-style finding on 2026-09-03, on the sweep issue
    // #21 asked for: 10 distinct sites (7 of them written by people with no
    // connection to this project), 66 measurable candidates, 25 findings, 0
    // wrong. What earned it was not the hit rate but the SILENCE — 25 wide
    // candidates were correctly left alone, and the byte floor fired on exactly
    // the shapes it was designed for: a 1200px/27KB quote graphic, a
    // 1190px/24KB logo, a 1096px/5KB placeholder. It is still a threshold, so
    // it stays house style: 💡 by default, 🔧 only under --strict.
    const unknown = findings.singleWidthUnknown;
    // Name the blind spot rather than folding it into "nothing to check": an
    // unreadable width is a MISSED finding, not an absent one.
    const blind = unknown.length
      ? ` ${unknown.length} single-width <img> could not be measured offline (a remote URL that is not a transform, or a format this cannot parse): ${unknown.slice(0, 2).map((u) => truncate(u, 60)).join('; ')}${unknown.length > 2 ? ` … +${unknown.length - 2} more` : ''}.`
      : '';
    if (findings.singleWidthTotal === 0) {
      reporter.skip(SEC, 'srcset:missing', `every content <img> in dist/ already carries a srcset, or its width is not knowable offline — nothing to check.${blind}`);
    } else if (findings.singleWidth.length === 0) {
      const exempt = findings.singleWidthExempt
        ? ` (${findings.singleWidthExempt} of them wider than ${SRCSET_MIN_WIDTH}px, but named like a logo/badge or under ${humanSize(SRCSET_MIN_BYTES)} — legitimately one size)`
        : '';
      reporter.pass(SEC, 'srcset:missing', `none of the ${findings.singleWidthTotal} single-width <img> in dist/ needs a ladder${exempt}.${blind}`);
    } else {
      for (const f of findings.singleWidth) {
        const weight = f.bytes != null ? `, ${humanSize(f.bytes)}` : '';
        reporter.fix(
          SEC,
          'srcset:missing',
          `${f.width}px wide${weight} with no srcset — every phone downloads the ${f.width}px version (${truncate(f.src, 70)})`,
          'give it a ladder: <Image widths={[400, 800, 1200]} sizes="…"> for a local asset, or a srcset of /cdn-cgi/image/width=…/ URLs for a transform — a logo or diagram that is genuinely one size is fine to leave',
          { file: f.file },
        );
      }
    }

    // Alt text on content <img> in built HTML (WCAG 1.1.1). `alt=""` = decorative
    // and passes; a missing attribute is the violation.
    if (findings.altTotal === 0) {
      reporter.skip(SEC, 'alt', 'no content <img> in dist/ — nothing to check');
    } else if (findings.altMissing.length === 0) {
      reporter.pass(SEC, 'alt', `all ${findings.altTotal} content <img> tag(s) in dist/ carry an alt attribute`);
    } else {
      for (const m of findings.altMissing) {
        reporter.fix(SEC, 'alt', `<img src="${truncate(m.src, 80)}"> has no alt attribute`, 'add alt text (alt="" only if the image is purely decorative); <Image> from astro:assets requires it', { file: m.file });
      }
    }
  }
}

// Scanners -------------------------------------------------------------------

function scanImgTags(text, relPath, findings) {
  // Match the tag, then read `src` off its attributes with the shared helper —
  // an inline `\bsrc=` pattern also matches `data-src=`, inventing a finding for
  // a lazy-loaded image and quoting a src attribute the tag never had.
  // Quote-aware, like every other tag scanner here: `[^>]*` stops at a `>`
  // inside an attribute value, which truncates the attribute string and can
  // drop the `src` this reads off it.
  const re = /<img\b((?:"[^"]*"|'[^']*'|[^>])*)>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const src = attrValue(m[1], 'src');
    if (!src) continue;
    if (!isContentImageRef(src)) continue;
    if (src.startsWith('data:') || src.startsWith('blob:')) continue;
    findings.imgTotal++;
    if (IT_PREFIX_RE.test(src)) continue;
    findings.imgNotRouted.push({ file: relPath, line: lineOf(text, m.index), src });
  }
}

function scanBackgroundImages(text, relPath, projectRoot, findings) {
  const re = /background(?:-image)?\s*:[^;{}]*?url\(\s*(["'`]?)([^"'`)]+)\1\s*\)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const url = m[2];
    if (!isContentImageRef(url)) continue;
    if (url.startsWith('data:')) continue;
    findings.bgTotal++;

    // A background pinned to one width is what every device downloads: a CSS
    // background gets neither srcset nor lazy loading, and neither is
    // recoverable. image-set() is exempt — it at least does DPR selection.
    const width = pinnedWidth(url);
    if (width != null && width >= BG_PINNED_WIDTH_MIN && !/image-set\s*\(/i.test(m[0])) {
      findings.bgFixedWidth.push({ file: relPath, line: lineOf(text, m.index), url, width });
    }

    if (IT_PREFIX_RE.test(url)) continue;
    const sizeBytes = resolveAssetSize(url, projectRoot);
    // Unknown size (remote host, or a path we can't resolve locally) is not
    // evidence of a large file — the documented rule is ">200 KB and untransformed".
    if (sizeBytes == null || sizeBytes < SIZE_WARN_BG) continue;
    findings.bgNotRouted.push({ file: relPath, line: lineOf(text, m.index), url, sizeBytes });
  }
}

function scanOversizedAssets(projectRoot, findings) {
  const assetsDir = join(projectRoot, 'src', 'assets');
  if (!existsSync(assetsDir)) return;
  const candidates = [];
  walkDir(assetsDir, (rel) => {
    const ext = extname(rel).toLowerCase();
    if (!CONTENT_IMAGE_EXTS.has(ext)) return;
    findings.assetTotal++;
    try {
      const sz = statSync(join(projectRoot, rel)).size;
      if (sz > SIZE_WARN_ASSET) candidates.push({ rel, sz });
    } catch {}
  }, projectRoot);
  if (candidates.length === 0) return;

  const sourceFiles = [];
  walkDir(join(projectRoot, 'src'), (rel) => {
    if (SCAN_EXTS.has(extname(rel).toLowerCase())) sourceFiles.push(rel);
  }, projectRoot);

  for (const c of candidates) {
    const baseName = c.rel.split('/').pop();
    const references = [];
    let imported = false;
    for (const srcRel of sourceFiles) {
      let txt;
      try { txt = readFileSync(join(projectRoot, srcRel), 'utf8'); } catch { continue; }
      if (!txt.includes(baseName)) continue;
      references.push(srcRel);
      // An ESM import routes the asset through astro:assets, so Astro (via Sharp)
      // emits optimized derivatives at build time and the raw file never ships.
      // Size is then repo weight, not a delivery defect.
      if (new RegExp(`(?:import\\s[^;]*?from\\s*|import\\s*\\()\\s*["'][^"']*${escapeRe(baseName)}["']`).test(txt)) imported = true;
    }
    findings.oversizedAssets.push({ assetPath: c.rel, sizeBytes: c.sz, references, imported });
  }
}

// Every built content image and its size. The oversize *verdict* is deferred to
// judgeDistSizes, which needs the srcset ladders that scanDistHtml collects.
//
// Walks the static root (dist/client on an adapter build), not dist/ — the
// server bundle's copy of an asset is compute, never bytes a visitor downloads,
// and counting it inflates the denominator of the pass message.
function scanDist(projectRoot, findings) {
  walkDir(distDir(projectRoot), (rel) => {
    const ext = extname(rel).toLowerCase();
    if (!CONTENT_IMAGE_EXTS.has(ext)) return;
    findings.distImgTotal++;
    try { findings.distSizes.set(rel, statSync(join(projectRoot, rel)).size); }
    catch {}
  }, projectRoot);
}

/**
 * Oversize, judged per delivery unit rather than per file.
 *
 * A responsive image is a LADDER, and the browser downloads exactly one rung of
 * it. Astro emits the intrinsic-size rung unconditionally — `image.breakpoints`
 * only adds widths *below* it — so flagging the top rung asks a site to
 * downscale its source and degrade retina desktop to fix a number no user ever
 * experiences. A ladder is only a defect when its SMALLEST rung is over budget,
 * because then even a phone is over budget.
 *
 * An image in no ladder is a single delivered file, and keeps the plain rule.
 */
function judgeDistSizes(findings) {
  const inLadder = new Set();
  for (const rungs of findings.ladders) for (const p of rungs) inLadder.add(p);

  for (const [path, sizeBytes] of findings.distSizes) {
    if (inLadder.has(path)) continue;
    if (sizeBytes > SIZE_WARN_DIST) findings.oversizedDist.push({ path, sizeBytes });
  }

  for (const rungs of findings.ladders) {
    const sized = rungs
      .map((path) => ({ path, sizeBytes: findings.distSizes.get(path) }))
      .filter((r) => r.sizeBytes != null)
      .sort((a, b) => a.sizeBytes - b.sizeBytes);
    if (sized.length === 0) continue;
    if (sized[0].sizeBytes > SIZE_WARN_DIST) findings.oversizedLadders.push({ rungs: sized });
  }
}

// One pass over built HTML: transform-param anti-patterns + content <img> alt +
// the responsive ladders dist:size judges by.
function scanDistHtml(projectRoot, findings) {
  const seenUrl = new Set();
  const seenLadder = new Set();
  const seenSingle = new Set();
  eachDistHtml(projectRoot, (rel, html) => {
    collectLadders(html, projectRoot, findings, seenLadder);
    collectSingleWidth(html, rel, projectRoot, findings, seenSingle);
    const re = /\/cdn-cgi\/image\/[^"'`)\s>]+/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const url = m[0];
      if (seenUrl.has(url)) continue;
      seenUrl.add(url);
      const smells = transformSmells(url);
      if (!smells) continue;
      findings.transformTotal++;
      if (smells.explicitFormat || smells.missingQuality) {
        findings.transformParams.push({ file: rel, url, ...smells });
      }
    }
    // Every tag counts. De-duplicating by `src` across the whole build meant
    // the FIRST occurrence of an image decided the verdict for all of them: the
    // same photo used with alt on the homepage and without alt on a post was
    // reported as fine. Four independent dogfood builds found that — a silent
    // false negative with exit 0, which is the worst outcome this tool has.
    for (const { src, hasAlt } of contentImgs(html)) {
      findings.altTotal++;
      if (hasAlt) continue;
      // One finding per (page, image); the same tag repeated on one page is one
      // edit, but the same image on two pages is two.
      if (!findings.altMissing.some((m) => m.file === rel && m.src === src)) {
        findings.altMissing.push({ file: rel, src });
      }
    }
  });
}

/**
 * Built `<img>` that ship as a single fixed width — the positive half of the
 * responsive-images practice (issue #12).
 *
 * Everything else here judges ladders that already exist: `dist:size` weighs the
 * smallest rung, `background-image:fixed-width` flags a CSS background that can
 * never have one, `browser: images:rendered-size` names an overstated `sizes`.
 * None of them says *this image is large and has no ladder at all*.
 *
 * A candidate is an `<img>` with no `srcset`, no `<picture>` ancestor (its
 * `<source>` siblings are the ladder), whose delivered width is knowable —
 * either the width a transform URL pins, or the intrinsic width of the file it
 * resolves to in the build. Deduped by `src`: the same component on 400 pages is
 * one edit.
 */
function collectSingleWidth(html, rel, projectRoot, findings, seen) {
  // An <img> inside <picture> gets its ladder from the sibling <source> tags.
  const pictures = [...html.matchAll(/<picture\b[\s\S]*?<\/picture>/gi)].map((m) => [m.index, m.index + m[0].length]);

  for (const m of html.matchAll(/<img\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi)) {
    const attrs = m[1];
    if (attrValue(attrs, 'srcset')) continue;
    if (pictures.some(([from, to]) => m.index > from && m.index < to)) continue;
    const src = attrValue(attrs, 'src');
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
    // An SVG is resolution-independent — it has no ladder to be missing, even
    // when someone routes one through a transform that pins a width.
    if (SVG_OR_FAVICON_RE.test(src)) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    if (!isContentImageRef(src) && !IT_PREFIX_RE.test(src)) {
      // An image CDN that serves by opaque id has no extension to read
      // (Unsplash, and every marketplace thumbnailer). It is still an image —
      // it is in an <img src> — so it is UNMEASURABLE, not absent. Dropping it
      // here made the report say "nothing to check" on a mirrored page carrying
      // 53 of them, which is exactly the failure the unmeasurable tally was
      // added for in #21: twenty unreadable images and zero images printed the
      // same line. Counted, never judged.
      if (/^https?:\/\//i.test(src) && !extname(src.split('?')[0])) findings.singleWidthUnknown.push(src);
      continue;
    }

    // Two ways to know what width actually ships. A transform URL states it; a
    // local build artifact has it in its own bytes. Anything else — a remote
    // host that is not a transform URL, or a format this cannot parse — is
    // unknowable offline, and an unknown width is never a finding.
    //
    // PNG, JPEG, WebP and AVIF all parse (`tools/lib/image-size.mjs`). AVIF was
    // the blind spot issue #21 was filed about and the `ispe` walker closed it;
    // this comment named it as unparsed for months afterwards. What is left
    // unreadable is a remote non-transform URL, and GIF/SVG. Those are COUNTED
    // now, and named in the report — the point of #21's fallback mitigation was
    // that twenty unreadable images and zero images printed the same line.
    let width = null, bytes = null;
    if (IT_PREFIX_RE.test(src)) {
      width = pinnedWidth(src);
    } else {
      const path = distPathOf(src, projectRoot);
      if (path) {
        try {
          const buf = readFileSync(join(projectRoot, path));
          width = imageSize(buf)?.w ?? null;
          bytes = buf.length;
        } catch {}
      }
    }
    if (width == null) { findings.singleWidthUnknown.push(src); continue; }
    findings.singleWidthTotal++;

    if (width < SRCSET_MIN_WIDTH) continue;
    // Wide, but one of the two guards says it is meant to be one size. Counted,
    // not dropped: the pass line has to be able to say "none needed a ladder"
    // without implying nothing here was wide, which would be a false statement
    // about exactly the images the guards exist for.
    if ((bytes != null && bytes < SRCSET_MIN_BYTES) || FIXED_WIDTH_OK_RE.test(src)) {
      findings.singleWidthExempt++;
      continue;
    }
    findings.singleWidth.push({ file: rel, src, width, bytes });
  }
}

/**
 * The responsive ladders a document references, as arrays of dist-relative paths.
 *
 * One ladder = one set of files the browser picks exactly one of. For an <img>
 * that is its `srcset` plus its `src` (the fallback is a rung: it is what a
 * client with no srcset support downloads, and Astro's intrinsic-width output
 * usually lives there). For a <source> inside <picture> it is that tag's own
 * srcset.
 *
 * An <img> with no srcset is NOT a ladder — it is a single delivered file, and
 * dist:size judges it as one.
 *
 * Deduped across pages: the same component rendered on 400 pages emits the same
 * ladder 400 times, and one edit fixes all of them.
 */
function collectLadders(html, projectRoot, findings, seenLadder) {
  const add = (urls) => {
    const paths = [...new Set(urls.map((u) => distPathOf(u, projectRoot)).filter(Boolean))];
    if (paths.length === 0) return;
    const key = paths.slice().sort().join('|');
    if (seenLadder.has(key)) return;
    seenLadder.add(key);
    findings.ladders.push(paths);
  };

  for (const m of html.matchAll(/<img\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi)) {
    const srcset = attrValue(m[1], 'srcset');
    if (!srcset) continue;
    const src = attrValue(m[1], 'src');
    add([...srcsetUrls(srcset), ...(src ? [src] : [])]);
  }
  for (const m of html.matchAll(/<source\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi)) {
    const srcset = attrValue(m[1], 'srcset');
    if (srcset) add(srcsetUrls(srcset));
  }
}

// A root-relative built asset URL → the path walkDir reports it under, or null
// for anything not a local file in this build (remote hosts, data:, transforms).
function distPathOf(url, projectRoot) {
  if (!url.startsWith('/') || url.startsWith('//')) return null;
  const clean = url.split(/[?#]/)[0];
  if (!CONTENT_IMAGE_EXTS.has(extname(clean).toLowerCase())) return null;
  return relative(projectRoot, join(distDir(projectRoot), clean.slice(1)));
}

// Helpers --------------------------------------------------------------------

function walkDir(dir, callback, root) {
  if (!existsSync(dir)) return;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.') || SKIP_DIST.has(e.name)) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else callback(relative(root, full));
    }
  }
}

/**
 * The one width this URL will always return, or null if it doesn't pin one.
 *
 * Covers the three common spellings: a Cloudflare transform
 * (`/cdn-cgi/image/width=1600,…`), a query parameter (`?w=1600`, `?width=1600`)
 * and a Cloudinary-style path segment (`/w_1600/`).
 *
 * `dpr` MULTIPLIES it, and the answer wanted here is delivered pixels, not the
 * number in the URL. Cloudflare's own transform vocabulary has `dpr` (default
 * 1, max 2 — verified in the Images docs), so this is our own syntax, not a
 * foreign CDN's. Measured on a live resizer carrying the same parameter:
 * `?width=600&dpr=2` returned 1200x720, so reading 600 understates it by half
 * and drops it under the 1000px floor — the check goes quiet on an image that
 * needed it. Found on 2026-09-04 while measuring whether a remote URL's
 * declared width could be trusted (issue #35); the answer for a remote host is
 * no, and this is the half of it that is ours to get right.
 */
function pinnedWidth(url) {
  const m = url.match(/\bwidth=(\d{2,5})\b/)
        ?? url.match(/[?&]w=(\d{2,5})\b/)
        ?? url.match(/\/w_(\d{2,5})(?:[,/])/);
  if (!m) return null;
  const dpr = url.match(/\bdpr=(\d(?:\.\d+)?)\b/);
  const scale = dpr ? Number(dpr[1]) : 1;
  return Math.round(Number(m[1]) * (scale > 0 && scale <= 3 ? scale : 1));
}

function isContentImageRef(src) {
  if (SVG_OR_FAVICON_RE.test(src)) return false;
  const ext = extname(src.split('?')[0]).toLowerCase();
  if (CONTENT_IMAGE_EXTS.has(ext)) return true;
  if (/^https?:\/\/media\./.test(src)) return true;
  return false;
}

function resolveAssetSize(urlPath, projectRoot) {
  const cleaned = urlPath.split('?')[0].replace(/^\//, '');
  for (const dir of ['public', 'src/assets', 'src']) {
    const candidate = join(projectRoot, dir, cleaned);
    if (existsSync(candidate)) {
      try { return statSync(candidate).size; } catch { return null; }
    }
  }
  return null;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
