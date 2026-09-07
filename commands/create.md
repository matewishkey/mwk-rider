---
description: Scaffold a new Astro site by copying the compliant starter.
argument-hint: [site name or idea]
---

Create mode. There is nothing to infer — the user asked for this directly.

`$ARGUMENTS`, if not empty, is what the site is for; use it for the name and the intro copy rather than asking again.

If it — or anything the user pasted — is a **brief** (prose with a JSON spec in it, naming versions to build), that is the first branch of the file below: read it with `tools/brief.mjs` rather than by eye, and do not ask what it already answers.

@${CLAUDE_PLUGIN_ROOT}/skills/rider/references/CREATE.md
