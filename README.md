# LIÇÕES GERAIS — plugin do Claude Code

A casca do serviço LIÇÕES GERAIS: conecta o Claude Code ao servidor das lições com a sua chave de assinatura.
As lições moram no servidor; este repositório não tem nenhuma.

Instalar (a chave vem no e-mail da compra):

```
claude plugin marketplace add felipe23cechet-beep/licoes-plugin
claude plugin install licoes@licoes
```

A atualização automática vem **ligada**: a versão nova chega até 10 minutos depois da 1ª mensagem de um chat e vale
no chat seguinte (ou com `/reload-plugins`). Para desligar: `/plugin` → aba **Marketplaces** → `licoes`. Para atualizar
na hora:
`claude plugin update licoes@licoes`.

Sem chave, o plugin traz o `economia.js`: quanto o contexto custou nesta máquina, lido dos registros locais.
