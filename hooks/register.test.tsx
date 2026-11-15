// Tests of the mod as the engine runs it: the tool, the slash command, the pane and the band above the prompt.
// In each test the hooks registered with `on` sit beneath the plugin and stand for the engine.
import { expect, test } from 'claude-code/testing'
import type { CommandRunInput } from 'claude-code'
import type { TestBody } from 'claude-code/testing'

const TOOL = 'mcp__plan-progress__progress'
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const PANE = {
  plugin: 'plan-progress',
  component: 'Pane',
  requestId: 'plan-progress',
  props: {
    title: 'Plan',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const
const bandProps = (maxRows = 12) =>
  ({ hasSurvey: false, isCollapsed: false, isWorking: false, maxRows, bodyColumns: 80, scroll: { offset: 0, bodyRows: maxRows }, view: {} }) as const
/** `/progress` typed at the prompt. */
const PROGRESS: CommandRunInput = { command: 'progress', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }
const BAND = { plugin: 'plan-progress', component: 'AbovePrompt', props: bandProps() } as const

type On = Parameters<TestBody>[1]

/** The engine beneath the plugin: it takes the registrations, and places the pane or not (`place` can change it later). */
function engine(on: On, isPlaced: boolean) {
  const surface = { isPlaced }
  on('command.register', () => ({ value: { command: 'progress' } }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('ui.open', () => ({ value: surface.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'no pane here' } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { place: (next: boolean) => void (surface.isPlaced = next) }
}

/** What the plugin answered the model for one call of its tool. */
const answer = (r: unknown) => String((r as { result?: unknown }).result)

test('a plan reported through the tool shows its bar and steps, on every surface', async ($, on) => {
  engine(on, true)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.tool.call({ tool: TOOL, title: 'Landing', steps: ['Find', 'Build', 'Check', 'Commit'] })
  await $.tool.call({ tool: TOOL, done: [1, 2], current: 3 })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Landing$/ }))?.text).toBe('Landing')
    expect((await ui.find({ type: 'Text', text: /^2\/4$/ }))?.text).toBe('2/4')
    expect((await ui.find({ type: 'Text', text: /Check/ }))?.text).toBe('▶ 3. Check')
    expect((await ui.find({ type: 'Text', text: /Find/ }))?.text).toBe('✓ 1. Find')
    expect((await ui.find({ type: 'Text', text: /Commit/ }))?.text).toBe('○ 4. Commit')
    await ui.unmount()
  }

  await $.tool.call({ tool: TOOL, finished: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /^4\/4$/ }))?.text).toBe('4/4')
  await ui.unmount()
})

test('the tool answers the model with where the plan stands', async ($, on) => {
  engine(on, true)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(answer(await $.tool.call({ tool: TOOL, done: [1] }))).toMatch(/No plan yet/)
  expect(answer(await $.tool.call({ tool: TOOL, title: 'Ship', steps: ['A', 'B', 'C'] }))).toBe('Shown to the person. Ship: 0/3, now step 1.')
  expect(answer(await $.tool.call({ tool: TOOL, done: [1], current: 2 }))).toBe('Shown to the person. Ship: 1/3, now step 2.')
  expect(answer(await $.tool.call({ tool: TOOL, finished: true }))).toBe('Shown to the person. Ship: 3/3.')
  expect(answer(await $.tool.call({ tool: TOOL, clear: true }))).toBe('Plan cleared.')
})

test('input that does not follow the schema is handled, never thrown', async ($, on) => {
  engine(on, true)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // Steps that are all blank are refused with a reason the model can act on.
  expect(answer(await $.tool.call({ tool: TOOL, title: 'X', steps: ['  ', ''] }))).toMatch(/steps were empty/)
  // Wrong types are dropped rather than crashing the hook.
  expect(answer(await $.tool.call({ tool: TOOL, title: 'Ship', steps: ['A', 7, 'B'] } as never))).toBe('Shown to the person. Ship: 0/2, now step 1.')
  expect(answer(await $.tool.call({ tool: TOOL, done: 'all', current: 'two' } as never))).toBe('Shown to the person. Ship: 0/2, now step 1.')
  // A step number past the end leaves the step in hand where it is.
  expect(answer(await $.tool.call({ tool: TOOL, current: 99 }))).toBe('Shown to the person. Ship: 0/2, now step 1.')
})

test('clearing the plan empties the pane', async ($, on) => {
  engine(on, true)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: TOOL, title: 'Ship', steps: ['A', 'B'] })
  await $.tool.call({ tool: TOOL, clear: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toMatch(/No plan yet/)
  await ui.unmount()
})

