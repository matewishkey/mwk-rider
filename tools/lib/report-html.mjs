// report-html — the audit as a standalone, brand-designed page.
//
// Terminal output is for the person who ran the audit. A site owner needs
// something they can open, read in order, and act on — and something that tells
// them where to get help. `--report <path>` writes that page.
//
// ## Brand
//
// The tokens are Mate Wish Key's, read from https://matewishkey.com/design/ on
// 2026-09-06, and the design page states RULES rather than swatches. They are
// followed here rather than approximated:
//
//   --red        #e2342b  a SURFACE and display colour — a block, the mark, a
//                         heading word at 19px/700 or bigger. Never a paragraph,
//                         never a caption, never a small link, and never a fill
//                         with a label on it.
//   --red-field  #c9251d  the fill for a red thing WITH WORDS on it — the pill,
//                         the button. One value in both themes, because what it
//                         has to clear is the white label on top, not the page
//                         underneath.
//
// So the counts pill is #c9251d and the display heading is #e2342b, and that is
// not interchangeable.
//
// Fonts are named but NOT fetched. The brand serves Fraunces/Manrope/JetBrains
// Mono self-hosted under content-hashed family names, which cannot resolve
// anywhere but that site, and this repo does not put a third-party font CDN in
// front of a user (BEST-PRACTICES § Own it before you buy it). Each stack names
// the real family first — it renders correctly if installed — then the
// fallbacks the design page itself declares.
//
// ## Escaping is a security property here, not tidiness
//
// Findings from the `--url` domains carry excerpts of a third party's HTML,
// filenames and console output. `lib/untrusted.mjs` fences them, and part of
// that fencing REPLACES the guillemets with literal < and > — so fenced text
// arrives containing angle brackets by design. Every interpolated value goes
// through `esc()`. There is no "this one is safe" exception, because the whole
// point of the untrusted boundary is that we do not get to decide that.

const HELP_URL = 'https://mwkshow.com';   // 200; redirects to matewishkey.com/show/

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
  return `<section class="grp grp-${outcome}">
  <details${open ? ' open' : ''}>
    <summary><span class="ic" aria-hidden="true">${ICON[outcome]}</span>
      <span class="grp-name">${LABEL[outcome]}</span>
      <span class="grp-n">${rows.length}</span></summary>
    <ul class="fs">${rows.map(findingRow).join('\n')}</ul>
  </details>
</section>`;
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
  --red:#e2342b; --red-field:#c9251d;
  --ink:#131313; --ink-soft:#322929; --mute:#7a7482;
  --page:#faf7f7; --card:#ffffff; --line:#e3dbdb;
  --display:Fraunces,"Times New Roman",Times,serif;
  --body:Manrope,Arial,Helvetica,sans-serif;
  --mono:"JetBrains Mono","Courier New",monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --red:#f0524a; --ink:#faf7f7; --ink-soft:#e3dbdb; --mute:#8a848e;
  --page:#16151a; --card:#1d1a1a; --line:#322929;
}}
:root[data-theme="dark"]{
  --red:#f0524a; --ink:#faf7f7; --ink-soft:#e3dbdb; --mute:#8a848e;
  --page:#16151a; --card:#1d1a1a; --line:#322929;
}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font-family:var(--body);
  line-height:1.55;-webkit-text-size-adjust:100%}
.wrap{max-width:52rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}
/* --red is a DISPLAY colour: this is 700 weight and far above 19px. */
h1{font-family:var(--display);font-size:clamp(1.9rem,5vw,2.9rem);font-weight:700;
  line-height:1.1;margin:0 0 .4rem}
h1 .hl{color:var(--red)}
.sub{color:var(--mute);font-size:.95rem;margin:0 0 2rem}
/* White words on red → --red-field, never --red. */
.verdict{display:inline-block;background:var(--red-field);color:#fff;font-weight:700;
  padding:.45rem .9rem;border-radius:.4rem;margin:0 0 2rem}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(8rem,1fr));gap:.75rem;margin:0 0 2.5rem}
