---
name: budget
description: Para onde foi o seu uso do Claude nos últimos dias — em dólar, por dia, projeto, modelo, chat e saída de ferramenta, os limites do plano e a maior alavanca. Aceita os dias (padrão 7) e "here" (só este projeto)
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/economia.js" --budget $ARGUMENTS`

Mostre isto à pessoa como veio. Não rode mais nada.
