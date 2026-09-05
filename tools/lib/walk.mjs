// walk — one directory traversal, for the eight that used to be written out.
//
// Every consumer wanted the same thing: descend a tree, skip some names, hand
// back the files. The traversal was open-coded in `lib/dist.mjs`, `lib/html.mjs`,
// `lib/src-scan.mjs`, `checks/images.mjs` and `checks/perf.mjs`, plus inline
// loops elsewhere — identical apart from which names they skip and what they do
// with a file.
//
// Two details are load-bearing and were already right in all of them, which is
// exactly why they should only exist once:
//
//   - an unreadable directory is SKIPPED, not fatal. A build tree can contain a
//     symlink to nowhere or a directory the auditor cannot enter, and an audit
//     that throws there tells the user nothing about their site.
//   - the skip test runs BEFORE the directory/file split, so a skipped
//     directory is never descended — that is what keeps `node_modules` out, and
//     it is a traversal cost, not just a filter.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Yield the absolute path of every file under `base`, depth-first.
 *
 * `skip(name, entry)` is called for each entry before it is classified; return
 * true to leave it out — and, for a directory, to not descend into it. A
 * missing `base` yields nothing rather than throwing, because "the site has no
 * dist/" is a normal state this tool reports on, not an error.
 */
export function* walkFiles(base, { skip } = {}) {
  if (!existsSync(base)) return;
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (skip?.(entry.name, entry)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else yield full;
    }
  }
}
