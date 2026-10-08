# Licenças das skills e dos ganchos de terceiros que esta pasta distribui

🔴 **Por que este arquivo existe.** Cinco das skills de `modelos/skills/` são **cópias adaptadas**
de arquivos publicados por outras pessoas sob a licença **MIT**. A MIT permite usar, copiar,
modificar, **vender** e redistribuir — com **uma** condição: *o aviso de copyright e o texto da
licença acompanham qualquer cópia ou parte substancial da obra*. Este arquivo é esse aviso, e
**precisa viajar junto com a pasta**.

*(Conferido pela API do GitHub em 15/09/2026 e de novo em 23/09/2026, repositório por repositório.)*

| Skill nesta pasta | Vem de | Titular do copyright | Licença |
|---|---|---|---|
| `grill-me` | `mattpocock/skills` | Copyright (c) 2026 Matt Pocock | MIT |
| `handoff` | `mattpocock/skills` | Copyright (c) 2026 Matt Pocock | MIT |
| `diagnosing-bugs` | `mattpocock/skills` | Copyright (c) 2026 Matt Pocock | MIT |
| `find-skills` | `vercel-labs/skills` | Copyright (c) 2026 Vercel, Inc. | MIT |
| `emil-design-eng` | `emilkowalski/skills` | Copyright (c) 2026 Emil Kowalski | MIT |
| gancho `modelos/ganchos/config-protection.js` | `affaan-m/ECC` | Copyright (c) 2026 Affaan Mustafa | MIT |
| ganchos `modelos/ganchos/segredo-no-commit.js` e `modelos/ganchos/tela/`; `modelos/biblioteca/` | `vijcoelho/project-helena` (a Helena, commit `c356888`) | Copyright (c) 2026 Vitor Coelho | MIT |

⚠️ **O que foi mudado em cada uma está em [`CREDITOS.md`](CREDITOS.md).** Em algumas, o corpo é
quase todo do autor original — medido em 15/09/2026: na `find-skills`, **91 das 96 linhas** são
idênticas às da origem. É justamente por isso que o aviso abaixo é obrigatório.

🔎 **As skills escritas aqui** (`auditar-skill`, `auditoria-seguranca`, `critico-cego`, `imagem-de-venda`) não entram
nesta lista: o texto é próprio. A `critico-cego` **destila o método** de duas skills de terceiros
(`NicholasSpisak/gauntlet-loop`, MIT, Nicholas Spisak, e `chaseai-yt/claudex-loop`, MIT, Chase AI) sem
copiar texto delas — método e ideia não são cobertos por copyright, e o crédito está no
`CREDITOS.md`. ⚠️ *Até 15/09/2026 o `claudex-loop` não declarava licença; em 23/09/2026 o `LICENSE` dele
é MIT. Se um dia entrar texto de qualquer uma das duas, o titular vai para a tabela acima.*

---

## O texto da licença MIT

O mesmo texto vale para os repositórios acima, cada um com o seu titular:

```
MIT License

Copyright (c) 2026 Matt Pocock
Copyright (c) 2026 Vercel, Inc.
Copyright (c) 2026 Emil Kowalski
Copyright (c) 2026 Affaan Mustafa
Copyright (c) 2026 Vitor Coelho

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## A regra, para quando entrar uma skill nova

🔴 **Antes de copiar qualquer arquivo de terceiro para `modelos/skills/`:**

1. **Leia a licença no repositório de origem** — `gh api repos/<dono>/<repo>/license --jq '.license.spdx_id'` responde em uma chamada.
2. **MIT, Apache 2.0, BSD:** pode entrar, **e o titular vai para a tabela acima** — copie a linha `Copyright (c)` do `LICENSE` de lá, não invente.
3. **Sem licença declarada, ou licença que proíbe uso comercial** (CC-BY-NC, por exemplo): **não copie o arquivo.** Instale pelo comando do fornecedor, ou reescreva o método com texto próprio e dê o crédito.
4. **CC-BY:** pode, com atribuição visível — e diga a versão da licença.
