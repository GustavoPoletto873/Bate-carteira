# Lastro — bate carteira Britech

Confere, título a título, o **VL Aplic.**, as **datas de emissão e vencimento** e o **emissor** da carteira
Britech contra:

1. a aba **WP_Termo** do workpaper do fundo (`BASE_VALOR_AQUISICAO`, `BASE_DATA_EMISSAO`, `BASE_DATA_VENCIMENTO`);
2. os **documentos da pasta de lastro e termo** do fundo (boletins de subscrição, termos, TCNC, boletas HTML,
   telas CETIP, deliberações, DOCX…).

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · framer-motion · pdf.js · SheetJS · ExcelJS.

## Rodar no computador

```bash
npm install
cp .env.example .env.local   # e preencha BRITECH_USUARIO e BRITECH_SENHA (Britech da Planner)
node scripts/importar-acessos-britech.mjs "G:\Drives compartilhados\Dados\Acessos\Acessos.xlsx"   # Britech das outras administradoras
npm run dev
```

Abra http://127.0.0.1:3000. O servidor escuta só no seu computador (ninguém da rede acessa).
O `npm install` também copia o worker e as fontes do pdf.js para `public/pdfjs` (`scripts/copiar-pdfjs.mjs`).

## Como usar

### Buscar no Drive e na Britech (padrão)

1. **Fundo**: busque pelo nome ou CNPJ. A lista vem dos `WP_<fundo>_<cnpj>.xlsm` de `_Workpapers` (e `_Workpapers\WPS`)
   da pasta do trimestre. O app lê a WP_Termo, o CNPJ e a data-base.
   Fundo que ainda não tem workpaper, mas tem a amostra (`_Amostra(s)\Amostra_<cnpj>_<fundo>.xlsx`), também aparece
   ("sem workpaper"): a amostra faz o papel da WP_Termo, a data-base vem do trimestre da pasta (ex.: 2T2026 → 30/06/2026)
   e a validação da carteira fica de fora (não há a aba carteiraInforme).
2. **Carteira**:
   - *API Britech*: o app procura o CNPJ ao mesmo tempo na Britech de todas as administradoras configuradas
     (`Fundo/BuscaCarteiraClientePorCPFCNPJ`), mostra em qual achou e, ao conferir,
     baixa o relatório Composição da Carteira na data-base (`Relatorio/RelatorioComposicaoCarteira`, Excel alinhado);
   - *Arquivo no Drive*: o `<id>_<cnpj>_<dd.mm.aaaa>_BRITECH.xlsx` de `_Carteiras\FORMATADA\<data>` ou, nas
     administradoras sem Britech (Fromtis, Sinqia, MAPS…), a **amostra** (`_Amostra\Amostra_<cnpj>_<fundo>.xlsx`) ou o
     **estoque** (`_Insumos\…\<cnpj>_Estoque_Agrupado_<fundo>.xlsx`, `Estoques\…csv`) do fundo, achados pelo CNPJ ou
     pelo nome. Fundo de recebíveis (WP_Termo com sacado/cedente) começa na amostra. Estoque com mais de 1.500 itens:
     só os recebíveis que estão na WP_Termo são conferidos.
3. **Lastro e termo**: o app sugere a pasta de `Lastro e Termo` com nome mais parecido com o do fundo
   (dá para trocar na lista) e lista os arquivos.
4. **Conferir** → resultado na tela → **Baixar Excel com as evidências**.

O resumo tem três blocos, cada um expansível:

- **Precisam de atenção**: divergem dos documentos ou da WP_Termo, ou falta confirmar; uma linha por campo
  (carteira × documentos). Em "Detalhes", cada campo mostra o valor da carteira, o porquê numa frase, onde ele aparece
  (arquivo e página, com "abrir" que leva o Bater PDF direto para lá) e os outros valores que os documentos trazem; as
  comparações e evidências completas ficam em "Ver todas".
- **Validados**: conferem em tudo. Os que têm o valor e a data de emissão batendo ficam **validados visualmente** e
  aguardam a aprovação do analista ("Aprovar" ou "Aprovar todos"; dá para desfazer). No Excel, o aprovado sai como
  "OK (aprovado pelo analista)".
