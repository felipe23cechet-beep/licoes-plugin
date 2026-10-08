// O contrato do mod: o que ele guarda em `$.state` (sobrevive à recarga do código).
export type PassaBastaoPastas = string[]
// A passagem em curso: o que as variáveis do módulo perdem numa recarga.
export type PassaBastaoPassagem = {
  fase: 'livre' | 'pedido' | 'pronto' | 'falhou' | 'cancelado'
  pedidoEm: number
  forcado: boolean
  comecouEm: number
  conversou: boolean
  // O turno acabou e o `passar` estava marcado: a recarga cancelou o relógio, o session.start retoma.
  agendado: boolean
}
// O que o /panel desenha; tokens null = ainda sem medida. O resto vem de $.session.usage (ausente antes da 1ª medida).
export type PassaBastaoPainel = {
  tokens: number | null
  ultimoFim: number
  // Um turno principal rodando: o cache está em uso.
  emTurno?: boolean
  agora: number
  limite: number
  // Janelas do plano (five_hour, seven_day): % usado e quando zera (ms; null = sem data).
  limites?: { janela: string; pct: number; zeraEm: number | null }[]
  // US$ do chat, a preço de API; null = o motor não tem.
  custo?: number | null
  // As maiores linhas do /context que ocupam a janela, já traduzidas.
  partes?: { nome: string; tokens: number }[]
  // Tudo o que ocupa menos a conversa: com quanto um chat novo nasceria.
  chatNovo?: number | null
  memoria?: { arquivo: string; tokens: number } | null
}
declare module 'claude-code' {
  interface PluginState {
    'licoes': { pastas: PassaBastaoPastas; passagem: PassaBastaoPassagem; painel: PassaBastaoPainel }
  }
}
