#!/usr/bin/env node
// Trava de CHAT PARADO — gancho UserPromptSubmit do Claude Code (base LIÇÕES GERAIS, 09 §9.15).
//
// Barra UMA vez a mensagem que chega num chat GRANDE depois que o cache venceu, e diz quanto
// custaria continuar ali. Mandou de novo em até 30 minutos? Passa. Comando com "/" sempre passa.
// Não custa contexto: quando não barra, não escreve nada. Se algo falhar aqui dentro, deixa passar.
// E o outro lado: a PRIMEIRA mensagem de um chat novo é só "continue"? Mostra onde o chat anterior do
// projeto parou (modelos/fim-do-chat.js da base, ~4 mil tokens, uma vez) — o "continue" basta.
// E na PRIMEIRA mensagem de todo chat de projeto equipado: a base mudou desde a destilação (VERSAO.md
// contra o cabeçalho do LICOES-APLICADAS.md, LEIA-PRIMEIRO §5)? Diz em ~60 tokens. Igual, não escreve nada.
// E na PRIMEIRA mensagem de todo chat: qual máquina é esta, lida de ~/.claude/maquina.txt (~40 tokens; sem o arquivo, nada).
// E, se o projeto é Git com remoto, o próprio gancho roda o git pull e lembra que o push é do agente (~70 tokens; sem Git, nada).
// Existe porque a ordem escrita falhou: um agente leu o PROGRESSO.md e nunca abriu o destilado (23/09/2026).
// E o chat GRANDE que NÃO parou: passou do limiar? Uma nota de ~80 tokens manda o agente, ao terminar a
// tarefa, sugerir chat novo para a próxima, com o prompt pronto (pedido do dono, 23/09/2026) — o agente não
// enxerga o tamanho do próprio chat; o gancho enxerga.
//
// Testar sem barrar nada:  node chat-parado.js --teste "<caminho do .jsonl da sessão>"

const fs = require('fs'), path = require('path'), os = require('os');

const LINGUA = 'pt';        // 'pt' ou 'en' — o agente acerta ao copiar, pelo idioma da pessoa
const PARADO_MIN = +(process.env.CHAT_PARADO_MIN || 60);        // prazo do cache: 60 na assinatura; 5 usando créditos extras
const GRANDE = +(process.env.CHAT_PARADO_TOKENS || 100000);     // era 150 mil: um de 141 mil passou e custou ~406 mil (09 §9.15)
const INSISTIU_MIN = 30;
const CONTINUE = /^(continu|segue|siga|prossig|retom|go on|keep going|carry on|resume)/i;     // até 60 caracteres

function ultimaResposta(arq) {
  // só o fim do arquivo: o registro de uma sessão longa passa de 50 MB
  const fd = fs.openSync(arq, 'r'), tam = fs.fstatSync(fd).size, n = Math.min(tam, 4 << 20);
  const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, tam - n); fs.closeSync(fd);
  for (const l of buf.toString('utf8').split('\n').reverse()) {
    if (!l.includes('"usage"')) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type !== 'assistant' || o.isSidechain || !o.message || !o.message.usage) continue;
    const u = o.message.usage;
    const contexto = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    if (contexto) return { quando: new Date(o.timestamp), contexto };
  }
  return null;
}

function aviso(mil, parado, prompt) {
  const tempo = parado >= 120 ? Math.round(parado / 60) + (LINGUA === 'en' ? ' hours' : ' horas')
                              : Math.round(parado) + (LINGUA === 'en' ? ' minutes' : ' minutos');
  const txt = prompt.length > 1500 ? prompt.slice(0, 1500) + ' […]' : prompt;
  if (LINGUA === 'en') return `
⏸️ MESSAGE NOT SENT — this chat's cache expired

This chat holds ${mil}k tokens and sat idle for ${tempo}. Replying here would re-read all of it at full price: ~${2 * mil}k tokens just to start, and the ${mil}k again at every step.

WHAT TO DO — pick one:

1️⃣ The last reply ended with a resume prompt?
→ Open a new chat and paste that prompt.

2️⃣ No resume prompt (the chat stopped mid-task, the limit ran out)?
→ Open a new chat and type just: continue
(Claude reads only the end of this chat, ~4k tokens.)

3️⃣ Want to continue here anyway?
→ Send the message again within ${INSISTIU_MIN} min.

YOUR MESSAGE, to copy:
────────────
${txt}
`;
  return `
⏸️ MENSAGEM NÃO ENVIADA — o cache deste chat venceu

Este chat tem ${mil} mil tokens e ficou parado ${tempo}. Responder aqui releria tudo a preço cheio: ~${2 * mil} mil tokens só para começar, e os ${mil} mil de novo a cada passo.

O QUE FAZER — escolha um:

1️⃣ A última resposta terminou com um prompt de retomada?
→ Abra um chat novo e cole esse prompt.

2️⃣ Não tem prompt (o chat parou no meio, o limite acabou)?
→ Abra um chat novo e escreva só: continue
(O Claude lê só o fim deste chat, ~4 mil tokens.)

3️⃣ Quer continuar aqui mesmo assim?
→ Mande a mensagem de novo em até ${INSISTIU_MIN} min.

SUA MENSAGEM, para copiar:
────────────
${txt}
`;
}

