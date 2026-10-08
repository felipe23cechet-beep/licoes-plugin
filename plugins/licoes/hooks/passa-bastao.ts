import type { EngineInterface, Register, RenderElement } from 'claude-code'
import type { PassaBastaoPainel } from '../types'

// Passa-bastão (base LIÇÕES GERAIS, FERRAMENTAS §14): em vez do autocompact, um chat novo que recomeça do arquivo de estado.
// 1) Barra de status: minutos que restam do cache (1 h) e o tamanho do contexto.
// 2) Ao passar de LIMITE tokens NO MEIO do turno, pede ao agente que grave o estado e o prompt de
//    retomada em ARQUIVO, junto do resultado de uma ferramenta (um turno longo passa de 150 a 167 mil
//    sem parar, e a compactação automática chegava primeiro). Quando o turno acaba, a 1ª linha do
//    arquivo decide: CONTINUAR (ou sem marca) limpa a conversa (/clear) e cola o prompt; ESPERAR
//    (o próximo passo só depende da pessoa, ou a lista acabou) NÃO limpa: avisa, e /pass-baton cola.
//    Exceção de 03/10/2026: o /clear escondeu a resposta final e o chat novo seguiu sem o sim do dono.
//    O pedido não é parada (05/10/2026): "algo para ler" valia ESPERAR, e o agente parou com a lista pela metade.
// 3) Turno que acaba sozinho acima do limite, sem pedido: só avisa, uma vez.
// 4) /pass-baton: com o prompt pronto, cola na hora; sem ele, pede, e ao fim do turno limpa sempre.
//    Se o arquivo não vier, não limpa nada.
// 5) Esc no meio da passagem cancela: não limpa, e só pede de novo depois de o contexto baixar ou pelo /pass-baton.
// 6) Mensagem nova da pessoa entre o fim do turno e a limpeza cancela a limpeza (04/10/2026: o /clear ficou na fila
//    atrás da mensagem, rodou 8 min depois, apagou a resposta final e colou um prompt velho).
// 8) O estado do mod se perde (uma recarga zera as variáveis e cancela os timers): o fim do turno confere o arquivo
//    mesmo assim — gravado neste turno e não USADO, vale o que ele diz (06/10/2026: o agente gravou CONTINUAR e o chat
//    ficou parado, sem limpar nem avisar). E a passagem que falha avisa, em vez de calar. Mas nunca o que foi gravado
//    antes de ESTE chat começar (08/10/2026: carregado no meio do turno, o mod colou o prompt do chat anterior depois da
//    resposta de parada, e o chat seguiu trabalhando contra a vontade do dono).
// 7) /pass-baton num chat sem conversa não pede estado: cola o prompt que o chat anterior deixou pronto, ou diz que
//    não há o que passar (04/10/2026: pedia "o contexto chegou ao limite" num chat vazio).
// 10) O relato não se perde (07/10/2026): com CONTINUAR a resposta final some com o /clear e o dono não lê o prompt colado;
//     a triagem inteira de um repositório e as perguntas dele sumiram assim. O prompt leva a seção PARA O DONO, somada de troca em troca,
//     e ela só se entrega quando o trabalho PARA de vez — no resumo final do turno que espera o dono. Nunca no começo de
//     um chat depois do /clear (correção do dono, 07/10/2026: "aí eu não vou ler nada").
// 9) O arquivo se procura na RAIZ do projeto, não na pasta em que a sessão está: um `cd` do agente no terminal muda a
//    pasta da sessão, e o arquivo gravado na raiz ficava invisível (06/10/2026, duas vezes: o mod procurou na pasta da
//    base, aberta por `cd`, e esperou calado). Vale o mais novo das duas pastas.
// 11) E a RAIZ também muda: no app, o `cd` do agente leva junto a pasta principal da sessão (07/10/2026, terceira vez:
//     raiz e pasta foram as duas para a pasta do mod, e o arquivo gravado no projeto ficou invisível). O mod guarda
//     toda pasta que a sessão já teve, em `$.state` (que sobrevive à recarga), e procura em todas.
// 12) A recarga logo DEPOIS do fim do turno (o agente editou um arquivo do mod no turno: a recarga espera o fim dele)
//     cancelava o relógio de 1,5 s do `passar`, e a passagem com CONTINUAR se perdia (07/10/2026 21:31). A passagem em
//     curso mora em `$.state`; o session.start da recarga a devolve às variáveis e, se o `passar` estava marcado, o marca de novo.
// 13) /panel: a faixa do contexto até o limite e o que o ocupa, com quanto um chat novo nasceria, o cache, os limites
//     do plano (5 h e semana) e quando zeram, o custo do chat e a passagem em curso. Grava o limites.json (o app não tem barra).

