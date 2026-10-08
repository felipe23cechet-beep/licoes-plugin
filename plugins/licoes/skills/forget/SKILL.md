---
name: forget
description: Tira uma lição errada ou velha das suas lições próprias (ela vai para as esquecidas e volta com /licoes:undo licao <nº>)
argument-hint: "<nº da lição, ou parte do título>"
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(grep:*)
---

Tirar das lições próprias: $ARGUMENTS

1. É um número: rode `node "${CLAUDE_PLUGIN_ROOT}/scripts/destilar-licoes.js" --esquecer <nº> --meu '${user_config.pasta_meu}'` e diga o resultado em uma linha.
2. É texto: rode `node "${CLAUDE_PLUGIN_ROOT}/scripts/destilar-licoes.js" --status --meu '${user_config.pasta_meu}'` — a 1ª linha diz o arquivo das lições. Rode `grep -n "^### " "<arquivo>"`, mostre à pessoa as que
   batem com o pedido (título e nº) e pergunte qual tirar. Só com o nº dito por ela, o passo 1.
3. Nenhuma bate: diga isso em uma linha. Não edite o arquivo à mão.
