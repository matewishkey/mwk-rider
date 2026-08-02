#!/usr/bin/env bash
# wishbusterz-rider installer — symlinks the /wishbusterz-rider command + its tools into ~/.claude/.
# Idempotent: safe to re-run after pulling updates.
#
# Command-driven by design: this installs NOTHING into any project and never
# touches a project's CLAUDE.md. You run /wishbusterz-rider on demand.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
COMMANDS_DIR="$CLAUDE_DIR/commands"
COMMAND_LINK="$COMMANDS_DIR/wishbusterz-rider.md"
TOOLS_LINK="$CLAUDE_DIR/wishbusterz-rider-tools"

mkdir -p "$COMMANDS_DIR"

# 1. The slash command
echo "→ installing /wishbusterz-rider to $COMMANDS_DIR"
if [ -L "$COMMAND_LINK" ] || [ -e "$COMMAND_LINK" ]; then rm -f "$COMMAND_LINK"; fi
ln -s "$REPO_DIR/commands/wishbusterz-rider.md" "$COMMAND_LINK"
echo "  /wishbusterz-rider"

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
echo "  wishbusterz-rider-tools linked (audit.mjs)"

echo
echo "wishbusterz-rider installed."
echo
echo "Run it from inside any Astro project:"
echo "  cd ~/projects/<an-astro-site>"
echo "  claude"
echo "  /wishbusterz-rider                 # offline source + dist checks"
echo "  /wishbusterz-rider https://site    # also check the live/served site"
echo
echo "Or call the tool directly:  node ~/.claude/wishbusterz-rider-tools/audit.mjs --help"
echo "To update later: git pull in this repo + re-run ./install.sh"
