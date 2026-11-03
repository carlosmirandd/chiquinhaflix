# Worker do ChiquinhaFlix (Cloudflare)

O SuperFlix não deixa o navegador ler a lista de eventos direto (a resposta não tem o cabeçalho CORS). Este Worker faz a chamada pelo servidor da Cloudflare e devolve só o que o app usa, já com o CORS liberado para o site. Assim a agenda atualiza sozinha toda vez que alguém abre o app, sem Python e sem rodar nada na sua máquina.

Ele também serve a **lista de canais ao vivo** (rota `/canais`, com o programa no ar agora, vinda do Rei dos Embeds) e o **catálogo de séries da TMDB** (rota `/tmdb/...`): o site pede ao Worker, e o Worker consulta a TMDB com a sua chave, que fica guardada como segredo e nunca aparece no site nem no GitHub.

## Publicar (um comando só)

Crie a chave grátis em https://www.themoviedb.org/settings/api (a "Chave da API", de 32 caracteres, ou o "Token de leitura", que começa com `eyJ`). Depois, na pasta do projeto:

```bash
python cloudflare/publicar.py --tmdb SUA_CHAVE
```

Nas próximas vezes, para atualizar só o código, basta `python cloudflare/publicar.py` (a chave já fica guardada no Worker). Sem `--tmdb` e sem chave guardada, o script pede a chave na tela, sem mostrá-la. Para trocar a chave, rode de novo com `--tmdb NOVA_CHAVE`.

O script:

1. confere se o **Node.js** está instalado (se não estiver, instale a versão LTS em https://nodejs.org);
2. confere o login na Cloudflare. Na **primeira vez** ele abre o navegador: entre (ou crie a conta **gratuita**) e clique em **Permitir**. É a única parte que precisa de você, e o script não lê nem guarda senha ou token;
3. publica o Worker (`cloudflare/worker.js`) e, se pedir para registrar um subdomínio `workers.dev`, aceite;
4. guarda a chave da TMDB como segredo do Worker (`wrangler secret put TMDB_KEY`);
5. testa o endereço novo (agenda e TMDB) com uma chamada;
6. grava o endereço em `config.js` e envia só esse arquivo ao GitHub. Alguns minutos depois o site passa a usar o Worker.

## Como funciona

- Rotas: `GET /agenda` (SuperFlix, com a agenda do Rei dos Embeds como reserva se ele falhar), `GET /canais`, `GET /calendario` (episódios que estreiam nos próximos dias, do SuperFlix, em cache por 1 hora) e `GET /tmdb/...` (só caminhos e parâmetros de uma lista fixa: tendências, populares, no ar hoje, busca, detalhes e temporadas; `include_adult` é sempre falso).
- A resposta do SuperFlix fica em **cache na Cloudflare por 5 minutos**. Muitas aberturas viram uma única chamada ao SuperFlix a cada 5 minutos, o que protege contra o limite de requisições deles.
- O Worker devolve só os campos usados (nome, esporte, competição, horário, times, escudos e canais) e descarta identificadores inseguros.
- O CORS vale **só para** `https://carlosmirandd.github.io` e para `localhost` (portas 8000 e 8765). Navegadores de outros sites recebem 403 e nem chegam a chamar o SuperFlix. Se o endereço do site mudar, edite `SITES_PERMITIDOS` em `worker.js` e rode o comando de novo.
- No app, a agenda aparece **na hora** (cache do navegador ou `agenda.json`) e é atualizada pelo Worker em segundo plano. Se o Worker falhar, o app lembra por 5 minutos e segue com o que já tem. O botão **Atualizar** força uma nova tentativa.

## Limites e cuidados

- A TMDB responde pelo cache da Cloudflare por 1 hora, então o Worker quase não consulta a TMDB de novo.
- O plano gratuito da Cloudflare permite 100 mil chamadas por dia, muito mais do que este app usa.
- O SuperFlix pode limitar (429) ou bloquear a Cloudflare. Nesse caso o Worker responde 503/502, e o app usa o `agenda.json` publicado como plano B (`python tools/atualizar_agenda.py --publicar`).
- O Worker enxerga as chamadas feitas pelo seu site (endereço e IP de quem abre a agenda). Não guarda nada.

## Atualizar ou remover

- Depois de editar `worker.js`, rode `python cloudflare/publicar.py` de novo.
- Para remover: na pasta `cloudflare`, rode `npx wrangler delete` e esvazie o endereço em `config.js` (`window.CHIQUINHA_AGENDA_URL = '';`).
