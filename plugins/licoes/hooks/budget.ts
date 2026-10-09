import type { EngineInterface, Register } from 'claude-code'

const barra = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '')

async function script($: EngineInterface) {
  if ($.plugin.name !== 'budget') return barra($.plugin.root) + '/scripts/economia.js'
  const casa = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
  return barra(casa) + '/.claude/ganchos/economia.js'
}

async function budget($: EngineInterface, e: { args: string }) {

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
