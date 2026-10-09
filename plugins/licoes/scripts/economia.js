#!/usr/bin/env node
// economia.js — quanto os dois ralos que esta pasta fecha custaram NESTA máquina, lido dos logs do
// Claude Code (~/.claude/projects). Nada sai do computador; só lê. A saída se lê sem o agente traduzir.
//   node <PASTA-LICOES>/economia.js               → antes × depois da data das boas-vindas do meu/PERFIL.md
//   node <PASTA-LICOES>/economia.js 2026-09-13    → antes × depois desta data
//   node <PASTA-LICOES>/economia.js --lista       → e cada volta fria, uma por linha
//   node <PASTA-LICOES>/economia.js --tecnico     → a saída de medição (chamadas, US$ por ralo, quanto um chat novo pouparia)
//   node <PASTA-LICOES>/economia.js --budget [dias] [here] → para onde foi o uso dos últimos 7 dias (o /budget do plugin, o /licoes-budget solto)
//   node <PASTA-LICOES>/economia.js --teste       → o autoteste do --budget, com logs falsos numa pasta temporária
// Os dois ralos (09 §9.15 e §9.14): VOLTA FRIA — a mensagem que chega a um chat de 100 mil+ tokens depois
// de 60+ min parado e reescreve o cache inteiro; e CONVERSA ACIMA DE 200 MIL — cada chamada relê o que
// passou disso. Valores em US$ de API: a assinatura não publica o limite em tokens, mas gasta na mesma proporção.
// Preços: platform.claude.com/docs/en/about-claude/pricing, conferidos em 07/10/2026.
const fs = require('fs'), path = require('path'), os = require('os');
// [trecho do nome do modelo, US$ por milhão de entrada, de leitura de cache] — saída = 5× a entrada
const PRECOS = [['fable-5-1', 10, 0.25], ['fable', 10, 1], ['opus-5-5', 4, 0.2], ['opus', 5, 0.5],
  ['sonnet-5-5', 2, 0.1], ['sonnet-5', 2, 0.2], ['sonnet', 3, 0.3], ['haiku-5', 0.1, 0.01], ['haiku', 1, 0.1]];
