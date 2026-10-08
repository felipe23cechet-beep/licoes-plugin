---
name: comecar
description: Lê já os chats anteriores deste projeto (os 5 mais novos, ou os N que você disser) e tira as lições deles, em segundo plano
argument-hint: "[quantos chats, de 1 a 20]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/destilar-licoes.js" --comecar $ARGUMENTS --meu '${user_config.pasta_meu}'`

Diga à pessoa, em até duas linhas, o que saiu acima (quantos chats e o custo). Não rode mais nada.
