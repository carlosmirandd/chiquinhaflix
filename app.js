// ChiquinhaFlix — catálogo via TVMaze (sem chave) + player embed do SuperFlix.
// Tudo roda no navegador: favoritos, histórico e traduções ficam no localStorage.
const $ = id => document.getElementById(id);
const API = 'https://api.tvmaze.com';
const PLAYER = 'https://superflixapi.fun/serie/';

/* ---------- storage ---------- */
const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/* ---------- utilidades ---------- */
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = html => { const d = new DOMParser().parseFromString(html || '', 'text/html'); return d.body.textContent || ''; };
const validImdb = id => /^tt\d+$/.test(id || '');
const hoje = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const GENEROS = { Drama: 'Dramas', Comedy: 'Comédias', Crime: 'Crime', 'Science-Fiction': 'Ficção científica', Action: 'Ação', Adventure: 'Aventura', Fantasy: 'Fantasia', Horror: 'Terror', Thriller: 'Suspense', Romance: 'Romance', Mystery: 'Mistério', Anime: 'Animes', Family: 'Família', Supernatural: 'Sobrenatural', Medical: 'Medicina', Legal: 'Tribunais', War: 'Guerra', Western: 'Faroeste', Espionage: 'Espionagem', History: 'História', Music: 'Música', Nature: 'Natureza', Food: 'Culinária', Sports: 'Esportes', Children: 'Infantil', Travel: 'Viagem', DIY: 'Faça você mesmo' };
const gen = g => GENEROS[g] || g;
const STATUS = { Running: 'Em exibição', Ended: 'Finalizada', 'To Be Determined': 'A definir', 'In Development': 'Em desenvolvimento' };
const PLUS = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

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

/* ---------- português ----------
   A TVMaze só tem inglês. Duas gambiarras:
   1) título em português do Brasil: vem do /akas da própria TVMaze (quando existe);
   2) sinopses e nomes de episódio: tradução automática (endpoint público do Google
      Tradutor; se falhar, MyMemory; se falhar, fica o original). Cache no localStorage. */
const TR_KEY = 'tr_pt_v1';
const trc = get(TR_KEY, {});
let trTimer;
const hsh = s => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36) + s.length; };
function trSave() {
  clearTimeout(trTimer);
  trTimer = setTimeout(() => {
    const k = Object.keys(trc);
    if (k.length > 900) k.slice(0, k.length - 700).forEach(x => delete trc[x]);
    set(TR_KEY, trc);
  }, 800);
}
function pedacos(text, max) {
  const out = []; let cur = '';
  text.split(/(?<=[.!?])\s+/).forEach(s => { if ((cur + ' ' + s).length > max && cur) { out.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s; });
  if (cur) out.push(cur);
  return out.flatMap(p => p.length > max ? p.match(new RegExp('.{1,' + max + '}', 'g')) : [p]);
}
async function viaGoogle(text) {
  const out = [];
  for (const p of pedacos(text, 1400)) {
    const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pt&dt=t&q=' + encodeURIComponent(p));
    if (!r.ok) throw new Error('google ' + r.status);
    out.push((await r.json())[0].map(x => x[0]).join(''));
  }
  return out.join(' ');
}
async function viaMyMemory(text) {
  const out = [];
  for (const p of pedacos(text, 450)) {
    const r = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(p) + '&langpair=en|pt-BR');
    const j = await r.json();
    if (!r.ok || j.quotaFinished || !j.responseData) throw new Error('mymemory');
    out.push(j.responseData.translatedText);
  }
  return out.join(' ');
}
const emVoo = new Map();
async function pt(text) {
  text = (text || '').trim();
  if (!text) return '';
  const k = hsh(text);
  if (trc[k]) return trc[k];
  if (emVoo.has(k)) return emVoo.get(k);
  const p = (async () => {
    let r = null;
    try { r = await viaGoogle(text); } catch { try { r = await viaMyMemory(text); } catch {} }
    if (!r) return text;
    trc[k] = r; trSave();
    return r;
  })().finally(() => emVoo.delete(k));
  emVoo.set(k, p);
  return p;
}
// traduz uma lista com no máximo 3 chamadas ao mesmo tempo
async function ptMany(items, apply) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const it = items[i++]; apply(it, await pt(it.text)); } };
  await Promise.all([worker(), worker(), worker()]);
}
const akaCache = new Map();
async function titulo(id, fallback) {
  if (akaCache.has(id)) return akaCache.get(id);
  let t = fallback;
  try {
    const a = await api('/shows/' + id + '/akas');
    const br = a.find(x => x.country && x.country.code === 'BR') || a.find(x => x.country && x.country.code === 'PT');
    if (br && br.name) t = br.name;
  } catch {}
  akaCache.set(id, t);
  return t;
}

