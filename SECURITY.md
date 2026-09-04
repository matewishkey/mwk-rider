# Security — Mate Wish Key Rider

## Reporting a vulnerability

Please **don't** open a public issue for a security problem. Use GitHub's [private vulnerability reporting](https://github.com/matewishkey/mwk-rider/security/advisories/new) on this repository, which goes only to the maintainers.

Expect an acknowledgement within a few days. This is a small project maintained part-time — please be patient, and please don't publish details until there's a fix or we've agreed there's no issue.

## What the threat model actually is

This tool is designed to be pointed at **projects you may not control** — that's the whole point of an auditor. So the security properties that matter are about what happens when it reads a hostile repository.

**It never executes the audited project's source.** Config files (`astro.config.*`, `scripts/og.config.mjs`, `package.json`, `tsconfig.json`) are read as text and parsed with regexes, never `import()`ed or evaluated. This is a deliberate constraint, documented at the top of `tools/lib/project.mjs`. An earlier version did dynamically import `scripts/og.config.mjs`, which meant auditing a directory ran whatever that file contained; that was removed. **If you find a path where project content reaches an evaluator, a shell, or a filesystem write, that's a vulnerability — please report it.**

**The one exception, stated rather than hidden: the optional `browser` domain imports `playwright`, and the copy it finds is usually the audited project's.** A browser domain cannot exist without loading a real browser driver, and the copy that exists is normally the one installed in the site being audited — rider is typically a clone somewhere else, so resolving only from its own tree would report "not installed" about a project that installed it. So a hostile repository shipping its own `node_modules/playwright` can get code execution in the auditor process. That is a real property of this tool, not a claim we can talk our way out of, and it is bounded three ways:

- it needs `--url`. The seven offline domains never reach this code, so the default audit of an unknown repository is unaffected.
- the tool's **own** resolution is tried first. A project's copy only loads when the auditor has none of its own.
- whichever copy loads, the run says so: `⏭ browser: playwright:source — playwright loaded from …`.

If you are auditing a repository you genuinely do not trust, run it without `--url` (or with `-s live -s lighthouse`, which skips the browser domain), and the "no project code executes" property holds completely. Reports of any *other* execution path are in scope as above.

**A plain run never writes to the audited project.** Every check only reads. Writing happens on one path and only when you ask for it: `--fix` applies the remedies a run produced, and `--dry-run` shows exactly what those are without touching anything. A remedy is data the check itself computed — one of three shapes (copy a file from the bundled starter, set one key in a JSON file, replace an exact string that occurs exactly once), never a generated edit. A `copy` refuses to overwrite an existing file, an `edit` refuses when the text it was written against is ambiguous, and the audit is re-run afterwards: if a required finding appears that was not there before, every file touched is reverted byte for byte. Nothing is installed, and nothing is written into a project that did not pass `--fix`.

**It makes no network requests unless you pass `--url`.** The seven offline domains are entirely local. With `--url`, it fetches the URL you give it (and assets that page references) with a browser-like `Accept` header, and every request has a timeout.

## Credentials

The only secret the tool consumes is `$PAGESPEED_API_KEY`, an optional free Google API key used by the `lighthouse` domain. It's read from the environment, sent only to `https://www.googleapis.com/pagespeedonline/`, and never logged or written to disk. Without it, that domain skips and everything else still runs.

The tool has no other credentials, no config file, no telemetry, and no update mechanism.

## Scope

In scope: anything that lets an audited project's contents cause code execution, file writes outside the tool, credential disclosure, or network requests to unintended hosts — other than the documented `browser`/`playwright` path above, which is a known trade-off rather than an open report.

Out of scope: a check producing a wrong finding. That's a correctness bug — please open a normal issue for it.
