---
name: biblioteca
description: A biblioteca de skills que não carregam em todo chat — ver o catálogo, guardar uma skill nela, ou trazer uma de volta
argument-hint: "[mover <nome...> | voltar <nome...> | catalogo | instalar] [--projeto]"
disable-model-invocation: true
allowed-tools: Bash(node:*), Read
---

Pedido: $ARGUMENTS

- Vazio: leia `~/.claude/biblioteca/CATALOGO.md` e mostre à pessoa o nome e a descrição de cada skill, uma por linha. Não existe?
  Diga que a biblioteca está vazia e que `/licoes:biblioteca mover <nome>` guarda nela uma skill que quase nunca é usada.
- Senão: rode `node "${CLAUDE_PLUGIN_ROOT}/scripts/biblioteca/biblioteca.js" $ARGUMENTS` e diga o resultado em uma linha. Pediu a skill
  `biblioteca` instalada? Rode antes o mesmo comando com `instalar`, e diga isso junto.
