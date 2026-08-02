// Reporter — collects check outcomes, formats output (human or JSON), sets exit code.
//
// Outcome vocabulary:
//   pass    ✅  compliant
//   fix     🔧  drift, mechanically fixable        (counts as a failure → exit 1)
//   block   🛑  needs a decision                   (counts as a failure → exit 1)
//   suggest 💡  optional / nice-to-have, not required (advisory → exit 0)
//   skip    ⏭  not run / not testable here

import { isHouseStyle } from './policy.mjs';

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

  pass(section, name, message = '') {
    this._record({ section, name, outcome: 'pass', message });
    if (!this.json && !this.quiet) {
      console.log(`✅ ${section}: ${name}${message ? ' — ' + message : ''}`);
    }
  }

  fix(section, name, message, fix) {
    if (this._demoted(section, name)) return this.suggest(section, name, message, fix, true);
    this._record({ section, name, outcome: 'fix', message, fix });
    if (!this.json) {
      console.log(`🔧 ${section}: ${name} — ${message}`);
      if (fix) console.log(`     fix: ${fix}`);
    }
  }

  block(section, name, message, fix) {
    if (this._demoted(section, name)) return this.suggest(section, name, message, fix, true);
    this._record({ section, name, outcome: 'block', message, fix });
    if (!this.json) {
      console.log(`🛑 ${section}: ${name} — ${message}`);
      if (fix) console.log(`     resolve: ${fix}`);
    }
  }

  suggest(section, name, message, suggestion, houseStyle = false) {
    this._record({ section, name, outcome: 'suggest', message, fix: suggestion, houseStyle });
    if (!this.json && !this.quiet) {
      console.log(`💡 ${section}: ${name} — ${message}${houseStyle ? ' [baseline]' : ''}`);
      if (suggestion) console.log(`     suggestion: ${suggestion}`);
    }
  }

  skip(section, name, reason) {
    this._record({ section, name, outcome: 'skip', message: reason });
    if (!this.json && !this.quiet) {
      console.log(`⏭  ${section}: ${name} — ${reason}`);
    }
  }

  error(message) {
    this.errors.push(message);
    if (!this.json) console.error(`error: ${message}`);
  }

  _record(r) {
    this.results.push({ ...r, source: this.source });
  }

  finish() {
    if (this.json) {
      console.log(JSON.stringify({
        results: this.results,
        errors: this.errors,
        summary: this._counts(),
      }, null, 2));
      return;
    }
    const c = this._counts();
    console.log('');
    console.log(`${c.pass} ✅   ${c.fix} 🔧   ${c.block} 🛑   ${c.suggest} 💡   ${c.skip} ⏭`);

    // Only explain the demotion when the 💡 lines it refers to were actually
    // printed — under --quiet they are hidden, so the footer described findings
    // the reader could not see.
    const demoted = this.results.filter(r => r.houseStyle).length;
    if (demoted > 0 && !this.quiet) {
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
