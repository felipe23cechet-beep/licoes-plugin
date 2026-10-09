// /idea — guarda uma ideia no meio do trabalho, sem parar o turno e sem gastar token.
//
// 1) `/idea <texto>` acrescenta uma linha datada ao IDEIAS.md na raiz do projeto (viaja com ele, como o PROGRESSO.md).
// 2) `/idea` sozinho mostra todas. Ninguém chama o modelo: o mod responde sozinho.
// 3) `immediate`: digitado com o Claude trabalhando, roda na hora e o turno segue (comando sem isso espera o fim do
//    turno). Ideia chega no meio do trabalho, e é aí que ela se perde (pedido do dono, 08/10/2026).
// 4) Comando registrado, não skill: skill de plugin não aceita `immediate` (os campos do cabeçalho de skill não o têm,
//    conferido no Claude Code 2.1.293). O custo: no app, o comando aparece no menu depois da primeira mensagem.
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

// O plugin licoes junta os mods num módulo só (hooks/licoes.ts): lá, o COMANDO se registra no session.start do passa-bastão.
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
