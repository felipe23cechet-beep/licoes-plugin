#!/usr/bin/env node

'use strict';
const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path'),
  os = process.getBuiltinModule('os'), cp = process.getBuiltinModule('child_process');

const ESTADO = () => process.env.ROTINAS_ESTADO || path.join(os.homedir(), '.claude', 'ganchos', 'rotinas');
const NOVIDADES = () => path.join(process.env.DESTILAR_ESTADO || path.join(os.homedir(), '.claude', 'ganchos', 'destilar'), 'novidades.json');
const CLAUDE = () => process.env.ROTINAS_CLAUDE || 'claude';
const SO_LER = 'Read,Grep,Glob,WebSearch,WebFetch';
const TETO_PADRAO = 0.25;
const REGRAS = meta => `\n\nVocê está rodando SOZINHO, como rotina agendada. Só pode LER (arquivos e web); nunca tente mudar arquivo nem rodar
comando. ${meta ? `Esta rotina trabalha por um objetivo: ${meta}\nTermine com uma linha começando com "PROGRESSO:" dizendo onde o objetivo está agora.\n` : ''}O que pedir
decisão ou ação da pessoa, NÃO faça: escreva uma linha por item começando com "PRECISA DE VOCÊ:". Responda em menos de 30 linhas.`;

const SEGREDO = new RegExp([
  String.raw`\bsk[_-](live_|test_|ant-|proj-)?[A-Za-z0-9_-]{16,}`, String.raw`\b(pk|rk)_(live|test)_[A-Za-z0-9]{10,}`,
  String.raw`\bwhsec_[A-Za-z0-9]{20,}`, String.raw`\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}`, String.raw`\bAIza[0-9A-Za-z_-]{30,}`,
  String.raw`\bgh[pousr]_[A-Za-z0-9]{30,}`, String.raw`\bgithub_pat_[A-Za-z0-9_]{40,}`, String.raw`\bAKIA[0-9A-Z]{16}\b`,
  String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`, String.raw`\b\d{8,}:[A-Za-z0-9_-]{30,}`, String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`,
  String.raw`eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}`,
  String.raw`(key|token|secret|senha|password|passwd|api)[\w-]*["']?\s*[:=]\s*["']?[A-Za-z0-9_\-]{24,}`,
].join('|'), 'gi');

const lerJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const arqRotinas = () => path.join(ESTADO(), 'rotinas.json');
const gravar = l => { fs.mkdirSync(ESTADO(), { recursive: true }); const tmp = arqRotinas() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(l, null, 1)); fs.renameSync(tmp, arqRotinas()); };
const registrar = m => { try { fs.mkdirSync(ESTADO(), { recursive: true }); fs.appendFileSync(path.join(ESTADO(), 'registro.log'), `${new Date().toISOString()} ${m}\n`); } catch {} };
const nomeLimpo = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
function segundos(cada) {
  const m = String(cada).trim().match(/^(\d+)([hd])$/);
  if (!m || +m[1] < 1) throw new Error(`"cada" é tipo 12h, 1d ou 7d — veio "${cada}"`);
  return +m[1] * (m[2] === 'h' ? 3600 : 86400);
}
function novidade(t) {
  try { const l = lerJSON(NOVIDADES(), []); l.push(t); fs.mkdirSync(path.dirname(NOVIDADES()), { recursive: true }); fs.writeFileSync(NOVIDADES(), JSON.stringify(l.slice(-10))); } catch {}
}

