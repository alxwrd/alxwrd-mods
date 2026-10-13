export type Speaking = boolean

declare module 'claude-code' {
  interface PluginState {
    'speak-aloud': { isOn: boolean; speed: number }
  }
}
