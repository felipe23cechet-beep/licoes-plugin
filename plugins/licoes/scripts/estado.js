#!/usr/bin/env node
// Início de sessão: a assinatura está em dia? há plugin novo? O servidor responde em até 3 s; fora do ar,
// UMA linha e segue — nunca trava a sessão (CLAUDE.md do serviço, "degradar, nunca travar").
// O que este gancho imprime entra no contexto do Claude: só escreve quando há algo a dizer.
const URL = 'https://licoes-servico.vercel.app/api/estado';
const versao = require('../.claude-plugin/plugin.json').version;
const chave = process.env.CLAUDE_PLUGIN_OPTION_CHAVE || '';
const menor = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); return false; };

(async () => {
  if (!chave) { console.log('[lições] Sem chave de licença: as lições estão desligadas (o economia.js funciona). Para ligar: /plugin → licoes → configurar.'); return; }
  try {
    const r = await fetch(URL, { headers: { Authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(3000) });
    const e = await r.json();
    if (e.aviso) console.log(`[lições] ${e.aviso} — diga isso à pessoa em uma linha e siga o trabalho.`);
    if (e.plugin && menor(versao, e.plugin)) console.log(`[lições] Há versão nova do plugin (${versao} → ${e.plugin}). Antes da tarefa, pergunte à pessoa se quer atualizar agora; se sim: "claude plugin update licoes@licoes" e depois /reload-plugins.`);
  } catch {
    console.log('[lições] O servidor das lições não respondeu agora: siga sem elas e avise a pessoa em uma linha.');
  }
})();
