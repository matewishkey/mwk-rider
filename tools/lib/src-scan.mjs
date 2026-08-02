// src-scan — read a project's source files once, so checks can look for what a
// site *does* rather than where it keeps it.
//
// Checks used to hardcode `src/components/SEO.astro`. That produced the worst
// possible failure: a site whose head meta lived in `BaseHead.astro` (the name
// Astro's own blog starter uses) got a required finding for a component it had,
// and the individual meta checks then never ran at all — indistinguishable in
// the output from "checked and passed". Detect the tags, not the filename.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE_EXT = /\.(astro|tsx?|jsx?|mdx?)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', '.astro', '.git']);

/** Every source file under src/, as { path (project-relative), text }. */
export function readSrcFiles(root, { subdir = 'src' } = {}) {
  const base = join(root, subdir);
  if (!existsSync(base)) return [];
  const out = [];
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) stack.push(full); continue; }
      if (!SOURCE_EXT.test(e.name)) continue;
      try { out.push({ path: relative(root, full), text: readFileSync(full, 'utf8') }); }
      catch { /* unreadable file — skip, never fail the audit over it */ }
    }
  }
  return out;
}

/** First file whose text matches, or null. */
export function findInSrc(files, regex) {
  return files.find((f) => regex.test(f.text)) ?? null;
}

/**
 * Files that look like they render document head metadata — the "SEO component"
 * by behaviour rather than by name. Matches a canonical link, an OG/Twitter meta
 * tag, or a <title>. Layouts and components both qualify: plenty of sites put
 * head meta straight in a layout and never factor out a component at all.
 */
export function headMetaFiles(files) {
  return files.filter((f) =>
    /rel=["']canonical["']/.test(f.text) ||
    /["'](?:og|twitter):[a-z:]+["']/.test(f.text) ||
    /<title[\s>]/.test(f.text));
}
