---
name: tela
description: Liga a conferência de tela do plugin — no fim de todo turno que mexe em .html, .css, .tsx, .jsx, .vue, .svelte ou .astro, mede o contraste (WCAG AA, 1440 e 375 px) e o vazamento lateral no celular, e devolve o turno se achar problema. Use quando a pessoa pedir para ligar a conferência de tela, ou perguntar por que ela não roda.
---

A conferência já está no plugin, **desligada até instalar uma peça**: o `playwright-core` 1.63.0 (Apache-2.0, ~10 MB). Ele usa o
Edge ou o Chrome que já estão na máquina — **não baixa navegador**. Fica numa pasta do plugin que sobrevive às atualizações e some
se o plugin for desinstalado.

1. Diga isso à pessoa em duas linhas e pergunte se instala. Não → pare.
2. Sim → rode:

```
npm install --prefix "${CLAUDE_PLUGIN_DATA}" playwright-core@1.63.0
```

3. Confira que pegou (sai 1 e lista um texto ilegível — é o esperado; 2 = não achou o playwright):

```
node -e "require('fs').writeFileSync(require('os').tmpdir()+'/t.html','<p style=\'color:#bbb\'>oi</p>')" && CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/scripts/tela/confere-tela.mjs" "$(node -p "require('os').tmpdir()+'/t.html'")"
```

Vale do próximo turno em diante. Para desligar: apague a pasta `node_modules` dentro de `${CLAUDE_PLUGIN_DATA}`.
