#!/usr/bin/env bash
# rider installer — symlinks the skill, the /rider command, the tools and the
# starter into ~/.claude/.
# Idempotent: safe to re-run after pulling updates.
#
# Command-driven by design: this installs NOTHING into any project and never
# touches a project's CLAUDE.md. You run /rider on demand.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
COMMANDS_DIR="$CLAUDE_DIR/commands"
SKILL_SRC="$REPO_DIR/skills/rider"
SKILL_LINK="$CLAUDE_DIR/skills/rider"
COMMAND_LINK="$COMMANDS_DIR/rider.md"
TOOLS_LINK="$CLAUDE_DIR/rider-tools"
STARTER_LINK="$CLAUDE_DIR/rider-starter"

mkdir -p "$COMMANDS_DIR" "$CLAUDE_DIR/skills"

# Replace our own symlink, but never recursively delete a real directory that
# happens to sit at this path — that would be someone else's data. This matters
# more now that three of the four links are directories.
relink() {
  local target="$1" link="$2"
  if [ -L "$link" ]; then
    rm -f "$link"
  elif [ -e "$link" ]; then
    echo "error: $link exists and is not a symlink — move it aside and re-run." >&2
    exit 1
  fi
  ln -s "$target" "$link"
}

# 1. The skill — a DIRECTORY link, not a file one. SKILL.md alone cannot carry
#    references/CREATE.md, which is where create mode's steps live.
echo "→ installing the skill to $SKILL_LINK"
relink "$SKILL_SRC" "$SKILL_LINK"
echo "  rider (skill, with references/)"

# 2. The slash command — a second link to the SAME SKILL.md rather than a second
#    document, so the two cannot drift apart.
echo "→ installing /rider to $COMMANDS_DIR"
if [ -L "$COMMAND_LINK" ] || [ -e "$COMMAND_LINK" ]; then rm -f "$COMMAND_LINK"; fi
ln -s "$SKILL_SRC/SKILL.md" "$COMMAND_LINK"
echo "  /rider"

# 3. The tools (the skill invokes audit.mjs from here)
echo "→ linking tools to $TOOLS_LINK"
relink "$REPO_DIR/tools" "$TOOLS_LINK"
echo "  rider-tools linked (audit.mjs)"

# 4. The starter — what create mode copies. Nothing reachable from the install
#    used to point at examples/, so create mode had nothing to copy FROM and
#    would have written a site from memory instead: exactly how a scaffold drifts
#    from the reference the audit keeps clean.
echo "→ linking the starter to $STARTER_LINK"
relink "$REPO_DIR/examples/starter" "$STARTER_LINK"
echo "  rider-starter linked (the site create mode copies)"

echo
echo "rider installed."
echo
echo "Create a new site:"
echo "  mkdir ~/projects/<my-site> && cd ~/projects/<my-site>"
echo "  claude"
echo "  /rider                             # in an empty dir, it scaffolds"
echo
echo "Audit an existing one:"
echo "  cd ~/projects/<an-astro-site>"
echo "  claude"
echo "  /rider                             # offline source + dist checks"
echo "  /rider https://site                # also check the live/served site"
echo
echo "Or call the tool directly:  node ~/.claude/rider-tools/audit.mjs --help"
echo "What it checks, machine-readable:  node ~/.claude/rider-tools/audit.mjs --rules --json"
echo "To update later: git pull in this repo + re-run ./install.sh"
