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
const GENEROS = { Drama: 'Dramas', Comedy: 'Comédias', Crime: 'Crime', 'Science-Fiction': 'Ficção científica', Action: 'Ação', Adventure: 'Aventura', Fantasy: 'Fantasia', Horror: 'Terror', Thriller: 'Suspense', Romance: 'Romance', Mystery: 'Mistério', Anime: 'Animes', Family: 'Família', Supernatural: 'Sobrenatural', Medical: 'Medicina', Legal: 'Tribunais', War: 'Guerra', Western: 'Faroeste', Espionage: 'Espionagem', History: 'História', Music: 'Música', Nature: 'Natureza', Food: 'Culinária' };

async function api(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error('Erro ' + r.status + ' ao falar com a TVMaze');
  return r.json();
}

// só guardamos o necessário; sem IMDb não dá pra abrir no player
const slim = s => ({
  id: s.id, name: s.name, imdb: s.externals && s.externals.imdb,
  poster: s.image && s.image.medium, big: s.image && s.image.original,
  year: (s.premiered || '').slice(0, 4), genres: s.genres || [], weight: s.weight || 0,
  rating: s.rating && s.rating.average, summary: plain(s.summary).slice(0, 240)
});
const playable = s => validImdb(s.imdb);

/* ---------- estado ---------- */
let page = 'home', query = '', cur = null;
let populares = null, hojeCache = null;

const SECTIONS = ['home', 'list', 'view'];
function only(name) { SECTIONS.forEach(s => $(s).hidden = s !== name); $('msg').textContent = ''; }

/* ---------- login ---------- */
function boot() {
  const nome = get('nome', '');
  $('login').hidden = !!nome; $('app').hidden = !nome;
  if (nome) route();
}
$('loginForm').onsubmit = e => { e.preventDefault(); const n = $('nome').value.trim(); if (n) { set('nome', n); boot(); } };
$('sair').onclick = () => { try { localStorage.removeItem('nome'); } catch {} location.hash = ''; boot(); };
window.addEventListener('scroll', () => $('hdr').classList.toggle('solid', scrollY > 20));

/* ---------- roteamento (#serie=169) ---------- */
function route() {
  const m = location.hash.match(/^#serie=(\d+)$/);
  if (m) return openSerie(+m[1]);
  if (query) return renderGrid();
  if (page === 'home') return renderHome();
  renderGrid();
}
window.addEventListener('hashchange', () => { if (!$('app').hidden) route(); });
const go = () => { if (location.hash) location.hash = ''; else route(); };

$('nav').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  [...$('nav').children].forEach(x => x.classList.toggle('on', x === b));
  page = b.dataset.p; query = ''; $('q').value = ''; go();
};
$('logo').onclick = () => $('nav').children[0].click();
let qt;
$('q').oninput = () => { clearTimeout(qt); qt = setTimeout(() => { query = $('q').value.trim(); go(); }, 400); };

/* ---------- dados ---------- */
async function loadPopulares() {
  if (populares) return populares;
  const pages = await Promise.all([0, 1, 2, 3].map(p => api('/shows?page=' + p)));
  populares = pages.flat().map(slim).filter(playable).sort((a, b) => b.weight - a.weight).slice(0, 150);
  return populares;
}
async function loadHoje() {
  if (hojeCache) return hojeCache;
  const d = hoje();
  const [web, tv] = await Promise.all([api('/schedule/web?date=' + d), api('/schedule?country=US&date=' + d)]);
  const map = new Map();
  [...web, ...tv].forEach(ep => { const s = ep._embedded && ep._embedded.show; if (s && !map.has(s.id)) map.set(s.id, slim(s)); });
  hojeCache = [...map.values()].filter(playable).sort((a, b) => b.weight - a.weight);
  return hojeCache;
}

/* ---------- componentes ---------- */
const open = id => { location.hash = '#serie=' + id; };

function tile(s, sub, port) {
  const d = document.createElement('div');
  d.className = 'tile' + (port ? ' port' : '');
  d.innerHTML = (s.poster ? '<img loading="lazy" src="' + esc(s.poster) + '" alt="">' : '<div class="noimg">' + esc(s.name) + '</div>')
    + '<div class="cap">' + esc(s.name) + '<small>' + esc(sub || [s.year, (s.genres[0] && (GENEROS[s.genres[0]] || s.genres[0]))].filter(Boolean).join(' · ')) + '</small></div>';
  d.onclick = () => open(s.id);
  return d;
}

