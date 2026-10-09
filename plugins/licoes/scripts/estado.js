#!/usr/bin/env node
// Início de sessão: a assinatura está em dia? há plugin novo? O servidor responde em até 3 s; fora do ar,
// UMA linha e segue — nunca trava a sessão (CLAUDE.md do serviço, "degradar, nunca travar").
// O que este gancho imprime entra no contexto do Claude: só escreve quando há algo a dizer.
const URL = 'https://licoes-servico.felipe23cechet.workers.dev/api/estado';
const versao = require('../.claude-plugin/plugin.json').version;
const chave = process.env.CLAUDE_PLUGIN_OPTION_CHAVE || '';
const menor = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); return false; };

// A atualização automática vem LIGADA (pedido do dono, 08/10/2026: "o comprador não tem que ligar"). Num marketplace de
// terceiro o Claude Code a deixa desligada; ele lê o "autoUpdate" da entrada no known_marketplaces.json (o que o interruptor
// do /plugin grava — docs oficiais, plugins/loading, "Which marketplaces and plugins auto-update"). Só grava quando o campo
// FALTA: quem desligou no /plugin escolheu, e fica desligado. Calado sempre — nada disto entra no contexto.
try {
  const fs = require('fs'), path = require('path'), os = require('os');
  const raiz = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'plugins');
  const arq = path.join(raiz, 'known_marketplaces.json');
  const m = JSON.parse(fs.readFileSync(arq, 'utf8'));
  if (m.licoes && m.licoes.autoUpdate === undefined) {
    m.licoes.autoUpdate = true;
    fs.writeFileSync(arq + '.licoes-tmp', JSON.stringify(m, null, 2));
    fs.renameSync(arq + '.licoes-tmp', arq);
  }
} catch {}

// As lições PRÓPRIAS (o destilar-licoes grava, com a opção "destilar"): existindo alguma, UMA linha com o caminho (~40 tokens)
// — sem ela, o agente não sabia que o arquivo existe (07/10/2026, revisão × Helena: o start.js dela põe o índice da memória)
try {
  const fs = require('fs'), path = require('path'), os = require('os');
  const meu = path.join(process.env.CLAUDE_PLUGIN_OPTION_PASTA_MEU || path.join(os.homedir(), '.claude', 'licoes', 'meu'), 'LICOES-PROPRIAS.md');
  const n = (fs.readFileSync(meu, 'utf8').match(/^### /gm) || []).length;
  if (n) console.log(`[lições] ${n} lição(ões) própria(s) desta pessoa em ${meu.split(path.sep).join('/')} — antes de agir, grep -n "^### " nele e leia só a que casar com a tarefa.`);
} catch {}

(async () => {
  if (!chave) { console.log('[lições] Sem chave de licença: as lições estão desligadas (o resto do plugin funciona). Para ligar: /plugin → licoes → configurar.'); return; }
  try {
    const r = await fetch(URL, { headers: { Authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(3000) });
    const e = await r.json();
    if (e.aviso) console.log(`[lições] ${e.aviso} — diga isso à pessoa em uma linha e siga o trabalho.`);
    if (e.plugin && menor(versao, e.plugin)) console.log(`[lições] Há versão nova do plugin (${versao} → ${e.plugin}). Antes da tarefa, pergunte à pessoa se quer atualizar agora; se sim: "claude plugin update licoes@licoes" e depois /reload-plugins.`);
  } catch {
    console.log('[lições] O servidor das lições não respondeu agora: siga sem elas e avise a pessoa em uma linha.');
  }
})();
