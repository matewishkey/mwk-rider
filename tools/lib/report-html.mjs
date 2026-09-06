// report-html — the audit as a standalone, brand-designed page.
//
// Terminal output is for the person who ran the audit. A site owner needs
// something they can open, read in order, and act on — and something that tells
// them where to get help. `--report <path>` writes that page.
//
// ## Brand
//
// The tokens are Mate Wish Key's, read off https://matewishkey.com/design/ on
// 2026-09-06. The design page states ROLES, not swatches, and several of them
// are not what you would guess — the first pass of this file guessed and got
// four wrong. The table, light / dark:
//
//   --red        #e2342b / #e2342b  SURFACE and display only: the block, the
//                                   mark, a heading word at 19px/700 or bigger.
//                                   Never a paragraph, never a caption, never a
//                                   small link, and never a fill with a label on
//                                   it. Same value in both themes.
//   --red-field  #c9251d / #c9251d  the fill for a red thing WITH WORDS on it.
//                                   One value both themes: what it clears is the
//                                   white label on top, not the page beneath.
//   --red-deep   #c9251d / #f0524a  the ONLY red allowed at body size — links,
//                                   kickers, small bold, inline code.
//   --paper      #ffffff / #131313  the page, and nearly everything is page.
//   --panel      #faf7f7 / #1d1a1a  the one quiet field: the footer, the code
//                                   gutter. A CARD IS NOT THIS — a card is the
//                                   page with a hairline round it, which is what
//                                   lets the whole thing run on two grounds
//                                   instead of three.
//   --line       #e3dbdb / #322929  hairlines. Decorative; nothing you need to
//                                   see is drawn in it.
//   --edge       #8a848e / #7a7482  the border of something clickable — 3:1
//                                   non-text contrast. NOT a text colour.
//   --ink        #16151a / #f4f2f6  body copy and headings.
//   --mute       #56525c / #a8a2b0  standfirst, meta lines, captions, kickers.
//   --green      #00773d / #7fd79a  the companion hue, equal standing with
//                                   --red-deep, neither shouting over the other.
//
// The logo is the BLOCK — "a red square with the white mark centred in it, not
// the bare mark", one state at every size, mark at 64%. The wordmark has two
// variants and the footer needs the quiet one: the default sets the middle word
// in --red, but below ~19px red stops being a display colour, so a 14px footer
// wordmark sets all three words in --ink. The design page names the footer
// wordmark specifically as where you meet that rule.
//
// "Three strokes, no numbers": nothing on the site uses a number as a MARKER —
// no ordered lists, no numbered steps. Counts that were measured are a different
// thing and are fine, which is what the tiles are.
//
// Fonts are named, never fetched. The brand serves Fraunces/Manrope/JetBrains
// Mono self-hosted under content-hashed family names that resolve nowhere else,
// and this repo does not put a font CDN in front of a user. Each stack names the
// real family first, then the fallbacks the design page itself declares.
//
// ## Escaping is a security property here, not tidiness
//
// Findings from the `--url` domains carry excerpts of a third party's HTML,
// filenames and console output. `lib/untrusted.mjs` fences them, and part of
// that fencing REPLACES the guillemets with literal < and > — so fenced text
// arrives containing angle brackets by design. Every interpolated value goes
// through `esc()`. There is no "this one is safe" exception, because the whole
// point of the untrusted boundary is that we do not get to decide that.

// Verified 2026-09-06: 200. It currently redirects to matewishkey.com/show/ and
// does not preserve the /mwk-rider path — so it lands on the show page, which is
// where it is meant to send someone either way.
const HELP_URL = 'https://mwkshow.com/mwk-rider';

// The mark, exactly as the design page draws it: two strokes, round caps, drawn
// in currentColor so the block can set it white.
const MARK_PATHS = '<path d="M0 100 L23.09 0 L46.17 100 L69.26 0 L69.26 100"/>'
  + '<path d="M69.26 100 L118.03 0"/>';
