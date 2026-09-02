---
type: regex
pattern: "not an Astro project|no astro\\.config|not detect(ed)? an Astro"
flags: "i"
match: contains
target: last_message
---

The reply says plainly that this is not an Astro project.
