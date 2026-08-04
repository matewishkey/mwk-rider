// content — pages a site is repeatedly asked for and rarely has, plus one lint
// on the prose itself.
//
// The two page checks are house style: a personal Astro blog is not broken for
// lacking either, and a tool that says otherwise gets uninstalled. They read
// built HTML rather than filenames, so any routing convention counts.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { eachDistHtml, attrValue } from '../lib/html.mjs';
import { distRelative, distDir } from '../lib/dist.mjs';

const SEC = 'content';

// Route shapes, matched on the built path. `/media-kit/index.html`, `/press.html`
// and `/en/presskit/index.html` all count.
//
// Bare `/media` is in the list because it is the name a lot of sites actually
// use — tasmanvisa-web reported a 🔧 for a missing media kit while serving a
// full bilingual one at `/media/` (issue #17). The single-word route is if
// anything the more common spelling on a small business site.
const MEDIA_KIT_RE = /(^|\/)(media|media-?kit|press-?kit|press|news-?room|brand-?kit)(\.html|\/index\.html)$/i;
const DESIGN_KIT_RE = /(^|\/)(design|design-?kit|design-?system|style-?guide|styleguide|tokens)(\.html|\/index\.html)$/i;

// What the finding names when the route is absent. Kept next to the pattern it
// describes; tools/test.mjs asserts each name it lists actually matches.
const MEDIA_KIT_NAMES = '/media, /media-kit, /press, /presskit, /newsroom or /brand-kit';

export async function run({ project, reporter }) {
  checkAmbiguousQuotes(project, reporter);

  if (!project.hasDist || !existsSync(join(project.root, 'dist'))) {
    reporter.skip(SEC, 'mediakit', 'no dist/ — build the site to check for a media-kit page');
    reporter.skip(SEC, 'designkit', 'no dist/ — build the site to check for a design reference page');
    return;
  }

  const media = [], design = [];
  const mediaAlternates = new Set(), designAlternates = new Set();
  eachDistHtml(project.root, (rel, html) => {
    const path = distRelative(project.root, rel);
    if (MEDIA_KIT_RE.test(path)) { media.push({ rel, html }); collectAlternates(html, mediaAlternates); }
    if (DESIGN_KIT_RE.test(path)) { design.push({ rel, html }); collectAlternates(html, designAlternates); }
  });
  addAlternates(project.root, media, mediaAlternates);
  addAlternates(project.root, design, designAlternates);

  checkMediaKit(reporter, media);
  checkDesignKit(reporter, design);
}

/**
 * The `hreflang` alternates a page links to, as URL pathnames.
 *
 * This is how a translated slug counts. A route name list is English by
 * construction, so `/hu/sajto/` could never match one however long the list
 * gets — but the site itself already says the two pages are the same page, in
 * the alternate block it emits for search engines. Reading that is a general
 * answer to translated routing; a per-language dictionary of the word "press"
 * is not. Raised alongside issue #17.
 */
