import type { Register } from 'claude-code'
import { register as passaBastao, outrosComandos } from './passa-bastao.ts'
import { COMANDO as idea, ganchos as ideias } from './ideias.ts'
import { COMANDO as budget, ganchos as orcamento } from './budget.ts'

export const register: Register = on => {
  outrosComandos.push(idea, budget)
  passaBastao(on)
  ideias(on)
  orcamento(on)
}