function grande(mil) {                                             // chat grande, ainda em uso: só uma nota ao agente
  return LINGUA === 'en'
    ? `[chat-parado hook] This chat already holds ${mil}k tokens (threshold: ${GRANDE / 1000}k). Do what the message asks. When the TASK is done, say in the reply that the next task is cheaper in a new chat — every step here re-reads the ${mil}k, against ~50k for a new chat — and hand over the ready prompt. An answer to your own question, or a step in the middle of the same task: just carry on.`
    : `[gancho chat-parado] Este chat já tem ${mil} mil tokens (limiar: ${GRANDE / 1000} mil). Faça o que a mensagem pede. Ao TERMINAR a tarefa, diga na resposta que a próxima sai mais barata num chat novo — cada passo aqui relê os ${mil} mil, contra ~50 mil de um chat novo — e entregue o prompt pronto. Resposta a pergunta sua, ou passo do meio da mesma tarefa: só siga.`;
}

function acharPasta(cwd) {                                           // a base: LICOES_DIR, ou additionalDirectories
  const tem = d => d && fs.existsSync(path.join(d, 'modelos', 'fim-do-chat.js'));
  // a pasta da base, ou uma subpasta dela — quem aponta a pasta-mãe (com as versões dentro) também acha (25/09/2026)
  const ok = d => { if (tem(d)) return d; try { for (const s of fs.readdirSync(d).sort().reverse()) if (tem(path.join(d, s))) return path.join(d, s); } catch {} return null; };
  const e = ok(process.env.LICOES_DIR); if (e) return e;
  const cands = [path.join(os.homedir(), '.claude', 'settings.json')];
  if (cwd) cands.push(path.join(cwd, '.claude', 'settings.local.json'), path.join(cwd, '.claude', 'settings.json'));
  for (const f of cands) {
    try { for (const d of (JSON.parse(fs.readFileSync(f, 'utf8')).permissions || {}).additionalDirectories || []) { const b = ok(d); if (b) return b; } } catch {}
  }
  return null;
}

function ondeParou(e) {
  const base = acharPasta(e.cwd); if (!base) return;
  const saida = require('child_process').execFileSync(process.execPath, [path.join(base, 'modelos', 'fim-do-chat.js'), '--pasta', e.cwd || process.cwd()],
    { env: { ...process.env, CLAUDE_CODE_SESSION_ID: String(e.session_id || '') }, timeout: 15000, encoding: 'utf8' });
  console.log((LINGUA === 'en'
    ? '[chat-parado hook] First message of a new chat, and it only says "continue". Below, the end of the previous chat of this project, for context:\n\n'
    : '[gancho chat-parado] Primeira mensagem de um chat novo, e ela só diz "continue". Abaixo, o fim do chat anterior deste projeto, como contexto:\n\n') + saida);
}

