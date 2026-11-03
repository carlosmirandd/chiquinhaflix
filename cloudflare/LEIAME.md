# Worker da agenda (Cloudflare)

O SuperFlix não deixa o navegador ler a lista de eventos direto (a resposta não tem o cabeçalho CORS). Este Worker faz a chamada pelo servidor da Cloudflare e devolve só o que o app usa, já com o CORS liberado para o site. Assim a agenda atualiza sozinha toda vez que alguém abre o app, sem Python e sem rodar nada na sua máquina.

## Publicar (um comando só)

Na pasta do projeto:

```bash
python cloudflare/publicar.py
```

O script:

1. confere se o **Node.js** está instalado (se não estiver, instale a versão LTS em https://nodejs.org);
2. confere o login na Cloudflare. Na **primeira vez** ele abre o navegador: entre (ou crie a conta **gratuita**) e clique em **Permitir**. É a única parte que precisa de você, e o script não lê nem guarda senha ou token;
3. publica o Worker (`cloudflare/worker.js`) e, se pedir para registrar um subdomínio `workers.dev`, aceite;
4. testa o endereço novo com uma chamada;
5. grava o endereço em `config.js` e envia só esse arquivo ao GitHub. Alguns minutos depois o site passa a usar o Worker.

## Como funciona

- Rota única: `GET /agenda`.
- A resposta do SuperFlix fica em **cache na Cloudflare por 5 minutos**. Muitas aberturas viram uma única chamada ao SuperFlix a cada 5 minutos, o que protege contra o limite de requisições deles.
- O Worker devolve só os campos usados (nome, esporte, competição, horário, times, escudos e canais) e descarta identificadores inseguros.
- O CORS vale **só para** `https://carlosmirandd.github.io` e para `localhost` (portas 8000 e 8765). Navegadores de outros sites recebem 403 e nem chegam a chamar o SuperFlix. Se o endereço do site mudar, edite `SITES_PERMITIDOS` em `worker.js` e rode o comando de novo.
- No app, a agenda aparece **na hora** (cache do navegador ou `agenda.json`) e é atualizada pelo Worker em segundo plano. Se o Worker falhar, o app lembra por 5 minutos e segue com o que já tem. O botão **Atualizar** força uma nova tentativa.

## Limites e cuidados

- O plano gratuito da Cloudflare permite 100 mil chamadas por dia, muito mais do que este app usa.
- O SuperFlix pode limitar (429) ou bloquear a Cloudflare. Nesse caso o Worker responde 503/502, e o app usa o `agenda.json` publicado como plano B (`python tools/atualizar_agenda.py --publicar`).
- O Worker enxerga as chamadas feitas pelo seu site (endereço e IP de quem abre a agenda). Não guarda nada.

## Atualizar ou remover

- Depois de editar `worker.js`, rode `python cloudflare/publicar.py` de novo.
- Para remover: na pasta `cloudflare`, rode `npx wrangler delete` e esvazie o endereço em `config.js` (`window.CHIQUINHA_AGENDA_URL = '';`).
