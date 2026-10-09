#!/usr/bin/env node

const fs = require('fs'), path = require('path'), os = require('os');

const CASA = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const ESTADO = () => process.env.SO_O_QUE_USA_ESTADO || path.join(CASA(), 'ganchos', 'so-o-que-usa.json');
const NOVIDADES = () => path.join(process.env.DESTILAR_ESTADO || path.join(CASA(), 'ganchos', 'destilar'), 'novidades.json');
const DIAS = 60, MIN_CHATS = 3, NOVA_DIAS = 14;
const FICAM = ['auditoria-seguranca', 'critico-cego', 'handoff', 'auditar-skill'];
const CONHECIDAS = {
  pdf: 'pdf', docx: 'docx word documento', xlsx: 'xlsx excel planilha planilhas', pptx: 'pptx powerpoint slides apresentacao',
  'deep-research': 'deep-research', 'computer-use': 'computer-use', 'built-in-browser': 'navegador browser', 'chrome-browser': 'chrome',
};
const FERRAMENTA = [['mcp__claude-in-chrome__', 'chrome-browser'], ['mcp__Claude_Browser__', 'built-in-browser'], ['mcp__computer-use__', 'computer-use']];

const ler = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const gravar = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const chave = p => path.resolve(p).toLowerCase();
const curto = n => String(n).split(':').pop();
const dobrar = t => String(t).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

function usoPorProjeto() {
  const dir = path.join(CASA(), 'projects'), desde = Date.now() - DIAS * 864e5, tmp = chave(os.tmpdir()), out = {};
  for (const p of fs.readdirSync(dir)) {
    let arqs = []; try { arqs = fs.readdirSync(path.join(dir, p)).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of arqs) {
      const arq = path.join(dir, p, f);
      if (fs.statSync(arq).mtimeMs < desde) continue;
      let cwd = null; const usou = new Set();
      for (const l of fs.readFileSync(arq, 'utf8').split('\n')) {
        if (!cwd) { const m = l.match(/"cwd":"((?:[^"\\]|\\.)*)"/); if (m) cwd = JSON.parse('"' + m[1] + '"'); }
        for (const m of l.matchAll(/mcp__plugin_([a-z0-9-]+?)_/g)) usou.add('plugin:' + m[1]);
        for (const [t, n] of FERRAMENTA) if (l.includes(t)) usou.add(n);
        for (const m of l.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) usou.add(curto(m[1])), usou.add('plugin:' + m[1].split(':')[0]);
        if (l.includes('"Skill"') || l.includes('"Agent"')) try {
          for (const b of (JSON.parse(l).message || {}).content || []) {
            const n = b && b.type === 'tool_use' && (b.input || {})[b.name === 'Skill' ? 'skill' : 'subagent_type'];
            if (n) { usou.add(curto(n)); if (n.includes(':')) usou.add('plugin:' + n.split(':')[0]); }
          }
        } catch {}
      }
      if (!cwd || chave(cwd).startsWith(tmp)) continue;
      const k = chave(cwd), e = out[k] || (out[k] = { cwd, chats: 0, usou: new Set() });
      e.chats++; for (const u of usou) e.usou.add(u);
    }
  }
  return out;
}

