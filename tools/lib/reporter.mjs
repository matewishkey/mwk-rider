// Reporter — collects check outcomes, formats output (human or JSON), sets exit code.
//
// Outcome vocabulary:
//   pass    ✅  compliant
//   fix     🔧  drift, mechanically fixable        (counts as a failure → exit 1)
//   block   🛑  needs a decision                   (counts as a failure → exit 1)
//   suggest 💡  optional / nice-to-have, not required (advisory → exit 0)
//   skip    ⏭  not run / not testable here

import { isHouseStyle } from './policy.mjs';

/**
 * Stable rule identifier — `section/name`, lowercased and hyphenated.
 *
 * `name` alone was never an identifier: it carried the subject and location
 * ("routed (src/pages/index.astro:140)"), so it varied per finding and nothing
 * could be suppressed, counted or referenced by rule. Both are separate fields
 * now, and the id is what you cite. Treat these as public API: renaming one
 * breaks anybody filtering on it.
 */
export function ruleId(section, name) {
  const base = String(name).replace(/\s*\(.*\)\s*$/, '');
  return `${slug(section)}/${slug(base)}`;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Where a finding is, for the human line: dist/index.html:12, or a URL live.
function where({ file, line, url } = {}) {
  if (file) return ` (${file}${line != null ? ':' + line : ''})`;
  if (url) return ` (${url})`;
  return '';
}

export class Reporter {
  constructor({ json = false, quiet = false, strict = false } = {}) {
    // Offline and live checks share section names (`images`, `perf`, `data`), so
    // section+name alone collides in --json. `source` tells the two apart.
    this.source = 'offline';
    this.json = json;
    this.quiet = quiet;
    this.strict = strict;
    this.results = [];
    this.errors = [];
  }

  // Outside --strict, a house-style finding is advice, not a defect: it becomes
  // 💡 and stops failing the run. See lib/policy.mjs for what counts and why.
  _demoted(section, name) {
    return !this.strict && isHouseStyle(section, name);
  }

  // Every outcome takes an optional trailing `at` — { file, line, url, id }.
  // `id` overrides the derived rule id; the rest locate the finding.
  pass(section, name, message = '', at = {}) {
    this._record({ section, name, outcome: 'pass', message }, at);
    if (!this.json && !this.quiet) {
      console.log(`✅ ${section}: ${name}${where(at)}${message ? ' — ' + message : ''}`);
    }
  }

  fix(section, name, message, fix, at = {}) {
    if (this._demoted(section, name)) return this.suggest(section, name, message, fix, { ...at, houseStyle: true });
    this._record({ section, name, outcome: 'fix', message, fix }, at);
    if (!this.json) {
      console.log(`🔧 ${section}: ${name}${where(at)} — ${message}`);
      if (fix) console.log(`     fix: ${fix}`);
    }
  }

  block(section, name, message, fix, at = {}) {
    if (this._demoted(section, name)) return this.suggest(section, name, message, fix, { ...at, houseStyle: true });
    this._record({ section, name, outcome: 'block', message, fix }, at);
    if (!this.json) {
      console.log(`🛑 ${section}: ${name}${where(at)} — ${message}`);
      if (fix) console.log(`     resolve: ${fix}`);
    }
  }

  suggest(section, name, message, suggestion, at = {}) {
    const houseStyle = at.houseStyle === true;
    this._record({ section, name, outcome: 'suggest', message, fix: suggestion, houseStyle }, at);
    // --quiet hides ✅ only. A 💡 is a finding and a ⏭ says a check did NOT
    // run — hiding those made a quiet run look cleaner than it was, and
    // contradicted what --help and tools/README.md promise.
    if (!this.json) {
      console.log(`💡 ${section}: ${name}${where(at)} — ${message}${houseStyle ? ' [baseline]' : ''}`);
      if (suggestion) console.log(`     suggestion: ${suggestion}`);
    }
  }

  skip(section, name, reason, at = {}) {
    this._record({ section, name, outcome: 'skip', message: reason }, at);
    if (!this.json) {
      console.log(`⏭  ${section}: ${name}${where(at)} — ${reason}`);
    }
  }

  error(message) {
    this.errors.push(message);
    if (!this.json) console.error(`error: ${message}`);
  }

  // Location fields are only emitted when known — a row full of nulls costs an
  // agent tokens to read and tells it nothing.
  _record(r, at = {}) {
    const row = { id: at.id ?? ruleId(r.section, r.name), ...r, source: this.source };
    if (at.file) row.file = at.file;
    if (at.line != null) row.line = at.line;
    if (at.url) row.url = at.url;
    this.results.push(row);
  }

  finish() {
    if (this.json) {
      // Unindented: --json is read by machines, and pretty-printing a clean run
      // tripled its size for no reader's benefit.
      console.log(JSON.stringify({
        results: this.results,
        errors: this.errors,
        summary: this._counts(),
      }));
      return;
    }
    const c = this._counts();
    console.log('');
    console.log(`${c.pass} ✅   ${c.fix} 🔧   ${c.block} 🛑   ${c.suggest} 💡   ${c.skip} ⏭`);

    const demoted = this.results.filter(r => r.houseStyle).length;
    if (demoted > 0) {
      const is = demoted === 1 ? 'is' : 'are';
      console.log(`${demoted} of the 💡 ${is} [baseline] — this project's house style (Cloudflare, Orama, llms.txt …),`);
      console.log('not universal practice. Re-run with --strict to treat them as required.');
    }

    if (this.errors.length > 0) {
      const n = this.errors.length;
      console.log(`audit failed — ${n} tooling error${n === 1 ? '' : 's'} (exit 2).`);
    } else if (c.fix + c.block > 0) {
      const n = c.fix + c.block;
      console.log(`audit complete — ${n} finding${n === 1 ? '' : 's'} to address (exit 1).`);
    } else if (c.suggest > 0) {
      console.log(`audit clean — ${c.suggest} optional suggestion${c.suggest === 1 ? '' : 's'} (exit 0).`);
    } else {
      console.log('audit clean — no findings (exit 0).');
    }
  }

  _counts() {
    return {
      pass:    this.results.filter(r => r.outcome === 'pass').length,
      fix:     this.results.filter(r => r.outcome === 'fix').length,
      block:   this.results.filter(r => r.outcome === 'block').length,
      suggest: this.results.filter(r => r.outcome === 'suggest').length,
      skip:    this.results.filter(r => r.outcome === 'skip').length,
    };
  }

  exitCode() {
    if (this.errors.length > 0) return 2;
    return this.results.some(r => r.outcome === 'fix' || r.outcome === 'block') ? 1 : 0;
  }
}