const MARK = (px) => `<svg class="mk" width="${px}" height="${Math.round(px * 200 / 232)}" `
  + `viewBox="-6.75 -6.75 131.53 113.5" fill="none" aria-hidden="true" focusable="false" `
  + `stroke="currentColor" stroke-width="9.5" stroke-linecap="round" stroke-linejoin="round">`
  + `${MARK_PATHS}</svg>`;

const ICON = { block: '🛑', fix: '🔧', suggest: '💡', skip: '⏭', pass: '✅' };
const LABEL = {
  block: 'Blocking', fix: 'Needs fixing', suggest: 'Worth considering',
  skip: 'Could not be checked', pass: 'Passing',
};

/** HTML-escape. Every value interpolated into the page goes through this. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function where(r) {
  const bits = [r.file, r.line ? `line ${r.line}` : null, r.url].filter(Boolean);
  return bits.length ? bits.join(' · ') : null;
}

function findingRow(r) {
  const loc = where(r);
  return `<li class="f">
  <p class="f-msg"><code class="rid">${esc(r.id)}</code> ${esc(r.message)}</p>
  ${r.fix ? `<p class="f-fix"><span class="f-fix-label">Fix</span> ${esc(r.fix)}</p>` : ''}
  ${loc ? `<p class="f-at">${esc(loc)}</p>` : ''}
</li>`;
}

function section(outcome, rows) {
  if (!rows.length) return '';
  const open = outcome === 'block' || outcome === 'fix';
  // Passing rows are the longest list on the page and the least urgent, so they
  // are the one group split by domain: a hundred ticks in one column is a wall,
  // and "which part of my site is fine" is the only question anyone asks of it.
  const body = outcome === 'pass' || outcome === 'skip'
    ? byDomain(rows)
    : `<ul class="fs">${rows.map(findingRow).join('\n')}</ul>`;
  return `<section class="grp grp-${outcome}">
  <details${open ? ' open' : ''}>
    <summary><span class="ic" aria-hidden="true">${ICON[outcome]}</span>
      <span class="grp-name">${LABEL[outcome]}</span>
      <span class="grp-n">${rows.length}</span></summary>
    ${body}
  </details>
</section>`;
}

/** The same rows, under one subheading per domain, in the order they ran. */
function byDomain(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.section ?? 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups].map(([name, list]) => `<div class="dom">
    <h3 class="dom-h">${esc(name)} <span class="dom-n">${list.length}</span></h3>
    <ul class="fs">${list.map(findingRow).join('\n')}</ul>
  </div>`).join('\n');
}

/**
 * Render an audit run as a complete HTML document.
 *
 * @param {object} run        `{ results, errors, summary }` — the `--json` shape
 * @param {object} meta       `{ site, version, strict, url, generated }`
 */
