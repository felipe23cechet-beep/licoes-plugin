---
name: uninstall
description: Desinstala o plugin licoes SEM deixar rastro — o que ele gravou na máquina, nas configurações, nos CLAUDE.md, na memória e nos projetos, e depois o próprio plugin. Use quando a pessoa pedir para desinstalar ou remover as lições ou o plugin licoes.
---

A pessoa quer que, depois disto, o Claude Code dela fique como se nunca tivesse usado o plugin: nem arquivo, nem
configuração, nem regra ou hábito que veio dele. Siga na ordem. Não apague nada antes do passo 3.

## 1. Levante tudo (só leitura)

Procure, e anote cada achado com o caminho e uma linha do que é:

1. **Pastas e arquivos do plugin em `~/.claude/`:** `licoes/` (inteira), `licoes-maquina.txt`, e em `ganchos/`:
   `destilar/`, `rotinas/`, `limites.json`, `so-o-que-usa.json`.
2. **A biblioteca de skills, `~/.claude/biblioteca/`:** as skills que estão ali foram TIRADAS de `~/.claude/skills/` pelo
   plugin. Elas são da pessoa: **voltam** para `~/.claude/skills/`, não se apagam. O `CATALOGO.md` de lá e a skill
   `~/.claude/skills/biblioteca/` são do plugin.
3. **Configurações** — `~/.claude/settings.json`, `~/.claude/settings.local.json`, e o `.claude/settings.json` e
   `.claude/settings.local.json` de cada projeto em que a pessoa trabalha (as pastas onde a pessoa abriu o Claude Code):
   - `statusLine` ou `hooks` cujo comando cite `licoes`, `destilar-licoes`, `chat-parado`, `rotinas.js` ou `statusline.js`;
   - `extraKnownMarketplaces.licoes`, `enabledPlugins["licoes@licoes"]` e a configuração do plugin (a chave de licença);
   - permissões (`permissions.allow`) que citem esses scripts ou as ferramentas `mcp__plugin_licoes_`;
   - nos `settings.local.json` dos projetos, o corte feito pelo plugin: skills em `"off"` ou `"name-only"` e plugins
     desligados que a pessoa não pôs lá. Desfazer = tirar a entrada, para voltar ao padrão.
4. **Os CLAUDE.md** — o global (`~/.claude/CLAUDE.md`) e o de cada projeto: linhas que citem as lições, o plugin, os
   comandos `/licoes:…`, `/panel`, `/idea`, `/pass-baton`, o `.passa-bastao.md`, ou que tenham sido escritas para
   seguir uma lição (citam o ponteiro de uma lição, ou a pessoa confirma que vieram daí).
5. **TODA a memória que veio do plugin** — a memória de cada projeto, `~/.claude/projects/*/memory/` (todos os projetos,
   não só o aberto): arquivo e linha do `MEMORY.md` que cite as lições, o plugin ou os comandos dele, que guarde uma regra
   ou um hábito que veio de uma lição (cita o ponteiro, o tema, ou repete o que uma lição diz), ou que o plugin gravou
   sozinho. E a memória do próprio plugin: `~/.claude/licoes/meu/` (as lições tiradas dos chats).
6. **Nos projetos:** `.passa-bastao.md`, `LICOES-APLICADAS.md` e `IDEIAS.md` (este, do comando `/idea`).

## 2. Mostre a lista

Mostre tudo o que achou, agrupado como acima. **Tudo sai, memórias inclusive**: o Claude Code tem de ficar como se nunca
tivesse usado o plugin, sem regra, hábito ou lembrança que veio dele. Só ofereça, antes, salvar uma cópia **fora do Claude**
(na Área de Trabalho, por exemplo) do que guarda trabalho da pessoa — o `~/.claude/licoes/meu/` e o `IDEIAS.md`. A cópia é
um arquivo solto: nenhum CLAUDE.md, memória ou configuração aponta para ela. Linha que você não sabe se veio do plugin:
pergunte, uma por uma.

## 3. Com o sim da pessoa, remova

- Edite os JSON com cuidado: tire só as entradas achadas (edição pontual, nunca o arquivo reescrito de memória), e confira que o
  arquivo continua JSON válido.
- Nos CLAUDE.md e na memória, tire só as linhas achadas; arquivo que ficar vazio sai, e a linha dele no `MEMORY.md` também.
- As skills da biblioteca voltam para `~/.claude/skills/` ANTES de a pasta `biblioteca/` sair: **mova a pasta inteira** de cada
  skill (`mv`), nunca a recrie escrevendo o arquivo — a skill é da pessoa, e reescrita perde o que ela tinha. Depois, confira que
  cada uma chegou com os mesmos arquivos.
- Comando ou escrita barrada por permissão: peça à pessoa para aprovar e refaça o MESMO passo; nunca troque por outro jeito
  que contorne a trava.
- Por último, com todo o resto já feito, rode estes dois, **cada um sozinho numa chamada** (nunca junto com outro comando:
  se a pessoa recusar a permissão de um, o resto não pode ir junto):

```
claude plugin uninstall licoes@licoes
claude plugin marketplace remove licoes
```

  (o `uninstall` apaga também os dados do plugin em `~/.claude/plugins/data/`; não use `--keep-data`).

## 4. Confira e diga

Procure de novo por `licoes` em `~/.claude/` (o histórico das conversas fica como está) e nos
CLAUDE.md e settings dos projetos. Diga à pessoa, em poucas linhas: o que saiu, o que ficou por escolha dela, e que
ela feche e abra o Claude Code. Desinstalar não cancela a assinatura: isso se faz pelo link do recibo.
