// fixer — apply the remedies a run produced, then PROVE it by re-running.
//
// The loop is the whole point. Anything can write a file; what makes this
// deterministic rather than hopeful is that the audit runs again afterwards and
// has to agree:
//
//   1. every finding we claimed to fix is gone, and
//   2. nothing required appeared that was not there before.
//
// Fail (2) and the whole set is reverted, byte for byte. A fix engine that can
// make a project worse and leave it that way is not worth having, and "it
// looked right in the diff" is how that happens.
//
// This is the same shape as tools/verify-example.mjs, which has been pointing
// the audit at our own examples since before there was anything to fix.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyRemedy, describeRemedy, revert } from './remedy.mjs';

const AUDIT = fileURLToPath(new URL('../audit.mjs', import.meta.url));

/**
 * Editing source makes an existing build stale — truthfully. `project:
 * dist:stale` firing after a fix is the tool being right, not a regression the
 * fix caused, so it is excluded from the regression set and reported as the
 * rebuild reminder it is. Without this carve-out, every source fix would look
 * like it had broken something and get reverted.
 */
const EXPECTED_AFTER_SOURCE_EDIT = new Set(['project/dist-stale']);

/** Findings whose remedy `--fix` should apply: the ones this run calls required. */
export function fixable(results) {
  return results.filter((r) => r.remedy && (r.outcome === 'fix' || r.outcome === 'block'));
}

export function runFix({ root, results, args, dryRun, json }) {
  const targets = fixable(results);
  const out = { attempted: targets.length, applied: [], skipped: [], fixed: [], unresolved: [], regressed: [], reverted: false };

  if (targets.length === 0) {
    const withRemedy = results.filter((r) => r.remedy).length;
    out.note = withRemedy
      ? `nothing required to fix — ${withRemedy} finding(s) carry a remedy but are advisory in this mode (try --strict --fix)`
      : 'nothing to fix — no finding in this run carries a machine-applicable remedy';
    return out;
  }

  if (dryRun) {
    out.plan = targets.map((t) => ({ id: t.id, change: describeRemedy(t.remedy) }));
    return out;
  }

  // --- apply -----------------------------------------------------------------
  const undo = [];
  for (const t of targets) {
    const res = applyRemedy(root, t.remedy);
    if (!res.ok) { out.skipped.push({ id: t.id, reason: res.reason }); continue; }
    undo.push(res);
    out.applied.push({ id: t.id, change: describeRemedy(t.remedy), file: res.file });
  }
  if (out.applied.length === 0) return out;

  // --- verify ----------------------------------------------------------------
  const before = requiredIds(results);
  const after = auditAgain(root, args);
  if (!after) {
    out.error = 're-audit did not produce readable JSON — nothing was reverted, but nothing was verified either';
    return out;
  }
  const afterIds = requiredIds(after);

  for (const t of targets) {
    if (!out.applied.some((a) => a.id === t.id)) continue;
    (afterIds.has(t.id) ? out.unresolved : out.fixed).push(t.id);
  }
  out.regressed = [...afterIds].filter((id) => !before.has(id) && !EXPECTED_AFTER_SOURCE_EDIT.has(id));
  out.rebuildNeeded = [...afterIds].some((id) => EXPECTED_AFTER_SOURCE_EDIT.has(id));

  if (out.regressed.length) {
    for (const u of undo) revert(root, u);
    out.reverted = true;
  }
  return out;
}

/** The ids this run treats as required — the set a fix must shrink and never grow. */
function requiredIds(results) {
  return new Set(results.filter((r) => r.outcome === 'fix' || r.outcome === 'block').map((r) => r.id));
}

/**
 * Re-run the audit as a fresh process, with the same flags minus the fixing
 * ones. A fresh process rather than calling the checks again in-band: the
 * project object, the source scan and the dist walk are all cached per run, and
 * a fix that changed a file on disk must be judged by something that never saw
 * the old bytes.
 */
function auditAgain(root, args) {
  const clean = args.filter((a) => !['--fix', '--dry-run', '--json', '--verbose'].includes(a));
  const r = spawnSync('node', [AUDIT, '--json', ...clean], { cwd: root, encoding: 'utf8' });
  try { return JSON.parse(r.stdout).results; } catch { return null; }
}

/** The human report. --json callers get the object above instead. */
export function printFixReport(out, { dryRun }) {
  if (out.note) { console.log(`\n${out.note}`); return; }

  if (dryRun) {
    console.log(`\n--dry-run: ${out.plan.length} change(s) this run would make, and nothing was written:`);
    for (const p of out.plan) console.log(`   ${p.id}\n     ${p.change}`);
    console.log('\nre-run with --fix to apply them; every one is re-checked afterwards.');
    return;
  }

  console.log(`\nfix: applied ${out.applied.length} of ${out.attempted} remedy(s)`);
  for (const a of out.applied) console.log(`   ${a.id}\n     ${a.change}`);
  for (const s of out.skipped) console.log(`   ⏭  ${s.id} — ${s.reason}`);

  if (out.error) { console.log(`\n   ⚠ ${out.error}`); return; }

  if (out.reverted) {
    console.log(`\n   ⚠ REVERTED — the re-audit reported ${out.regressed.length} new required finding(s) that were not there before:`);
    for (const id of out.regressed) console.log(`       ${id}`);
    console.log('   every file this run touched has been put back exactly as it was.');
    return;
  }
  if (out.fixed.length) console.log(`\n   verified fixed by re-audit: ${out.fixed.join(', ')}`);
  if (out.unresolved.length) console.log(`   still reported after the change: ${out.unresolved.join(', ')}`);
  if (out.rebuildNeeded) console.log('\n   source changed, so dist/ is now stale — rebuild before trusting any dist-reading check.');
}
