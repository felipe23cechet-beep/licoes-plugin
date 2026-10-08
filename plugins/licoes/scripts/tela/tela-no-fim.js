#!/usr/bin/env node
// Conferência de TELA no fim do turno — gancho Stop do Claude Code (base LIÇÕES GERAIS, FERRAMENTAS §16).
//
// O turno mexeu em arquivo de tela (.html, .css, .tsx, .jsx, .vue, .svelte, .astro)? Antes de o agente encerrar, roda o
// confere-tela.mjs (contraste WCAG AA a 1440 e 375 px, e vazamento lateral a 375 px) no .html tocado ou nas páginas de
// localhost citadas no chat que ainda respondem. Achou problema → devolve o turno ao agente UMA vez, com a lista; o
// `stop_hook_active` impede o laço. Nada de tela neste turno, ou nada para abrir → não faz nada e não custa contexto.
// Por quê: o checklist de tela (`meu/` nº 58) é regra escrita, e regra escrita o agente pula; o gancho não depende de ser
// lido. Mede o que dá para medir sem olho; o resto do checklist continua com o agente, na tela logada.
// Ideia: check.js do vijcoelho/project-helena (MIT, commit c356888, CREDITOS.md). Mudanças daqui: olha só o TURNO atual
// (o original relia o chat inteiro e rodava o navegador a cada fim de turno depois do primeiro arquivo de tela) e só o
// fim do registro (chat longo passa de 50 MB); a ordem de consertar fica no que o turno mexeu.
// Página atrás de login: o gancho vê a tela de login, não a logada — essa continua sendo a conferência do agente.
//
// Instalar: copie a pasta tela/ para ~/.claude/ganchos/tela, rode `npm install` DENTRO dela (local, não -g), e ligue em
// ~/.claude/settings.json → hooks.Stop, command "node <caminho>/tela-no-fim.js", "timeout": 180.
// Testar sem ligar nada:  node tela-no-fim.js --teste

'use strict';
const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path'),
  os = process.getBuiltinModule('os'), cp = process.getBuiltinModule('child_process');
const TELA = /\.(html?|css|scss|sass|less|tsx|jsx|vue|svelte|astro)$/i;
const MAX_URLS = 3;

function fimDoRegistro(arq) {                                          // só o fim: o registro de um chat longo passa de 50 MB
  const fd = fs.openSync(arq, 'r'), tam = fs.fstatSync(fd).size, n = Math.min(tam, 4 << 20);
  const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, tam - n); fs.closeSync(fd);
  return buf.toString('utf8');
}

function tocadosNoTurno(texto, cwd) {
  const linhas = texto.split('\n'), tocados = new Set();
  for (let i = linhas.length - 1; i >= 0; i--) {
    let o; try { o = JSON.parse(linhas[i]); } catch { continue; }
    const c = o.message && o.message.content;
    if (o.type === 'user' && !o.isSidechain && (typeof c === 'string' || (Array.isArray(c) && c.some(b => b.type === 'text')))) break;  // começo do turno
    if (o.type !== 'assistant' || !Array.isArray(c)) continue;
    for (const b of c) {
      const f = b.type === 'tool_use' && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name) && b.input && b.input.file_path;
      if (f && TELA.test(f)) tocados.add(path.resolve(cwd, f));
    }
  }
  return tocados;
}

async function alvos(tocados, texto) {
  const lista = new Set();
  for (const f of tocados) {
    if (/\.html?$/i.test(f) && fs.existsSync(f)) lista.add(f);
    else if (/\.(css|scss|sass|less)$/i.test(f) && fs.existsSync(path.dirname(f)))
      for (const h of fs.readdirSync(path.dirname(f))) if (/\.html?$/i.test(h)) lista.add(path.join(path.dirname(f), h));
  }
  if (![...tocados].some(f => !/\.html?$/i.test(f))) return lista;      // só .html: o arquivo basta
  const urls = [...new Set((texto.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}(?:\/[\w\-./]*)?/g) || [])
    .map(u => u.replace(/[.)\]\\]+$/, '')).reverse())];
  let n = 0;
  for (const u of urls) {
    if (n >= MAX_URLS) break;
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(3000) });
      if (r.ok && (r.headers.get('content-type') || '').includes('html')) { lista.add(u); n++; }
    } catch {}
  }
  return lista;
}