/* ---------- estado ---------- */
let page = 'home', query = '', gsel = '', rendered = '', under = 'home', pending = null, cur = null;
let populares = null, hojeCache = null, heroShow = null;
const showCache = new Map();
const TITULOS = { home: 'Início', hoje: 'No ar hoje', lista: 'Minha lista', busca: 'Buscar' };

const SECTIONS = ['home', 'list', 'view'];
function only(name) { SECTIONS.forEach(s => $(s).hidden = s !== name); $('msg').textContent = ''; }
window.addEventListener('scroll', () => $('hdr').classList.toggle('solid', scrollY > 10));

function syncUI() {
  const ativo = page === 'genero' ? 'home' : page;
  document.querySelectorAll('#nav button, #tabbar button').forEach(b => b.classList.toggle('on', b.dataset.p === ativo));
  $('pageTitle').textContent = page === 'genero' ? gen(gsel) : TITULOS[page];
  document.body.classList.toggle('on-search', page === 'busca');
}

/* ---------- navegação ---------- */
const sbox = $('search');
$('searchBtn').onclick = () => { sbox.classList.add('open'); $('q').focus(); };
$('q').onblur = () => { if (!$('q').value) sbox.classList.remove('open'); };
let qt;
const onType = el => () => { clearTimeout(qt); qt = setTimeout(() => { query = el.value.trim(); go(); }, 400); };
$('q').oninput = onType($('q'));
$('q2').oninput = onType($('q2'));

const pageKey = () => page === 'busca' ? 'busca:' + query : query ? 'q:' + query : page === 'genero' ? 'g:' + gsel : page;
async function ensurePage() {
  const k = pageKey();
  under = (!query && page === 'home') ? 'home' : 'list';
  syncUI();
  if (rendered !== k) { rendered = k; await (under === 'home' ? renderHome() : renderGrid()); }
  else only(under);
}
async function route() {
  const m = location.hash.match(/^#(serie|ver)=(\d+)$/);
  if (m && m[1] === 'ver') { closeModal(); return openPlayer(+m[2]); }
  await ensurePage();
  if (m) openModal(+m[2]); else closeModal();
}
window.addEventListener('hashchange', route);
const go = () => { if (location.hash) location.hash = ''; else route(); };

function navClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  page = b.dataset.p; query = ''; gsel = ''; $('q').value = ''; $('q2').value = ''; sbox.classList.remove('open');
  go();
}
$('nav').onclick = navClick;
$('tabbar').onclick = navClick;
$('logo').onclick = () => { page = 'home'; query = ''; $('q').value = ''; go(); };

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

function itemLista(s) {
  const d = document.createElement('div');
  d.className = 'li';
  d.innerHTML = '<div class="th">' + (s.poster ? '<img loading="lazy" src="' + esc(s.poster) + '" alt="">' : '') + '</div><b>' + esc(s.name) + '</b><span class="go">▶</span>';
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
      const t = tile(s, opt.sub && opt.sub(s));
      t.insertAdjacentHTML('beforeend', '<span class="playov">▶</span>');
      c.appendChild(t);
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
  rendered = '';
}

