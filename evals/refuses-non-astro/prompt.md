---
name: "A non-Astro directory is refused"
tags: ["audit", "boundary"]
plugins: ["mwk-rider"]
runs: 2
max_turns: 8
timeout_seconds: 180
allowed_tools: ["Bash"]
---

Run /mwk-rider:audit on the current directory.