function conferir(alvo) {
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'confere-tela.mjs'), alvo], { encoding: 'utf8', timeout: 90000, windowsHide: true });
  if (r.status !== 0 && r.status !== 1 && process.argv[2] === '--teste') console.log('     [não conferiu] ' + (r.stderr || (r.error && r.error.message) || r.status));
  return r.status === 1 ? `${alvo}\n${r.stdout.trim()}` : null;
}

async function principal(e) {
  if (e.stop_hook_active || !e.transcript_path) return null;            // já devolveu uma vez: sem laço
  const texto = fimDoRegistro(e.transcript_path), tocados = tocadosNoTurno(texto, e.cwd || process.cwd());
  if (!tocados.size) return null;
  const problemas = [...await alvos(tocados, texto)].map(conferir).filter(Boolean);
  if (!problemas.length) return null;
  return { decision: 'block', reason: 'tela-no-fim: a tela que este turno mexeu tem problema que se MEDE (checklist de tela, `meu/` nº 58 da ' +
    'base de lições). Conserte o que for dos arquivos que você tocou — no contraste, mude só a luminosidade da cor e mantenha a paleta; ' +
    'o que for de fora do pedido, diga à pessoa numa linha em vez de mexer. Depois, uma linha no resumo dizendo o que consertou.\n\n' + problemas.join('\n\n') };
}

async function teste() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-teste-'));
  const ruim = path.join(pasta, 'ruim.html'), boa = path.join(pasta, 'boa.html');
  fs.writeFileSync(ruim, '<html><body style="background:#fff"><p style="color:#bbb">texto claro demais</p><div style="width:600px">largo</div></body></html>');
  fs.writeFileSync(boa, '<html><head><meta name="viewport" content="width=device-width"></head><body style="background:#fff"><p style="color:#222">texto legível</p></body></html>');
  let nReg = 0;
  const reg = (arq, extra = []) => {
    const t = path.join(pasta, 'chat' + (++nReg) + '.jsonl');
    fs.writeFileSync(t, [{ type: 'user', message: { content: 'mexa na tela' } },
      ...extra, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: arq } }] } }].map(o => JSON.stringify(o)).join('\n'));
    return t;
  };
  const casos = [
    ['html com texto claro e vazamento devolve o turno', { transcript_path: reg(ruim), cwd: pasta }, true],
    ['html legível passa', { transcript_path: reg(boa), cwd: pasta }, false],
    ['segunda volta (stop_hook_active) passa', { transcript_path: reg(ruim), cwd: pasta, stop_hook_active: true }, false],
    ['tela tocada só no turno ANTERIOR passa', { transcript_path: (() => { const t = reg(ruim); fs.appendFileSync(t, '\n' + JSON.stringify({ type: 'user', message: { content: 'outra coisa' } })); return t; })(), cwd: pasta }, false],
  ];
  let erros = 0;
  for (const [nome, e, esperado] of casos) {
    const r = await principal(e), barrou = !!r;
    if (barrou !== esperado) erros++;
    console.log(barrou === esperado ? 'ok  ' : 'ERRO', nome, barrou ? '\n     ' + r.reason.split('\n\n')[1].replace(/\n/g, '\n     ') : '');
  }
  fs.rmSync(pasta, { recursive: true, force: true });
  console.log(erros ? `${erros} ERRO(S) de ${casos.length}` : `todos os ${casos.length} casos certos`);
  process.exitCode = erros ? 1 : 0;
}

if (process.argv[2] === '--teste') teste();
else {
  let entrada = '';
  process.stdin.on('data', d => (entrada += d)).on('end', async () => {
    try { const r = await principal(JSON.parse(entrada)); if (r) console.log(JSON.stringify(r)); } catch {}   // falhou: deixa encerrar
  });
}