function collectAlternates(html, out) {
  for (const m of html.matchAll(/<link\b((?:"[^"]*"|'[^']*'|[^>])*)>/gi)) {
    const attrs = m[1];
    if (!/alternate/i.test(attrValue(attrs, 'rel') ?? '')) continue;
    if (!attrValue(attrs, 'hreflang')) continue;
    const href = attrValue(attrs, 'href');
    if (!href) continue;
    // Only the path matters. An hreflang href is normally absolute, but a
    // relative one is legal, and a locale served from another host resolves to a
    // path this build simply won't have — which costs a failed `existsSync`.
    let path;
    try { path = new URL(href, 'https://x.invalid').pathname; } catch { continue; }
    out.add(path);
  }
}

/** Pull each alternate's built HTML in, unless the walk already collected it. */
function addAlternates(root, pages, paths) {
  const have = new Set(pages.map((p) => p.rel));
  for (const path of paths) {
    const clean = path.split(/[?#]/)[0].replace(/^\//, '');
    // The site root is never the media kit. An `x-default` alternate pointing at
    // `/` would otherwise nominate the homepage, and a homepage carrying a logo,
    // a long paragraph and a contact link would pass this check for a page that
    // does not exist — a false ✅, which is the worst outcome the tool has.
    if (clean === '' || clean === '/') continue;
    for (const candidate of [join(clean, 'index.html'), `${clean.replace(/\/$/, '')}.html`]) {
      const full = join(distDir(root), candidate);
      const rel = relative(root, full);
      if (have.has(rel) || !existsSync(full)) continue;
      try { pages.push({ rel, html: readFileSync(full, 'utf8') }); have.add(rel); } catch {}
      break;
    }
  }
}

/**
 * A media kit is the one URL you hand to press, partners, sponsors and
 * directories. Without it, "can you send your logo and a short description"
 * becomes an email thread and inconsistent assets end up in the wild.
 *
 * Three things make the page useful rather than a stub: an actual logo file to
 * download, boilerplate copy someone can paste, and a way to reach a human.
 */
function checkMediaKit(reporter, pages) {
  if (pages.length === 0) {
    reporter.fix(SEC, 'mediakit', `no ${MEDIA_KIT_NAMES} route in dist/`, 'add one page carrying the logo files, a paste-ready description and a contact route — it is the URL you hand to anyone who asks for your assets');
    return;
  }
  // The BEST candidate, not the first one found. Broadening the name list means
  // a page can match on its route and not be the media kit (`/media/` as a
  // gallery, `/press/` as a news index), and taking whichever the dist walk hit
  // first would turn a site's real media kit into "page exists but is missing a
  // downloadable logo asset" — a wrong finding, worse than the missed one.
  const { page, missing } = pages
    .map((page) => ({ page, missing: mediaKitMissing(page.html) }))
    .sort((a, b) => a.missing.length - b.missing.length)[0];

  if (missing.length === 0) {
    reporter.pass(SEC, 'mediakit', 'logo, boilerplate and a contact route', { file: page.rel });
  } else {
    reporter.fix(SEC, 'mediakit', `page exists but is missing ${missing.join(', ')}`, 'a media kit that does not carry the assets is another email to answer', { file: page.rel });
  }
}

/**
 * A design/pattern reference page — the one that pays off for an agent reader.
 *
 * A route rendering the site's real tokens and components lets a new
 * contributor (human or not) see what exists and where it is used without
 * reading every component file. It also makes drift visible: rendered from the
 * real tokens, a hardcoded divergent colour shows up next to the swatch it
 * should have matched.
 *
 * Detection is deliberately loose — the risk here is false-positiving on a
 * legitimate variant, not missing one. We only ask: does the route exist, and
 * does it render more than a heading?
 */
function checkDesignKit(reporter, pages) {
  if (pages.length === 0) {
    reporter.fix(SEC, 'designkit', 'no /design, /styleguide or /design-kit route in dist/', 'add a page rendering the real tokens and components — colours, type scale, spacing, buttons, cards, form controls — so what exists is visible without reading every component');
    return;
  }
  // Best candidate, same reasoning as the media kit above.
  const { page, evidence } = pages
    .map((page) => ({ page, evidence: designEvidence(page.html) }))
    .sort((a, b) => b.evidence.length - a.evidence.length)[0];
  if (evidence.length >= 2) {
    reporter.pass(SEC, 'designkit', evidence.join(', '), { file: page.rel });
  } else {
    reporter.fix(SEC, 'designkit', `page exists but looks like a stub (${evidence.length ? evidence.join(', ') : 'no tokens or component samples rendered'})`, 'render the tokens themselves — swatches from the real custom properties, the type scale, and one live instance of each component', { file: page.rel });
  }
}

/** What a page claiming to be the media kit does not carry. Empty = it is one. */
function mediaKitMissing(html) {
  const missing = [];
  if (!hasLogoAsset(html)) missing.push('a downloadable logo asset');
  if (!hasBoilerplate(html)) missing.push('a paste-ready description (a paragraph of at least 120 characters)');
  if (!hasContact(html)) missing.push('a contact route or mailto: link');
  return missing;
}

function hasLogoAsset(html) {
  return /(?:src|href)=["'][^"']*\blogo[^"']*\.(svg|png|jpe?g|webp|zip)["']/i.test(html)
      || /(?:src|href)=["'][^"']*\b(brand|press)[-_/][^"']*\.(svg|png|zip)["']/i.test(html);
}

function hasBoilerplate(html) {
  for (const m of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length >= 120) return true;
  }
  return false;
}

function hasContact(html) {
  return /href=["']mailto:/i.test(html) || /href=["'][^"']*\/contact\b/i.test(html);
}

/** Loose signals that a design page renders something rather than describing it. */
function designEvidence(html) {
  const found = [];
  const customProps = new Set([...html.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1].toLowerCase()));
  if (customProps.size >= 3) found.push(`${customProps.size} design tokens referenced`);

  // Colour swatches: distinct literal colours set as a background somewhere.
  const swatches = new Set([...html.matchAll(/background(?:-color)?\s*:\s*([^;"']+)/gi)].map((m) => m[1].trim().toLowerCase()));
  if (swatches.size >= 4) found.push(`${swatches.size} colour swatches`);

  // Component samples: several distinct heading sections on the page.
  const sections = [...html.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].length;
  if (sections >= 4) found.push(`${sections} sections`);

  return found;
}

/**
 * DOUBLE directional quotes only.
 *
 * Round dogfood 3 caught the alternative: including `’` matched every possessive
 * apostrophe in English prose, so `description: "…everyone’s been waiting for!"`
 * was a finding on 19 lines of a real site. An apostrophe is not a quotation
 * mark, and the ambiguity these engines disagree about is a double quote's
 * direction.
 */
const DIRECTIONAL_DOUBLE = /[„“”«»]/;

/**
 * The body after YAML frontmatter, and the line number it starts on.
 *
 * Frontmatter is YAML, not prose — no markdown engine smart-quotes it, and its
 * values are *delimited* by straight quotes, so scanning it guarantees a hit on
 * any post whose description contains a curly apostrophe. Same round-3 finding.
 */
function withoutFrontmatter(text) {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!m) return { body: text, offset: 0 };
  return { body: text.slice(m[0].length), offset: m[0].split('\n').length - 1 };
}

/**
 * Straight quotes on a line that also uses directional ones — the exact input
 * two smart-quote engines resolve differently.
 *
 * Astro 7 replaced remark with Sätteri, and the two disagree on an ambiguous
 * straight `"`. On tasmanvisa-web's Hungarian content the closing quotes flipped
 * to *opening* ones: six posts shipped `„bespoke“` where the Hungarian pairing
 * is `„…”`. Nothing in the build said a word.
 *
 * ADVISORY IN EVERY MODE, deliberately. Correct prose can legitimately mix a
 * straight quote (an inch mark, a code sample, an attribute in a sentence) with
 * a directional one, so this is the one check here that can fire on a compliant
 * site — and a check that fails a compliant site is the thing this repo refuses
 * to ship. It reports where the ambiguity is; the reader decides. Writing the
 * quote explicitly fixes it permanently, for any engine.
 */
function checkAmbiguousQuotes(project, reporter) {
  const files = markdownFiles(project.root);
  if (files.length === 0) {
    reporter.skip(SEC, 'quotes:ambiguous', 'no markdown under src/ — nothing to read');
    return;
  }

  const hits = [];
  let scanned = 0;
  for (const file of files) {
    let text;
    try { text = readFileSync(join(project.root, file), 'utf8'); } catch { continue; }
    scanned++;
    const { body, offset } = withoutFrontmatter(text);
    let inFence = false;
    body.split('\n').forEach((line, i) => {
      // Fenced code is not prose and no engine touches its quotes.
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
      if (inFence) return;
      const prose = line.replace(/`[^`]*`/g, '');
      if (!/"/.test(prose)) return;
      if (!DIRECTIONAL_DOUBLE.test(prose)) return;
      hits.push({ file, line: offset + i + 1, text: prose.trim() });
    });
  }

  if (hits.length === 0) {
    reporter.pass(SEC, 'quotes:ambiguous', `no straight quote shares a line with a directional one across ${scanned} content file(s)`);
    return;
  }
  const sample = hits.slice(0, 3).map((h) => `${h.file}:${h.line}`).join(', ');
  reporter.suggest(
    SEC,
    'quotes:ambiguous',
    `${hits.length} line(s) mix a straight " with a directional quote — the ambiguous input Sätteri (Astro 7) and remark resolve differently (${sample}${hits.length > 3 ? ', …' : ''})`,
    'write the quote you mean („…" in Hungarian, "…" in English) so no engine has to guess; an inch mark or an attribute quoted in prose is fine and can be ignored',
  );
}

/**
 * Every markdown file under `src/`, project-relative.
 *
 * Not `src/content/` — that is a convention, not a rule. The starter keeps its
 * posts in `src/data/blog/`, and hardcoding the other path is precisely the
 * failure that made a whole SEO domain silently not run (see lib/src-scan.mjs).
 */
function markdownFiles(root) {
  const base = join(root, 'src');
  const out = [];
  if (!existsSync(base)) return out;
  const stack = [base];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (/\.mdx?$/i.test(e.name)) out.push(relative(root, full));
    }
  }
  return out;
}
