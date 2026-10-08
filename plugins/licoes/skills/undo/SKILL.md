---
name: undo
description: Desfaz o que a pasta de lições fez sozinha — a skill ‹auto› criada, a última linha aprendida, a poda, a junção, a lição esquecida
argument-hint: "[<skill> [aprendido|juntar|poda] | licao <nº>]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/destilar-licoes.js" --listar --meu '${user_config.pasta_meu}'`

Acima, o que dá para desfazer. Pedido: $ARGUMENTS

- Pedido vazio: mostre a lista como veio, e mais nada.
- Senão: rode `node "${CLAUDE_PLUGIN_ROOT}/scripts/destilar-licoes.js" --desfazer $ARGUMENTS --meu '${user_config.pasta_meu}'` e diga o resultado em uma linha. Não rode mais nada.