- **Pendentes**: nenhum documento da pasta cita o título.

Quando o trimestre tem várias administradoras (`…\2T2026\PLANNER`, `…\2T2026\ID`…), escolha a administradora na
tela. A pasta de lastro pode se chamar `Lastro e Termo` ou `_Lastro e Termo`. A pasta padrão (`LASTRO_DRIVE_BASE`)
também pode ser trocada na tela.

### Escolher arquivos

Para quando o Drive não está acessível pelo servidor (ex.: na Vercel): escolha o workpaper, a carteira e a pasta
no seu computador (ou arraste). No Chrome e no Edge cada escolha fica lembrada ("Usar a última"). A carteira também
pode vir da **API Britech**, se o servidor tiver as credenciais.

### Pasta deste computador (padrão na Vercel)

Cada pessoa da equipe tem o `G:` no próprio computador. Em "Ler o Drive por: **Pasta deste computador**", a pessoa
escolhe uma vez a pasta do trimestre (ex.: `…\2026\2T2026`, com uma pasta por administradora) ou a de uma
administradora (`…\2T2026\PLANNER`), e o navegador faz a mesma busca automática: fundos, pasta de lastro sugerida e carteira em `FORMATADA`. Nada sai do
computador — só a carteira vem da Britech. Nas próximas vezes: "Usar a última". Funciona no Chrome e no Edge.

### Só a rede do escritório

Com `LASTRO_IPS_PERMITIDOS` (ex.: `203.0.113.10` — use o IP público da internet do escritório) o app publicado só abre
para quem vem desses IPs — página, arquivos e rotas `/api`. Quem está fora vê "Acesso restrito" com o próprio IP (para
liberar, se for o caso). Dentro da rede liberada a chave de acesso não é pedida. Se o escritório tiver mais de um link
de internet ou IP que muda, liste todos (ou a faixa, em CIDR).

### Onde roda o quê

- O servidor do app (rotas `/api`) lê o `G:` e chama a Britech com as credenciais de `.env.local`.
- Na Vercel, o navegador lê a pasta do `G:` escolhida por quem usa (sem passar pelo servidor).
- A leitura dos PDFs, a conferência e o Excel acontecem no navegador.

### Recebíveis (amostra/estoque)

Com amostra ou estoque, cada linha é um recebível (duplicata, CCB, nota comercial…) e o "emissor" conferido é o
**sacado**. A duplicata traz o **valor de face** (`VALOR_NOMINAL`), não o de aquisição: o app liga o documento pelo
valor de face (ou de aquisição) ou pelo **número do documento** (`NU_DOCUMENTO`), e a folha de assinatura/termo de
cessão vem junto pelo identificador no nome do arquivo (`duplicata_assinada<id>.pdf` ↔ `folha_assinatura<id>.pdf`).
Como a duplicata traz as datas em tabela, longe do rótulo, a data exata num documento ligado ao recebível confere; se
não estiver lá, o app mostra a data mais próxima do documento e a diferença em dias. Documento que só cita o cedente
deixa o sacado "Verificar". A WP_Termo continua conferida pelo valor de aquisição.

### De onde vem a carteira de cada fundo (Monday)

Com `MONDAY_API_TOKEN`, o app procura o CNPJ no board de lastro do Monday e mostra a **administradora**, o **sistema**
e o código da **carteira**, e usa isso para escolher a fonte:

| No Monday | Carteira no app |
|---|---|
| Britech (ID, Planner…) | API Britech, com a carteira do Monday |
| Sinqia (Azumi) | Sinqia (posição da carteira); por recebível, amostra/estoque |
| Intra, Limine, Finvest | a administradora envia a carteira: validação pela aba carteiraInforme do WP + estoque do Drive |
| MAPS | só pela VPN (máquina com acesso); use o arquivo |
| AMPLIS | sem integração; use o arquivo |
| QI Tech, BlueWave | só validação de estoque — fora do escopo do app (as pastas nem aparecem na lista) |

