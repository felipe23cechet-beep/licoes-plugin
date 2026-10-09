#!/usr/bin/env node

const fs = require('fs'), path = require('path'), os = require('os');

const LINGUA = 'pt';
const PARADO_MIN = +(process.env.CHAT_PARADO_MIN || 60);

const CONVERSA = +(process.env.CHAT_PARADO_TOKENS || 50000);
const INSISTIU_MIN = 30;
const CONTINUE = /^(continu|segue|siga|prossig|retom|go on|keep going|carry on|resume)/i;

function parteFixa(arq) {
  const fd = fs.openSync(arq, 'r'), n = Math.min(fs.fstatSync(fd).size, 2 << 20);
  const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, 0); fs.closeSync(fd);
  for (const l of buf.toString('utf8').split('\n')) {
    if (!l.includes('"usage"')) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type !== 'assistant' || o.isSidechain || !o.message || !o.message.usage) continue;
    const u = o.message.usage, c = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    if (c) return c;
  }
  return 0;
}

function ultimaResposta(arq) {

  const fd = fs.openSync(arq, 'r'), tam = fs.fstatSync(fd).size, n = Math.min(tam, 4 << 20);
  const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, tam - n); fs.closeSync(fd);
  let limite;
  for (const l of buf.toString('utf8').split('\n').reverse()) {
    if (!l.includes('"usage"')) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type !== 'assistant' || o.isSidechain || !o.message || !o.message.usage) continue;

    if (o.error === 'rate_limit') { if (limite === undefined) limite = ((o.quotaLimits || {}).resetsAt || 0) * 1000; continue; }
    const u = o.message.usage;
    const contexto = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    if (contexto) { const base = parteFixa(arq); return { quando: new Date(o.timestamp), contexto, base, conversa: contexto - base, limite }; }
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

function grande(mil, base) {
  return LINGUA === 'en'
    ? `[chat-parado hook] This chat already holds ${mil}k tokens (${mil - base}k of conversation over the ${base}k it started with). Do what the message asks. The size is NOT a reason to stop, cut short or leave an item for another chat: a decided list goes to the end in this chat (the conversation compacts itself near the limit). Only when EVERYTHING decided is done, say in the reply that the next task is cheaper in a new chat — every step here re-reads the ${mil}k, against the ~${base}k a new chat starts with — and hand over the ready prompt.`
    : `[gancho chat-parado] Este chat já tem ${mil} mil tokens (${mil - base} mil de conversa sobre os ${base} mil com que nasceu). Faça o que a mensagem pede. O tamanho NÃO é motivo para parar, encurtar nem deixar item para outro chat: lista decidida vai até o fim neste chat (a conversa se resume sozinha perto do limite). Só quando TUDO o que foi decidido acabar, diga na resposta que a próxima tarefa sai mais barata num chat novo — cada passo aqui relê os ${mil} mil, contra os ~${base} mil com que um chat novo começa — e entregue o prompt pronto — com a frase do modelo e do esforço para o chat novo logo ACIMA do bloco (08 §8.3, "Quando dizer, qual dizer").`;
}

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

function ondeParou(e, chegou) {

  const base = acharPasta(e.cwd), fim = path.join(base || path.join(__dirname, '..'), 'modelos', 'fim-do-chat.js');
  if (!fs.existsSync(fim)) return;
  const saida = require('child_process').execFileSync(process.execPath, [fim, '--pasta', e.cwd || process.cwd()],
    { env: { ...process.env, CLAUDE_CODE_SESSION_ID: String(e.session_id || '') }, timeout: 15000, encoding: 'utf8' });
  console.log((LINGUA === 'en'
    ? '[chat-parado hook] First message of a new chat, and it only says "continue". Below, the end of the previous chat of this project, for context:\n\n'
    : '[gancho chat-parado] Primeira mensagem de um chat novo, e ela só diz "continue". Abaixo, o fim do chat anterior deste projeto, como contexto:\n\n') + saida
    + (!chegou ? '' : LINGUA === 'en'
      ? '\n⚠️ That chat is from THIS machine and is OLDER than the commits the pull just brought (listed above): the work went on elsewhere. Resume from the Git state (state file, handoff), not from this chat.'
      : '\n⚠️ Esse chat é DESTA máquina e é MAIS VELHO que os commits que o pull acabou de trazer (lista acima): o trabalho seguiu em outro lugar. Retome pelo estado do Git (arquivo de estado, handoff), não por este chat.'));
}

