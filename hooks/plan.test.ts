// Unit tests for the plan logic: no engine involved, only the pure functions in plan.ts.
import { describe, expect, test } from 'claude-code/testing'

import type { Plan } from '../types'
import { LIMITS, applyReport, bar, counts, mark, sanitize, stepWindow, summary } from './plan'

const statuses = (p: Plan | null) => p?.steps.map(s => s.status)
const start = (steps: string[], title = 'Task') => applyReport(null, sanitize({ title, steps }))!

describe('applyReport', () => {
  test('a new plan makes its first step current and the rest pending', async () => {
    const p = start(['A', 'B', 'C'])
    expect(p.title).toBe('Task')
    expect(statuses(p)).toEqual(['active', 'pending', 'pending'])
  })

  test('a plan without a title is called "Plan"', async () => {
    expect(applyReport(null, sanitize({ steps: ['A'] }))?.title).toBe('Plan')
  })

  test('marking a step done and the next current moves the plan along', async () => {
    const p = applyReport(start(['A', 'B', 'C']), { done: [1], current: 2 })
    expect(statuses(p)).toEqual(['done', 'active', 'pending'])
  })

  test('moving to another step without marking the old one done puts it back to pending', async () => {
    const p = applyReport(start(['A', 'B', 'C']), { current: 3 })
    expect(statuses(p)).toEqual(['pending', 'pending', 'active'])
  })

  test('done wins over current for the same step', async () => {
    const p = applyReport(start(['A', 'B']), { done: [1], current: 1 })
    expect(statuses(p)).toEqual(['done', 'pending'])
  })

  test('finished marks every step done', async () => {
    const p = applyReport(start(['A', 'B', 'C']), { finished: true })
    expect(statuses(p)).toEqual(['done', 'done', 'done'])
  })

  test('clear removes the plan', async () => {
    expect(applyReport(start(['A']), { clear: true })).toBeNull()
  })

  test('clear wins over everything else in the same report', async () => {
    expect(applyReport(start(['A']), sanitize({ clear: true, steps: ['X'], title: 'Y' }))).toBeNull()
  })

  test('new steps replace the plan and keep the old title when none is given', async () => {
    const before = applyReport(start(['A', 'B']), { done: [1], current: 2 })
    const p = applyReport(before, sanitize({ steps: ['X', 'Y', 'Z'] }))
    expect(p?.title).toBe('Task')
    expect(p?.steps.map(s => s.text)).toEqual(['X', 'Y', 'Z'])
    expect(statuses(p)).toEqual(['active', 'pending', 'pending'])
  })

  test('a title alone renames the plan and keeps its progress', async () => {
    const before = applyReport(start(['A', 'B']), { done: [1], current: 2 })
    const p = applyReport(before, sanitize({ title: 'Renamed' }))
    expect(p?.title).toBe('Renamed')
    expect(statuses(p)).toEqual(['done', 'active'])
  })

  test('a title sent with an empty step list still renames the plan', async () => {
    expect(applyReport(start(['A']), sanitize({ title: 'Renamed', steps: [] }))?.title).toBe('Renamed')
  })

  test('a blank title does not erase the old one', async () => {
    expect(applyReport(start(['A']), sanitize({ title: '   ' }))?.title).toBe('Task')
  })

  test('a current step past the end of the plan is ignored, the step in hand stays', async () => {
    const p = applyReport(start(['A', 'B']), sanitize({ current: 9 }))
    expect(statuses(p)).toEqual(['active', 'pending'])
  })

  test('done numbers past the end of the plan are ignored', async () => {
    const p = applyReport(start(['A', 'B']), sanitize({ done: [2, 7] }))
    expect(statuses(p)).toEqual(['active', 'done'])
  })

  test('a progress report with no plan yields no plan', async () => {
    expect(applyReport(null, { done: [1] })).toBeNull()
    expect(applyReport(null, { finished: true })).toBeNull()
  })

  test('the previous plan is not mutated', async () => {
    const before = start(['A', 'B'])
    const copy = JSON.parse(JSON.stringify(before))
    applyReport(before, { done: [1, 2], title: 'Other' })
    expect(before).toEqual(copy)
  })
})

