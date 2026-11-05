# 📺 ChiquinhaFlix

> Um visualizador pessoal de séries, filmes e TV ao vivo, feito por diversão. Evolução de um projetinho do ensino médio.

**🔗 Online:** https://carlosmirandd.github.io/chiquinhaflix/

### No celular

| Início | Detalhes | Episódios | Busca | Ao vivo |
|---|---|---|---|---|
| ![Início no celular](docs/mobile-inicio.jpg) | ![Detalhes no celular](docs/mobile-detalhes.jpg) | ![Episódios no celular](docs/mobile-episodios.jpg) | ![Busca no celular](docs/mobile-busca.jpg) | ![Ao vivo no celular](docs/mobile-aovivo.jpg) |

### No computador

| Início | Detalhes | Ao vivo |
|---|---|---|
| ![Banner em destaque](docs/catalogo.jpg) | ![Modal de detalhes](docs/detalhes.jpg) | ![Canais ao vivo](docs/aovivo.jpg) |

## O contexto

O **ChiquinhaFlix** nasceu em **março de 2023**, num trabalho em grupo da disciplina de *Apps II* (ensino médio): um app em React Native, rodando no Expo Snack, com tela de login, um filme de exemplo e uma estrelinha de favorito.

Esta versão é um **site de verdade**: HTML, CSS e JavaScript puros, sem build e sem dependências. Ficaram a **logo** (a Chiquinha e o nome), a **estrela de favoritos** (agora "Minha lista") e o clima de app de streaming, com marca própria. A tela de login saiu: tudo fica no seu navegador.

## O que ele faz

- **Início** com séries e filmes juntos, como nos grandes serviços: banner em destaque, Top 10 de séries e de filmes da semana, fileiras por gênero e "Continuar assistindo" com botão de próximo episódio. As abas **Séries** e **Filmes** mostram cada catálogo separado. Há busca, detalhes com elenco e episódios, e Minha lista.
- **Novidades**: estreias de filmes e novos episódios das séries mais relevantes, o que está em alta e um **calendário do mês** com as capas de cada dia (com filtro de séries e filmes).
- **Filmes**: aba com em cartaz, lançamentos recentes e em breve nos cinemas.
- **Ao vivo**: canais, com o programa que está no ar, e agenda esportiva. Os canais adultos ficam atrás de um filtro **18+** com confirmação.
- O site **esconde dos catálogos o que o player ainda não tem** (usa a lista de títulos disponíveis do serviço). As estreias aparecem, marcadas como "ainda sem player". Se a lista não puder ser lida, nada é escondido.
- **Minha lista** e **histórico**, guardados no `localStorage`: nada sai do seu navegador.
- **Miniplayer** flutuante, para continuar assistindo enquanto navega.
- **Busca** com filtro de séries e filmes.
- **Layout de app no celular**, instalável como **PWA**, e **modo TV** para controle remoto (liga sozinho em TVs; nas outras, use `?tv=1`).
- Tudo em português do Brasil.

## Como funciona

| Parte | Origem |
|---|---|
| Catálogo de séries e filmes: capas, elenco, episódios, títulos e sinopses em português | [TMDB](https://www.themoviedb.org/documentation/api), consultada por um Worker da Cloudflare que guarda a chave |
| Vídeo, canais, agenda e calendário | `iframes` e listas de serviços de terceiros, lidos pelo mesmo Worker |

O navegador não consegue ler algumas dessas listas diretamente (CORS), então um **Worker da Cloudflare** faz as consultas e devolve só o necessário. A **chave da TMDB não está no código nem no repositório**: fica como segredo do Worker, que só aceita consultas de uma lista fixa e só responde ao endereço do site.

Quando uma sinopse não existe em português, o app a **traduz automaticamente** pelo navegador (Google Tradutor, com o MyMemory como reserva) e guarda o resultado no `localStorage`. Nesse caso o texto da sinopse, que é um dado público, é enviado a esses serviços. Nenhum dado pessoal vai junto.

## Como rodar

O site é estático. Sirva a pasta com o Python 3:

```bash
python -m http.server 8000
```

Depois acesse `http://localhost:8000`.

O catálogo precisa do Worker. Crie uma chave gratuita na TMDB e publique o Worker uma vez (precisa de Node.js e de uma conta gratuita na Cloudflare):

```bash
python cloudflare/publicar.py --tmdb SUA_CHAVE
```

O script publica o Worker e grava o endereço dele em `config.js`. Os detalhes estão em [`cloudflare/LEIAME.md`](cloudflare/LEIAME.md).

## Aviso importante

Este é um **projeto pessoal, educacional e sem fins lucrativos**.

- O repositório **não hospeda, não armazena e não distribui nenhum vídeo**. Ele só exibe `iframes` de serviços de terceiros.
- Não tenho controle sobre o conteúdo desses serviços nem garantia sobre a licença do que eles servem. **Cada pessoa é responsável pelo que acessa** e deve respeitar a legislação de direitos autorais do seu país.
- Os serviços de terceiros podem bloquear o vídeo em alguns domínios (incluindo `localhost`), pedir uma verificação anti-bot ou ficar fora do ar. O catálogo, a busca e a Minha lista funcionam mesmo sem o vídeo.

## Créditos

- Este produto usa a API da [TMDB](https://www.themoviedb.org), mas não é endossado nem certificado pela TMDB. Dados e imagens: TMDB.
- Projeto original (2023): ChiquinhaFlix, feito em grupo para a disciplina de Apps II. A imagem da logo vem dele, como homenagem pessoal e sem fins comerciais.

## Estrutura

```
index.html, style.css, app.js   → o site (telas, visual e lógica)
tv.js                           → modo TV (controle remoto)
manifest.webmanifest, sw.js     → PWA (instalação e abertura offline)
config.js                       → endereço do Worker (preenchido pelo publicar.py)
canais.json, agenda.json        → listas de reserva, usadas se o Worker não responder
cloudflare/                     → Worker, script de publicação e passo a passo
servidor.py, tools/             → servidor local opcional e atualizador do agenda.json
assets/, docs/                  → logo, fonte e prints deste README
```

## Licença

O código é distribuído sob a licença [MIT](LICENSE). A licença **não** cobre a logo nem os dados e imagens da TMDB, que seguem seus próprios termos.
