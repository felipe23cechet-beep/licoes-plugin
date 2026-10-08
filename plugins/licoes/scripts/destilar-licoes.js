#!/usr/bin/env node
// Destilador de LIÇÕES — gancho SessionEnd do Claude Code (base LIÇÕES GERAIS, FERRAMENTAS §17).
//
// Quando um chat termina (fechar, /clear, sair), este gancho se reabre em SEGUNDO PLANO e devolve o controle na hora.
// Lá, lê o trecho novo da conversa (só o texto da pessoa e do agente; ferramenta e lembrete do sistema ficam de fora),
// manda ao Haiku pelo `claude -p` enxuto (`07`, "claude -p barato") com a PORTARIA do LEIA-PRIMEIRO §4.2 e os títulos das
// lições que já existem — e grava o que passar direto no `meu/LICOES-PROPRIAS.md`, com a marca ‹auto›.
// "Na dúvida, não escreva": o normal é sair sem lição nenhuma. Custo medido no FERRAMENTAS §17.
//
// FAXINA, com volta: a cada 7 dias (e só com 30 lições ou mais), o Haiku olha os TÍTULOS, aponta grupos do mesmo ato
// (duplicatas, ou uma que contradiz a outra) e funde cada grupo numa lição só — a mais nova vence. Antes de mexer, o
// arquivo inteiro vai para `meu/Archive/`, e o `meu/Archive/FAXINA.md` diz o que se fundiu e como voltar.
// Lição sem `‹nº›` não entra na faxina; texto fundido mais curto que 60% do maior original é recusado.
//
// Ideia: distill.py, end.js e tidy.py do vijcoelho/project-helena (MIT, commit c356888, CREDITOS.md). Daqui: a portaria
// e os vetos da base no pedido, o formato e a numeração do `meu/`, a faxina por grupo (o resto do arquivo fica byte a
// byte igual) e a cópia de volta antes de cada mudança.
//
// Ligar: ~/.claude/settings.json → hooks.SessionEnd E hooks.SessionStart, o mesmo command "node <caminho>/destilar-licoes.js"
// (no começo de cada chat ele lê os chats deste projeto parados há mais de 1 hora — "os chats parados", abaixo).
// Testar sem ligar nada e sem gastar:  node destilar-licoes.js --teste   (um `claude` de mentira, numa pasta temporária)
// Rodar à mão num chat:  node destilar-licoes.js --rodar <transcript.jsonl> <pasta do projeto> [--licoes <arquivo>]
// E o pedido que se REPETE vira skill na biblioteca ("o que se repete", abaixo). Desfazer: node destilar-licoes.js --desfazer <nome>
// E a biblioteca se cuida ("a biblioteca que se cuida", abaixo): a skill usada e corrigida ganha linha no "## Aprendido", com
// 5 linhas elas entram na receita (juntar), a ‹auto› sem uso há 30 dias vai para biblioteca/_arquivo (podar), e a cada 7
// dias sai um resumo sem LLM do que rodou sozinho (semana).
// Tudo o que rodou sozinho, com o comando de desfazer:  node destilar-licoes.js --listar
// Tirar uma lição do meu/ (volta com --desfazer licao <nº>):  node destilar-licoes.js --esquecer <nº>

'use strict';
const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path'),
  os = process.getBuiltinModule('os'), cp = process.getBuiltinModule('child_process');

const ESTADO = process.env.DESTILAR_ESTADO || path.join(os.homedir(), '.claude', 'ganchos', 'destilar');
const CLAUDE = process.env.DESTILAR_CLAUDE || 'claude';
const FLAGS = '-p --model haiku --tools "" --no-session-persistence --strict-mcp-config --disable-slash-commands '
  + '--setting-sources project --output-format json --max-budget-usd 0.10';
// MIN_MENSAGENS conta a conversa toda (pessoa + agente). Contava só as da pessoa (4+) e pulava quase tudo: quem cola um
// prompt e deixa o agente trabalhar manda 1 mensagem só — 13 de 15 chats deste projeto e 15 de 15 de outro (07/10/2026)
const MIN_MENSAGENS = 6, TETO_CHARS = 40000, POR_MENSAGEM = 2000, MAX_LICOES = 2;
const FAXINA_DIAS = 7, FAXINA_MIN = 30, FAXINA_GRUPOS = 3;

// a mesma lista do segredo-no-commit.js (FERRAMENTAS §16): mascara antes de mandar, e barra a lição que trouxer um
const SEGREDO = new RegExp([
  String.raw`\bsk[_-](live_|test_|ant-|proj-)?[A-Za-z0-9_-]{16,}`, String.raw`\b(pk|rk)_(live|test)_[A-Za-z0-9]{10,}`,
  String.raw`\bwhsec_[A-Za-z0-9]{20,}`, String.raw`\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}`, String.raw`\bAIza[0-9A-Za-z_-]{30,}`,
  String.raw`\bgh[pousr]_[A-Za-z0-9]{30,}`, String.raw`\bgithub_pat_[A-Za-z0-9_]{40,}`, String.raw`\bAKIA[0-9A-Z]{16}\b`,
  String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`, String.raw`\b\d{8,}:[A-Za-z0-9_-]{30,}`, String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`,
  String.raw`eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}`,
  String.raw`(key|token|secret|senha|password|passwd|api)[\w-]*["']?\s*[:=]\s*["']?[A-Za-z0-9_\-]{24,}`,
].join('|'), 'gi');
const temSegredo = s => { SEGREDO.lastIndex = 0; const r = SEGREDO.test(s); SEGREDO.lastIndex = 0; return r; };
const mascarar = s => s.replace(SEGREDO, '[segredo]');

// ---------- a base (mesma busca do chat-parado.js) ----------
function acharPasta(cwd) {
  const tem = d => d && fs.existsSync(path.join(d, 'modelos', 'fim-do-chat.js'));
  const ok = d => { if (tem(d)) return d; try { for (const s of fs.readdirSync(d).sort().reverse()) if (tem(path.join(d, s))) return path.join(d, s); } catch {} return null; };
  const e = ok(process.env.LICOES_DIR); if (e) return e;
  const cands = [path.join(os.homedir(), '.claude', 'settings.json')];
  if (cwd) cands.push(path.join(cwd, '.claude', 'settings.local.json'), path.join(cwd, '.claude', 'settings.json'));
  for (const f of cands) {
    try { for (const d of (JSON.parse(fs.readFileSync(f, 'utf8')).permissions || {}).additionalDirectories || []) { const b = ok(d); if (b) return b; } } catch {}
  }
  return null;
}

// ---------- estado (offset por transcript, data da última faxina) e trava ----------
const arqEstado = () => path.join(ESTADO, 'estado.json');
const lerEstado = () => { try { return JSON.parse(fs.readFileSync(arqEstado(), 'utf8')); } catch { return { lidos: {}, faxinaEm: 0 }; } };
const gravarEstado = e => { fs.mkdirSync(ESTADO, { recursive: true }); fs.writeFileSync(arqEstado(), JSON.stringify(e, null, 1)); };
const registrar = msg => { try { fs.mkdirSync(ESTADO, { recursive: true }); fs.appendFileSync(path.join(ESTADO, 'registro.log'), `${new Date().toISOString()} ${msg}\n`); } catch {} };
function travar() {
  const t = path.join(ESTADO, 'trava'); fs.mkdirSync(ESTADO, { recursive: true });
  try { if (Date.now() - fs.statSync(t).mtimeMs > 10 * 60 * 1000) fs.unlinkSync(t); } catch {}
  try { fs.closeSync(fs.openSync(t, 'wx')); return () => { try { fs.unlinkSync(t); } catch {} }; } catch { return null; }
}

// ---------- a conversa ----------
function textoDe(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter(b => b && b.type === 'text').map(b => b.text || '').join('\n');
}
function lerConversa(transcript, desde) {
  const linhas = fs.readFileSync(transcript, 'utf8').split('\n');
  const msgs = [];
  for (const l of linhas.slice(desde)) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.isMeta || o.isSidechain || (o.type !== 'user' && o.type !== 'assistant')) continue;
    let t = textoDe(o.message && o.message.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    if (!t || /^<(command-|local-command)/.test(t)) continue;
    if (t.length > POR_MENSAGEM) t = t.slice(0, POR_MENSAGEM) + ' […]';
    msgs.push({ quem: o.type === 'user' ? 'PESSOA' : 'AGENTE', t: mascarar(t) });
  }
  return { msgs, total: linhas.length - (linhas[linhas.length - 1] === '' ? 1 : 0) };
}