function baseMudou(e) {                                             // LEIA-PRIMEIRO §5, sem depender de o agente ler
  const cwd = e.cwd || process.cwd(), apl = path.join(cwd, 'LICOES-APLICADAS.md');
  if (!fs.existsSync(apl)) return;                                   // projeto não equipado: nada a comparar
  const base = acharPasta(cwd); if (!base) return;
  const cab = fs.readFileSync(apl, 'utf8');
  const versao = (fs.readFileSync(path.join(base, 'VERSAO.md'), 'utf8').match(/^\s*(\d+(?:\.\d+)+ · \d{4}-\d{2}-\d{2})/m) || [])[1];
  const destilado = (cab.match(/Destilado contra a versão:\s*(\d+(?:\.\d+)+ · \d{4}-\d{2}-\d{2})/) || [])[1];
  const visto = +((cab.match(/Última lição própria vista:\s*nº\s*(\d+)/) || [])[1]);
  let maior = 0;
  try { for (const m of fs.readFileSync(path.join(base, 'meu', 'LICOES-PROPRIAS.md'), 'utf8').matchAll(/‹nº (\d+)›/g)) maior = Math.max(maior, +m[1]); } catch {}
  const b = base.replace(/\\/g, '/'), linhas = [];
  const adiada = (cab.match(/Atualização adiada:\s*(\d+(?:\.\d+)+ · \d{4}-\d{2}-\d{2})/) || [])[1];
  if (versao && destilado && versao !== destilado && versao !== adiada) {   // adiada para ESTA versão: a pessoa pede quando quiser
    // Estimativa medida, não chutada (ATUALIZAR §1): o texto das rodadas novas (mesma data entra) + ~2 mil do procedimento.
    const desde = destilado.slice(-10); let bytes = 0, rodadas = 0, dentro = false;
    for (const l of fs.readFileSync(path.join(base, 'MUDANCAS.md'), 'utf8').split('\n')) {
      const d = (l.match(/^### (\d{4}-\d{2}-\d{2})/) || [])[1];
      if (d) { dentro = d >= desde; if (dentro) rodadas++; }
      if (dentro) bytes += Buffer.byteLength(l) + 1;
    }
    const mil = Math.max(1, Math.round((bytes / 4 + 2000) / 1000));
    linhas.push(LINGUA === 'en'
      ? `The LIÇÕES GERAIS base changed: it is at ${versao}, this project was distilled against ${destilado} — ${rodadas} new round(s) in MUDANCAS.md, ~${mil}k tokens to read, plus whatever the rounds say to edit. Before the task, ASK the person with on-screen options: "update now (~${mil}k tokens read)" or "later". Now → ${b}/ATUALIZAR.md. Later → write "Atualização adiada: ${versao}" in the LICOES-APLICADAS.md header; they can say "update the folder" any time. Never mid-block.`
      : `A base de LIÇÕES GERAIS mudou: está em ${versao}, e este projeto foi destilado contra ${destilado} — ${rodadas} rodada(s) nova(s) no MUDANCAS.md, ~${mil} mil tokens de leitura, mais o que as rodadas mandarem editar. Antes da tarefa, PERGUNTE à pessoa, com opções na tela: "atualizar agora (~${mil} mil tokens de leitura)" ou "depois". Agora → ${b}/ATUALIZAR.md. Depois → grave "Atualização adiada: ${versao}" no cabeçalho do LICOES-APLICADAS.md; ela pede "atualize a pasta" quando quiser. Nunca no meio de um bloco.`);
  }
  if (visto >= 0 && maior > visto)
    linhas.push(LINGUA === 'en'
      ? `Another project wrote a new lesson (nº ${visto + 1} to ${maior}): read only the new titles (LEIA-PRIMEIRO.md §5) and record nº ${maior} in LICOES-APLICADAS.md.`
      : `Outro projeto escreveu lição nova (nº ${visto + 1} a ${maior}): leia só os títulos das novas (LEIA-PRIMEIRO.md §5) e grave o nº ${maior} no LICOES-APLICADAS.md.`);
  if (linhas.length) console.log('[gancho chat-parado] ' + linhas.join('\n'));
}

function maquina() {                                                 // qual computador é este (pedido do dono, 25/09/2026)
  // ~/.claude/maquina.txt NÃO viaja pelo OneDrive: cada máquina tem o seu. Sem o arquivo, cala (quem tem uma máquina só).
  const n = fs.readFileSync(path.join(os.homedir(), '.claude', 'maquina.txt'), 'utf8').trim(); if (!n) return;
  console.log(LINGUA === 'en'
    ? `[chat-parado hook] This computer: ${n}. Chat history and settings.json are THIS computer's; work done on the other one is known only through PROGRESSO.md.`
    : `[gancho chat-parado] Esta máquina: ${n}. O histórico de chats e o settings.json são DESTA máquina; o que foi feito na outra, só pelo PROGRESSO.md.`);
}

function sincronizar(e) {                                            // git pull SEM depender do agente (pedido do dono, 26/09/2026)
  // Projeto com Git e remoto: o gancho faz o pull e lembra que o push é do agente. O CLAUDE.md do projeto
  // só leva o "Fluxo Git" se nasceu do modelo — um projeto montado às pressas ficou sem, e o dono fez o push à mão.
  const cwd = e.cwd || process.cwd(), cp = require('child_process');
  const git = (...a) => cp.execFileSync('git', a, { cwd, timeout: 7000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();       // nunca espera senha: sem login, falha e avisa
  try { git('rev-parse', '--is-inside-work-tree'); if (!git('remote')) return; } catch { return; }   // sem Git ou sem remoto: cala
  let r;
  try { const o = git('pull', '--ff-only'); r = /up to date|atualizado/i.test(o) ? (LINGUA === 'en' ? 'already up to date' : 'já estava em dia') : (LINGUA === 'en' ? 'brought new commits' : 'trouxe commits novos'); }
  catch (x) { r = (LINGUA === 'en' ? 'FAILED — tell the person in one line and fix it before touching files: ' : 'FALHOU — diga à pessoa numa linha e resolva antes de encostar em arquivo: ') + String(x.stderr || x.message).trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 200); }
  console.log(LINGUA === 'en'
    ? `[chat-parado hook] Git: this hook already ran git pull (${r}). YOU commit and push at the end of EVERY step, on your own — never ask the person to run pull or push. The project's CLAUDE.md sets a branch flow? That one prevails.`
    : `[gancho chat-parado] Git: o gancho já rodou o git pull (${r}). O commit e o push ao fim de CADA passo são SEUS, sozinho — nunca peça à pessoa para rodar pull ou push. O CLAUDE.md do projeto manda fluxo com branch? Vale o dele.`);
}

function chatNovo(e, prompt) {                                       // nenhuma resposta ainda neste chat
  try { maquina(); } catch {}
  try { sincronizar(e); } catch {}
  try { baseMudou(e); } catch {}
  if (prompt.length <= 60 && CONTINUE.test(prompt)) try { ondeParou(e); } catch {}
}

function principal(e) {
  const prompt = String(e.prompt || '').trim();
  if (prompt.startsWith('/')) return;                                   // /compact, /clear, /usage passam
  if (!e.transcript_path || !fs.existsSync(e.transcript_path)) return chatNovo(e, prompt);
  const r = ultimaResposta(e.transcript_path);
  if (!r) return chatNovo(e, prompt);
  const parado = (Date.now() - r.quando) / 60000;
  if (r.contexto < GRANDE) return;
  if (parado < PARADO_MIN) return console.log(grande(Math.round(r.contexto / 1000)));
  const marca = path.join(os.tmpdir(), 'chat-parado-' + String(e.session_id || 'sessao').replace(/[^\w-]/g, ''));
  try {
    if (Date.now() - fs.statSync(marca).mtimeMs < INSISTIU_MIN * 60000) { fs.unlinkSync(marca); return; }
  } catch {}
  fs.writeFileSync(marca, '');
  process.stderr.write(aviso(Math.round(r.contexto / 1000), parado, prompt));
  process.exit(2);                                                      // 2 = barra a mensagem e mostra o aviso
}

if (process.argv[2] === '--teste') {
  const r = ultimaResposta(process.argv[3]);
  console.log(r ? `última resposta: ${r.quando.toISOString()} · contexto ${Math.round(r.contexto / 1000)} mil · parado ${Math.round((Date.now() - r.quando) / 60000)} min · barraria: ${(Date.now() - r.quando) / 60000 >= PARADO_MIN && r.contexto >= GRANDE} · sugeriria chat novo: ${(Date.now() - r.quando) / 60000 < PARADO_MIN && r.contexto >= GRANDE}` : 'nenhuma resposta com uso no fim do arquivo');
} else {
  let entrada = '';
  process.stdin.on('data', d => entrada += d).on('end', () => {
    try { principal(JSON.parse(entrada)); } catch { process.exit(0); }
  });
}
