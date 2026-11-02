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
const gen = g => GENEROS[g] || g;
const STATUS = { Running: 'Em exibição', Ended: 'Finalizada', 'To Be Determined': 'A definir', 'In Development': 'Em desenvolvimento' };

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
  rating: s.rating && s.rating.average, status: s.status, summary: plain(s.summary).slice(0, 240)
});
const playable = s => validImdb(s.imdb);

/* ---------- estado ---------- */
let page = 'home', query = '', rendered = '', under = 'home', pending = null, cur = null;
let populares = null, hojeCache = null, heroShow = null;
const showCache = new Map();

const SECTIONS = ['home', 'list', 'view'];
function only(name) { SECTIONS.forEach(s => $(s).hidden = s !== name); $('msg').textContent = ''; }

/* ---------- login ---------- */
function boot() {
  const nome = get('nome', '');
  $('login').hidden = !!nome; $('app').hidden = !nome;
  if (nome) { rendered = ''; route(); }
}
$('loginForm').onsubmit = e => { e.preventDefault(); const n = $('nome').value.trim(); if (n) { set('nome', n); boot(); } };
$('sair').onclick = () => { try { localStorage.removeItem('nome'); } catch {} location.hash = ''; closeModal(); boot(); };
window.addEventListener('scroll', () => $('hdr').classList.toggle('solid', scrollY > 10));

/* ---------- busca ---------- */
const sbox = $('search');
$('searchBtn').onclick = () => { sbox.classList.add('open'); $('q').focus(); };
$('q').onblur = () => { if (!$('q').value) sbox.classList.remove('open'); };
let qt;
$('q').oninput = () => { clearTimeout(qt); qt = setTimeout(() => { query = $('q').value.trim(); go(); }, 400); };

/* ---------- roteamento: #serie=ID (detalhes) · #ver=ID (player) ---------- */
const pageKey = () => query ? 'q:' + query : page;
async function ensurePage() {
  const k = pageKey();
  under = (!query && page === 'home') ? 'home' : 'list';
  if (rendered !== k) { rendered = k; await (under === 'home' ? renderHome() : renderGrid()); }
  else only(under);
}
async function route() {
  const m = location.hash.match(/^#(serie|ver)=(\d+)$/);
  if (m && m[1] === 'ver') { closeModal(); return openPlayer(+m[2]); }
  await ensurePage();
  if (m) openModal(+m[2]); else closeModal();
}
window.addEventListener('hashchange', () => { if (!$('app').hidden) route(); });
const go = () => { if (location.hash) location.hash = ''; else route(); };

$('nav').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  [...$('nav').children].forEach(x => x.classList.toggle('on', x === b));
  page = b.dataset.p; query = ''; $('q').value = ''; sbox.classList.remove('open'); go();
};
$('logo').onclick = () => $('nav').children[0].click();

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
async function loadShow(id) {
  if (showCache.has(id)) return showCache.get(id);
  const [show, eps] = await Promise.all([api('/shows/' + id + '?embed=cast'), api('/shows/' + id + '/episodes')]);
  const seasons = {};
  eps.forEach(ep => { if (ep.number != null) (seasons[ep.season] ||= []).push(ep); });
  const d = {
    show, s: slim(show), seasons,
    nums: Object.keys(seasons).map(Number).sort((a, b) => a - b),
    cast: ((show._embedded && show._embedded.cast) || []).map(c => c.person.name)
  };
  showCache.set(id, d);
  return d;
}
async function backdrop(id) {
  try {
    const imgs = await api('/shows/' + id + '/images');
    const bg = imgs.find(i => i.type === 'background' && i.main) || imgs.find(i => i.type === 'background');
    return bg && bg.resolutions && bg.resolutions.original ? bg.resolutions.original.url : null;
  } catch { return null; }
}
const startPos = d => {
  const last = get('hist', []).find(x => x.id === d.s.id);
  return last && d.seasons[last.s] ? { s: last.s, e: last.e, resume: true, of: last.of } : { s: d.nums[0], e: d.seasons[d.nums[0]][0].number, resume: false };
};

/* ---------- componentes ---------- */
const open = id => { location.hash = '#serie=' + id; };

function tile(s, sub, port) {
  const d = document.createElement('div');
  d.className = 'tile' + (port ? ' port' : '');
  d.innerHTML = (s.poster ? '<img loading="lazy" src="' + esc(s.poster) + '" alt="">' : '<div class="noimg">' + esc(s.name) + '</div>')
    + '<div class="cap">' + esc(s.name) + '<small>' + esc(sub || [s.year, s.genres[0] && gen(s.genres[0])].filter(Boolean).join(' · ')) + '</small></div>';
  d.onclick = () => open(s.id);
  return d;
}

