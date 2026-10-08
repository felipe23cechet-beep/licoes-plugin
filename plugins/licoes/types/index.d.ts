// O contrato do mod: o que ele guarda em `$.state` (sobrevive à recarga do código).
export type PassaBastaoPastas = string[]
declare module 'claude-code' {
  interface PluginState {
    'licoes': { pastas: PassaBastaoPastas }
  }
}
