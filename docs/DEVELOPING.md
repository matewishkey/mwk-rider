# Developing

Testing discipline and the load-bearing decisions. Architecture and the domain list
live in `CLAUDE.md`; the *why* behind each individual check lives in
`BEST-PRACTICES.md` (the practice↔check registry).

## Key decisions

- **Verify, never provision — and never execute.** The tool reports; it never writes to
  an audited project, and it never runs that project's code. Config is read as text and
  parsed, never `import()`ed: auditing a repo must never be equivalent to running it.
- **Command-driven, never passive.** No contract `@import`, no auto-loading, nothing
  written into audited projects. If you find yourself wanting an always-on hook, stop —
  that's deliberately not what this is.
- **The version baseline is a floor for the baseline stack, not for every Astro site.**
  `--strict` treats being behind the floor as a required finding, because a site that
  opted into this baseline should track it. In the default mode `modules:astro:version`
  is house style (`tools/lib/policy.mjs`) — a stranger's site being a major behind is
  worth telling them, not worth failing their build over. The floor and its date live
  in `BEST-PRACTICES.md` § modules.
- **Version claims get re-verified, never recalled.** Every number in the baseline was
  read live (`npm view <pkg> version peerDependencies engines`) before being written
  down — that's how the TypeScript trap surfaced: `typescript@latest` is 7.x, but
  `@astrojs/check` peers on `^5 || ^6`, so `astro check` breaks. Re-run those queries
  when revisiting; a remembered version number is a fabricated one.

## Out of scope

- Setting up or migrating audited sites — the tool checks, it doesn't fix. Findings are
  suggestions.
- Auto-firing hooks or an always-on contract.
- Per-site config inside audited projects — the tool reads what's there; it writes nothing.

## Testing

Pure-Node tool (`tools/*.mjs`, no dependencies) plus **two** real Astro sites as test
targets:

- `examples/_fixture-i18n/` — the multi-locale exerciser. Two locales, search, a preview
  shelf, OG tooling. It exists to make checks fire on shapes a simple site never has.
- `examples/starter/` — the single-locale reference, and what create mode copies. It is
  the baseline's *existence proof*: the checks say what compliant means, and this is a
  site that is. It must stay `0 🔧 / 0 🛑` under `--strict`, enforced in CI.

**Raising the baseline means upgrading BOTH in the same commit.** Both run Astro 7
(`npm install && npm run build && npm run check` green), and a floor moved in only one of
them makes the other's clean run a lie.

The honest cost of the second site: two lockfiles, two `@astrojs/upgrade` runs per bump,
double Dependabot noise, and roughly double CI wall-clock. Mitigated with a
`[_fixture-i18n, starter]` matrix and `cache: npm` on `actions/setup-node`. Worth paying:
the alternative is a starter that quietly stops complying with the tool that ships it.

- **The gate: `node tools/test.mjs`.** Runs the audit against the fixture and a non-Astro
  dir and asserts the engine behaves (0 required findings on the fixture, scoping works,
  non-Astro rejected). Exit 0 = green. Stays offline so it works keyless and airgapped.
  Run it before every commit that touches `tools/**`.

  It also builds throwaway **known-bad** projects in `$TMPDIR` and asserts each check
  *fires*. This half matters: the compliant fixture only ever proves a check stays quiet,
  which passes just as happily when the check is broken. **A new check needs both halves.**

- **Manual offline:** `node tools/audit.mjs` run *inside* `examples/_fixture-i18n/`. No
  flag runs all seven offline domains; `-s <name>` scopes to one. The fixture should return
  `0 🔧 / 0 🛑` — `💡` suggestions are fine, they don't count. If the fixture is flagged,
  the tool has a bug (or the fixture drifted). Check **both** modes: the fixture is fully
  compliant, so `--strict` must be clean too.

- **Dogfooding: run it against a real site you did not write for it.** The two examples
  are compliant *by construction*, so they can only ever prove a check stays quiet. The
  synthetic known-bad projects prove it fires on a shape you thought of. Neither catches
  the thing that actually goes wrong, which is a check firing on correct code in a shape
  nobody anticipated.

  Round 3 (2026-08-03, against `matewishkey-web` and `cypruspokerbrisbane-web`) is the
  example: the new quote lint put 19 findings on one site, and every one was a possessive
  apostrophe inside a quoted YAML description — frontmatter is not prose, and `’` is not
  a quotation mark. Both fixed, both now regression-tested. Nothing in the fixture, the
  starter, or the synthetic cases could have shown that. The same round confirmed
  `perf: font:styles` firing correctly on a real site and `perf: embed:eager` staying
  quiet on one that had already moved its Maps iframe behind a facade.

  Round 4 (2026-08-03) widened it to every Astro project on the box — six, spanning
  Astro 5.18 through 7.1 — and is the round that proves the *severity split* works rather
  than any single check. Five of the six are below the 7+ baseline and every one of them
  reported `💡 modules: astro:version … [baseline]`, not a finding: a stranger on Astro 6
  does not get a red build. Four sites fired a total of 19 🔧 and, on inspection, all 19
  were real gaps — no false positive to fix, which is the first round that could say so.
  Widening the sample costs one loop over `~/projects`; do it each time the check set moves.

  **Audit those repos, never edit them.** A checkout next door is not permission; anything
  found goes back as an issue filed into that repo.

