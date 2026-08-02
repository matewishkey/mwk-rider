// content — pages a site is repeatedly asked for and rarely has.
//
// Both checks here are house style: a personal Astro blog is not broken for
// lacking either, and a tool that says otherwise gets uninstalled. They read
// built HTML rather than filenames, so any routing convention counts.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { eachDistHtml } from '../lib/html.mjs';

const SEC = 'content';

// Route shapes, matched on the built path. `/media-kit/index.html`, `/press.html`
// and `/en/presskit/index.html` all count.
const MEDIA_KIT_RE = /(^|\/)(media-?kit|press-?kit|press)(\.html|\/index\.html)$/i;
const DESIGN_KIT_RE = /(^|\/)(design|design-?kit|design-?system|style-?guide|styleguide|tokens)(\.html|\/index\.html)$/i;

export async function run({ project, reporter }) {
  if (!project.hasDist || !existsSync(join(project.root, 'dist'))) {
    reporter.skip(SEC, 'mediakit', 'no dist/ — build the site to check for a media-kit page');
    reporter.skip(SEC, 'designkit', 'no dist/ — build the site to check for a design reference page');
    return;
  }

  const media = [], design = [];
  eachDistHtml(project.root, (rel, html) => {
    const path = rel.replace(/^dist\//, '');
    if (MEDIA_KIT_RE.test(path)) media.push({ rel, html });
    if (DESIGN_KIT_RE.test(path)) design.push({ rel, html });
  });

  checkMediaKit(reporter, media);
  checkDesignKit(reporter, design);
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
    reporter.fix(SEC, 'mediakit', 'no /media-kit, /press or /presskit route in dist/', 'add one page carrying the logo files, a paste-ready description and a contact route — it is the URL you hand to anyone who asks for your assets');
    return;
  }
  const page = pages[0];
  const missing = [];
  if (!hasLogoAsset(page.html)) missing.push('a downloadable logo asset');
  if (!hasBoilerplate(page.html)) missing.push('a paste-ready description (a paragraph of at least 120 characters)');
  if (!hasContact(page.html)) missing.push('a contact route or mailto: link');

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
  const page = pages[0];
  const evidence = designEvidence(page.html);
  if (evidence.length >= 2) {
    reporter.pass(SEC, 'designkit', evidence.join(', '), { file: page.rel });
  } else {
    reporter.fix(SEC, 'designkit', `page exists but looks like a stub (${evidence.length ? evidence.join(', ') : 'no tokens or component samples rendered'})`, 'render the tokens themselves — swatches from the real custom properties, the type scale, and one live instance of each component', { file: page.rel });
  }
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