// o Haiku 5.5 cobra pelo tamanho do pedido: acima de 100 mil tokens de entrada, tudo custa 5× (09 §9.2)
const preco = m => PRECOS.find(([k]) => (m || '').includes(k)) || [null, 0, 0];
const ctx = u => (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
const fatorEscrita = u => ((u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0) > 0 ? 2 : 1.25;
const custo = c => { const u = c.u, [k, e0, l0] = preco(c.model), x = k === 'haiku-5' && ctx(u) > 100000 ? 5 : 1, e = e0 * x, l = l0 * x;
  return ((u.input_tokens || 0) * e + (u.cache_creation_input_tokens || 0) * e * fatorEscrita(u)
    + (u.cache_read_input_tokens || 0) * l + (u.output_tokens || 0) * e * 5) / 1e6; };

function chamadas(arq) {  // uma chamada vira várias linhas no log; fica uma por id, só a conversa principal
  const porId = new Map();
  for (const l of fs.readFileSync(arq, 'utf8').split('\n')) {
    if (!l.includes('"usage"')) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    const u = j.message && j.message.usage;
    if (j.type === 'assistant' && u && !j.isSidechain)
      porId.set(j.requestId || j.message.id, { t: Date.parse(j.timestamp), model: j.message.model, u });
  }
  return [...porId.values()].sort((a, b) => a.t - b.t);
}

// ---------- --budget: para onde foi o uso dos últimos N dias, em dólar, até a saída de ferramenta que mais custou carregar.
// Ideia do /budget da Helena (vijcoelho/project-helena, MIT), com dólar, modelo e sub-agentes, e a maior alavanca calculada.
// As pastas mudam por variável só para o --teste: ECONOMIA_PROJETOS, DESTILAR_ESTADO, ROTINAS_ESTADO, LIMITES_ARQ.
const casa = (v, ...p) => process.env[v] || path.join(os.homedir(), '.claude', ...p);
const raiz = () => casa('ECONOMIA_PROJETOS', 'projects');
const diaLocal = t => { const d = new Date(t), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
const tamanho = c => typeof c === 'string' ? c.length  // imagem: ~1.500 tokens, que são ~6 mil caracteres
  : Array.isArray(c) ? c.reduce((s, b) => s + (b.type === 'image' ? 6000 : (b.text || '').length), 0) : 0;
const alvo = (i = {}) => String((i.file_path || i.notebook_path || '').split(/[\\/]/).pop() || i.command || i.pattern || i.url || i.query || i.description || '').replace(/\s+/g, ' ');

function lerSessao(arq) {  // na ordem do arquivo: as chamadas (uma por id, a última usage vale), as saídas de ferramenta e o que a pessoa escreveu
  const ev = [], porId = new Map(), ferr = new Map(), s = { ev, cwd: '', titulo: '' };
  for (const l of fs.readFileSync(arq, 'utf8').split('\n')) {
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.cwd && !s.cwd) s.cwd = j.cwd;
    if (j.type === 'custom-title' && j.customTitle) s.nome = j.customTitle;
    const m = j.message; if (!m) continue;
    const blocos = Array.isArray(m.content) ? m.content : [];
    if (j.type === 'assistant' && m.usage) {
      const id = j.requestId || m.id;
      if (!porId.has(id)) { porId.set(id, { t: Date.parse(j.timestamp), model: m.model, side: !!j.isSidechain }); ev.push(porId.get(id)); }
      porId.get(id).u = m.usage;
      for (const b of blocos) if (b.type === 'tool_use') ferr.set(b.id, { nome: String(b.name).replace(/^mcp__.*__/, ''), alvo: alvo(b.input) });
    } else if (j.type === 'user' && !j.isSidechain) {
      const texto = typeof m.content === 'string' ? m.content : '';
      if (texto) { ev.push({ chars: texto.length }); if (!s.titulo && !texto.startsWith('<')) s.titulo = texto; }
      for (const b of blocos) ev.push(b.type === 'tool_result' ? { chars: tamanho(b.content), f: b.tool_use_id } : { chars: tamanho([b]) });
    }
  }
  for (const e of ev) if (e.f) Object.assign(e, ferr.get(e.f) || { nome: '?', alvo: '' });
  return s;
}

function orcamento(dias, aqui, agora = Date.now()) {
  const h = new Date(agora), desde = new Date(h.getFullYear(), h.getMonth(), h.getDate() - dias + 1).getTime();  // dia local inteiro
  const R = { dias, desde, usd: 0, tok: 0, msgs: 0, lido: 0, entrada: 0, principal: 0, dia: {}, proj: {}, modelo: {}, sub: 0, subMsgs: 0,
    chats: [], primeiros: [], ctxSoma: 0, ctxN: 0, ferr: {}, saidas: [], grandes: 0, frias: 0, friasUsd: 0, poupavel: 0, acima: 0, acimaUsd: 0, plugin: 0, limites: [] };
  const mais = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  const conta = (c, s) => { const v = custo(c); R.usd += v; R.tok += ctx(c.u) + (c.u.output_tokens || 0); R.msgs++; R.entrada += ctx(c.u);
    R.lido += c.u.cache_read_input_tokens || 0; s.usd += v; s.t = Math.min(s.t, c.t);
    mais(R.dia, diaLocal(c.t), v); mais(R.proj, s.proj, v); mais(R.modelo, String(c.model || '?').replace(/^claude-/, ''), v); return v; };
  const so = t => String(t).replace(/\\/g, '/').toLowerCase(), aquiDir = so(process.cwd()), aquiNome = process.cwd().replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const recente = a => fs.statSync(a).mtimeMs >= desde;
  for (const proj of fs.existsSync(raiz()) ? fs.readdirSync(raiz()).filter(p => !/-Temp-|-tmp-/i.test(p)) : []) {  // pastas de teste ficam de fora
    const dir = path.join(raiz(), proj);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && recente(path.join(dir, f)))) {
      const s = lerSessao(path.join(dir, f));
      if (aqui && proj.toLowerCase() !== aquiNome && so(s.cwd) !== aquiDir) continue;
      Object.assign(s, { proj: s.cwd ? s.cwd.split(/[\\/]/).pop() : proj, usd: 0, t: Infinity });
      const subDir = path.join(dir, f.slice(0, -6), 'subagents');
      for (const g of fs.existsSync(subDir) ? fs.readdirSync(subDir).filter(g => g.endsWith('.jsonl') && recente(path.join(subDir, g))) : [])
        for (const c of lerSessao(path.join(subDir, g)).ev) if (c.u && c.t >= desde) { R.sub += conta(c, s); R.subMsgs++; }
      for (const c of s.ev) if (c.u && c.side && c.t >= desde) { R.sub += conta(c, s); R.subMsgs++; }
      const ch = s.ev.filter(c => c.u && !c.side);  // a conversa principal
      // até onde cada chamada carrega o que entrou nela: até o contexto cair mais de 20 mil (compactação ou /clear)
      const fim = []; for (let i = ch.length - 1; i >= 0; i--) fim[i] = i < ch.length - 1 && ctx(ch[i + 1].u) >= ctx(ch[i].u) - 20000 ? fim[i + 1] : i;
      const L = [0]; ch.forEach((c, i) => L.push(L[i] + preco(c.model)[2]));  // a soma do preço de leitura até cada chamada
      let pend = [], i = -1;
      for (const c of s.ev) {
        if (!c.u) { if (i >= 0) pend.push(c); continue; }
        if (c.side) continue;
        const a = ch[i++], p = pend; pend = [];
        if (c.t < desde) continue;
        R.principal += conta(c, s); R.ctxSoma += ctx(c.u); R.ctxN++;
        if (i === 0) R.primeiros.push(ctx(c.u));
        const [, e, l] = preco(c.model), cx = ctx(c.u), escrito = c.u.cache_creation_input_tokens || 0;
        if (cx > 200000) { R.acima++; R.acimaUsd += (cx - 200000) * l / 1e6; }  // os dois ralos: a mesma regra do modo normal
        if (a && c.t - a.t >= 3600000 && ctx(a.u) >= 100000 && escrito >= 50000) {
          const pago = escrito * e * fatorEscrita(c.u) / 1e6; R.frias++; R.friasUsd += pago; R.poupavel += Math.max(0, pago - 50000 * e * 1.25 / 1e6); }
        // o que entrou desde a anterior, repartido pelo tamanho; carregar = gravar no cache aqui + reler em cada chamada até o contexto cair
        const novo = a ? cx - ctx(a.u) - (a.u.output_tokens || 0) : 0, total = p.reduce((x, q) => x + q.chars, 0);
        if (novo > 0 && total) for (const q of p.filter(q => q.f)) {
          const T = novo * q.chars / total, usd = T * (e * fatorEscrita(c.u) + L[fim[i] + 1] - L[i + 1]) / 1e6, F = R.ferr[q.nome] = R.ferr[q.nome] || { tok: 0, usd: 0 };
          F.tok += T; F.usd += usd; R.saidas.push({ nome: q.nome, alvo: q.alvo, T, usd, n: fim[i] - i, t: c.t, proj: s.proj });
          if (T >= 10000) R.grandes += usd * (1 - 2000 / T);  // ler por trecho: o que custaria com 2 mil tokens
        }
      }
      if (s.usd) R.chats.push({ usd: s.usd, t: s.t, proj: s.proj, nome: s.nome || s.titulo || '(sem título)' });
    }
  }
  for (const [v, p] of [['DESTILAR_ESTADO', 'destilar'], ['ROTINAS_ESTADO', 'rotinas']])  // o que o plugin rodou sozinho (Haiku)
    try { for (const l of fs.readFileSync(path.join(casa(v, 'ganchos', p), 'registro.log'), 'utf8').split('\n'))
      if (Date.parse(l.slice(0, 24)) >= desde) R.plugin += Number((l.match(/US\$ ([\d.]+)/) || [])[1] || 0); } catch {}
  try { const j = JSON.parse(fs.readFileSync(casa('LIMITES_ARQ', 'ganchos', 'limites.json'), 'utf8'));  // gravado pela barra de status ou pelo mod
    R.gravado = j.gravado; R.limites = Object.entries(j).filter(([n, x]) => n !== 'gravado' && x && typeof x.pct === 'number' && !(x.volta && x.volta * 1000 < agora)); } catch {}
  return R;
}

