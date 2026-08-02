// analytics — privacy-respecting analytics delivery.
//
// The baseline promotes Cloudflare Zaraz as the analytics layer: Zaraz loads
// Google Analytics (and Cloudflare's own analytics) at the edge and gates them
// behind its Consent Management Platform — the cookie banner. Because Zaraz is
// configured in the Cloudflare dashboard and injected at the edge, its presence
// is only visible at serve time (see live.mjs `auditAnalytics`, run with --url).
//
// What an OFFLINE scan CAN do is flag the anti-pattern Zaraz replaces: a Google
// Analytics / Tag Manager snippet hardcoded into the source or built HTML. A raw
// snippet fires without consent and bypasses Zaraz entirely, so finding one means
// analytics is shipped outside the consent CMP.
//
// The Zaraz loader (/cdn-cgi/zaraz/) is serve-time-only and lives in live.mjs: it's
// edge-injected, so it's invisible to this source/dist scan and only checkable with
// --url.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { eachDistHtml } from '../lib/html.mjs';

const SEC = 'analytics';

// Markdown is prose: a post that *writes about* gtag() is not a site that ships
// it. Only files that can actually emit a script tag are scanned.
const SCAN_EXTS = new Set(['.astro', '.tsx', '.jsx', '.ts', '.js', '.html']);

// Hardcoded Google Analytics / Tag Manager signals — each is something Zaraz is
// meant to load on your behalf, behind consent. (No bare `G-…` id match: too
// false-positive-prone; the gtag.js loader and gtag() call cover GA4.)
const GA_SIGNALS = [
  [/googletagmanager\.com\/gtag\/js/i,            'gtag.js loader (GA4)'],
  [/googletagmanager\.com\/gtm\.js/i,             'gtm.js container loader'],
  [/google-analytics\.com\/(?:analytics|ga)\.js/i, 'legacy analytics.js'],
  [/\bgtag\s*\(/,                                  'gtag() call'],
  [/\bga\s*\(\s*['"]create['"]/,                   'legacy ga("create")'],
  [/['"]GTM-[A-Z0-9]{4,}['"]/,                     'GTM container id'],
  [/['"]UA-\d{4,}-\d+['"]/,                         'Universal Analytics id'],
];

export async function run({ project, reporter }) {
  const hits = [];
  const seen = new Set();
  const record = (where, label) => {
    const key = `${where}::${label}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ where, label });
  };

  let scanned = 0;
  walkSource(project.root, (relPath) => {
    if (!SCAN_EXTS.has(extname(relPath).toLowerCase())) return;
    let text;
    try { text = readFileSync(join(project.root, relPath), 'utf8'); }
    catch { return; }
    scanned++;
    for (const [re, label] of GA_SIGNALS) {
      if (re.test(text)) record(relPath, label);
    }
  });

  if (project.hasDist) {
    eachDistHtml(project.root, (rel, html) => {
      scanned++;
      for (const [re, label] of GA_SIGNALS) {
        if (re.test(html)) record(rel, label);
      }
    });
  }

  if (scanned === 0) {
    // A project with no scannable source and no dist/ used to report ✅ — a
    // clean bill of health for a scan that opened nothing.
    reporter.skip(SEC, 'no-hardcoded-ga', 'no scannable source files and no dist/ — nothing was read, so this is not a pass');
  } else if (hits.length === 0) {
    reporter.pass(SEC, 'no-hardcoded-ga', `no hardcoded Google Analytics / GTM snippet in ${scanned} file(s) — analytics should be delivered via Cloudflare Zaraz at the edge (verify the loader on --url)`);
  } else {
    const sample = hits.slice(0, 3).map((h) => `${h.label} in ${h.where}`).join('; ');
    reporter.fix(SEC, 'no-hardcoded-ga', `${hits.length} hardcoded analytics signal(s) — ${sample}${hits.length > 3 ? ' …' : ''}`, 'load Google Analytics through Cloudflare Zaraz so the consent banner (CMP) gates it, instead of shipping a raw snippet that fires before consent');
  }
}

function walkSource(root, callback) {
  const src = join(root, 'src');
  if (!existsSync(src)) return;
  const stack = [src];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else callback(relative(root, full));
    }
  }
}
