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
// /canais devolve a lista de canais ao vivo do Rei dos Embeds (reidosembeds.lat, a mesma origem
// dos canais do SuperFlix), já com o programa que está passando agora e os próximos.
// /agenda usa o SuperFlix; se ele falhar (limite, queda), usa a agenda do Rei dos Embeds, que tem
// os mesmos eventos. O campo "fonte" da resposta diz de onde veio.
//
// As respostas ficam em cache na Cloudflare por 5 minutos, então muitas pessoas (ou muitas
// aberturas) viram uma única chamada a cada 5 minutos, o que protege contra o limite deles.

const ORIGEM = 'https://superflixapi.fun/lista?category=eventos&format=json';
const ORIGEM_RDE_EVENTOS = 'https://reidosembeds.lat/api/eventos';
const ORIGEM_RDE_CANAIS = 'https://reidosembeds.lat/api/channels';
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
    .filter(m => (!m.type || m.type === 'channel') && CANAL_OK.test(m.slug || ''))   // o Rei dos Embeds não manda "type"
    .map(m => [m.provider || m.slug, m.slug, m.quality || '']);
  return {
    i: id, t: e.title || id, st: e.status || 'upcoming', sp: e.category || '', c: e.competition || '',
    d: e.start_time || '', a: e.time1_name || '', b: e.time2_name || '',
    la: e.time1 || '', lb: e.time2 || '', el: e.event_logo || '', e: canais,
  };
}

const txt = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);
// canal do Rei dos Embeds -> {s: id, n: nome, c: categoria, a: 1 se adulto, np: no ar agora, pr: % do programa, nx: próximos}
function compactaCanal(c) {
  if (!c || !CANAL_OK.test(c.id || '') || c.is_active === false) return null;
  const prox = (Array.isArray(c.now_playing_next_programmes) ? c.now_playing_next_programmes : []).slice(0, 3)
    .map(p => [txt(p && p.title, 80), Number(p && p.start_timestamp) || 0, Number(p && p.end_timestamp) || 0]).filter(p => p[0] && p[1]);
  const pr = Number(c.now_playing_progress);
  return {
    s: c.id, n: txt(c.name, 60) || c.id, c: txt(c.category, 40), a: c.category === 'Adulto' ? 1 : 0,
    np: c.now_playing_has_guide ? txt(c.now_playing_title, 80) : '', pr: pr >= 0 && pr <= 100 ? Math.round(pr) : 0, nx: prox,
  };
}

// baixa um JSON (com cache de 5 min na Cloudflare só para respostas boas) e já classifica a falha
async function baixa(url, nome, ttl = CACHE_SEGUNDOS) {
  let up;
  try {
    up = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChiquinhaFlix-Worker/1.0)', Accept: 'application/json' },
      cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': ttl, '400-599': 0 } },
    });
  } catch {
    return { erro: { erro: 'não consegui falar com ' + nome }, status: 502 };
  }
  if (up.status === 429) return { erro: { erro: 'limite de requisições de ' + nome, retry_after: Number(up.headers.get('retry-after')) || 10 }, status: 503, retry: true };
  if (!up.ok) return { erro: { erro: nome + ' respondeu HTTP ' + up.status }, status: 502 };
  let corpo;
  try { corpo = await up.json(); } catch { return { erro: { erro: 'resposta inválida de ' + nome }, status: 502 }; }
  const lista = Array.isArray(corpo) ? corpo : corpo && corpo.data;   // algumas rotas devolvem a lista pura
  if (!Array.isArray(lista)) return { erro: { erro: 'formato inesperado de ' + nome }, status: 502 };
  return { dados: lista };
}

// calendário de episódios do SuperFlix (calendario.php): séries, animes e doramas com data de estreia.
// Só passam datas, IDs numéricos da TMDB e caminhos de imagem seguros; o resto é descartado.
const ORIGEM_CALENDARIO = 'https://superflixapi.fun/calendario.php';
const CALENDARIO_CACHE_SEGUNDOS = 3600;
const IMG_OK = /^\/[A-Za-z0-9_.-]{1,80}$/;
function compactaEpisodio(x) {
  if (!x || !/^\d{1,9}$/.test(String(x.tmdb_id || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(x.air_date || '')) return null;
  return {
    id: String(x.tmdb_id), t: txt(x.title, 120), ep: txt(x.episode, 120), s: Number(x.season) || 0, n: Number(x.number) || 0, d: x.air_date,
    ty: [2, 3, 5].includes(Number(x.type)) ? Number(x.type) : 2,      // 2 série, 3 anime, 5 dorama
    p: IMG_OK.test(x.poster || '') ? x.poster : '',
  };
}
async function calendario(origin, passadoParam) {
  const r = await baixa(ORIGEM_CALENDARIO, 'SuperFlix', CALENDARIO_CACHE_SEGUNDOS);
  if (!r.dados) return json(r.erro, r.status, origin, r.retry ? { 'Retry-After': '10' } : {});
  // ?passado=N pede também os N dias anteriores (o calendário do app mostra o mês inteiro); padrão 4, máximo 60
  const passado = /^\d{1,2}$/.test(passadoParam || '') ? Math.min(60, Number(passadoParam)) : 4;
  const dia = 86400000, agora = Date.now();
  const de = new Date(agora - passado * dia).toISOString().slice(0, 10), ate = new Date(agora + 35 * dia).toISOString().slice(0, 10);
  const itens = r.dados.map(compactaEpisodio).filter(x => x && x.d >= de && x.d <= ate);
  return json({ gerado: new Date().toISOString(), itens }, 200, origin, { 'Cache-Control': 'public, max-age=300' });
}

async function agenda(origin) {
  let r = await baixa(ORIGEM, 'SuperFlix'), fonte = 'superflix';
  if (!r.dados) {
    const alt = await baixa(ORIGEM_RDE_EVENTOS, 'Rei dos Embeds');
    if (!alt.dados) return json(r.erro, r.status, origin, r.retry ? { 'Retry-After': '10' } : {});   // devolve o erro do SuperFlix
    r = alt; fonte = 'rde';
  }
  return json({ gerado: new Date().toISOString(), fonte, eventos: r.dados.map(compacta).filter(Boolean) }, 200, origin, { 'Cache-Control': 'public, max-age=60' });
}

async function canais(origin) {
  const r = await baixa(ORIGEM_RDE_CANAIS, 'Rei dos Embeds');
  if (!r.dados) return json(r.erro, r.status, origin, r.retry ? { 'Retry-After': '10' } : {});
  return json({ gerado: new Date().toISOString(), canais: r.dados.map(compactaCanal).filter(Boolean) }, 200, origin, { 'Cache-Control': 'public, max-age=60' });
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
    const rota = url.pathname;
    if (request.method !== 'GET' || (rota !== '/agenda' && rota !== '/canais' && rota !== '/calendario' && !ehTmdb)) return json({ erro: 'rota inexistente' }, 404, origin);
    // navegador de outro site: recusa (chamadas sem Origin, como curl, passam para facilitar testes)
    if (origin && !SITES_PERMITIDOS.includes(origin)) return json({ erro: 'site não autorizado' }, 403, origin);
    if (ehTmdb) return tmdb(url, url.searchParams, env, origin);
    return rota === '/canais' ? canais(origin) : rota === '/calendario' ? calendario(origin, url.searchParams.get('passado')) : agenda(origin);
  },
};