function row(title, list, opt = {}) {
  if (!list.length) return null;
  const r = document.createElement('div');
  r.className = 'row';
  r.innerHTML = '<h3>' + esc(title) + '</h3><div class="scroller"><button class="arrow l">‹</button><div class="track"></div><button class="arrow r">›</button></div>';
  const track = r.querySelector('.track');
  list.forEach((s, i) => {
    if (opt.top10) {
      const w = document.createElement('div'); w.className = 't10';
      w.innerHTML = '<span class="num">' + (i + 1) + '</span>'; w.appendChild(tile(s, '', true)); track.appendChild(w);
    } else if (opt.progress) {
      const c = document.createElement('div'); c.className = 'cell';
      c.appendChild(tile(s, opt.sub && opt.sub(s)));
      c.insertAdjacentHTML('beforeend', '<div class="prog"><i style="width:' + opt.progress(s) + '%"></i></div>');
      track.appendChild(c);
    } else track.appendChild(tile(s));
  });
  r.querySelector('.l').onclick = () => track.scrollBy({ left: -track.clientWidth * .85 });
  r.querySelector('.r').onclick = () => track.scrollBy({ left: track.clientWidth * .85 });
  return r;
}

const dots = parts => parts.filter(Boolean).map(p => '<span>' + esc(p) + '</span>').join('');
const inList = id => get('favs', []).some(x => x.id === id);
function toggleFav(s) {
  const f = get('favs', []);
  set('favs', f.some(x => x.id === s.id) ? f.filter(x => x.id !== s.id) : [s, ...f]);
}

/* ---------- início ---------- */
async function renderHome() {
  only('home'); window.scrollTo(0, 0);
  $('rows').innerHTML = ''; $('hero').hidden = true; $('msg').textContent = 'Carregando...';
  let list;
  try { list = await loadPopulares(); } catch (e) { $('msg').textContent = e.message; return; }
  $('msg').textContent = '';
  renderHero(list);

  const nome = get('nome', '');
  const rows = [];
  rows.push(row('Continuar assistindo como ' + nome, get('hist', []), { sub: s => 'T' + s.s + ':E' + s.e, progress: s => Math.min(100, Math.round(100 * s.e / (s.of || s.e))) }));
  rows.push(row('Minha lista', get('favs', [])));
  rows.push(row('Top 10 séries hoje', list.slice(0, 10), { top10: true }));
  rows.push(row('Em alta', list.slice(10, 40)));
  const cont = {};
  list.forEach(s => s.genres.forEach(g => cont[g] = (cont[g] || 0) + 1));
  Object.keys(cont).sort((a, b) => cont[b] - cont[a]).slice(0, 7).forEach(g =>
    rows.push(row(gen(g), list.filter(s => s.genres.includes(g)).slice(0, 24))));
  rows.forEach(r => r && $('rows').appendChild(r));
}

async function renderHero(list) {
  const idx = Math.floor(Math.random() * 15);
  const s = heroShow = list[idx];
  $('heroTitle').textContent = s.name;
  $('heroMeta').innerHTML = dots(['Série', s.genres[0] && gen(s.genres[0]), s.year]) + (s.rating ? '<span class="badge star">★ ' + esc(s.rating) + '</span>' : '');
  $('heroSin').textContent = s.summary;
  $('heroBg').style.backgroundImage = s.big ? 'url("' + s.big + '")' : '';
  const b = $('heroBadge');
  b.textContent = idx < 10 ? 'Nº ' + (idx + 1) + ' em séries hoje' : (s.rating ? 'Nota ' + s.rating : '');
  b.hidden = !b.textContent;
  $('hero').hidden = false;
  // melhorias assíncronas: imagem de fundo (paisagem) e nº de temporadas
  const [bg, seasons] = await Promise.all([backdrop(s.id), api('/shows/' + s.id + '/seasons').catch(() => null)]);
  if (heroShow !== s) return;
  if (bg) $('heroBg').style.backgroundImage = 'url("' + bg + '")';
  if (seasons && seasons.length) $('heroMeta').innerHTML = dots(['Série', s.genres[0] && gen(s.genres[0]), s.year, seasons.length + (seasons.length > 1 ? ' temporadas' : ' temporada')]) + (s.rating ? '<span class="badge star">★ ' + esc(s.rating) + '</span>' : '');
}
$('heroInfo').onclick = () => heroShow && open(heroShow.id);
$('heroPlay').onclick = () => heroShow && (location.hash = '#ver=' + heroShow.id);

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
  $('msg').textContent = list.length ? '' : (page === 'lista' && !query ? 'Sua lista está vazia. Abra uma série e clique no ＋.' : 'Nada encontrado.');
}

