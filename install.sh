#!/usr/bin/env bash
# td-rider installer — symlinks the /td-rider command + its tools into ~/.claude/.
# Idempotent: safe to re-run after pulling updates.
#
# Command-driven by design: this installs NOTHING into any project and never
# touches a project's CLAUDE.md. You run /td-rider on demand.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
COMMANDS_DIR="$CLAUDE_DIR/commands"
COMMAND_LINK="$COMMANDS_DIR/td-rider.md"
TOOLS_LINK="$CLAUDE_DIR/td-rider-tools"

mkdir -p "$COMMANDS_DIR"

# Prune stale symlinks from the pre-repurpose td-rider framework.
for stale in \
  "$COMMANDS_DIR/td-rider-init.md" \
  "$COMMANDS_DIR/td-rider-migrate.md" \
  "$COMMANDS_DIR/td-rider-refresh.md" \
  "$CLAUDE_DIR/td-rider-contract.md" \
  "$CLAUDE_DIR/td-rider-templates"; do
  if [ -L "$stale" ] || [ -e "$stale" ]; then
    rm -rf "$stale"
    echo "  pruned stale: $(basename "$stale")"
  fi
done
for sk in og seo i18n social; do
  link="$CLAUDE_DIR/skills/td-rider-$sk"
  if [ -L "$link" ] || [ -e "$link" ]; then
    rm -rf "$link"
    echo "  pruned stale skill: td-rider-$sk"
  fi
done

# 1. The slash command
echo "→ installing /td-rider to $COMMANDS_DIR"
if [ -L "$COMMAND_LINK" ] || [ -e "$COMMAND_LINK" ]; then rm -f "$COMMAND_LINK"; fi
ln -s "$REPO_DIR/commands/td-rider.md" "$COMMAND_LINK"
echo "  /td-rider"

# 2. The tools (the command invokes audit.mjs from here)
echo "→ linking tools to $TOOLS_LINK"
if [ -L "$TOOLS_LINK" ] || [ -e "$TOOLS_LINK" ]; then rm -rf "$TOOLS_LINK"; fi
ln -s "$REPO_DIR/tools" "$TOOLS_LINK"
echo "  td-rider-tools linked (audit.mjs)"

echo
echo "td-rider installed."
echo
echo "Run it from inside any Astro project:"
echo "  cd ~/projects/<an-astro-site>"
echo "  claude"
echo "  /td-rider                 # offline source + dist checks"
echo "  /td-rider https://site    # also check the live/served site"
echo
echo "Or call the tool directly:  node ~/.claude/td-rider-tools/audit.mjs --help"
echo "To update later: git pull in this repo + re-run ./install.sh"