function row(title, list, opt = {}) {
  if (!list.length) return null;
  const r = document.createElement('div');
  r.className = 'row' + (opt.top10 ? ' top10' : '');
  r.innerHTML = '<h3>' + esc(title) + '</h3><div class="scroller"><button class="arrow l">‹</button><div class="track"></div><button class="arrow r">›</button></div>';
  const track = r.querySelector('.track');
  list.forEach((s, i) => {
    if (opt.top10) {
      const w = document.createElement('div'); w.className = 't10';
      w.innerHTML = '<span class="num">' + (i + 1) + '</span>'; w.appendChild(tile(s, '', true)); track.appendChild(w);
    } else {
      const t = tile(s, opt.sub && opt.sub(s));
      if (opt.progress) t.insertAdjacentHTML('beforeend', '<div class="prog"><i style="width:' + opt.progress(s) + '%"></i></div>');
      track.appendChild(t);
    }
  });
  r.querySelector('.l').onclick = () => track.scrollBy({ left: -track.clientWidth * .85 });
  r.querySelector('.r').onclick = () => track.scrollBy({ left: track.clientWidth * .85 });
  return r;
}

/* ---------- início ---------- */
let heroShow = null;
async function renderHome() {
  only('home'); window.scrollTo(0, 0);
  $('rows').innerHTML = ''; $('hero').hidden = true; $('msg').textContent = 'Carregando...';
  let list;
  try { list = await loadPopulares(); } catch (e) { $('msg').textContent = e.message; return; }
  $('msg').textContent = '';
  await renderHero(list.slice(0, 15));

  const rows = [];
  const hist = get('hist', []);
  rows.push(row('Continuar assistindo', hist, { sub: s => 'T' + s.s + ' · Ep' + s.e, progress: s => Math.min(100, Math.round(100 * s.e / (s.of || s.e))) }));
  rows.push(row('Minha lista', get('favs', [])));
  rows.push(row('Top 10 séries hoje', list.slice(0, 10), { top10: true }));
  rows.push(row('Em alta', list.slice(10, 40)));
  const cont = {};
  list.forEach(s => s.genres.forEach(g => cont[g] = (cont[g] || 0) + 1));
  Object.keys(cont).sort((a, b) => cont[b] - cont[a]).slice(0, 7).forEach(g =>
    rows.push(row(GENEROS[g] || g, list.filter(s => s.genres.includes(g)).slice(0, 24))));
  rows.forEach(r => r && $('rows').appendChild(r));
}

async function renderHero(cands) {
  heroShow = cands[Math.floor(Math.random() * cands.length)];
  const s = heroShow;
  $('heroTitle').textContent = s.name;
  $('heroMeta').innerHTML = (s.rating ? '<b>★ ' + esc(s.rating) + '</b> · ' : '') + esc([s.year, ...s.genres.slice(0, 3).map(g => GENEROS[g] || g)].filter(Boolean).join(' · '));
  $('heroSin').textContent = s.summary;
  $('heroBg').style.backgroundImage = s.big ? 'url("' + s.big + '")' : '';
  $('hero').hidden = false;
  // a TVMaze às vezes tem imagem de fundo (paisagem) para a série
  try {
    const imgs = await api('/shows/' + s.id + '/images');
    const bg = imgs.find(i => i.type === 'background' && i.main) || imgs.find(i => i.type === 'background');
    if (bg && bg.resolutions && bg.resolutions.original) $('heroBg').style.backgroundImage = 'url("' + bg.resolutions.original.url + '")';
  } catch {}
}
$('heroPlay').onclick = $('heroInfo').onclick = () => heroShow && open(heroShow.id);

/* ---------- grade (busca / no ar hoje / minha lista) ---------- */
async function renderGrid() {
  only('list'); window.scrollTo(0, 0);
  $('grid').innerHTML = ''; $('msg').textContent = 'Carregando...';
  $('listTitle').textContent = query ? 'Resultados para "' + query + '"' : page === 'hoje' ? 'No ar hoje' : 'Minha lista';
  let list = [];
  try {
    if (query) list = (await api('/search/shows?q=' + encodeURIComponent(query))).map(x => slim(x.show)).filter(playable);
    else if (page === 'hoje') list = await loadHoje();
    else list = get('favs', []);
  } catch (e) { $('msg').textContent = e.message; return; }
  list.forEach(s => $('grid').appendChild(tile(s)));
  $('msg').textContent = list.length ? '' : (page === 'lista' && !query ? 'Sua lista está vazia. Abra uma série e clique em "＋ Minha lista".' : 'Nada encontrado.');
}

