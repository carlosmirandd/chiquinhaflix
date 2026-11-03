// Worker da Cloudflare do ChiquinhaFlix.
//
// O SuperFlix não libera a leitura da lista de eventos direto pelo navegador (a resposta não
// tem cabeçalho CORS). Este Worker faz a chamada pelo lado do servidor e devolve só o que o app
// usa, com o CORS liberado para o seu site. Rotas: GET /agenda e GET /tmdb/...
//
// /tmdb/... repassa a consulta à API da TMDB (catálogo de séries em português) usando a chave
// guardada como segredo do Worker (TMDB_KEY), que nunca aparece no site nem no GitHub. Só passam
// os caminhos e parâmetros da lista TMDB_* abaixo; o resto é recusado.
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
const TMDB_BASE = 'https://api.themoviedb.org/3/';
const TMDB_CACHE_SEGUNDOS = 3600;
// caminhos liberados (sem o /tmdb/ do começo)
const TMDB_CAMINHOS = [
  /^trending\/tv\/(day|week)$/, /^tv\/(popular|top_rated|airing_today|on_the_air)$/,
  /^discover\/tv$/, /^search\/tv$/, /^tv\/\d{1,9}$/, /^tv\/\d{1,9}\/season\/\d{1,3}$/,
  /^find\/tt\d{1,12}$/, /^genre\/tv\/list$/,
];
// parâmetros liberados e o formato aceito de cada um
const TMDB_PARAMS = {
  page: /^\d{1,3}$/, query: /^[^\u0000-\u001f]{1,100}$/, language: /^[a-z]{2}(-[A-Z]{2})?$/,
  with_genres: /^[\d,|]{1,40}$/, sort_by: /^[a-z_.]{1,40}$/, timezone: /^[A-Za-z_]+\/[A-Za-z_]+$/,
  external_source: /^imdb_id$/, include_image_language: /^[a-z,]{1,20}$/,
  'vote_count.gte': /^\d{1,6}$/, with_original_language: /^[a-z]{2}$/,
};
const TMDB_APPEND = /^(external_ids|credits|images|videos|season\/\d{1,3})$/;

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

// monta a chamada à TMDB só com o que está liberado; devolve a URL ou null se algo for inválido
function urlTmdb(caminho, params, chave) {
  if (!TMDB_CAMINHOS.some(r => r.test(caminho))) return null;
  const u = new URL(TMDB_BASE + caminho);
  for (const [k, v] of params) {
    if (k === 'append_to_response') {
      const itens = v.split(',');
      if (itens.length > 20 || !itens.every(i => TMDB_APPEND.test(i))) return null;
      u.searchParams.set(k, v);
    } else if (TMDB_PARAMS[k] && TMDB_PARAMS[k].test(v)) u.searchParams.set(k, v);
    else return null;
  }
  if (!u.searchParams.has('language')) u.searchParams.set('language', 'pt-BR');
  u.searchParams.set('include_adult', 'false');
  // chave v3 (32 caracteres) vai na URL; token v4 (começa com eyJ) vai no cabeçalho Authorization
  if (!chave.startsWith('eyJ')) u.searchParams.set('api_key', chave);
  return u;
}

async function tmdb(url, params, env, origin) {
  const chave = String((env && env.TMDB_KEY) || '').trim();
  if (!chave) return json({ erro: 'TMDB_KEY não configurada no Worker (rode: python cloudflare/publicar.py --tmdb SUA_CHAVE)' }, 503, origin);
  const alvo = urlTmdb(url.pathname.slice('/tmdb/'.length), params, chave);
  if (!alvo) return json({ erro: 'consulta não permitida' }, 400, origin);
  let up;
  try {
    up = await fetch(alvo, {
      headers: { Accept: 'application/json', ...(chave.startsWith('eyJ') ? { Authorization: 'Bearer ' + chave } : {}) },
      cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': TMDB_CACHE_SEGUNDOS, '400-599': 0 } },
    });
  } catch {
    return json({ erro: 'não consegui falar com a TMDB' }, 502, origin);
  }
  if (up.status === 401) return json({ erro: 'a TMDB recusou a chave (confira TMDB_KEY)' }, 502, origin);
  if (up.status === 429) return json({ erro: 'limite de requisições da TMDB' }, 503, origin, { 'Retry-After': '5' });
  // 404 (série inexistente) passa adiante para o app tratar; outros erros viram 502
  if (!up.ok && up.status !== 404) return json({ erro: 'TMDB respondeu HTTP ' + up.status }, 502, origin);
  let corpo;
  try { corpo = await up.json(); } catch { return json({ erro: 'resposta inválida da TMDB' }, 502, origin); }
  return json(corpo, up.status, origin, { 'Cache-Control': 'public, max-age=300' });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const ehTmdb = url.pathname.startsWith('/tmdb/');
    if (request.method !== 'GET' || (url.pathname !== '/agenda' && !ehTmdb)) return json({ erro: 'rota inexistente' }, 404, origin);
    // navegador de outro site: recusa (chamadas sem Origin, como curl, passam para facilitar testes)
    if (origin && !SITES_PERMITIDOS.includes(origin)) return json({ erro: 'site não autorizado' }, 403, origin);
    if (ehTmdb) return tmdb(url, url.searchParams, env, origin);

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
