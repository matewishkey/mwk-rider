# Contributing

Thanks for looking. This is a small, deliberately dependency-free tool — the bar for changes is "does it make the tool's answers more trustworthy?"

## Licensing of contributions

By submitting a pull request you agree that your contribution is licensed under the [MIT License](LICENSE), the same terms as the rest of the project. Please don't paste in code from another project unless its licence permits it and you bring the required notice with it.

## Getting set up

There is nothing to install. You need Node 22.12 or newer, and that's it — no `npm install`, no root `package.json`, no API keys.

```bash
git clone https://github.com/mergodon/wishbusterz-rider.git
cd wishbusterz-rider
node tools/test.mjs          # the gate — must pass
```

## The two rules that matter

**1. A new check needs both halves of a test.** `tools/test.mjs` asserts that checks stay quiet on the compliant fixture in `examples/_fixture-i18n/` *and* that each one actually fires on a purpose-built known-bad project. The fixture alone proves nothing: a check that is broken and never fires passes the fixture just as happily as one that works.

**2. A new check must be classified in `tools/lib/policy.mjs`.** Is it universal practice, or this project's house style? Anything unclassified defaults to universal, which means it becomes a required finding that fails the build of every stranger who doesn't share the opinion. Ask: *could a well-built Astro site reasonably do this differently?* If yes, it's house style — it reports as `💡 [baseline]` and only bites under `--strict`.

The full five-step process for adding a practice, and the reasoning behind each existing one, is in [`BEST-PRACTICES.md`](BEST-PRACTICES.md#how-we-add-a-practice). The governing rule there: every practice has an enforcing check, and a practice with no check is a tracked *gap*, not a practice.

## Things this tool deliberately does not do

Please don't add these — they've been considered and rejected:

- **Execute code from the audited project.** Config is read as text and parsed, never `import()`ed. Auditing a repo must never be equivalent to running it. See the safety note at the top of `tools/lib/project.mjs`.
- **Write to the audited project.** It reports; the user decides. No auto-fixing.
- **Take a runtime dependency.** Node built-ins only. This is why it can be run with a single `git clone` and no install step.
- **Fire automatically.** No hooks, no always-on contract. You run it when you want an answer.

## Two failure modes to design against

The worst things a check can do are miss a real violation and flag a compliant site. Both destroy trust in every other finding. So detection should accept *correct variants*, not one spelling — a site whose head metadata lives in `BaseHead.astro` rather than `SEO.astro` is not wrong, and a check that assumes the filename is.

When a check can't determine an answer, report `⏭` with the reason. Never let a check silently not run: in the output, "checked and passed" and "never checked" must never look the same.

## Before you open a PR

- [ ] `node tools/test.mjs` passes.
- [ ] `node tools/audit.mjs` inside `examples/_fixture-i18n/` is `0 🔧 / 0 🛑`, in default **and** `--strict`.
- [ ] Any new check is classified in `tools/lib/policy.mjs` and has both test halves.
- [ ] You ran it against a real Astro site that isn't the fixture, and the result made sense.

More detail on testing and the design decisions: [`docs/DEVELOPING.md`](docs/DEVELOPING.md).