### Validação da carteira (como a aba CVM do workpaper)

Quando o workpaper tem a aba **carteiraInforme** (a carteira enviada pela administradora, classificada nas categorias
do informe da CVM), o resultado traz a mesma validação da aba CVM: composição da carteira e soma das categorias × PL;
**carteira × estoque** (DC vincendos e vencidos × soma do valor presente do estoque por situação, PDD × `VALOR_PDD`,
tolerância de R$ 1,00); a **amostra** da WP_Termo por categoria (coluna "Amostra") com a representatividade no PL; e a
contagem V/P da WP_Termo e da WP_Lastro. Se a carteira conferida é a amostra, o app lê também o estoque do Drive só para
essa validação. Fica na aba **Validação da carteira** do Excel (não aparece na tela, para não poluir o resumo).

### Posição da carteira pelo Sinqia

`SINQIA_<ADM>_URL`, `_TOKEN_URL`, `_USUARIO` e `_SENHA`: token no Keycloak e
`/api/v1/carteiras/{carteira}/relatorios/posicao/carteirac` (o mesmo do boleta_sinqia). A posição traz os títulos de
renda fixa; os direitos creditórios vêm só em totais.

**Em stand-by:** o servidor do Sinqia recusa pedidos vindos da Vercel (firewall, HTTP 403), então o app não oferece o
Sinqia e trata os fundos dele como "arquivo" (amostra/estoque do Drive). No computador do escritório dá para ligar com
`LASTRO_SINQIA_ATIVO=1`.

### Estoque pelo Fromtis (API SOAP)

Para as administradoras com o webservice do Fromtis (Azumi, Finvest, Limine, FIDD — o mesmo que o hub usa em
"Extrair relatórios DC Fromtis"), o cartão Carteira ganha a opção **Fromtis**: ao conferir, o app agenda o relatório de
estoque do CNPJ na data-base, espera ficar pronto (até ~90 s), baixa o ZIP e lê o CSV (mesmo layout do
`Estoque_Agrupado`; estoque grande confere só os itens da WP_Termo). Configure `FROMTIS_<ADM>_URL`, `_USUARIO` e `_SENHA`
(usuário e senha vão nos cabeçalhos HTTP, como no hub). Login recusado pausa a administradora por 15 min.
O usuário precisa do perfil de acesso ao webservice na administradora: sem ele o login passa, mas o agendamento volta
"Usuário não tem perfil de acesso ao webServices" (o app diz isso no erro). O Fromtis responde normalmente a partir da Vercel.

### Comparação com origem e "Provável"