function rodar(r, todas) {
  r.ultima = Date.now(); gravar(todas);
  const flags = `-p --model haiku --output-format json --tools "${SO_LER}" --allowedTools "${SO_LER}" --max-budget-usd ${Number(r.teto) || TETO_PADRAO} `
    + '--no-session-persistence --strict-mcp-config --disable-slash-commands --setting-sources project';
  const cwd = r.projeto && fs.existsSync(r.projeto) ? r.projeto : os.homedir();
  const p = cp.spawnSync(`${CLAUDE()} ${flags}`, { input: r.pedido + REGRAS(r.meta), shell: true, cwd, encoding: 'utf8', windowsHide: true,
    timeout: 900000, env: { ...process.env, ROTINAS_FILHO: '1', DESTILAR_FILHO: '1' } });
  let o = {}; try { o = JSON.parse(p.stdout); } catch {}
  const custo = Number(o.total_cost_usd) || 0;
  const texto = (o.result && p.status === 0 ? String(o.result) : `(sem resposta: ${o.subtype || o.result || (p.stderr || '').slice(0, 200) || 'erro'})`).trim().replace(SEGREDO, '[segredo]');
  const agora = new Date(), quando = `${agora.toLocaleDateString('sv')} ${agora.toTimeString().slice(0, 5)}`;
  const nota = path.join(ESTADO(), `${r.nome}.md`);
  fs.appendFileSync(nota, `${fs.existsSync(nota) ? '' : `# Rotina ${r.nome} — a cada ${r.cada}\n\n> ${r.pedido.slice(0, 200)}\n`}\n## ${quando} (US$ ${custo.toFixed(3)})\n\n${texto}\n`);
  registrar(`rotina ${r.nome}: US$ ${custo.toFixed(4)}${p.status === 0 ? '' : ' (falhou)'}`);
  const pede = [...texto.matchAll(/^\W*PRECISA DE VOC[ÊE]:[*_\s]*(.+)$/gim)].map(m => m[1].trim());
  if (pede.length) {
    const pv = path.join(ESTADO(), 'PRECISA-DE-VOCE.md');
    fs.appendFileSync(pv, `${fs.existsSync(pv) ? '' : '# O que as rotinas deixaram para você decidir\n\n'}${pede.map(x => `- [ ] ${agora.toLocaleDateString('sv')} ${r.nome}: ${x}\n`).join('')}`);
    novidade(`a rotina "${r.nome}" precisa de você: ${pede.join('; ')} (${pv})`);
  }
  return texto;
}

function vencidas() {
  const todas = lerJSON(arqRotinas(), []);
  for (const r of todas) try { if (Date.now() - (r.ultima || 0) >= segundos(r.cada) * 1000) rodar(r, todas); } catch (e) { registrar(`ERRO ${r.nome}: ${e.message}`); }
}

function nova(a) {
  const opc = n => { const i = a.indexOf(n); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
  const projeto = opc('--projeto'), teto = opc('--teto'), meta = opc('--meta'), [nome, cada, pedido] = a, n = nomeLimpo(nome);
  if (!n || !pedido) throw new Error('uso: --nova <nome> <cada: 12h|1d|7d> "<pedido>" [--projeto <pasta>] [--teto 0.25] [--meta "<objetivo>"]');
  segundos(cada);
  if (projeto && !fs.existsSync(projeto)) throw new Error(`não achei a pasta do projeto: ${projeto}`);
  if (teto && !(Number(teto) > 0 && Number(teto) <= 1)) throw new Error(`teto em dólar, entre 0 e 1 por rodada — veio "${teto}"`);
  const todas = lerJSON(arqRotinas(), []).filter(r => r.nome !== n);
  todas.push({ nome: n, cada, pedido, ...(projeto ? { projeto: path.resolve(projeto) } : {}), ...(teto ? { teto: Number(teto) } : {}), ...(meta ? { meta } : {}) });
  gravar(todas);
  console.log(`Rotina "${n}" gravada: a cada ${cada}, até US$ ${Number(teto) || TETO_PADRAO} por rodada, só lendo. A 1ª roda no fim do próximo chat.`);
}

function listar() {
  const todas = lerJSON(arqRotinas(), []);
  if (!todas.length) return console.log('Nenhuma rotina. Exemplo: node rotinas.js --nova dependencias 7d "veja se as dependências do package.json têm versão nova" --projeto .');
  for (const r of todas) console.log(`- ${r.nome}: a cada ${r.cada}, até US$ ${r.teto || TETO_PADRAO}, última ${r.ultima ? new Date(r.ultima).toLocaleString('pt-BR') : 'nunca'}`
    + `${r.projeto ? `, projeto ${path.basename(r.projeto)}` : ''}${r.meta ? `, objetivo: ${r.meta}` : ''}\n  ${r.pedido.slice(0, 150)}\n  saída: ${path.join(ESTADO(), r.nome + '.md')}`);
}

function teste() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rotinas-'));
  const falso = path.join(tmp, 'claude-falso.js'), log = path.join(tmp, 'log');
  fs.writeFileSync(falso, `const fs=require('fs');let i='';process.stdin.on('data',c=>i+=c).on('end',()=>{fs.appendFileSync(process.env.FALSO_LOG,JSON.stringify({args:process.argv.slice(2),pedido:i,cwd:process.cwd(),filho:process.env.ROTINAS_FILHO})+'\\n');
    if(process.env.FALSO_FALHA){process.stdout.write(JSON.stringify({type:'result',subtype:'error_max_budget_usd'}));process.exitCode=1;return;}
    process.stdout.write(JSON.stringify({type:'result',result:process.env.FALSO_RESULT,total_cost_usd:0.012}));});`);
  const env = { ...process.env, ROTINAS_ESTADO: path.join(tmp, 'estado'), DESTILAR_ESTADO: path.join(tmp, 'destilar'), FALSO_LOG: log,
    ROTINAS_CLAUDE: `"${process.execPath}" "${falso}"`, FALSO_RESULT: 'Nada novo.' };
  const filho = (a, extra = {}) => cp.spawnSync(process.execPath, [__filename, ...a], { encoding: 'utf8', env: { ...env, ...extra } });
  const chamadas = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  const ler = f => { try { return fs.readFileSync(path.join(tmp, f), 'utf8'); } catch { return ''; } };
  let falhas = 0; const confere = (ok, nome) => { console.log(`${ok ? 'ok  ' : 'FALHOU'} ${nome}`); if (!ok) falhas++; };

  confere(/Nenhuma rotina/.test(filho(['--listar']).stdout), 'sem rotina: --listar mostra o exemplo');
  confere(filho(['--vencidas']).status === 0 && !chamadas().length, 'sem rotina: não chama o claude');
  confere(/12h, 1d ou 7d/.test(filho(['--nova', 'x', 'toda semana', 'p']).stderr), '"cada" fora do formato é recusado');
  confere(/não achei a pasta/.test(filho(['--nova', 'x', '7d', 'p', '--projeto', path.join(tmp, 'nao-existe')]).stderr), 'projeto que não existe é recusado');
  fs.mkdirSync(path.join(tmp, 'proj'));
  filho(['--nova', 'Dependências', '7d', 'veja se as dependências têm versão nova', '--projeto', path.join(tmp, 'proj'), '--teto', '0.05']);
  filho(['--nova', 'noticias', '1d', 'resuma as novidades do Claude Code', '--meta', 'saber quando sair a versão 3']);
  confere(/dependencias: a cada 7d, até US\$ 0.05, última nunca, projeto proj/.test(filho(['--listar']).stdout), 'grava com o nome limpo, o teto e o projeto');

  filho(['--vencidas'], { FALSO_RESULT: '**PRECISA DE VOCÊ:** atualizar o express 4 → 5 (quebra a API)\nO resto está em dia. Chave sk_live_' + 'ABCDEFGHIJKLMNOPQRSTUVWX vista no log.' });
  const c = chamadas(), dep = c.find(x => /dependências/.test(x.pedido)) || { args: [] }, a = dep.args.join(' ');
  confere(c.length === 2, 'as duas nunca rodaram: as duas vencidas rodam');
  confere(/--tools Read,Grep,Glob,WebSearch,WebFetch/.test(a) && /--allowedTools Read,Grep,Glob,WebSearch,WebFetch/.test(a) && /--max-budget-usd 0\.05/.test(a) && /--model haiku/.test(a),
    'o claude roda só lendo (--tools e --allowedTools), no Haiku, com o teto da rotina');
  confere(path.resolve(dep.cwd) === path.resolve(path.join(tmp, 'proj')) && dep.filho === '1' && /PRECISA DE VOCÊ/.test(dep.pedido), 'roda na pasta do projeto, marcado como filho, com as regras de só ler');
  confere(/PROGRESSO:/.test((c.find(x => /novidades/.test(x.pedido)) || {}).pedido || ''), 'a rotina com objetivo pede a linha PROGRESSO');
  const nota = ler('estado/dependencias.md');
  confere(/^# Rotina dependencias/.test(nota) && /## \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(US\$ 0\.012\)/.test(nota) && nota.includes('[segredo]') && !nota.includes('sk_live_'),
    'a resposta vai para <nome>.md, com data e custo, e o segredo mascarado');
  confere(/express 4 → 5/.test(ler('estado/PRECISA-DE-VOCE.md')) && JSON.parse(ler('destilar/novidades.json') || '[]').some(t => /rotina "dependencias" precisa de você: atualizar o express/.test(t)),
    '"PRECISA DE VOCÊ" vira linha no PRECISA-DE-VOCE.md e novidade do próximo chat');

  fs.unlinkSync(log); filho(['--vencidas']);
  confere(!chamadas().length, 'já rodaram: não rodam de novo antes do "cada"');
  filho(['--agora', 'noticias'], { FALSO_FALHA: '1' });
  confere(chamadas().length === 1 && /sem resposta: error_max_budget_usd/.test(ler('estado/noticias.md')), '--agora roda já; o teto estourado fica anotado, sem quebrar');

  fs.unlinkSync(log);
  const lista = JSON.parse(ler('estado/rotinas.json')); lista[0].ultima = 0; fs.writeFileSync(path.join(tmp, 'estado', 'rotinas.json'), JSON.stringify(lista));
  cp.spawnSync(process.execPath, [__filename], { input: '{"hook_event_name":"SessionEnd"}', encoding: 'utf8', env: { ...env, ROTINAS_FILHO: '1' } });
  const antes = chamadas().length;
  cp.spawnSync(process.execPath, [__filename], { input: '{"hook_event_name":"SessionEnd"}', encoding: 'utf8', env });
  const ate = Date.now() + 15000; while (!chamadas().length && Date.now() < ate) cp.spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},300)']);
  confere(antes === 0 && chamadas().length === 1, 'o gancho roda a vencida em segundo plano; dentro de uma rotina, não');

  confere(/removida/.test(filho(['--tirar', 'noticias']).stdout) && !/noticias/.test(filho(['--listar']).stdout), '--tirar remove');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.'); process.exitCode = falhas ? 1 : 0;
}