// Bem abaixo da compactação: com este mod os projetos gravam autoCompactWindow de 250 mil (compacta em ~210 mil), porque
// um só resultado de ferramenta soma até ~30 mil e, na janela de 200 mil (~167 mil), passava o pedido e a compactação juntos.
// PASSA_BASTAO_LIMITE muda o número (para testar com pouco contexto).
let LIMITE = 150_000
const CACHE_MS = 60 * 60 * 1000
const ARQUIVO = '.passa-bastao.md'
// Solto (CLAUDE_CODE_PLUGIN_DIRS), o mod registra /pass-baton e /panel ao abrir a sessão. Dentro do plugin licoes, os dois
// são skills do plugin (/licoes:pass-baton, /licoes:panel), que aparecem no menu antes da sessão abrir e que este mod
// responde sem chamar o modelo; o montar-plugin troca as duas linhas abaixo (08/10/2026: no app, os comandos registrados
// só apareciam depois da primeira mensagem, e o dono procurou por /licoes:).
const REGISTRAR = false
const PASSAR = '/licoes:pass-baton'

const pedido = (motivo: string) => [
  `[passa-bastão] ${motivo} Isto NÃO é motivo para parar: é a troca de chat, e o trabalho segue no chat novo. Grave a passagem em NO MÁXIMO 3 chamadas de ferramenta, sem reler nada (o que precisa já está na conversa):`,
  `1. UMA edição no arquivo de estado do projeto (o PROGRESSO.md, se houver), com a linha do título do bloco como âncora: onde parou e o próximo passo.`,
  `2. UMA gravação de \`${ARQUIVO}\`: o prompt de retomada, na voz do dono, que um chat novo vai receber colado. Com CONTINUAR, ele COMEÇA pela seção "PARA O DONO": o que foi feito e o que foi ACHADO neste chat, uma linha por item, com o número; e, citados ao pé da letra, os pedidos e perguntas que o dono fez neste chat, cada um com o que foi feito dele ou "ainda não" (o dono não lê o prompt colado, e o chat que some leva junto o que ninguém repetir). Se o prompt que abriu ESTE chat já trazia uma "PARA O DONO", ela segue somada à nova — ninguém a entregou ainda. Logo abaixo, a ordem: "esta seção só se entrega quando o trabalho PARAR de vez: no resumo da mensagem final do turno que espera o dono, junto do que você fizer, respondendo cada pedido marcado ainda não. Nunca no começo de um chat, nem numa passagem com CONTINUAR (aí ela segue somada no próximo prompt)". Com ESPERAR, o arquivo vai SEM essa seção: o relato vai na sua mensagem final (passo 3). Depois, o que ler primeiro e o que fazer em seguida. Sem chave, senha ou token no texto: o arquivo fica no disco e viaja pela nuvem.`,
  `   A 1ª linha do arquivo é só a marca: \`CONTINUAR\` se ainda há item decidido que não depende do dono — o padrão, mesmo com um relato a fazer (o relato vai somado na seção PARA O DONO e chega a ele quando o trabalho parar de vez; o mod limpa a conversa e cola o prompt),`,
  `   ou \`ESPERAR\` só se o próximo passo só depende do dono (escolha dele, coisa que só ele faz, ação irreversível, mudança de direção), se a lista decidida acabou, ou se o dono pediu para PARAR neste chat ("vou parar", "para aqui", "continuo depois") — pedido de parada é ESPERAR, mesmo com item pela frente: aí o mod NÃO limpa, e ele cola com ${PASSAR} quando quiser.`,
  `3. Encerre o turno. Com CONTINUAR, a mensagem final é UMA linha só ("Passagem gravada; o chat recomeça sozinho."): sem resumo, sem prompt, sem a frase do chat novo — o mod limpa a conversa logo depois e ninguém a lê; o relato vai na seção PARA O DONO do prompt. Isto vale acima de qualquer regra de resumo do projeto. Se a marca for ESPERAR, ESTA é a mensagem que para de vez: o resumo dela traz o relato inteiro — a PARA O DONO que o prompt deste chat trazia, somada ao que este chat fez e achou — e responde cada pedido do dono; depois, o bloco do chat novo como sempre: o PROMPT inteiro, o mesmo texto do arquivo sem a marca — sem citar o comando ${PASSAR} (a pessoa cola o prompt num chat novo; o comando não se menciona).`,
].join('\n')
const PEDIDO = pedido('O contexto chegou ao limite de passagem.')
const PEDIDO_DA_PESSOA = pedido(`A pessoa pediu a passagem para um chat novo (${PASSAR}).`)

