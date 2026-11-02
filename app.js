// ChiquinhaFlix — catálogo via TVMaze (sem chave) + player embed do SuperFlix.
const $ = id => document.getElementById(id);
const API = 'https://api.tvmaze.com';
const PLAYER = 'https://superflixapi.fun/serie/';

/* ---------- storage (tudo local, no navegador) ---------- */
const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/* ---------- utilidades ---------- */
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = html => { const d = new DOMParser().parseFromString(html || '', 'text/html'); return d.body.textContent || ''; };
const validImdb = id => /^tt\d+$/.test(id || '');
const hoje = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

async function api(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error('Erro ' + r.status + ' ao falar com a TVMaze');
  return r.json();
}

// só guardamos o necessário de cada série; sem IMDb não dá pra abrir no player
const slim = s => ({ id: s.id, name: s.name, imdb: s.externals && s.externals.imdb, poster: s.image && s.image.medium, year: (s.premiered || '').slice(0, 4), genres: s.genres || [], weight: s.weight || 0 });
const playable = s => validImdb(s.imdb);

/* ---------- estado ---------- */
let tab = 'populares', query = '', genre = '', cur = null;
let populares = null, hoje_ = null;

/* ---------- login ---------- */
function boot() {
  const nome = get('nome', '');
  if (!nome) { $('login').hidden = false; $('app').hidden = true; return; }
  $('login').hidden = true; $('app').hidden = false;
  $('welcome').textContent = 'Seja bem-vindo, ' + nome + '!';
  route();
}
$('entrar').onclick = () => { const n = $('nome').value.trim(); if (n) { set('nome', n); boot(); } };
$('nome').addEventListener('keydown', e => e.key === 'Enter' && $('entrar').click());
$('sair').onclick = () => { try { localStorage.removeItem('nome'); } catch {} location.hash = ''; boot(); };

/* ---------- roteamento por hash (#serie=169) ---------- */
function route() {
  const m = location.hash.match(/^#serie=(\d+)$/);
  if (m) openSerie(+m[1]); else showCatalog();
}
window.addEventListener('hashchange', () => { if (!$('app').hidden) route(); });

/* ---------- catálogo ---------- */
function card(s, extra) {
  const d = document.createElement('div');
  d.className = 'card';
  d.innerHTML = (s.poster ? '<img loading="lazy" src="' + esc(s.poster) + '" alt="">' : '<div class="noimg">' + esc(s.name) + '</div>')
    + '<p>' + esc(s.name) + (s.year ? ' <small>(' + esc(s.year) + ')</small>' : '') + (extra ? '<br><small>' + esc(extra) + '</small>' : '') + '</p>';
  d.onclick = () => { location.hash = '#serie=' + s.id; };
  return d;
}

async function loadPopulares() {
  if (populares) return populares;
  const pages = await Promise.all([0, 1, 2, 3].map(p => api('/shows?page=' + p)));
  populares = pages.flat().map(slim).filter(playable).sort((a, b) => b.weight - a.weight).slice(0, 150);
  return populares;
}

async function loadHoje() {
  if (hoje_) return hoje_;
  const d = hoje();
  const [web, tv] = await Promise.all([api('/schedule/web?date=' + d), api('/schedule?country=US&date=' + d)]);
  const map = new Map();
  [...web, ...tv].forEach(ep => {
    const s = ep._embedded && ep._embedded.show;
    if (s && !map.has(s.id)) map.set(s.id, slim(s));
  });
  hoje_ = [...map.values()].filter(playable).sort((a, b) => b.weight - a.weight);
  return hoje_;
}

function renderChips(list) {
  const gs = [...new Set(list.flatMap(s => s.genres))].sort();
  $('chips').innerHTML = '';
  if (!gs.length) return;
  ['', ...gs].forEach(g => {
    const b = document.createElement('button');
    b.textContent = g || 'Todos';
    if (g === genre) b.className = 'on';
    b.onclick = () => { genre = g; showCatalog(); };
    $('chips').appendChild(b);
  });
}

async function showCatalog() {
  $('view').hidden = true; $('catalog').hidden = false;
  $('player').innerHTML = '';
  $('grid').innerHTML = ''; $('chips').innerHTML = ''; $('msg').textContent = 'Carregando...';
  const nomes = { populares: 'Populares', hoje: 'No ar hoje', favoritos: 'Favoritos', historico: 'Continuar assistindo' };
  $('title').textContent = query ? 'Busca: ' + query : nomes[tab];
  let list = [], extra = () => '';
  try {
    if (query) {
      const r = await api('/search/shows?q=' + encodeURIComponent(query));
      list = r.map(x => slim(x.show)).filter(playable);
    } else if (tab === 'populares') { list = await loadPopulares(); renderChips(list); }
    else if (tab === 'hoje') { list = await loadHoje(); renderChips(list); }
    else if (tab === 'favoritos') list = get('favs', []);
    else if (tab === 'historico') { list = get('hist', []); extra = s => 'T' + s.s + ' · Ep' + s.e; }
    if (genre && !query && ['populares', 'hoje'].includes(tab)) list = list.filter(s => s.genres.includes(genre));
    list.forEach(s => $('grid').appendChild(card(s, extra(s))));
    $('msg').textContent = list.length ? '' : (tab === 'favoritos' ? 'Nenhum favorito ainda. Clique na ☆ dentro de uma série.' : tab === 'historico' ? 'Nada assistido ainda.' : 'Nada encontrado.');
  } catch (e) { $('msg').textContent = e.message; }
}

$('nav').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  [...$('nav').children].forEach(x => x.classList.toggle('on', x === b));
  tab = b.dataset.t; query = ''; genre = ''; $('q').value = '';
  if (location.hash) location.hash = ''; else showCatalog();
};
$('logo').onclick = () => $('nav').children[0].click();
let qt;
$('q').oninput = () => { clearTimeout(qt); qt = setTimeout(() => { query = $('q').value.trim(); genre = ''; if (location.hash) location.hash = ''; else showCatalog(); }, 400); };