function candidatos(pasta) {
  const c = [], velha = f => { try { return Date.now() - fs.statSync(f).mtimeMs > NOVA_DIAS * 864e5; } catch { return false; } };
  const sinc = path.join(CASA(), 'skills', 'synced');
  try { for (const d of fs.readdirSync(sinc)) for (const s of ler(path.join(sinc, d, 'manifest.json'), {}).skills || [])
    c.push({ tipo: 'skill', id: 'anthropic-skills:' + s.name, nome: s.name, valor: 'off', desc: s.description || '' }); } catch {}
  for (const raiz of [path.join(CASA(), 'skills'), path.join(pasta, '.claude', 'skills')])
    try { for (const d of fs.readdirSync(raiz)) if (d !== 'synced' && velha(path.join(raiz, d, 'SKILL.md')))
      c.push({ tipo: 'skill', id: d, nome: d, valor: 'name-only', desc: descricao(path.join(raiz, d, 'SKILL.md')) }); } catch {}
  const inst = (ler(path.join(CASA(), 'plugins', 'installed_plugins.json'), {}).plugins) || {};
  for (const [k, on] of Object.entries(ler(path.join(CASA(), 'settings.json'), {}).enabledPlugins || {})) {
    const raiz = ((inst[k] || [])[0] || {}).installPath || '';
    if (on && raiz && !fs.existsSync(path.join(raiz, 'hooks', 'hooks.json')) && !(ler(path.join(raiz, '.claude-plugin', 'plugin.json'), {}).hooks))
      c.push({ tipo: 'plugin', id: k, nome: k.split('@')[0], valor: false });
  }
  return marcarPalavras(c.filter(x => !FICAM.includes(x.nome) && x.nome !== 'licoes'));
}

const descricao = f => { try { return (fs.readFileSync(f, 'utf8').match(/^description:s*(.+)$/m) || [])[1] || ''; } catch { return ''; } };
const palavrasDe = t => new Set(dobrar(t).split(/[^a-z0-9-]+/).filter(w => w.length >= 4 && !/^d+$/.test(w)));
function marcarPalavras(c) {
  const conta = {};
  for (const x of c) for (const w of palavrasDe(x.desc || '')) conta[w] = (conta[w] || 0) + 1;
  for (const x of c) { x.palavras = [...palavrasDe(x.desc || '')].filter(w => conta[w] === 1).slice(0, 150); delete x.desc; }
  return c;
}

function querCortar(base) {
  if (process.env.SO_O_QUE_USA === '1') return true;
  try { return /\*\*Só o que usa\*\*[^|]*\|\s*\**\s*Sim/i.test(fs.readFileSync(path.join(base, 'meu', 'PERFIL.md'), 'utf8')); } catch { return false; }
}

function rodar(base) {
  const est = ler(ESTADO(), {}), hoje = new Date().toLocaleDateString('sv');
  if (est.dia === hoje || !querCortar(base)) return [];
  est.dia = hoje; est.projetos = est.projetos || {}; gravar(ESTADO(), est);
  const casa = chave(os.homedir()), feito = [];
  for (const [k, p] of Object.entries(usoPorProjeto())) {
    if (p.chats < MIN_CHATS || k === casa || path.resolve(p.cwd).split(path.sep).filter(Boolean).length < 2 || !fs.existsSync(p.cwd)) continue;
    const proj = ler(path.join(p.cwd, '.claude', 'settings.json'), {}), arqL = path.join(p.cwd, '.claude', 'settings.local.json');
    const local = ler(arqL, {}), reg = est.projetos[k] || (est.projetos[k] = { cwd: p.cwd, off: [], religadas: [] });
    const decidido = x => x.tipo === 'plugin'
      ? (proj.enabledPlugins || {})[x.id] !== undefined || (local.enabledPlugins || {})[x.id] !== undefined
      : (proj.skillOverrides || {})[x.id] !== undefined || (local.skillOverrides || {})[x.id] !== undefined;
    const usado = x => x.tipo === 'plugin' ? p.usou.has('plugin:' + x.nome) : p.usou.has(x.nome);
    const sai = candidatos(p.cwd).filter(x => !usado(x) && !decidido(x) && !reg.religadas.includes(x.id));
    if (!sai.length) continue;
    for (const x of sai) {
      const campo = x.tipo === 'plugin' ? 'enabledPlugins' : 'skillOverrides';
      (local[campo] = local[campo] || {})[x.id] = x.valor;
      reg.off.push({ id: x.id, tipo: x.tipo, nome: x.nome, palavras: x.palavras || [] });
    }
    gravar(arqL, local);
    feito.push(`só o que usa: ${sai.length} cortado(s) em ${path.basename(p.cwd)} (${sai.map(x => x.nome).join(', ')}) — nunca usados em ${p.chats} chats; voltam sozinhos quando um pedido os nomeia, ou apagando a linha no .claude/settings.local.json`);
  }
  gravar(ESTADO(), est);
  if (feito.length) { const nov = ler(NOVIDADES(), []); gravar(NOVIDADES(), [...nov, ...feito].slice(-10)); }
  return feito;
}

