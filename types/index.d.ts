export type StepStatus = 'pending' | 'active' | 'done'
export type Step = { text: string; status: StepStatus }
/** The plan of the task in hand, as Claude last reported it through the `progress` tool. */
export type Plan = { title: string; steps: Step[] }

declare module 'claude-code' {
  interface PluginState {
    'plan-progress': { plan: Shaped<Plan | null>; isBandHidden: boolean; isBandOpen: boolean; isPaneOpen: boolean }
  }
}
