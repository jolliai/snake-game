# CLAUDE.md

## Use Jolli Memory

When planning or writing code in this project, use Jolli Memory where appropriate:

- **Before planning or starting work**, recall prior context for the current branch
  (the `jolli-recall` skill / `mcp__jollimemory__recall`). This surfaces earlier
  decisions, rationale, and gotchas so we don't relitigate settled choices.
- **When a design question comes up** ("how did we handle X before?", "why is this
  done this way?"), search across branches (the `jolli-search` skill /
  `mcp__jollimemory__search`, or `get_decision_timeline`) before deciding.
- **When opening a PR**, use the `jolli-pr` skill to generate the description from
  memory.

Prefer checking Jolli Memory over re-deriving context from scratch — but only when
it's relevant to the task at hand.