test('the band above the prompt opens every step and folds them again', async ($, on) => {
  engine(on, false)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await $.tool.call({ tool: TOOL, title: 'Landing', steps: ['Find', 'Build', 'Check'] })
  await $.tool.call({ tool: TOOL, done: [1], current: 2 })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /^1\/3$/ }))?.text).toBe('1/3')
    expect((await ui.find({ type: 'Text', text: /2\. Build/ }))?.text).toBe('2. Build')
    expect(await ui.find({ type: 'Text', text: /Check/ })).toBeUndefined()
    await ui.press({ key: 'steps' })
    expect((await ui.find({ type: 'Text', text: /Check/ }))?.text).toBe('○ 3. Check')
    expect((await ui.find({ type: 'Text', text: /Find/ }))?.text).toBe('✓ 1. Find')
    await ui.press({ key: 'steps' })
    expect(await ui.find({ type: 'Text', text: /Check/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a finished plan reads as done in the band', async ($, on) => {
  engine(on, false)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: TOOL, title: 'Landing', steps: ['Find', 'Build'] })
  await $.tool.call({ tool: TOOL, finished: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^2\/2$/ }))?.text).toBe('2/2')
  expect((await ui.find({ type: 'Text', text: /done$/ }))?.text).toBe('Landing: done')
  await ui.unmount()
})

test('Hide puts the band away until the next plan', async ($, on) => {
  engine(on, false)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: TOOL, title: 'Landing', steps: ['Find', 'Build'] })

  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /^0\/2$/ })).toBeUndefined()
  await ui.unmount()

  // Progress on the same plan keeps it hidden.
  await $.tool.call({ tool: TOOL, done: [1], current: 2 })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^1\/2$/ })).toBeUndefined()
  await ui.unmount()

  // A new plan brings it back.
  await $.tool.call({ tool: TOOL, title: 'Next', steps: ['One', 'Two', 'Three'] })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^0\/3$/ }))?.text).toBe('0/3')
  await ui.unmount()
})

test('a long plan shows a window of steps around the one in hand', async ($, on) => {
  engine(on, false)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const steps = Array.from({ length: 20 }, (_, i) => `Step ${i + 1}`)
  await $.tool.call({ tool: TOOL, title: 'Long', steps })
  await $.tool.call({ tool: TOOL, done: [1, 2, 3, 4, 5, 6, 7, 8, 9], current: 10 })

  const ui = await $.ui.mount({ ...BAND, props: bandProps(5), surface: 'terminal' })
  await ui.press({ key: 'steps' })
  expect((await ui.find({ type: 'Text', text: /Step 10$/ }))?.text).toBe('▶ 10. Step 10')
  expect((await ui.find({ type: 'Text', text: /Step 8$/ }))?.text).toBe('✓ 8. Step 8')
  expect(await ui.find({ type: 'Text', text: /Step 1$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Step 20$/ })).toBeUndefined()
  await ui.unmount()
})

test('the band stays away while the pane shows the plan, and comes back once no pane is placed', async ($, on) => {
  const surface = engine(on, true)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: TOOL, title: 'Landing', steps: ['Find', 'Build'] })

  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^0\/2$/ })).toBeUndefined()
  await ui.unmount()

  // The surface no longer places the pane (say the window shrank): /progress learns it and the band returns.
  surface.place(false)
  await $.command.run(PROGRESS)
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^0\/2$/ }))?.text).toBe('0/2')
  await ui.unmount()
})

test('/progress reports the plan and, with no pane, opens the step list above the prompt', async ($, on) => {
  engine(on, false)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  expect((await $.command.run(PROGRESS)).text).toBe('No plan yet.')

  await $.tool.call({ tool: TOOL, title: 'Landing', steps: ['Find', 'Build', 'Check'] })
  expect((await $.command.run(PROGRESS)).text).toBe('Landing: 0/3, now step 1 (every step is listed above the prompt)')

  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /Check/ }))?.text).toBe('○ 3. Check')
  await ui.unmount()
})

test('/progress opens the pane where the surface has one', async ($, on) => {
  engine(on, true)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: TOOL, title: 'Landing', steps: ['Find', 'Build'] })
  expect((await $.command.run(PROGRESS)).text).toBe('Landing: 0/2, now step 1')
})

test('the system prompt tells the model about the tool', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const composed = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: [TOOL],
    outputStyle: null,
    traits: [],
  })
  const guide = composed.sections.find(s => s.id === 'plan-progress:guide')
  expect(guide?.scope).toBe('session')
  expect(guide?.text).toContain(TOOL)
})

test('session start registers the tool and the command', async ($, on) => {
  const tools: string[] = []
  const commands: string[] = []
  on('tool.register', (_, e) => {
    tools.push((e as { name: string }).name)
    return { value: { tool: TOOL } }
  })
  on('command.register', (_, e) => {
    commands.push((e as { name: string }).name)
    return { value: { command: 'progress' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(tools).toEqual(['progress'])
  expect(commands).toEqual(['progress'])
})

test('before any plan the pane says so', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text' }))?.text).toMatch(/No plan yet/)
  await ui.unmount()
})
