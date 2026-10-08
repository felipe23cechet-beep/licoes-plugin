import type { EngineInterface, Register } from 'claude-code'

// Passa-bastão (base LIÇÕES GERAIS, FERRAMENTAS §14): em vez do autocompact, um chat novo que recomeça do arquivo de estado.
// 1) Barra de status: minutos que restam do cache (1 h) e o tamanho do contexto.
// 2) Ao passar de LIMITE tokens NO MEIO do turno, pede ao agente que grave o estado e o prompt de
//    retomada em ARQUIVO, junto do resultado de uma ferramenta (um turno longo passa de 150 a 167 mil
//    sem parar, e a compactação automática chegava primeiro). Quando o turno acaba, a 1ª linha do
//    arquivo decide: CONTINUAR (ou sem marca) limpa a conversa (/clear) e cola o prompt; ESPERAR
//    (o próximo passo só depende da pessoa, ou a lista acabou) NÃO limpa: avisa, e /passa-bastao cola.
//    Exceção de 03/10/2026: o /clear escondeu a resposta final e o chat novo seguiu sem o sim do dono.
//    O pedido não é parada (05/10/2026): "algo para ler" valia ESPERAR, e o agente parou com a lista pela metade.
// 3) Turno que acaba sozinho acima do limite, sem pedido: só avisa, uma vez.
// 4) /passa-bastao: com o prompt pronto, cola na hora; sem ele, pede, e ao fim do turno limpa sempre.
//    Se o arquivo não vier, não limpa nada.
// 5) Esc no meio da passagem cancela: não limpa, e só pede de novo depois de o contexto baixar ou pelo /passa-bastao.
// 6) Mensagem nova da pessoa entre o fim do turno e a limpeza cancela a limpeza (04/10/2026: o /clear ficou na fila
//    atrás da mensagem, rodou 8 min depois, apagou a resposta final e colou um prompt velho).
// 8) O estado do mod se perde (uma recarga zera as variáveis e cancela os timers): o fim do turno confere o arquivo
//    mesmo assim — gravado neste turno e não USADO, vale o que ele diz (06/10/2026: o agente gravou CONTINUAR e o chat
//    ficou parado, sem limpar nem avisar). E a passagem que falha avisa, em vez de calar.
// 7) /passa-bastao num chat sem conversa não pede estado: cola o prompt que o chat anterior deixou pronto, ou diz que
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

// Bem abaixo da compactação: com este mod os projetos gravam autoCompactWindow de 250 mil (compacta em ~210 mil), porque
// um só resultado de ferramenta soma até ~30 mil e, na janela de 200 mil (~167 mil), passava o pedido e a compactação juntos.
// PASSA_BASTAO_LIMITE muda o número (para testar com pouco contexto).
let LIMITE = 150_000
const CACHE_MS = 60 * 60 * 1000
const ARQUIVO = '.passa-bastao.md'

