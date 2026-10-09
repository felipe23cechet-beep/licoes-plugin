---
name: economia
description: Mostra quanto o contexto custou nesta máquina — as voltas frias (chat grande retomado depois de parado) e as conversas acima de 200 mil tokens. Use quando a pessoa perguntar quanto gastou, por que o limite acaba rápido, ou pedir "economia". Funciona sem chave.
---

Rode e mostre a saída como veio (ela já é escrita para a pessoa ler):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/economia.js" --lista
```

Nada sai do computador: o script só lê `~/.claude/projects`. Se a pessoa der uma data (AAAA-MM-DD), passe-a como
primeiro argumento para comparar antes × depois dela.
