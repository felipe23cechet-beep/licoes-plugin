import type { EngineInterface, Register, RenderElement } from 'claude-code'
import type { PassaBastaoPainel } from '../types'

let LIMITE = 150_000
const CACHE_MS = 60 * 60 * 1000
const ARQUIVO = '.passa-bastao.md'

const REGISTRAR = false
const PASSAR = '/licoes:pass-baton'

export const outrosComandos: Parameters<EngineInterface['command']['register']>[0][] = []

const pedido = (motivo: string) => [
  `[passa-bastão] ${motivo} Isto NÃO é motivo para parar: é a troca de chat, e o trabalho segue no chat novo. Grave a passagem em NO MÁXIMO 3 chamadas de ferramenta, sem reler nada (o que precisa já está na conversa):`,
  `1. UMA edição no arquivo de estado do projeto (o PROGRESSO.md, se houver), com a linha do título do bloco como âncora: onde parou e o próximo passo.`,
  `2. UMA gravação de \`${ARQUIVO}\`: o prompt de retomada, na voz do dono, que um chat novo vai receber colado. Com CONTINUAR, ele COMEÇA pela seção "O QUE JÁ FOI FEITO": o que foi feito e o que foi ACHADO, uma linha por item, com o número; e, citados ao pé da letra, os pedidos e perguntas do dono, cada um com o que foi feito dele ou "ainda não" (o dono não lê o prompt colado, e o chat que some leva junto o que ninguém repetir). Se o prompt que abriu ESTE chat já trazia essa seção, FUNDA as duas numa lista só — nunca um bloco por chat, nem "Do chat de…": o mesmo assunto vira uma linha, o item que um chat depois mudou fica só no estado final, e pedido já respondido sai da lista de pedidos e entra como feito. Logo abaixo, a ordem: "esta seção só se entrega quando o trabalho PARAR de vez: no resumo da mensagem final do turno que espera o dono, junto do que você fizer, respondendo cada pedido marcado ainda não. Nunca no começo de um chat, nem numa passagem com CONTINUAR (aí ela segue somada no próximo prompt)". Com ESPERAR, o arquivo vai SEM essa seção: o relato vai na sua mensagem final (passo 3). Depois, o que ler primeiro e o que fazer em seguida. Sem chave, senha ou token no texto: o arquivo fica no disco e viaja pela nuvem.`,
  `   A 1ª linha do arquivo é só a marca: \`CONTINUAR\` se ainda há item decidido que não depende do dono — o padrão, mesmo com um relato a fazer (o relato vai fundido na seção O QUE JÁ FOI FEITO e chega a ele quando o trabalho parar de vez; o mod limpa a conversa e cola o prompt),`,
  `   ou \`ESPERAR\` só se o próximo passo só depende do dono (escolha dele, coisa que só ele faz, ação irreversível, mudança de direção), se a lista decidida acabou, ou se o dono pediu para PARAR neste chat ("vou parar", "para aqui", "continuo depois") — pedido de parada é ESPERAR, mesmo com item pela frente: aí o mod NÃO limpa, e ele cola com ${PASSAR} quando quiser.`,
  `3. Encerre o turno. Com CONTINUAR, a mensagem final é UMA linha só ("Passagem gravada; o chat recomeça sozinho."): sem resumo, sem prompt, sem a frase do chat novo — o mod limpa a conversa logo depois e ninguém a lê; o relato vai na seção O QUE JÁ FOI FEITO do prompt. Isto vale acima de qualquer regra de resumo do projeto. Se a marca for ESPERAR, ESTA é a mensagem que para de vez: o resumo dela traz o relato inteiro — a seção O QUE JÁ FOI FEITO que o prompt deste chat trazia, fundida ao que este chat fez e achou, DENTRO dos blocos normais do resumo (o que foi feito, decisões, o que ficou por provar), sem título próprio nem divisão por chat — e responde cada pedido do dono; depois, o bloco do chat novo como sempre: o PROMPT inteiro, o mesmo texto do arquivo sem a marca — sem citar o comando ${PASSAR} (a pessoa cola o prompt num chat novo; o comando não se menciona).`,
].join('\n')
const PEDIDO = pedido('O contexto chegou ao limite de passagem.')
const PEDIDO_DA_PESSOA = pedido(`A pessoa pediu a passagem para um chat novo (${PASSAR}).`)

