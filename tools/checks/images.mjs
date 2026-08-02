// images — content images are delivered well: routed through an image transform
// (so they're resized + reformatted, not shipped at full size), and not oversized
// at the source or in the built output.
//
//   1. <img src> referencing a content image not going through /cdn-cgi/image/
//      (SVG, favicon, OG meta excluded)
//   2. CSS background-image: url(...) for a >200 KB raster not going through a transform
//   3. PNG/JPG over ~500 KB sitting in src/assets/
//   4. (if dist/ present) built content images over the byte budget — "big images
//      that never got resized"

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { transformSmells } from '../lib/cf-image.mjs';
import { eachDistHtml, imgsMissingAlt, attrValue } from '../lib/html.mjs';

const SEC = 'images';

const SCAN_EXTS = new Set(['.astro', '.tsx', '.ts', '.jsx', '.js', '.mdx', '.md', '.css', '.scss', '.sass']);
const CONTENT_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);

const SIZE_WARN_BG = 200 * 1024;     // CSS background raster without a transform
const SIZE_WARN_ASSET = 500 * 1024;  // PNG/JPG in src/assets/
const SIZE_WARN_DIST = 300 * 1024;   // built content image byte budget

const IT_PREFIX_RE = /\/cdn-cgi\/image\//;
const SVG_OR_FAVICON_RE = /\.(svg|ico)$|\bfavicon\b/i;

export async function run({ project, reporter }) {
  const findings = {
    imgNotRouted: [],
    bgNotRouted: [],
    oversizedAssets: [],
    oversizedDist: [],
    transformParams: [],
    transformTotal: 0,
    altMissing: [],
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
  }

  // Report

  if (findings.imgNotRouted.length === 0) {
    reporter.pass(SEC, 'routed', 'all content <img> go through an image transform');
  } else {
    for (const f of findings.imgNotRouted) {
      reporter.fix(SEC, `routed (${f.file}:${f.line})`, `<img src="${truncate(f.src, 80)}"> not routed through an image transform`, '<Image> from astro:assets (adds width/height too), or a /cdn-cgi/image/width=,format=auto,quality=80/… URL');
    }
  }

  if (findings.bgNotRouted.length === 0) {
    reporter.pass(SEC, 'background-image', 'all background-image refs go through an image transform');
  } else {
    for (const f of findings.bgNotRouted) {
      const sizeLabel = f.sizeBytes != null ? ` (${humanSize(f.sizeBytes)})` : '';
      reporter.fix(SEC, `background-image (${f.file}:${f.line})`, `background-image: url(${truncate(f.url, 80)})${sizeLabel} not routed through a transform`, 'rewrite as image-set() with /cdn-cgi/image/width=,format=auto,quality=80/…');
    }
  }

  if (findings.oversizedAssets.length === 0) {
    reporter.pass(SEC, 'assets:size', `no PNG/JPG over ${humanSize(SIZE_WARN_ASSET)} in src/assets/`);
  } else {
    for (const f of findings.oversizedAssets) {
      const refLabel = f.references.length === 0 ? 'unused' : `referenced by: ${f.references.slice(0, 3).join(', ')}${f.references.length > 3 ? ` (+${f.references.length - 3} more)` : ''}`;
      if (f.imported) {
        // Imported through astro:assets → optimized at build time. Flagging this
        // as a defect contradicts the `routed` pass in the same run.
        reporter.suggest(SEC, `assets:size (${f.assetPath})`, `${humanSize(f.sizeBytes)} source — ${refLabel}; imported via astro:assets, so Astro ships an optimized derivative, not this file`, 'fine to leave; shrink the source only to keep the repo light');
      } else if (f.references.length === 0) {
        reporter.fix(SEC, `assets:size (${f.assetPath})`, `${humanSize(f.sizeBytes)} — unused`, 'delete (unused large raster in src/assets/)');
      } else {
        reporter.fix(SEC, `assets:size (${f.assetPath})`, `${humanSize(f.sizeBytes)} — ${refLabel}, referenced without an astro:assets import`, 'import it so <Image> optimizes it at build time, or serve it through an image transform');
      }
    }
  }

  if (project.hasDist) {
    if (findings.oversizedDist.length === 0) {
      reporter.pass(SEC, 'dist:size', `no built content image over ${humanSize(SIZE_WARN_DIST)} in dist/`);
    } else {
      for (const f of findings.oversizedDist) {
        reporter.fix(SEC, `dist:size (${f.path})`, `${humanSize(f.sizeBytes)} shipped — over ${humanSize(SIZE_WARN_DIST)}`, 'resize at build (<Image> width=) or serve via an image transform; a hero should be 50–250 KB');
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

    // Alt text on content <img> in built HTML (WCAG 1.1.1). `alt=""` = decorative
    // and passes; a missing attribute is the violation.
    if (findings.altMissing.length === 0) {
      reporter.pass(SEC, 'alt', 'all content <img> in dist/ carry an alt attribute');
    } else {
      reporter.fix(SEC, 'alt', `${findings.altMissing.length} content <img> in dist/ have no alt attribute (e.g. ${truncate(findings.altMissing[0], 80)})`, 'add alt text (alt="" only if the image is purely decorative); <Image> from astro:assets requires it');
    }
  }
}

// Scanners -------------------------------------------------------------------

function scanImgTags(text, relPath, findings) {
  // Match the tag, then read `src` off its attributes with the shared helper —
  // an inline `\bsrc=` pattern also matches `data-src=`, inventing a finding for
  // a lazy-loaded image and quoting a src attribute the tag never had.
  const re = /<img\b([^>]*)>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const src = attrValue(m[1], 'src');
    if (!src) continue;
    if (!isContentImageRef(src)) continue;
    if (IT_PREFIX_RE.test(src)) continue;
    if (src.startsWith('data:') || src.startsWith('blob:')) continue;
    findings.imgNotRouted.push({ file: relPath, line: lineOf(text, m.index), src });
  }
}

function scanBackgroundImages(text, relPath, projectRoot, findings) {
  const re = /background(?:-image)?\s*:[^;{}]*?url\(\s*(["'`]?)([^"'`)]+)\1\s*\)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const url = m[2];
    if (!isContentImageRef(url)) continue;
    if (IT_PREFIX_RE.test(url)) continue;
    if (url.startsWith('data:')) continue;
    const sizeBytes = resolveAssetSize(url, projectRoot);
    if (sizeBytes != null && sizeBytes < SIZE_WARN_BG) continue;
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

function scanDist(projectRoot, findings) {
  const dist = join(projectRoot, 'dist');
  walkDir(dist, (rel) => {
    const ext = extname(rel).toLowerCase();
    if (!CONTENT_IMAGE_EXTS.has(ext)) return;
    try {
      const sz = statSync(join(projectRoot, rel)).size;
      if (sz > SIZE_WARN_DIST) findings.oversizedDist.push({ path: rel, sizeBytes: sz });
    } catch {}
  }, projectRoot);
}

// One pass over built HTML: transform-param anti-patterns + content <img> alt.
function scanDistHtml(projectRoot, findings) {
  const seenUrl = new Set();
  const seenAlt = new Set();
  eachDistHtml(projectRoot, (rel, html) => {
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
    for (const src of imgsMissingAlt(html)) {
      if (seenAlt.has(src)) continue;
      seenAlt.add(src);
      findings.altMissing.push(src);
    }
  });
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
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else callback(relative(root, full));
    }
  }
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