describe('sanitize', () => {
  test('anything but an object reads as an empty report', async () => {
    expect(sanitize(null)).toEqual({})
    expect(sanitize('steps')).toEqual({})
    expect(sanitize(42)).toEqual({})
  })

  test('steps that are not a list are dropped', async () => {
    expect(sanitize({ steps: 'A, B' }).steps).toBeUndefined()
  })

  test('step texts are trimmed; blank and non-text steps are left out', async () => {
    expect(sanitize({ steps: ['  A ', '', '   ', 3, null, 'B'] }).steps).toEqual(['A', 'B'])
  })

  test('a plan is capped at the step limit', async () => {
    const steps = Array.from({ length: LIMITS.steps + 20 }, (_, i) => `Step ${i + 1}`)
    expect(sanitize({ steps }).steps?.length).toBe(LIMITS.steps)
  })

  test('long texts are clipped with an ellipsis', async () => {
    const input = sanitize({ title: 't'.repeat(500), steps: ['s'.repeat(500)] })
    expect(input.title?.length).toBe(LIMITS.title)
    expect(input.title?.endsWith('…')).toBe(true)
    expect(input.steps?.[0]?.length).toBe(LIMITS.stepText)
  })

  test('step numbers must be whole and at least 1', async () => {
    expect(sanitize({ current: 0 }).current).toBeUndefined()
    expect(sanitize({ current: 1.5 }).current).toBeUndefined()
    expect(sanitize({ current: '2' }).current).toBeUndefined()
    expect(sanitize({ current: 2 }).current).toBe(2)
    expect(sanitize({ done: [1, 0, -1, 2.5, '3', 4] }).done).toEqual([1, 4])
    expect(sanitize({ done: 3 }).done).toBeUndefined()
  })

  test('flags count only when they are exactly true', async () => {
    expect(sanitize({ finished: 'yes', clear: 1 })).toEqual({})
    expect(sanitize({ finished: true, clear: true })).toEqual({ finished: true, clear: true })
  })
})

describe('drawing helpers', () => {
  test('bar fills in proportion to the steps done', async () => {
    expect(bar(0, 4, 8)).toBe('░░░░░░░░')
    expect(bar(2, 4, 8)).toBe('████░░░░')
    expect(bar(4, 4, 8)).toBe('████████')
    expect(bar(1, 3, 10)).toBe('███░░░░░░░')
  })

  test('bar keeps its width whatever it is given', async () => {
    expect(bar(0, 0, 5)).toBe('░░░░░')
    expect(bar(9, 3, 5)).toBe('█████')
    expect(bar(1, 2, -3)).toBe('')
    expect(bar(1, 2, 4.7).length).toBe(4)
  })

  test('counts and summary report done, total and the step in hand', async () => {
    const p = applyReport(start(['A', 'B', 'C']), { done: [1], current: 2 })!
    expect(counts(p)).toEqual({ done: 1, total: 3 })
    expect(summary(p)).toBe('Task: 1/3, now step 2')
    expect(summary(applyReport(p, { finished: true })!)).toBe('Task: 3/3')
  })

  test('mark gives each status its glyph', async () => {
    expect(mark({ text: 'x', status: 'done' })).toBe('✓')
    expect(mark({ text: 'x', status: 'active' })).toBe('▶')
    expect(mark({ text: 'x', status: 'pending' })).toBe('○')
  })

  test('stepWindow shows every step when there is room', async () => {
    expect(stepWindow(start(['A', 'B', 'C']), 12)).toEqual({ start: 0, count: 3 })
    expect(stepWindow(start(['A', 'B', 'C']), undefined)).toEqual({ start: 0, count: 3 })
  })

  test('stepWindow centres a long plan on the step in hand and stays inside it', async () => {
    const steps = Array.from({ length: 20 }, (_, i) => `S${i + 1}`)
    const middle = applyReport(start(steps), { current: 10 })!
    expect(stepWindow(middle, 5)).toEqual({ start: 7, count: 4 })
    const end = applyReport(start(steps), { current: 20 })!
    expect(stepWindow(end, 5)).toEqual({ start: 16, count: 4 })
    const first = start(steps)
    expect(stepWindow(first, 5)).toEqual({ start: 0, count: 4 })
    expect(stepWindow(first, 1)).toEqual({ start: 0, count: 1 })
  })
})
