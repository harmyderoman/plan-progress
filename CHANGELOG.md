# Changelog

## 0.2.0 (2026-11-15)

First public release.

- The tool's arguments are checked before use: wrong types are dropped, blank steps and titles are ignored, and a plan is capped at 50 steps, 200 characters per step and 120 for the title.
- A `current` step past the end of the plan no longer clears the step in hand.
- A `title` sent with an empty `steps` list now renames the plan.
- Plan logic moved to `hooks/plan.ts`, with unit tests; tests through the engine cover every surface.
- Added an audit (`AUDIT.md`), MIT license, CI, and the install line.

## 0.1.0

Local build: the `progress` tool, the plan pane, the band above the prompt and `/progress`.