const pedido = (motivo: string) => [
  `[passa-bastão] ${motivo} Isto NÃO é motivo para parar: é a troca de chat, e o trabalho segue no chat novo. Grave a passagem em NO MÁXIMO 3 chamadas de ferramenta, sem reler nada (o que precisa já está na conversa):`,
  `1. UMA edição no arquivo de estado do projeto (o PROGRESSO.md, se houver), com a linha do título do bloco como âncora: onde parou e o próximo passo.`,
  `2. UMA gravação de \`${ARQUIVO}\`: o prompt de retomada, na voz do dono, que um chat novo vai receber colado. Com CONTINUAR, ele COMEÇA pela seção "PARA O DONO": o que foi feito e o que foi ACHADO neste chat, uma linha por item, com o número; e, citados ao pé da letra, os pedidos e perguntas que o dono fez neste chat, cada um com o que foi feito dele ou "ainda não" (o dono não lê o prompt colado, e o chat que some leva junto o que ninguém repetir). Se o prompt que abriu ESTE chat já trazia uma "PARA O DONO", ela segue somada à nova — ninguém a entregou ainda. Logo abaixo, a ordem: "esta seção só se entrega quando o trabalho PARAR de vez: no resumo da mensagem final do turno que espera o dono, junto do que você fizer, respondendo cada pedido marcado ainda não. Nunca no começo de um chat, nem numa passagem com CONTINUAR (aí ela segue somada no próximo prompt)". Com ESPERAR, o arquivo vai SEM essa seção: o relato vai na sua mensagem final (passo 3). Depois, o que ler primeiro e o que fazer em seguida. Sem chave, senha ou token no texto: o arquivo fica no disco e viaja pela nuvem.`,
  `   A 1ª linha do arquivo é só a marca: \`CONTINUAR\` se ainda há item decidido que não depende do dono — o padrão, mesmo com um relato a fazer (o relato vai somado na seção PARA O DONO e chega a ele quando o trabalho parar de vez; o mod limpa a conversa e cola o prompt),`,
  `   ou \`ESPERAR\` só se o próximo passo só depende do dono (escolha dele, coisa que só ele faz, ação irreversível, mudança de direção) ou se a lista decidida acabou: aí o mod NÃO limpa, e ele cola com /passa-bastao quando quiser.`,
  `3. Encerre o turno. Com CONTINUAR, a mensagem final é UMA linha só ("Passagem gravada; o chat recomeça sozinho."): sem resumo, sem prompt, sem a frase do chat novo — o mod limpa a conversa logo depois e ninguém a lê; o relato vai na seção PARA O DONO do prompt. Isto vale acima de qualquer regra de resumo do projeto. Se a marca for ESPERAR, ESTA é a mensagem que para de vez: o resumo dela traz o relato inteiro — a PARA O DONO que o prompt deste chat trazia, somada ao que este chat fez e achou — e responde cada pedido do dono; depois, o bloco do chat novo como sempre: o PROMPT inteiro, o mesmo texto do arquivo sem a marca — sem citar o comando /passa-bastao (a pessoa cola o prompt num chat novo; o comando não se menciona).`,
].join('\n')
const PEDIDO = pedido('O contexto chegou ao limite de passagem.')
const PEDIDO_DA_PESSOA = pedido('A pessoa pediu a passagem para um chat novo (/passa-bastao).')

// livre → pedido → (CONTINUAR) limpa e volta a livre · (ESPERAR) pronto, até a pessoa pedir ou o trabalho voltar.
let fase: 'livre' | 'pedido' | 'pronto' | 'falhou' | 'cancelado' = 'livre'
let pedidoEm = 0
// A pessoa pediu (/passa-bastao): limpa mesmo com ESPERAR.
let forcado = false
// O aviso do turno que acabou sozinho acima do limite já saiu.
let avisado = false
// Turnos que acabaram depois do pedido sem o arquivo: outro turno (um sub-agente que volta, uma
// mensagem na fila) pode acabar antes do que atende o pedido. Só desiste no segundo.
let semArquivo = 0
let ultimoFim = 0
let tokens: number | undefined
// Turnos principais iniciados: se mudou entre o fim do turno e a limpeza, a pessoa voltou a conversar.
let iniciados = 0
// Este chat já teve conversa (zera no /clear).
let conversou = false
// Quando o turno principal em curso começou (0 = desconhecido, depois de uma recarga).
let comecouEm = 0
// Sem o início do turno, o arquivo vale se for desta meia hora.
const JANELA_MS = 30 * 60_000

// O tipo de `pastas` mora no contrato do mod, types/index.d.ts.
const PASTAS = { plugin: 'licoes', key: 'pastas' } as const

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
  $.ui.log(`passa-bastão: a passagem falhou: ${String(erro)}`, { to: 'debug' })
  $.ui.toast(`A passagem falhou (${String(erro).slice(0, 120)}); NÃO limpei. /passa-bastao tenta de novo`, {
    timeoutMs: 15_000,
  })
}

