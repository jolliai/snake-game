---
source: "linear"
nativeId: "JOE-6"
title: "Iron Snake: boards with holes in the middle"
url: "https://linear.app/joesthewizardworkspace/issue/JOE-6/iron-snake-boards-with-holes-in-the-middle"
fields:
  - {"key":"status","label":"Status","value":"Backlog","icon":"circle-large-filled"}
  - {"key":"priority","label":"Priority","value":"Medium","icon":"flame"}
referencedAt: "2026-07-06T18:31:13.755Z"
sourceToolName: "mcp__claude_ai_Linear__list_issues"
---

## Summary

Customer request: support boards that have **holes in the middle** — interior wall/obstacle cells inside the playable region that the snake must navigate around (colliding with one is fatal, like hitting the board edge).

## Context

This extends the existing **Iron Snake mode**, which already carves the board into an irregular shape using a flat mask (`Uint8Array`, `1` = playable, `0` = off-board/wall) generated in `src/iron-snake.t… (truncated, use `get_issue` for full description)
