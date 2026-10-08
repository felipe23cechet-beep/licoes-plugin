---
name: receitas
description: O roteiro de uma AÇÃO grande, na ordem, antes do primeiro arquivo — hoje, "criar um site" (site, landing page, página de venda, institucional, portfólio). Invoque sozinho, sem ser pedido, quando a pessoa pedir uma dessas ações inteira ("cria um site para mim", "quero uma landing page"); cada passo da receita vira item da lista de tarefas. NÃO invoque para ajuste num site que já existe nem para pergunta.
---

As lições estão por tema; a receita junta, na ordem em que se faz, o que elas dizem para a ação. Cada passo aponta a lição que o
sustenta — o detalhe vem dela, pela `buscar_licao`, só quando o passo chegar.

1. **A receita.** `buscar_licao` com `situacao: "Receita: criar um site"` (troque pela ação pedida). Volta a seção `Receita: …` com a
   linha **As fases** — os nomes de cada uma. Não voltou nenhuma `Receita:` → não há receita para essa ação: siga sem, e diga isso.
2. **As fases**, uma busca por fase, com o nome que a linha deu: `"Receita: criar um site, fase 2 — construir"`. O número sozinho não
   acha (a busca ignora números); o nome, sim. Cada passo da tabela (`1.1`, `2.3`…) vira item da lista de tarefas, **antes do primeiro
   arquivo**.
3. **O que esta pessoa já aprendeu.** Nos títulos das lições próprias, os temas que a receita cita na tabela do topo (site: 05, 07, 11):

   ```
   P='${user_config.pasta_meu}'; case "$P" in ''|'$'*) P="$HOME/.claude/licoes/meu";; esac
   grep -n "^### .*‹tema: \(05\|07\|11\)" "$P/LICOES-PROPRIAS.md"
   ```

   (A pasta vem da opção *"Pasta das lições próprias"* do plugin; vazia, é a padrão. O Bash não recebe as opções do plugin como
   variável de ambiente — por isso o valor está escrito aqui.)

   Título que toca a ação → leia só aquela lição (`sed -n`) e ela entra na lista como passo a mais, no lugar da fase onde cabe. Arquivo
   não existe → a pessoa ainda não tem lição própria; siga.
4. Passo que não se aplica (site sem formulário não abre as portas de login e banco) **sai da lista com o motivo**, e o motivo vai
   no resumo. No fim, o arquivo de estado do projeto diz o que foi feito de cada fase e o que ficou para a pessoa.

Uma receita custa 6 seções do dia (a receita e as 5 fases); o teto de seções novas por dia é bem maior, e as já recebidas não contam de novo.