/* ---------- início ---------- */
async function renderHome() {
  only('home'); window.scrollTo(0, 0);
  $('rows').innerHTML = ''; $('chips').innerHTML = ''; $('hero').hidden = true; $('msg').textContent = 'Carregando...';
  let list;
  try { list = await loadPopulares(); } catch (e) { $('msg').textContent = e.message; return; }
  $('msg').textContent = '';

  const cont = {};
  list.forEach(s => s.genres.forEach(g => cont[g] = (cont[g] || 0) + 1));
  const top = Object.keys(cont).sort((a, b) => cont[b] - cont[a]);
  top.slice(0, 12).forEach(g => {
    const b = document.createElement('button');
    b.textContent = gen(g);
    b.onclick = () => { page = 'genero'; gsel = g; query = ''; go(); };
    $('chips').appendChild(b);
  });

  renderHero(list);
  const rows = [];
  rows.push(row('Continuar assistindo', get('hist', []), { sub: s => 'T' + s.s + ':E' + s.e, progress: s => Math.min(100, Math.round(100 * s.e / (s.of || s.e))) }));
  rows.push(row('Minha lista', get('favs', [])));
  rows.push(row('Top 10 séries hoje', list.slice(0, 10), { top10: true }));
  rows.push(row('Em alta', list.slice(10, 40)));
  top.slice(0, 7).forEach(g => rows.push(row(gen(g), list.filter(s => s.genres.includes(g)).slice(0, 24))));
  rows.forEach(r => r && $('rows').appendChild(r));
}

function metaHero(s, temporadas) {
  return dots(['Série', s.genres[0] && gen(s.genres[0]), s.year, temporadas && temporadas + (temporadas > 1 ? ' temporadas' : ' temporada')])
    + (s.rating ? '<span class="badge star">★ ' + esc(s.rating) + '</span>' : '');
}
async function renderHero(list) {
  const idx = Math.floor(Math.random() * 15);
  const s = heroShow = list[idx];
  const hero = $('hero');
  hero.style.setProperty('--poster', s.big ? 'url("' + s.big + '")' : 'none');
  hero.style.removeProperty('--back');
  $('heroTitle').textContent = s.name;
  $('heroMeta').innerHTML = metaHero(s, 0);
  $('heroSin').textContent = s.summary;
  const b = $('heroBadge');
  b.textContent = idx < 10 ? 'Nº ' + (idx + 1) + ' em séries hoje' : (s.rating ? 'Nota ' + s.rating : '');
  b.hidden = !b.textContent;
  $('heroFav').textContent = inList(s.id) ? '✓ Na minha lista' : '＋ Minha lista';
  hero.hidden = false;
  // melhorias assíncronas: sinopse e título em português, fundo em paisagem, nº de temporadas
  pt(s.summary).then(t => { if (heroShow === s) $('heroSin').textContent = t; });
  const [bg, seasons, tit] = await Promise.all([backdrop(s.id), api('/shows/' + s.id + '/seasons').catch(() => null), titulo(s.id, s.name)]);
  if (heroShow !== s) return;
  if (bg) hero.style.setProperty('--back', 'url("' + bg + '")');
  if (seasons && seasons.length) $('heroMeta').innerHTML = metaHero(s, seasons.length);
  $('heroTitle').textContent = tit;
}
$('heroInfo').onclick = () => heroShow && open(heroShow.id);
$('heroPlay').onclick = () => heroShow && (location.hash = '#ver=' + heroShow.id);
$('heroFav').onclick = () => { if (!heroShow) return; toggleFav(heroShow); $('heroFav').textContent = inList(heroShow.id) ? '✓ Na minha lista' : '＋ Minha lista'; };

