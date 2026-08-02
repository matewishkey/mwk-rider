// lighthouse — real measured scores via the PageSpeed Insights API.
//
// Runs only with --url (it audits a served URL, not local source). Where the
// static checks confirm "is it wired right?", this answers "what's the real
// score?" — Performance/SEO/Accessibility/Best-Practices + Core Web Vitals.
//
// Needs a free PSI API key in $PAGESPEED_API_KEY. Without one it skips
// gracefully (the tool still works for everything else).

const SEC = 'lighthouse';
// No timeout meant a host that accepts the connection and never answers hung the
// whole audit — in CI, forever.
const NET_TIMEOUT_MS = 60_000;

const CATEGORIES = ['performance', 'seo', 'accessibility', 'best-practices'];
// Lab Core Web Vital proxies → [audit id, label, "good" threshold (numericValue)]
const CWV = [
  ['largest-contentful-paint', 'LCP', 2500],
  ['total-blocking-time', 'TBT', 200],   // lab proxy for INP
  ['cumulative-layout-shift', 'CLS', 0.1],
];

export async function run({ reporter, url, strategy = 'mobile' }) {
  const key = resolveKey();
  if (!key) {
    reporter.skip(SEC, 'psi', 'no PageSpeed Insights key — set $PAGESPEED_API_KEY (free: developers.google.com/speed/docs/insights/v5/get-started). Skipping real-metric audit.');
    return;
  }

  const data = await fetchPSI(url, strategy, key, reporter);
  if (!data) return;
  const lr = data.lighthouseResult;
  if (!lr) { reporter.skip(SEC, 'psi', 'PSI returned no lighthouseResult'); return; }

  for (const id of CATEGORIES) {
    const cat = lr.categories?.[id];
    if (!cat || cat.score == null) continue;
    const score = Math.round(cat.score * 100);
    const name = `${id} (${strategy})`;
    if (score >= 90) reporter.pass(SEC, name, String(score));
    else if (score >= 50) reporter.suggest(SEC, name, `score ${score}/100 — room to improve`, hint(id));
    else reporter.fix(SEC, name, `score ${score}/100 — poor`, hint(id));
  }

  for (const [id, label, good] of CWV) {
    const a = lr.audits?.[id];
    if (!a) continue;
    const shown = a.displayValue ?? String(a.numericValue);
    const unit = id === 'cumulative-layout-shift' ? '' : 'ms';
    if (a.numericValue != null && a.numericValue <= good) reporter.pass(SEC, `${label} (${strategy})`, shown);
    else reporter.suggest(SEC, `${label} (${strategy})`, `${shown} (target ≤ ${good}${unit})`, 'see the Performance opportunities in the PSI report');
  }

  reportA11yAudits(lr, reporter);

  const le = data.loadingExperience;
  if (le?.metrics && Object.keys(le.metrics).length) {
    reporter.pass(SEC, 'crux:field-data', `real-user data present (overall ${le.overall_category ?? 'n/a'})`);
  } else {
    reporter.skip(SEC, 'crux:field-data', 'no real-user (CrUX) field data — lab only (site lacks enough traffic)');
  }
}

// Cap the instances so one badly-themed site can't bury the rest of the audit.
const MAX_A11Y_FINDINGS = 10;

/**
 * The individual accessibility rules PSI failed.
 *
 * We were already requesting `category=accessibility` and keeping only the
 * score — 76 auditRefs came back on a real site and every failing rule was
 * thrown away. Colour contrast is the most common accessibility failure on the
 * web and the one thing a static checker genuinely cannot compute; PSI hands us
 * the answer for free.
 *
 * Severity uses Lighthouse's own weighting rather than ours: a weight-7 rule
 * (color-contrast) is a defect, a weight-1 rule is advice.
 */
function reportA11yAudits(lr, reporter) {
  const refs = lr.categories?.accessibility?.auditRefs ?? [];
  if (!refs.length) return;

  const failing = [];
  for (const ref of refs) {
    const a = lr.audits?.[ref.id];
    // score null = "not applicable" / informative, not a failure.
    if (!a || a.score == null || a.score >= 1) continue;
    failing.push({ id: ref.id, weight: ref.weight ?? 0, title: a.title, count: a.details?.items?.length ?? 0 });
  }

  if (failing.length === 0) {
    reporter.pass(SEC, 'a11y:audits', `all ${refs.length} PSI accessibility rules pass`, { id: 'lighthouse/a11y-audit' });
    return;
  }

  failing.sort((a, b) => b.weight - a.weight);
  for (const f of failing.slice(0, MAX_A11Y_FINDINGS)) {
    const where = f.count ? ` (${f.count} element${f.count === 1 ? '' : 's'})` : '';
    const at = { id: 'lighthouse/a11y-audit' };
    if (f.weight >= 3) reporter.fix(SEC, `a11y:${f.id}`, `${f.title}${where} — a failing rule behind the accessibility score above, which can still read ≥90 overall`, `open the PSI accessibility report for the failing elements (rule: ${f.id})`, at);
    else reporter.suggest(SEC, `a11y:${f.id}`, `${f.title}${where}`, `rule: ${f.id}`, at);
  }
  if (failing.length > MAX_A11Y_FINDINGS) {
    reporter.suggest(SEC, 'a11y:audits', `${failing.length - MAX_A11Y_FINDINGS} further accessibility rule(s) also fail — showing the ${MAX_A11Y_FINDINGS} heaviest`, 'see the full PSI accessibility report', { id: 'lighthouse/a11y-audit' });
  }
}

function hint(id) {
  switch (id) {
    case 'performance':   return 'open the PSI report for the specific opportunities (render-blocking resources, image sizing, server response, unused JS)';
    case 'seo':           return 'fix the SEO audits PSI flags (meta, crawlability, structured data)';
    case 'accessibility': return 'fix the a11y audits PSI flags (contrast, labels, alt text)';
    case 'best-practices':return 'fix the best-practices audits PSI flags (HTTPS, console errors, deprecated APIs)';
    default:              return 'see the PSI report';
  }
}

async function fetchPSI(url, strategy, key, reporter) {
  const cats = CATEGORIES.map((c) => 'category=' + c).join('&');
  const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&${cats}&key=${key}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try { res = await fetch(api, { signal: AbortSignal.timeout(NET_TIMEOUT_MS) }); }
    catch (e) { reporter.skip(SEC, 'psi', `network error reaching PSI: ${e.message}`); return null; }
    if (res.ok) {
      try { return await res.json(); }
      catch { reporter.skip(SEC, 'psi', 'PSI returned invalid JSON'); return null; }
    }
    if (res.status === 500 && attempt < 3) { await sleep(5000); continue; } // transient lighthouseError
    if (res.status === 429) { reporter.skip(SEC, 'psi', 'PSI quota exceeded (429) — retry later or check the key quota'); return null; }
    if (res.status === 403) { reporter.skip(SEC, 'psi', 'PSI rejected the key (403) — verify the key + that the PageSpeed Insights API is enabled'); return null; }
    if (res.status === 400) { reporter.skip(SEC, 'psi', 'PSI rejected the request (400) — usually an invalid $PAGESPEED_API_KEY, or a URL it cannot reach'); return null; }
    reporter.skip(SEC, 'psi', `PSI HTTP ${res.status}${attempt >= 3 ? ' (after retries)' : ''}`); return null;
  }
  return null;   // unreachable: every branch above returns
}

function resolveKey() {
  return process.env.PAGESPEED_API_KEY?.trim() || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
