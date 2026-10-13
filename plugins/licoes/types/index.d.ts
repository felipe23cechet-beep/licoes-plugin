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
    'licoes': { pending: Learning[]; savedThisSession: SavedRule[]; pastas: PassaBastaoPastas; passagem: PassaBastaoPassagem; painel: PassaBastaoPainel }
  }
}


export type Learning = {
  id: string
  
  rule: string
  scope: 'global' | 'project'
  
  project: string
  
  count: number
  firstAt: number
  lastAt: number
  status: 'pending' | 'saved' | 'skipped'
  confidence: number
  
  session?: string
}

export type SavedRule = { rule: string; scope: 'global' | 'project'; project: string }

export type ReflectState = {
  
  pending: Learning[]
  
  savedThisSession: SavedRule[]
}
