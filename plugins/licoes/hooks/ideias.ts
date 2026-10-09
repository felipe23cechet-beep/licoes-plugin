import type { EngineInterface, Register } from 'claude-code'

const ARQUIVO = 'IDEIAS.md'
const TOPO = '# Ideias\n\nGuardadas com /idea; a mais nova embaixo. Apague a linha quando a ideia virar tarefa ou for descartada.\n\n'

const dois = (n: number) => String(n).padStart(2, '0')
const quando = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())} ${dois(d.getHours())}:${dois(d.getMinutes())}`
}

async function caminho($: EngineInterface) {
  const raiz = (await $.session.root().catch(() => '')) || (await $.session.cwd().catch(() => ''))
  return `${raiz.replace(/\\/g, '/').replace(/\/$/, '')}/${ARQUIVO}`
}

async function idea($: EngineInterface, e: { args: string }) {
  const c = await caminho($)
  const atual = await $.fs.read(c).catch(() => '')
  const texto = e.args.replace(/\s+/g, ' ').trim()
  if (!texto) {
    const ideias = atual.split('\n').filter(l => l.startsWith('- '))
    if (!ideias.length) return { text: `nenhuma ideia guardada neste projeto. /idea <texto> guarda uma.` }
    return { text: `${ideias.length} ideia${ideias.length > 1 ? 's' : ''} (${ARQUIVO}):\n${ideias.join('\n')}` }
  }
  const linha = `- ${quando(await $.clock.now())} — ${texto}\n`
  const base = atual ? (atual.endsWith('\n') ? atual : `${atual}\n`) : TOPO
  await $.fs.write(c, base + linha)
  return { text: `ideia guardada em ${ARQUIVO}. /idea mostra todas.` }
}

export const COMANDO = {
  name: 'idea',
  description: 'Guarda uma ideia no IDEIAS.md do projeto sem parar o Claude; /idea sozinho mostra todas',
  argumentHint: '[texto da ideia]',
  immediate: true,
}

export const ganchos: Register = on => {
  on('command.run', { command: 'idea' }, idea)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register(COMANDO)
    return next(e)
  })
  ganchos(on)
}
