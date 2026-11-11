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
cp .env.example .env.local   # e preencha BRITECH_USUARIO e BRITECH_SENHA
npm run dev
```

Abra http://127.0.0.1:3000. O servidor escuta só no seu computador (ninguém da rede acessa).
O `npm install` também copia o worker e as fontes do pdf.js para `public/pdfjs` (`scripts/copiar-pdfjs.mjs`).

## Como usar

### Buscar no Drive e na Britech (padrão)

1. **Fundo**: busque pelo nome ou CNPJ. A lista vem dos `WP_<fundo>_<cnpj>.xlsm` de `_Workpapers` (e `_Workpapers\WPS`)
   da pasta do trimestre. O app lê a WP_Termo, o CNPJ e a data-base.
2. **Carteira Britech**:
   - *API Britech*: o app acha as carteiras do CNPJ (`Fundo/BuscaCarteiraClientePorCPFCNPJ`) e, ao conferir,
     baixa o relatório Composição da Carteira na data-base (`Relatorio/RelatorioComposicaoCarteira`, Excel alinhado);
   - *Arquivo baixado*: o `<id>_<cnpj>_<dd.mm.aaaa>_BRITECH.xlsx` de `_Carteiras\FORMATADA\<data>`.
3. **Lastro e termo**: o app sugere a pasta de `Lastro e Termo` com nome mais parecido com o do fundo
   (dá para trocar na lista) e lista os arquivos.
4. **Conferir** → resultado na tela → **Baixar Excel com as evidências**.

A pasta do trimestre (padrão `LASTRO_DRIVE_BASE`) pode ser trocada na tela, em "Pasta do trimestre no Drive".

### Escolher arquivos

Para quando o Drive não está acessível pelo servidor (ex.: na Vercel): escolha o workpaper, a carteira e a pasta
no seu computador (ou arraste). No Chrome e no Edge cada escolha fica lembrada ("Usar a última"). A carteira também
pode vir da **API Britech**, se o servidor tiver as credenciais.

### Onde roda o quê

- O servidor do app (rotas `/api`) lê o `G:` e chama a Britech com as credenciais de `.env.local`.
- A leitura dos PDFs, a conferência e o Excel acontecem no navegador.

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
| `LASTRO_DRIVE_BASE` | pasta do trimestre no Drive |
| `LASTRO_DRIVE_RAIZES` | raízes que o servidor pode ler (padrão `G:\Drives compartilhados`) |
| `LASTRO_CHAVE_ACESSO` | chave exigida pelas rotas `/api` fora do seu computador (segredo) |

## Publicar na Vercel

1. Suba o repositório para o GitHub e importe o projeto na Vercel (framework: Next.js).
2. Em Settings → Environment Variables, cadastre `BRITECH_USUARIO`, `BRITECH_SENHA` e **`LASTRO_CHAVE_ACESSO`**.
   Sem a chave, as rotas do Drive e da Britech ficam fechadas — elas usam a sua conta Britech.
3. Deploy. Na tela, informe a chave uma vez (fica salva no navegador).

Na Vercel o `G:` não existe: o modo "Buscar no Drive" fica desligado e vale o "Escolher arquivos" (com a carteira pela
API Britech). Se a Britech só aceitar chamadas de IPs liberados, a API não vai responder a partir da Vercel.

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
- `app/api/`: rotas do servidor — `status`, `drive/*` (fundos, lastro, listar, arquivo, carteira) e
  `britech/*` (carteiras, composicao).
- `lib/servidor/`: configuração, trava de acesso, leitura do G: e cliente da Britech.
- `lib/lastro/`: a lógica da conferência, sem dependência de tela:
  `textos`, `documentos`, `extratores`, `planilhas`, `conciliacao`, `pipeline`, `fontes`, `servidor-cliente`.

## Limitações

- Sem OCR: PDF escaneado aparece no inventário como "sem texto".
- Arquivos compactados (.zip, .tgz, .7z) não são abertos: descompacte antes.
- PDFs longos: são lidas as 40 primeiras páginas (limite de 8 s por PDF).