const a = process.argv.slice(2);
const erro = f => { try { f(); } catch (e) { console.error(e.message); process.exitCode = 1; } };
if (a[0] === '--teste') teste();
else if (a[0] === '--vencidas') vencidas();
else if (a[0] === '--nova') erro(() => nova(a.slice(1)));
else if (a[0] === '--listar') listar();
else if (a[0] === '--tirar') { const t = lerJSON(arqRotinas(), []); gravar(t.filter(r => r.nome !== a[1])); console.log(t.some(r => r.nome === a[1]) ? `Rotina "${a[1]}" removida.` : `Não há rotina "${a[1]}".`); }
else if (a[0] === '--agora') { const t = lerJSON(arqRotinas(), []), r = t.find(x => x.nome === a[1]); console.log(r ? rodar(r, t) : `Não há rotina "${a[1]}".`); }
else if (!process.env.ROTINAS_FILHO) {

  let i = ''; process.stdin.on('data', c => (i += c)).on('end', () => {
    const t = lerJSON(arqRotinas(), []);
    const vencida = t.some(r => { try { return Date.now() - (r.ultima || 0) >= segundos(r.cada) * 1000; } catch { return false; } });
    if (vencida) cp.spawn(process.execPath, [__filename, '--vencidas'], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env }).unref();
  });
}
