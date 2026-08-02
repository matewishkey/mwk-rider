// dist/ — read the build output. Several checks moved from "is the package
// installed / does the source mention it" to "did the build actually produce
// it", and they all need the same two primitives.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Files under dist/ whose dist-relative path matches, sorted. */
export function distFiles(root, re) {
  const dist = join(root, 'dist');
  if (!existsSync(dist)) return [];
  const out = [];
  const stack = [dist];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (re.test(relative(dist, full))) out.push(relative(dist, full));
    }
  }
  return out.sort();
}

/** Text of a dist-relative file, or '' if it can't be read. */
export function readDist(root, rel) {
  try { return readFileSync(join(root, 'dist', rel), 'utf8'); }
  catch { return ''; }
}

export function countMatches(text, re) {
  return (text.match(re) ?? []).length;
}
