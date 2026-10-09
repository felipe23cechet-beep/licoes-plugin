export type PassaBastaoPastas = string[]

export type PassaBastaoPassagem = {
  fase: 'livre' | 'pedido' | 'pronto' | 'falhou' | 'cancelado'
  pedidoEm: number
  forcado: boolean
  comecouEm: number
  conversou: boolean

  agendado: boolean
}

export type PassaBastaoPainel = {
  tokens: number | null
  ultimoFim: number

  emTurno?: boolean
  agora: number
  limite: number

  limites?: { janela: string; pct: number; zeraEm: number | null }[]

  custo?: number | null

  partes?: { nome: string; tokens: number }[]

  chatNovo?: number | null
  memoria?: { arquivo: string; tokens: number } | null
}
declare module 'claude-code' {
  interface PluginState {
    'licoes': { pastas: PassaBastaoPastas; passagem: PassaBastaoPassagem; painel: PassaBastaoPainel }
  }
}
