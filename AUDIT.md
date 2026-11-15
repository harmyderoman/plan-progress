# Audit: plan-progress 0.2.0

Date: 2026-11-15. Scope: everything in this repository, `hooks/register.tsx` and `hooks/plan.ts` in particular. Baseline: version 0.1.0, the local build this repository was made from.

## Method

| Check | Tool | Result |
| --- | --- | --- |
| Manifest, marketplace file and hooks module as the engine reads them | `claude plugin validate .` (Claude Code 2.1.322) | Passes |
| Strict type-check (`strict`, `noUncheckedIndexedAccess`) of the module and the tests | TypeScript 5.6.3 against the engine's API types | No errors |
| Behaviour on the terminal, desktop, VS Code and mobile surfaces | `claude plugin test .` | 43 tests pass |
| Secrets (key and token formats) in every file | plugin-authoring `scan_secrets` | None found |
| Line-by-line review | Manual | Findings below |

To check that the new tests catch the problems fixed here, they were also run against the 0.1.0 module. The input-handling test fails there, as expected.

## What the mod can reach

From `claude plugin validate`, the module calls only:

- `$.tool.register`, `$.command.register`: the `progress` tool and the `/progress` command.
- `$.state.get`, `$.state.set`: four session-scoped values (`plan`, `isBandHidden`, `isBandOpen`, `isPaneOpen`), declared in `types/index.d.ts`.
- `$.ui.open`, `$.ui.resolve`, `$.ui.status`: the pane, the elements it draws with, and clearing a status-line entry an earlier version left.

It does **not** use `$.fs`, `$.process`, `$.model`, `$.store`, network access or `$.session.messages()`. It hooks no other tool's calls and does not add to or withhold anything from `$`. The plan lives in session state only: it is not written to disk by the mod, persisted across sessions or sent anywhere.

Hooks: `session.start`, `prompt.compose`, `tool.call` (its own tool only), `command.run` (its own command only), `ui.close`, and `ui.render` for its own pane and the band above the prompt.

## Security and privacy

- **Untrusted input.** The tool's arguments come from the model and may not follow the schema. Since 0.2.0 they pass through `sanitize()` before they reach the plan (see F2).
- **Rendering.** Step texts and the title are drawn as plain `Text` elements. They are never read as markup, links or commands, so a step text cannot run anything or open anything.
- **Prompt surface.** The tool's answer to the model is a fixed sentence plus the plan's own title and counts, which the model itself sent. Nothing from outside the conversation enters the model's context through this mod.
- **Failure handling.** The `tool.call` hook has a `.catch` that answers *"The plan could not be updated; carry on with the task."*, so a failure inside the mod never breaks the model's turn. The `ui.close` hook has no `.catch`. If it failed it would be skipped and the pane would still close, which is the right behaviour for a hook that only records state.
- **Secrets.** None in the repository (scan above). The manifest names the author's GitHub handle only.

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| F1 | Medium | A `current` step number past the end of the plan cleared the step in hand and marked nothing active, so the band lost its "now" step. | Fixed: such numbers are ignored. |
| F2 | Medium | Arguments were used without checks. `steps` as a string, or `done` as a number, threw inside the hook. The `.catch` hid the crash, but the model got no reason it could act on. | Fixed: `sanitize()` drops wrong types and the hook answers with a specific message. |
| F3 | Low | A blank `title` (`"   "`) replaced the plan's title with an empty one. | Fixed: blank titles are ignored. |
| F4 | Low | Blank step texts became empty steps. A plan made only of blank steps had zero steps and showed as "done". | Fixed: blank steps are left out; a plan with none is refused with a reason. |
| F5 | Low | `title` sent together with an empty `steps: []` was silently dropped. | Fixed. |
| F6 | Low | No limit on the number of steps or the length of texts, so one runaway report could flood the band, the pane and the session state. | Fixed: at most 50 steps, 200 characters per step, 120 for the title, also stated in the tool's schema (`maxItems`, `maxLength`). |
| F7 | Info | The local install held compiled `hooks/register.js` and `register.test.js` from an earlier version, out of step with the source. The engine loads `register.tsx`, so they were dead files that could mislead a reader. | Not published; `hooks/*.js` is git-ignored. |
| F8 | Info | No `LICENSE` and no author in the manifest; `claude plugin validate` reports the missing license as a blocker for the plugin directory. | Fixed: MIT license, author, homepage and repository added. |
| F9 | Info | The tool is registered with `isDeferred: false`, and a guide line is added to the system prompt, so about 400 tokens ride on every request. That is by design: the model has to know the tool is there to use it unprompted. | Accepted; stated in the README. |
| F10 | Info | Each new plan opens the pane again even if the person closed it earlier. | Accepted: a new plan is worth seeing. **Hide** on the band works the same way. |

## Compatibility

The `Plan` and `Step` types are unchanged, so the state shape tag stays `plan-1`. A plan stored by 0.1.0 during a session is read as before after an upgrade.

## Tests

- `hooks/plan.test.ts`: 29 unit tests of `sanitize`, `applyReport`, `bar`, `counts`, `summary`, `mark` and `stepWindow`, covering every finding above.
- `hooks/register.test.tsx`: 14 tests through the engine: tool answers, malformed input, clearing, the pane and the band on all four surfaces, **Steps**/**Less**/**Hide**, windowing of long plans, the pane/band hand-off, `/progress` with and without a pane, the system-prompt line, and registration at session start.

CI (`.github/workflows/ci.yml`) runs `claude plugin validate` and `claude plugin test` on every push and pull request.

## Not covered

- Rendering is tested through the engine's test kit, which checks the tree each surface accepts, not how each surface paints it.
- The test kit cannot raise `ui.close`, so closing the pane is covered through the `/progress` path, which updates the same state.
