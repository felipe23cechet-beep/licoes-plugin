const fs = require('fs'), path = require('path'), os = require('os');
const LINGUA = 'pt';
const CHAT_NOVO = 150000;
const ARQ = process.env.LIMITES_ARQ || path.join(os.homedir(), '.claude', 'ganchos', 'limites.json');

function limites(r) {
  const agora = Date.now() / 1000, saida = {};
  for (const [nome, j] of Object.entries(r || {}))
    if (j && typeof j.used_percentage === 'number' && !(j.resets_at && j.resets_at < agora)) saida[nome] = { pct: j.used_percentage, volta: j.resets_at };
  return saida;
}

function linha(ev) {
  const c = ev.context_window || {}, u = c.current_usage || {};
  const ctx = c.total_input_tokens || (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const k = Math.round(ctx / 1000);
  const partes = [`ctx ${k} mil` + (ctx >= CHAT_NOVO ? (LINGUA === 'en' ? ' — new chat?' : ' — chat novo?') : '')];
  const lim = limites(ev.rate_limits);
  if (Object.keys(lim).length) {
    try { fs.mkdirSync(path.dirname(ARQ), { recursive: true }); fs.writeFileSync(ARQ, JSON.stringify({ gravado: Date.now(), ...lim })); } catch {}
    const nomes = { five_hour: '5h', seven_day: LINGUA === 'en' ? 'week' : 'semana', spend_limit: LINGUA === 'en' ? 'spend' : 'gasto' };
    partes.push((LINGUA === 'en' ? 'limit ' : 'limite ') + Object.entries(lim).map(([n, j]) => `${nomes[n] || n} ${Math.round(j.pct)}%`).join(' · '));
  }
  const modelo = (ev.model && (ev.model.display_name || ev.model.id)) || '';
  if (modelo) partes.push(modelo);
  return (LINGUA === 'en' ? 'lessons · ' : 'lições · ') + partes.join(' · ');
}

module.exports = { limites, linha };
if (require.main === module) {
  let entrada = '';
  process.stdin.on('data', d => entrada += d).on('end', () => {
    let ev = {}; try { ev = JSON.parse(entrada); } catch {}
    try { process.stdout.write(linha(ev)); } catch { process.stdout.write('lições'); }
  });
}