/* ---------- player ---------- */
const seenKey = id => 'seen_' + id;

async function openSerie(id) {
  $('catalog').hidden = true; $('view').hidden = false;
  window.scrollTo(0, 0);
  $('player').innerHTML = ''; $('vTitle').textContent = 'Carregando...'; $('eps').innerHTML = ''; $('vSin').textContent = ''; $('epName').textContent = '';
  let show, eps;
  try { [show, eps] = await Promise.all([api('/shows/' + id), api('/shows/' + id + '/episodes')]); }
  catch (e) { $('vTitle').textContent = e.message; return; }
  const s = slim(show);
  if (!playable(s)) { $('vTitle').textContent = s.name + ' — sem ID do IMDb, não dá pra abrir no player.'; return; }

  const seasons = {};
  eps.forEach(ep => { if (ep.number != null) (seasons[ep.season] ||= []).push(ep); });
  const nums = Object.keys(seasons).map(Number).sort((a, b) => a - b);
  if (!nums.length) { $('vTitle').textContent = s.name + ' — sem episódios listados.'; return; }

  const last = get('hist', []).find(x => x.id === id);
  cur = { show: s, seasons, nums, s: last && seasons[last.s] ? last.s : nums[0], e: last ? last.e : 1 };
  $('vTitle').textContent = s.name;
  $('vSin').textContent = plain(show.summary);
  $('season').innerHTML = nums.map(n => '<option value="' + n + '">Temporada ' + n + ' (' + seasons[n].length + ' eps)</option>').join('');
  play();
}

const maxEp = sn => Math.max(...cur.seasons[sn].map(e => e.number));

function play() {
  const { show, s, e } = cur;
  $('season').value = s;
  // o iframe só recebe valores validados: IMDb (tt+dígitos) e números inteiros
  const url = PLAYER + show.imdb + '/' + (+s) + '/' + (+e);
  $('player').innerHTML = '<iframe src="' + url + '" allow="autoplay *; encrypted-media *; picture-in-picture *; fullscreen *; clipboard-write *; accelerometer *; gyroscope *" allowfullscreen frameborder="0" scrolling="no" style="width:100%;aspect-ratio:16/9;height:auto;max-width:100%;border:0;display:block;"></iframe>';

  const ep = cur.seasons[s].find(x => x.number === e);
  $('epName').textContent = 'T' + s + ' · Ep' + e + (ep && ep.name ? ' — ' + ep.name : '');

  const seen = get(seenKey(show.id), []);
  const tag = s + 'x' + e;
  if (!seen.includes(tag)) { seen.push(tag); set(seenKey(show.id), seen); }
  const h = get('hist', []).filter(x => x.id !== show.id);
  h.unshift({ ...show, s, e });
  set('hist', h.slice(0, 40));

  $('eps').innerHTML = '';
  cur.seasons[s].forEach(x => {
    const b = document.createElement('button');
    b.textContent = x.number;
    if (x.number === e) b.className = 'on'; else if (seen.includes(s + 'x' + x.number)) b.className = 'seen';
    b.onclick = () => { cur.e = x.number; play(); };
    $('eps').appendChild(b);
  });
  renderFav();
}

$('season').onchange = () => { cur.s = +$('season').value; cur.e = cur.seasons[cur.s][0].number; play(); };
$('next').onclick = () => {
  if (cur.e < maxEp(cur.s)) cur.e++;
  else { const i = cur.nums.indexOf(cur.s); if (cur.nums[i + 1]) { cur.s = cur.nums[i + 1]; cur.e = cur.seasons[cur.s][0].number; } }
  play();
};
$('prev').onclick = () => {
  if (cur.e > 1) cur.e--;
  else { const i = cur.nums.indexOf(cur.s); if (i > 0) { cur.s = cur.nums[i - 1]; cur.e = maxEp(cur.s); } }
  play();
};
$('back').onclick = () => { if (location.hash) history.back(); else showCatalog(); };

/* ---------- favoritos ---------- */
function renderFav() { $('fav').textContent = get('favs', []).some(x => x.id === cur.show.id) ? '★' : '☆'; }
$('fav').onclick = () => {
  let f = get('favs', []);
  f = f.some(x => x.id === cur.show.id) ? f.filter(x => x.id !== cur.show.id) : [cur.show, ...f];
  set('favs', f); renderFav();
};

boot();