/* ---------- grade / lista (busca, no ar hoje, minha lista, gênero) ---------- */
async function renderGrid() {
  only('list'); window.scrollTo(0, 0);
  const lista = page === 'busca';
  $('sbar').hidden = !lista;
  $('grid').className = lista ? 'grid rows' : 'grid';
  $('grid').innerHTML = ''; $('msg').textContent = 'Carregando...';
  $('listTitle').textContent = query ? (lista ? 'Resultados' : 'Resultados para "' + query + '"') : lista ? 'Séries recomendadas' : page === 'hoje' ? 'No ar hoje' : page === 'genero' ? gen(gsel) : 'Minha lista';
  if (lista && document.activeElement !== $('q2')) setTimeout(() => $('q2').focus(), 60);
  let list = [];
  try {
    if (query) list = (await api('/search/shows?q=' + encodeURIComponent(query))).map(x => slim(x.show)).filter(playable);
    else if (lista) list = (await loadPopulares()).slice(0, 30);
    else if (page === 'hoje') list = await loadHoje();
    else if (page === 'genero') list = (await loadPopulares()).filter(s => s.genres.includes(gsel));
    else list = get('favs', []);
  } catch (e) { $('msg').textContent = e.message; return; }
  list.forEach(s => $('grid').appendChild(lista ? itemLista(s) : tile(s)));
  $('msg').textContent = list.length ? '' : (page === 'lista' && !query ? 'Sua lista está vazia. Abra uma série e toque em "Minha lista".' : 'Nada encontrado.');
}

/* ---------- lista de episódios (detalhes e player) ---------- */
const seenKey = id => 'seen_' + id;
function renderEps(box, d, sn, activeE, pick) {
  const seen = get(seenKey(d.s.id), []);
  const tr = [];
  box.innerHTML = '';
  d.seasons[sn].forEach(x => {
    const el = document.createElement('div');
    el.className = 'ep' + (x.number === activeE ? ' on' : '') + (seen.includes(sn + 'x' + x.number) ? ' seen' : '');
    const img = x.image && x.image.medium;
    el.innerHTML = '<span class="n">' + esc(x.number) + '</span>'
      + '<div class="thumb">' + (img ? '<img loading="lazy" src="' + esc(img) + '" alt="">' : '') + '</div>'
      + '<div class="t"><b><em class="num2">' + esc(x.number) + '. </em><strong>' + esc(x.name) + '</strong><span>' + (x.runtime ? esc(x.runtime) + 'min' : '') + '</span></b><p>' + esc(plain(x.summary)) + '</p></div>';
    el.onclick = () => pick(x.number);
    box.appendChild(el);
    tr.push({ node: el.querySelector('strong'), text: x.name }, { node: el.querySelector('p'), text: plain(x.summary) });
  });
  ptMany(tr.filter(i => i.text), (it, r) => { if (it.node.isConnected) it.node.textContent = r; });
}
const seasonOptions = d => d.nums.map(n => '<option value="' + n + '">Temporada ' + n + '</option>').join('');

/* ---------- detalhes (modal no desktop, tela cheia no celular) ---------- */
const modal = $('modal');
let mc = null;
function closeModal() { modal.hidden = true; document.body.classList.remove('lock', 'on-modal'); mc = null; }
function dismiss() { if (location.hash) location.hash = ''; else closeModal(); }
$('mClose').onclick = dismiss;
$('mBack').onclick = dismiss;
modal.addEventListener('click', e => { if (e.target === modal) dismiss(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) dismiss(); });
const goPlay = (id, s, e) => { pending = { id, s, e }; location.hash = '#ver=' + id; };

