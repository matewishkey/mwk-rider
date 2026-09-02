#!/usr/bin/env node
/**
 * Social cards, generated from the content.
 *
 * The site used to ship ONE hand-made `public/og/default.png` for every page,
 * with a comment in SEO.astro admitting per-post cards were "a nice upgrade".
 * This is that upgrade, and the reason it is worth having is not prettiness: a
 * card generated from the entry cannot go stale. Retitle a post and its card
 * follows on the next build. A committed PNG does not, and nothing tells you.
 *
 * ## Why a build step rather than an Astro endpoint
 *
 * The obvious shape is `src/pages/og/[...slug].png.ts` with `getStaticPaths`,
 * and it does not work here. `@astrojs/cloudflare` prerenders inside **workerd**,
 * which cannot load a native Node addon, so the build fails with:
 *
 *     No such module "dist/server/.prerender/chunks/sharp"
 *
 * sharp is a native binding, so any endpoint that reaches it dies in the
 * sandbox. Running in plain Node before `astro build` sidesteps that entirely
 * and has a second benefit: it is adapter-independent, so this file keeps
 * working if the site moves off Cloudflare.
 *
 * ## Why not a browser
 *
 * The sibling fixture screenshots a preview route with Playwright — a ~400 MB
 * dependency, a running server, and a route that 404s in `astro dev`. satori
 * needs none of that. It embeds glyph outlines as SVG paths by default, so the
 * rasteriser never needs a font installed and the same bytes come out on every
 * machine; that is also why sharp can do the conversion with no fontconfig.
 *
 * Fonts are Inter (SIL Open Font License 1.1), subset to Latin — 43 KB for both
 * weights, down from 650 KB. Build-time input; never served to a browser.
 *
 *   npm run og       # regenerate (npm run build does it for you)
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';
import { config } from './og.config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const BLOG = join(root, 'src', 'data', 'blog');
const OUT = join(root, 'public', 'og');
const FONTS = join(root, 'src', 'assets', 'fonts');

/** Google's documented card size, and what every platform crops against. */
const CARD = { width: 1200, height: 630 };

// The site's own tokens, from src/styles/global.css. Light palette only: a card
// is composited into someone else's timeline, so it does not follow the reader's
// colour scheme and should not try to.
const INK = '#18181b';
const MUTED = '#52525b';
const ACCENT = '#1d4ed8';
const BG = '#ffffff';

const fonts = [
  { name: 'Inter', data: readFileSync(join(FONTS, 'Inter-Regular.ttf')), weight: 400, style: 'normal' },
  { name: 'Inter', data: readFileSync(join(FONTS, 'Inter-Bold.ttf')), weight: 700, style: 'normal' },
];

/**
 * Enough frontmatter to draw a card: the title and the excerpt.
 *
 * A three-line parser rather than a YAML dependency, because it reads exactly
 * two scalar keys and anything it cannot read it simply skips. If that ever
 * needs to grow a list or a nested value, take the dependency instead of
 * teaching this to guess.
 */
function frontmatter(file) {
  const raw = readFileSync(file, 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(title|excerpt|draft):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return out;
}

/**
 * A long title is truncated rather than left to overflow: satori will happily
 * lay out ten lines and push the rest off the canvas, with no scrollbar to
 * reveal it and no error. Cutting at a word boundary is the honest failure.
 */
function clamp(text, max = 90) {
  const t = String(text ?? '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

// Plain objects rather than JSX: this is a .mjs script with no JSX runtime, and
// adding one to draw three boxes would be a lot of build surface for no gain.
// Every container sets `display: 'flex'` explicitly — satori's Yoga layout needs
// it on any element with more than one child, and without it the card
// mis-stacks silently rather than erroring.
const el = (style, children) => ({ type: 'div', props: { style, children } });

function template({ title, kicker, siteName }) {
  return el(
    {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      justifyContent: 'space-between', backgroundColor: BG, color: INK,
      fontFamily: 'Inter', padding: '64px 72px', borderTop: `16px solid ${ACCENT}`,
    },
    [
      el({ display: 'flex', fontSize: 28, fontWeight: 700, color: ACCENT, letterSpacing: '0.02em' }, siteName),
      el(
        { display: 'flex', fontSize: String(title).length > 55 ? 62 : 76, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em' },
        clamp(title),
      ),
      el({ display: 'flex', fontSize: 30, color: MUTED, lineHeight: 1.3 }, kicker ? clamp(kicker, 110) : ''),
    ],
  );
}

async function card(input, outFile) {
  const svg = await satori(template(input), { ...CARD, fonts });
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, png);
  return png.length;
}

const { brand } = config;
mkdirSync(OUT, { recursive: true });

let n = 0;
n += 1;
const defaultBytes = await card(
  { title: brand.siteName, kicker: brand.tagline, siteName: brand.siteName },
  join(OUT, 'default.png'),
);
console.log(`og: default.png (${(defaultBytes / 1024).toFixed(1)} KB)`);

for (const file of readdirSync(BLOG)) {
  // `_`-prefixed entries are Astro's own "not a route" convention, and the
  // collection excludes them — a card for a post that has no page is a card
  // nothing can reference.
  if (file.startsWith('_') || !['.md', '.mdx'].includes(extname(file))) continue;
  const fm = frontmatter(join(BLOG, file));
  if (!fm?.title) { console.warn(`og: skipped ${file} — no title in frontmatter`); continue; }
  if (String(fm.draft) === 'true') continue;
  const id = basename(file, extname(file));
  const bytes = await card({ title: fm.title, kicker: fm.excerpt, siteName: brand.siteName }, join(OUT, 'blog', `${id}.png`));
  console.log(`og: blog/${id}.png (${(bytes / 1024).toFixed(1)} KB)`);
  n += 1;
}
console.log(`og: ${n} card(s) → public/og/`);
