#!/usr/bin/env node
/**
 * Social cards for the fixture, generated from the content on every build.
 *
 * This replaced a Playwright screenshotter (2026-09-02, issue #32). That one
 * needed a ~400 MB browser, a manual `npm run og`, and committed its output —
 * so a retitled post kept its old card until someone remembered. Now it is
 * satori (layout → SVG) and sharp (SVG → PNG), the same pipeline as the
 * starter, run ahead of `astro build`; public/og/ is gitignored because a
 * build always redraws it. Playwright stays a devDependency for the browser
 * audit domain and the smoke/screenshot scripts, not for this.
 *
 * Per-locale: `public/og/<locale>/<slug>.png`, plus `default.png`. Which
 * posts get a card is the shared publish predicate — `!draft && !previewOnly`
 * read from the frontmatter — NOT the `_` filename prefix, which Astro's glob
 * loader does not skip. The two happen to coincide here, which is exactly how
 * a wrong rule survives.
 *
 * Fonts: Inter (OFL 1.1), subset to Latin + Latin Extended-A so the Hungarian
 * ő and ű render — the first subset stopped at U+00FF and would have drawn
 * tofu for `Csak magyar`. satori embeds glyph outlines as paths, so no font is
 * needed on the machine that rasterises.
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';
import { config } from './og.config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const BLOG = join(root, 'src', 'data', 'blog');
const OUT = join(root, 'public', 'og');
const FONTS = join(root, 'src', 'assets', 'fonts');

// Matches the declared og:image:width/height in SEO.astro. A card whose bytes
// disagree with its meta is what `seo: og:image:dimensions` exists to catch.
const CARD = { width: 1200, height: 630 };
const { palette, siteName, tagline } = config.brand;

const fonts = [
  { name: 'Inter', data: readFileSync(join(FONTS, 'Inter-Regular.ttf')), weight: 400, style: 'normal' },
  { name: 'Inter', data: readFileSync(join(FONTS, 'Inter-Bold.ttf')), weight: 700, style: 'normal' },
];

/** Frontmatter fields the card needs. Deliberately not a YAML parser — three scalars and two flags. */
function frontmatter(file) {
  const fm = readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const field = (k) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^["'](.*)["']$/, '$1') ?? '';
  return { title: field('title'), excerpt: field('excerpt'), draft: field('draft') === 'true', previewOnly: field('previewOnly') === 'true' };
}

function posts() {
  const out = [];
  for (const locale of readdirSync(BLOG)) {
    for (const f of readdirSync(join(BLOG, locale))) {
      if (!['.md', '.mdx'].includes(extname(f))) continue;
      const fm = frontmatter(join(BLOG, locale, f));
      if (fm.draft || fm.previewOnly || !fm.title) continue;
      out.push({ locale, slug: f.replace(/\.mdx?$/, ''), ...fm });
    }
  }
  return out;
}

function clamp(text, max) {
  const t = String(text ?? '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

// Plain objects, not JSX — no JSX runtime in a .mjs script. Every container
// sets display:flex explicitly: satori's Yoga layout needs it on anything with
// more than one child, and mis-stacks silently without it.
const el = (style, children) => ({ type: 'div', props: { style, children } });

// Terminal green on near-black, the fixture's own chrome. Flat fills on purpose:
// the first Playwright version had a radial gradient and ten cards came to
// 1.3 MB — PNG stores a smooth gradient badly.
function template({ title, sub, tag }) {
  return el(
    {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      backgroundColor: palette.background, color: palette.text, fontFamily: 'Inter',
      padding: '64px 72px', borderTop: `10px solid ${palette.primary}`,
    },
    [
      el({ display: 'flex', fontSize: 22, fontWeight: 700, color: palette.primary, letterSpacing: '0.18em', textTransform: 'uppercase' }, tag),
      el({ display: 'flex', flexDirection: 'column' }, [
        el({ display: 'flex', fontSize: String(title).length > 55 ? 56 : 66, fontWeight: 700, lineHeight: 1.12, letterSpacing: '-0.02em' }, clamp(title, 95)),
        el({ display: 'flex', marginTop: 20, fontSize: 29, lineHeight: 1.4, color: palette.muted }, sub ? clamp(sub, 120) : ''),
      ]),
      el({ display: 'flex', alignItems: 'center', fontSize: 24, color: palette.muted }, [
        el({ display: 'flex', width: 13, height: 13, borderRadius: 7, backgroundColor: palette.primary, marginRight: 14 }, ''),
        el({ display: 'flex' }, siteName),
      ]),
    ],
  );
}

async function write(rel, input) {
  const svg = await satori(template(input), { ...CARD, fonts });
  const png = await sharp(Buffer.from(svg)).png({ palette: true }).toBuffer();
  mkdirSync(dirname(join(OUT, rel)), { recursive: true });
  writeFileSync(join(OUT, rel), png);
  console.log(`og: ${rel}  ${CARD.width}×${CARD.height}  ${(png.length / 1024).toFixed(0)} KB`);
}

await write('default.png', { title: siteName, sub: tagline, tag: 'fixture' });
let n = 1;
for (const p of posts()) { await write(`${p.locale}/${p.slug}.png`, { title: p.title, sub: p.excerpt, tag: p.locale }); n++; }
console.log(`og: ${n} card(s) → public/og/`);
