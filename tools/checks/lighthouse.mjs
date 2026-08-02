// lighthouse — real measured scores via the PageSpeed Insights API.
//
// Runs only with --url (it audits a served URL, not local source). Where the
// static checks confirm "is it wired right?", this answers "what's the real
// score?" — Performance/SEO/Accessibility/Best-Practices + Core Web Vitals.
//
// Needs a free PSI API key, resolved in order:
//   1. $PAGESPEED_API_KEY
//   2. sops-decrypted from $TD_RIDER_PSI_SOPS_FILE (key PAGESPEED_API_KEY)
// Without a key it skips gracefully (the tool still works for everything else).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SEC = 'lighthouse';

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
    reporter.skip(SEC, 'psi', 'no PageSpeed Insights key — set $PAGESPEED_API_KEY or point $TD_RIDER_PSI_SOPS_FILE at a sops-encrypted env file. Skipping real-metric audit.');
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

  const le = data.loadingExperience;
  if (le?.metrics && Object.keys(le.metrics).length) {
    reporter.pass(SEC, 'crux:field-data', `real-user data present (overall ${le.overall_category ?? 'n/a'})`);
  } else {
    reporter.skip(SEC, 'crux:field-data', 'no real-user (CrUX) field data — lab only (site lacks enough traffic)');
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
    try { res = await fetch(api); }
    catch (e) { reporter.skip(SEC, 'psi', `network error reaching PSI: ${e.message}`); return null; }
    if (res.ok) {
      try { return await res.json(); }
      catch { reporter.skip(SEC, 'psi', 'PSI returned invalid JSON'); return null; }
    }
    if (res.status === 500 && attempt < 3) { await sleep(5000); continue; } // transient lighthouseError
    if (res.status === 429) { reporter.skip(SEC, 'psi', 'PSI quota exceeded (429) — retry later or check the key quota'); return null; }
    if (res.status === 403) { reporter.skip(SEC, 'psi', 'PSI rejected the key (403) — verify the key + that the PageSpeed Insights API is enabled'); return null; }
    reporter.skip(SEC, 'psi', `PSI HTTP ${res.status}${attempt >= 3 ? ' (after retries)' : ''}`); return null;
  }
  reporter.skip(SEC, 'psi', 'PSI failed after 3 attempts (transient lighthouseError) — try again'); return null;
}

function resolveKey() {
  if (process.env.PAGESPEED_API_KEY?.trim()) return process.env.PAGESPEED_API_KEY.trim();
  // Opt-in only: no default path. Point $TD_RIDER_PSI_SOPS_FILE at a sops-encrypted
  // env file holding PAGESPEED_API_KEY, or leave it unset and this domain skips.
  const file = process.env.TD_RIDER_PSI_SOPS_FILE;
  if (!file || !existsSync(file) || !hasSops()) return null;
  const env = { ...process.env };
  if (!env.SOPS_AGE_KEY_FILE) {
    const k = join(homedir(), '.config', 'sops', 'age', 'keys.txt');
    if (existsSync(k)) env.SOPS_AGE_KEY_FILE = k;
  }
  const r = spawnSync('sops', ['-d', '--extract', '["PAGESPEED_API_KEY"]', file], { encoding: 'utf8', env });
  return r.status === 0 && r.stdout?.trim() ? r.stdout.trim() : null;
}

function hasSops() {
  const r = spawnSync('sops', ['--version'], { encoding: 'utf8' });
  return r.status === 0 || (r.stdout || '').length > 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