// O prompt gravado durante este turno e ainda não colado, se houver.
async function arquivoDoTurno($: EngineInterface) {
  const desde = comecouEm || (await $.clock.now()) - JANELA_MS
  return lerArquivo($, desde)
}

async function mostrar($: EngineInterface) {
  const agora = await $.clock.now()
  const k = tokens === undefined ? '?' : `${Math.round(tokens / 1000)} mil`
  if (ultimoFim === 0) return $.ui.status(`contexto ${k}`)
  const resta = Math.ceil((CACHE_MS - (agora - ultimoFim)) / 60_000)
  $.ui.status(
    resta > 0
      ? `cache ${resta} min · contexto ${k}`
      : `cache vencido · contexto ${k}: chat novo sai mais barato`,
  )
}

async function pedir($: EngineInterface) {
  fase = 'pedido'
  semArquivo = 0
  pedidoEm = await $.clock.now()
  $.ui.toast('Pedindo o estado para abrir um chat novo')
  void $.prompt.submit({ text: PEDIDO_DA_PESSOA }).catch(err => falhou($, err))
}

// O prompt gravado depois de `desde`, sem a linha da marca. Sem marca vale CONTINUAR; USADO já foi colado.
async function lerArquivo($: EngineInterface, desde = pedidoEm) {
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

// Colado uma vez: um /passa-bastao num chat vazio, depois, não cola o mesmo prompt de novo.
const marcarUsado = ($: EngineInterface, arq: { texto: string; caminho: string }) =>
  $.fs.write(arq.caminho, `USADO\n${arq.texto}\n`).catch(() => {})

// A pessoa mandou mensagem depois do fim do turno: a conversa seguiu, e a limpeza apagaria a resposta.
function desistir($: EngineInterface) {
  fase = 'livre'
  forcado = false
  semArquivo = 0
  $.ui.toast('Você mandou outra mensagem antes da limpeza; NÃO limpei a conversa. /passa-bastao quando quiser', {
    timeoutMs: 10_000,
  })
}

async function passar($: EngineInterface, turno: number, tentou = false) {
  if (iniciados !== turno) return desistir($)
  const arq = await lerArquivo($)
  if (iniciados !== turno) return desistir($)
  if (!arq) {
    // A gravação pode chegar um pouco depois do fim do turno (disco na nuvem): olha de novo antes de contar o turno.
    if (!tentou) return void $.clock.after(3_000, () => void passar($, turno, true).catch(err => falhou($, err)))
    if (++semArquivo < 2) return
    fase = 'falhou'
    forcado = false
    $.ui.toast(`${ARQUIVO} não foi gravado; NÃO limpei a conversa`, { timeoutMs: 10_000 })
    return
  }
  semArquivo = 0
  if (arq.esperar && !forcado) {
    fase = 'pronto'
    // Sem aviso (07/10/2026): o prompt já vem na resposta, e a pessoa o cola num chat novo — não digita o comando.
    void mostrar($).catch(() => {})
    return
  }
  fase = 'livre'
  forcado = false
  avisado = false
  ultimoFim = 0
  tokens = undefined
  await $.command.run({ command: 'clear' })
  conversou = false
  await marcarUsado($, arq)
  await $.prompt.submit({ text: arq.texto, asUser: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const n = Number(await $.env.get('PASSA_BASTAO_LIMITE').catch(() => undefined))
    if (n > 0) LIMITE = n
    await pastasVistas($)
    await $.command.register({
      name: 'passa-bastao',
      description: 'Grava o estado, limpa a conversa e recomeça num chat novo (passa-bastão)',
    })
    $.clock.every(60_000, () => void mostrar($).catch(() => {}))
    void mostrar($).catch(() => {})
    return next(e)
  })

  // Pedido pela pessoa: limpa sempre. Com o prompt já pronto, cola na hora, sem pedir de novo.
  on('command.run', { command: 'passa-bastao' }, async $ => {
    // Chat sem conversa: não há estado a gravar. Cola o prompt que o chat anterior deixou, se houver.
    if (!conversou && fase !== 'pronto' && fase !== 'pedido') {
      const arq = await lerArquivo($, 0)
      if (!arq) return { text: `passa-bastão: este chat ainda não tem conversa, e não há prompt pronto em ${ARQUIVO}. Nada a passar.` }
      await marcarUsado($, arq)
      $.clock.after(500, () => void $.prompt.submit({ text: arq.texto, asUser: true }).catch(() => {}))
      return { text: 'passa-bastão: colando o prompt que o chat anterior deixou pronto.' }
    }
    forcado = true
    // Passagem que falhou com o prompt já gravado: cola esse, sem pedir de novo.
    if (fase === 'falhou' && (await arquivoDoTurno($))) fase = 'pronto'
    if (fase === 'pronto') {
      fase = 'pedido'
      const turno = iniciados
      $.clock.after(500, () => void passar($, turno).catch(err => falhou($, err)))
      return { text: 'passa-bastão: limpando a conversa e colando o prompt pronto.' }
    }
    if (fase === 'pedido') return { text: 'passa-bastão: a passagem já foi pedida; quando o turno acabar, a conversa recomeça.' }
    fase = 'pedido'
    $.clock.after(500, () => void pedir($).catch(err => falhou($, err)))
    return { text: 'passa-bastão: vou pedir o estado ao agente; quando ele gravar, a conversa recomeça.' }
  })

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
    $.ui.toast('Pedindo o estado para abrir um chat novo')
    return { ...r, context: [...(r.context ?? []), PEDIDO] }
  })

  // Um /clear (da pessoa ou deste mod) começa um chat sem conversa.
  on('command.run', async ($, e, next) => {
    const r = await next(e)
    if (e.command === 'clear') conversou = false
    return r
  })

  on('turn.start', async ($, e, next) => {
    iniciados++
    comecouEm = await $.clock.now()
    await pastasVistas($).catch(() => {})
    conversou = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    conversou = true
    ultimoFim = await $.clock.now()
    tokens = (await $.session.usage()).context.tokens
    void mostrar($).catch(() => {})
    // Esc no meio da passagem: a pessoa quer o chat como está. Não limpa nem pede de novo neste contexto.
    if (e.isAborted) {
      if (fase === 'pedido') {
        fase = 'cancelado'
        forcado = false
        $.ui.toast('Passagem cancelada (Esc). Não limpo a conversa; /passa-bastao quando quiser', { timeoutMs: 10_000 })
      }
      return r
    }
    // Depois de uma compactação o contexto volta a caber: a passagem pode ser pedida de novo.
    if ((tokens ?? 0) < LIMITE) {
      avisado = false
      if (fase === 'falhou' || fase === 'cancelado') fase = 'livre'
    }
    // Fora do dispatch do turno: o /clear e o prompt novo só rodam com a sessão parada.
    if (fase === 'pedido') {
      const turno = iniciados
      $.clock.after(1500, () => void passar($, turno).catch(err => falhou($, err)))
    }
    // O pedido se perdeu (recarga) mas o arquivo deste turno está lá: segue o que ele diz.
    else if (fase === 'livre' && (tokens ?? 0) >= LIMITE && (await arquivoDoTurno($))) {
      fase = 'pedido'
      pedidoEm = comecouEm || (await $.clock.now()) - JANELA_MS
      semArquivo = 0
      const turno = iniciados
      $.clock.after(1500, () => void passar($, turno).catch(err => falhou($, err)))
    }
    // Acabou sozinho acima do limite: a última mensagem é para a pessoa. Não pede nem limpa; avisa uma vez.
    else if (fase === 'livre' && (tokens ?? 0) >= LIMITE && !avisado) {
      avisado = true
      $.ui.toast(
        `Contexto acima de ${Math.round(LIMITE / 1000)} mil; o próximo trabalho pede a passagem sozinho, ou /passa-bastao agora`,
        { timeoutMs: 10_000 },
      )
    }
    return r
  })
}
