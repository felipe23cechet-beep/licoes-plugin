#!/usr/bin/env node
// economia.js — quanto os dois ralos que esta pasta fecha custaram NESTA máquina, lido dos logs do
// Claude Code (~/.claude/projects). Nada sai do computador; só lê. A saída se lê sem o agente traduzir.
//   node <PASTA-LICOES>/economia.js               → antes × depois da data das boas-vindas do meu/PERFIL.md
//   node <PASTA-LICOES>/economia.js 2026-09-13    → antes × depois desta data
//   node <PASTA-LICOES>/economia.js --lista       → e cada volta fria, uma por linha
//   node <PASTA-LICOES>/economia.js --tecnico     → a saída de medição (chamadas, US$ por ralo, quanto um chat novo pouparia)
// Os dois ralos (09 §9.15 e §9.14): VOLTA FRIA — a mensagem que chega a um chat de 100 mil+ tokens depois
// de 60+ min parado e reescreve o cache inteiro; e CONVERSA ACIMA DE 200 MIL — cada chamada relê o que
// passou disso. Valores em US$ de API: a assinatura não publica o limite em tokens, mas gasta na mesma proporção.
// Preços: platform.claude.com/docs/en/about-claude/pricing, conferidos em 22/09/2026.
const fs = require('fs'), path = require('path'), os = require('os');
// [trecho do nome do modelo, US$ por milhão de entrada, de leitura de cache] — saída = 5× a entrada
const PRECOS = [['fable-5-1', 10, 0.25], ['fable', 10, 1], ['opus-5-5', 4, 0.2], ['opus', 5, 0.5],
  ['sonnet-5', 2, 0.2], ['sonnet', 3, 0.3], ['haiku', 1, 0.1]];
const preco = m => PRECOS.find(([k]) => (m || '').includes(k)) || [null, 0, 0];
const ctx = u => (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
const fatorEscrita = u => ((u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0) > 0 ? 2 : 1.25;
const custo = c => { const [, e, l] = preco(c.model), u = c.u;
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

const args = process.argv.slice(2);
let data = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (!data) try {  // a data das boas-vindas: é quando a pasta chegou a esta pessoa
  const m = fs.readFileSync(path.join(__dirname, 'meu', 'PERFIL.md'), 'utf8')
    .match(/Boas-vindas da pasta\**\s*\|\s*(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/);
  if (m) data = m[1].includes('/') ? m[1].split('/').reverse().join('-') : m[1];
} catch {}
const DIVISA = data ? Date.parse(data + 'T00:00:00') : Infinity;
const novo = () => ({ dias: new Set(), chamadas: 0, usd: 0, frias: 0, friasUsd: 0, poupavel: 0, acima: 0, acimaUsd: 0 });
const P = { antes: novo(), depois: novo() }, lista = [];

const raiz = path.join(os.homedir(), '.claude', 'projects');
if (!fs.existsSync(raiz)) { console.log('sem logs do Claude Code nesta máquina (~/.claude/projects)'); process.exit(0); }
for (const proj of fs.readdirSync(raiz).filter(p => !/-Temp-|-tmp-/i.test(p))) {  // pastas de teste ficam de fora
  const dir = path.join(raiz, proj);
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
