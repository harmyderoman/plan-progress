// Plan progress: Claude reports the plan of the task in hand through its `progress` tool, and the person
// sees it beside the chat — a pane with every step and a bar, and a compact bar above the prompt.
// Nothing is read from the conversation: the plan is exactly what Claude reported.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { LIMITS, applyReport, bar, counts, mark, sanitize, stepWindow, summary } from './plan'

const PANE = 'plan-progress'
// The pane's tab title, shown while more than one pane is open.
const PANE_TITLE = 'Plan progress'
const TOOL = 'mcp__plan-progress__progress'
// Change the tag when Plan's fields change: a stored plan of another shape is read as none.
const plan = atom({ plugin: 'plan-progress', key: 'plan' } as const, null, { shape: 'plan-1' })
const isBandHidden = atom({ plugin: 'plan-progress', key: 'isBandHidden' } as const, false)
const isBandOpen = atom({ plugin: 'plan-progress', key: 'isBandOpen' } as const, false)
// The pane is drawn now: the band above the prompt then stays away, as it would show the same.
const isPaneOpen = atom({ plugin: 'plan-progress', key: 'isPaneOpen' } as const, false)

const DESCRIPTION = [
  'Shows the plan of the task you are working on to the person, beside the chat: every step and a progress bar.',
  'Start a plan with `title` and `steps` (short, in the language of the conversation), the first step becomes current.',
  'Then, as you go: `done` with the numbers of finished steps (1-based) and `current` with the step you start; `finished: true` when all is done.',
  'Sending `steps` again replaces the plan (use it when the plan changes). `clear: true` removes it.',
].join(' ')

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: LIMITS.title, description: 'What the task is, a few words.' },
    steps: {
      type: 'array',
      items: { type: 'string', maxLength: LIMITS.stepText },
      maxItems: LIMITS.steps,
      description: 'A new plan: its steps in order. Replaces the current plan.',
    },
    current: { type: 'integer', minimum: 1, description: 'The step being worked on now (1-based).' },
    done: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Steps finished (1-based).' },
    finished: { type: 'boolean', description: 'Every step is done.' },
    clear: { type: 'boolean', description: 'Remove the plan.' },
  },
}

const GUIDE = [
  'Plan progress (plan-progress mod): for a task of three or more steps, call the `progress` tool',
  `(${TOOL}) with the plan before starting, then after each step mark it done and the next one current,`,
  'and `finished: true` at the end. The person watches this as a progress bar; keep the step texts short.',
].join(' ')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // No status line entry: the bar above the prompt shows the same. Clear one an earlier version left.
    $.ui.status(undefined)
    await $.tool.register({ name: 'progress', description: DESCRIPTION, inputSchema: SCHEMA, isDeferred: false })
    await $.command.register({ name: 'progress', description: 'Show the plan Claude is working through, with its progress' })

    return next(e)
  })

  // Tell the model the tool is there and when to use it.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return { sections: [...composed.sections, { id: 'plan-progress:guide', text: GUIDE, scope: 'session' }] }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    // The tool's arguments sit on the event itself, beside the engine's keys (tool, tool_use_id…).
    // They come from the model, so they are checked before they touch the plan.
    const raw = e as unknown as Record<string, unknown>
    const input = sanitize(raw)
    const before = await read($, plan)
    if (Array.isArray(raw.steps) && raw.steps.length > 0 && !input.steps?.length) {
      return { result: 'The steps were empty: send at least one step with text.' }
    }
    if (!input.clear && !input.steps?.length && !before) {
      return { result: 'No plan yet: send `title` and `steps` first.' }
    }
    const after = applyReport(before, input)
    await update($, plan, () => after)
    if (input.steps?.length) {
      await update($, isBandHidden, () => false)
      const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
      await update($, isPaneOpen, () => opened.isPlaced)
    }
    if (!after) {
      return { result: 'Plan cleared.' }
    }

    return { result: `Shown to the person. ${summary(after)}.` }
  }).catch(() => ({ result: 'The plan could not be updated; carry on with the task.' }))

  on('command.run', { command: 'progress' }, async $ => {
    const current = await read($, plan)
    await update($, isBandHidden, () => false)
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
    await update($, isPaneOpen, () => opened.isPlaced)
    // No pane here (VS Code): the band above the prompt opens its step list instead.
    if (!opened.isPlaced) await update($, isBandOpen, () => true)

    return { text: current ? `${summary(current)}${opened.isPlaced ? '' : ' (every step is listed above the prompt)'}` : 'No plan yet.' }
  })

  // Closed by the person (its x), by the mod or on unload: the band above the prompt comes back.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, isPaneOpen, () => false)

    return next(e)
  })

  // The pane: title, the bar with its count, every step.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, plan)
    if (!current) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No plan yet. It appears here when Claude starts a task of several steps.</Text>
        </Box>
      )
    }
    const { done, total } = counts(current)
    const width = Math.max(8, Math.min(40, (e.props.bodyColumns ?? 30) - 10))

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{current.title}</Text>
        <Box flexDirection="row" gap={1}>
          <Text color={done === total ? 'success' : 'claude'}>{bar(done, total, width)}</Text>
          <Text bold>
            {done}/{total}
          </Text>
        </Box>
        <Box flexDirection="column">
          {current.steps.map((step, i) => (
            <Text
              color={step.status === 'active' ? 'claude' : step.status === 'done' ? 'success' : undefined}
              dimColor={step.status === 'pending'}
              bold={step.status === 'active'}
            >
              {mark(step)} {i + 1}. {step.text}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })

  // Above the prompt: the bar, the count and the step in hand in one line; "Steps" opens every step under it
  // (VS Code draws no pane beside the chat, so this is where the whole plan is seen there).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, plan)
    if (!current || e.props.hasSurvey || (await read($, isBandHidden)) || (await read($, isPaneOpen))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    // A band the person collapsed keeps to its one line.
    const isOpen = (await read($, isBandOpen)) && !e.props.isCollapsed
    const { done, total } = counts(current)
    const active = current.steps.findIndex(s => s.status === 'active')
    const width = Math.max(6, Math.min(24, Math.floor((e.props.bodyColumns ?? 60) / 4)))
    // The steps that fit under the bar: a window around the step in hand when the plan is longer than the room.
    const { start, count } = stepWindow(current, e.props.maxRows)
    const shown = current.steps.slice(start, start + count)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={done === total ? 'success' : 'claude'}>{bar(done, total, width)}</Text>
          <Text bold>
            {done}/{total}
          </Text>
          <Text dimColor>
            {done === total ? `${current.title}: done` : isOpen ? current.title : active >= 0 ? `${active + 1}. ${current.steps[active]!.text}` : current.title}
          </Text>
          <Button key="steps" label={isOpen ? 'Less' : 'Steps'} onPress={() => update($, isBandOpen, open => !open)} />
          <Button key="hide" label="Hide" onPress={() => update($, isBandHidden, () => true)} />
        </Box>
        {isOpen && (
          <Box flexDirection="column" paddingLeft={1}>
            {shown.map((step, i) => (
              <Text
                color={step.status === 'active' ? 'claude' : step.status === 'done' ? 'success' : undefined}
                dimColor={step.status === 'pending'}
                bold={step.status === 'active'}
              >
                {mark(step)} {start + i + 1}. {step.text}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