function cabecalhosNasBranches(cwd) {
  const cp = require('child_process'), git = a => cp.execFileSync('git', a, { cwd, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const arq = git(['rev-parse', '--show-prefix']).trim() + 'LICOES-APLICADAS.md', out = [];
  const refs = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']).split(/\r?\n/).filter(r => r && !/\/HEAD$/.test(r) && r !== 'origin');
  for (const ref of refs.slice(0, 60)) { try { out.push({ ref, cab: git(['show', `${ref}:${arq}`]) }); } catch {} }
  return out;
}

function baseMudou(e) {
  const cwd = e.cwd || process.cwd(), apl = path.join(cwd, 'LICOES-APLICADAS.md');
  if (!fs.existsSync(apl)) return;
  const base = acharPasta(cwd); if (!base) return;
  const cab = fs.readFileSync(apl, 'utf8');
  const versao = (fs.readFileSync(path.join(base, 'VERSAO.md'), 'utf8').match(/^\s*(\d+(?:\.\d+)+ · \d{4}-\d{2}-\d{2})/m) || [])[1];
  const destilado = (cab.match(/Destilado contra a versão:\s*(\d+(?:\.\d+)+ · \d{4}-\d{2}-\d{2})/) || [])[1];
  const visto = +((cab.match(/Última lição própria vista:\s*nº\s*(\d+)/) || [])[1]);
  let maior = 0;
  try { for (const m of fs.readFileSync(path.join(base, 'meu', 'LICOES-PROPRIAS.md'), 'utf8').matchAll(/‹nº (\d+)›/g)) maior = Math.max(maior, +m[1]); } catch {}
  const b = base.replace(/\\/g, '/'), linhas = [];
  let outras = [];
  const mudou = versao && destilado && versao !== destilado;
  const precisa = mudou || (visto >= 0 && maior > visto);
  if (precisa) try { outras = cabecalhosNasBranches(cwd); } catch {}
  const ler = (c, re) => (c.match(re) || [])[1];
  const naBranch = outras.find(o => ler(o.cab, /Destilado contra a versão:\s*(\d+(?:\.\d+)+ · \d{4}-\d{2}-\d{2})/) === versao);
  if (mudou && naBranch)
    linhas.push(LINGUA === 'en'
      ? `The LIÇÕES GERAIS base is at ${versao}, and this branch was distilled against ${destilado} — but the update to ${versao} is already done on branch ${naBranch.ref}, waiting for the merge. Do NOT update again: say so in one line and go on.`
      : `A base de LIÇÕES GERAIS está em ${versao} e esta branch foi destilada contra ${destilado} — mas a atualização para ${versao} já está feita na branch ${naBranch.ref}, esperando o merge. NÃO atualize de novo: diga isso em uma linha e siga.`);
  else if (mudou)
    linhas.push(LINGUA === 'en'
      ? `The LIÇÕES GERAIS base changed: it is at ${versao}, this project was distilled against ${destilado}. Before the task, UPDATE WITHOUT ASKING: ${b}/ATUALIZAR.md §3 onward (close an open block first; delete any "Atualização adiada" line). At the end of your answer, ONE line only: "The lessons folder was updated." — nothing else about it. Say what changed only if the person asks.`
      : `A base de LIÇÕES GERAIS mudou: está em ${versao}, e este projeto foi destilado contra ${destilado}. Antes da tarefa, ATUALIZE SEM PERGUNTAR: ${b}/ATUALIZAR.md §3 em diante (feche antes o bloco aberto; apague a linha "Atualização adiada", se houver). No fim da resposta, UMA linha só: "A pasta de lições foi atualizada." — e mais nada sobre ela. O que mudou, só se a pessoa perguntar.`);
  const vistoNa = outras.find(o => +ler(o.cab, /Última lição própria vista:\s*nº\s*(\d+)/) >= maior);
  if (visto >= 0 && maior > visto && vistoNa)
    linhas.push(LINGUA === 'en'
      ? `The new lessons (up to nº ${maior}) were already read on branch ${vistoNa.ref}, waiting for the merge: nothing to do.`
      : `As lições novas (até o nº ${maior}) já foram lidas na branch ${vistoNa.ref}, esperando o merge: nada a fazer.`);
  else if (visto >= 0 && maior > visto)
    linhas.push(LINGUA === 'en'
      ? `Another project wrote a new lesson (nº ${visto + 1} to ${maior}): read only the new titles (LEIA-PRIMEIRO.md §5) and record nº ${maior} in LICOES-APLICADAS.md.`
      : `Outro projeto escreveu lição nova (nº ${visto + 1} a ${maior}): leia só os títulos das novas (LEIA-PRIMEIRO.md §5) e grave o nº ${maior} no LICOES-APLICADAS.md.`);
  if (linhas.length) console.log('[gancho chat-parado] ' + linhas.join('\n'));
}

function maquina() {

  const n = fs.readFileSync(path.join(os.homedir(), '.claude', 'maquina.txt'), 'utf8').trim(); if (!n) return;
  console.log(LINGUA === 'en'
    ? `[chat-parado hook] This computer: ${n}. Chat history and settings.json are THIS computer's; work done on the other one is known only through PROGRESSO.md. A path in a file written on the other computer may not exist here: this computer's paths are in the "Projects" table of the lessons folder's meu/PERFIL.md — use those, and a project missing there is a line to add. Before handing over a new-chat prompt, leave everything ready for the OTHER computer: what the next chat needs in a file that travels, commit and push done, and what changed only here noted in the state file (08 §8.3).`
    : `[gancho chat-parado] Esta máquina: ${n}. O histórico de chats e o settings.json são DESTA máquina; o que foi feito na outra, só pelo PROGRESSO.md. Caminho escrito na outra máquina pode não existir aqui: os DESTA estão na tabela "Projetos" do meu/PERFIL.md da pasta de lições — use esses; projeto que falta lá é linha a acrescentar. Antes de entregar prompt de chat novo, deixe tudo pronto para a OUTRA máquina: o que o próximo chat precisa num arquivo que viaja, commit e push feitos, e o que mudou só nesta anotado no arquivo de estado (08 §8.3).`);
}

function sincronizar(e) {

  const cwd = e.cwd || process.cwd(), cp = require('child_process');
  const git = (...a) => cp.execFileSync('git', a, { cwd, timeout: 7000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
  try { git('rev-parse', '--is-inside-work-tree'); if (!git('remote')) return; } catch { return; }

  let pode = ''; try { pode = git('config', '--get', 'licoes.pull'); } catch {  }
  if (pode !== 'true') {
    console.log(pode === 'false'
      ? (LINGUA === 'en'
        ? '[chat-parado hook] Git: automatic pull is OFF in this project (the person chose). Pull only when asked. Commit and push at the end of every step are still YOURS.'
        : '[gancho chat-parado] Git: o pull automático está DESLIGADO neste projeto (escolha da pessoa). Puxe só se ela pedir. Commit e push ao fim de cada passo seguem SEUS.')
      : (LINGUA === 'en'
        ? '[chat-parado hook] Git: no pull yet. In your 1st reply, ask the person ONCE, in one line: "may I download the GitHub changes (git pull) on my own at the start of every chat in this project?" Yes → `git config licoes.pull true` (every project on this computer: add --global); no → `git config licoes.pull false`. Commit and push at the end of every step are YOURS.'
        : '[gancho chat-parado] Git: nenhum pull ainda. Na 1ª resposta, pergunte à pessoa UMA vez, em uma linha: "posso baixar sozinho as mudanças do GitHub (git pull) no começo de cada chat neste projeto?" Sim → `git config licoes.pull true` (todos os projetos deste computador: com --global); não → `git config licoes.pull false`. Commit e push ao fim de cada passo são SEUS.'));
    return;
  }
  let r, antes = '', novos = '';
  try { antes = git('rev-parse', 'HEAD'); } catch {  }
  try { const o = git('pull', '--ff-only'); r = /up to date|atualizado/i.test(o) ? (LINGUA === 'en' ? 'already up to date' : 'já estava em dia') : (LINGUA === 'en' ? 'brought new commits' : 'trouxe commits novos');

    if (antes) novos = git('log', '--format=%h %ad %an %s', '--date=format:%d/%m %H:%M', '-8', antes + '..HEAD'); }
  catch (x) { r = (LINGUA === 'en' ? 'FAILED — tell the person in one line and fix it before touching files: ' : 'FALHOU — diga à pessoa numa linha e resolva antes de encostar em arquivo: ') + String(x.stderr || x.message).trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 200); }
  console.log(LINGUA === 'en'
    ? `[chat-parado hook] Git: this hook already ran git pull (${r}). YOU commit and push at the end of EVERY step, on your own — never ask the person to run pull or push. The project's CLAUDE.md sets a branch flow? That one prevails.`
    : `[gancho chat-parado] Git: o gancho já rodou o git pull (${r}). O commit e o push ao fim de CADA passo são SEUS, sozinho — nunca peça à pessoa para rodar pull ou push. O CLAUDE.md do projeto manda fluxo com branch? Vale o dele.`);
  if (novos) console.log(LINGUA === 'en'
    ? `[chat-parado hook] Work done ELSEWHERE (other machine or person) since this machine's last pull — read it before anything, and tell the person in one line that you saw it:\n${novos}`
    : `[gancho chat-parado] Trabalho feito FORA DESTA MÁQUINA (outra máquina ou pessoa) desde o último pull daqui — leia antes de tudo e diga à pessoa, em uma linha, que viu:\n${novos}`);
  return !!novos;
}

function nuvem(e) {

  const cwd = e.cwd || process.cwd(), cp = require('child_process');
  const git = (...a) => { try { return cp.execFileSync('git', a, { cwd, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
  const br = git('branch', '--show-current') || '?';
  const rep = (git('remote', 'get-url', 'origin').match(/([^/:]+)\/([^/]+?)(?:\.git)?\/?$/) || []).slice(1).join('/') || 'DONO/REPO';
  console.log(LINGUA === 'en'
    ? `[chat-parado hook] CLOUD SESSION (branch ${br}, repository ${rep}). The person sees less here than in the desktop app, and gets lost. In your 1st reply, BEFORE the task, tell them in at most 4 short lines what does not work here and what to do instead. Keep to this for the whole session:
1. A file name in your reply does NOT open (the file lives on this cloud machine). To show a file: send it with your file-sending tool if you have one; otherwise paste the part that matters, or, after the push, link https://github.com/${rep}/blob/${br}/<path>. Never a path link, and never ask "where did you try to open it".
2. Commit and push go to branch ${br} — push only works there. Their computer sees it only after the merge into main (Create PR at the top of the diff view, then Merge on GitHub) or with \`claude --teleport\` there. Name the branch whenever you say where something is.
3. Network: only the environment's allowlist (the default, Trusted, lets package registries and GitHub through). A project address blocked (403 on Vercel, Supabase…)? Don't insist: ask them to open the link in their browser and send what shows up, or give the way to allow it — cloud icon with the environment name, above the message box → hover the environment → gear → Network access: Custom → Allowed domains, one per line, and tick "Also include default list". Something only their machine reaches (a plugin, a logged-in dashboard) → that test is theirs, there.
4. Here they have no terminal, file pane, attachments from their computer, plugins, /clear or Manual mode; nothing from their ~/.claude arrives (the lessons folder is .licoes/). Every command is YOURS. Every step of theirs says WHERE: "here in this chat", "in the browser", "on GitHub" or "on YOUR computer, in a local chat in folder X".
5. A new chat here = a new session from the sidebar, from a fresh GitHub clone: commit and push first, and the resume prompt says which repository and branch to pick. An idle session loses its machine, and whatever wasn't pushed is gone.`
    : `[gancho chat-parado] SESSÃO NA NUVEM (branch ${br}, repositório ${rep}). A pessoa enxerga menos aqui que no app do computador, e se perde. Na 1ª resposta, ANTES da tarefa, avise-a em até 4 linhas curtas o que aqui não funciona e o que fazer no lugar. E siga isto a sessão inteira:
1. Nome de arquivo na resposta NÃO abre (o arquivo está nesta máquina da nuvem). Para mostrar um arquivo: mande-o com a ferramenta de enviar arquivo, se você tiver uma; senão, cole o trecho que importa, ou, depois do push, o link https://github.com/${rep}/blob/${br}/<caminho>. Nunca link de caminho, e nunca pergunte "onde você tentou abrir".
2. Commit e push vão para o branch ${br} — o push só funciona nele. O computador dela só vê depois do merge no main (Create PR no topo da tela de diferenças, depois Merge no GitHub) ou com \`claude --teleport\` lá. Diga o branch sempre que falar de onde algo ficou.
3. Rede: só a lista permitida do ambiente (o padrão, Trusted, deixa passar pacotes e GitHub). Endereço do projeto bloqueado (403 na Vercel, no Supabase…)? Não insista: peça que ela abra o link no navegador e mande o que aparecer, ou dê o caminho de liberar — ícone de nuvem com o nome do ambiente, acima da caixa de mensagem → passe o mouse no ambiente → engrenagem → Network access: Custom → Allowed domains, um por linha, e marque "Also include default list". O que só a máquina dela alcança (plugin, painel logado) → o teste é dela, lá.
4. Aqui ela não tem terminal, painel de arquivo, anexo do computador, plugins, /clear nem modo Manual; nada do ~/.claude dela chega (a pasta de lições é o .licoes/). Todo comando é SEU. Todo passo dela diz ONDE: "aqui neste chat", "no navegador", "no GitHub" ou "no SEU computador, num chat local na pasta tal".
5. Chat novo aqui = sessão nova pela barra lateral, de um clone novo do GitHub: commit e push antes, e o prompt de retomada diz o repositório e o branch a escolher. Sessão parada perde a máquina, e o que não teve push some.`);
}

function emDia(e) {
  const base = acharPasta(e.cwd); if (!base) return;
  const casa = path.join(os.homedir(), '.claude'), hoje = new Date().toLocaleDateString('sv'), feito = [];
  const ler = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  const copiar = (de, para) => { const bak = para + '.bak-' + hoje; if (fs.existsSync(para) && !fs.existsSync(bak)) fs.copyFileSync(para, bak); fs.copyFileSync(de, para); };
  const dirG = path.join(base, 'modelos', 'ganchos');
  const arqs = [], par = (de, ...para) => arqs.push([de, path.join(casa, ...para), para.slice(1).join('/')]);
  for (const f of fs.readdirSync(dirG)) {
    if (f.endsWith('.js')) par(path.join(dirG, f), 'ganchos', f);
    else if (fs.statSync(path.join(dirG, f)).isDirectory() && fs.existsSync(path.join(casa, 'ganchos', f)))
      for (const g of fs.readdirSync(path.join(dirG, f))) if (/\.(m?js|json)$/.test(g) && g !== 'package-lock.json') par(path.join(dirG, f, g), 'ganchos', f, g);
  }

  for (const g of ['biblioteca.js', 'SKILL.md']) par(path.join(base, 'modelos', 'biblioteca', g), 'ganchos', 'biblioteca', g);
  try { for (const c of fs.readdirSync(path.join(base, 'modelos', 'comandos'))) par(path.join(base, 'modelos', 'comandos', c, 'SKILL.md'), 'skills', c, 'SKILL.md'); } catch {}
  for (const [de, para, nome] of arqs) {
    const a = ler(para);
    if (a === null || !fs.existsSync(de) || a === ler(de) || fs.statSync(de).mtimeMs <= fs.statSync(para).mtimeMs) continue;

    if (/\.m?js$/.test(de) && require('child_process').spawnSync(process.execPath, ['--check', de], { windowsHide: true }).status !== 0) { feito.push('!quebrado:' + nome); continue; }
    copiar(de, para); feito.push(nome);
  }
  const mestre = path.join(base, 'meu', 'CLAUDE-global.md'), local = path.join(casa, 'CLAUDE.md'), marca = path.join(casa, 'claude-global.conferido');
  const m = ler(mestre), l = ler(local);
  if (m !== null && m !== l) {
    const visto = ler(marca);
    const subir = l !== null && (visto === null ? fs.statSync(local).mtimeMs > fs.statSync(mestre).mtimeMs : l !== visto);
    if (visto !== null && subir && m !== visto) feito.push('!conflito');
    else if (subir) { copiar(local, mestre); feito.push('CLAUDE.md global → meu/CLAUDE-global.md'); }
    else { copiar(mestre, local); feito.push('meu/CLAUDE-global.md → CLAUDE.md global (vale do próximo chat; leia-o agora)'); }
  }
  const agora = ler(mestre); if (agora !== null && agora === ler(local)) fs.writeFileSync(marca, agora);
  if (!feito.length) return;
  const conflito = feito.includes('!conflito'), lista = feito.filter(x => x[0] !== '!'), quebrado = feito.filter(x => x.startsWith('!quebrado:')).map(x => x.slice(10)), gancho = lista.some(x => /\.m?js$/.test(x));
  const npm = lista.filter(x => x.endsWith('/package.json')).map(x => path.join(casa, 'ganchos', path.dirname(x)));
  console.log(LINGUA === 'en'
    ? (lista.length ? `[chat-parado hook] Brought this computer in step with the lessons folder: ${lista.join(', ')} (backup .bak-${hoje}${gancho ? '; a hook applies from the next message' : ''}). Mention it in one line in the final summary.` : '[chat-parado hook]') + (npm.length ? ` The package.json changed: run npm install in ${npm.join(', ')} and say so in one line.` : '') + (conflito ? ' ⚠️ ~/.claude/CLAUDE.md and meu/CLAUDE-global.md BOTH changed since the last check: merge the two by hand, save the result in both files, and say so in one line.' : '') + (quebrado.length ? ` ⚠️ Not copied, the lessons-folder copy has a syntax error (node --check): ${quebrado.join(', ')} — the old one keeps running; fix it in modelos/ and say so in one line.` : '')
    : (lista.length ? `[gancho chat-parado] Pus esta máquina em dia com a pasta de lições: ${lista.join(', ')} (backup .bak-${hoje}${gancho ? '; gancho vale da próxima mensagem' : ''}). Diga em uma linha no resumo final.` : '[gancho chat-parado]') + (npm.length ? ` O package.json mudou: rode npm install em ${npm.join(', ')} e diga em uma linha.` : '') + (conflito ? ' ⚠️ O ~/.claude/CLAUDE.md e o meu/CLAUDE-global.md MUDARAM OS DOIS desde a última conferência: junte os dois à mão, grave o resultado nos dois arquivos e diga em uma linha.' : '') + (quebrado.length ? ` ⚠️ Não copiei, a cópia da pasta de lições tem erro de sintaxe (node --check): ${quebrado.join(', ')} — segue a antiga; conserte em modelos/ e diga em uma linha.` : ''));
}

function estado(e) {
  const arq = path.join(e.cwd || process.cwd(), 'PROGRESSO.md');
  const L = fs.readFileSync(arq, 'utf8').replace(/\r/g, '').split('\n');
  const i = L.findIndex(l => /^## .*(onde (estamos|paramos)|where we (are|left off))/i.test(l)); if (i < 0) return;
  let fim = L.findIndex((l, k) => k > i && /^## /.test(l)); if (fim < 0) fim = L.length;
  const sub = L.slice(i + 1, fim).map((l, k) => /^### /.test(l) ? k + i + 1 : -1).filter(k => k >= 0);
  if (sub.length > 1) fim = sub[1];
  fim = Math.min(fim, i + 60);
  const txt = L.slice(i, fim).join('\n').trim().slice(0, 6000);
  if (txt.includes('[PREENCHER')) return;
  console.log(LINGUA === 'en'
    ? `[chat-parado hook] "Where we are" from PROGRESSO.md (lines ${i + 1}–${fim}), already here — don't reread it; of the rest, open only the section the task needs:\n${txt}`
    : `[gancho chat-parado] O "onde paramos" do PROGRESSO.md (linhas ${i + 1}–${fim}), já aqui — não releia este trecho; do resto, abra só a seção que a tarefa pedir:\n${txt}`);
}

function retrato(e) {
  const cwd = e.cwd || process.cwd(), cp = require('child_process');
  const git = a => cp.execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500, maxBuffer: 32 << 20 });
  if (path.resolve(git(['rev-parse', '--show-toplevel']).trim()) !== path.resolve(cwd)) return;
  const arqs = git(['ls-files']).split('\n').filter(Boolean); if (!arqs.length) return;
  const conta = (chave, n) => Object.entries(arqs.reduce((m, f) => (m[chave(f)] = (m[chave(f)] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, n);
  const L = [`${arqs.length} arquivos no Git: ${conta(f => f.includes('/') ? f.split('/')[0] + '/' : '.', 10).map(([d, n]) => `${d} ${n}`).join(', ')}. Tipos: ${conta(f => path.extname(f) || '(sem)', 6).map(([x]) => x).join(' ')}.`];
  try { const s = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts || {}; if (Object.keys(s).length) L.push('npm: ' + Object.entries(s).map(([k, v]) => `${k}=\`${v}\``).join(', ').slice(0, 600)); } catch {}
  L.push('Últimos commits: ' + git(['log', '--oneline', '-3']).trim().split('\n').join(' | '));
  console.log((LINGUA === 'en' ? '[chat-parado hook] Project at a glance — use it before exploring:\n' : '[gancho chat-parado] O projeto num relance — use antes de explorar:\n') + L.join('\n'));
}

function novidades() {
  const arq = path.join(process.env.DESTILAR_ESTADO || path.join(os.homedir(), '.claude', 'ganchos', 'destilar'), 'novidades.json');
  const lista = JSON.parse(fs.readFileSync(arq, 'utf8')); if (!lista.length) return;
  fs.writeFileSync(arq, '[]');
  console.log((LINGUA === 'en' ? '[chat-parado hook] Done on its own since the last chat — tell the person in the final summary, one line each:\n- '
    : '[gancho chat-parado] Feito sozinho desde o último chat — diga à pessoa no resumo final, uma linha cada:\n- ') + lista.join('\n- '));
}

const SO = path.join(__dirname, 'so-o-que-usa.js');
function soOQueUsa(e) {
  const base = acharPasta(e.cwd); if (!base || !fs.existsSync(SO)) return;
  require('child_process').spawn(process.execPath, [SO, '--rodar', base], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

const LIMITES = process.env.LIMITES_ARQ || path.join(os.homedir(), '.claude', 'ganchos', 'limites.json');
function limite(e) {
  const l = JSON.parse(fs.readFileSync(LIMITES, 'utf8')), agora = Date.now() / 1000;
  const janelas = Object.entries(l).filter(([n, j]) => n !== 'gravado' && j && !(j.volta && j.volta < agora));
  if (!janelas.length) return;
  const [nome, j] = janelas.sort((a, b) => b[1].pct - a[1].pct)[0];
  const nivel = j.pct >= 95 ? 95 : j.pct >= 80 ? 80 : 0; if (!nivel) return;
  const marca = path.join(os.tmpdir(), `chat-parado-limite${nivel}-${nome}-${Math.round((j.volta || 0) / 3600)}`.replace(/[^\w-]/g, ''));
  if (fs.existsSync(marca)) return; fs.writeFileSync(marca, '');
  const en = LINGUA === 'en', jan = { five_hour: en ? '5-hour' : 'de 5 horas', seven_day: en ? 'weekly' : 'da semana', spend_limit: en ? 'spend' : 'de gasto' }[nome] || nome;
  const volta = j.volta ? new Date(j.volta * 1000).toLocaleString(en ? 'en-US' : 'pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  console.log(en
    ? `[chat-parado hook] The ${jan} plan limit is at ${Math.round(j.pct)}%${volta ? ` (resets ${volta})` : ''}. ` + (nivel === 95
      ? 'Before anything else, write in the project state file (PROGRESSO.md or equivalent) where the work stopped and the next step. Then tell the person, in one line, that the limit is about to run out and when it comes back.'
      : 'When this request is done, update the state file. Do NOT mention the limit to the person: the status bar and /panel already show it.')
    : `[gancho chat-parado] O limite ${jan} do plano está em ${Math.round(j.pct)}%${volta ? ` (volta ${volta})` : ''}. ` + (nivel === 95
      ? 'Antes de qualquer outra coisa, grave no arquivo de estado do projeto (o PROGRESSO.md, se houver) onde parou e o próximo passo. Depois, diga à pessoa numa linha que o limite está acabando e quando ele volta.'
      : 'Quando este pedido terminar, atualize o arquivo de estado. NÃO fale do limite à pessoa: a barra e o /panel já o mostram.'));
}

function chatNovo(e, prompt) {
  try { estado(e); } catch {}
  try { retrato(e); } catch {}
  try { novidades(); } catch {}
  let chegou = false;
  if (process.env.CLAUDE_CODE_REMOTE === 'true') { try { nuvem(e); } catch {} }
  else { try { maquina(); } catch {} try { emDia(e); } catch {} try { chegou = sincronizar(e); } catch {} try { soOQueUsa(e); } catch {} }
  try { baseMudou(e); } catch {}
  if (prompt.length <= 60 && CONTINUE.test(prompt)) try { ondeParou(e, chegou); } catch {}
}

function principal(e) {
  const prompt = String(e.prompt || '').trim();
  if (prompt.startsWith('/')) return;
  try { if (fs.existsSync(SO)) { const d = require(SO).devolver(prompt, e.cwd); if (d) console.log(d); } } catch {}
  try { limite(e); } catch {}
  if (!e.transcript_path || !fs.existsSync(e.transcript_path)) return chatNovo(e, prompt);
  const r = ultimaResposta(e.transcript_path);
  if (!r) return chatNovo(e, prompt);

  if (r.limite !== undefined && (!r.limite || Date.now() < r.limite + 60 * 60000)) return;
  const parado = (Date.now() - r.quando) / 60000;
  if (r.conversa < CONVERSA) return;
  if (parado < PARADO_MIN) return console.log(grande(Math.round(r.contexto / 1000), Math.round(r.base / 1000)));
  const marca = path.join(os.tmpdir(), 'chat-parado-' + String(e.session_id || 'sessao').replace(/[^\w-]/g, ''));
  try {
    if (Date.now() - fs.statSync(marca).mtimeMs < INSISTIU_MIN * 60000) { fs.unlinkSync(marca); return; }
  } catch {}
  fs.writeFileSync(marca, '');
  process.stderr.write(aviso(Math.round(r.contexto / 1000), parado, prompt));
  process.exit(2);
}

if (process.argv[2] === '--teste') {
  const r = ultimaResposta(process.argv[3]);
  console.log(r ? `última resposta: ${r.quando.toISOString()} · contexto ${Math.round(r.contexto / 1000)} mil (parte fixa ${Math.round(r.base / 1000)}, conversa ${Math.round(r.conversa / 1000)}) · parado ${Math.round((Date.now() - r.quando) / 60000)} min · parou no limite: ${r.limite !== undefined ? new Date(r.limite).toISOString() : 'não'} · barraria: ${(Date.now() - r.quando) / 60000 >= PARADO_MIN && r.conversa >= CONVERSA} · sugeriria chat novo: ${(Date.now() - r.quando) / 60000 < PARADO_MIN && r.conversa >= CONVERSA}` : 'nenhuma resposta com uso no fim do arquivo');
} else {
  let entrada = '';
  process.stdin.on('data', d => entrada += d).on('end', () => {
    try { principal(JSON.parse(entrada)); } catch { process.exit(0); }
  });
}