/* ---------- lista de episódios (modal e player) ---------- */
const seenKey = id => 'seen_' + id;
function renderEps(box, d, sn, activeE, pick) {
  const seen = get(seenKey(d.s.id), []);
  box.innerHTML = '';
  d.seasons[sn].forEach(x => {
    const el = document.createElement('div');
    el.className = 'ep' + (x.number === activeE ? ' on' : '') + (seen.includes(sn + 'x' + x.number) ? ' seen' : '');
    const img = x.image && x.image.medium;
    el.innerHTML = '<span class="n">' + esc(x.number) + '</span>'
      + '<div class="thumb">' + (img ? '<img loading="lazy" src="' + esc(img) + '" alt="">' : '') + '</div>'
      + '<div class="t"><b>' + esc(x.name) + '<span>' + (x.runtime ? esc(x.runtime) + 'min' : '') + '</span></b><p>' + esc(plain(x.summary)) + '</p></div>';
    el.onclick = () => pick(x.number);
    box.appendChild(el);
  });
}
const seasonOptions = d => d.nums.map(n => '<option value="' + n + '">Temporada ' + n + '</option>').join('');

/* ---------- modal de detalhes ---------- */
const modal = $('modal');
let mc = null;
function closeModal() { modal.hidden = true; document.body.classList.remove('lock'); mc = null; }
function dismiss() { if (location.hash) location.hash = ''; else closeModal(); }
$('mClose').onclick = dismiss;
modal.addEventListener('click', e => { if (e.target === modal) dismiss(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) dismiss(); });

async function openModal(id) {
  modal.hidden = false; document.body.classList.add('lock'); modal.scrollTop = 0;
  $('mTitle').textContent = 'Carregando...'; ['mMeta', 'mCur', 'mSin', 'mRight', 'mEps'].forEach(k => $(k).innerHTML = '');
  $('mProg').hidden = true; $('mBg').style.backgroundImage = ''; $('mSeason').innerHTML = '';
  let d;
  try { d = await loadShow(id); } catch (e) { $('mTitle').textContent = e.message; return; }
  if (modal.hidden || location.hash !== '#serie=' + id) return;
  const s = d.s;
  $('mTitle').textContent = s.name;
  if (!playable(s) || !d.nums.length) { $('mSin').textContent = !playable(s) ? 'Sem ID do IMDb, não dá pra abrir no player.' : 'Sem episódios listados.'; return; }

  const pos = startPos(d);
  mc = { d, s: pos.s, e: pos.e };
  $('mBg').style.backgroundImage = s.big ? 'url("' + s.big + '")' : '';
  backdrop(id).then(u => { if (u && mc && mc.d === d) $('mBg').style.backgroundImage = 'url("' + u + '")'; });

  const ep = d.seasons[pos.s].find(x => x.number === pos.e);
  if (pos.resume) {
    $('mProg').hidden = false;
    $('mProg').innerHTML = '<div class="bar"><i style="width:' + Math.min(100, Math.round(100 * pos.e / (pos.of || pos.e))) + '%"></i></div><span>T' + pos.s + ':E' + pos.e + '</span>';
  }
  $('mPlayTxt').textContent = pos.resume ? 'Continuar' : 'Assistir';
  $('mMeta').innerHTML = (s.year ? '<span class="dim">' + esc(s.year) + '</span>' : '')
    + '<span class="dim">' + d.nums.length + (d.nums.length > 1 ? ' temporadas' : ' temporada') + '</span>'
    + '<span class="badge">HD</span>' + (s.rating ? '<span class="badge star">★ ' + esc(s.rating) + '</span>' : '');
  if (pos.resume && ep) { $('mCur').textContent = 'T' + pos.s + ':E' + pos.e + ' "' + ep.name + '"'; $('mSin').textContent = plain(ep.summary) || plain(d.show.summary); }
  else $('mSin').textContent = plain(d.show.summary);
  $('mRight').innerHTML =
    (d.cast.length ? '<p><span class="k">Elenco:</span> ' + esc(d.cast.slice(0, 3).join(', ')) + (d.cast.length > 3 ? ', <i>mais</i>' : '') + '</p>' : '')
    + (s.genres.length ? '<p><span class="k">Gêneros:</span> ' + esc(s.genres.map(gen).join(', ')) + '</p>' : '')
    + (s.status ? '<p><span class="k">Esta série está:</span> ' + esc(STATUS[s.status] || s.status) + '</p>' : '');
  renderFavBtn();
  $('mSeason').innerHTML = seasonOptions(d); $('mSeason').value = pos.s;
  renderEps($('mEps'), d, pos.s, pos.resume ? pos.e : -1, e => { pending = { id, s: mc.s, e }; location.hash = '#ver=' + id; });
}
$('mSeason').onchange = () => {
  mc.s = +$('mSeason').value;
  const id = mc.d.s.id;
  renderEps($('mEps'), mc.d, mc.s, -1, e => { pending = { id, s: mc.s, e }; location.hash = '#ver=' + id; });
};
$('mPlay').onclick = () => { if (!mc) return; pending = { id: mc.d.s.id, s: mc.s, e: mc.e }; location.hash = '#ver=' + mc.d.s.id; };
function renderFavBtn() { if (mc) $('mFav').textContent = inList(mc.d.s.id) ? '✓' : '＋'; }
$('mFav').onclick = () => { if (!mc) return; toggleFav(mc.d.s); renderFavBtn(); rendered = ''; };

