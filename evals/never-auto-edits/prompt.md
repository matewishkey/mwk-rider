---
name: "Audit surfaces findings and touches nothing"
tags: ["audit", "boundary"]
plugins: ["mwk-rider"]
runs: 2
max_turns: 12
timeout_seconds: 240
allowed_tools: ["Bash"]
---

The project is in ./fixture. Run /mwk-rider:audit on it and tell me what it found.
