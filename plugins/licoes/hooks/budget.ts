// /budget — para onde foi o uso dos últimos dias, em dólar (o `economia.js --budget`), sem gastar token.
//
// 1) `/budget [dias] [here]` roda o script e devolve a saída como veio. Ninguém chama o modelo: US$ 0.
// 2) `immediate`: digitado com o Claude trabalhando, roda na hora e o turno segue (pedido do dono, 09/10/2026: a skill
//    /licoes:budget chamava o modelo, ~US$ 0,005, e esperava o fim do turno).
// 3) Roda por `$.process.run`, como um gancho de settings: sem pedir permissão e sem entrar na conversa (o
//    `$.tool.call` Bash pediria a permissão da pessoa e deixaria a saída no contexto).
// 4) O script: no plugin, `<raiz do plugin>/scripts/economia.js`; solto, `~/.claude/ganchos/economia.js`, onde o §7 do
//    LEIA-PRIMEIRO o instala. Sem o mod, a skill licoes-budget faz o mesmo pelo modelo.
import type { EngineInterface, Register } from 'claude-code'

const barra = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '')

async function script($: EngineInterface) {
  if ($.plugin.name !== 'budget') return barra($.plugin.root) + '/scripts/economia.js'
  const casa = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
  return barra(casa) + '/.claude/ganchos/economia.js'
}

async function budget($: EngineInterface, e: { args: string }) {
  // só os dois argumentos que o script entende; o resto se ignora (não há shell, mas também não há por que repassar)
  const args = e.args.split(/\s+/).filter(a => /^\d{1,4}$/.test(a) || /^(here|aqui)$/i.test(a))
  const r = await $.process.run(['node', await script($), '--budget', ...args], { timeoutMs: 120000 })
    .catch((err: unknown) => ({ exitCode: 1, stdout: '', stderr: String(err) }))
  if (r.exitCode !== 0 || !r.stdout.trim()) return { text: `/budget não rodou: ${(r.stderr || 'sem saída').trim().split('\n')[0]}` }
  return { text: r.stdout.trimEnd() }
}

export const COMANDO = {
  name: 'budget',
  description: 'Para onde foi o uso dos últimos dias, em dólar; [dias] (padrão 7) e here = só este projeto (licoes)',
  argumentHint: '[dias] [here]',
  immediate: true,
}

// O plugin licoes junta os mods num módulo só (hooks/licoes.ts): lá, o COMANDO se registra no session.start do passa-bastão.
export const ganchos: Register = on => {
  on('command.run', { command: 'budget' }, budget)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register(COMANDO)
    return next(e)
  })
  ganchos(on)
}