/* ---------- player ---------- */
async function openPlayer(id) {
  only('view'); window.scrollTo(0, 0);
  $('player').innerHTML = ''; $('vTitle').textContent = 'Carregando...'; $('eps').innerHTML = ''; $('epName').textContent = '';
  let d;
  try { d = await loadShow(id); } catch (e) { $('vTitle').textContent = e.message; return; }
  if (!playable(d.s) || !d.nums.length) { $('vTitle').textContent = d.s.name + ' — não dá pra abrir no player.'; return; }
  const pos = pending && pending.id === id ? pending : startPos(d);
  pending = null;
  cur = { d, s: pos.s, e: pos.e };
  $('vTitle').textContent = d.s.name;
  $('season').innerHTML = seasonOptions(d);
  play(false);
}

const maxEp = sn => Math.max(...cur.d.seasons[sn].map(e => e.number));

function play(scroll = true) {
  const { d, s, e } = cur;
  $('season').value = s;
  // o iframe só recebe valores validados: IMDb (tt+dígitos) e inteiros
  const url = PLAYER + d.s.imdb + '/' + (+s) + '/' + (+e);
  $('player').innerHTML = '<iframe src="' + url + '" allow="autoplay *; encrypted-media *; picture-in-picture *; fullscreen *; clipboard-write *; accelerometer *; gyroscope *" allowfullscreen frameborder="0" scrolling="no" style="width:100%;aspect-ratio:16/9;height:auto;max-width:100%;border:0;display:block;"></iframe>';
  const ep = d.seasons[s].find(x => x.number === e);
  $('epName').textContent = 'T' + s + ':E' + e + (ep && ep.name ? ' — ' + ep.name : '');

  const seen = get(seenKey(d.s.id), []);
  const tag = s + 'x' + e;
  if (!seen.includes(tag)) { seen.push(tag); set(seenKey(d.s.id), seen); }
  const h = get('hist', []).filter(x => x.id !== d.s.id);
  h.unshift({ ...d.s, s, e, of: d.seasons[s].length });
  set('hist', h.slice(0, 40));
  rendered = '';   // a home precisa refletir o novo "continuar assistindo"

  renderEps($('eps'), d, s, e, n => { cur.e = n; play(); });
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('season').onchange = () => { cur.s = +$('season').value; cur.e = cur.d.seasons[cur.s][0].number; play(false); };
$('next').onclick = () => {
  if (cur.e < maxEp(cur.s)) cur.e++;
  else { const i = cur.d.nums.indexOf(cur.s); if (cur.d.nums[i + 1]) { cur.s = cur.d.nums[i + 1]; cur.e = cur.d.seasons[cur.s][0].number; } }
  play(false);
};
$('prev').onclick = () => {
  if (cur.e > 1) cur.e--;
  else { const i = cur.d.nums.indexOf(cur.s); if (i > 0) { cur.s = cur.d.nums[i - 1]; cur.e = maxEp(cur.s); } }
  play(false);
};
$('back').onclick = () => { if (location.hash) history.back(); else route(); };

boot();
