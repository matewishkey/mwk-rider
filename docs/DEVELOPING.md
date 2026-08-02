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

Pure-Node tool (`tools/*.mjs`, no dependencies) plus a multi-locale Astro fixture at
`examples/_fixture-i18n/` as the test target. The fixture tracks the baseline — it runs
Astro 7 (`npm install && npx astro build && npx astro check` all green), so raising the
baseline means upgrading the fixture in the same commit.

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

- **Runtime smoke (fixture-specific):** `node examples/_fixture-i18n/scripts/smoke.mjs` —
  Playwright against a live dev server (routes, SEO, search, locale boundaries).

### Pre-ship checklist

- [ ] If any `tools/**` changed: `node tools/test.mjs` passes.
- [ ] If any `tools/**` changed: `node tools/audit.mjs` inside `examples/_fixture-i18n/`
      is `0 🔧 / 0 🛑`, in default **and** `--strict`.
- [ ] If a check was added: it's classified in `tools/lib/policy.mjs`, and sanity-checked
      against an off-baseline site so you can see which mode it lands in.
- [ ] If `tools/checks/*.mjs` changed: also run it against a real site — drift there is
      expected and informational, and it's how you confirm the check fires in the wild.
- [ ] If `commands/wishbusterz-rider.md` or `install.sh` changed: re-run `./install.sh`, then
      confirm `node ~/.claude/wishbusterz-rider-tools/audit.mjs --help` resolves and the symlinks
      point at your checkout (`ls -la ~/.claude/wishbusterz-rider-tools`).

## Distribution

A dev tool — no deploy, no live UI. Distribution is consumer pull: `git pull &&
./install.sh`. `install.sh` is idempotent and symlinks the command into
`~/.claude/commands/` and `tools/` into `~/.claude/wishbusterz-rider-tools`. Pure Node ESM on
system Node 22+, no dependencies, no `package.json` at the repo root.
