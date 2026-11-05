# Worker do ChiquinhaFlix (Cloudflare)

O navegador não consegue ler diretamente algumas das listas que o app usa (os serviços não liberam CORS). Este Worker faz as consultas pelo servidor da Cloudflare, devolve só o que o app precisa e libera o acesso apenas para o site.

Ele serve o catálogo de séries e filmes da **TMDB** (a chave fica guardada como segredo do Worker, nunca no site nem no GitHub), a lista de canais ao vivo, a agenda esportiva e o calendário de episódios.

## Publicar

Você precisa do [Node.js](https://nodejs.org) (versão LTS) e de uma conta gratuita na Cloudflare. Crie a chave da TMDB em https://www.themoviedb.org/settings/api (a "Chave da API" ou o "Token de leitura") e, na pasta do projeto, rode:

```bash
python cloudflare/publicar.py --tmdb SUA_CHAVE
```

Na primeira vez o script abre o navegador para você entrar na Cloudflare e clicar em **Permitir**. Ele não lê nem guarda senha ou token. Depois ele:

1. publica o Worker (`worker.js`);
2. guarda a chave da TMDB como segredo (`TMDB_KEY`);
3. testa o endereço novo;
4. grava o endereço em `config.js` e envia só esse arquivo ao GitHub.

Nas próximas vezes, para atualizar só o código, basta `python cloudflare/publicar.py`: a chave já fica guardada. Para trocá-la, rode de novo com `--tmdb NOVA_CHAVE`.

## Como funciona

| Rota | O que devolve |
|---|---|
| `/tmdb/...` | consultas à TMDB, só de uma lista fixa de caminhos e parâmetros (conteúdo adulto sempre desligado) |
| `/canais` | canais ao vivo, com o programa no ar agora |
| `/agenda` | eventos esportivos, com uma fonte de reserva se a principal falhar |
| `/disponiveis` | IDs de filmes e séries que o player tem (cache de 6 horas), para o site esconder o que ainda não abre |
| `/calendario` | episódios que estreiam, por dia (`?passado=45` inclui os dias anteriores) |

- As respostas ficam em cache na Cloudflare (de 5 minutos a 1 hora), então muitas aberturas viram poucas consultas às fontes.
- O Worker devolve só os campos usados e descarta identificadores inseguros.
- O acesso vale **só para** `https://carlosmirandd.github.io` e para `localhost` (portas 8000 e 8765). Se o endereço do site mudar, edite `SITES_PERMITIDOS` em `worker.js` e publique de novo.
- O Worker enxerga as chamadas do site (endereço e IP de quem usa) e não guarda nada.

## Limites e cuidados

- O plano gratuito da Cloudflare permite 100 mil chamadas por dia, muito mais do que este app usa.
- As fontes podem limitar ou bloquear as consultas. Nesse caso o Worker responde 503 ou 502, e o app usa os arquivos de reserva (`canais.json` e `agenda.json`). Para atualizar o `agenda.json`: `python tools/atualizar_agenda.py --publicar`.

## Atualizar ou remover

- Depois de editar `worker.js`, rode `python cloudflare/publicar.py` de novo.
- Para remover: na pasta `cloudflare`, rode `npx wrangler delete` e esvazie o endereço em `config.js` (`window.CHIQUINHA_AGENDA_URL = '';`).
