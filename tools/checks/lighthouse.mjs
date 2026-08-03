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
  reportDiagnostics(lr, reporter, strategy);

  const le = data.loadingExperience;
  if (le?.metrics && Object.keys(le.metrics).length) {
    reporter.pass(SEC, 'crux:field-data', `real-user data present (overall ${le.overall_category ?? 'n/a'})`);
  } else {
    reporter.skip(SEC, 'crux:field-data', 'no real-user (CrUX) field data — lab only (site lacks enough traffic)');
  }
}

/**
 * What the score *means* — the three facts that make a stuck number readable.
 *
 * A single Performance score is not diagnosable, and treating a bad one as lab
 * noise is a real failure mode: cypruspokerbrisbane's 5.5 s LCP was dismissed as
 * a harness artifact when the cause was a 360 KB Maps iframe. Pulling the full
 * PSI JSON settled it in one read, so the three fields that settled it are now
 * reported rather than discarded:
 *
 *   - **the LCP element** — what the score is actually waiting for;
 *   - **the heaviest third-party origins** — weight the site owner did not write,
 *     and the usual answer when TTFB is ~0 ms and FCP is still high (blocked by
 *     payload, not by the server);
 *   - **observed vs simulated** — the tell for the opposite case. A completed
 *     load with an idle main thread but a late *observed* paint is harness
 *     variance, and the proof is that observed FCP got slower after the page got
 *     lighter.
 *
 * All three are advisory: they are facts about the run, not verdicts.
 *
 * **Audit ids are read under both the current and the legacy names.** Lighthouse
 * renamed this family to `*-insight`, and PSI serves whatever its deployed
 * Lighthouse emits — measured 2026-08-03, a live run returned
 * `lcp-discovery-insight` / `lcp-breakdown-insight` / `third-parties-insight`
 * and none of the older ids. Reading only one set is how a diagnosis silently
 * becomes a permanent `⏭`, which is indistinguishable from "this page is fine".
 */
export function reportDiagnostics(lr, reporter, strategy = 'mobile') {
  const audits = lr?.audits ?? {};

  const node = lcpElement(audits);
  if (node) {
    // The discovery insight also checks the three things that make an LCP image
    // slow for reasons unrelated to its bytes. They come back as a checklist of
    // pass/fail with their own labels, so failures are quoted rather than
    // re-worded — Lighthouse's phrasing is the authority on its own check.
    const failed = lcpChecklistFailures(audits);
    reporter.suggest(
      SEC,
      `lcp:element (${strategy})`,
      `LCP element: ${truncate(node, 120)}${failed.length ? ` — failing: ${failed.join('; ')}` : ''}`,
      failed.length
        ? 'fix the failing checks above first: they delay the LCP image regardless of how small it is'
        : 'this is the thing the LCP number is waiting for — preload it, size it correctly, and keep it out of a lazy-loaded container',
    );
  } else {
    reporter.skip(SEC, `lcp:element (${strategy})`, 'PSI reported no LCP element for this run');
  }

  const third = thirdParties(audits);
  if (third.length === 0) {
    reporter.skip(SEC, `third-party:payload (${strategy})`, 'PSI reported no third-party payload on this page');
  } else {
    const shown = third.map((i) => `${i.entity} ${Math.round(i.bytes / 1024)} KB${i.blocking >= 50 ? ` (${Math.round(i.blocking)} ms main thread)` : ''}`).join(', ');
    reporter.suggest(SEC, `third-party:payload (${strategy})`, `heaviest third parties: ${shown}`, 'weight you did not write, on the critical path — a facade or a deferred loader usually removes it entirely');
  }

  // PSI reports both the simulated metric (the score) and what the run actually
  // observed. They disagreeing is information, not an error.
  const m = audits.metrics?.details?.items?.[0];
  if (!m || m.observedFirstContentfulPaint == null) {
    reporter.skip(SEC, `metrics:observed (${strategy})`, 'PSI returned no observed metrics alongside the simulated ones');
    return;
  }
  const pairs = [
    ['FCP', audits['first-contentful-paint']?.numericValue, m.observedFirstContentfulPaint],
    ['LCP', audits['largest-contentful-paint']?.numericValue, m.observedLargestContentfulPaint],
  ].filter(([, sim, obs]) => sim != null && obs != null);
  const shown = pairs.map(([l, sim, obs]) => `${l} ${Math.round(sim)} ms simulated / ${Math.round(obs)} ms observed`).join(', ');
  reporter.suggest(
    SEC,
    `metrics:observed (${strategy})`,
    shown || 'no comparable simulated/observed pair',
    'read them together before acting: ~0 ms TTFB with a high FCP means the render is blocked by payload, while a completed load with a late *observed* paint is usually harness variance rather than the page',
  );
}

/**
 * The LCP element's markup, whichever audit this Lighthouse version emits.
 *
 * The insight audits carry it as one entry in a mixed `details.items` list —
 * alongside a checklist or a subpart table — so the element is found by looking
 * for the entry that *has* a snippet rather than by position. The legacy audit
 * nested it under `item.node`.
 */
function lcpElement(audits) {
  for (const id of ['lcp-discovery-insight', 'lcp-breakdown-insight', 'largest-contentful-paint-element']) {
    for (const item of audits[id]?.details?.items ?? []) {
      const node = item?.node ?? item;
      const snippet = node?.snippet ?? node?.selector ?? null;
      if (snippet) return snippet;
    }
  }
  return null;
}

/** Labels of the failing entries in the LCP-discovery checklist, if there is one. */
function lcpChecklistFailures(audits) {
  for (const item of audits['lcp-discovery-insight']?.details?.items ?? []) {
    if (item?.type !== 'checklist' || !item.items) continue;
    return Object.values(item.items)
      .filter((c) => c && c.value === false && c.label)
      .map((c) => c.label);
  }
  return [];
}

/** The heaviest third-party entities, largest first. */
function thirdParties(audits) {
  for (const id of ['third-parties-insight', 'third-party-summary']) {
    const rows = (audits[id]?.details?.items ?? [])
      // `mainThreadTime` is the current field; `blockingTime` was the legacy one.
      .map((i) => ({ entity: nameOf(i.entity), bytes: i.transferSize ?? 0, blocking: i.mainThreadTime ?? i.blockingTime ?? 0 }))
      .filter((i) => i.entity && i.bytes > 0)
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 3);
    if (rows.length) return rows;
  }
  return [];
}

// PSI has returned `entity` as both a string and an object across versions.
function nameOf(entity) {
  return typeof entity === 'string' ? entity : entity?.text ?? entity?.name ?? null;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
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
