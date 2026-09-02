#!/usr/bin/env node
/**
 * OG card generator for _fixture-i18n.
 *
 * This was a stub that printed a promise and produced nothing, while
 * `SEO.astro` declared `og:image` → `/og/<locale>/<slug>.png` on every post and
 * `/og/default.png` everywhere else. So the fixture — the site that exists to
 * prove the checks — shipped an og:image that 404s, and a `--url` audit of it
 * reported `🔧 seo: og:image-resolves` for months. Nothing caught it because
 * CI only ever audits offline (issue #25).
 *
 * It renders the cards itself rather than screenshotting `/preview/og/...`:
 * that route needs a running server, and in `astro dev` it 404s anyway
 * (issue #26). A self-contained render has neither problem and needs no build.
 *
 * Output is committed, like `examples/starter/public/og/default.png` — a fresh
 * clone has to pass a live audit without running a generator first.
 *
 *   npm run og          # regenerate every card
 */
import { chromium } from 'playwright';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const BLOG = join(root, 'src', 'data', 'blog');
const OUT = join(root, 'public', 'og');

// Matches the declared og:image:width/height in SEO.astro. A card whose bytes
// disagree with its meta is what `seo: og:image:dimensions` exists to catch.
const W = 1200, H = 630;

/** Frontmatter fields the card needs. Deliberately not a YAML parser — two scalars. */
function frontmatter(file) {
  const text = readFileSync(file, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const field = (k) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
  return { title: field('title'), excerpt: field('excerpt') };
}

/**
 * Every post that gets a public page, and therefore needs a card.
 *
 * The filter is `!draft && !previewOnly` — the shared publish predicate, the
 * same one llms.txt, RSS and the search index use. NOT the `_` filename prefix:
 * Astro's glob loader does **not** skip those, and `dist/preview/posts/
 * _preview-project/` proves it. They are excluded from the public blog by
 * frontmatter, and it is the frontmatter that decides whether a card is needed.
 * The two happen to coincide in this fixture, which is exactly how a wrong rule
 * survives — it gives the right answer until someone writes `_notes.md` without
 * `previewOnly` and loses its card with no error.
 */
function posts() {
  const out = [];
  for (const locale of readdirSync(BLOG)) {
    for (const f of readdirSync(join(BLOG, locale))) {
      if (!/\.mdx?$/.test(f)) continue;
      const text = readFileSync(join(BLOG, locale, f), 'utf8');
      if (/^draft:\s*true/m.test(text) || /^previewOnly:\s*true/m.test(text)) continue;
      out.push({ locale, slug: f.replace(/\.mdx?$/, ''), ...frontmatter(join(BLOG, locale, f)) });
    }
  }
  return out;
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * The card. Terminal-green on near-black, matching the fixture's own chrome.
 *
 * Flat fills on purpose. The first version had a radial gradient and the ten
 * cards came to 1.3 MB — PNG stores a smooth gradient badly, and these are
 * committed. Flat colour plus a rule at the top is the same idea at 20 KB
 * each, which is what `examples/starter/public/og/default.png` already costs.
 */
const card = (title, sub, tag) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0}
  body{width:${W}px;height:${H}px;background:#0b0d0b;color:#e7e7e7;
       font:400 32px/1.35 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       display:flex;flex-direction:column;justify-content:space-between;
       padding:72px;box-sizing:border-box;border-top:10px solid #33FF33}
  .tag{font:600 22px ui-monospace,SFMono-Regular,Menlo,monospace;color:#33FF33;
       letter-spacing:.18em;text-transform:uppercase}
  h1{font-size:66px;line-height:1.12;margin:0;font-weight:650;letter-spacing:-.02em;
     display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  p{margin:20px 0 0;color:#9a9a9a;font-size:29px;line-height:1.4;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .foot{display:flex;align-items:center;gap:14px;color:#7d7d7d;font-size:24px}
  .dot{width:13px;height:13px;border-radius:50%;background:#33FF33}
</style>
<div class="tag">${esc(tag)}</div>
<div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
<div class="foot"><span class="dot"></span>rider i18n fixture</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

const write = async (rel, html) => {
  await page.setContent(html, { waitUntil: 'load' });
  const buf = await page.screenshot({ type: 'png' });
  mkdirSync(dirname(join(OUT, rel)), { recursive: true });
  writeFileSync(join(OUT, rel), buf);
  console.log(`  ${rel}  ${W}×${H}  ${(buf.length / 1024).toFixed(0)} KB`);
};

console.log('og.mjs — rendering cards into public/og/');
await write('default.png', card('rider i18n fixture', 'The multi-locale exerciser: i18n routing, search, preview routes.', 'fixture'));
for (const p of posts()) {
  await write(`${p.locale}/${p.slug}.png`, card(p.title, p.excerpt, p.locale));
}
await browser.close();
console.log('done — commit these; a fresh clone must pass a live audit without running me first.');
