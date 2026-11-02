# 📺 ChiquinhaFlix

> Um visualizador de séries pessoal, feito por diversão. Evolução de um projetinho do ensino médio.

**🔗 Online:** https://carlosmirandd.github.io/chiquinhaflix/

### No celular

| Início | Detalhes | Episódios | Busca |
|---|---|---|---|
| ![Início no celular](docs/mobile-inicio.jpg) | ![Detalhes no celular](docs/mobile-detalhes.jpg) | ![Episódios no celular](docs/mobile-episodios.jpg) | ![Busca no celular](docs/mobile-busca.jpg) |

### No computador

| Início | Detalhes |
|---|---|
| ![Banner em destaque](docs/catalogo.jpg) | ![Modal de detalhes](docs/detalhes.jpg) |

## O contexto

O **ChiquinhaFlix** nasceu em **março de 2023**, num trabalho em grupo da disciplina de *Apps II* (6º período do ensino médio): um app em React Native, rodando no Expo Snack, com tela de login, um filme de exemplo e uma estrelinha de favorito. Era a época em que ainda programávamos sem IA, e o resultado era charmoso do jeito que só projeto de escola consegue ser.

Esta versão pega a ideia original e a transforma num **site de verdade**: HTML, CSS e JavaScript puros, sem build, sem dependências e sem servidor. Mantive o clima da versão original:

- a **logo** (a Chiquinha e o nome);
- a **estrela de favoritos**, agora "Minha lista";
- o visual segue o estilo dos grandes serviços de streaming (banner em destaque, fileiras, Top 10, modal de detalhes), mas com marca própria e sem usar nome nem logo de nenhum deles.

A tela de login da versão original saiu: como tudo fica no seu navegador, não faz sentido ter conta.

## O que ele faz

- **Layout de app no celular**: barra inferior flutuante, banner vertical, categorias em botões, detalhes em tela cheia e busca em tela própria. No computador, vira um layout de TV/desktop com modal de detalhes.
- Banner em destaque, fileiras por gênero, **Top 10**, **Continuar assistindo** (com barra de progresso) e **No ar hoje**.
- **Busca** por nome e navegação por **gênero**.
- **Detalhes** com elenco, gêneros, status, "Continuar" e lista de episódios por temporada. Os já vistos ganham a barra vermelha.
- Player com seletor de **temporada** e **episódio**, anterior/próximo (passam sozinhos para a temporada seguinte).
- **Minha lista** e **histórico**, guardados no `localStorage`. Nada sai da sua máquina.
- **Textos em português** (veja abaixo).

## Como funciona

| Parte | Origem |
|---|---|
| Catálogo, capas, temporadas, episódios, elenco | [TVMaze API](https://www.tvmaze.com/api): gratuita, sem chave de API, sem cadastro |
| Título em português do Brasil | `/akas` da própria TVMaze, quando a série tem título cadastrado para o Brasil |
| Sinopses e nomes de episódio em português | Tradução automática (veja abaixo) |
| Vídeo | `iframe` (embed) de um serviço de terceiros, o [SuperFlixAPI](https://superflixapi.fun/doc), aberto pelo ID do IMDb da série |

Como a TVMaze não exige chave, **não há nenhum segredo no código**. O repositório é seguro para ser público e qualquer pessoa pode clonar e usar. Séries que a TVMaze não associa a um ID do IMDb ficam de fora, porque o player não consegue abri-las.

### Sobre a tradução

A TVMaze só tem dados em inglês. Para mostrar o site em português:

1. o **título** vem do `/akas` da TVMaze (por exemplo, "Ruptura Total" no lugar de "Breaking Bad"), quando existe;
2. **sinopses e nomes de episódio** são traduzidos automaticamente pelo próprio navegador, chamando o endpoint público do Google Tradutor e, se ele falhar, o [MyMemory](https://mymemory.translated.net/). Se os dois falharem, fica o texto original em inglês;
3. as traduções ficam em cache no `localStorage`, então cada texto é traduzido uma vez só.

Isso significa que **os textos das sinopses (dados públicos de séries) são enviados a esses serviços de tradução** quando você abre uma série. Nenhum dado pessoal vai junto. O endpoint do Google usado é o não oficial (`translate.googleapis.com`), então pode mudar ou deixar de funcionar sem aviso; a qualidade é a de uma tradução automática, e nomes de episódio podem sair estranhos.

## Como rodar

É um site estático. Abra o `index.html` direto no navegador ou sirva a pasta:

```bash
python -m http.server 8000
```

Depois acesse `http://localhost:8000`.

## Aviso importante

Este é um **projeto pessoal, educacional e sem fins lucrativos**.

- Este repositório **não hospeda, não armazena e não distribui nenhum vídeo**. Ele só exibe um `iframe` apontando para um serviço de terceiros.
- Não tenho controle sobre o conteúdo desse serviço, nem garantias sobre a licença dos vídeos que ele serve. **Cada pessoa é responsável pelo que acessa** e deve respeitar a legislação de direitos autorais do seu país.
- O serviço de terceiros **libera o embed só para domínios autorizados**. Em domínios não autorizados (incluindo `localhost`), o player mostra "Embed não disponível aqui" em vez do vídeo. Ele também pode exibir uma verificação da Cloudflare (anti-bot) ou ficar indisponível a qualquer momento. Nada disso depende deste código: o catálogo, a busca, a minha lista e o histórico funcionam normalmente mesmo sem o vídeo.
- O projeto cobre **somente séries sob demanda**. Não há canais de TV ao vivo, eventos esportivos nem filmes.

## Créditos

- Dados de séries: [TVMaze](https://www.tvmaze.com/api), licenciados sob [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/).
- Projeto original (2023): ChiquinhaFlix, feito em grupo para a disciplina de Apps II.
- A imagem da logo vem do projeto original e é uma homenagem pessoal a ele, sem fins comerciais.

## Estrutura

```
index.html   → telas (início, lista, player, detalhes, barra inferior)
style.css    → visual (desktop e celular)
app.js       → lógica (TVMaze, tradução, player, minha lista, histórico)
assets/      → logo (rosto e nome recortados do original)
docs/        → prints usados neste README
```

## Licença

O código é distribuído sob a licença [MIT](LICENSE). A licença **não** cobre a logo nem os dados da TVMaze, que seguem seus próprios termos.
