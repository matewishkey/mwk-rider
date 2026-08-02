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
const CODE_EXT = /\.(astro|tsx?|jsx?)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', '.astro', '.git']);

/**
 * Blank out comments, preserving every offset and line break.
 *
 * A check that greps source text cannot tell code from a comment, so
 * `// TODO: emit og:image and rel="canonical"` used to satisfy six checks at
 * once — the tool reporting *verified good* where nothing was emitted, which is
 * the worst failure mode it has. Comments are replaced with spaces rather than
 * removed so `code` stays index-aligned with `text`: a match offset still maps
 * to the right line for reporting.
 *
 * `js` is off for .md/.mdx, where slash-star and `//` are prose, not syntax.
 */
export function stripComments(text, { js = true } = {}) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  let out = text.replace(/<!--[\s\S]*?-->/g, blank);
  if (!js) return out;
  out = out.replace(/\/\*[\s\S]*?\*\//g, blank);
  // Only after start-of-line or an opener/separator — never after `:` (so
  // `https://…` survives) or a quote (so a '//' string literal survives).
  return out.replace(/(^|[\s{(,;])\/\/[^\n]*/gm, (m, lead) => lead + blank(m.slice(lead.length)));
}

/**
 * Every source file under src/, as { path (project-relative), text, code }.
 *   text — verbatim, for reporting excerpts and counting lines
 *   code — comments blanked out; what a check should match against
 */
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
      try {
        const text = readFileSync(full, 'utf8');
        out.push({
          path: relative(root, full),
          text,
          code: stripComments(text, { js: CODE_EXT.test(e.name) }),
        });
      }
      catch { /* unreadable file — skip, never fail the audit over it */ }
    }
  }
  return out;
}

/** First file whose code matches, or null. */
export function findInSrc(files, regex) {
  return files.find((f) => regex.test(f.code ?? f.text)) ?? null;
}

/**
 * Files that look like they render document head metadata — the "SEO component"
 * by behaviour rather than by name. Matches a canonical link, an OG/Twitter meta
 * tag, or a <title>. Layouts and components both qualify: plenty of sites put
 * head meta straight in a layout and never factor out a component at all.
 *
 * Matches against `code`, so a component that only *talks about* emitting head
 * meta in a comment does not count as one.
 */
export function headMetaFiles(files) {
  return files.filter((f) => {
    const code = f.code ?? f.text;
    return /rel=["']canonical["']/.test(code) ||
      /(?:property|name)\s*=\s*["'](?:og|twitter):[a-z_:]+["']/.test(code) ||
      /<title[\s>]/.test(code);
  });
}
