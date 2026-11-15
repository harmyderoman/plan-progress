// The plan's logic, free of the engine: what one report from Claude does to the plan, and how it is drawn as text.
// Kept apart from register.tsx so it can be tested on its own (see plan.test.ts).
import type { Plan, Step } from '../types'

/** What Claude sends to the `progress` tool, as the schema describes it. */
export type ProgressInput = {
  title?: string
  steps?: string[]
  current?: number
  done?: number[]
  finished?: boolean
  clear?: boolean
}

/** Limits that keep a runaway report from filling the screen or the session state. */
export const LIMITS = { steps: 50, stepText: 200, title: 120 } as const

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const isStepNumber = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1

/**
 * The tool's arguments as the plan logic can trust them. The model's input is not guaranteed to follow the schema,
 * so every field is checked: wrong types are dropped, texts are trimmed and clipped, blank steps are left out.
 */
export function sanitize(raw: unknown): ProgressInput {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: ProgressInput = {}
  if (typeof input.title === 'string') {
    const title = input.title.trim()
    if (title) out.title = clip(title, LIMITS.title)
  }
  if (Array.isArray(input.steps)) {
    out.steps = input.steps
      .filter((s): s is string => typeof s === 'string')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, LIMITS.steps)
      .map(s => clip(s, LIMITS.stepText))
  }
  if (isStepNumber(input.current)) out.current = input.current
  if (Array.isArray(input.done)) out.done = input.done.filter(isStepNumber)
  if (input.finished === true) out.finished = true
  if (input.clear === true) out.clear = true
  return out
}

/** The plan after one report; null when it is cleared or there is none. Expects input that went through `sanitize`. */
export function applyReport(prev: Plan | null, input: ProgressInput): Plan | null {
  if (input.clear) return null
  let next: Plan | null = prev
  if (input.steps?.length) {
    next = {
      title: input.title || prev?.title || 'Plan',
      steps: input.steps.map((text, i): Step => ({ text, status: i === 0 ? 'active' : 'pending' })),
    }
  } else if (next && input.title) {
    next = { ...next, title: input.title }
  }
  if (!next) return null
  const total = next.steps.length
  // A step number past the end of the plan is ignored rather than clearing the step in hand.
  const current = input.current !== undefined && input.current <= total ? input.current : undefined
  const done = new Set(input.done ?? [])
  const steps = next.steps.map((step, i): Step => {
    const n = i + 1
    if (input.finished || done.has(n)) return { ...step, status: 'done' }
    if (current === n) return { ...step, status: 'active' }
    // A new current step leaves the old one where it was unless it is marked done.
    if (current !== undefined && step.status === 'active') return { ...step, status: 'pending' }
    return step
  })
  return { ...next, steps }
}

export const counts = (p: Plan) => ({ done: p.steps.filter(s => s.status === 'done').length, total: p.steps.length })

/** A text bar, drawn the same on every surface: ███████░░░░░ */
export function bar(done: number, total: number, width: number): string {
  const w = Math.max(0, Math.floor(width))
  const filled = total > 0 ? Math.min(w, Math.max(0, Math.round((done / total) * w))) : 0
  return '█'.repeat(filled) + '░'.repeat(w - filled)
}

/** One line on where the plan stands, as the tool answers Claude and `/progress` answers the person. */
export function summary(p: Plan): string {
  const { done, total } = counts(p)
  const active = p.steps.findIndex(s => s.status === 'active')
  return `${p.title}: ${done}/${total}${active >= 0 ? `, now step ${active + 1}` : ''}`
}

/** The glyph a step is listed with: ✓ done, ▶ in progress, ○ ahead. */
export const mark = (step: Step) => (step.status === 'done' ? '✓' : step.status === 'active' ? '▶' : '○')

/**
 * Which steps fit under the band's bar when the plan is longer than the room: a window around the step in hand.
 * Returns the index of the first step shown and how many are shown.
 */
export function stepWindow(p: Plan, maxRows: number | undefined): { start: number; count: number } {
  const total = p.steps.length
  const room = Math.max(1, (maxRows ?? total + 1) - 1)
  const active = p.steps.findIndex(s => s.status === 'active')
  const anchor = active >= 0 ? active : counts(p).done
  const start = Math.min(Math.max(0, anchor - Math.floor(room / 2)), Math.max(0, total - room))
  return { start, count: Math.min(room, total - start) }
}