let fase: 'livre' | 'pedido' | 'pronto' | 'falhou' | 'cancelado' = 'livre'
let pedidoEm = 0

let forcado = false

let avisado = false

let semArquivo = 0
let ultimoFim = 0

let emTurno = false

let limitesEm = 0
let tokens: number | undefined

let iniciados = 0

let conversou = false

let comecouEm = 0

const JANELA_MS = 30 * 60_000

let agendado = false

const PASTAS = { plugin: 'licoes', key: 'pastas' } as const
const PASSAGEM = { plugin: 'licoes', key: 'passagem' } as const
const PAINEL = { plugin: 'licoes', key: 'painel' } as const
const PANE = 'passa-bastao'
const mil = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)} mil` : `${Math.round(n)} tok`)

const guardar = ($: EngineInterface) =>
  $.state.set(PASSAGEM, { fase, pedidoEm, forcado, comecouEm, conversou, agendado }).catch(() => {})

function agendar($: EngineInterface, turno: number) {
  agendado = true
  $.clock.after(1500, () => void passar($, turno).catch(err => falhou($, err)))
}

async function pastasVistas($: EngineInterface) {
  const agora = [await $.session.root().catch(() => ''), await $.session.cwd().catch(() => '')].filter(Boolean)
  const vistas: string[] = (await $.state.get(PASTAS).catch(() => undefined))?.value ?? []
  const todas = [...new Set([...agora, ...vistas])].slice(0, 12)
  if (todas.some(p => !vistas.includes(p))) await $.state.set(PASTAS, todas).catch(() => {})
  return todas
}

function falhou($: EngineInterface, erro: unknown) {
  fase = 'falhou'
  forcado = false
  agendado = false
  void guardar($)
  $.ui.log(`a passagem falhou: ${String(erro)}`, { to: 'debug' })
  $.ui.toast(`A passagem falhou (${String(erro).slice(0, 120)}); NÃO limpei. ${PASSAR} tenta de novo`, {
    timeoutMs: 15_000,
  })
}

async function arquivoDoTurno($: EngineInterface) {
  const desde = comecouEm || (await $.clock.now()) - JANELA_MS
  return lerArquivo($, desde)
}

let medida: Pick<PassaBastaoPainel, 'limites' | 'custo' | 'partes' | 'chatNovo' | 'memoria'> = {}

const NOMES: Record<string, string> = {
  Messages: 'conversa',
  'System prompt': 'prompt do sistema',
  'System tools': 'ferramentas',
  'MCP tools': 'ferramentas MCP',
  'Custom agents': 'agentes',
  'Memory files': 'memória (CLAUDE.md)',
  Skills: 'skills',
  'Slash commands': 'comandos',
}

async function medir($: EngineInterface) {
  const u = await $.session.usage({ breakdown: 'summary' })
  medida = { ...medida, custo: u.cost?.usd ?? null }
  await guardarLimites($, u.rateLimits ?? [])
  const b = u.context.breakdown
  if (b) {
    const usados = b.categories.filter(c => c.kind === 'used' && c.tokens > 0).sort((x, y) => y.tokens - x.tokens)
    const conversa = usados.filter(c => c.name === 'Messages').reduce((s, c) => s + c.tokens, 0)
    const m = [...b.memoryFiles].sort((x, y) => y.tokens - x.tokens)[0]
    medida = {
      ...medida,
      partes: usados.slice(0, 5).map(c => ({ nome: NOMES[c.name] ?? c.name, tokens: c.tokens })),
      chatNovo: usados.reduce((s, c) => s + c.tokens, 0) - conversa,
      memoria: m ? { arquivo: m.path.replaceAll('\\', '/').split('/').slice(-2).join('/'), tokens: m.tokens } : null,
    }
  }
}

async function guardarLimites($: EngineInterface, medidos: { kind: string; percentUsed: number; resetsAt?: string | null }[]) {
  const limites = medidos.map(l => ({
    janela: l.kind,
    pct: l.percentUsed,
    zeraEm: l.resetsAt ? Date.parse(l.resetsAt) || null : null,
  }))
  if (!limites.length) return
  medida = { ...medida, limites }
  limitesEm = await $.clock.now()
  const home = (await $.env.get('USERPROFILE').catch(() => undefined)) || (await $.env.get('HOME').catch(() => undefined))
  if (!home) return
  const arq: Record<string, unknown> = { gravado: limitesEm }
  for (const l of limites) arq[l.janela] = { pct: l.pct, volta: l.zeraEm ? Math.round(l.zeraEm / 1000) : undefined }
  await $.fs.write(`${home.replaceAll('\\', '/')}/.claude/ganchos/limites.json`, JSON.stringify(arq)).catch(() => {})
}

async function lerLimites($: EngineInterface) {
  const home = (await $.env.get('USERPROFILE').catch(() => undefined)) || (await $.env.get('HOME').catch(() => undefined))
  if (!home) return
  const arq = JSON.parse(await $.fs.read(`${home.replaceAll('\\', '/')}/.claude/ganchos/limites.json`))
  if (typeof arq.gravado !== 'number' || arq.gravado <= limitesEm) return
  const limites = Object.entries(arq)
    .filter(([, l]) => l && typeof l === 'object' && typeof (l as { pct?: unknown }).pct === 'number')
    .map(([janela, l]) => {
      const { pct, volta } = l as { pct: number; volta?: number }
      return { janela, pct, zeraEm: volta ? volta * 1000 : null }
    })
  if (limites.length) (medida = { ...medida, limites }), (limitesEm = arq.gravado)
}

const JANELAS_CURTAS: Record<string, string> = { five_hour: '5h', seven_day: 'sem' }
function limitesNaBarra(agora: number) {
  return (medida.limites ?? [])
    .filter(l => JANELAS_CURTAS[l.janela])
    .map(l => `${JANELAS_CURTAS[l.janela]} ${l.zeraEm && l.zeraEm <= agora ? 0 : Math.round(l.pct)}%`)
}

async function mostrar($: EngineInterface) {
  const agora = await $.clock.now()

  void $.state.set(PAINEL, { tokens: tokens ?? null, ultimoFim, emTurno, agora, limite: LIMITE, ...medida }).catch(() => {})

  const k = `ctx ${tokens === undefined ? '?' : `${Math.round(tokens / 1000)}k`}`
  const resta = Math.ceil((CACHE_MS - (agora - ultimoFim)) / 60_000)
  const partes = emTurno
    ? ['cache ativo', k]
    : ultimoFim === 0
      ? [k]
      : resta > 0
        ? [`cache ${resta}min`, k]
        : ['cache vencido', k]
  $.ui.status([...partes, ...limitesNaBarra(agora)].join(' · '))
}

async function atualizar($: EngineInterface) {
  const t = (await $.session.usage()).context.tokens
  if (typeof t === 'number') tokens = t
  await lerLimites($).catch(() => {})
  await mostrar($)
}

async function pedir($: EngineInterface) {
  fase = 'pedido'
  semArquivo = 0
  pedidoEm = await $.clock.now()
  await guardar($)
  $.ui.toast('Pedindo o estado para abrir um chat novo')
  void $.prompt.submit({ text: PEDIDO_DA_PESSOA }).catch(err => falhou($, err))
}

async function lerArquivo($: EngineInterface, desde = pedidoEm, doAnterior = false) {
  if (!doAnterior) desde = Math.max(desde, (await $.session.usage()).startedAt ?? 0)
  const pastas = await pastasVistas($)
  let caminho = ''
  let st: { mtimeMs: number } | undefined
  for (const pasta of pastas) {
    const c = `${pasta}/${ARQUIVO}`
    const s = await $.fs.stat(c).catch(() => undefined)
    if (s && (!st || s.mtimeMs > st.mtimeMs)) (st = s), (caminho = c)
  }
  if (!st || st.mtimeMs < desde) return undefined
  const linhas = (await $.fs.read(caminho)).trim().split('\n')
  const marca = (linhas[0] ?? '').replace(/[^A-Za-z]/g, '').toUpperCase()
  if (marca === 'USADO') return undefined
  const temMarca = marca === 'CONTINUAR' || marca === 'ESPERAR'
  const texto = (temMarca ? linhas.slice(1) : linhas).join('\n').trim()
  return texto ? { esperar: marca === 'ESPERAR', texto, caminho } : undefined
}

const marcarUsado = ($: EngineInterface, arq: { texto: string; caminho: string }) =>
  $.fs.write(arq.caminho, `USADO\n${arq.texto}\n`).catch(() => {})

function desistir($: EngineInterface) {
  fase = 'livre'
  forcado = false
  semArquivo = 0
  agendado = false
  void guardar($)
  $.ui.toast(`Você mandou outra mensagem antes da limpeza; NÃO limpei a conversa. ${PASSAR} quando quiser`, {
    timeoutMs: 10_000,
  })
}

async function passar($: EngineInterface, turno: number, tentou = false) {
  if (iniciados !== turno) return desistir($)
  const arq = await lerArquivo($)
  if (iniciados !== turno) return desistir($)

  if (!arq && !tentou) return void $.clock.after(3_000, () => void passar($, turno, true).catch(err => falhou($, err)))

  agendado = false
  if (!arq) {
    if (++semArquivo < 2) return void guardar($)
    fase = 'falhou'
    forcado = false
    void guardar($)
    $.ui.toast(`${ARQUIVO} não foi gravado; NÃO limpei a conversa`, { timeoutMs: 10_000 })
    return
  }
  semArquivo = 0
  if (arq.esperar && !forcado) {
    fase = 'pronto'
    void guardar($)

    void mostrar($).catch(() => {})
    return
  }
  fase = 'livre'
  forcado = false
  avisado = false
  ultimoFim = 0
  tokens = undefined
  conversou = false
  await guardar($)
  await $.command.run({ command: 'clear' })
  await marcarUsado($, arq)
  await $.prompt.submit({ text: arq.texto, asUser: true })
}

async function painel($: EngineInterface) {
  await medir($).catch(() => {})
  await mostrar($).catch(() => {})
  await $.ui.open({ id: PANE, title: 'Passa-bastão' })
  return { text: 'painel aberto.' }
}

async function passarAgora($: EngineInterface) {

  if (!conversou && fase !== 'pronto' && fase !== 'pedido') {
    const arq = await lerArquivo($, 0, true)
    if (!arq) return { text: `este chat ainda não tem conversa, e não há prompt pronto em ${ARQUIVO}. Nada a passar.` }
    await marcarUsado($, arq)
    $.clock.after(500, () => void $.prompt.submit({ text: arq.texto, asUser: true }).catch(() => {}))
    return { text: 'colando o prompt que o chat anterior deixou pronto.' }
  }
  forcado = true

  if (fase === 'falhou' && (await arquivoDoTurno($))) fase = 'pronto'
  if (fase === 'pronto') {
    fase = 'pedido'
    await guardar($)
    const turno = iniciados
    $.clock.after(500, () => void passar($, turno).catch(err => falhou($, err)))
    return { text: 'limpando a conversa e colando o prompt pronto.' }
  }
  if (fase === 'pedido') return { text: 'a passagem já foi pedida; quando o turno acabar, a conversa recomeça.' }
  fase = 'pedido'
  $.clock.after(500, () => void pedir($).catch(err => falhou($, err)))
  return { text: 'vou pedir o estado ao agente; quando ele gravar, a conversa recomeça.' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const n = Number(await $.env.get('PASSA_BASTAO_LIMITE').catch(() => undefined))
    if (n > 0) LIMITE = n
    await pastasVistas($)

    const salvo = (await $.state.get(PASSAGEM).catch(() => undefined))?.value
    if (salvo) {
      ;({ fase, pedidoEm, forcado, comecouEm, conversou } = salvo)
      if (salvo.agendado && fase === 'pedido') {
        $.ui.log('recarga depois do fim do turno; retomando a passagem', { to: 'debug' })
        agendar($, iniciados)
      }
    }
    const comandos: typeof outrosComandos = [
      { name: 'panel', description: 'Contexto até o limite, cache, limites do plano e passagem (licoes)', immediate: true },
      ...outrosComandos,
    ]
    if (REGISTRAR)
      comandos.unshift({ name: 'pass-baton', description: 'Grava o estado, limpa a conversa e recomeça num chat novo (passa-bastão)' })

    for (const c of comandos) await $.command.register(c).catch(err => $.ui.log(`/${c.name} não registrado: ${err}`, { to: 'debug' }))

    await lerLimites($).catch(() => {})

    $.clock.every(30_000, () => void atualizar($).catch(() => {}))
    void mostrar($).catch(() => {})
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await guardarLimites($, e.rateLimits).catch(() => {})
    if (typeof e.context.tokens === 'number') tokens = e.context.tokens
    void mostrar($).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'panel' }, painel)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const p = (await $.state.get(PAINEL)).value
    const fase = (await $.state.get(PASSAGEM)).value?.fase ?? 'livre'
    const limite = p?.limite ?? LIMITE
    const t = p?.tokens ?? null
    const agora = p?.agora ?? 0
    const linhas: { texto: string; cor?: string; apagado?: boolean }[] = []
    const faixa = (parte: number) => {
      const cheio = Math.round(Math.min(1, Math.max(0, parte)) * 20)
      return `${'█'.repeat(cheio)}${'░'.repeat(20 - cheio)}`
    }
    if (t === null) linhas.push({ texto: 'contexto: ainda sem medida (aparece no fim do primeiro turno)', apagado: true })
    else {
      const parte = Math.min(1, t / limite)
      linhas.push({
        texto: `contexto ${faixa(parte)} ${mil(t)} de ${mil(limite)} (${Math.round(parte * 100)}%)`,
        cor: parte >= 0.9 ? 'error' : parte >= 0.7 ? 'warning' : 'success',
      })
    }
    for (const c of p?.partes ?? []) linhas.push({ texto: `  ${c.nome}: ${mil(c.tokens)}`, apagado: true })
    if (typeof p?.chatNovo === 'number') linhas.push({ texto: `um chat novo nasceria com ~${mil(p.chatNovo)} (tudo menos a conversa)` })
    if (p?.memoria) linhas.push({ texto: `maior memória: ${p.memoria.arquivo}, ${mil(p.memoria.tokens)}`, apagado: true })
    if (p?.emTurno) linhas.push({ texto: 'cache: em uso (o turno está rodando)' })
    else if (!p?.ultimoFim) linhas.push({ texto: 'cache: nenhum turno acabou ainda', apagado: true })
    else {
      const resta = Math.ceil((CACHE_MS - (agora - p.ultimoFim)) / 60_000)
      linhas.push(resta > 0 ? { texto: `cache: ${resta} min` } : { texto: 'cache vencido: chat novo sai mais barato', cor: 'warning' })
    }
    const JANELAS: Record<string, string> = { five_hour: 'limite 5 h', seven_day: 'semana', spend_limit: 'gasto' }
    for (const l of p?.limites ?? []) {
      const falta = l.zeraEm ? l.zeraEm - agora : 0
      const zera = falta > 0 ? ` · zera em ${Math.floor(falta / 3_600_000)} h ${Math.floor((falta % 3_600_000) / 60_000)} min` : ''
      linhas.push({
        texto: `${(JANELAS[l.janela] ?? l.janela).padEnd(10)} ${faixa(l.pct / 100)} ${Math.round(l.pct)}%${zera}`,
        cor: l.pct >= 95 ? 'error' : l.pct >= 80 ? 'warning' : undefined,
      })
    }
    if (typeof p?.custo === 'number')
      linhas.push({ texto: `custo deste chat: US$ ${p.custo.toFixed(2).replace('.', ',')} (preço de API; na assinatura, sai do limite)` })
    const FASES = {
      livre: 'nenhuma passagem em curso',
      pedido: 'pedida: esperando o agente gravar o arquivo',
      pronto: 'pronta (ESPERAR): o prompt está na resposta, para colar num chat novo',
      falhou: `falhou: ${PASSAR} tenta de novo`,
      cancelado: `cancelada (Esc): ${PASSAR} quando quiser`,
    }
    linhas.push({ texto: `passagem: ${FASES[fase]}`, apagado: fase === 'livre' })
    return h(Box, { flexDirection: 'column' }, ...linhas.map(l => h(Text, { color: l.cor, dimColor: l.apagado }, l.texto))) as RenderElement
  })

  on('command.run', { command: 'pass-baton' }, passarAgora)
  on('command.run', { command: 'licoes:pass-baton' }, passarAgora)

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId || (fase !== 'livre' && fase !== 'pronto') || 'deny' in r) return r
    const t = (await $.session.usage()).context.tokens ?? 0
    if (t < LIMITE) return r
    fase = 'pedido'
    forcado = false
    semArquivo = 0
    pedidoEm = await $.clock.now()
    await guardar($)
    $.ui.toast('Pedindo o estado para abrir um chat novo')
    return { ...r, context: [...(r.context ?? []), PEDIDO] }
  })

  on('command.run', async ($, e, next) => {
    const r = await next(e)
    if (e.command === 'clear') (conversou = false), void guardar($)
    return r
  })

  on('turn.start', async ($, e, next) => {
    iniciados++
    emTurno = true
    void mostrar($).catch(() => {})
    comecouEm = await $.clock.now()
    await pastasVistas($).catch(() => {})
    conversou = true

    agendado = false
    await guardar($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    conversou = true
    emTurno = false
    ultimoFim = await $.clock.now()
    tokens = (await $.session.usage()).context.tokens
    void medir($).then(() => mostrar($)).catch(() => {})

    if (e.isAborted) {
      if (fase === 'pedido') {
        fase = 'cancelado'
        forcado = false
        await guardar($)
        $.ui.toast(`Passagem cancelada (Esc). Não limpo a conversa; ${PASSAR} quando quiser`, { timeoutMs: 10_000 })
      }
      return r
    }

    if ((tokens ?? 0) < LIMITE) {
      avisado = false
      if (fase === 'falhou' || fase === 'cancelado') fase = 'livre'
    }
    if (fase === 'pedido') agendar($, iniciados)

    else if (fase === 'livre' && (tokens ?? 0) >= LIMITE && (await arquivoDoTurno($))) {
      fase = 'pedido'
      pedidoEm = comecouEm || (await $.clock.now()) - JANELA_MS
      semArquivo = 0
      agendar($, iniciados)
    }

    else if (fase === 'livre' && (tokens ?? 0) >= LIMITE && !avisado) {
      avisado = true
      $.ui.toast(
        `Contexto acima de ${Math.round(LIMITE / 1000)} mil; o próximo trabalho pede a passagem sozinho, ou ${PASSAR} agora`,
        { timeoutMs: 10_000 },
      )
    }
    await guardar($)
    return r
  })
}