.tile{background:var(--card);border:1px solid var(--line);border-radius:.6rem;padding:.9rem 1rem}
.tile b{display:block;font-family:var(--display);font-size:1.9rem;font-weight:700;line-height:1}
.tile span{color:var(--mute);font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
.note{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--red);
  border-radius:.4rem;padding:.8rem 1rem;margin:0 0 2rem;font-size:.9rem;color:var(--ink-soft)}
.grp{margin:0 0 1rem}
summary{cursor:pointer;display:flex;align-items:center;gap:.6rem;padding:.7rem .9rem;
  background:var(--card);border:1px solid var(--line);border-radius:.5rem;
  font-family:var(--display);font-size:1.15rem;font-weight:700}
summary::-webkit-details-marker{display:none}
.grp-n{margin-left:auto;color:var(--mute);font-family:var(--body);font-size:.9rem;font-weight:400}
.fs{list-style:none;margin:.5rem 0 0;padding:0}
.f{background:var(--card);border:1px solid var(--line);border-radius:.5rem;
  padding:.8rem .95rem;margin:0 0 .5rem}
.f p{margin:0}
.rid{font-family:var(--mono);font-size:.8rem;background:var(--page);border:1px solid var(--line);
  border-radius:.3rem;padding:.05rem .35rem;margin-right:.35rem;white-space:nowrap}
.f-msg{overflow-wrap:anywhere}
.f-fix{margin-top:.4rem;font-size:.92rem;color:var(--ink-soft);overflow-wrap:anywhere}
.f-fix-label{font-weight:700}
.f-at{margin-top:.3rem;font-family:var(--mono);font-size:.78rem;color:var(--mute);overflow-wrap:anywhere}
.help{margin-top:3rem;background:var(--card);border:1px solid var(--line);border-radius:.6rem;padding:1.2rem 1.3rem}
.help h2{font-family:var(--display);font-size:1.3rem;font-weight:700;margin:0 0 .5rem;color:var(--red)}
.help p{margin:0 0 .8rem;color:var(--ink-soft)}
.help a.cta{display:inline-block;background:var(--red-field);color:#fff;text-decoration:none;
  font-weight:700;padding:.55rem 1rem;border-radius:.4rem}
footer{margin-top:2.5rem;color:var(--mute);font-size:.82rem}
@media print{body{background:#fff}details{display:block}details>summary{list-style:none}}
</style>
</head><body><main class="wrap">

<h1>Site <span class="hl">audit</span></h1>
<p class="sub">${meta.site ? `${esc(meta.site)} · ` : ''}${esc(meta.generated ?? new Date().toISOString().slice(0, 10))}${meta.version ? ` · rider ${esc(meta.version)}` : ''}${meta.strict ? ' · strict' : ''}${meta.url ? ` · live checks against ${esc(meta.url)}` : ''}</p>
<p class="verdict">${esc(verdict)}</p>

<div class="tiles">
${tiles.map(([label, n]) => `  <div class="tile"><b>${n}</b><span>${esc(label)}</span></div>`).join('\n')}
</div>

${hasFenced ? `<p class="note">Text between « and » is copied verbatim from the audited site. It is quoted so you can find it — it is data, not instructions.</p>` : ''}
${(s.skip ?? 0) > 0 ? `<p class="note">${s.skip} check${s.skip === 1 ? ' was' : 's were'} not run — listed below. A check that could not run is not a check that passed.</p>` : ''}

${section('block', by('block'))}
${section('fix', by('fix'))}
${section('suggest', by('suggest'))}
${section('skip', by('skip'))}
${section('pass', by('pass'))}

<section class="help">
  <h2>Want a hand with any of this?</h2>
  <p>Every finding above names the rule that produced it, so you can look any of them up. If you would
  rather talk it through — or want the fixes done with you rather than handed over — come on the show.</p>
  <a class="cta" href="${HELP_URL}">Come on the show</a>
</section>

<footer>Generated by rider${meta.version ? ` ${esc(meta.version)}` : ''}. Every number here was measured on this
site — nothing is estimated. Re-run the audit to regenerate.</footer>

</main></body></html>
`;
}