/* ---------- série / player ---------- */
const seenKey = id => 'seen_' + id;

async function openSerie(id) {
  only('view'); window.scrollTo(0, 0);
  $('player').innerHTML = ''; $('vTitle').textContent = 'Carregando...'; $('eps').innerHTML = ''; $('vSin').textContent = ''; $('vMeta').textContent = ''; $('epName').textContent = '';
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
  $('vMeta').innerHTML = (s.rating ? '<b>★ ' + esc(s.rating) + '</b> · ' : '') + esc([s.year, ...s.genres.slice(0, 3).map(g => GENEROS[g] || g)].filter(Boolean).join(' · '));
  $('vSin').textContent = plain(show.summary);
  $('season').innerHTML = nums.map(n => '<option value="' + n + '">Temporada ' + n + '</option>').join('');
  play(false);
}

const maxEp = sn => Math.max(...cur.seasons[sn].map(e => e.number));

function play(scroll = true) {
  const { show, s, e } = cur;
  $('season').value = s;
  // o iframe só recebe valores validados: IMDb (tt+dígitos) e inteiros
  const url = PLAYER + show.imdb + '/' + (+s) + '/' + (+e);
  $('player').innerHTML = '<iframe src="' + url + '" allow="autoplay *; encrypted-media *; picture-in-picture *; fullscreen *; clipboard-write *; accelerometer *; gyroscope *" allowfullscreen frameborder="0" scrolling="no" style="width:100%;aspect-ratio:16/9;height:auto;max-width:100%;border:0;display:block;"></iframe>';
  const ep = cur.seasons[s].find(x => x.number === e);
  $('epName').textContent = 'T' + s + ' · Ep' + e + (ep && ep.name ? ' — ' + ep.name : '');

  const seen = get(seenKey(show.id), []);
  const tag = s + 'x' + e;
  if (!seen.includes(tag)) { seen.push(tag); set(seenKey(show.id), seen); }
  const h = get('hist', []).filter(x => x.id !== show.id);
  h.unshift({ ...show, s, e, of: cur.seasons[s].length });
  set('hist', h.slice(0, 40));

  $('eps').innerHTML = '';
  cur.seasons[s].forEach(x => {
    const d = document.createElement('div');
    d.className = 'ep' + (x.number === e ? ' on' : '') + (seen.includes(s + 'x' + x.number) ? ' seen' : '');
    const img = x.image && x.image.medium;
    d.innerHTML = '<span class="n">' + esc(x.number) + '</span>'
      + '<div class="thumb">' + (img ? '<img loading="lazy" src="' + esc(img) + '" alt="">' : '') + '</div>'
      + '<div class="t"><b>' + esc(x.name) + '<span>' + (x.runtime ? esc(x.runtime) + ' min' : '') + '</span></b><p>' + esc(plain(x.summary)) + '</p></div>';
    d.onclick = () => { cur.e = x.number; play(); };
    $('eps').appendChild(d);
  });
  renderFav();
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('season').onchange = () => { cur.s = +$('season').value; cur.e = cur.seasons[cur.s][0].number; play(false); };
$('next').onclick = () => {
  if (cur.e < maxEp(cur.s)) cur.e++;
  else { const i = cur.nums.indexOf(cur.s); if (cur.nums[i + 1]) { cur.s = cur.nums[i + 1]; cur.e = cur.seasons[cur.s][0].number; } }
  play(false);
};
$('prev').onclick = () => {
  if (cur.e > 1) cur.e--;
  else { const i = cur.nums.indexOf(cur.s); if (i > 0) { cur.s = cur.nums[i - 1]; cur.e = maxEp(cur.s); } }
  play(false);
};
$('back').onclick = () => { if (location.hash) history.back(); else route(); };

/* ---------- minha lista ---------- */
function renderFav() { $('fav').textContent = get('favs', []).some(x => x.id === cur.show.id) ? '✓ Na minha lista' : '＋ Minha lista'; }
$('fav').onclick = () => {
  let f = get('favs', []);
  f = f.some(x => x.id === cur.show.id) ? f.filter(x => x.id !== cur.show.id) : [cur.show, ...f];
  set('favs', f); renderFav();
};

boot();
