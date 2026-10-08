---
name: routines
description: Rotinas que rodam sozinhas de tempos em tempos (só leem, com teto de gasto) — listar, criar, tirar, ou rodar uma agora
argument-hint: "[o que fazer e de quanto em quanto tempo | tirar <nome> | agora <nome>]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/rotinas.js" --listar`

Acima, as rotinas da pessoa. Script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/rotinas.js"`. Pedido: $ARGUMENTS

- Erro de arquivo não achado: o `rotinas.js` não está instalado nesta máquina. Diga isso em uma linha e aponte o `FERRAMENTAS.md` da
  pasta de lições, a seção das rotinas. Não instale sem a pessoa pedir.
- Pedido vazio: mostre a lista como veio.
- "tirar <nome>" ou "agora <nome>": rode o script com `--tirar <nome>` (ou `--agora <nome>`) e diga o resultado em até cinco linhas.
- Qualquer outra coisa descreve uma rotina nova. Rode o script com
  `--nova <nome> <cada> "<pedido>" [--projeto "<pasta>"] [--teto <dólar>] [--meta "<objetivo>"]`:
  - nome: curto, minúsculo, com hífen;
  - cada: `12h`, `1d` ou `7d` ("toda segunda" é 7d, "todo dia" é 1d);
  - pedido: instrução completa, na língua da pessoa — a rotina roda depois, sem a memória deste chat, e só lê arquivos e a web;
  - projeto: a pasta atual, entre aspas, quando a rotina é sobre este projeto; senão, fica fora;
  - teto: só se a pessoa deu um valor (o padrão é US$ 0,25 por rodada);
  - meta: só se a pessoa disse aonde quer chegar.
  Mostre o resultado em uma linha. Não rode mais nada.
