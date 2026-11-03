// Worker da Cloudflare do ChiquinhaFlix.
//
// O SuperFlix não libera a leitura da lista de eventos direto pelo navegador (a resposta não
// tem cabeçalho CORS). Este Worker faz a chamada pelo lado do servidor e devolve só o que o app
// usa, com o CORS liberado para o seu site. Rota única: GET /agenda
//
// A resposta do SuperFlix fica em cache na Cloudflare por 5 minutos, então muitas pessoas (ou
// muitas aberturas) viram uma única chamada a cada 5 minutos, o que protege contra o limite
// de requisições deles.

const ORIGEM = 'https://superflixapi.fun/lista?category=eventos&format=json';
const CACHE_SEGUNDOS = 300;
// Sites que podem ler a agenda pelo navegador. Se mudar o endereço do site, edite aqui.
const SITES_PERMITIDOS = [
  'https://carlosmirandd.github.io',
  'http://localhost:8000', 'http://127.0.0.1:8000',
  'http://localhost:8765', 'http://127.0.0.1:8765',
];
const ID_OK = /^[A-Za-z0-9_-]{1,120}$/;
const CANAL_OK = /^[A-Za-z0-9_-]{1,60}$/;

// só guarda o que o app usa; descarta identificadores e canais que não sejam seguros
function compacta(e) {
  const id = e.public_slug || e.base_public_slug || e.slug || '';
  if (!ID_OK.test(id)) return null;
  const canais = (e.embeds || [])
    .filter(m => m.type === 'channel' && CANAL_OK.test(m.slug || ''))
    .map(m => [m.provider || m.slug, m.slug, m.quality || '']);
  return {
    i: id, t: e.title || id, st: e.status || 'upcoming', sp: e.category || '', c: e.competition || '',
    d: e.start_time || '', a: e.time1_name || '', b: e.time2_name || '',
    la: e.time1 || '', lb: e.time2 || '', el: e.event_logo || '', e: canais,
  };
}

function cors(origin) {
  return {
    ...(SITES_PERMITIDOS.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(corpo, status, origin, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin), ...extra },
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'GET' || url.pathname !== '/agenda') return json({ erro: 'rota inexistente' }, 404, origin);
    // navegador de outro site: recusa (chamadas sem Origin, como curl, passam para facilitar testes)
    if (origin && !SITES_PERMITIDOS.includes(origin)) return json({ erro: 'site não autorizado' }, 403, origin);

    let up;
    try {
      up = await fetch(ORIGEM, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChiquinhaFlix-Worker/1.0)', Accept: 'application/json' },
        // cache de 5 min na Cloudflare só para respostas boas; erros (como 429) não ficam em cache
        cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': CACHE_SEGUNDOS, '400-599': 0 } },
      });
    } catch {
      return json({ erro: 'não consegui falar com o SuperFlix' }, 502, origin);
    }
    if (up.status === 429) return json({ erro: 'limite de requisições do SuperFlix', retry_after: Number(up.headers.get('retry-after')) || 10 }, 503, origin, { 'Retry-After': '10' });
    if (!up.ok) return json({ erro: 'SuperFlix respondeu HTTP ' + up.status }, 502, origin);

    let bruto;
    try { bruto = await up.json(); } catch { return json({ erro: 'resposta inválida do SuperFlix' }, 502, origin); }
    if (!bruto || !Array.isArray(bruto.data)) return json({ erro: 'formato inesperado do SuperFlix' }, 502, origin);

    return json(
      { gerado: new Date().toISOString(), eventos: bruto.data.map(compacta).filter(Boolean) },
      200, origin, { 'Cache-Control': 'public, max-age=60' },
    );
  },
};