// livre → pedido → (CONTINUAR) limpa e volta a livre · (ESPERAR) pronto, até a pessoa pedir ou o trabalho voltar.
let fase: 'livre' | 'pedido' | 'pronto' | 'falhou' | 'cancelado' = 'livre'
let pedidoEm = 0
// A pessoa pediu (/pass-baton): limpa mesmo com ESPERAR.
let forcado = false
// O aviso do turno que acabou sozinho acima do limite já saiu.
let avisado = false
// Turnos que acabaram depois do pedido sem o arquivo: outro turno (um sub-agente que volta, uma
// mensagem na fila) pode acabar antes do que atende o pedido. Só desiste no segundo.
let semArquivo = 0
let ultimoFim = 0
// Um turno principal está rodando: cada chamada ao modelo renova o cache, então ele está em uso.
let emTurno = false
// Quando os limites que a barra mostra foram medidos (por esta sessão ou, no limites.json, por outra).
let limitesEm = 0
let tokens: number | undefined
// Turnos principais iniciados: se mudou entre o fim do turno e a limpeza, a pessoa voltou a conversar.
let iniciados = 0
// Este chat já teve conversa (zera no /clear).
let conversou = false
// Quando o turno principal em curso começou (0 = desconhecido, depois de uma recarga).
let comecouEm = 0
// Sem o início do turno, o arquivo vale se for desta meia hora.
const JANELA_MS = 30 * 60_000

// O fim do turno marcou o `passar` e ele ainda não pegou o arquivo.
let agendado = false

