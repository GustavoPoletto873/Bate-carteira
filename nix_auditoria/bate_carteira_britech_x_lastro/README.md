# Bate Carteira Britech x Lastro

Confere, para cada título da carteira Britech do fundo, o **VL Aplic.**, as **datas de emissão e
vencimento** e o **nome do emissor** contra:

1. a aba **WP_Termo** do workpaper do fundo (`BASE_VALOR_AQUISICAO`, `BASE_DATA_EMISSAO`,
   `BASE_DATA_VENCIMENTO`) — o valor aplicado deve bater com o valor de aquisição;
2. os **documentos da pasta de lastro e termo** do fundo (boletins de subscrição, termos de emissão,
   TCNC, boletas HTML, telas CETIP, deliberações, DOCX...).

- **Setor:** `nix_auditoria`
- **Responsável (setor):** Gustavo Poletto (Auditoria de Lastro)

## Como usar

1. Informe o caminho do **workpaper** (`WP_<fundo>_<cnpj>.xlsm`) e clique em **Ler workpaper**: o app
   mostra fundo, CNPJ, data-base e quantas linhas a WP_Termo tem, e já procura a carteira Britech.
2. Informe a **pasta de lastro e termo** do fundo. Os dois caminhos podem ser trocados à vontade e
   ficam lembrados no seu navegador.
3. Escolha a **carteira Britech**:
   - *Arquivo da carteira*: o `<ID>_<CNPJ>_<dd.mm.aaaa>_BRITECH.xlsx` que o Gerar Amostras Planner grava em
     `_Carteiras\FORMATADA\<data>` (achado sozinho), outro caminho, ou o Excel exportado do PAS enviado pela tela;
   - *Buscar direto na Britech (API)*: relatório Composição da Carteira da Britech Planner (`delta`)
     na data-base, pelo ID da carteira (achado pelo nome do arquivo ou pelo Monday, se ficar em branco).
4. Clique em **Comparar**. A primeira leitura de uma pasta grande leva alguns minutos (PDFs no Drive);
   as seguintes usam o que já foi lido e são rápidas.
5. Veja o placar (OK, Divergente, Verificar, Sem documentos, Só no WP), filtre, clique numa linha para
   ver o trecho de cada documento, e baixe o **Excel com as evidências**.

### Como os documentos são ligados a cada título

- **direto**: o documento traz o VL Aplic. exato (tolerância de R$ 0,01);
- **mesma operação**: mesmo número de operação no nome do arquivo de um documento direto
  (ex.: `12692_BS_...` e `789771_12692_Term_...`), código do ativo (ex.: código CETIP do CRI) ou nome do
  emissor + o mesmo número de emissão (`2E` na Britech = "2ª emissão" no documento);
- **mesmo emissor**: só o nome do emissor (usado quando os níveis acima não trazem a data).

Datas só contam quando vêm logo depois de um rótulo ("Data de Emissão", "vencimento em",
"vencendo-se, portanto, em"...).

### Situações

| Situação | Quando |
|---|---|
| OK | todos os campos conferem com os documentos (e com a WP_Termo, se o item estiver lá) |
| Divergente | algum campo diverge dos documentos ou da WP_Termo |
| Verificar | documentos não concordam entre si, data sem rótulo, ou só há documentos do mesmo emissor |
| Sem documentos | nada na pasta traz o valor nem cita o emissor |
| Só no WP | linha da WP_Termo sem título correspondente na carteira Britech |

## Entrada e saída

- **Entra:** caminho do workpaper (.xlsm), caminho da pasta de lastro e termo, data-base e a carteira Britech
  (arquivo no Drive, Excel enviado pela tela ou API).
- **Sai:** tabela na tela e Excel com as abas *Conciliação* (um título por linha, Britech x WP x documentos),
  *Evidências* (documento e trecho de cada informação), *Documentos* (inventário da pasta, o que foi ligado a quê,
  o que não tem texto) e *Parâmetros*.
- Não grava nada no Drive.

## Configuração

| Variável | Uso |
|---|---|
| `CARTEIRABRITECH_PLANNER_USER` / `CARTEIRABRITECH_PLANNER_SENHA` | **segredo, já existe no deploy** (Gerar Amostras Planner). Só para a opção API. |
| `MONDAY_API_TOKEN` | **segredo, já existe no deploy.** Só para achar o ID da carteira pelo CNPJ na opção API. |
| `BATE_CARTEIRA_BRITECH_X_LASTRO_BASE_PLANNER` | pasta do trimestre da Planner no G: (padrão: `...\2T2026\PLANNER`) |
| `BATE_CARTEIRA_BRITECH_X_LASTRO_WORKPAPER` | workpaper sugerido na tela (padrão: o do BNVT ORIGEM) |
| `BATE_CARTEIRA_BRITECH_X_LASTRO_PASTA_LASTRO` | pasta de lastro sugerida na tela |
| `BATE_CARTEIRA_BRITECH_X_LASTRO_PASTA_CARTEIRAS` | onde ficam as carteiras Britech formatadas (padrão: `_Carteiras\FORMATADA`) |
| `BATE_CARTEIRA_BRITECH_X_LASTRO_RAIZES` | raízes que podem ser lidas, separadas por `;` (padrão: `G:\`) |
| `BATE_CARTEIRA_BRITECH_X_LASTRO_BRITECH_URL_ADM` | ambiente Britech (padrão: `delta`) |
| `BATE_CARTEIRA_BRITECH_X_LASTRO_BRITECH_PROCESSOR` | caminho do `processor.py` do `denver_contabifi/carteira_britech` (padrão: o do próprio hub) |
| `BATE_CARTEIRA_BRITECH_X_LASTRO_TOLERANCIA_VALOR` | diferença aceita em R$ (padrão `0.01`) |
| `BATE_CARTEIRA_BRITECH_X_LASTRO_MAX_PAGINAS_PDF` / `_TEMPO_MAX_PDF` | limite de páginas (40) e de segundos (8) por PDF |

Nenhuma variável nova é obrigatória: sem nada configurado, o app funciona com os padrões e a opção "Arquivo".

## Dependências novas

Nenhuma (usa `pandas`, `openpyxl`, `pdfplumber`, `beautifulsoup4`, `lxml` e `requests`, que já estão no
requirements.txt do hub). A opção API reaproveita `hub/apps/denver_contabifi/carteira_britech/processor.py`,
como o Gerar Amostras Planner.

## Limitações conhecidas

- Sem OCR: PDF escaneado aparece no inventário como "sem texto".
- Arquivos compactados (.zip, .tgz, .7z) na pasta não são abertos: descompacte antes.
- O resultado fica em memória por 3 horas (depois, rode de novo para baixar o Excel).

## Testes
`python -m pytest hub/apps/nix_auditoria/bate_carteira_britech_x_lastro/tests -q`

## Registro no hub
Django Admin → Aplicações:
- **Nome:** Bate Carteira Britech x Lastro
- **Setor:** `nix_auditoria`
- **Tipo:** Django Interno
- **Caminho:** `nix_auditoria/bate_carteira_britech_x_lastro`
- **Porta:** qualquer valor (não é usada em apps internos)
- **Descrição / Ícone:** ver `meta.py`