function devolver(prompt, cwd) {
  if (!cwd || !prompt) return '';
  const est = ler(ESTADO(), null); if (!est || !est.projetos) return '';
  const k = Object.keys(est.projetos).find(p => chave(cwd) === p || chave(cwd).startsWith(p + path.sep));
  const reg = k && est.projetos[k]; if (!reg || !reg.off.length) return '';
  const pedido = ' ' + dobrar(prompt).replace(/[^a-z0-9-]+/g, ' ') + ' ';
  const pede = x => [x.nome, x.nome.replace(/-/g, ' '), ...(CONHECIDAS[x.nome] || '').split(' ')].filter(w => w && w.length >= 3)
    .some(w => pedido.includes(' ' + w + ' ')) || (x.palavras || []).filter(w => pedido.includes(' ' + w + ' ')).length >= 2;
  const volta = reg.off.filter(pede); if (!volta.length) return '';
  const arqL = path.join(reg.cwd, '.claude', 'settings.local.json'), local = ler(arqL, {});
  for (const x of volta) delete (local[x.tipo === 'plugin' ? 'enabledPlugins' : 'skillOverrides'] || {})[x.id];
  gravar(arqL, local);
  reg.off = reg.off.filter(x => !volta.includes(x)); reg.religadas = [...new Set([...reg.religadas, ...volta.map(x => x.id)])];
  gravar(ESTADO(), est);
  const ja = volta.filter(x => x.tipo === 'skill' && !x.id.startsWith('anthropic-skills:')), depois = volta.filter(x => !ja.includes(x));
  return '[gancho so-o-que-usa] Este pedido nomeia ' + volta.map(x => x.nome).join(', ') + ', que estava cortado neste projeto por nunca ter sido usado. Já religuei (.claude/settings.local.json) e não corto de novo aqui.'
    + (ja.length ? ` ${ja.map(x => x.nome).join(', ')}: o nome já estava visível — chame pela Skill agora.` : '')
    + (depois.length ? ` ${depois.map(x => x.nome).join(', ')}: só carrega num chat novo — se for preciso agora, diga à pessoa numa linha e ofereça o prompt de chat novo.` : '');
}

module.exports = { rodar, devolver, candidatos };