// Os tipos de `pastas` e `passagem` moram no contrato do mod, types/index.d.ts.
const PASTAS = { plugin: 'licoes', key: 'pastas' } as const
const PASSAGEM = { plugin: 'licoes', key: 'passagem' } as const
const PAINEL = { plugin: 'licoes', key: 'painel' } as const
const PANE = 'passa-bastao'
const mil = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)} mil` : `${Math.round(n)} tok`)

const guardar = ($: EngineInterface) =>
  $.state.set(PASSAGEM, { fase, pedidoEm, forcado, comecouEm, conversou, agendado }).catch(() => {})

// O fim do turno marca o `passar` fora do dispatch: o /clear e o prompt novo só rodam com a sessão parada.
function agendar($: EngineInterface, turno: number) {
  agendado = true
  $.clock.after(1500, () => void passar($, turno).catch(err => falhou($, err)))
}

// Toda pasta que a sessão já teve (raiz e pasta atual), a de agora primeiro. Guarda as novas.
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

// O prompt gravado durante este turno e ainda não colado, se houver.
async function arquivoDoTurno($: EngineInterface) {
  const desde = comecouEm || (await $.clock.now()) - JANELA_MS
  return lerArquivo($, desde)
}

// O que o motor mede de graça (limites do plano, custo, divisão do contexto), para o /panel. Muda no fim do turno.
let medida: Pick<PassaBastaoPainel, 'limites' | 'custo' | 'partes' | 'chatNovo' | 'memoria'> = {}
// As linhas do /context, traduzidas; a que falta aparece como o motor a chama.
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

// `summary` estima sem chamar a API: não custa nada. No app não há barra de status, então quem grava o
// limites.json (de onde o gancho chat-parado avisa em 80% e 95%) é este mod, no formato da statusline.js.
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

// Os limites que o motor acabou de medir: na barra e no limites.json. Sem plano, nada se grava fora do projeto.
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

// O limites.json, quando outra sessão o gravou depois da última medida desta: a barra não nasce sem os limites
// nem fica parada no número velho enquanto outro chat gasta (08/10/2026).
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

// Na barra: 5 h e semana, com o que já zerou desde a medida mostrado como 0%.
const JANELAS_CURTAS: Record<string, string> = { five_hour: '5h', seven_day: 'sem' }
function limitesNaBarra(agora: number) {
  return (medida.limites ?? [])
    .filter(l => JANELAS_CURTAS[l.janela])
    .map(l => `${JANELAS_CURTAS[l.janela]} ${l.zeraEm && l.zeraEm <= agora ? 0 : Math.round(l.pct)}%`)
}

async function mostrar($: EngineInterface) {
  const agora = await $.clock.now()
  // O painel se redesenha quando isto muda.
  void $.state.set(PAINEL, { tokens: tokens ?? null, ultimoFim, emTurno, agora, limite: LIMITE, ...medida }).catch(() => {})
  // Curta: a faixa do app corta em ~40 caracteres depois do nome do plugin (print do dono, 08/10/2026).
  // A ordem é a da urgência; o que se corta primeiro é a semana. O /panel diz por extenso.
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

// O prompt gravado depois de `desde`, sem a linha da marca. Sem marca vale CONTINUAR; USADO já foi colado.
// Só o deste chat (o /clear recomeça a conta), salvo `doAnterior`: o /pass-baton num chat vazio.
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

// Colado uma vez: um /pass-baton num chat vazio, depois, não cola o mesmo prompt de novo.
const marcarUsado = ($: EngineInterface, arq: { texto: string; caminho: string }) =>
  $.fs.write(arq.caminho, `USADO\n${arq.texto}\n`).catch(() => {})

// A pessoa mandou mensagem depois do fim do turno: a conversa seguiu, e a limpeza apagaria a resposta.
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
  // A gravação pode chegar um pouco depois do fim do turno (disco na nuvem): olha de novo antes de contar o turno.
  if (!arq && !tentou) return void $.clock.after(3_000, () => void passar($, turno, true).catch(err => falhou($, err)))
  // Daqui em diante o `passar` decidiu: uma recarga não o marca de novo (nunca dois /clear).
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
    // Sem aviso (07/10/2026): o prompt já vem na resposta, e a pessoa o cola num chat novo — não digita o comando.
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

// /panel (ou /licoes:panel, no plugin).
async function painel($: EngineInterface) {
  await medir($).catch(() => {})
  await mostrar($).catch(() => {})
  await $.ui.open({ id: PANE, title: 'Passa-bastão' })
  return { text: 'painel aberto.' }
}

// Pedido pela pessoa: limpa sempre. Com o prompt já pronto, cola na hora, sem pedir de novo.
async function passarAgora($: EngineInterface) {
  // Chat sem conversa: não há estado a gravar. Cola o prompt que o chat anterior deixou, se houver.
  if (!conversou && fase !== 'pronto' && fase !== 'pedido') {
    const arq = await lerArquivo($, 0, true)
    if (!arq) return { text: `este chat ainda não tem conversa, e não há prompt pronto em ${ARQUIVO}. Nada a passar.` }
    await marcarUsado($, arq)
    $.clock.after(500, () => void $.prompt.submit({ text: arq.texto, asUser: true }).catch(() => {}))
    return { text: 'colando o prompt que o chat anterior deixou pronto.' }
  }
  forcado = true
  // Passagem que falhou com o prompt já gravado: cola esse, sem pedir de novo.
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
    // Recarga: a passagem em curso volta às variáveis; com o `passar` marcado e cancelado, marca de novo (uma vez).
    const salvo = (await $.state.get(PASSAGEM).catch(() => undefined))?.value
    if (salvo) {
      ;({ fase, pedidoEm, forcado, comecouEm, conversou } = salvo)
      if (salvo.agendado && fase === 'pedido') {
        $.ui.log('recarga depois do fim do turno; retomando a passagem', { to: 'debug' })
        agendar($, iniciados)
      }
    }
    if (REGISTRAR) {
      await $.command.register({
        name: 'pass-baton',
        description: 'Grava o estado, limpa a conversa e recomeça num chat novo (passa-bastão)',
      })
      await $.command.register({ name: 'panel', description: 'Painel do passa-bastão: contexto até o limite, cache e passagem' })
    }
    // Os limites do plano na barra desde o começo: o motor só os mede depois da primeira resposta.
    await lerLimites($).catch(() => {})
    // A cada 30 s: o contexto (no meio de um turno longo, o fim do turno demora) e os limites que outra sessão gravou.
    $.clock.every(30_000, () => void atualizar($).catch(() => {}))
    void mostrar($).catch(() => {})
    return next(e)
  })

  // O motor avisa quando um limite andou um ponto (a cada resposta, também no meio do turno) e no fim de cada turno.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await guardarLimites($, e.rateLimits).catch(() => {})
    if (typeof e.context.tokens === 'number') tokens = e.context.tokens
    void mostrar($).catch(() => {})
    return next(e)
  })

  // Os dois nomes: o do mod solto e o da skill do plugin.
  on('command.run', { command: 'panel' }, painel)
  on('command.run', { command: 'licoes:panel' }, painel)

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

  // No meio do turno: o pedido vai junto do resultado da ferramenta, que só o modelo lê. Com o
  // prompt pronto (ESPERAR) e o trabalho de volta, aquele prompt envelheceu: pede outro.
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

  // Um /clear (da pessoa ou deste mod) começa um chat sem conversa.
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
    // A conversa seguiu: um `passar` marcado antes de uma recarga não volta (o `passar` vivo desiste sozinho).
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
    // Esc no meio da passagem: a pessoa quer o chat como está. Não limpa nem pede de novo neste contexto.
    if (e.isAborted) {
      if (fase === 'pedido') {
        fase = 'cancelado'
        forcado = false
        await guardar($)
        $.ui.toast(`Passagem cancelada (Esc). Não limpo a conversa; ${PASSAR} quando quiser`, { timeoutMs: 10_000 })
      }
      return r
    }
    // Depois de uma compactação o contexto volta a caber: a passagem pode ser pedida de novo.
    if ((tokens ?? 0) < LIMITE) {
      avisado = false
      if (fase === 'falhou' || fase === 'cancelado') fase = 'livre'
    }
    if (fase === 'pedido') agendar($, iniciados)
    // O pedido se perdeu (recarga) mas o arquivo deste turno está lá: segue o que ele diz.
    else if (fase === 'livre' && (tokens ?? 0) >= LIMITE && (await arquivoDoTurno($))) {
      fase = 'pedido'
      pedidoEm = comecouEm || (await $.clock.now()) - JANELA_MS
      semArquivo = 0
      agendar($, iniciados)
    }
    // Acabou sozinho acima do limite: a última mensagem é para a pessoa. Não pede nem limpa; avisa uma vez.
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