async function openModal(id) {
  modal.hidden = false; document.body.classList.add('lock', 'on-modal'); modal.scrollTop = 0;
  $('mTitle').textContent = 'Carregando...';
  ['mMeta', 'mMetaMob', 'mCur', 'mSin', 'mRight', 'mEps', 'mProg'].forEach(k => $(k).innerHTML = '');
  $('mProg').hidden = true; $('mBg').style.backgroundImage = ''; $('mSeason').innerHTML = '';
  let d;
  try { d = await loadShow(id); } catch (e) { $('mTitle').textContent = e.message; return; }
  if (modal.hidden || location.hash !== '#serie=' + id) return;
  const s = d.s;
  $('mTitle').textContent = s.name;
  titulo(id, s.name).then(t => { if (mc && mc.d === d) $('mTitle').textContent = t; });
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
  const meta = (s.year ? '<span class="dim">' + esc(s.year) + '</span>' : '')
    + '<span class="badge">HD</span>'
    + '<span class="dim">' + d.nums.length + (d.nums.length > 1 ? ' temporadas' : ' temporada') + '</span>'
    + (s.rating ? '<span class="badge star">★ ' + esc(s.rating) + '</span>' : '');
  $('mMeta').innerHTML = meta; $('mMetaMob').innerHTML = meta;
  $('mRight').innerHTML =
    (d.cast.length ? '<p><span class="k">Elenco:</span> ' + esc(d.cast.slice(0, 3).join(', ')) + (d.cast.length > 3 ? ', <i>mais</i>' : '') + '</p>' : '')
    + (s.genres.length ? '<p><span class="k">Gêneros:</span> ' + esc(s.genres.map(gen).join(', ')) + '</p>' : '')
    + (s.status ? '<p><span class="k">Esta série está:</span> ' + esc(STATUS[s.status] || s.status) + '</p>' : '');

  // sinopse e nome do episódio em português
  const sinEn = pos.resume && ep && plain(ep.summary) ? plain(ep.summary) : plain(d.show.summary);
  $('mSin').textContent = sinEn;
  pt(sinEn).then(t => { if (mc && mc.d === d) $('mSin').textContent = t; });
  if (pos.resume && ep) {
    const base = 'T' + pos.s + ':E' + pos.e + ' "';
    $('mCur').textContent = base + ep.name + '"';
    pt(ep.name).then(t => { if (mc && mc.d === d) $('mCur').textContent = base + t + '"'; });
  }

  renderFavBtn();
  $('mSeason').innerHTML = seasonOptions(d); $('mSeason').value = pos.s;
  renderEps($('mEps'), d, pos.s, pos.resume ? pos.e : -1, e => goPlay(id, mc.s, e));
}
$('mSeason').onchange = () => {
  mc.s = +$('mSeason').value;
  const id = mc.d.s.id;
  renderEps($('mEps'), mc.d, mc.s, -1, e => goPlay(id, mc.s, e));
};
$('mPlay').onclick = () => { if (mc) goPlay(mc.d.s.id, mc.s, mc.e); };
function renderFavBtn() {
  if (!mc) return;
  const on = inList(mc.d.s.id);
  $('mFav').textContent = on ? '✓' : '＋';
  $('mFav2').innerHTML = (on ? CHECK : PLUS) + '<span>Minha lista</span>';
}
const favClick = () => { if (!mc) return; toggleFav(mc.d.s); renderFavBtn(); };
$('mFav').onclick = favClick;
$('mFav2').onclick = favClick;
$('mShare').onclick = async () => {
  if (!mc) return;
  const url = location.href.split('#')[0] + '#serie=' + mc.d.s.id;
  try {
    if (navigator.share) await navigator.share({ title: mc.d.s.name, url });
    else { await navigator.clipboard.writeText(url); alert('Link copiado!'); }
  } catch {}
};

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
  titulo(id, d.s.name).then(t => { if (cur && cur.d === d) $('vTitle').textContent = t; });
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
  const base = 'T' + s + ':E' + e;
  $('epName').textContent = base + (ep && ep.name ? ' — ' + ep.name : '');
  if (ep && ep.name) pt(ep.name).then(t => { if (cur && cur.d === d && cur.s === s && cur.e === e) $('epName').textContent = base + ' — ' + t; });

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

route();
