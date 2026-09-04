// remedy — the machine-applicable half of a finding.
//
// A finding's `fix` field is prose: "emit og:title from the component that
// renders <head>". A human reads that and knows what to do; an agent reads it,
// interprets it, and improvises — differently on each run. That improvisation,
// not the file write, is where determinism is actually lost, and it happens
// before anything is written to disk.
//
// So a check that KNOWS the exact edit attaches it here, as data. The prose
// stays (it is what a human reads); the remedy is what a machine applies, and
// what `--fix` verifies by re-running the audit afterwards.
//
// THE BAR FOR ATTACHING ONE: the fix must be fully determined by what the check
// already measured. `perf: cls:img-dimensions` qualifies — the width and height
// are read out of the image's own bytes, so there is one correct answer and the
// tool already computed it. `images: alt` does not, and never will: no amount of
// analysis tells you what the alt text should say. A remedy that guesses is
// worse than no remedy, because it looks like the tool knew.
//
// Three kinds, deliberately few. Each is verifiable by inspection, needs no
// parser, and keeps this file dependency-free like the rest of the tool.

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The bundled starter, which is the reference implementation of every artifact
 * the baseline asks for. It ships INSIDE the plugin (see CLAUDE.md), so this
 * resolves in an installed copy exactly as it does in the working tree.
 */
export const STARTER = fileURLToPath(new URL('../../examples/starter/', import.meta.url));

/**
 * Copy a file out of the starter. Create-only, never overwrite — a `copy`
 * remedy exists for an artifact that is MISSING, and if something is already
 * there the tool has no business deciding whose version wins.
 *
 * Only for files with no coupling to the project around them. Most of the
 * starter's endpoints import `og.config.mjs`, `src/lib/posts` or a layout, so
 * transplanting one would produce a file that does not build — deterministic
 * and useless. `public/_headers` is pure static text and imports nothing.
 */
export const copyFromStarter = (from, to = from) => ({ kind: 'copy', from, to });

/** Set one key in a JSON file, by path. Indentation is preserved, not guessed. */
export const setJson = (file, path, value) => ({ kind: 'json', file, path, value });

/**
 * Replace an exact string, which must occur EXACTLY ONCE in the file.
 *
 * Once, not "the first one": a check reports a finding per occurrence, and a
 * first-match replace applied to three identical `<img>` tags would fix one and
 * silently report the other two as done. Ambiguity is a refusal here.
 */
export const editFile = (file, find, replace) => ({ kind: 'edit', file, find, replace });

/** One line, for --dry-run and for the human log. */
export function describeRemedy(r) {
  switch (r.kind) {
    case 'copy': return `create ${r.to} (from the bundled starter)`;
    case 'json': return `${r.file}: set ${r.path.join('.')} = ${JSON.stringify(r.value)}`;
    case 'edit': return `${r.file}: ${short(r.find)} → ${short(r.replace)}`;
    default:     return `unknown remedy kind ${r.kind}`;
  }
}

const short = (s) => {
  const one = String(s).replace(/\s+/g, ' ').trim();
  return one.length > 72 ? `${one.slice(0, 71)}…` : one;
};

/**
 * Apply one remedy. Returns what happened, and — the part that matters —
 * `before`, so the driver can put the file back exactly as it was when the
 * re-audit says the change made things worse.
 *
 * Never throws. A remedy that cannot be applied cleanly is reported as skipped
 * with a reason, because the alternative is a half-applied fix set.
 */
export function applyRemedy(root, r) {
  try {
    switch (r.kind) {
      case 'copy':   return applyCopy(root, r);
      case 'json':   return applyJson(root, r);
      case 'edit':   return applyEdit(root, r);
      default:       return { ok: false, reason: `unknown remedy kind '${r.kind}'` };
    }
  } catch (e) {
    return { ok: false, reason: `${r.kind} failed: ${e.message}` };
  }
}

function applyCopy(root, r) {
  const src = join(STARTER, r.from);
  const dest = join(root, r.to);
  if (!existsSync(src)) return { ok: false, reason: `the bundled starter has no ${r.from}` };
  if (existsSync(dest)) return { ok: false, reason: `${r.to} already exists — a copy remedy never overwrites` };
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return { ok: true, file: r.to, before: null, created: true };
}

function applyJson(root, r) {
  const path = join(root, r.file);
  if (!existsSync(path)) return { ok: false, reason: `${r.file} does not exist` };
  const before = readFileSync(path, 'utf8');
  const data = JSON.parse(before);
  // Walk to the parent, creating plain objects on the way. Anything already
  // there that is not an object is left alone and the remedy refuses: the file
  // is not shaped the way the check assumed, and overwriting is how you delete
  // someone's config.
  let node = data;
  for (const key of r.path.slice(0, -1)) {
    if (node[key] == null) node[key] = {};
    else if (typeof node[key] !== 'object' || Array.isArray(node[key])) {
      return { ok: false, reason: `${r.file}: ${key} is not an object` };
    }
    node = node[key];
  }
  const leaf = r.path.at(-1);
  // An array value MERGES rather than replaces — `exclude: ["dist"]` must not
  // delete the entries a project already had there.
  if (Array.isArray(r.value)) {
    const current = Array.isArray(node[leaf]) ? node[leaf] : [];
    node[leaf] = [...current, ...r.value.filter((v) => !current.includes(v))];
  } else {
    node[leaf] = r.value;
  }
  const after = `${JSON.stringify(data, null, detectIndent(before))}\n`;
  if (after === before) return { ok: false, reason: `${r.file} already has that value` };
  writeFileSync(path, after);
  return { ok: true, file: r.file, before };
}

// The file's own indentation, so a two-space project does not come back
// four-space with every line in the diff.
function detectIndent(text) {
  const m = text.match(/\n([ \t]+)\S/);
  if (!m) return 2;
  return m[1][0] === '\t' ? '\t' : m[1].length;
}

function applyEdit(root, r) {
  const path = join(root, r.file);
  if (!existsSync(path)) return { ok: false, reason: `${r.file} does not exist` };
  const before = readFileSync(path, 'utf8');
  const hits = before.split(r.find).length - 1;
  if (hits === 0) return { ok: false, reason: `${r.file} no longer contains the text this finding was written against` };
  if (hits > 1) return { ok: false, reason: `${r.file} contains that text ${hits} times — too ambiguous to edit safely` };
  writeFileSync(path, before.replace(r.find, r.replace));
  return { ok: true, file: r.file, before };
}

/** Put a file back exactly as it was — or delete it, if the remedy created it. */
export function revert(root, { file, before }) {
  const path = join(root, file);
  try {
    // `before: null` means the remedy CREATED the file — putting it back means
    // deleting it, not truncating it. An empty public/_headers is not the state
    // we found the project in, and it would pass no check that the missing file
    // failed.
    if (before == null) { rmSync(path, { force: true }); return; }
    writeFileSync(path, before);
  } catch { /* best effort: the report already names what was touched */ }
}