Os dados nem sempre vêm no campo certo (ex.: o valor nominal da amostra é o "valor de aplicação" do documento). Por
isso a conferência também aproxima: cruza todo valor e data da carteira (e da WP_Termo), com o nome da coluna de onde
veio, contra todo valor e data dos documentos ligados ao título, com o **rótulo** que vem antes ("valor total da
emissão", "data de desembolso"…) e a **página**. Cada par sai como *igual*, *campo diferente*, *sem rótulo*,
*aproximado* (até 0,5% ou 31 dias) ou *calculado*. Quando a regra campo a campo não acha, mas a comparação deduz o
valor/data, o campo fica **Provável** (com a origem na nota); documentos que discordam entre si continuam "Verificar".
Data com rótulo diferente da carteira, mas com a data da carteira no documento (ex.: parcela de Nota Comercial: o termo
rotula o vencimento final e a parcela está no cronograma), fica "Verificar", não "Divergente".
Tudo aparece em "Comparações" no resultado e na aba **Comparações** do Excel.

### Títulos com taxa (Nota Comercial, CCB, CRI…)

Quando a descrição do ativo ou o documento traz "% do CDI + x% a.a." (ou prefixado a.a./a.m.), o app tenta chegar ao
valor da carteira pela conta: principal do documento × fator do CDI (série diária do Banco Central, buscada pela rota
`/api/indices/cdi`) da emissão até a aquisição (→ VL Aplic.) ou até a data-base (→ valor presente). Aceita até 0,2% de
diferença e mostra a conta inteira. A taxa da descrição do ativo na carteira manda; IPCA/IGP-M não são calculados.

### Bater PDF

Como no bate-lastro: **Buscar nos PDFs** (ou **Bater PDF** numa pendência) procura um texto, valor ou data em todos os
documentos lidos (sem acento/maiúsculas; "1234,56" acha "1.234,56"), mostra a página com o termo destacado e permite
**vincular** a pendência ao documento campo a campo — V (confere), D (divergente), P (sem valor no documento). A marca
de quem confere vale mais que a automática e entra no resumo e no Excel.

### Pré-classificação das pendências

Adaptada da branch `feat/pre-classificacao-bater-pdf` do bate-lastro. **Pré-classificar pendências** analisa todas as
pendências de uma vez e sugere, para cada uma, o documento (a página ou a linha da tabela do termo/borderô), a
**confiança** (alta, média, baixa, ambígua, sem candidato) e a marca de cada campo — V, D (com o valor do documento) ou
P (não achado) —, com a evidência e a regra. A conferência é em lote: os títulos com o mesmo motivo ficam no mesmo grupo
("Tudo confere", "o documento traz outro Vencimento", "Sacado: o termo da duplicata não traz — vale a carteira"…),
separados em **Para decidir** (nada vem marcado) e **Prontos para aplicar** (já vêm marcados). Cada cartão mostra o
recorte do PDF com os valores destacados e os campos clicáveis procuram o valor nos PDFs. **Nada é gravado sem clique**:
"Aplicar" grava as marcas como os vínculos do Bater PDF.

O motor (`lib/lastro/pre-classificacao.ts`, `lib/lastro/formas.ts`) reconhece as formas de impressão (datas por extenso,
moeda BR/US, CPF/CNPJ com o zero perdido, número com o sufixo da parcela, códigos alfanuméricos), acha as âncoras do
título (número, CPF/CNPJ, valor), escolhe a linha da tabela quando a página tem vários títulos, ignora listagens de muitos
devedores e o bilhete de seguro prestamista e aplica as regras do bate-lastro (CNPJ da mesma raiz, vencimento um dia
antes, parcela do cronograma, nome parcial ao lado do CPF, nome cortado na carteira, termo de duplicata sem o sacado).
Fica de fora o que lá depende do banco: leituras de IA, outras bases do fundo e o aprendizado com o que o time já conferiu.

### Como os documentos são ligados a cada título

- **direto**: o documento traz o VL Aplic. exato (tolerância de R$ 0,01);
- **mesma operação**: mesmo número de operação no nome do arquivo de um documento direto
  (ex.: `12692_BS_…` e `789771_12692_Term_…`), o código do ativo (ex.: código CETIP do CRI) ou o nome do
  emissor + o mesmo número de emissão (`2E` na Britech = "2ª emissão" no documento);
- **mesmo emissor**: só o nome do emissor (usado quando os níveis acima não trazem a data).

As datas só contam quando vêm logo depois de um rótulo ("Data de Emissão", "vencimento em",
"vencendo-se, portanto, em"…). Se outro rótulo aparece no meio, a data é descartada.

| Situação | Quando |
|---|---|
| OK | valor, datas e emissor conferem com os documentos (e com a WP_Termo, se o título estiver lá) |
| Divergente | algum campo diverge dos documentos ou da WP_Termo |
| Verificar | documentos não concordam entre si, data sem rótulo, ou só há documentos do mesmo emissor |
| Sem documentos | nada na pasta traz o valor nem cita o emissor |
| Só no WP | linha da WP_Termo sem título correspondente na carteira |

## Variáveis de ambiente

Veja `.env.example`.

| Variável | Para quê |
|---|---|
| `BRITECH_USUARIO`, `BRITECH_SENHA` | credenciais da API da Britech (segredo) |
| `BRITECH_URL` | padrão `https://delta.britech.com.br/WS/api` (Britech da Planner) |
| `BRITECH_<ADM>_URL`, `_USUARIO`, `_SENHA` | Britech de cada administradora (ID, INTRA, FINVEST, ATIVA, AMERICA, VERT, MFPEPPER, RJI, GUIDE…), gerados por `scripts/importar-acessos-britech.mjs` (segredo) |
| `MONDAY_API_TOKEN` (e `LASTRO_MONDAY_BOARD`) | ler o board de lastro do Monday: administradora, sistema e carteira de cada fundo (segredo) |
| `SINQIA_<ADM>_URL`, `_TOKEN_URL`, `_USUARIO`, `_SENHA` | posição da carteira pelo Sinqia da administradora (segredo) |
| `LASTRO_SINQIA_ATIVO` | `1` liga o Sinqia (em stand-by; só funciona da rede do escritório) |
| `FROMTIS_<ADM>_URL`, `_USUARIO`, `_SENHA` | webservice do Fromtis de cada administradora, para o estoque de recebíveis (segredo) |
| `LASTRO_DRIVE_BASE` | pasta do trimestre no Drive |
| `LASTRO_DRIVE_RAIZES` | raízes que o servidor pode ler (padrão `G:\Drives compartilhados`) |
| `LASTRO_IPS_PERMITIDOS` | IPs públicos (ou faixas CIDR) que podem abrir o app publicado; quem vem deles não precisa da chave |
| `LASTRO_CHAVE_ACESSO` | chave exigida pelas rotas `/api` fora do seu computador e fora da rede liberada (segredo) |

## Publicar na Vercel

1. Suba o repositório para o GitHub e importe o projeto na Vercel (framework: Next.js).
2. Em Settings → Environment Variables, cadastre as credenciais da Britech e **`LASTRO_IPS_PERMITIDOS`** (o IP do
   escritório). Opcional: `LASTRO_CHAVE_ACESSO` (para quem precisar entrar de fora da rede). Sem IP liberado nem chave, as rotas da Britech ficam fechadas.
3. Deploy. Na tela, clique em **Escolher pasta** e escolha a pasta do trimestre no `G:`.

Na Vercel o `G:` não existe para o servidor: o Drive é lido pelo navegador de cada pessoa (pasta do computador).
As funções rodam em São Paulo (`gru1`, no `vercel.json`): sistemas que só aceitam IPs do Brasil recusam pedidos da região
padrão da Vercel (EUA). Se um sistema só aceitar IPs liberados (ex.: o do escritório), a API dele não vai responder a
partir da Vercel; o erro mostra quem bloqueou e de que região saiu o pedido.

## Testes

```bash
npm test
```

Teste opcional com arquivos reais (não roda no `npm test`; os arquivos do fundo não ficam no repositório):

```bash
LASTRO_WP="…/WP_x.xlsm" LASTRO_CARTEIRA="…/x_BRITECH.xlsx" LASTRO_PASTA="…/Lastro e Termo/X" npm run test:real
```

## Estrutura

- `components/ui/prisma-hero.tsx`: hero (design Prisma), com props para título, texto, menu e botão.
- `components/conferencia/`: modos de fontes (`fontes-auto`, `fontes-manuais`), resultado e inventário.
- `app/api/`: rotas do servidor — `status`, `drive/*` (administradoras, fundos, lastro, listar, arquivo, carteira) e
  `britech/*` (carteiras, composicao).
- `proxy.ts`: na Vercel, só deixa entrar quem vem dos IPs de `LASTRO_IPS_PERMITIDOS`.
- `lib/servidor/`: configuração, trava de acesso, leitura do G: e cliente da Britech.
- `lib/lastro/`: a lógica da conferência, sem dependência de tela:
  `textos`, `documentos`, `extratores`, `planilhas`, `conciliacao`, `pipeline`, `fontes`, `servidor-cliente`,
  `drive-comum` (regras dos dois leitores de Drive), `drive-pasta` (pasta escolhida no navegador), `carteiras`.

## Limitações

- Sem OCR: PDF escaneado aparece no inventário como "sem texto".
- Arquivos compactados (.zip, .tgz, .7z) não são abertos: descompacte antes.
- PDFs longos: são lidas as 40 primeiras páginas (limite de 8 s por PDF).
