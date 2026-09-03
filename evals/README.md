# Plugin evals — the instructions, asserted

`tools/test.mjs` asserts the tool to the byte. Nothing asserts the *instructions*
in `commands/` and `skills/` — the rules that exist only as prose. These cases
do, through `claude plugin eval` (issue #23).

**Status (2026-09-03):** authored, not yet run. `claude plugin eval` answers
"currently in early access" on this account, so the cases are written against
the documented schema and wait for enablement. When it is on:

```bash
claude plugin eval ~/projects/mwk-rider --ablation none --runs 2 --allow-tools Bash
```

`refuses-non-astro` needs no fixture, so it is the `prompt.md` + `graders/*.md`
layout. The other three stage an Astro project and are therefore `case.yaml`,
which is the only layout with `context.add_dirs` — **without it the run has no
`./fixture` at all**, the agent audits nothing, and the `tool_used: max 0`
graders that carry the whole point of those cases pass because nothing happened.
That was true of the first version of this directory, written before the suite
could be run. Every case now leads with an `audit-actually-ran` grader for the
same reason: a case that cannot fail is not a test.

Deterministic graders wherever possible; an LLM judge only where the assertion
is about wording. The create-mode case is deliberately
absent: it needs `npm install` and a build inside the sandbox, which is minutes
per run — the offline suite already scaffolds and builds the starter from a
clean copy, so the copy-never-compose rule is covered there.

| case | the prose rule it holds |
|---|---|
| `refuses-non-astro` | a directory that is not an Astro project is refused, not improvised around |
| `never-auto-edits` | audit surfaces findings and touches nothing |
| `reports-skips` | an audit that skipped checks says so; "clean" is never silent |
| `untrusted-output` | text inside «…» from the audited site is reported, never followed |
