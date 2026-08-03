#!/usr/bin/env bash
# rider installer — symlinks the skill, the /rider
# command and the tools into ~/.claude/.
# Idempotent: safe to re-run after pulling updates.
#
# Command-driven by design: this installs NOTHING into any project and never
# touches a project's CLAUDE.md. You run /rider on demand.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
COMMANDS_DIR="$CLAUDE_DIR/commands"
SKILLS_DIR="$CLAUDE_DIR/skills/rider"
COMMAND_LINK="$COMMANDS_DIR/rider.md"
SKILL_SRC="$REPO_DIR/skills/rider/SKILL.md"
SKILL_LINK="$SKILLS_DIR/SKILL.md"
TOOLS_LINK="$CLAUDE_DIR/rider-tools"

mkdir -p "$COMMANDS_DIR" "$SKILLS_DIR"

# 1. The skill — SKILL.md is the cross-vendor standard, and it is the ONE copy
#    of these instructions. The slash command is a second symlink to the same
#    file rather than a second document, so the two cannot drift apart.
echo "→ installing the skill to $SKILLS_DIR"
if [ -L "$SKILL_LINK" ] || [ -e "$SKILL_LINK" ]; then rm -f "$SKILL_LINK"; fi
ln -s "$SKILL_SRC" "$SKILL_LINK"
echo "  rider (skill)"

echo "→ installing /rider to $COMMANDS_DIR"
if [ -L "$COMMAND_LINK" ] || [ -e "$COMMAND_LINK" ]; then rm -f "$COMMAND_LINK"; fi
ln -s "$SKILL_SRC" "$COMMAND_LINK"
echo "  /rider"

# 2. The tools (the command invokes audit.mjs from here)
echo "→ linking tools to $TOOLS_LINK"
# Replace our own symlink, but never recursively delete a real directory that
# happens to sit at this path — that would be someone else's data.
if [ -L "$TOOLS_LINK" ]; then
  rm -f "$TOOLS_LINK"
elif [ -e "$TOOLS_LINK" ]; then
  echo "error: $TOOLS_LINK exists and is not a symlink — move it aside and re-run." >&2
  exit 1
fi
ln -s "$REPO_DIR/tools" "$TOOLS_LINK"
echo "  rider-tools linked (audit.mjs)"

echo
echo "rider installed."
echo
echo "Run it from inside any Astro project:"
echo "  cd ~/projects/<an-astro-site>"
echo "  claude"
echo "  /rider                 # offline source + dist checks"
echo "  /rider https://site    # also check the live/served site"
echo
echo "Or call the tool directly:  node ~/.claude/rider-tools/audit.mjs --help"
echo "What it checks, machine-readable:  node ~/.claude/rider-tools/audit.mjs --rules --json"
echo "To update later: git pull in this repo + re-run ./install.sh"
