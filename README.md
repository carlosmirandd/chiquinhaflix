# 📺 ChiquinhaFlix

> Um visualizador de séries pessoal, feito por diversão. Evolução de um projetinho do ensino médio.

## O contexto

O **ChiquinhaFlix** nasceu em **março de 2023**, num trabalho em grupo da disciplina de *Apps II* (6º período do ensino médio): um app em React Native, rodando no Expo Snack, com tela de login, um filme de exemplo e uma estrelinha de favorito. Era a época em que ainda programávamos sem IA, e o resultado era charmoso do jeito que só projeto de escola consegue ser.

Esta versão pega a ideia original e a transforma num **site de verdade**: HTML, CSS e JavaScript puros, sem build, sem dependências e sem servidor. Mantive o clima da versão original:

- a **logo** (claro que a Chiquinha continua aqui);
- a **tela de "Faça Login"** (agora sem senha: é só um nome, salvo no seu navegador);
- o **degradê roxo**;
- a **estrela de favoritos** ⭐.

## O que ele faz

- Catálogo de séries **populares** e do que está **no ar hoje**, com filtro por gênero.
- **Busca** por nome.
- Player com seletor de **temporada** e **episódio**, botões de anterior/próximo (passam sozinhos para a temporada seguinte) e marcação dos episódios já vistos.
- **Favoritos** e **histórico** ("continuar assistindo"), guardados no `localStorage` do navegador. Nada sai da sua máquina.

## Como funciona

| Parte | Origem |
|---|---|
| Catálogo, capas, sinopses, temporadas e episódios | [TVMaze API](https://www.tvmaze.com/api): gratuita, sem chave de API, sem cadastro |
| Vídeo | `iframe` (embed) de um serviço de terceiros, o [SuperFlixAPI](https://superflixapi.fun/doc), aberto pelo ID do IMDb da série |

Como a TVMaze não exige chave, **não há nenhum segredo no código**. O repositório é seguro para ser público e qualquer pessoa pode clonar e usar.

Séries que a TVMaze não associa a um ID do IMDb ficam de fora, porque o player não consegue abri-las.

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
- O player pode exibir uma verificação da Cloudflare (anti-bot) ou ficar indisponível a qualquer momento. Isso depende só do serviço de terceiros.

## Créditos

- Dados de séries: [TVMaze](https://www.tvmaze.com/api), licenciados sob [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/).
- Projeto original (2023): ChiquinhaFlix, feito em grupo para a disciplina de Apps II.
- A imagem da logo é um quadro de uma personagem de série de TV, usada aqui apenas como homenagem pessoal ao projeto original, sem fins comerciais.

## Estrutura

```
index.html   → telas (login, catálogo, player)
style.css    → visual
app.js       → lógica (TVMaze, player, favoritos, histórico)
assets/      → logo
```

## Licença

O código é distribuído sob a licença [MIT](LICENSE). A licença **não** cobre a logo nem os dados da TVMaze, que seguem seus próprios termos.
