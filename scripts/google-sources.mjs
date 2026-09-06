#!/usr/bin/env node
// google-sources — has Google moved under us?
//
// The tool calls a rule "universal" when ignoring it is a real defect on
// anyone's site, and for most of those the authority is a page on Google Search
// Central. Those pages change: FAQ rich results were retired, the favicon
// format list was rewritten, HowTo went away. A tool that encoded any of that
// and never re-read it would go on reporting the old rule with total confidence,
// which is the worst way to be wrong.
//
// So `docs/sources.json` records, for every such page, the `Last updated` date
// PRINTED ON IT and the date we read it. This script re-reads them and fails
// when a date has moved. That turns "we follow current Google practice" from a
// claim into something CI can refuse to let drift.
//
// It does not try to say WHAT changed — a diff of Google's prose is not a thing
// a script should judge. It says which page moved and which rules rest on it, so
// a human re-reads that one page rather than all sixteen.
//
//   node scripts/google-sources.mjs            # human table, exit 1 on drift
//   node scripts/google-sources.mjs --json     # for CI
//   node scripts/google-sources.mjs --accept   # record today's dates as read
//
// Zero dependencies, like everything else here.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../docs/sources.json', import.meta.url));
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const accept = args.includes('--accept');

// "Last updated 2026-08-28 UTC." — plain text in the rendered page, and the
// same string a reader sees at the foot of it. Deliberately not a meta tag:
// this must be the date the page SHOWS, or the record means something different
// from what a human would check.
const UPDATED_RE = /Last updated\s+(\d{4}-\d{2}-\d{2})\s+UTC/i;

const doc = JSON.parse(readFileSync(FILE, 'utf8'));
const today = new Date().toISOString().slice(0, 10);

/**
 * The date the page prints, with one retry.
 *
 * No custom user-agent, and that is not an oversight: developers.google.com
 * serves two variants of these pages, and the smaller one carries no "Last
 * updated" line at all. Which one you get moves with the UA — a browser string
 * got the date on one run and the dateless variant on the next — so the header
 * is left off and a miss is retried rather than believed. Measured 2026-09-06.
 */
async function fetchDate(url, attempt = 0) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const m = UPDATED_RE.exec(await res.text());
  if (m) return { updated: m[1] };
  // No date is not "unchanged" — the page may have been restructured, or
  // replaced by a redirect to a removal notice, which is exactly the event this
  // script exists to catch. But it is also what the dateless variant looks
  // like, so ask twice before saying so.
  if (attempt < 5) {
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    return fetchDate(url, attempt + 1);
  }
  return { error: 'no "Last updated" date on the page after 6 tries' };
}

const rows = [];
for (const s of doc.sources) {
  let got;
  try { got = await fetchDate(s.url); }
  catch (e) { got = { error: e.message }; }
  rows.push({
    slug: s.slug,
    url: s.url,
    recorded: s.updated,
    found: got.updated ?? null,
    error: got.error ?? null,
    moved: !!got.updated && got.updated !== s.updated,
    backs: s.backs,
  });
}

const moved = rows.filter((r) => r.moved);
const failed = rows.filter((r) => r.error);

if (asJson) {
  console.log(JSON.stringify({ read: doc.read, checked: today, moved, failed, rows }, null, 2));
} else {
  console.log(`${rows.length} Google Search Central page(s), last read ${doc.read}\n`);
  for (const r of rows) {
    const state = r.error ? `⚠  ${r.error}` : r.moved ? `→  MOVED ${r.recorded} → ${r.found}` : `ok ${r.recorded}`;
    console.log(`  ${r.slug.padEnd(28)} ${state}`);
    if (r.moved && r.backs.length) console.log(`     re-read, then confirm: ${r.backs.join(', ')}`);
  }
  console.log('');
  if (moved.length) {
    console.log(`${moved.length} page(s) changed since we read them. Re-read each, confirm the rules it`);
    console.log('backs still say what Google says, then run --accept to record the new date.');
  } else if (failed.length) {
    console.log(`${failed.length} page(s) could not be read — that is not "unchanged". Check by hand.`);
  } else {
    console.log('No page has changed since it was read.');
  }
}

if (accept) {
  for (const s of doc.sources) {
    const r = rows.find((x) => x.slug === s.slug);
    if (r?.found) s.updated = r.found;
  }
  doc.read = today;
  writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`);
  if (!asJson) console.log(`\nrecorded: docs/sources.json now says read ${today}.`);
}

process.exit(moved.length || failed.length ? 1 : 0);