if (require.main === module && process.argv[2] === '--rodar') { try { rodar(process.argv[3] || ''); } catch {} }
else if (require.main === module && process.argv[2] === '--ver') {
  const t = Date.now(), uso = usoPorProjeto();
  for (const p of Object.values(uso)) if (p.chats >= MIN_CHATS && fs.existsSync(p.cwd))
    console.log(`${p.cwd} (${p.chats} chats) — usou: ${[...p.usou].join(', ') || 'nada'}\n  sairia: ${candidatos(p.cwd).filter(x => !(x.tipo === 'plugin' ? p.usou.has('plugin:' + x.nome) : p.usou.has(x.nome))).map(x => x.nome).join(', ')}`);
  console.log(`(${Object.keys(uso).length} pastas lidas em ${Date.now() - t} ms)`);
}
else if (require.main === module && process.argv[2] === '--teste') {
  const T = fs.mkdtempSync(path.join(os.homedir(), '.so-o-que-usa-teste-')), casa = path.join(T, 'cfg'), proj = path.join(T, 'proj'), base = path.join(T, 'base');
  Object.assign(process.env, { CLAUDE_CONFIG_DIR: casa, SO_O_QUE_USA_ESTADO: path.join(T, 'estado.json'), DESTILAR_ESTADO: path.join(T, 'destilar') });
  const esc = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
  const velho = f => fs.utimesSync(f, new Date(Date.now() - 30 * 864e5), new Date(Date.now() - 30 * 864e5));
  esc(path.join(base, 'meu', 'PERFIL.md'), '| **Só o que usa** *(cortar)* | **Sim, em todo projeto** |\n');
  esc(path.join(casa, 'skills', 'synced', 'x', 'manifest.json'), JSON.stringify({ skills: [{ name: 'pdf' }, { name: 'xlsx' }, { name: 'prospeccao', description: 'Diagnostica empresas do mapa (nota, avaliações, site) e escreve a abordagem' }] }));
  for (const s of ['grill-me', 'handoff', 'graphify']) { esc(path.join(casa, 'skills', s, 'SKILL.md'), '---\n'); velho(path.join(casa, 'skills', s, 'SKILL.md')); }
  esc(path.join(casa, 'skills', 'novinha', 'SKILL.md'), '---\n');
  esc(path.join(proj, '.claude', 'settings.json'), JSON.stringify({ skillOverrides: { graphify: 'off' } }));
  const linha = o => JSON.stringify({ cwd: proj, ...o }) + '\n';
  for (let i = 0; i < 3; i++) esc(path.join(casa, 'projects', 'p', i + '.jsonl'), linha({ type: 'user' })
    + (i === 0 ? linha({ message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'anthropic-skills:xlsx' } }] } }) : ''));
  let falhou = 0; const confere = (ok, o) => { console.log((ok ? 'ok    ' : 'FALHOU ') + o); if (!ok) falhou++; };
  const f = rodar(base), L = () => ler(path.join(proj, '.claude', 'settings.local.json'), {}).skillOverrides || {};
  confere(L()['anthropic-skills:pdf'] === 'off', 'skill do claude.ai nunca usada sai inteira ("off")');
  confere(L()['grill-me'] === 'name-only', 'skill da pessoa nunca usada fica só com o nome');
  confere(!L()['anthropic-skills:xlsx'], 'a usada fica');
  confere(!L().handoff, 'a que guarda o momento raro fica');
  confere(!L().novinha, 'a instalada há menos de 14 dias fica');
  confere(!L().graphify, 'o que já foi decidido no settings.json não se toca');
  confere(f.length === 1 && /novidades/.test(NOVIDADES()) && ler(NOVIDADES(), []).length === 1, 'o corte vira novidade do próximo chat');
  confere(rodar(base).length === 0, 'roda uma vez por dia');
  confere(devolver('arruma o css', proj) === '', 'pedido sem nada cortado: silêncio');
  const d = devolver('Lê esse PDF e me resume', path.join(proj, 'src'));
  confere(/religuei/.test(d) && !L()['anthropic-skills:pdf'] && /chat novo/.test(d), 'pedido que nomeia o cortado religa, de dentro de uma subpasta');
  const e = ler(process.env.SO_O_QUE_USA_ESTADO, {}); e.dia = ''; gravar(process.env.SO_O_QUE_USA_ESTADO, e); rodar(base);
  confere(!L()['anthropic-skills:pdf'], 'o religado não é cortado de novo');
  confere(L()['anthropic-skills:prospeccao'] === 'off' && devolver('Padaria do Zé, nota 4.2', proj) === '', 'uma palavra só da descrição não religa');
  confere(/prospeccao/.test(devolver('Padaria do Zé, nota 4.2, 38 avaliações, sem site', proj)) && !L()['anthropic-skills:prospeccao'], 'duas palavras só dela na descrição religam, sem o nome');
  delete process.env.SO_O_QUE_USA; fs.writeFileSync(path.join(base, 'meu', 'PERFIL.md'), '| **Só o que usa** | Não |'); e.dia = ''; gravar(process.env.SO_O_QUE_USA_ESTADO, e);
  confere(rodar(base).length === 0, 'a pessoa disse não: nada sai');
  fs.rmSync(T, { recursive: true, force: true });
  console.log(falhou ? `${falhou} falha(s).` : 'Tudo certo.');
  process.exit(falhou ? 1 : 0);
}