- **The severity split.** `tools/lib/policy.mjs` decides which checks are universal and
  which are house style; house-style findings demote to `💡 [baseline]` unless `--strict`.
  A new check that isn't classified there defaults to universal — i.e. it will fail the
  build of every stranger who doesn't share the opinion. Classify deliberately.

- **Live (`--url`):** `node tools/audit.mjs --url http://localhost:4321` — HTTP checks of
  the served site. Cache-header checks need a prod-like server (`wrangler dev` of `dist/`,
  or a deployed site); a plain `astro dev` doesn't apply `_headers`.

- **Lighthouse:** need network, a key, and a public URL — deliberately **not** in
  the offline gate. Without a key each leg `⏭ skips` and the run still exits 0. Lighthouse
  lab scores are noisy; re-run before trusting a number.

  **The key is provisioned on the dev box** — `$PAGESPEED_API_KEY`, in `~/.secrets`, with
  `mergodon/td-sops` (`apps/td-rider.enc.env` — the filename predates this repo's rename
  and is deliberately left alone; the `td-rider` repo it was named after was deleted on
  2026-08-03, the secrets file is the only thing that still carries the name) as the
  record. Rotate in both. It was absent
  until 2026-08-03, and that gap hid a real bug for a whole release: the diagnostics were
  written against a hand-built response, and the first live call showed Lighthouse had
  **renamed the audit ids** out from under them (`lcp-discovery-insight` etc.). A renamed
  id does not error — it produces a permanent `⏭`, which reads exactly like "nothing to
  report". **Any check that parses a third-party payload has to be run against the real
  API at least once**; a fixture only proves you can parse your own assumptions.

- **Runtime smoke (fixture-specific):** `node examples/_fixture-i18n/scripts/smoke.mjs` —
  Playwright against a live dev server (routes, SEO, search, locale boundaries).

### Pre-ship checklist

- [ ] If any `tools/**` changed: `node tools/test.mjs` passes.
- [ ] If any `tools/**` changed: `node tools/audit.mjs` inside **both**
      `examples/_fixture-i18n/` and `examples/starter/` is `0 🔧 / 0 🛑`, in default
      **and** `--strict`. Build each first — most of the interesting checks read `dist/`.
- [ ] If the baseline moved (a version floor, a required dep, a new check): **both**
      example sites were upgraded in this same commit. `tools/test.mjs` asserts the
      starter carries every `BASELINE_DEPS` entry, but it cannot assert taste.
- [ ] If a check was added: it's classified in `tools/lib/policy.mjs`, and sanity-checked
      against an off-baseline site so you can see which mode it lands in.
- [ ] If `tools/checks/*.mjs` changed: also run it against a real site — drift there is
      expected and informational, and it's how you confirm the check fires in the wild.
- [ ] If `skills/rider/**` or `install.sh` changed: re-run `./install.sh`, then confirm
      `node ~/.claude/rider-tools/audit.mjs --help` resolves, that
      `~/.claude/skills/rider/references/CREATE.md` is readable **through** the directory
      symlink, and that `~/.claude/rider-starter` points at your checkout.
- [ ] If create mode changed: scaffold end to end into an empty directory, let it build,
      and confirm the audit it runs on itself comes back `0 🔧`.

## Distribution

A dev tool — no deploy, no live UI. Distribution is consumer pull: `git pull &&
./install.sh`. `install.sh` is idempotent and creates four links:

| Link | Target | Why |
|---|---|---|
| `~/.claude/skills/rider` | `skills/rider/` | A **directory** link — a file link cannot carry `references/CREATE.md` |
| `~/.claude/commands/rider.md` | `skills/rider/SKILL.md` | The slash command is the same file, so the two cannot drift |
| `~/.claude/rider-tools` | `tools/` | What the skill invokes |
| `~/.claude/rider-starter` | `examples/starter/` | What create mode copies |

Pure Node ESM on system Node 22+, no dependencies, no `package.json` at the repo root.
