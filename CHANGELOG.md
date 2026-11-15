# Changelog

## 0.2.1 (2026-11-15)

- The plugin has an icon (`.claude-plugin/icon.png`).
- The pane's tab reads "Plan progress" instead of "Plan".
- README: screenshots, a "Where it works" section, and VS Code described as it is: the pane docks beside the chat in a wide tab and opens above the prompt in a narrow one.

## 0.2.0 (2026-11-15)

First public release.

- The tool's arguments are checked before use: wrong types are dropped, blank steps and titles are ignored, and a plan is capped at 50 steps, 200 characters per step and 120 for the title.
- A `current` step past the end of the plan no longer clears the step in hand.
- A `title` sent with an empty `steps` list now renames the plan.
- Plan logic moved to `hooks/plan.ts`, with unit tests; tests through the engine cover every surface.
- Added an audit (`AUDIT.md`), MIT license, CI, and the install line.

## 0.1.0

Local build: the `progress` tool, the plan pane, the band above the prompt and `/progress`.
