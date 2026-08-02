# Security

## Reporting a vulnerability

Please **don't** open a public issue for a security problem. Use GitHub's [private vulnerability reporting](https://github.com/mergodon/wishbusterz-rider/security/advisories/new) on this repository, which goes only to the maintainers.

Expect an acknowledgement within a few days. This is a small project maintained part-time — please be patient, and please don't publish details until there's a fix or we've agreed there's no issue.

## What the threat model actually is

This tool is designed to be pointed at **projects you may not control** — that's the whole point of an auditor. So the security properties that matter are about what happens when it reads a hostile repository.

**It never executes the audited project's code.** Config files (`astro.config.*`, `scripts/og.config.mjs`, `package.json`, `tsconfig.json`) are read as text and parsed with regexes, never `import()`ed or evaluated. This is a deliberate constraint, documented at the top of `tools/lib/project.mjs`. An earlier version did dynamically import `scripts/og.config.mjs`, which meant auditing a directory ran whatever that file contained; that was removed. **If you find a path where project content reaches an evaluator, a shell, or a filesystem write, that's a vulnerability — please report it.**

**It never writes to the audited project.** The tool only reads. It creates no files, modifies nothing, and installs nothing.

**It makes no network requests unless you pass `--url`.** The six offline domains are entirely local. With `--url`, it fetches the URL you give it (and assets that page references) with a browser-like `Accept` header, and every request has a timeout.

## Credentials

The only secret the tool consumes is `$PAGESPEED_API_KEY`, an optional free Google API key used by the `lighthouse` domain. It's read from the environment, sent only to `https://www.googleapis.com/pagespeedonline/`, and never logged or written to disk. Without it, that domain skips and everything else still runs.

The tool has no other credentials, no config file, no telemetry, and no update mechanism.

## Scope

In scope: anything that lets an audited project's contents cause code execution, file writes outside the tool, credential disclosure, or network requests to unintended hosts.

Out of scope: a check producing a wrong finding. That's a correctness bug — please open a normal issue for it.
