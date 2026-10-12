import type { Register } from 'claude-code'
import { register as passaBastao, outrosComandos } from './passa-bastao.ts'
import { COMANDO as idea, ganchos as ideias } from './ideias.ts'
import { COMANDO as budget, ganchos as orcamento } from './budget.ts'
import { COMANDO as reflectCmd, ganchos as reflect } from './reflect.ts'

export const register: Register = (on, options) => {
  outrosComandos.push(idea, budget, reflectCmd)
  passaBastao(on)
  ideias(on)
  orcamento(on)
  reflect(on, options)
}