// ---------- o arquivo de lições ----------
function lerLicoes(arq) {
  const bruto = fs.readFileSync(arq, 'utf8'), crlf = bruto.includes('\r\n');
  const L = bruto.replace(/\r\n/g, '\n').split('\n');
  const ini = L.findIndex(x => /^## /.test(x) && /li[çc][õo]es|lessons/i.test(x));
  const entradas = [];
  for (let i = ini + 1; i < L.length; i++) {
    if (!/^### /.test(L[i])) continue;
    let fim = i + 1; while (fim < L.length && !/^#{2,3} /.test(L[fim])) fim++;
    const nr = (L[i].match(/‹nº (\d+)›/) || [])[1];
    entradas.push({ ini: i, fim, nr: nr ? Number(nr) : null, titulo: L[i], tema: (L[i].match(/‹tema: (\d+)›/) || [])[1] || '08' });
    i = fim - 1;
  }
  return { L, crlf, ini, entradas };
}
const gravarLicoes = (arq, d) => { const t = d.L.join('\n'); fs.writeFileSync(arq + '.tmp', d.crlf ? t.replace(/\n/g, '\r\n') : t); fs.renameSync(arq + '.tmp', arq); };
const norm = s => String(s || '').toLowerCase().replace(/[\s"'“”‘’`*_]+/g, ' ').trim();
const tituloLimpo = t => t.replace(/^### /, '').replace(/\s*‹[^›]*›/g, '').trim();

// ---------- o Haiku ----------
// pensar=false desliga o raciocínio do Haiku (MAX_THINKING_TOKENS=0): na triagem dos títulos ele gastava 5–8 mil tokens
// pensando e custava 3–4× mais; na destilação, sem pensar custou estável (US$ 0,042–0,046 por chat, contra 0,034–0,080)
// e escreveu menos lição de projeto. Só a fusão pensa: é ela que recusa o par ruim (medido em 06/10/2026, FERRAMENTAS §17).
// No Haiku 5.5 (o `haiku` desde 07/10/2026) a variável é ignorada — ele sempre pensa um pouco —, e não faz falta: em 2 chats
// reais, `--effort low` e o `medium` de fábrica deram as mesmas lições pelo mesmo US$ 0,002–0,004 (07/10/2026)
function perguntar(pedido, pensar = true, seFalhar, soTexto) {
  const r = cp.spawnSync(`${CLAUDE} ${FLAGS}`, { input: pedido, shell: true, cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true,
    timeout: 180000, env: { ...process.env, DESTILAR_FILHO: '1', ...(pensar ? {} : { MAX_THINKING_TOKENS: '0' }) } });
  if (r.status !== 0 && seFalhar) seFalhar();
  if (r.status !== 0) throw new Error(`claude -p saiu ${r.status}: ${(r.stderr || r.stdout || '').replace(/"usage":\{.*?"result"/s, '… "result"').slice(0, 600)}`);
  const o = JSON.parse(r.stdout);
  const txt = String(o.result || ''), j = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
  let json = {}; if (!soTexto) try { json = j ? JSON.parse(j) : {}; } catch { registrar(`resposta sem JSON válido: ${txt.slice(0, 120)}`); }
  return { json, txt, custo: o.total_cost_usd || 0 };
}

const PORTARIA = `Você lê o fim de uma conversa entre uma PESSOA e um AGENTE de programação (Claude Code) e decide se dela sai uma
LIÇÃO para a memória de longo prazo do agente. Quase sempre a resposta certa é NENHUMA.

Uma lição só entra se passar nas QUATRO perguntas:
1. Custou algo? Houve na conversa um erro, um retrabalho, ou a PESSOA corrigiu o AGENTE. Tarefa que correu bem não gera lição.
2. Muda o que o próximo agente FAZ? Uma regra que se executa, não uma curiosidade.
3. Vale fora deste projeto, desta máquina e desta pessoa? Regra de negócio, nome de tela, preferência pessoal: NÃO.
4. É nova? Se uma das lições existentes (lista abaixo) já trata do mesmo ato, devolva o título dela em "parecida_com".

NÃO são lição: uma decisão de produto ou de projeto que a conversa tomou (preço, limite, recurso desenhado); um número
daquele projeto; um recurso que o agente construiu e funcionou. Lição é o ERRO que custou e a regra que o impede.

Vetos absolutos: nenhuma chave, senha, token ou dado pessoal na lição; nada que o código ou o git já registram.
Na dúvida, não escreva.

Responda SÓ com JSON, sem texto em volta, no idioma das lições existentes:
{"licoes":[{"prova":"cópia LITERAL, da conversa, da frase que mostra o erro ou a PESSOA corrigindo o agente",
"titulo":"a regra, afirmativa e com as palavras que alguém usaria para procurar","tema":"07",
"aconteceu":"o caso real, em uma ou duas frases","regra":"o que fazer daqui para frente","parecida_com":""}]}
Sem a prova literal, a lição é descartada.
No máximo ${MAX_LICOES}. Sem lição: {"licoes":[]}
Temas: 01 arquitetura · 02 autenticação · 03 banco de dados · 04 tipos · 05 interface · 06 testes · 07 ambiente e ferramentas ·
08 processo de trabalho · 09 custo e modelos · 10 contexto e skills · 11 integrações e segurança · 12 sub-agentes.`;

// a skill da biblioteca que o agente usou e a pessoa corrigiu: a correção vira linha no "## Aprendido" dela (distill.py, Helena)
const APRENDIDO = nomes => `\n\nSKILLS DA BIBLIOTECA QUE O AGENTE USOU NESTE CHAT: ${nomes.join(', ')}. Se a PESSOA corrigiu ou melhorou um
trabalho feito com uma delas, acrescente ao JSON "aprendido":[{"skill":"um desses nomes","licao":"uma linha, no imperativo, que vale
da próxima vez","prova":"cópia LITERAL da frase da PESSOA corrigindo"}]. Só correção de verdade; sem ela, não ponha a chave.`;

function destilar(transcript, cwd, arqLicoes) {
  const est = lerEstado(), desde = est.lidos[transcript] || 0;
  const usou = usadas(transcript, desde);
  const { msgs, total } = lerConversa(transcript, desde);
  if (msgs.length < MIN_MENSAGENS) { registrar(`pulou (menos de ${MIN_MENSAGENS} mensagens) ${transcript}`); return; }
  let conversa = msgs.map(m => `${m.quem}: ${m.t}`).join('\n\n');
  if (conversa.length > TETO_CHARS) conversa = '[…]\n' + conversa.slice(-TETO_CHARS);
  const d = lerLicoes(arqLicoes);
  const titulos = d.entradas.map(e => '- ' + tituloLimpo(e.titulo)).join('\n');
  // e os títulos de FÁBRICA (01–12, FERRAMENTAS): sem eles o Haiku reescrevia como "nova" uma regra que o `09` já tinha
  // (06/10/2026, "Claude Code na nuvem só vê o repositório"). ~425 títulos ≈ 8 mil tokens ≈ US$ 0,008 por chat
  const base = path.dirname(path.dirname(arqLicoes));
  let fabrica = ''; try {
    for (const a of fs.readdirSync(base).filter(n => /^((0\d|1[0-2])-.*|FERRAMENTAS)\.md$/.test(n)).sort())
      fabrica += fs.readFileSync(path.join(base, a), 'utf8').split('\n').filter(l => /^#{2,3} /.test(l)).map(l => '- ' + l.replace(/^#+ /, '').trim()).join('\n') + '\n';
  } catch {}
  const { json, custo } = perguntar(`${PORTARIA}\n\nLIÇÕES EXISTENTES (as desta pessoa):\n${titulos}\n\nJÁ NA BASE (títulos de fábrica — o mesmo ato aqui também é "parecida_com"):\n${fabrica.slice(0, 40000)}\nCONVERSA:\n${conversa}${usou.length ? APRENDIDO(usou) : ''}`, false);
  for (const x of (Array.isArray(json.aprendido) ? json.aprendido : []).slice(0, 2)) {
    const prova = norm(x && x.prova).slice(0, 60), md = path.join(biblioteca(), String(x && x.skill || '_'), 'SKILL.md');
    const licao = String(x && x.licao || '').replace(/\s+/g, ' ').trim();
    if (!usou.includes(x && x.skill) || !licao || prova.length < 15 || !norm(conversa).includes(prova) || temSegredo(JSON.stringify(x)) || !fs.existsSync(md)) {
      registrar(`aprendido recusado: ${String(x && x.skill).slice(0, 40)}: ${licao.slice(0, 80)}`); continue;
    }
    aprender(md, `- ${new Date().toLocaleDateString('sv')}: ${licao}`);
    registrar(`aprendido: ${x.skill}: ${licao.slice(0, 120)}`);
    novidade(`a skill "${x.skill}" da biblioteca aprendeu com a sua correção: ${licao}. Não serve? node destilar-licoes.js --desfazer ${x.skill} aprendido`);
  }
  const novas = (Array.isArray(json.licoes) ? json.licoes : []).slice(0, MAX_LICOES).filter(x => {
    // a PROVA: o trecho que mostra o custo tem de estar, letra por letra, na conversa — o Haiku com raciocínio inventava
    // "custo" para decisão de produto que correu bem (06/10/2026, num chat real deste projeto)
    const prova = norm(x && x.prova).slice(0, 60), provada = prova.length >= 15 && norm(conversa).includes(prova);
    const ok = x && x.titulo && x.regra && x.aconteceu && provada && !String(x.parecida_com || '').trim() && !temSegredo(JSON.stringify(x));
    if (x && !ok) registrar(`recusou: ${String(x.titulo || '').slice(0, 80)}${x.parecida_com ? ' (parecida com ' + String(x.parecida_com).slice(0, 60) + ')' : provada ? '' : ' (sem prova literal)'}`);
    return ok;
  });
  if (novas.length) {
    const nr = gravarNovas(arqLicoes, novas, cwd, true);
    // novidade para o começo do próximo chat (a chatNovo do chat-parado.js conta à pessoa, uma vez, e apaga); o "gravou:" é do resumo da semana
    for (let k = 0; k < novas.length; k++) {
      const t = `lição ‹auto› nº ${nr + k} gravada no meu/: ${String(novas[k].titulo).replace(/\s+/g, ' ').trim()}`;
      novidade(t); registrar(`gravou: ${t}`);
    }
  }
  est.lidos[transcript] = total; gravarEstado(est);
  registrar(`destilou ${transcript}: ${novas.length} lição(ões), US$ ${custo.toFixed(4)}`);
}

// grava em cima, com o próximo nº do cabeçalho; devolve o nº da primeira. auto=false: a pessoa ditou (/licoes:lembrar), sem ‹auto›
function gravarNovas(arqLicoes, novas, cwd, auto) {
  const d2 = lerLicoes(arqLicoes); // relê: outra sessão pode ter escrito enquanto o Haiku pensava
  const iCab = d2.L.findIndex(x => /Próximo nº: \d+|Next no\.: \d+/.test(x));
  let nr = iCab >= 0 ? Number(d2.L[iCab].match(/(\d+)/)[1]) : Math.max(0, ...d2.entradas.map(e => e.nr || 0)) + 1;
  const primeira = nr, hoje = new Date().toLocaleDateString('pt-BR'), proj = path.basename(cwd || '') || '?';
  const bloco = [];
  for (const x of novas) {
    const tema = /^\d{2}$/.test(String(x.tema)) ? x.tema : '08';
    bloco.push(`### ${String(x.titulo).replace(/\s+/g, ' ').trim()} ‹tema: ${tema}› ‹nº ${nr}› ‹1×›${auto ? ' ‹auto›' : ''}`, '',
      `**O que aconteceu** *(${hoje}, ${proj}, ${auto ? 'destilado pelo Haiku — confira e tire o ‹auto›' : 'ditada pela pessoa'})*: ${String(x.aconteceu).trim()}`, '',
      `**A regra:** ${String(x.regra).trim()}`, '');
    nr++;
  }
  const onde = d2.entradas.length ? d2.entradas[0].ini : d2.L.length;
  d2.L.splice(onde, 0, ...bloco);
  if (iCab >= 0) d2.L[iCab] = d2.L[iCab].replace(/(Próximo nº: |Next no\.: )\d+/, `$1${nr}`);
  gravarLicoes(arqLicoes, d2);
  return primeira;
}

// ---------- a faxina, com volta ----------
function faxina(arqLicoes, forcar) {
  const est = lerEstado();
  if (!forcar && Date.now() - (est.faxinaEm || 0) < FAXINA_DIAS * 864e5) return;
  const d = lerLicoes(arqLicoes), comNr = d.entradas.filter(e => e.nr), quando = est.faxinaEm || 0;
  est.faxinaEm = Date.now(); gravarEstado(est);
  // o `claude -p` que falhou (o limite de uso acabou no meio, na prova real de 06/10/2026) não gasta a semana: tenta no próximo chat
  const devolver = () => { const e2 = lerEstado(); e2.faxinaEm = quando; gravarEstado(e2); };
  let falhou = false;
  if (comNr.length < FAXINA_MIN) { registrar(`faxina: só ${comNr.length} lições, nada a fazer`); return; }
  const lista = comNr.map(e => `${e.nr}: ${tituloLimpo(e.titulo)}`).join('\n');
  const g = perguntar(`FAXINA-GRUPOS. Abaixo, os títulos de lições de um agente de programação, com o número de cada uma.
Aponte SÓ os grupos em que duas ou mais lições tratam do MESMO ato — duplicatas, ou uma que contradiz a outra. Assunto
parecido não basta: tem de ser a mesma regra. Na dúvida, não agrupe. Responda SÓ com JSON:
{"grupos":[{"numeros":[12,40],"motivo":"..."}]}   — no máximo ${FAXINA_GRUPOS} grupos; nenhum: {"grupos":[]}\n\n${lista}`, false, devolver);
  const grupos = (g.json.grupos || []).filter(x => Array.isArray(x.numeros) && x.numeros.length >= 2).slice(0, FAXINA_GRUPOS);
  let custo = g.custo; const feitos = [];
  if (!grupos.length) { registrar(`faxina: nenhum grupo, US$ ${custo.toFixed(4)}`); return; }
  const volta = path.join(path.dirname(arqLicoes), 'Archive', `LICOES-PROPRIAS-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`);
  fs.mkdirSync(path.dirname(volta), { recursive: true }); fs.copyFileSync(arqLicoes, volta);
  for (const gr of grupos) try {
    const atual = lerLicoes(arqLicoes);
    const membros = gr.numeros.map(n => atual.entradas.find(e => e.nr === Number(n))).filter(Boolean);
    if (membros.length < 2) continue;
    // lição ‹auto› (ninguém conferiu) não se funde com lição conferida: a faxina real fundiu uma ‹auto› ruim na nº 57 (06/10/2026)
    if (new Set(membros.map(e => /‹auto›/.test(e.titulo))).size > 1) { registrar(`faxina: não funde ‹auto› com conferida (${membros.map(e => e.nr).join('+')})`); continue; }
    const corpo = e => atual.L.slice(e.ini + 1, e.fim).join('\n').trim();
    const maisNova = membros.reduce((a, b) => (b.nr > a.nr ? b : a));
    const textos = membros.map(e => `--- nº ${e.nr}\n${tituloLimpo(e.titulo)}\n${corpo(e)}`).join('\n\n');
    const f = perguntar(`FAXINA-FUNDIR. Primeiro confira, pelo TEXTO: elas dão a MESMA regra para o MESMO ato? Assunto parecido não basta
("as duas falam de Windows" não é o mesmo ato). Se não forem, responda com UMA linha: RECUSA: <por quê>.
Se forem, funda numa só. Guarde TODOS os casos e todas as regras que não se
contradizem; onde se contradizem, vale a de número maior (a mais nova) e diga em uma frase o que ela substituiu. Mesmo
idioma e mesmo formato (**O que aconteceu**, **A regra**…). Responda neste formato, sem nada antes:
TITULO: <o título, numa linha>
CORPO:
<o texto fundido>\n\n${textos}`);
    // texto e não JSON: o corpo tem aspas e quebras de linha, e o Haiku as escapava errado (06/10/2026, na faxina real)
    custo += f.custo;
    const recusa = f.txt.match(/^\s*RECUSA:\s*(.*)/);
    if (recusa) { registrar(`faxina: o Haiku recusou fundir ${membros.map(e => e.nr).join('+')}: ${recusa[1].slice(0, 120)}`); continue; }
    const m = f.txt.match(/TITULO:\s*(.+)\r?\n+\s*CORPO:\s*\r?\n([\s\S]+)/) || [];
    const novoTitulo = (m[1] || '').trim(), novo = (m[2] || '').replace(/\r\n/g, '\n').trim(), maior = Math.max(...membros.map(e => corpo(e).length));
    if (!novoTitulo || novo.length < 0.6 * maior || /^#{1,3} /m.test(novo) || temSegredo(novo)) {
      registrar(`faxina: recusou a fusão de ${membros.map(e => e.nr).join('+')} (texto curto, título ou segredo)`); continue;
    }
    const um = membros.every(e => /‹1×›/.test(e.titulo)) ? ' ‹1×›' : '';
    const titulo = `### ${novoTitulo.replace(/\s*‹[^›]*›/g, '').replace(/\s+/g, ' ')} ‹tema: ${maisNova.tema}› ‹nº ${maisNova.nr}›${um}`;
    // de baixo para cima, para os índices das de cima não andarem
    for (const e of [...membros].sort((a, b) => b.ini - a.ini)) {
      if (e === maisNova) atual.L.splice(e.ini, e.fim - e.ini, titulo, '', novo, '');
      else atual.L.splice(e.ini, e.fim - e.ini);
    }
    gravarLicoes(arqLicoes, atual);
    feitos.push(`- nº ${membros.filter(e => e !== maisNova).map(e => e.nr).join(', ')} → fundidas na nº ${maisNova.nr} (${String(gr.motivo || '').slice(0, 120)})`);
  } catch (e) { falhou = true; registrar(`faxina: ERRO no grupo ${String(gr.numeros)}: ${e.message}`); }
  if (falhou) devolver();
  const log = path.join(path.dirname(arqLicoes), 'Archive', 'FAXINA.md');
  fs.appendFileSync(log, `\n## ${new Date().toLocaleString('pt-BR')} — US$ ${custo.toFixed(4)}\n${feitos.join('\n') || '- nenhuma fusão passou na conferência; o arquivo não mudou'}\n`
    + (!feitos.length ? '' : `- Para voltar: copie \`${path.basename(volta)}\` (nesta pasta) por cima de \`meu/LICOES-PROPRIAS.md\`.\n`));
  if (!feitos.length) fs.unlinkSync(volta);
  registrar(`faxina: ${feitos.length} fusão(ões), US$ ${custo.toFixed(4)}`);
}

// ---------- o que se repete vira skill ----------
// A lição nasce de um erro; a SKILL nasce de um pedido que volta. Cada pedido curto da pessoa (até 600 caracteres: mais
// que isso é especificação colada) entra num grupo pelas palavras (Jaccard ≥ 0,45 com as 10 mais comuns do grupo). Grupo
// com 5 pedidos em 2+ chats (ou 20 num só) vai ao Haiku com o que o agente FEZ em cada vez; procedimento de vários passos
// com detalhe que vale lembrar → skill na biblioteca (~/.claude/biblioteca), que o licao-na-mensagem.js aponta quando o
// pedido casa. Commit, push e "roda o projeto" o Haiku recusa. Um grupo por vez; o recusado não volta.
// Ideia: patterns() e install_skill() do worker.py do project-helena (MIT). Daqui: o crivo em português, a biblioteca
// e o --desfazer.
const REPETE_SIM = .45, REPETE_USOS = 5, REPETE_CHATS = 2, REPETE_SO = 20, REPETE_MAX_CHARS = 600;
const VAZIAS = new Set(('que com para por uma uns umas dos das nos nas não sim mas como mais isso esse essa este esta aqui ali '
  + 'ele ela eles você voce vc pra pro tem ter ser foi faz fazer agora ainda também tambem sobre entre onde quando porque '
  + 'the and for with this that you are can please from what how into then just also').split(' '));
const palavras = t => new Set((String(t).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z][a-z0-9-]{2,}/g) || [])
  .filter(w => !VAZIAS.has(w)));
const arqRepete = () => path.join(ESTADO, 'repete.json');
const biblioteca = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'biblioteca');
const RECEITA = `Uma pessoa pede a um agente de programação a mesma coisa várias vezes. Abaixo, os pedidos e o que o agente fez em
cada um. Decida se uma SKILL (receita curta que o agente lê antes de agir) deixaria isso mais rápido ou mais certo da próxima vez.

vale=false quando o agente já faz bem sem receita (commit, push, rodar o projeto, corrigir digitação, pergunta genérica), quando
os pedidos não dividem um procedimento de verdade, ou quando é um bug específico.
vale=true só para um procedimento de vários passos que se repete, com detalhe que vale lembrar (comandos exatos, caminhos,
ferramentas, a ordem dos passos, a armadilha em que o agente já caiu).

Nunca ponha segredo, chave ou senha na skill. Escreva na língua dos pedidos. Responda SÓ com JSON:
{"vale": true|false, "nome": "kebab-case", "descricao": "quando usar, uma frase, com as palavras que a pessoa usa ao pedir",
 "passos": "a receita em markdown, até 40 linhas"}`;

function pedidosDe(transcript, desde) {                            // [{t, acoes}] da pessoa, com o que o agente fez depois
  const linhas = fs.readFileSync(transcript, 'utf8').split('\n'), out = [];
  for (const l of linhas.slice(desde)) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.isMeta || o.isSidechain) continue;
    const c = o.message && o.message.content;
    if (o.type === 'user' && !(Array.isArray(c) && c.some(b => b && b.type === 'tool_result'))) {
      const t = textoDe(c).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
      if (t && !/^(<(command-|local-command)|\[Request interrupted)/.test(t)) out.push({ t: mascarar(t), acoes: [], cwd: o.cwd || '' });
    } else if (o.type === 'assistant' && out.length && Array.isArray(c))
      for (const b of c) if (b && b.type === 'tool_use' && out[out.length - 1].acoes.length < 12) {
        const i = b.input || {};
        out[out.length - 1].acoes.push(mascarar(`${b.name}: ${String(i.command || i.file_path || i.pattern || i.skill || i.url || '').slice(0, 160)}`));
      }
  }
  return { pedidos: out, total: linhas.length - (linhas[linhas.length - 1] === '' ? 1 : 0) };
}

function repete(transcript) {
  if (process.env.DESTILAR_REPETE === '0' || !transcript || !fs.existsSync(transcript)) return;
  let st; try { st = JSON.parse(fs.readFileSync(arqRepete(), 'utf8')); } catch { st = { grupos: [], lidos: {} }; }
  const { pedidos, total } = pedidosDe(transcript, st.lidos[transcript] || 0), chat = path.basename(transcript, '.jsonl');
  st.lidos[transcript] = total;
  // benchmark e teste rodam no temp (e gravam o chat na pasta do projeto que os lançou): não são hábito da pessoa (07/10/2026)
  const noTemp = p => path.resolve(p.cwd || '/').toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase());
  for (const p of pedidos.filter(p => !noTemp(p))) {
    const w = palavras(p.t);
    if (p.t.length > REPETE_MAX_CHARS || w.size < 3) continue;                  // "commit e push" não precisa de skill
    const sim = g => { const top = new Set(g.top); let i = 0; for (const x of w) if (top.has(x)) i++; return i / (w.size + top.size - i); };
    let g = st.grupos.reduce((m, x) => (!m || sim(x) > sim(m) ? x : m), null);
    if (!g || sim(g) < REPETE_SIM) st.grupos.push(g = { top: [...w].sort(), contas: {}, usos: 0, chats: [], exemplos: [], status: 'aberto' });
    if (g.exemplos.some(e => e.t === p.t.slice(0, 300))) continue;               // o mesmo texto colado de novo não é pedido novo
    for (const x of w) g.contas[x] = (g.contas[x] || 0) + 1;
    g.top = Object.entries(g.contas).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
    g.usos++; if (!g.chats.includes(chat)) g.chats.push(chat);
    g.exemplos = [...g.exemplos, { t: p.t.slice(0, 300), acoes: p.acoes }].slice(-6);
  }
  const pronto = st.grupos.filter(g => g.status === 'aberto' && (g.usos >= REPETE_SO || (g.usos >= REPETE_USOS && g.chats.length >= REPETE_CHATS)))
    .sort((a, b) => b.usos - a.usos)[0];
  fs.mkdirSync(ESTADO, { recursive: true }); fs.writeFileSync(arqRepete(), JSON.stringify(st, null, 1));
  if (!pronto) return;
  const exemplos = pronto.exemplos.map(e => `PEDIDO: ${e.t}\nAÇÕES:\n${e.acoes.join('\n') || '(nenhuma ferramenta)'}`).join('\n\n');
  const { json: r, custo } = perguntar(`${RECEITA}\n\nPEDIDOS E AÇÕES (${pronto.usos} vezes em ${pronto.chats.length} chats):\n${exemplos}`, false);
  const nome = String(r.nome || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  const pasta = path.join(biblioteca(), nome);
  if (!r.vale || !nome || !r.passos || temSegredo(JSON.stringify(r)) || fs.existsSync(pasta)) {
    pronto.status = r.vale ? 'recusado-na-conferencia' : 'nao-e-skill';
    registrar(`repete: "${pronto.top.slice(0, 4).join(' ')}" (${pronto.usos}×) → ${pronto.status}, US$ ${custo.toFixed(4)}`);
  } else {
    const desc = String(r.descricao || '').replace(/\s+/g, ' ').trim(), hoje = new Date().toLocaleDateString('sv');
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(path.join(pasta, 'SKILL.md'), `---\nname: ${nome}\ndescription: ${desc}\n---\n\n> ${MARCA_AUTO} em ${hoje}: `
      + `você pediu isso ${pronto.usos} vezes em ${pronto.chats.length} chats. Não serve? \`node destilar-licoes.js --desfazer ${nome}\`.\n\n${String(r.passos).trim()}\n`);
    porNoCatalogo(nome, desc);
    pronto.status = 'skill'; pronto.skill = nome;
    novidade(`skill ‹auto› "${nome}" criada na biblioteca: você pediu isso ${pronto.usos} vezes em ${pronto.chats.length} chats (${desc}). Não serve? node destilar-licoes.js --desfazer ${nome}`);
    registrar(`repete: skill ${nome} (${pronto.usos}× em ${pronto.chats.length} chats), US$ ${custo.toFixed(4)}`);
  }
  fs.writeFileSync(arqRepete(), JSON.stringify(st, null, 1));
}

// ---------- a biblioteca que se cuida: uso, "## Aprendido", juntar, podar — e o desfazer de cada um ----------
// Ideia: used_skills() e learn() do distill.py, fold() e weekly() do tidy.py, prune() do worker.py e undo/unlearn/unfold do
// skills.py, do project-helena (MIT). Daqui: a PROVA literal no Aprendido, a poda que ARQUIVA (a Helena apaga), o juntar que
// recusa texto encolhido, e um desfazer para cada coisa que roda sozinha (--listar mostra todas).
const PODA_DIAS = 30, JUNTAR_EM = 5, SEMANA_DIAS = 7, MARCA_AUTO = '‹auto› Criada pelo destilar-licoes';
const lerJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const arqUsos = () => path.join(ESTADO, 'usos.json');
function novidade(t) {
  try { const nov = path.join(ESTADO, 'novidades.json'), l = lerJSON(nov, []); l.push(t); fs.mkdirSync(ESTADO, { recursive: true }); fs.writeFileSync(nov, JSON.stringify(l.slice(-10))); } catch {}
}
const pastasDaBib = () => { try { return fs.readdirSync(biblioteca()).filter(n => !n.startsWith('_') && fs.existsSync(path.join(biblioteca(), n, 'SKILL.md'))); } catch { return []; } };
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const arqCatalogo = () => path.join(biblioteca(), 'CATALOGO.md');
function porNoCatalogo(nome, desc) {                                 // o formato que o licao-na-mensagem.js e o biblioteca.js leem
  fs.mkdirSync(biblioteca(), { recursive: true });
  fs.appendFileSync(arqCatalogo(), `${fs.existsSync(arqCatalogo()) ? '' : '# Catálogo da biblioteca\n\n'}- **${nome}**: ${String(desc).slice(0, 160)}  \n  \`${path.join(biblioteca(), nome, 'SKILL.md').replace(/\\/g, '/')}\`\n`);
}
const tirarDoCatalogo = nome => { try { fs.writeFileSync(arqCatalogo(), fs.readFileSync(arqCatalogo(), 'utf8').replace(new RegExp(`^- \\*\\*${escRe(nome)}\\*\\*:.*\\r?\\n.*(\\r?\\n|$)`, 'm'), '')); } catch {} };
const descricaoDe = md => { try { return (fs.readFileSync(md, 'utf8').match(/^description:\s*(.*)$/m) || [])[1] || ''; } catch { return ''; } };

// as skills da biblioteca que o AGENTE abriu (tool_use dele; o caminho que o gancho só listou não conta), com a hora de cada uso
const USOU = /biblioteca[\\/]+([\w.-]+)[\\/]+SKILL\.md/g;
function usadas(transcript, desde = 0) {
  let linhas; try { linhas = fs.readFileSync(transcript, 'utf8').split('\n').slice(desde); } catch { return []; }
  const u = lerJSON(arqUsos(), {}), nomes = new Set();
  for (const l of linhas) {
    if (!l.includes('"assistant"') || !l.includes('biblioteca')) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const c = o.message && o.message.content, quando = Date.parse(o.timestamp) || Date.now();
    for (const b of Array.isArray(c) ? c : []) if (b && b.type === 'tool_use')
      for (const m of JSON.stringify(b.input || {}).matchAll(USOU)) if (fs.existsSync(path.join(biblioteca(), m[1], 'SKILL.md'))) { nomes.add(m[1]); u[m[1]] = Math.max(u[m[1]] || 0, quando); }
  }
  if (nomes.size) { fs.mkdirSync(ESTADO, { recursive: true }); fs.writeFileSync(arqUsos(), JSON.stringify(u, null, 1)); }
  return [...nomes];
}

const linhasAprendidas = t => { const m = String(t).replace(/\r\n/g, '\n').match(/\n## Aprendido\n([\s\S]*?)(?=\n## |$)/); return m ? m[1].match(/^- .+/gm) || [] : []; };
function aprender(md, linha) {                                       // no fim da seção "## Aprendido" (criada no fim, se falta)
  const t = fs.readFileSync(md, 'utf8').replace(/\r\n/g, '\n').replace(/\n*$/, '\n'), i = t.indexOf('\n## Aprendido\n');
  if (i < 0) return fs.writeFileSync(md, `${t}\n## Aprendido\n\n${linha}\n`);
  const resto = t.slice(i + 14), f = resto.search(/\n## /), corpo = f < 0 ? resto : resto.slice(0, f);
  fs.writeFileSync(md, `${t.slice(0, i)}\n## Aprendido\n${corpo.replace(/\n*$/, '\n')}${linha}\n${f < 0 ? '' : resto.slice(f)}`);
}

// JUNTAR: com 5 linhas no Aprendido, o Haiku as põe no lugar certo da receita (fold() do tidy.py). Cópia antes, em
// SKILL.md.antes-de-juntar; recusa texto que encolheu para menos de 60% ou que ainda tem a seção
const JUNTAR = `JUNTAR-APRENDIDO. Abaixo, uma skill (receita que um agente de programação lê antes de uma tarefa). A seção "## Aprendido"
tem correções que a pessoa fez em usos anteriores. Reescreva a skill pondo cada correção no lugar certo da receita e tire a seção
"## Aprendido". Guarde tudo o que continua certo, os títulos e o idioma; não acrescente nada novo; onde uma correção contradiz a
receita, vale a correção. Responda SÓ com a skill nova em markdown, sem nada antes nem depois — ou com UMA linha: RECUSA: <por quê>.`;
function juntar() {
  for (const n of pastasDaBib()) {
    const md = path.join(biblioteca(), n, 'SKILL.md'), t = fs.readFileSync(md, 'utf8').replace(/\r\n/g, '\n'), k = linhasAprendidas(t).length;
    if (k < JUNTAR_EM) continue;
    const m = t.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/), frente = m ? m[1] : '', corpo = m ? m[2] : t;
    const r = perguntar(`${JUNTAR}\n\nSKILL:\n${corpo}`, false, null, true);
    const novo = r.txt.trim().replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/, '$1').trim();
    if (/^RECUSA:/.test(novo) || /^## Aprendido\s*$/m.test(novo) || novo.length < 0.6 * corpo.replace(/\n## Aprendido\n[\s\S]*?(?=\n## |$)/, '').trim().length || temSegredo(novo)) {
      registrar(`juntar recusado: ${n} (${novo.slice(0, 60).replace(/\n/g, ' ')}), US$ ${r.custo.toFixed(4)}`); continue;
    }
    fs.copyFileSync(md, md + '.antes-de-juntar');
    fs.writeFileSync(md, `${frente}${novo}\n`);
    registrar(`juntou: ${n}: ${k} linhas do Aprendido na receita, US$ ${r.custo.toFixed(4)}`);
    novidade(`as ${k} correções da skill "${n}" entraram na receita dela. Ficou pior? node destilar-licoes.js --desfazer ${n} juntar`);
  }
}

// PODAR: a skill que ELE criou (‹auto›) e ninguém usou em 30 dias vai para biblioteca/_arquivo (prune() do worker.py, que apaga).
// Conta o uso mais recente ou a criação; a skill que a pessoa pôs na biblioteca nunca é tocada
function podar() {
  const u = lerJSON(arqUsos(), {});
  for (const n of pastasDaBib()) {
    const md = path.join(biblioteca(), n, 'SKILL.md'), t = fs.readFileSync(md, 'utf8');
    if (!t.includes(MARCA_AUTO)) continue;
    const ultimo = Math.max(u[n] || 0, Date.parse((t.match(/Criada pelo destilar-licoes em (\d{4}-\d{2}-\d{2})/) || [])[1]) || 0);
    if (!ultimo || Date.now() - ultimo < PODA_DIAS * 864e5) continue;
    const dest = path.join(biblioteca(), '_arquivo', n);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.rmSync(dest, { recursive: true, force: true }); fs.renameSync(path.dirname(md), dest);
    tirarDoCatalogo(n);
    registrar(`podou: ${n} (sem uso há ${Math.floor((Date.now() - ultimo) / 864e5)} dias) → biblioteca/_arquivo`);
    novidade(`a skill ‹auto› "${n}" foi para biblioteca/_arquivo: ninguém a usou em ${PODA_DIAS} dias. Quer de volta? node destilar-licoes.js --desfazer ${n} poda`);
  }
}

// SEMANA: a cada 7 dias, sem LLM, o resumo do que rodou sozinho, lido do registro.log (weekly() do tidy.py)
const semanaISO = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const a = t.getUTCFullYear(); return [a, Math.ceil(((t - Date.UTC(a, 0, 1)) / 864e5 + 1) / 7)]; };
function semana(arqLicoes, forcar) {
  const est = lerEstado();
  if (!est.semanaEm && !forcar) { est.semanaEm = Date.now(); gravarEstado(est); return; }           // conta da instalação
  if (!forcar && Date.now() - est.semanaEm < SEMANA_DIAS * 864e5) return;
  const desde = Date.now() - SEMANA_DIAS * 864e5;
  let log = []; try { log = fs.readFileSync(path.join(ESTADO, 'registro.log'), 'utf8').split('\n'); } catch {}
  const da = log.map(l => ({ t: Date.parse(l.slice(0, 24)), m: l.slice(25) })).filter(x => x.t >= desde);
  const com = re => da.filter(x => re.test(x.m)).map(x => x.m.replace(re, '').trim());
  const custo = da.reduce((s, x) => s + Number((x.m.match(/US\$ ([\d.]+)/) || [])[1] || 0), 0);
  let auto = []; try { auto = lerLicoes(arqLicoes).entradas.filter(e => /‹auto›/.test(e.titulo)).map(e => `nº ${e.nr}: ${tituloLimpo(e.titulo)}`); } catch {}
  const licoes = com(/^gravou: /), skills = com(/^repete: skill /), item = xs => (xs.length ? xs.map(x => `- ${x}`).join('\n') : '- nada');
  const [ano, sem] = semanaISO(new Date()), out = path.join(ESTADO, 'semana', `${ano}-S${String(sem).padStart(2, '0')}.md`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `# Semana ${sem} de ${ano} — o que rodou sozinho nos 7 dias até ${new Date().toLocaleDateString('pt-BR')}\n\n`
    + `## Lições ‹auto› gravadas no meu/\n${item(licoes)}\n\n## Skills criadas na biblioteca\n${item(skills)}\n\n`
    + `## A biblioteca se cuidou\n${item([...com(/^aprendido: /).map(x => 'aprendeu — ' + x), ...com(/^juntou: /).map(x => 'juntou — ' + x), ...com(/^podou: /).map(x => 'arquivou — ' + x)])}\n\n`
    + `## Faxina das lições\n${item(com(/^faxina: [1-9]\d* fusão/).map(x => x))}\n\n## Esperando você conferir (‹auto›)\n${item(auto)}\n\n`
    + `## Custo\n- US$ ${custo.toFixed(2)} em 7 dias (Haiku; na assinatura sai do limite de uso). Desfazer qualquer coisa: \`node destilar-licoes.js --listar\`\n`);
  const e2 = lerEstado(); e2.semanaEm = Date.now(); gravarEstado(e2);
  registrar(`semana: ${out}`);
  novidade(`resumo da semana ${sem}: ${licoes.length} lição(ões) ‹auto›, ${skills.length} skill(s) nova(s), US$ ${custo.toFixed(2)}; ${auto.length} ‹auto› esperando você conferir — ${out}`);
}

// ESQUECER uma lição do meu/ (/helena:forget, que apaga): vai para meu/Archive/ESQUECIDAS.md e volta com --desfazer licao <nº>
const arqEsquecidas = arq => path.join(path.dirname(arq), 'Archive', 'ESQUECIDAS.md');
function esquecer(nr, arq) {
  const d = lerLicoes(arq), e = d.entradas.find(x => x.nr === Number(nr));
  if (!e) return console.log(`Não achei a lição nº ${nr} em ${arq}.`);
  const esq = arqEsquecidas(arq); fs.mkdirSync(path.dirname(esq), { recursive: true });
  fs.appendFileSync(esq, `${fs.existsSync(esq) ? '' : '# Lições esquecidas — cada uma volta com `node destilar-licoes.js --desfazer licao <nº>`\n'}`
    + `\n<!-- esquecida em ${new Date().toLocaleDateString('sv')} -->\n${d.L.slice(e.ini, e.fim).join('\n').trim()}\n`);
  d.L.splice(e.ini, e.fim - e.ini); gravarLicoes(arq, d);
  registrar(`esqueceu: lição nº ${nr}: ${tituloLimpo(e.titulo)}`);
  console.log(`Lição nº ${nr} ("${tituloLimpo(e.titulo)}") saiu do meu/ e está em meu/Archive/ESQUECIDAS.md. Volta: node destilar-licoes.js --desfazer licao ${nr}`);
}
function voltarLicao(nr, arq) {
  const esq = arqEsquecidas(arq); let t; try { t = fs.readFileSync(esq, 'utf8').replace(/\r\n/g, '\n'); } catch { return console.log('Nenhuma lição esquecida.'); }
  const m = t.match(new RegExp(`\\n<!-- esquecida em [^>]*-->\\n(### [^\\n]*‹nº ${Number(nr)}›[\\s\\S]*?)(?=\\n<!-- esquecida|$)`));
  if (!m) return console.log(`A lição nº ${nr} não está em meu/Archive/ESQUECIDAS.md.`);
  const d = lerLicoes(arq);
  if (d.entradas.some(x => x.nr === Number(nr))) return console.log(`A lição nº ${nr} já está no meu/.`);
  const antes = d.entradas.find(x => x.nr != null && x.nr < Number(nr));              // a mais nova em cima: entra antes da de nº menor
  d.L.splice(antes ? antes.ini : d.entradas.length ? d.entradas[d.entradas.length - 1].fim : d.L.length, 0, ...m[1].trim().split('\n'), '');
  gravarLicoes(arq, d); fs.writeFileSync(esq, t.replace(m[0], ''));
  registrar(`voltou: lição nº ${nr}`);
  console.log(`Lição nº ${nr} de volta no meu/.`);
}

// DESFAZER: sem segundo argumento apaga a skill que ele criou (o grupo de pedidos não vira skill de novo); com "poda",
// "juntar" ou "aprendido", desfaz aquela coisa só; "licao <nº>" devolve a lição esquecida
function desfazer(nome, oque, arqLicoes) {
  if (nome === 'licao') return voltarLicao(oque, arqLicoes);
  const pasta = path.join(biblioteca(), String(nome || '_')), md = path.join(pasta, 'SKILL.md');
  if (oque === 'poda') {
    const arq = path.join(biblioteca(), '_arquivo', String(nome || '_'));
    if (!nome || !fs.existsSync(path.join(arq, 'SKILL.md')) || fs.existsSync(pasta)) return console.log(`Não achei "${nome}" em biblioteca/_arquivo.`);
    fs.renameSync(arq, pasta); porNoCatalogo(nome, descricaoDe(md));
    const u = lerJSON(arqUsos(), {}); u[nome] = Date.now(); fs.mkdirSync(ESTADO, { recursive: true }); fs.writeFileSync(arqUsos(), JSON.stringify(u, null, 1));
    return console.log(`Skill "${nome}" de volta na biblioteca; conta como usada hoje (só volta ao arquivo depois de ${PODA_DIAS} dias sem uso).`);
  }
  if (oque === 'juntar') {
    if (!fs.existsSync(md + '.antes-de-juntar')) return console.log(`"${nome}" não tem versão de antes de juntar.`);
    fs.renameSync(md + '.antes-de-juntar', md); return console.log(`"${nome}": de volta à versão de antes de juntar o Aprendido.`);
  }
  if (oque === 'aprendido') {
    let t; try { t = fs.readFileSync(md, 'utf8').replace(/\r\n/g, '\n'); } catch { return console.log(`Não achei a skill "${nome}".`); }
    const ult = linhasAprendidas(t).pop(); if (!ult) return console.log(`"${nome}" não tem nada no Aprendido.`);
    const i = (t + '\n').lastIndexOf('\n' + ult + '\n'); fs.writeFileSync(md, t.slice(0, i) + t.slice(i + ult.length + 1));
    return console.log(`Tirado do Aprendido de "${nome}": ${ult.slice(2)}`);
  }
  if (!nome || !fs.existsSync(md) || !fs.readFileSync(md, 'utf8').includes(MARCA_AUTO)) return console.log(`Não achei skill ‹auto› "${nome}" na biblioteca.`);
  fs.rmSync(pasta, { recursive: true, force: true });
  tirarDoCatalogo(nome);
  try { const st = JSON.parse(fs.readFileSync(arqRepete(), 'utf8')); for (const g of st.grupos) if (g.skill === nome) g.status = 'desfeita'; fs.writeFileSync(arqRepete(), JSON.stringify(st, null, 1)); } catch {}
  console.log(`Skill "${nome}" apagada da biblioteca; esse grupo de pedidos não vira skill de novo.`);
}

// LISTAR: tudo o que rodou sozinho e ainda dá para desfazer, cada um com o comando
function listar(arqLicoes) {
  const out = [], cmd = 'node destilar-licoes.js';
  for (const n of pastasDaBib()) {
    const md = path.join(biblioteca(), n, 'SKILL.md'), t = fs.readFileSync(md, 'utf8'), k = linhasAprendidas(t).length;
    if (t.includes(MARCA_AUTO)) out.push(`skill ‹auto› "${n}", criada sozinha → ${cmd} --desfazer ${n}`);
    if (k) out.push(`skill "${n}": ${k} linha(s) no ## Aprendido → ${cmd} --desfazer ${n} aprendido   (tira a última)`);
    if (fs.existsSync(md + '.antes-de-juntar')) out.push(`skill "${n}": o Aprendido foi juntado na receita → ${cmd} --desfazer ${n} juntar`);
  }
  try { for (const n of fs.readdirSync(path.join(biblioteca(), '_arquivo'))) out.push(`skill "${n}" arquivada por falta de uso → ${cmd} --desfazer ${n} poda`); } catch {}
  if (arqLicoes) {
    try { for (const e of lerLicoes(arqLicoes).entradas.filter(e => /‹auto›/.test(e.titulo))) out.push(`lição ‹auto› nº ${e.nr}: ${tituloLimpo(e.titulo)} → ${cmd} --esquecer ${e.nr}`); } catch {}
    try { for (const m of fs.readFileSync(arqEsquecidas(arqLicoes), 'utf8').matchAll(/^### (.*‹nº (\d+)›.*)$/gm)) out.push(`lição esquecida nº ${m[2]}: ${tituloLimpo(m[1])} → ${cmd} --desfazer licao ${m[2]}`); } catch {}
    const fx = path.join(path.dirname(arqLicoes), 'Archive', 'FAXINA.md');
    if (fs.existsSync(fx)) out.push(`faxina das lições: cada rodada e a cópia de volta em ${fx} ("Para voltar")`);
  }
  try { const s = fs.readdirSync(path.join(ESTADO, 'semana')).sort().pop(); if (s) out.push(`último resumo da semana: ${path.join(ESTADO, 'semana', s)}`); } catch {}
  console.log(out.length ? out.join('\n') : 'Nada rodou sozinho ainda.');
}

// ---------- os chats parados ----------
// O SessionEnd não dispara quando o terminal é morto, e no app de desktop o chat quase nunca "termina" (fica parado na
// lista). Por isso o SessionStart também chama: lê os chats DESTE projeto parados há mais de 1 hora (o cache já venceu,
// ninguém volta a eles barato) — no máximo 3 por vez, e só os que mexeram depois da instalação, para não gastar com o
// passado. Ideia do start.js da Helena, que relança o trabalhador pelo mesmo motivo.
const PARADO_MIN = 60, PARADOS_MAX = 3;
function parados(atual) {
  const est = lerEstado();
  if (!est.desde) { est.desde = Date.now(); gravarEstado(est); registrar('instalado: lê os chats parados daqui em diante'); return []; }
  const vistos = est.vistos || {};
  let arqs = []; try { arqs = fs.readdirSync(path.dirname(atual)).filter(n => n.endsWith('.jsonl')).map(n => path.join(path.dirname(atual), n)); } catch {}
  return arqs.filter(t => path.resolve(t) !== path.resolve(atual)).map(t => ({ t, m: fs.statSync(t).mtimeMs }))
    .filter(x => x.m >= est.desde && Date.now() - x.m > PARADO_MIN * 60e3 && vistos[x.t] !== x.m)
    .sort((a, b) => b.m - a.m).slice(0, PARADOS_MAX);
}
const marcarVisto = (t, m) => { const e = lerEstado(); e.vistos = e.vistos || {}; e.vistos[t] = m; gravarEstado(e); };

// No PLUGIN não há base (as lições vêm do servidor): só com a opção "destilar" ligada, e as lições próprias moram na opção
// "pasta_meu" ou em ~/.claude/licoes/meu — fora da pasta do plugin, que cada versão troca, e do CLAUDE_PLUGIN_DATA, que some
// ao desinstalar (07/10/2026, revisão do plugin × Helena).
function arquivoMeu(cwd) {
  const base = acharPasta(cwd); if (base) return path.join(base, 'meu', 'LICOES-PROPRIAS.md');
  if (!process.env.CLAUDE_PLUGIN_ROOT || !/^(true|1|sim)$/i.test(process.env.CLAUDE_PLUGIN_OPTION_DESTILAR || '')) return null;
  return criarMeu(process.env.CLAUDE_PLUGIN_OPTION_PASTA_MEU);
}
// os COMANDOS (/licoes:status, :lembrar…) a pessoa chama de propósito, então não pedem a opção "destilar": --licoes › base › --meu.
// No plugin o --meu chega como ${user_config.pasta_meu}; vazio, ou o texto cru "${…}" de opção sem valor, é a pasta padrão
function arqDoComando(licoes, meu, cwd, criar) {
  if (licoes) return licoes;
  const base = acharPasta(cwd); if (base) return path.join(base, 'meu', 'LICOES-PROPRIAS.md');
  return criarMeu(meu && !String(meu).trim().startsWith('$') ? String(meu).trim() : '', criar);
}
function criarMeu(meu, criar = true) {
  meu = meu || path.join(os.homedir(), '.claude', 'licoes', 'meu'); const arq = path.join(meu, 'LICOES-PROPRIAS.md');
  if (criar && !fs.existsSync(arq)) {
    fs.mkdirSync(meu, { recursive: true });
    fs.writeFileSync(arq, '# LIÇÕES PRÓPRIAS — o que os projetos DESTA pessoa aprenderam\n\n> Escritas pelo plugin LIÇÕES GERAIS (marca ‹auto›) e por você. '
      + 'Nunca se lê inteiro: `grep -n "^### "` acha o título; leia só a lição que interessa.\n\n**Próximo nº: 1**\n\n---\n\n## As lições\n\n*(A mais recente em cima.)*\n\n');
  }
  return arq;
}

function rodar(transcript, cwd, arqLicoes, inicio) {
  const soltar = travar(); if (!soltar) { registrar('outra destilação rodando; saiu'); return; }
  try {
    if (!arqLicoes) arqLicoes = arquivoMeu(cwd);
    if (!arqLicoes) return;
    if (!fs.existsSync(arqLicoes)) return;
    if (inicio) for (const x of parados(transcript)) { destilar(x.t, cwd, arqLicoes); try { repete(x.t); } catch (e) { registrar('ERRO repete ' + e.message); } marcarVisto(x.t, x.m); }
    else if (transcript && fs.existsSync(transcript)) { destilar(transcript, cwd, arqLicoes); try { repete(transcript); } catch (e) { registrar('ERRO repete ' + e.message); } }
    faxina(arqLicoes, false);
    for (const f of [podar, juntar, () => semana(arqLicoes, false)]) try { f(); } catch (e) { registrar('ERRO ' + e.message); }
  } catch (e) { registrar('ERRO ' + (e && e.message || e)); } finally { soltar(); }
}

// no plugin, /licoes:status; na base, a skill licoes-status. Pelo lugar do script: o comando `!` de uma skill não recebe CLAUDE_PLUGIN_ROOT no ambiente (provado 07/10)
const NO_PLUGIN = () => !!process.env.CLAUDE_PLUGIN_ROOT || fs.existsSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'));
const CMD = n => (NO_PLUGIN() ? '/licoes:' : '/licoes-') + n;
// ---------- os comandos que a pessoa chama (/licoes:status, :lembrar, :comecar — os /helena:status, :remember, :start) ----------
const lerLog = arq => { try { return fs.readFileSync(arq, 'utf8').split('\n').map(l => ({ t: Date.parse(l.slice(0, 24)), m: l.slice(25) })).filter(x => x.t); } catch { return []; } };
const dirRotinas = () => process.env.ROTINAS_ESTADO || path.join(os.homedir(), '.claude', 'ganchos', 'rotinas');
const custoMedio = () => { const c = lerLog(path.join(ESTADO, 'registro.log')).map(x => (x.m.match(/^destilou .*US\$ ([\d.]+)/) || [])[1]).filter(Boolean).map(Number);
  return c.length ? c.reduce((s, x) => s + x, 0) / c.length : 0.004; };   // 0,004: a média medida no Haiku 5.5 (FERRAMENTAS §17); no 4.5 era 0,045

// STATUS: o que há e o que rodou sozinho, lido do disco — sem LLM e sem gastar
function status(arq) {
  const out = [], dias = n => Date.now() - n * 864e5;
  try { const d = lerLicoes(arq), auto = d.entradas.filter(e => /‹auto›/.test(e.titulo)).length;
    out.push(`Lições próprias: ${d.entradas.length}${auto ? `, ${auto} ‹auto› esperando você conferir` : ''} — ${arq}`); } catch { out.push(`Lições próprias: nenhuma ainda — ${arq}`); }
  const bib = pastasDaBib(), bAuto = bib.filter(n => fs.readFileSync(path.join(biblioteca(), n, 'SKILL.md'), 'utf8').includes(MARCA_AUTO)).length;
  let arqv = 0; try { arqv = fs.readdirSync(path.join(biblioteca(), '_arquivo')).length; } catch {}
  out.push(`Biblioteca: ${bib.length} skill(s)${bAuto ? `, ${bAuto} criada(s) sozinha(s)` : ''}${arqv ? `, ${arqv} arquivada(s) por falta de uso` : ''} — ${biblioteca()}`);
  const rot = lerJSON(path.join(dirRotinas(), 'rotinas.json'), []);
  out.push(rot.length ? `Rotinas: ${rot.map(r => `${r.nome} (a cada ${r.cada})`).join(', ')}` : 'Rotinas: nenhuma');
  const log = [...lerLog(path.join(ESTADO, 'registro.log')), ...lerLog(path.join(dirRotinas(), 'registro.log'))];
  const soma = desde => log.filter(x => x.t >= desde).reduce((s, x) => s + Number((x.m.match(/US\$ ([\d.]+)/) || [])[1] || 0), 0);
  const sem = log.filter(x => x.t >= dias(7)), lidos = sem.filter(x => /^destilou /.test(x.m)).length, grav = sem.filter(x => /^gravou: /.test(x.m)).length;
  out.push(`Custo do que rodou sozinho (Haiku; na assinatura sai do limite de uso): US$ ${soma(dias(7)).toFixed(2)} em 7 dias, US$ ${soma(dias(30)).toFixed(2)} em 30`
    + ` — ${lidos} chat(s) lido(s) e ${grav} lição(ões) gravada(s) em 7 dias`);
  const ult = log.filter(x => /^destilou /.test(x.m)).pop();
  out.push(ult ? `Último chat lido: ${new Date(ult.t).toLocaleString('pt-BR')}` : 'Nenhum chat lido ainda (o destilar está ligado? FERRAMENTAS §17)');
  const erros = sem.filter(x => /ERRO/.test(x.m)).length;
  if (erros) out.push(`⚠️ ${erros} erro(s) em 7 dias — ${path.join(ESTADO, 'registro.log')}`);
  const nov = lerJSON(path.join(ESTADO, 'novidades.json'), []);
  if (nov.length) out.push('Novidades que o próximo chat vai contar:', ...nov.map(n => `- ${n}`));
  out.push('Desfazer o que rodou sozinho: ' + CMD('desfazer'));
  console.log(out.join('\n'));
}

// SKILLS: as da biblioteca, com o último uso pelo agente (usos.json) — as ‹auto› primeiro, que são as que ninguém escreveu
function skills() {
  const u = lerJSON(arqUsos(), {}), quando = n => (u[n] ? new Date(u[n]).toLocaleDateString('pt-BR') : 'nunca');
  const l = pastasDaBib().map(n => { const t = fs.readFileSync(path.join(biblioteca(), n, 'SKILL.md'), 'utf8'), k = linhasAprendidas(t).length;
    return { auto: t.includes(MARCA_AUTO), s: `- ${n}${t.includes(MARCA_AUTO) ? ' ‹auto›' : ''}: último uso ${quando(n)}${k ? `, ${k} linha(s) no ## Aprendido` : ''}` }; })
    .sort((a, b) => b.auto - a.auto).map(x => x.s);
  let arqv = []; try { arqv = fs.readdirSync(path.join(biblioteca(), '_arquivo')); } catch {}
  console.log(l.length || arqv.length ? [`Biblioteca (${biblioteca()}):`, ...(l.length ? l : ['- vazia']), ...(arqv.length ? [`Arquivadas por falta de uso: ${arqv.join(', ')}`] : [])].join('\n')
    : `A biblioteca está vazia (${biblioteca()}). Skill que se repete nos seus pedidos aparece aqui sozinha, com a marca ‹auto›.`);
}

// LEMBRAR: a lição que a PESSOA dita, sem passar pelo Haiku e sem ‹auto›. JSON na entrada: {titulo, tema, aconteceu, regra}
function lembrar(arq, entrada, cwd) {
  const nao = m => { console.log(m); process.exitCode = 1; };
  let x; try { x = JSON.parse(entrada); } catch { return nao('--lembrar espera JSON na entrada: {"titulo", "tema", "aconteceu", "regra"}.'); }
  const falta = ['titulo', 'aconteceu', 'regra'].filter(k => !String(x && x[k] || '').trim());
  if (falta.length) return nao(`Falta ${falta.join(', ')}. Uma lição precisa do caso (aconteceu) e da regra.`);
  if (temSegredo(JSON.stringify(x))) return nao('Recusada: tem algo com cara de chave, token ou senha. Tire e mande de novo.');
  let d; try { d = lerLicoes(arq); } catch { return nao(`Não consegui ler ${arq}.`); }
  if (d.ini < 0) return nao(`${arq} não tem a seção "## As lições".`);
  const igual = d.entradas.find(e => norm(tituloLimpo(e.titulo)) === norm(x.titulo));
  if (igual) return nao(`Já existe a lição nº ${igual.nr} com esse título — edite aquela em ${arq}.`);
  const nr = gravarNovas(arq, [x], cwd, false);
  registrar(`lembrou: nº ${nr}: ${String(x.titulo).replace(/\s+/g, ' ').trim()}`);
  console.log(`Lição nº ${nr} gravada em ${arq}. Tirar: ${CMD('esquecer')} ${nr}`);
}

// COMEÇAR: os N chats mais novos DESTE projeto, lidos já (a instalação da Helena resume as últimas 10 sessões) — o
// SessionStart só lê os parados depois da instalação, então o passado fica para este comando. Em segundo plano;
// o resultado chega como novidade no começo do próximo chat
const pastaDoProjeto = cwd => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'));
function comecar(n, arq, cwd) {
  n = Math.min(Math.max(parseInt(n, 10) || 5, 1), 20);
  const dir = pastaDoProjeto(cwd);
  let ts = []; try { ts = fs.readdirSync(dir).filter(x => x.endsWith('.jsonl')).map(x => ({ t: path.join(dir, x), m: fs.statSync(path.join(dir, x)).mtimeMs })); } catch {}
  const lista = ts.filter(x => Date.now() - x.m > 120e3).sort((a, b) => b.m - a.m).slice(0, n);   // o chat de agora (mexeu há < 2 min) fica para o fim dele
  if (!lista.length) return console.log(`Nenhum chat anterior deste projeto em ${dir}.`);
  console.log(`Lendo ${lista.length} chat(s) deste projeto em segundo plano — uns US$ ${(lista.length * custoMedio()).toFixed(2)} de Haiku`
    + ' (na assinatura, sai do limite de uso); chat já lido não gasta de novo. O que virar lição aparece no começo do próximo chat e no /licoes:status.');
  const args = [__filename, '--rodar-lista', arq, cwd, ...lista.map(x => x.t)];
  if (process.env.DESTILAR_ESPERA) cp.spawnSync(process.execPath, args, { stdio: 'ignore', windowsHide: true });   // o --teste espera
  else cp.spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
function rodarLista(arq, cwd, ts) {
  let soltar = travar();
  for (let k = 0; !soltar && k < 30; k++) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000); soltar = travar(); }   // espera a do fim de chat, até 5 min
  if (!soltar) return registrar('comecar: outra destilação rodando há 5 min; saiu');
  try {
    for (const t of ts) { try { destilar(t, cwd, arq); repete(t); } catch (e) { registrar('ERRO comecar ' + e.message); } try { marcarVisto(t, fs.statSync(t).mtimeMs); } catch {} }
    registrar(`comecar: ${ts.length} chat(s) lido(s)`);
  } finally { soltar(); }
}

// ---------- o teste, sem gastar ----------
function teste() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'destilar-'));
  process.env.DESTILAR_ESTADO = path.join(tmp, 'estado');
  process.env.DESTILAR_REPETE = '0';                               // as lições primeiro; o que se repete tem o caso dele, no fim
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'cfg');
  const falso = path.join(tmp, 'claude-falso.js');
  fs.writeFileSync(falso, `const fs=require('fs');let i='';process.stdin.on('data',c=>i+=c).on('end',()=>{fs.appendFileSync(process.env.FALSO_LOG,i+'\\n=====\\n');
    const r=fs.readFileSync(process.env.FALSO_SAIDA,'utf8').split('\\n=====\\n');const n=Number(fs.existsSync(process.env.FALSO_N)?fs.readFileSync(process.env.FALSO_N,'utf8'):0);
    fs.writeFileSync(process.env.FALSO_N,String(n+1));const s=r[Math.min(n,r.length-1)];if(s==='SAI1'){process.stdout.write(JSON.stringify({type:'result',result:'session limit'}));process.exitCode=1;return;}
    process.stdout.write(JSON.stringify({type:'result',result:s,total_cost_usd:0.001}));});`);
  const env = { FALSO_LOG: path.join(tmp, 'log'), FALSO_SAIDA: path.join(tmp, 'saida'), FALSO_N: path.join(tmp, 'n') };
  Object.assign(process.env, env);
  const filho = (...a) => cp.spawnSync(process.execPath, [__filename, ...a], { encoding: 'utf8', env: { ...process.env,
    DESTILAR_CLAUDE: `"${process.execPath}" "${falso}"` } });
  const respostas = (...r) => { fs.writeFileSync(env.FALSO_SAIDA, r.join('\n=====\n')); try { fs.unlinkSync(env.FALSO_N); } catch {} try { fs.unlinkSync(env.FALSO_LOG); } catch {} };
  const pedidos = () => (fs.existsSync(env.FALSO_LOG) ? fs.readFileSync(env.FALSO_LOG, 'utf8').split('\n=====\n').filter(Boolean) : []);
  const lic = path.join(tmp, 'meu', 'LICOES-PROPRIAS.md'); fs.mkdirSync(path.dirname(lic), { recursive: true });
  const licao = (n, t, um = true) => `### ${t} ‹tema: 07› ‹nº ${n}›${um ? ' ‹1×›' : ''}\r\n\r\n**O que aconteceu:** caso ${n}, com texto bastante para medir o tamanho do corpo.\r\n\r\n**A regra:** regra ${n}.\r\n\r\n`;
  const cabecalho = '# LIÇÕES PRÓPRIAS\r\n\r\n**Próximo nº: 41** · **Teto: ~150**\r\n\r\n---\r\n\r\n## As lições\r\n\r\n*(A mais recente em cima.)*\r\n\r\n';
  let corpo = ''; for (let n = 40; n >= 1; n--) corpo += licao(n, n === 12 ? 'Rode CLI com < /dev/null para não travar no teclado' : n === 30 ? 'CLI que lê o teclado trava: use < /dev/null' : `Lição de número ${n}`, n !== 7);
  fs.writeFileSync(lic, cabecalho + corpo);
  const original = fs.readFileSync(lic, 'utf8');
  const tr = path.join(tmp, 'chat.jsonl'), msg = (tipo, texto) => JSON.stringify({ type: tipo, message: { role: tipo, content: tipo === 'user' ? texto : [{ type: 'text', text: texto }] } });
  const conversa = n => Array.from({ length: n }, (_, i) => [msg('user', `pedido ${i} com a chave sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV`), msg('assistant', `feito ${i}`), // segredo-ok — chave falsa do teste
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'SAIDA-DE-FERRAMENTA' }] } })].join('\n')).join('\n') + '\n';
  let falhas = 0; const confere = (ok, nome) => { console.log(`${ok ? 'ok  ' : 'FALHOU'} ${nome}`); if (!ok) falhas++; };

  fs.writeFileSync(tr, conversa(2)); respostas('{"licoes":[]}');
  filho('--rodar', tr, tmp, '--licoes', lic);
  confere(!pedidos().some(p => p.includes('CONVERSA:')) && fs.readFileSync(lic, 'utf8') === original, 'chat com menos de 6 mensagens: não manda a conversa');
  confere(pedidos().length === 1 && pedidos()[0].startsWith('FAXINA-GRUPOS'), 'a faxina roda na 1ª vez (40 lições, nunca rodou); sem grupo, não mexe');

  fs.writeFileSync(tr, conversa(5));
  respostas(JSON.stringify({ licoes: [{ prova: 'Pedido 1 com a  chave', titulo: 'Lição boa nova', tema: '06', aconteceu: 'quebrou', regra: 'faça X', parecida_com: '' },
    { prova: 'pedido 2 com a chave', titulo: 'Repetida', tema: '07', aconteceu: 'a', regra: 'b', parecida_com: 'Lição de número 3' }] }), '{"grupos":[]}');
  filho('--rodar', tr, tmp, '--licoes', lic);
  const p1 = pedidos()[0] || '', depois = fs.readFileSync(lic, 'utf8');
  confere(!p1.includes('sk-ant-api03') && p1.includes('[segredo]') && !p1.includes('SAIDA-DE-FERRAMENTA'), 'o pedido vai mascarado e sem saída de ferramenta');
  confere(/### Lição boa nova ‹tema: 06› ‹nº 41› ‹1×› ‹auto›/.test(depois) && depois.includes('Próximo nº: 42') && !depois.includes('Repetida'),
    'grava a nova com o nº 41, sobe o cabeçalho, recusa a "parecida_com"');
  confere(depois.indexOf('Lição boa nova') < depois.indexOf('Lição de número 40') && depois.includes('\r\n'), 'a nova vai em cima, e o CRLF fica');
  confere(pedidos().length === 1, 'a faxina espera 7 dias');
  confere(/nº 41 gravada no meu\/: Lição boa nova/.test(fs.readFileSync(path.join(process.env.DESTILAR_ESTADO, 'novidades.json'), 'utf8')), 'a lição nova vira novidade para o começo do próximo chat');

  respostas('{"licoes":[]}'); filho('--rodar', tr, tmp, '--licoes', lic);
  confere(pedidos().length === 0, 'mesmo chat, nada novo: não chama de novo (offset)');

  const tr1 = path.join(tmp, 'chat-um-prompt.jsonl');
  fs.writeFileSync(tr1, [msg('user', 'o prompt colado'), ...Array.from({ length: 5 }, (_, i) => msg('assistant', `passo ${i}`))].join('\n') + '\n');
  respostas('{"licoes":[]}'); filho('--rodar', tr1, tmp, '--licoes', lic);
  confere(pedidos().some(p => p.includes('CONVERSA:')), 'um prompt só e o agente trabalhando: lê (o jeito comum de usar)');

  fs.appendFileSync(tr, conversa(4)); respostas(JSON.stringify({ licoes: [{ prova: 'pedido 1 com a chave', titulo: 'Use ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', tema: '07', aconteceu: 'a', regra: 'b', parecida_com: '' },
    { prova: 'a pessoa reclamou que o deploy quebrou', titulo: 'Sem prova', tema: '07', aconteceu: 'a', regra: 'b', parecida_com: '' }] }));
  filho('--rodar', tr, tmp, '--licoes', lic);
  confere(!fs.readFileSync(lic, 'utf8').includes('ghp_'), 'lição que traz segredo não entra');
  confere(!fs.readFileSync(lic, 'utf8').includes('Sem prova'), 'lição cuja "prova" não está na conversa não entra');

  const antes = fs.readFileSync(lic, 'utf8');
  const fundido = 'O que aconteceu: a CLI travou duas vezes esperando o teclado, nos casos 12 e 30, e o turno parou sem aviso.\n\nA regra: rode toda CLI chamada pelo agente com < /dev/null.';
  respostas('{"grupos":[{"numeros":[12,30],"motivo":"mesmo ato"},{"numeros":[5,6],"motivo":"teste do curto"},{"numeros":[8,9],"motivo":"assunto parecido"}]}',
    `TITULO: CLI chamada pelo agente: < /dev/null\nCORPO:\n${fundido}`, 'TITULO: curto\nCORPO:\nx', 'RECUSA: assunto parecido, atos diferentes');
  filho('--faxina', '--licoes', lic);
  const f = fs.readFileSync(lic, 'utf8'), arq = fs.readdirSync(path.join(tmp, 'meu', 'Archive'));
  confere(f.includes('### CLI chamada pelo agente: < /dev/null ‹tema: 07› ‹nº 30› ‹1×›') && !f.includes('‹nº 12›') && !f.includes('Lição de número 12'),
    'funde 12 e 30 na nº 30 (a mais nova), tira a 12');
  confere(f.includes('‹nº 5›') && f.includes('‹nº 6›'), 'fusão curta demais é recusada: 5 e 6 ficam');
  confere(f.includes('‹nº 8›') && f.includes('‹nº 9›') && pedidos()[0].startsWith('FAXINA-GRUPOS') && pedidos().length === 4,
    'o Haiku pode recusar a fusão lendo o texto: 8 e 9 ficam');
  confere(arq.some(a => a.startsWith('LICOES-PROPRIAS-')) && fs.readFileSync(path.join(tmp, 'meu', 'Archive', arq.find(a => a.startsWith('LICOES-PROPRIAS-'))), 'utf8') === antes
    && fs.readFileSync(path.join(tmp, 'meu', 'Archive', 'FAXINA.md'), 'utf8').includes('Para voltar'), 'a cópia de volta é o arquivo de antes, e o FAXINA.md diz como voltar');
  const semAs = s => s.replace(/### [^\n]*‹nº (12|30)›[\s\S]*?(?=### |(?![\s\S]))/g, '');
  confere(semAs(f) === semAs(antes), 'o resto do arquivo fica byte a byte igual');
  confere(fs.readFileSync(path.join(process.env.DESTILAR_ESTADO, 'registro.log'), 'utf8').includes('US$'), 'o registro anota o custo');

  const arqEst = path.join(process.env.DESTILAR_ESTADO, 'estado.json'), faxinaEm = () => JSON.parse(fs.readFileSync(arqEst, 'utf8')).faxinaEm;
  const zerar = () => { const e = JSON.parse(fs.readFileSync(arqEst, 'utf8')); e.faxinaEm = 0; fs.writeFileSync(arqEst, JSON.stringify(e)); };
  zerar(); respostas('SAI1'); filho('--rodar', tr, tmp, '--licoes', lic);
  confere(faxinaEm() === 0, 'o limite de uso acaba na lista de grupos: a faxina não gasta a semana');
  zerar(); respostas('{"grupos":[{"numeros":[5,6],"motivo":"x"}]}', 'SAI1'); filho('--rodar', tr, tmp, '--licoes', lic);
  confere(faxinaEm() === 0, 'o limite acaba no meio da fusão: também tenta de novo no próximo chat');

  // os chats parados: pasta de transcrições com o chat atual, um parado há 2 h, um de 10 min, um de antes da instalação
  const proj = path.join(tmp, 'proj'); fs.mkdirSync(proj);
  const tr2 = n => path.join(proj, n + '.jsonl'), idade = (n, min) => { const t = (Date.now() - min * 60e3) / 1000; fs.utimesSync(tr2(n), t, t); };
  for (const n of ['atual', 'parado', 'recente', 'velho']) fs.writeFileSync(tr2(n), conversa(5));
  const e0 = JSON.parse(fs.readFileSync(arqEst, 'utf8')); delete e0.desde; e0.faxinaEm = Date.now(); fs.writeFileSync(arqEst, JSON.stringify(e0));
  respostas('{"licoes":[]}'); filho('--rodar', tr2('atual'), tmp, '--licoes', lic, '--inicio');
  confere(pedidos().length === 0, 'a 1ª vez só marca a instalação: nenhum chat do passado é lido');
  const e1 = JSON.parse(fs.readFileSync(arqEst, 'utf8')); e1.desde = Date.now() - 180 * 60e3; fs.writeFileSync(arqEst, JSON.stringify(e1));
  idade('parado', 120); idade('recente', 10); idade('velho', 240);
  respostas('{"licoes":[]}'); filho('--rodar', tr2('atual'), tmp, '--licoes', lic, '--inicio');
  confere(pedidos().length === 1 && pedidos()[0].includes('CONVERSA:'), 'no começo do chat lê só o parado há mais de 1 h, depois da instalação');
  respostas('{"licoes":[]}'); filho('--rodar', tr2('atual'), tmp, '--licoes', lic, '--inicio');
  confere(pedidos().length === 0, 'o parado já lido não se lê de novo');

  // o que se repete: 3 pedidos num chat e 2 noutro (curtos: a destilação de lição pula e não pergunta nada)
  process.env.DESTILAR_REPETE = '1';
  const pedir = (n, k, de = 0) => { const f = path.join(tmp, `rep-${n}.jsonl`); fs.writeFileSync(f, Array.from({ length: k }, (_, i) => [
    msg('user', `gera o relatório mensal de vendas da loja em PDF ${de + i}, chave sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV`), ...(i ? [] : [msg('user', 'commit e push')]), // segredo-ok — chave falsa do teste
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node relatorio.js --mes' } }] } })].join('\n')).join('\n') + '\n'); return f; };
  const receita = JSON.stringify({ vale: true, nome: 'Relatório Mensal', descricao: 'gerar o relatório mensal de vendas em pdf', passos: '1. node relatorio.js --mes' });
  respostas(receita); filho('--rodar', pedir('a', 3), tmp, '--licoes', lic);
  confere(pedidos().length === 0, 'o que se repete: 3 pedidos num chat só ainda não perguntam nada');
  respostas(receita); filho('--rodar', pedir('b', 2, 3), tmp, '--licoes', lic);
  const rp = pedidos()[0] || '', sk = path.join(tmp, 'cfg', 'biblioteca', 'relatorio-mensal', 'SKILL.md');
  confere(pedidos().length === 1 && /5 vezes em 2 chats/.test(rp) && rp.includes('node relatorio.js') && !rp.includes('ABCDEFGHIJ') && !rp.includes('PEDIDO: commit'),
    '5 pedidos em 2 chats vão ao Haiku com o que o agente fez, sem o segredo e sem o "commit e push"');
  const cat = fs.existsSync(path.join(tmp, 'cfg', 'biblioteca', 'CATALOGO.md')) ? fs.readFileSync(path.join(tmp, 'cfg', 'biblioteca', 'CATALOGO.md'), 'utf8') : '';
  confere(fs.existsSync(sk) && /^- \*\*relatorio-mensal\*\*: .*\n\s*`[^`]+SKILL\.md`/m.test(cat), 'vira skill na biblioteca, no formato do catálogo que o licao-na-mensagem lê');
  confere(JSON.parse(fs.readFileSync(path.join(process.env.DESTILAR_ESTADO, 'novidades.json'), 'utf8')).some(n => /skill ‹auto› "relatorio-mensal".*--desfazer relatorio-mensal/.test(n)), 'e vira novidade do próximo chat, com o jeito de desfazer');
  respostas(receita); filho('--rodar', pedir('c', 3), tmp, '--licoes', lic);
  confere(pedidos().length === 0, 'o grupo que já virou skill não pergunta de novo');
  const df = filho('--desfazer', 'relatorio-mensal');
  confere(!fs.existsSync(sk) && !fs.readFileSync(path.join(tmp, 'cfg', 'biblioteca', 'CATALOGO.md'), 'utf8').includes('relatorio-mensal') && /apagada/.test(df.stdout), '--desfazer apaga a skill e a linha do catálogo');

  // a biblioteca que se cuida: uso + Aprendido, podar, juntar, semana, esquecer, listar — e o desfazer de cada um
  process.env.DESTILAR_REPETE = '0';
  const bib = path.join(tmp, 'cfg', 'biblioteca'), skMd = n => path.join(bib, n, 'SKILL.md'), dias = d => new Date(Date.now() - d * 864e5).toLocaleDateString('sv');
  const criar = (n, auto) => { fs.mkdirSync(path.dirname(skMd(n)), { recursive: true });
    fs.writeFileSync(skMd(n), `---\nname: ${n}\ndescription: skill ${n}\n---\n\n${auto ? `> ${MARCA_AUTO} em ${auto}: teste.\n\n` : ''}## Passos\n\n1. faça o site com a receita padrão, do começo ao fim, conferindo cada tela.\n2. publique e confira.\n`);
    fs.appendFileSync(path.join(bib, 'CATALOGO.md'), `- **${n}**: skill ${n}  \n  \`${skMd(n).replace(/\\/g, '/')}\`\n`); };
  criar('fazer-site'); criar('outra-skill');
  const trA = path.join(tmp, 'chat-skill.jsonl'), leu = n => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: skMd(n) } }] } });
  fs.writeFileSync(trA, [msg('user', 'faz o site da padaria'), leu('fazer-site'), msg('assistant', 'site feito com Tailwind'), msg('user', 'não use tailwind nesse tipo de site, use CSS puro'),
    msg('assistant', 'trocado para CSS puro'), msg('user', 'agora ficou bom, obrigado'), msg('assistant', 'de nada')].join('\n') + '\n');
  respostas(JSON.stringify({ licoes: [], aprendido: [{ skill: 'fazer-site', licao: 'Use CSS puro, sem Tailwind', prova: 'não use tailwind nesse tipo de site' },
    { skill: 'fazer-site', licao: 'Inventada', prova: 'uma frase que ninguém disse neste chat' }, { skill: 'outra-skill', licao: 'Não usada', prova: 'não use tailwind nesse tipo de site' }] }));
  filho('--rodar', trA, tmp, '--licoes', lic);
  const usos = () => JSON.parse(fs.readFileSync(path.join(process.env.DESTILAR_ESTADO, 'usos.json'), 'utf8'));
  confere((pedidos()[0] || '').includes('QUE O AGENTE USOU NESTE CHAT: fazer-site') && usos()['fazer-site'] > Date.now() - 60e3 && !usos()['outra-skill'],
    'a skill que o agente abriu conta como usada (usos.json) e vai no pedido; a que só está no catálogo, não');
  const fs1 = fs.readFileSync(skMd('fazer-site'), 'utf8');
  confere(/\n## Aprendido\n\n- \d{4}-\d{2}-\d{2}: Use CSS puro, sem Tailwind\n$/.test(fs1) && !fs1.includes('Inventada') && !fs.readFileSync(skMd('outra-skill'), 'utf8').includes('Aprendido'),
    'Aprendido: entra a correção com prova literal; sai a sem prova e a da skill não usada');
  filho('--desfazer', 'fazer-site', 'aprendido');
  confere(!fs.readFileSync(skMd('fazer-site'), 'utf8').includes('CSS puro'), '--desfazer <skill> aprendido tira a última linha');

  criar('velha-auto', dias(40)); criar('nova-auto', dias(0)); criar('usada-auto', dias(40)); criar('manual-velha');
  fs.writeFileSync(path.join(process.env.DESTILAR_ESTADO, 'usos.json'), JSON.stringify({ ...usos(), 'usada-auto': Date.now() - 2 * 864e5, 'manual-velha': Date.now() - 90 * 864e5 }));
  respostas('{"licoes":[]}'); filho('--rodar', trA, tmp, '--licoes', lic);
  const catA = () => fs.readFileSync(path.join(bib, 'CATALOGO.md'), 'utf8');
  confere(fs.existsSync(path.join(bib, '_arquivo', 'velha-auto', 'SKILL.md')) && !fs.existsSync(skMd('velha-auto')) && !catA().includes('velha-auto'),
    'podar: a ‹auto› de 40 dias sem uso vai para biblioteca/_arquivo e sai do catálogo');
  confere(['nova-auto', 'usada-auto', 'manual-velha'].every(n => fs.existsSync(skMd(n))), 'podar: a nova, a usada há 2 dias e a manual (90 dias sem uso) ficam');
  filho('--desfazer', 'velha-auto', 'poda');
  confere(fs.existsSync(skMd('velha-auto')) && /\*\*velha-auto\*\*: skill velha-auto/.test(catA()) && usos()['velha-auto'] > Date.now() - 60e3,
    '--desfazer <skill> poda: volta à biblioteca e ao catálogo, contando como usada hoje');

  for (let k = 1; k <= 5; k++) aprender(skMd('fazer-site'), `- ${dias(0)}: correção ${k} da pessoa`);
  const antesJ = fs.readFileSync(skMd('fazer-site'), 'utf8');
  respostas('# curto'); filho('--rodar', trA, tmp, '--licoes', lic);
  confere(fs.readFileSync(skMd('fazer-site'), 'utf8') === antesJ && !fs.existsSync(skMd('fazer-site') + '.antes-de-juntar') && (pedidos()[0] || '').startsWith('JUNTAR-APRENDIDO'),
    'juntar: com 5 linhas pergunta; o texto encolhido é recusado e nada muda');
  respostas('## Passos\n\n1. faça o site com a receita padrão, em CSS puro, do começo ao fim, conferindo cada tela (correções 1 a 5).\n2. publique e confira.');
  filho('--rodar', trA, tmp, '--licoes', lic);
  const dep = fs.readFileSync(skMd('fazer-site'), 'utf8');
  confere(dep.startsWith('---\nname: fazer-site') && dep.includes('correções 1 a 5') && !dep.includes('## Aprendido') && fs.readFileSync(skMd('fazer-site') + '.antes-de-juntar', 'utf8') === antesJ,
    'juntar: o bom entra, o cabeçalho fica, e a cópia de antes é guardada');
  filho('--desfazer', 'fazer-site', 'juntar');
  confere(fs.readFileSync(skMd('fazer-site'), 'utf8') === antesJ, '--desfazer <skill> juntar volta byte a byte');

  const sem = filho('--semana', '--licoes', lic), dirS = path.join(process.env.DESTILAR_ESTADO, 'semana'), ts = fs.existsSync(dirS) ? fs.readdirSync(dirS) : [];
  const txS = ts.length ? fs.readFileSync(path.join(dirS, ts[0]), 'utf8') : '';
  confere(/^\d{4}-S\d{2}\.md$/.test(ts[0] || '') && txS.includes('aprendeu — fazer-site') && txS.includes('juntou — fazer-site') && txS.includes('arquivou — velha-auto')
    && /nº 41: Lição boa nova/.test(txS) && /US\$ \d/.test(txS) && !sem.stderr, '--semana: o resumo sem LLM, com o que aprendeu, juntou, arquivou e as ‹auto› esperando');

  const antesE = fs.readFileSync(lic, 'utf8');
  filho('--esquecer', '41', '--licoes', lic);
  confere(!fs.readFileSync(lic, 'utf8').includes('‹nº 41›') && fs.readFileSync(path.join(tmp, 'meu', 'Archive', 'ESQUECIDAS.md'), 'utf8').includes('‹nº 41›'),
    '--esquecer 41: sai do meu/ e vai para meu/Archive/ESQUECIDAS.md');
  const ls = filho('--listar', '--licoes', lic).stdout;
  filho('--desfazer', 'licao', '41', '--licoes', lic);
  confere(fs.readFileSync(lic, 'utf8') === antesE && !fs.readFileSync(path.join(tmp, 'meu', 'Archive', 'ESQUECIDAS.md'), 'utf8').includes('‹nº 41›'), '--desfazer licao 41 volta byte a byte');
  confere(['--desfazer fazer-site aprendido', '--desfazer nova-auto', '--desfazer licao 41', 'FAXINA.md', 'semana'].every(s => ls.includes(s)) && !ls.includes('--desfazer manual-velha\n'),
    '--listar: cada coisa que rodou sozinha, com o comando de desfazer');

  // os COMANDOS: --lembrar, --status, --comecar
  const lem = j => cp.spawnSync(process.execPath, [__filename, '--lembrar', '--licoes', lic], { input: typeof j === 'string' ? j : JSON.stringify(j), encoding: 'utf8' });
  const prox = () => Number(fs.readFileSync(lic, 'utf8').match(/Próximo nº: (\d+)/)[1]), p0 = prox();
  const r1 = lem({ titulo: 'Ditada pela pessoa', tema: '07', aconteceu: 'caso real', regra: 'faça assim' });
  confere(r1.status === 0 && lerLicoes(lic).entradas[0].titulo === `### Ditada pela pessoa ‹tema: 07› ‹nº ${p0}› ‹1×›` && prox() === p0 + 1
    && /ditada pela pessoa\)\*: caso real/.test(fs.readFileSync(lic, 'utf8')), '--lembrar grava em cima, com o próximo nº, sem ‹auto›');
  const antesL = fs.readFileSync(lic, 'utf8');
  const recusas = [lem({ titulo: 'ditada  pela pessoa', aconteceu: 'x', regra: 'y' }), lem({ titulo: 'Sem caso', regra: 'y' }), lem('não é json'),
    lem({ titulo: 'Com chave', aconteceu: 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV', regra: 'y' })];   // segredo-ok — chave falsa do teste
  confere(recusas.every(r => r.status === 1) && fs.readFileSync(lic, 'utf8') === antesL, '--lembrar recusa título repetido, lição sem caso, entrada que não é JSON e segredo — sem mexer no arquivo');

  process.env.ROTINAS_ESTADO = path.join(tmp, 'rotinas'); fs.mkdirSync(process.env.ROTINAS_ESTADO);
  fs.writeFileSync(path.join(process.env.ROTINAS_ESTADO, 'rotinas.json'), JSON.stringify([{ nome: 'dependencias', cada: '7d', pedido: 'x' }]));
  fs.writeFileSync(path.join(process.env.DESTILAR_ESTADO, 'novidades.json'), JSON.stringify(['uma novidade de teste']));
  respostas('{"licoes":[]}');
  const st = filho('--status', '--licoes', lic).stdout;
  confere(/Lições próprias: \d+, \d+ ‹auto›/.test(st) && /Biblioteca: \d+ skill/.test(st) && st.includes('Rotinas: dependencias (a cada 7d)') && /US\$ \d+\.\d\d em 7 dias/.test(st)
    && /Último chat lido: /.test(st) && st.includes('uma novidade de teste') && !pedidos().length, '--status: lições, ‹auto›, biblioteca, rotinas, custo do registro.log e novidades, sem chamar o Haiku');
  fs.mkdirSync(path.join(bib, '_arquivo', 'arquivada-teste'), { recursive: true });   // a velha-auto voltou com o --desfazer poda
  const sb = filho('--skills').stdout;
  confere(/- fazer-site: último uso \d\d\/\d\d\/\d{4}/.test(sb) && /Arquivadas por falta de uso: .*arquivada-teste/.test(sb) && (!/‹auto›/.test(sb) || sb.indexOf('‹auto›') < sb.indexOf('- fazer-site')),
    '--skills: a biblioteca com o último uso, as ‹auto› primeiro, e as arquivadas');

  const projC = path.join(tmp, 'projC'), pdir = pastaDoProjeto(projC); fs.mkdirSync(projC); fs.mkdirSync(pdir, { recursive: true });
  const chatDe = (nome, horas) => { const f = path.join(pdir, nome); fs.writeFileSync(f, conversa(3)); const s = (Date.now() - horas * 3600e3) / 1000; fs.utimesSync(f, s, s); return f; };
  const c1 = chatDe('c1.jsonl', 30), c2 = chatDe('c2.jsonl', 5), c3 = chatDe('c3.jsonl', 2), agora = chatDe('agora.jsonl', 0);
  respostas('{"licoes":[]}');
  const rc = cp.spawnSync(process.execPath, [__filename, '--comecar', '2', '--licoes', lic], { cwd: projC, encoding: 'utf8', env: { ...process.env, DESTILAR_ESPERA: '1', DESTILAR_CLAUDE: `"${process.execPath}" "${falso}"` } });
  const lidosC = lerJSON(path.join(process.env.DESTILAR_ESTADO, 'estado.json'), {}).lidos || {};
  confere(/Lendo 2 chat/.test(rc.stdout) && pedidos().length === 2 && lidosC[c3] && lidosC[c2] && !lidosC[c1] && !lidosC[agora], '--comecar 2: os 2 chats mais novos do projeto, sem o de agora');
  const [proj1, pasta1] = process.platform === 'win32' ? ['C:\\Users\\Ana\\OneDrive\\Claude Code\\MEU-SITE', 'C--Users-Ana-OneDrive-Claude-Code-MEU-SITE'] : ['/home/ana/meu site.v2', '-home-ana-meu-site-v2'];
  confere(path.basename(pastaDoProjeto(proj1)) === pasta1, 'a pasta dos chats do projeto: cada caractere fora de [a-zA-Z0-9] vira "-"');

  // o PLUGIN, sem base: a casa de mentira (sem additionalDirectories), e a opção decide
  const guarda = { ...process.env }, casa = path.join(tmp, 'casa');
  Object.assign(process.env, { USERPROFILE: casa, HOME: casa, LICOES_DIR: '', CLAUDE_PLUGIN_ROOT: tmp });
  delete process.env.CLAUDE_PLUGIN_OPTION_DESTILAR;
  confere(arquivoMeu(tmp) === null, 'no plugin, com a opção "destilar" desligada, não destila');
  process.env.CLAUDE_PLUGIN_OPTION_DESTILAR = 'true';
  const am = arquivoMeu(tmp);
  confere(am === path.join(casa, '.claude', 'licoes', 'meu', 'LICOES-PROPRIAS.md') && lerLicoes(am).ini >= 0 && /Próximo nº: 1/.test(fs.readFileSync(am, 'utf8')),
    'ligada: cria ~/.claude/licoes/meu/LICOES-PROPRIAS.md no formato que o destilar lê');
  process.env.CLAUDE_PLUGIN_OPTION_PASTA_MEU = path.join(tmp, 'onedrive-meu');
  confere(arquivoMeu(tmp) === path.join(tmp, 'onedrive-meu', 'LICOES-PROPRIAS.md'), 'e a opção "pasta_meu" muda o lugar');
  confere(arqDoComando('', '${user_config.pasta_meu}', tmp, false) === am && arqDoComando('x.md', path.join(tmp, 'm2'), tmp) === 'x.md'
    && arqDoComando('', path.join(tmp, 'm2'), tmp, false) === path.join(tmp, 'm2', 'LICOES-PROPRIAS.md') && !fs.existsSync(path.join(tmp, 'm2')),
    'os comandos: --licoes › base › --meu; o "${…}" cru (opção sem valor) é a pasta padrão; só o lembrar e o comecar criam o arquivo');
  for (const k of Object.keys(process.env)) if (!(k in guarda)) delete process.env[k];
  Object.assign(process.env, guarda);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.'); process.exitCode = falhas ? 1 : 0;
}

// ---------- entrada ----------
const a = process.argv.slice(2), opc = n => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
if (a[0] === '--teste') teste();
else if (a[0] === '--rodar') rodar(a[1], a[2], opc('--licoes'), a.includes('--inicio'));
else if (a[0] === '--rodar-lista') rodarLista(a[1], a[2], a.slice(3));
else if (a[0] === '--skills') skills();
else if (['--desfazer', '--esquecer', '--listar', '--semana', '--status', '--lembrar', '--comecar'].includes(a[0])) {
  const arq = arqDoComando(opc('--licoes'), opc('--meu'), process.cwd(), ['--lembrar', '--comecar'].includes(a[0]));
  if (a[0] === '--desfazer') desfazer(a[1], a[2], a[1] === 'licao' ? arq : null);
  else if (a[0] === '--esquecer') esquecer(a[1], arq);
  else if (a[0] === '--listar') listar(arq);
  else if (a[0] === '--semana') semana(arq, true);
  else if (a[0] === '--status') status(arq);
  else if (a[0] === '--comecar') comecar(a[1], arq, process.cwd());
  else { let i = ''; process.stdin.on('data', c => (i += c)).on('end', () => lembrar(arq, i, process.cwd())); }
}
else if (a[0] === '--faxina') { const s = travar(); try { faxina(opc('--licoes'), true); } catch (e) { registrar('ERRO ' + e.message); } finally { s && s(); } }
else if (!process.env.DESTILAR_FILHO) {
  // o gancho: lê a entrada, solta o trabalho em segundo plano e devolve o controle na hora
  let i = ''; process.stdin.on('data', c => (i += c)).on('end', () => {
    let e = {}; try { e = JSON.parse(i); } catch {}
    if (!e.transcript_path) return;
    if (process.env.CLAUDE_PLUGIN_ROOT && !/^(true|1|sim)$/i.test(process.env.CLAUDE_PLUGIN_OPTION_DESTILAR || '')) return;   // plugin, opção desligada
    registrar(`chamado por ${e.hook_event_name || '?'}${e.reason ? ' (' + e.reason + ')' : ''} ${path.basename(e.transcript_path)}`);   // qual evento chamou: prova se o app dispara o SessionEnd
    const inicio = e.hook_event_name === 'SessionStart' ? ['--inicio'] : [];
    cp.spawn(process.execPath, [__filename, '--rodar', e.transcript_path, e.cwd || '', ...inicio], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  });
}