function mostrar(R, aqui, agora = Date.now()) {  // pt-BR, linhas de até 70 caracteres, barra só com # e - (o mesmo motivo do modo normal)
  const o = [], rs = v => 'US$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tk = n => n >= 1e6 ? (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi' : Math.round(n / 1000) + ' mil';
  const barra = (p, n = 20) => { const k = Math.max(0, Math.min(n, Math.round(p * n))) || 0; return '[' + '#'.repeat(k) + '-'.repeat(n - k) + ']'; };
  const pc = (a, b) => (b ? Math.round(100 * a / b) : 0) + '%', dm = t => diaLocal(t).slice(5).split('-').reverse().join('/');
  const col = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t).padEnd(n);
  const quebra = t => t.split(' ').reduce((ls, w) => { (ls[ls.length - 1] + ' ' + w).length > 66 ? ls.push(w) : ls[ls.length - 1] += (ls[ls.length - 1] ? ' ' : '') + w; return ls; }, ['']).map(l => '  ' + l);
  const ranking = (obj, n) => { const e = Object.entries(obj).sort((a, b) => b[1] - a[1]), r = e.slice(0, n);
    if (e.length > n) r.push(['(outros)', e.slice(n).reduce((s, x) => s + x[1], 0)]); return r; };
  o.push(`PARA ONDE FOI O SEU USO: ${R.dias} dia(s), de ${dm(R.desde)} a ${dm(agora)}`, '(neste computador, lido dos registros dele; nada sai daqui)');
  if (aqui) o.push(`(só este projeto: ${path.basename(process.cwd())})`);
  if (!R.msgs) return [...o, '', 'Nenhuma mensagem do Claude nesta janela.'].join('\n');
  o.push('', `TOTAL: ${rs(R.usd)} a preço de API · ${tk(R.tok)} tokens`,
    `  ${R.chats.length} chats, ${R.msgs.toLocaleString('pt-BR')} mensagens do Claude · cache relido: ${pc(R.lido, R.entrada)}`,
    '  Na assinatura (Pro ou Max) você não paga esse valor: é o mesmo', '  consumo que gasta o seu limite, contado em dólar.');
  const g = R.gravado ? new Date(R.gravado).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  o.push('', 'LIMITE DO PLANO' + (g ? ` (gravado em ${g.replace(',', '')})` : ''));
  if (!R.limites.length) o.push('  sem dado: quem grava é a barra de status ou o /panel do mod');
  for (const [n, j] of R.limites) {
    const m = j.volta ? Math.max(0, Math.round((j.volta * 1000 - agora) / 60000)) : null;
    const zera = m === null ? '' : ' · zera em ' + (m >= 1440 ? `${Math.floor(m / 1440)} d ${Math.floor(m % 1440 / 60)} h` : `${Math.floor(m / 60)} h ${m % 60} min`);
    o.push(`  ${col({ five_hour: '5 horas', seven_day: 'semana', spend_limit: 'gasto' }[n] || n, 8)}${barra(j.pct / 100)} ${String(Math.round(j.pct)).padStart(3)}%${zera}${j.pct >= 95 ? ' !!' : j.pct >= 80 ? ' !' : ''}`);
  }
  o.push('', 'POR DIA');
  const sem = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'], maxD = Math.max(...Object.values(R.dia));
  for (const d = new Date(R.desde); d.getTime() <= agora; d.setDate(d.getDate() + 1))
    o.push(`  ${sem[d.getDay()]} ${dm(d)}  ${barra((R.dia[diaLocal(d)] || 0) / maxD)}  ${rs(R.dia[diaLocal(d)] || 0)}`);
  o.push('', 'POR PROJETO');
  for (const [n, v] of ranking(R.proj, 6)) o.push(`  ${col(n, 20)}${barra(v / R.usd, 10)}  ${rs(v).padStart(11)}  ${pc(v, R.usd).padStart(4)}`);
  o.push('', 'POR MODELO');
  for (const [n, v] of ranking(R.modelo, 6).filter(x => x[1] > 0)) o.push(`  ${col(n, 20)}${rs(v).padStart(11)}  ${pc(v, R.usd).padStart(4)}`);
  o.push('', `SUB-AGENTES: ${rs(R.sub)} (${pc(R.sub, R.usd)} do total), ${R.subMsgs} mensagens`, '', 'OS 5 CHATS MAIS CAROS');
  for (const c of R.chats.sort((a, b) => b.usd - a.usd).slice(0, 5))
    o.push(`  ${rs(c.usd).padStart(11)}  ${dm(c.t)}  ${col(c.proj, 16)} ${col(String(c.nome).replace(/\s+/g, ' '), 30)}`.trimEnd());
  const ps = R.primeiros.sort((a, b) => a - b), med = ps.length ? (ps[(ps.length - 1) >> 1] + ps[ps.length >> 1]) / 2 : 0;
  o.push('', 'O CONTEXTO (o que o Claude relê a cada mensagem)', `  Começo de chat: ${tk(med)} tokens antes da 1ª palavra (mediana)`,
    `  Média por mensagem: ${tk(R.ctxSoma / (R.ctxN || 1))} tokens`);
  const totF = Object.values(R.ferr).reduce((s, x) => s + x.tok, 0);
  if (totF) {
    o.push('', 'O QUE ENCHEU O CONTEXTO (saídas de ferramenta, em tokens)');
    for (const [n, x] of Object.entries(R.ferr).sort((a, b) => b[1].tok - a[1].tok).slice(0, 6))
      o.push(`  ${col(n, 12)}${barra(x.tok / totF, 10)} ${tk(x.tok).padStart(8)} ${pc(x.tok, totF).padStart(4)} · carregar: ${rs(x.usd)}`);
    o.push('', 'AS 5 SAÍDAS QUE MAIS CUSTARAM PARA CARREGAR');
    for (const s of R.saidas.sort((a, b) => b.usd - a.usd).slice(0, 5))
      o.push(`  ${rs(s.usd).padStart(11)}  ${col(s.nome + ' ' + s.alvo, 53).trimEnd()}`,
        `${' '.repeat(15)}${tk(s.T)} tokens, relidos ${s.n} vez(es) · ${dm(s.t)} · ${col(s.proj, 16)}`.trimEnd());
  }
  o.push('', 'OS DOIS RALOS', `  Volta a chat grande após 1 h parado: ${R.frias} vez(es), ${rs(R.friasUsd)}`,
    `  Mensagens acima de 200 mil tokens: ${pc(R.acima, R.ctxN)}; o excesso: ${rs(R.acimaUsd)}`,
    '', `O QUE O PLUGIN RODOU SOZINHO: ${rs(R.plugin)} (destilar e rotinas)`);
  const alav = [[R.grandes, 'ler por trecho', 'Saída de ferramenta com 10 mil+ tokens é relida em toda mensagem até o fim do chat. Peça ao Claude para ler só o trecho (grep -n acha a linha, sed -n lê só ela) e cortar a saída longa de comando com tail.'],
    [R.poupavel, 'chat novo depois de 1 h parado', 'Voltar a um chat grande depois de 1 hora parado relê tudo a preço cheio. Parou? Abra um chat novo e cole o prompt de retomada.'],
    [R.acimaUsd, 'fechar o chat antes de 200 mil', 'Cada mensagem acima de 200 mil tokens relê o excesso. Passou de 150 mil? Grave onde parou e siga num chat novo.']].sort((a, b) => b[0] - a[0]);
  o.push('', 'A MAIOR ALAVANCA');
  if (alav[0][0] < 0.01) o.push('  Nada a apontar: nenhum dos três ralos custou nesta janela.');
  else {
    o.push(`  ${alav[0][1][0].toUpperCase() + alav[0][1].slice(1)}: ${rs(alav[0][0])} a menos nestes ${R.dias} dias.`, ...quebra(alav[0][2]));
    const dep = alav.slice(1).filter(x => x[0] >= 0.01).map(x => `${x[1]} (${rs(x[0])})`);
    if (dep.length) o.push(...quebra('Depois: ' + dep.join('; ') + '.'));
  }
  return o.join('\n');
}

