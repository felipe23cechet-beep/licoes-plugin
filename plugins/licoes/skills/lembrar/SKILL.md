---
name: lembrar
description: Grava agora uma lição que você dita — o que aconteceu e a regra que fica — nas suas lições próprias
argument-hint: "<o que aconteceu e o que fazer da próxima vez>"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Gravar nas lições próprias: $ARGUMENTS

1. Monte, do pedido e deste chat, o JSON `{"titulo": "...", "tema": "...", "aconteceu": "...", "regra": "..."}`:
   - titulo: a regra em até 8 palavras, na língua da pessoa;
   - aconteceu: o caso real, com o que custou (uma ou duas frases);
   - regra: o que fazer da próxima vez;
   - tema: o nº do arquivo da pasta de lições a que ela pertence (01 a 12), se for claro; senão, deixe "".
2. Falta o caso (a pessoa só deu a regra) e este chat não o mostra? Pergunte, em uma linha, o que aconteceu. Lição sem caso não grava.
3. Rode, com o JSON entre as linhas:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/destilar-licoes.js" --lembrar --meu '${user_config.pasta_meu}' <<'FIM'
   {"titulo": "...", "tema": "", "aconteceu": "...", "regra": "..."}
   FIM
   ```
4. Diga o resultado em uma linha. Recusou (título repetido, segredo, faltou campo)? Diga o motivo, e corrija só se for claro.
