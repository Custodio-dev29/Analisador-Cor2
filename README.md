# Analisador de Cores Profissional

Ferramenta de amostragem de cor que roda inteiramente no navegador. Carregue uma
imagem, clique em qualquer ponto e leia a cor média da área ao redor do cursor,
com diferença de cor calculada por **CIEDE2000**.

Todo o processamento e o armazenamento acontecem no dispositivo. Não existe
servidor: as imagens nunca saem da sua máquina.

## Como executar

O app usa **ES modules**, **Web Crypto** e **Service Worker**, recursos que o
navegador bloqueia em `file://`. É preciso servir a pasta por HTTP:

```bash
npm install
npm run dev        # http://localhost:8080
```

Abra `http://localhost:8080/login.html`. Qualquer servidor estático serve
(`npx serve`, `python -m http.server`, Live Server do VS Code). Em produção,
use HTTPS: o Service Worker só registra em contexto seguro, exceto em
`localhost`.

Primeiro uso: crie um usuário. **O primeiro usuário registrado é marcado como
administrador** (ver [Modelo de ameaça](#modelo-de-ameaça)).

### Por que o celular precisa de HTTPS

Abrir o app pelo IP da rede local (`http://192.168.x.x:8080`) **não funciona**,
mesmo que a página carregue. O navegador só expõe a Web Crypto — que protege a
senha — em contexto seguro: HTTPS ou `localhost`. Como `localhost` no celular é
o próprio celular, o acesso pela rede local fica sem login.

Por isso o app detecta essa situação e mostra, na tela de login, o que fazer em
vez de falhar em silêncio. Publicar num host estático resolve: os quatro dão
HTTPS automático.

## Funcionalidades

### Amostragem

- **Buffer de amostragem separado do canvas visível.** A imagem é analisada em
  resolução reduzida em memória, com teto de 16 megapixels e 6000 px por lado.
  O limite existe porque `getImageData` em imagens muito grandes estoura a
  memória em navegadores móveis. O retículo desenhado mostra o **tamanho
  real** da região amostrada sobre a imagem original.
- Área de amostragem de 1x1 a 9x9 px, em passos de 2.
- Média **ponderada por alpha**: um pixel semitransparente pesa menos que um
  opaco, em vez de ser tratado como cor-preta.
- Zoom 1:1 para conferir a região selecionada pixel a pixel.
- Leitura de orientação **EXIF** e recomposição de **JPEG progressivo**, que
  navegadores costumam exibir girados.
- Navegação por teclado: setas movem o cursor, `Espaço` amostra, `+` e `-`
  ajustam o tamanho da área.

### Cor

- HEX, RGB, HSL, CMYK e **CIELAB (L\*a\*b\*)** com D65.
- **CIEDE2000** completo, validado contra os 34 pares de referência de Sharma,
  Wu e Dalal (erro máximo < 1e-4). CIEDE2000 é o padrão da CIE para diferença
  de cor perceptível; o Delta E 76 antigo, usado pela versão anterior, é
  linear e superestima diferenças em tons de azul e amarelo.
- Interpretação da diferença pelos limites da *Recommended Practice* da CIE
  (2001): imperceptível, apenas perceptível, perceptível, marcante etc.
- Contraste WCAG 2.1 (AA/AAA) da cor contra um fundo ajustável.
- Régua em **L\*** para localizar tons neutros: dois tons diferentes com L\*
  igual são indistinguíveis em cinza.

### Dados

- Histórico por usuário, com busca, ordenação, seleção e comparação em lote.
- Exportação em **CSV** (nativo, sem dependência) ou **XLSX**.
- Paleta de referência por usuário, com limite de 64 cores.
- Importação e exportação dos dados de um usuário em `.json`.

### Interface

- Instalável como PWA, com atualização controlada: a versão nova só assume
  quando você aceita, para não interromper uma análise em andamento.
- Funciona offline após a primeira visita.
- Feedbacks não bloqueantes: substituem `alert`, `confirm` e `prompt` por
  toasts, diálogos com foco preso e mensagens em `aria-live`.

## Modelo de ameaça

Esta é uma ferramenta local, não um serviço com vários usuários. O painel de
administração (`profile.html`) existe para organizar dados na mesma máquina,
**não é um controle de acesso seguro**:

- Todo acesso herda o controle do navegador e do sistema operacional.
- Senhas não protegem nada contra quem já tem acesso ao perfil do navegador.
  Elas servem para separar dados e evitar misturas acidentais.
- A senha é derivada com **PBKDF2-HMAC-SHA256**, 210.000 iterações, salt
  único por usuário. Senhas antigas, migradas do `simpleHash` original, são
  reescritas no primeiro login.

Não exponha esta aplicação em uma rede pública esperando autenticação real.

## Migração de dados

A versão anterior guardava tudo em `localStorage`, sob a chave única
`colorAnalyzerUsers`, com senhas em `simpleHash` e histórico no formato antigo.

Na primeira execução o app:

1. Lê a chave legada e importa usuários, histórico e paletas para o
   **IndexedDB**, com um registro por usuário.
2. Recalcula todo o histórico guardado com **CIEDE2000** e marca o esquema como
   `v2`. Os valores antigos de Delta E 76 são descartados, não convertidos:
   são números de uma fórmula diferente.
3. Reescreve a senha em PBKDF2 no primeiro login de cada conta.
4. Remove a chave legada do `localStorage` só depois de tudo dar certo.

Excluir um usuário remove também o histórico e a paleta dele. Não há lixeira:
excluir é definitivo.

Se o IndexedDB não estiver disponível (modo privado em alguns navegadores), o
app cai para `localStorage` automaticamente e mantém o mesmo esquema.

## Estrutura

```
index.html          tela de análise
login.html          criar usuário e entrar
history.html        histórico e exportação
profile.html        painel local de administração
styles.css          tema, layout e responsividade
sw.js               Service Worker (v8)
manifest.json       manifesto do PWA
icons/              ícones any e maskable

js/
  color.js          sRGB <-> Lab, CIEDE2000, WCAG, interpretação
  sampler.js        buffer offscreen, orçamento de pixels, média com alpha
  storage.js        IndexedDB, fallback, migração do legado
  auth.js           PBKDF2, migração de senha, sessão
  export.js         CSV e XLSX
  toast.js          toasts e diálogos
  guard.js          proteção de rota e checagem de contexto seguro
  logger.js         log de erros
  app.js            controlador da tela de análise
  history.js        controlador do histórico
  login.js          controlador do login
  profile.js        controlador do painel

tests/              testes unitários (Vitest)
scripts/            build, verificação de integridade e smoke test
.github/workflows/  publicação automática no GitHub Pages
```

Os arquivos antigos na raiz (`app.js`, `shared.js`, `reset-password.html` e
afins) foram removidos: eram duplicados dos módulos em `js/` e não tinham
testes.

## Scripts

```bash
npm run dev         # servidor estático local
npm run lint        # ESLint
npm test            # testes unitários
npm run verify      # integridade de referências + smoke test de servidor
npm run check       # lint + testes + verify
npm run build       # gera dist/ e valida o resultado
npm run preview     # serve dist/, como vai ficar em produção
```

`npm run verify` cobre dois erros comuns em aplicações estáticas que nenhum
teste de unidade pega: um módulo importado que não existe (quebra em runtime,
não no build) e um servidor respondendo `.js` como `text/plain` (que o
navegador recusa). O script também confere se os ícones declarados no
manifesto existem **e** têm o tamanho que o manifesto afirma.

## Publicar

```bash
npm run build       # gera dist/
```

Envie **a pasta `dist/`**, nunca o projeto inteiro: `node_modules`, testes e
scripts de build não têm nada a ver com o app em produção. O `npm run build`
também roda o smoke test sobre o `dist/` gerado, então um artefato quebrado
falha o build em vez de ir ao ar.

| Onde | Como |
| --- | --- |
| **Cloudflare Pages** | Crie um projeto, "Upload assets", arraste `dist/`. Grátis, sem cartão. |
| **Netlify** | [app.netlify.com/drop](https://app.netlify.com/drop) e arraste `dist/`. |
| **GitHub Pages** | Suba o código para `main`; o workflow `.github/workflows/deploy.yml` roda `check`, `build` e publica sozinho. Ative Pages com source *GitHub Actions* nas configurações do repositório. |
| **Vercel** | `npx vercel --prod` a partir da raiz do projeto. |

Todos os hosts já servem em HTTPS, então o app funciona no celular e pode ser
instalado pela tela de login do sistema.

`dist/_headers` acrescenta `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options`, `Permissions-Policy` e uma CSP mais restritiva. O Netlify e o
Cloudflare Pages leem esse arquivo; o GitHub Pages ignora. A CSP decisiva já está
no `<meta>` de cada HTML, que funciona em qualquer host.

### No celular

Abra a URL no navegador e use **Compartilhar → Adicionar à Tela de Início**
(Android) ou **Compartilhar → Adicionar à Tela de Início** (iOS). O app passa a
abrir em tela cheia, sem barra de endereço, e funciona offline.

Os dados ficam no navegador do aparelho. Limpar os dados do site, ou
desinstalar o PWA, **apaga o histórico e a paleta** daquele dispositivo. Para
não perder, exporte o histórico em CSV ou JSON na tela de histórico. Os dados
não sincronizam entre celular e computador: cada um tem a sua base.

## Limitações conhecidas

- **Espaços de gamut amplo são tratados como sRGB.** O pipeline converte para
  8 bits por canal, então um pixel de um JPEG HDR é reportado como o sRGB mais
  próximo, não como a cor original.
- **Perfil ICC é ignorado.** Para imagens em Adobe RGB ou Display P3, os
  valores apresentados são os do sRGB.
- **CSV é UTF-8 com BOM**, para o Excel abrir acentos corretamente. O
  delimitador de linha é CRLF; campos entre aspas podem conter quebras de
  linha, conforme a RFC 4180.
- **CSV se protege contra fórmula**: textos que começam com `=`, `+`, `-` ou
  `@` recebem um apóstrofo para o Excel não executar. Campos puramente
  numéricos não são afetados, senão valores legitimamente negativos
  (`a* = -12.34`) virariam texto.
- **XLSX depende de CDN.** A primeira exportação em XLSX precisa de rede; se o
  SheetJS não carregar, o CSV continua funcionando. O script é cacheado pelo
  Service Worker quando disponível.
- **Sem OCR e sem histograma automático**: a análise é por ponto, com apoio do
  delta a uma referência.