function teste() {  // logs falsos com números conhecidos; cada conta conferida à mão
  const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'economia-'))), agora = Date.now(), H = 3600000, D = 24 * H;
  let falhas = 0; const confere = (ok, o) => { console.log((ok ? 'ok      ' : 'FALHOU  ') + o); if (!ok) falhas++; };
  const perto = (a, b) => Math.abs(a - b) < 1e-9, iso = t => new Date(t).toISOString();
  Object.assign(process.env, { ECONOMIA_PROJETOS: path.join(T, 'projects'), DESTILAR_ESTADO: path.join(T, 'destilar'),
    ROTINAS_ESTADO: path.join(T, 'rotinas'), LIMITES_ARQ: path.join(T, 'limites.json') });
  const u = (cc, cr, out, inp = 0) => ({ input_tokens: inp, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: out });
  const gravar = (arq, cwd, linhas, mtime) => { fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.writeFileSync(arq, linhas.map(l => JSON.stringify({ cwd, ...l })).join('\n') + '\n'); if (mtime) fs.utimesSync(arq, mtime / 1000, mtime / 1000); };
  const r = (id, t, us, x = {}) => ({ type: 'assistant', requestId: id, timestamp: iso(t), isSidechain: !!x.side,
    message: { model: x.model || 'claude-opus-5-5', usage: us, content: x.conteudo || [] } });
  const res = (id, content) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
  const dirA = path.join(T, 'projA'), dirB = path.join(T, 'projB'), P = path.join(T, 'projects'), t0 = agora - 3 * H;
  for (const d of [dirA, dirB]) fs.mkdirSync(d);
  gravar(path.join(P, 'C--x-projA', 'sA.jsonl'), dirA, [
    { type: 'custom-title', customTitle: 'Teste A' }, { type: 'user', timestamp: iso(t0), message: { role: 'user', content: 'começar' } },
    r('r1', t0, u(30000, 0, 5, 10), { conteudo: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'C:/x/a.md' } }] }),
    r('r1', t0, u(30000, 0, 1000, 10), { conteudo: [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'ls -la' } }] }),
    res('tu1', 'x'.repeat(40000)), res('tu2', [{ type: 'text', text: 'y'.repeat(10000) }]),
    r('r2', t0 + 60e3, u(26000, 30010, 500)), r('r3', t0 + 120e3, u(100, 56010, 100)), r('r4', t0 + 180e3, u(30000, 0, 100)),
    r('r5', t0 + 240e3, u(120000, 0, 100)), r('r6', t0 + 240e3 + 2 * H, u(120000, 0, 100)), r('r7', t0 + 300e3 + 2 * H, u(0, 250000, 100)),
    r('s1', t0 + 60e3, u(0, 0, 100, 1000), { side: true, model: 'claude-haiku-4-5' })]);
  gravar(path.join(P, 'C--x-projA', 'sA', 'subagents', 'agent-1.jsonl'), dirA, [r('a1', t0 + 60e3, u(0, 0, 1000, 2000), { side: true, model: 'claude-sonnet-5-5' })]);
  gravar(path.join(P, 'C--x-projA', 'velho.jsonl'), dirA, [r('v1', agora - 30 * D, u(0, 0, 0, 1e6))], agora - 30 * D);
  gravar(path.join(P, 'C--x-projB', 'sB.jsonl'), dirB, [r('b1', agora - 2 * D, u(0, 0, 0, 1000))]);
  gravar(path.join(P, 'C--x-projB', 'sD.jsonl'), dirB, [r('d1', agora - 10 * D, u(0, 0, 0, 1e6))]);
  gravar(path.join(P, 'C--x-Temp-y', 'sT.jsonl'), dirB, [r('x1', agora - H, u(0, 0, 0, 1e6))]);
  fs.mkdirSync(process.env.DESTILAR_ESTADO); fs.mkdirSync(process.env.ROTINAS_ESTADO);
  fs.writeFileSync(path.join(process.env.DESTILAR_ESTADO, 'registro.log'), `${iso(agora - 30 * D)} destilou velho · US$ 5.000\n${iso(agora - H)} destilou abc · US$ 0.010\n`);
  fs.writeFileSync(path.join(process.env.ROTINAS_ESTADO, 'registro.log'), `${iso(agora - H)} rodou dependencias · US$ 0.020\n`);
  fs.writeFileSync(process.env.LIMITES_ARQ, JSON.stringify({ gravado: agora, five_hour: { pct: 42, volta: (agora + 130 * 60e3) / 1000 },
    seven_day: { pct: 85, volta: (agora + 76 * H) / 1000 }, spend_limit: { pct: 99, volta: (agora - H) / 1000 } }));
  const R = orcamento(7, false, agora);
  confere(perto(R.usd, 1.757244), `total US$ 1,757244: as 7 da conversa A + sub-agente + sidechain + B; fora o velho, o de 10 dias e a pasta Temp (${R.usd})`);
  confere(perto(R.principal, 1.741744) && R.msgs === 10, 'a conversa principal US$ 1,741744 (a mesma conta do --tecnico) e 10 mensagens, a r1 contada uma vez');
  confere(perto(R.sub, 0.0155) && R.subMsgs === 2, 'sub-agentes US$ 0,0155: o arquivo de subagents (Sonnet) e a linha sidechain (Haiku)');
  confere(perto(R.modelo['opus-5-5'], 1.741744) && perto(R.modelo['sonnet-5-5'], 0.014) && perto(R.modelo['haiku-4-5'], 0.0015), 'por modelo');
  confere(perto(R.proj.projA, 1.753244) && perto(R.proj.projB, 0.004) && perto(Object.values(R.dia).reduce((s, x) => s + x, 0), R.usd), 'por projeto (nome do cwd) e por dia somando o total');
  confere(perto(R.ferr.Read.tok, 20000) && perto(R.ferr.Bash.tok, 5000), 'as 25 mil novas da r2 repartidas pelo tamanho: Read 20 mil, Bash 5 mil');
  confere(perto(R.ferr.Read.usd, 0.104) && perto(R.ferr.Bash.usd, 0.026) && R.saidas[0].n === 1, 'carregar o Read: gravar 0,10 + reler 1 vez 0,004; a compactação da r4 para a conta');
  confere(R.frias === 1 && perto(R.friasUsd, 0.6) && perto(R.poupavel, 0.35) && R.acima === 1 && perto(R.acimaUsd, 0.01), 'os dois ralos: 1 volta fria (0,60, poupável 0,35) e 1 acima de 200 mil (0,01)');
  confere(perto(R.grandes, 0.0936), 'ler por trecho: o Read de 20 mil custaria 1/10 com 2 mil tokens, 0,0936 a menos');
  confere(perto(R.plugin, 0.03), 'o plugin sozinho: destilar 0,01 + rotinas 0,02, sem a linha de 30 dias atrás');
  confere(R.chats.length === 2 && R.chats.find(c => c.nome === 'Teste A') && [...R.primeiros].sort((a, b) => a - b).join() === '1000,30010', 'os chats (com o título dado) e o começo de cada um');
  const txt = mostrar(R, false, agora), ls = txt.split('\n'), i = ls.indexOf('A MAIOR ALAVANCA');
  confere(ls.every(l => l.length <= 70), 'nenhuma linha passa de 70 caracteres' + ls.filter(l => l.length > 70).map(l => '\n  ' + l).join(''));
  confere(/^  Chat novo depois de 1 h parado: US\$ 0,35 /.test(ls[i + 1]) && /Depois: ler por trecho \(US\$ 0,09\); fechar o chat/.test(txt), 'a maior alavanca é a volta fria; as outras ficam como "depois"');
  confere(/5 horas \[#{8}-{12}\]  42% · zera em 2 h 10 min/.test(txt) && /semana .* 85% · zera em 3 d 4 h !/.test(txt) && !/gasto/.test(txt), 'os limites, com "zera em", sem a janela vencida');
  confere(txt.includes('TOTAL: US$ 1,76') && txt.includes('Começo de chat: 16 mil tokens'), 'o total e a mediana do começo (1 mil e 30 mil)');
  const antes = process.cwd(); process.chdir(dirA); const R2 = orcamento(7, true, agora); process.chdir(antes);
  confere(perto(R2.usd, 1.753244), 'here: só o projeto da pasta atual');
  const rodar = (...a) => require('child_process').execFileSync(process.execPath, [__filename, ...a], { encoding: 'utf8' });
  confere(rodar('--budget', '7').includes('TOTAL: US$ 1,76') && rodar('--tecnico', '2000-01-01').includes('10 chamadas'), 'pela linha de comando, e o modo normal lê a mesma pasta');
  if (!process.env.MANTER) fs.rmSync(T, { recursive: true, force: true }); else console.log(txt);
  console.log(falhas ? `${falhas} FALHA(S)` : 'tudo certo'); process.exitCode = falhas ? 1 : 0;
}

const args = process.argv.slice(2);
if (args.includes('--teste')) return teste();
if (args.includes('--budget')) { const aqui = args.some(a => /^(here|aqui)$/i.test(a));
  return console.log(mostrar(orcamento(Number(args.find(a => /^\d+$/.test(a)) || 7), aqui), aqui)); }
let data = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (!data) try {  // a data das boas-vindas: é quando a pasta chegou a esta pessoa
  const m = fs.readFileSync(path.join(__dirname, 'meu', 'PERFIL.md'), 'utf8')
    .match(/Boas-vindas da pasta\**\s*\|\s*(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/);
  if (m) data = m[1].includes('/') ? m[1].split('/').reverse().join('-') : m[1];
} catch {}
const DIVISA = data ? Date.parse(data + 'T00:00:00') : Infinity;
const novo = () => ({ dias: new Set(), chamadas: 0, usd: 0, frias: 0, friasUsd: 0, poupavel: 0, acima: 0, acimaUsd: 0 });
const P = { antes: novo(), depois: novo() }, lista = [];

const RAIZ = raiz();
if (!fs.existsSync(RAIZ)) { console.log('sem logs do Claude Code nesta máquina (~/.claude/projects)'); process.exit(0); }
for (const proj of fs.readdirSync(RAIZ).filter(p => !/-Temp-|-tmp-/i.test(p))) {  // pastas de teste ficam de fora
  const dir = path.join(RAIZ, proj);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
    const cs = chamadas(path.join(dir, f));
    cs.forEach((c, i) => {
      const q = P[c.t < DIVISA ? 'antes' : 'depois'], [, e, l] = preco(c.model), cx = ctx(c.u);
      q.dias.add(new Date(c.t).toISOString().slice(0, 10)); q.chamadas++; q.usd += custo(c);
      if (cx > 200000) { q.acima++; q.acimaUsd += (cx - 200000) * l / 1e6; }
      const a = cs[i - 1], escrito = c.u.cache_creation_input_tokens || 0;
      if (a && (c.t - a.t) >= 3600000 && ctx(a.u) >= 100000 && escrito >= 50000) {
        const pago = escrito * e * fatorEscrita(c.u) / 1e6, chatNovo = 50000 * e * 1.25 / 1e6;  // chat novo: ~50 mil
        q.frias++; q.friasUsd += pago; q.poupavel += Math.max(0, pago - chatNovo);
        lista.push(`  ${new Date(c.t).toISOString().slice(0, 10)} · ${Math.round(ctx(a.u) / 1000)} mil · parado ${Math.round((c.t - a.t) / 3600000)} h · US$ ${pago.toFixed(2)}`);
      }
    });
  }
}

const usd = v => 'US$ ' + v.toFixed(2);
const pct = (a, b) => (b ? 100 * a / b : 0).toFixed(0) + '%';
if (args.includes('--tecnico')) {  // a saída de medição, para o agente (09 §9.15)
  for (const [nome, q] of Object.entries(P)) {
    if (!q.chamadas) continue;
    const titulo = !data ? 'todo o período' : nome === 'antes' ? `antes de ${data}` : `desde ${data}`;
    console.log(`${titulo}: ${q.dias.size} dias com uso · ${q.chamadas} chamadas · ${usd(q.usd)} em preço de API`);
    console.log(`  volta fria a chat grande: ${q.frias}× · ${usd(q.friasUsd)} (${pct(q.friasUsd, q.usd)} do gasto) · um chat novo pouparia ${usd(q.poupavel)}`);
    console.log(`  chamadas acima de 200 mil: ${pct(q.acima, q.chamadas)} delas · a parte acima de 200 mil custou ${usd(q.acimaUsd)} (${pct(q.acimaUsd, q.usd)} do gasto)`);
  }
  if (!data) console.log('(sem data de comparação: passe AAAA-MM-DD, ou grave as boas-vindas no meu/PERFIL.md)');
} else {  // a saída de quem nunca programou: lida direto, sem o agente traduzir (pedido do dono, 25/09/2026)
  // Só ASCII na barra e linhas de até ~70 caracteres: '█' e '░' saíram com alturas diferentes na fonte do app,
  // e a linha longa quebrou por cima do texto (visto pelo dono, 25/09/2026)
  const br = d => d.split('-').reverse().join('/'), n = f => Math.round(f * 100);
  const barra = p => '[' + '#'.repeat(Math.round(p / 5)) + '-'.repeat(20 - Math.round(p / 5)) + ']';
  const brl = v => 'US$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  console.log('QUANTO DO SEU USO DO CLAUDE FOI DESPERDÍCIO');
  console.log('(neste computador, lido dos registros dele — nada sai daqui)\n');
  for (const [nome, q] of Object.entries(P)) {
    if (!q.chamadas) continue;
    const titulo = !data ? 'Todo o período' : nome === 'antes' ? `ANTES da pasta (até ${br(data)})` : `DEPOIS da pasta (desde ${br(data)})`;
    const a = n(q.friasUsd / q.usd), b = n(q.acimaUsd / q.usd);  // o total é a soma das partes: 11% + 22% não mostra 34%
    console.log(`${titulo} — ${q.dias.size} dias de uso`);
    console.log(`  ${barra(a + b)}  ${a + b}% do que você gastou foi desperdício:`);
    console.log(`   • ${a}% — voltar a uma conversa grande depois de 1 hora parado`);
    console.log(`         (${q.frias} vezes): o Claude relê tudo a preço cheio`);
    console.log(`   • ${b}% — conversas compridas demais: cada mensagem relê o excesso\n`);
  }
  const t = P.antes.usd + P.depois.usd;
  console.log(`Em dinheiro, a preço de API: ${brl(t)} no total,`);
  console.log(`${brl(P.antes.friasUsd + P.antes.acimaUsd + P.depois.friasUsd + P.depois.acimaUsd)} de desperdício.`);
  console.log('Se você paga assinatura (Pro ou Max), não pagou esse valor:');
  console.log('é o mesmo consumo que gasta o seu limite, contado em dólar.');
  if (!data) console.log('\n(Para ver o antes e o depois da pasta: node economia.js AAAA-MM-DD,\n com a data em que ela chegou.)');
}
if (args.includes('--lista')) console.log(lista.join('\n'));
