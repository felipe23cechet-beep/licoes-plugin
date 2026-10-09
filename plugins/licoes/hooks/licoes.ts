// O plugin aceita UM módulo de ganchos (hooks.json `modules`) e um só `session.start` sem matcher; este liga os mods
// da base copiados ao lado pelo montar-plugin: o session.start é o do passa-bastão, e os comandos dos outros entram no outrosComandos.
import type { Register } from 'claude-code'
import { register as passaBastao, outrosComandos } from './passa-bastao.ts'
import { COMANDO as idea, ganchos as ideias } from './ideias.ts'

export const register: Register = on => {
  outrosComandos.push(idea)
  passaBastao(on)
  ideias(on)
}
