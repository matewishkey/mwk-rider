---
type: regex
pattern: "skip|⏭|not (been )?built|no dist|could not (be )?check"
flags: "i"
match: contains
target: last_message
---

An unbuilt project skips every dist-reading check. The summary says so.
