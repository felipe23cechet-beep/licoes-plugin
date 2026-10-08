---
name: status
description: O que a pasta de lições já sabe — lições próprias, as ‹auto› esperando, biblioteca, rotinas, custo da semana e novidades
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/destilar-licoes.js" --status --meu '${user_config.pasta_meu}'`

Mostre isto à pessoa como veio. Não rode mais nada.
