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
// Prose, not syntax: in .md/.mdx a `//` or a slash-star is text, so the JS
// comment rules must not run over it. Everything else may carry script.
const MARKDOWN_EXT = /\.mdx?$/;
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
  const out = text.replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ' '));
  return js ? blankJsComments(out) : out;
}

// Only after start-of-line or an opener/separator — never after `:` (so an
// unquoted `https://…` survives) or after a backslash (so the `\/\/` in a regex
// literal does). String literals are handled by the scanner itself.
const LINE_COMMENT_LEAD = /[\s{(,;]/;

/**
 * Blank `/*…*​/` and `//…` comments, skipping anything inside a string literal.
 *
 * A regex pass cannot do this, and the failure was not theoretical: the most
 * idiomatic line in an Astro Content Layer config —
 * `loader: glob({ pattern: '**​/*.md' })` — contains a `/*` inside a quoted
 * string. A plain `/\/\*[\s\S]*?\*\//` treated it as a comment opener and
 * blanked everything up to the next real `*​/`, swallowing the `schema:` key a
 * few lines down and reporting a fully-schema'd collection as having none.
 *
 * String state resets at every newline, deliberately. A `'` in .astro *prose*
 * ("don't") is not a string opener, and letting one span lines would suppress
 * comment stripping for the rest of the file — reintroducing the
 * comment-satisfies-a-check failure above, which is the worse of the two. The
 * cost is that a `/*` on a line after a prose apostrophe is missed; the cost of
 * the alternative is unbounded.
 */
function blankJsComments(src) {
  const c = src.split('');   // UTF-16 units: offsets stay aligned with `src`
  let quote = null;
  for (let i = 0; i < c.length; i++) {
    if (c[i] === '\n') { quote = null; continue; }
    if (quote) {
      if (c[i] === '\\') i++;                  // escaped: whatever follows is not a terminator
      else if (c[i] === quote) quote = null;
      continue;
    }
    if (c[i] === '"' || c[i] === "'" || c[i] === '`') { quote = c[i]; continue; }
    if (c[i] === '/' && c[i + 1] === '*') {
      // No closer means this is not a comment — an unterminated one is a syntax
      // error, so the likelier reading is that we mis-detected an opener.
      // Blanking to EOF on that guess would void every check on the file.
      const end = src.indexOf('*/', i + 2);
      if (end === -1) { i++; continue; }
      for (let j = i; j < end + 2; j++) if (c[j] !== '\n') c[j] = ' ';
      i = end + 1;
      continue;
    }
    if (c[i] === '/' && c[i + 1] === '/' && (i === 0 || LINE_COMMENT_LEAD.test(c[i - 1]))) {
      while (i < c.length && c[i] !== '\n') c[i++] = ' ';
      i--;
    }
  }
  return c.join('');
}

/**
 * Every source file under src/, as { path (project-relative), text, code }.
 *   text — verbatim, for reporting excerpts and counting lines
 *   code — comments blanked out; what a check should match against
 *
 * `exts` widens what counts as a source file. The default is what renders a
 * page; `analytics` adds `.html`, because a script tag pasted into a static
 * HTML file under src/ ships exactly like one pasted into a component.
 */
export function readSrcFiles(root, { subdir = 'src', exts = SOURCE_EXT } = {}) {
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
      if (!exts.test(e.name)) continue;
      try {
        const text = readFileSync(full, 'utf8');
        out.push({
          path: relative(root, full),
          text,
          code: stripComments(text, { js: !MARKDOWN_EXT.test(e.name) }),
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