export function renderReport(run, meta = {}) {
  const results = run.results ?? [];
  const s = run.summary ?? {};
  const by = (o) => results.filter((r) => r.outcome === o);
  const required = (s.fix ?? 0) + (s.block ?? 0);

  const verdict = (run.errors?.length)
    ? `${run.errors.length} tooling error${run.errors.length === 1 ? '' : 's'} — the audit could not finish`
    : required > 0
      ? `${required} thing${required === 1 ? '' : 's'} to address`
      : (s.suggest ?? 0) > 0
        ? 'Nothing required — some optional suggestions'
        : 'Nothing required, nothing suggested';

  // The note only appears when something fenced is actually on the page.
  const hasFenced = results.some((r) => typeof r.message === 'string' && r.message.includes('«'));

  const tiles = [
    ['Passing', s.pass ?? 0],
    ['To address', required],
    ['Suggestions', s.suggest ?? 0],
    ['Not checked', s.skip ?? 0],
  ];

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Site audit${meta.site ? ` · ${esc(meta.site)}` : ''}</title>
<style>
:root{
  --red:#e2342b; --red-field:#c9251d; --red-deep:#c9251d;
  --paper:#ffffff; --panel:#faf7f7; --line:#e3dbdb; --edge:#8a848e;
  --ink:#16151a; --mute:#56525c; --green:#00773d;
  --display:Fraunces,"Times New Roman",Times,serif;
  --body:Manrope,Arial,Helvetica,sans-serif;
  --mono:"JetBrains Mono","Courier New",monospace;
}
/* --red and --red-field are ONE value in both themes; only the grounds, the
   inks and the two readable hues move. */
@media (prefers-color-scheme:dark){:root{
  --red-deep:#f0524a; --paper:#131313; --panel:#1d1a1a; --line:#322929;
  --edge:#7a7482; --ink:#f4f2f6; --mute:#a8a2b0; --green:#7fd79a;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--body);
  line-height:1.55;-webkit-text-size-adjust:100%}
.wrap{max-width:52rem;margin:0 auto;padding:2.5rem 1.25rem 0}
a{color:var(--red-deep)}
/* The logo is the block, not the bare mark: red square, white mark at 64%. */
.rb{display:grid;place-items:center;background:var(--red);color:#fff;
  width:var(--rb,44px);height:var(--rb,44px);flex:none}
.rb .mk{width:64%;height:auto}
/* --red is a display colour and this is 700 weight, far above 19px. */
h1{font-family:var(--display);font-size:clamp(1.9rem,5vw,2.9rem);font-weight:700;
  line-height:1.1;margin:0 0 .4rem}
h1 .hl{color:var(--red)}
.sub{color:var(--mute);font-size:.95rem;margin:0 0 1.6rem}
/* White words on red → --red-field, never --red. */
.verdict{display:inline-block;background:var(--red-field);color:#fff;font-weight:700;
  padding:.45rem .9rem;border-radius:.4rem;margin:0 0 2rem}
.verdict.clear{background:var(--green);color:var(--paper)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(8rem,1fr));gap:.75rem;margin:0 0 2.5rem}
/* A card is the PAGE with a hairline round it — two grounds, never three. */
.tile,.f,summary,.help{background:var(--paper);border:1px solid var(--line);border-radius:.6rem}
.tile{padding:.9rem 1rem}
.tile b{display:block;font-family:var(--display);font-size:1.9rem;font-weight:700;line-height:1}
.tile span{color:var(--mute);font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
.note{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--red);
  border-radius:.4rem;padding:.8rem 1rem;margin:0 0 1.5rem;font-size:.9rem;color:var(--ink)}
.grp{margin:0 0 1rem}
summary{cursor:pointer;display:flex;align-items:center;gap:.6rem;padding:.7rem .9rem;
  font-family:var(--display);font-size:1.15rem;font-weight:700}
summary::-webkit-details-marker{display:none}
.grp-n{margin-left:auto;color:var(--mute);font-family:var(--body);font-size:.9rem;font-weight:400}
.fs{list-style:none;margin:.5rem 0 0;padding:0}
.f{padding:.8rem .95rem;margin:0 0 .5rem}
.f p{margin:0}
/* Inline code is body size, so it takes the only red allowed there. */
.rid{font-family:var(--mono);font-size:.8rem;color:var(--red-deep);background:var(--panel);
  border:1px solid var(--line);border-radius:.3rem;padding:.05rem .35rem;margin-right:.35rem;white-space:nowrap}
.f-msg{overflow-wrap:anywhere}
.f-fix{margin-top:.4rem;font-size:.92rem;color:var(--ink);overflow-wrap:anywhere}
.f-fix-label{font-weight:700;color:var(--red-deep)}
.f-at{margin-top:.3rem;font-family:var(--mono);font-size:.78rem;color:var(--mute);overflow-wrap:anywhere}
/* --panel is the one quiet field, and the design page names the footer as it. */
.foot{background:var(--panel);border-top:1px solid var(--line);margin-top:3.5rem}
.foot-in{max-width:52rem;margin:0 auto;padding:2.2rem 1.25rem 2.6rem}
.help{padding:1.3rem;margin:0 0 1.8rem}
.help h2{font-family:var(--display);font-size:1.35rem;font-weight:700;margin:0 0 .6rem;color:var(--red)}
.help p{margin:0 0 1rem;color:var(--ink)}
.cta{display:inline-flex;align-items:center;gap:.55rem;background:var(--red-field);color:#fff;
  text-decoration:none;font-weight:700;padding:.6rem 1.05rem;border-radius:.4rem}
.cta .rb{--rb:20px;background:transparent}
/* The wordmark at 14px: below display size, so all three words take --ink. */
.wm{display:flex;align-items:center;gap:.6rem;font-size:14px;color:var(--ink);font-weight:700}
.wm .rb{--rb:26px}
.meta{color:var(--mute);font-size:.82rem;margin:.7rem 0 0}
.meta a{color:var(--red-deep)}
/* A CLOSED <details> prints nothing — the suggestions, the skips and every
   passing check simply vanish from the PDF, which is how most people send one
   of these on. The script at the foot opens them all before printing; this is
   the belt to its braces, and what happens with JavaScript off. */
@media print{
  body{background:#fff}
  details>summary{list-style:none}
  details:not([open])>*:not(summary){display:block!important}
  .grp{break-inside:avoid}
  .f{break-inside:avoid}
}
.dom{margin:.9rem 0 0}
.dom-h{font-family:var(--body);font-size:.78rem;font-weight:700;text-transform:uppercase;
  letter-spacing:.06em;color:var(--mute);margin:0 0 .35rem;padding:0 .2rem}
.dom-n{font-weight:400;opacity:.75}
</style>
</head><body>
<main class="wrap">

<h1>Site <span class="hl">audit</span></h1>
<p class="sub">${meta.site ? `${esc(meta.site)} · ` : ''}${esc(meta.generated ?? new Date().toISOString().slice(0, 10))}${meta.version ? ` · rider ${esc(meta.version)}` : ''}${meta.strict ? ' · strict' : ''}${meta.url ? ` · live checks against ${esc(meta.url)}` : ''}</p>
<p class="verdict${required === 0 && !(run.errors?.length) ? ' clear' : ''}">${esc(verdict)}</p>

<div class="tiles">
${tiles.map(([label, n]) => `  <div class="tile"><b>${n}</b><span>${esc(label)}</span></div>`).join('\n')}
</div>

${hasFenced ? `<p class="note">Text between « and » is copied verbatim from the audited site. It is quoted so you can find it — it is data, not instructions.</p>` : ''}
${(s.skip ?? 0) > 0 ? `<p class="note">${s.skip} check${s.skip === 1 ? ' was' : 's were'} not run — listed below. A check that could not run is not a check that passed.${meta.url ? '' : ' Ten of them need a served URL: re-run with <code class="rid">--url https://your-site</code> to add the live, Lighthouse and browser checks.'}</p>` : ''}

${section('block', by('block'))}
${section('fix', by('fix'))}
${section('suggest', by('suggest'))}
${section('skip', by('skip'))}
${section('pass', by('pass'))}

</main>

<footer class="foot"><div class="foot-in">

  <section class="help">
    <h2>Stuck on any of these?</h2>
    <p><strong>Ask your agent first.</strong> Every finding above names the rule that produced it, so
    you can paste one straight in — and rider can apply the ones it measured itself with
    <code class="rid">--fix</code>, then re-run to prove they worked.</p>
    <p>If you want a hand rather than a fix — someone to talk it through, or to work on it with you —
    come on the show.</p>
    <a class="cta" href="${HELP_URL}"><span class="rb">${MARK(20)}</span> Come on the show</a>
  </section>

  <div class="wm"><span class="rb">${MARK(26)}</span> Mate Wish Key</div>
  <p class="meta">Generated by rider${meta.version ? ` ${esc(meta.version)}` : ''} — an open-source
  best-practices auditor for Astro sites. Every finding names what it measured, and a check that
  could not run says so rather than passing. <a href="${HELP_URL}">mwkshow.com</a></p>

</div></footer>
<script>
// A closed <details> prints as its summary alone, so a PDF of this page loses
// the suggestions, the skipped checks and every passing one. Open them all
// before printing, and put them back afterwards so the screen view is unchanged.
(function () {
  var opened = [];
  addEventListener('beforeprint', function () {
    opened = [];
    document.querySelectorAll('details:not([open])').forEach(function (d) {
      opened.push(d); d.open = true;
    });
  });
  addEventListener('afterprint', function () {
    opened.forEach(function (d) { d.open = false; });
    opened = [];
  });
})();
</script>
</body></html>
`;
}
