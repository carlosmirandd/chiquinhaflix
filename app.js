// ChiquinhaFlix — catálogo via TMDB (o Worker da Cloudflare guarda a chave) + player embed do SuperFlix.
// Tudo roda no navegador: favoritos, histórico e traduções ficam no localStorage.
const $ = id => document.getElementById(id);
const WORKER = String(window.CHIQUINHA_AGENDA_URL || '').replace(/\/+$/, '');   // config.js
const API = WORKER + '/tmdb';
const IMG = 'https://image.tmdb.org/t/p/';
const PLAYER = 'https://superflixapi.fun/serie/';
const CANAL = 'https://superflixapi.fun/canal/';
const EVENTO = 'https://superflixapi.fun/eventos/';

/* ---------- storage ---------- */
const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
// favoritos e histórico: só entradas já no formato da TMDB (as antigas eram do TVMaze, com outros IDs)
const salvos = k => get(k, []).filter(x => x && x.tm);

/* ---------- utilidades ---------- */
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// gêneros de séries da TMDB (os IDs são fixos)
const GEN_ID = { 10759: 'Ação e aventura', 16: 'Animação', 35: 'Comédia', 80: 'Crime', 99: 'Documentário', 18: 'Drama', 10751: 'Família', 10762: 'Infantil', 9648: 'Mistério', 10763: 'Notícias', 10764: 'Reality', 10765: 'Ficção e fantasia', 10766: 'Novela', 10767: 'Talk show', 10768: 'Guerra e política', 37: 'Faroeste' };
const gen = g => g;
const STATUS = { 'Returning Series': 'Em exibição', Ended: 'Finalizada', Canceled: 'Cancelada', 'In Production': 'Em produção', Planned: 'Planejada', Pilot: 'Piloto' };
const PLUS = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

// Consulta a TMDB pelo Worker (que guarda a chave e já pede os textos em pt-BR).
async function api(path) {
  if (!WORKER) throw new Error('O catálogo precisa do Worker da Cloudflare: rode python cloudflare/publicar.py (veja cloudflare/LEIAME.md).');
  let r;
  try { r = await fetch(API + path); } catch { throw new Error('Não consegui falar com o catálogo (Worker da Cloudflare).'); }
  if (!r.ok) throw new Error(r.status === 503 ? 'O catálogo ainda não tem a chave da TMDB (ou está no limite). Tente de novo em instantes.' : 'Erro ' + r.status + ' ao falar com a TMDB');
  return r.json();
}

// só guardamos o necessário; tm:1 marca o formato da TMDB
const slim = s => ({
  tm: 1, id: s.id, name: s.name || s.original_name || '',
  poster: s.poster_path ? IMG + 'w342' + s.poster_path : null,
  big: s.poster_path ? IMG + 'w780' + s.poster_path : null,
  back: s.backdrop_path ? IMG + 'w1280' + s.backdrop_path : null,
  year: (s.first_air_date || '').slice(0, 4),
  genres: (s.genre_ids || (s.genres || []).map(g => g.id)).map(i => GEN_ID[i]).filter(Boolean),
  weight: s.popularity || 0,
  rating: s.vote_count >= 5 && s.vote_average ? s.vote_average.toFixed(1) : null,
  status: s.status, summary: (s.overview || '').slice(0, 240)
});
const playable = s => Number.isInteger(s.id);

/* ---------- português ----------
   A TMDB já entrega títulos, sinopses e episódios em português do Brasil. Quando falta uma
   sinopse (comum em episódios), o texto em inglês é traduzido por tradução automática (endpoint
   público do Google Tradutor; se falhar, MyMemory; se falhar, fica o original). Cache no localStorage. */
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
/* ---------- estado ---------- */
let page = 'home', query = '', gsel = '', rendered = '', under = 'home', pending = null, cur = null;
let populares = null, hojeCache = null, heroShow = null;
const showCache = new Map();
const TITULOS = { home: 'Início', hoje: 'No ar hoje', breve: 'Em breve', vivo: 'Ao vivo', lista: 'Minha lista', busca: 'Buscar' };
let homeTk = 0;   // descarta o "Em breve" que chegar depois de a home ser refeita

const SECTIONS = ['home', 'list', 'view', 'vivo'];
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
  under = (!query && page === 'home') ? 'home' : (!query && page === 'vivo') ? 'vivo' : 'list';
  syncUI();
  if (rendered !== k) { rendered = k; await (under === 'home' ? renderHome() : under === 'vivo' ? renderVivo() : (page === 'breve' && !query) ? renderBreve() : renderGrid()); }
  else only(under);
}
async function rotear() {
  const m = location.hash.match(/^#(serie|ver)=(\d+)$/);
  const cn = location.hash.match(/^#canal=([A-Za-z0-9_-]{1,60})$/);
  const ev = location.hash.match(/^#evento=([A-Za-z0-9_-]{1,120})$/);
  if (cn) { closeModal(); return openCanal(cn[1]); }
  if (ev) { closeModal(); return openEvento(ev[1]); }
  if (m && m[1] === 'ver') { closeModal(); return openPlayer(+m[2]); }
  await ensurePage();
  if (m) openModal(+m[2]); else closeModal();
}
async function route() { await rotear(); place(); requestAnimationFrame(place); setTimeout(place, 400); }
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => place());
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
// junta listas da TMDB: tira repetidos e quem não tem pôster
function unicas(lotes) {
  const vistos = new Set();
  return lotes.flatMap(l => l.results || []).map(slim).filter(s => s.poster && playable(s) && !vistos.has(s.id) && vistos.add(s.id));
}
async function loadPopulares() {
  if (populares) return populares;
  const lotes = await Promise.all([...[1, 2].map(p => api('/trending/tv/week?page=' + p)), ...[1, 2, 3, 4].map(p => api('/tv/popular?page=' + p))]);
  populares = unicas(lotes).slice(0, 150);
  return populares;
}
async function loadHoje() {
  if (hojeCache) return hojeCache;
  const lotes = await Promise.all([1, 2].map(p => api('/tv/airing_today?timezone=America/Sao_Paulo&page=' + p)));
  hojeCache = unicas(lotes).sort((a, b) => b.weight - a.weight);
  return hojeCache;
}
/* ---------- em breve ----------
   Calendário de episódios do SuperFlix (séries, animes e doramas), lido pelo Worker (/calendario).
   Os IDs são os da TMDB, os mesmos do catálogo: tocar num cartão abre a série. */
let calCache = null;
async function loadCalendario() {
  if (calCache) return calCache;
  if (!WORKER) throw new Error('O calendário precisa do Worker da Cloudflare.');
  let r;
  try { r = await fetch(WORKER + '/calendario'); } catch { throw new Error('Não consegui falar com o calendário.'); }
  if (!r.ok) throw new Error('O calendário do SuperFlix não respondeu agora (HTTP ' + r.status + '). Tente de novo daqui a pouco.');
  const j = await r.json();
  if (!j || !Array.isArray(j.itens)) throw new Error('O calendário veio em formato inesperado.');
  const s = (v, n) => String(v == null ? '' : v).slice(0, n);
  calCache = j.itens.filter(x => x && /^\d{1,9}$/.test(x.id || '') && /^\d{4}-\d{2}-\d{2}$/.test(x.d || ''))
    .map(x => ({ id: +x.id, t: s(x.t, 120), ep: s(x.ep, 120), s: +x.s || 0, n: +x.n || 0, d: x.d, p: /^\/[A-Za-z0-9_.-]{1,80}$/.test(x.p || '') ? x.p : '' }));
  return calCache;
}
const hojeISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const dataLocal = iso => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
const diasAte = iso => Math.round((dataLocal(iso) - dataLocal(hojeISO())) / 86400000);
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function rotuloDia(iso) {
  const n = diasAte(iso), dt = dataLocal(iso);
  return n === 0 ? 'Hoje' : n === 1 ? 'Amanhã' : DIAS[dt.getDay()] + ', ' + String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0');
}
// uma entrada por série e por dia (novelas têm dezenas de episódios no mesmo dia): fica o menor episódio e "+N"
function breves(itens, ateDias) {
  const mapa = new Map();
  itens.filter(x => x.d >= hojeISO() && (ateDias == null || diasAte(x.d) <= ateDias))
    .sort((a, b) => a.d.localeCompare(b.d) || a.s - b.s || a.n - b.n)
    .forEach(x => { const k = x.id + '|' + x.d; if (mapa.has(k)) mapa.get(k).mais++; else mapa.set(k, { ...x, mais: 0 }); });
  return [...mapa.values()];
}
function tileBreve(x, semDia) {
  const sub = 'T' + x.s + ':E' + x.n + (x.mais ? ' +' + x.mais : '') + (x.ep ? ' · ' + x.ep : '');
  const t = tile({ id: x.id, name: x.t, poster: x.p ? IMG + 'w342' + x.p : null, genres: [], year: '' }, sub);
  if (!semDia) t.insertAdjacentHTML('beforeend', '<span class="when">' + esc(rotuloDia(x.d)) + '</span>');
  return t;
}
/* Relevância: o calendário do SuperFlix tem 400+ séries (novelas, animes, doramas...). As "relevantes" são as
   que também estão entre as mais populares/em alta da TMDB (a lista de populares da home); elas vêm primeiro. */
const posicaoNoTop = () => { const m = new Map(); (populares || []).forEach((s, i) => m.set(s.id, i)); return m; };
const umaPorSerie = lista => { const v = new Set(); return lista.filter(x => !v.has(x.id) && v.add(x.id)); };
function relevantes(cal, ateDias) {
  const pos = posicaoNoTop();
  return umaPorSerie(breves(cal, ateDias).filter(x => pos.has(x.id))).sort((a, b) => a.d.localeCompare(b.d) || pos.get(a.id) - pos.get(b.id));
}
function emBreveOrdenado(cal, ateDias) {
  const rel = relevantes(cal, ateDias), ids = new Set(rel.map(x => x.id));
  return [...rel, ...umaPorSerie(breves(cal, ateDias).filter(x => !ids.has(x.id)))];
}
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function rotuloLancamento(x) {
  const n = diasAte(x.d), dt = dataLocal(x.d);
  const tipo = x.n === 1 ? (x.s === 1 ? 'Estreia' : 'Nova temporada') : 'Novo episódio';
  const quando = n === 0 ? ' hoje' : n === 1 ? ' amanhã' : ' em ' + dt.getDate() + ' de ' + MESES[dt.getMonth()];
  return tipo + quando + (x.n === 1 ? '' : ' · T' + x.s + ':E' + x.n);
}

// cartão grande do "Novidades" (backdrop, título, quando, sinopse e botões)
function cardNv(c) {
  const el = document.createElement('div');
  el.className = 'nv';
  el.innerHTML = '<div class="nv-img"></div><div class="nv-body"><h2></h2><p class="nv-rot"></p><p class="nv-sin"></p>'
    + '<div class="nv-btns"><button class="pill white sq nv-a"></button><button class="pill grey sq nv-fav"></button></div></div>';
  const img = el.querySelector('.nv-img');
  const poe = s => {   // preenche (ou atualiza, quando os detalhes chegam) imagem, título e sinopse
    el._s = s;
    el.querySelector('h2').textContent = s.name;
    el.querySelector('.nv-sin').textContent = s.summary || c.sin || '';
    const u = s.back || s.big || s.poster;
    if (u) { img.innerHTML = '<img loading="lazy" src="' + esc(u) + '" alt="">'; }
    fav();
  };
  const fav = () => { el.querySelector('.nv-fav').textContent = inList(el._s.id) ? '✓ Na minha lista' : '＋ Minha lista'; };
  el.querySelector('.nv-rot').textContent = c.rotulo;
  el.querySelector('.nv-a').textContent = c.acao;
  el.querySelector('.nv-a').onclick = () => c.vai(el._s);
  el.querySelector('.nv-fav').onclick = () => { toggleFav(el._s); fav(); };
  img.onclick = el.querySelector('h2').onclick = () => open(el._s.id);
  poe(c.serie);
  el._poe = poe;
  return el;
}

let brTab = get('breveTab', 'breve'), nvObs = null;
async function renderBreve() {
  only('list'); window.scrollTo(0, 0);
  $('sbar').hidden = true; $('listTitle').textContent = 'Novidades';
  const tabs = $('brTabs');
  tabs.hidden = false; tabs.innerHTML = '';
  [['breve', 'Em breve'], ['alta', 'Todo mundo está assistindo'], ['cal', 'Calendário']].forEach(([k, t]) => {
    const b = document.createElement('button');
    b.textContent = t;
    if (k === brTab) b.className = 'on';
    b.onclick = () => { brTab = k; set('breveTab', k); [...tabs.children].forEach(x => x.classList.toggle('on', x === b)); window.scrollTo(0, 0); conteudoBreve(); };
    tabs.appendChild(b);
  });
  await conteudoBreve();
}
async function conteudoBreve() {
  const tab = brTab, box = $('grid');
  if (nvObs) nvObs.disconnect();
  box.className = tab === 'cal' ? 'grid' : 'grid feed'; box.innerHTML = ''; $('msg').textContent = 'Carregando...';
  let pop = [], cal = [];
  try { [pop, cal] = await Promise.all([loadPopulares().catch(() => []), tab === 'alta' ? [] : loadCalendario()]); }
  catch (e) { if (tab === brTab) $('msg').textContent = e.message; return; }
  if (tab !== brTab) return;   // trocou de aba enquanto carregava
  $('msg').textContent = '';

  if (tab === 'alta') {
    pop.slice(0, 20).forEach((s, i) => box.appendChild(cardNv({ serie: s, rotulo: 'Em alta esta semana · nº ' + (i + 1), acao: '▶ Assistir', vai: x => { location.hash = '#ver=' + x.id; } })));
    return;
  }
  if (tab === 'breve') {
    // só as relevantes; se a lista de populares não carregou, mostra as próximas mesmo assim
    let lista = relevantes(cal, 21);
    if (!lista.length) lista = emBreveOrdenado(cal, 21).slice(0, 12);
    // imagem, título em português e sinopse vêm da TMDB; busca só quando o cartão chega perto da tela
    nvObs = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      nvObs.unobserve(e.target);
      loadLeve(e.target._id).then(s => { if (s && e.target.isConnected) e.target._poe(s); });
    }), { rootMargin: '500px' });
    lista.slice(0, 40).forEach((x, i) => {
      const mini = { tm: 1, id: x.id, name: x.t, poster: x.p ? IMG + 'w342' + x.p : null, genres: [], year: '', summary: '' };
      const el = cardNv({ serie: mini, rotulo: rotuloLancamento(x), acao: 'Detalhes', vai: s => open(s.id) });
      el._id = x.id;
      box.appendChild(el);
      if (i < 8) loadLeve(x.id).then(s => { if (s && el.isConnected) el._poe(s); });   // a primeira tela já vem completa
      else nvObs.observe(el);
    });
    if (!lista.length) $('msg').textContent = 'Nada marcado para os próximos dias.';
    return;
  }
  // calendário completo, dia a dia; dentro de cada dia as relevantes vêm primeiro
  const pos = posicaoNoTop();
  const todos = breves(cal).sort((a, b) => a.d.localeCompare(b.d) || (pos.has(a.id) ? pos.get(a.id) : 9999) - (pos.has(b.id) ? pos.get(b.id) : 9999) || a.t.localeCompare(b.t));
  let dia = '';
  todos.forEach(x => {
    if (x.d !== dia) { dia = x.d; const dt = dataLocal(x.d); box.insertAdjacentHTML('beforeend', '<h3 class="dia">' + esc(rotuloDia(x.d)) + (diasAte(x.d) > 1 ? '' : ' · ' + String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0')) + '</h3>'); }
    box.appendChild(tileBreve(x, true));
  });
  if (!todos.length) $('msg').textContent = 'Nada marcado para os próximos dias.';
}
// detalhes leves de uma série (imagem de fundo, nome e sinopse em português), com cache
const leves = new Map();
function loadLeve(id) {
  if (!leves.has(id)) leves.set(id, api('/tv/' + id).then(slim).catch(() => null));
  return leves.get(id);
}

// temporadas (com episódios) de uma série; até 20 por chamada
async function loadTemporadas(id, nums, lang) {
  const out = {};
  const lotes = [];
  for (let i = 0; i < nums.length; i += 20) lotes.push(nums.slice(i, i + 20));
  const resp = await Promise.all(lotes.map(l => api('/tv/' + id + '?language=' + lang + '&append_to_response=' + l.map(n => 'season/' + n).join(','))));
  resp.forEach(r => nums.forEach(n => { if (r['season/' + n] && r['season/' + n].episodes) out[n] = r['season/' + n].episodes; }));
  return out;
}
async function loadShow(id) {
  if (showCache.has(id)) return showCache.get(id);
  const show = await api('/tv/' + id + '?append_to_response=credits');
  const todas = (show.seasons || []).map(x => x.season_number).filter(n => n > 0);
  const brutas = await loadTemporadas(id, todas, 'pt-BR');
  // episódios sem sinopse em português: pega a em inglês e marca para traduzir
  const faltam = todas.filter(n => (brutas[n] || []).some(e => !e.overview));
  const ingles = faltam.length ? await loadTemporadas(id, faltam, 'en-US').catch(() => ({})) : {};
  const seasons = {};
  todas.forEach(n => {
    const eps = (brutas[n] || []).filter(e => e.episode_number != null).map(e => {
      const en = ((ingles[n] || []).find(x => x.episode_number === e.episode_number) || {}).overview;
      const tr = !e.overview && !!en;
      return { number: e.episode_number, name: e.name, summary: e.overview || en || '', tr, image: e.still_path ? { medium: IMG + 'w300' + e.still_path } : null, runtime: e.runtime };
    });
    if (eps.length) seasons[n] = eps;
  });
  let sin = { text: show.overview || '', tr: false };
  if (!sin.text) {
    const en = await api('/tv/' + id + '?language=en-US').catch(() => null);
    if (en && en.overview) sin = { text: en.overview, tr: true };
  }
  const d = {
    show: { summary: sin.text, tr: sin.tr }, s: slim(show), seasons,
    nums: Object.keys(seasons).map(Number).sort((a, b) => a - b),
    cast: ((show.credits && show.credits.cast) || []).slice(0, 10).map(c => c.name)
  };
  showCache.set(id, d);
  return d;
}

/* ---------- migração ----------
   Antes o catálogo era do TVMaze (outros IDs). Quem já tinha Minha lista / histórico tem entradas
   guardadas com IMDb: aqui cada uma é achada de novo na TMDB e convertida (uma vez só). */
const MIGRA = 'migrado_tmdb_v1';
const seenKey = id => 'seen2_' + id;   // episódios já abertos (o prefixo antigo, seen_, era dos IDs do TVMaze)
// O player é um iframe de outro site: o app não enxerga o ponto do vídeo. O que dá para saber é quantos
// episódios da série já foram abertos, e é isso que as barras mostram (não o tempo dentro do episódio).
const totalEps = d => d.nums.reduce((n, k) => n + d.seasons[k].length, 0);
const abertos = id => get(seenKey(id), []).length;
const pctAbertos = (id, tot) => tot && abertos(id) ? Math.max(4, Math.min(100, Math.round(100 * abertos(id) / tot))) : 0;
async function migrar() {
  if (!WORKER || get(MIGRA, false)) return;
  const velho = x => x && !x.tm && /^tt\d+$/.test(x.imdb || '');
  if (!get('favs', []).some(velho) && !get('hist', []).some(velho)) { set(MIGRA, true); return; }
  const achados = new Map();
  let falhou = false;
  const converte = async lista => {
    const out = [];
    for (const v of lista) {
      if (!velho(v)) { if (v && v.tm) out.push(v); continue; }
      if (!achados.has(v.imdb)) {
        try {
          const r = await api('/find/' + v.imdb + '?external_source=imdb_id');
          achados.set(v.imdb, r.tv_results && r.tv_results[0] ? slim(r.tv_results[0]) : null);
        } catch { falhou = true; achados.set(v.imdb, undefined); }
      }
      const n = achados.get(v.imdb);
      if (n === undefined) { out.push(v); continue; }          // falhou: mantém para tentar depois
      if (!n || out.some(o => o.id === n.id)) continue;         // não existe na TMDB ou repetida
      const seen = get('seen_' + v.id, []);
      if (seen.length && !get(seenKey(n.id), []).length) set(seenKey(n.id), seen);
      out.push(v.s != null ? { ...n, s: v.s, e: v.e, of: v.of } : n);
    }
    return out;
  };
  set('favs', await converte(get('favs', [])));
  set('hist', await converte(get('hist', [])));
  if (!falhou) set(MIGRA, true);
}
const migrado = migrar().catch(() => {});
const startPos = d => {
  const last = salvos('hist').find(x => x.id === d.s.id);
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
      c.insertAdjacentHTML('beforeend', '<div class="prog"><i data-id="' + (+s.id) + '" style="width:' + opt.progress(s) + '%"></i></div>');
      track.appendChild(c);
    } else track.appendChild(opt.tile ? opt.tile(s) : tile(s));
  });
  if (opt.more) { const h = r.querySelector('h3'); h.classList.add('link'); h.onclick = opt.more; }
  r.querySelector('.l').onclick = () => track.scrollBy({ left: -track.clientWidth * .85 });
  r.querySelector('.r').onclick = () => track.scrollBy({ left: track.clientWidth * .85 });
  return r;
}

const dots = parts => parts.filter(Boolean).map(p => '<span>' + esc(p) + '</span>').join('');
const inList = id => salvos('favs').some(x => x.id === id);
function toggleFav(s) {
  const f = salvos('favs');
  set('favs', f.some(x => x.id === s.id) ? f.filter(x => x.id !== s.id) : [s, ...f]);
  rendered = '';
}

/* ---------- início ---------- */
async function renderHome() {
  only('home'); window.scrollTo(0, 0);
  $('rows').innerHTML = ''; $('chips').innerHTML = ''; $('hero').hidden = true; $('msg').textContent = 'Carregando...';
  let list;
  try { list = await loadPopulares(); } catch (e) { $('msg').textContent = e.message; return; }
  await Promise.race([migrado, new Promise(r => setTimeout(r, 6000))]);   // lista/histórico antigos
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
  rows.push(row('Continuar assistindo', salvos('hist'), { sub: s => 'T' + s.s + ':E' + s.e, progress: s => pctAbertos(s.id, s.tot) }));
  rows.push(row('Minha lista', salvos('favs')));
  rows.push(row('Top 10 séries da semana', list.slice(0, 10), { top10: true }));
  rows.push(row('Em alta', list.slice(10, 40)));
  top.slice(0, 7).forEach(g => rows.push(row(gen(g), list.filter(s => s.genres.includes(g)).slice(0, 24))));
  rows.forEach(r => r && $('rows').appendChild(r));

  // "Em breve" vem do Worker e chega depois; entra logo depois do Top 10
  const tk = ++homeTk;
  loadCalendario().then(cal => {
    if (tk !== homeTk) return;
    const r = row('Em breve', emBreveOrdenado(cal, 14).slice(0, 30), { tile: tileBreve, more: () => { page = 'breve'; query = ''; go(); } });
    if (!r) return;
    const top = [...$('rows').children].find(el => (el.querySelector('h3') || {}).textContent === 'Top 10 séries da semana');
    if (top) top.after(r); else $('rows').prepend(r);
  }).catch(() => {});
  // entradas do histórico de antes das barras novas não têm o total de episódios: busca e completa
  salvos('hist').filter(h => !h.tot).forEach(h => loadShow(h.id).then(d => {
    const tot = totalEps(d), hist = get('hist', []), x = hist.find(e => e.id === h.id && e.tm);
    if (x) { x.tot = tot; set('hist', hist); }
    const i = document.querySelector('.prog i[data-id="' + (+h.id) + '"]');
    if (i) i.style.width = pctAbertos(h.id, tot) + '%';
  }).catch(() => {}));
}

function metaHero(s, temporadas) {
  return dots(['Série', s.genres[0] && gen(s.genres[0]), s.year, temporadas && temporadas + (temporadas > 1 ? ' temporadas' : ' temporada')])
    + (s.rating ? '<span class="badge star">★ ' + esc(s.rating) + '</span>' : '');
}
async function renderHero(list) {
  // sorteia entre os 15 primeiros, de preferência os que têm sinopse e imagem de fundo
  const top = list.slice(0, 15);
  const pool = top.filter(x => x.back && x.summary);
  const s = heroShow = (pool.length ? pool : top)[Math.floor(Math.random() * (pool.length || top.length))];
  const idx = list.indexOf(s);
  const hero = $('hero');
  hero.style.setProperty('--poster', s.big ? 'url("' + s.big + '")' : 'none');
  if (s.back) hero.style.setProperty('--back', 'url("' + s.back + '")'); else hero.style.removeProperty('--back');
  $('heroTitle').textContent = s.name;
  $('heroMeta').innerHTML = metaHero(s, 0);
  $('heroSin').textContent = s.summary;
  const b = $('heroBadge');
  b.textContent = idx < 10 ? 'Nº ' + (idx + 1) + ' da semana' : (s.rating ? 'Nota ' + s.rating : '');
  b.hidden = !b.textContent;
  $('heroFav').textContent = inList(s.id) ? '✓ Na minha lista' : '＋ Minha lista';
  hero.hidden = false;
  // o nº de temporadas só vem nos detalhes
  const det = await api('/tv/' + s.id).catch(() => null);
  if (heroShow !== s) return;
  if (det && det.number_of_seasons) $('heroMeta').innerHTML = metaHero(s, det.number_of_seasons);
}
$('heroInfo').onclick = () => heroShow && open(heroShow.id);
$('heroPlay').onclick = () => heroShow && (location.hash = '#ver=' + heroShow.id);
$('heroFav').onclick = () => { if (!heroShow) return; toggleFav(heroShow); $('heroFav').textContent = inList(heroShow.id) ? '✓ Na minha lista' : '＋ Minha lista'; };

/* ---------- grade / lista (busca, no ar hoje, minha lista, gênero) ---------- */
async function renderGrid() {
  only('list'); window.scrollTo(0, 0);
  const lista = page === 'busca';
  $('sbar').hidden = !lista;
  $('brTabs').hidden = true;
  $('grid').className = lista ? 'grid rows' : 'grid';
  $('grid').innerHTML = ''; $('msg').textContent = 'Carregando...';
  $('listTitle').textContent = query ? (lista ? 'Resultados' : 'Resultados para "' + query + '"') : lista ? 'Séries recomendadas' : page === 'hoje' ? 'No ar hoje' : page === 'genero' ? gen(gsel) : 'Minha lista';
  if (lista && document.activeElement !== $('q2')) setTimeout(() => $('q2').focus(), 60);
  let list = [];
  try {
    if (query) list = ((await api('/search/tv?query=' + encodeURIComponent(query.slice(0, 100)))).results || []).map(slim).filter(s => s.poster && playable(s));
    else if (lista) list = (await loadPopulares()).slice(0, 30);
    else if (page === 'hoje') list = await loadHoje();
    else if (page === 'genero') list = (await loadPopulares()).filter(s => s.genres.includes(gsel));
    else list = salvos('favs');
  } catch (e) { $('msg').textContent = e.message; return; }
  list.forEach(s => $('grid').appendChild(lista ? itemLista(s) : tile(s)));
  $('msg').textContent = list.length ? '' : (page === 'lista' && !query ? 'Sua lista está vazia. Abra uma série e toque em "Minha lista".' : 'Nada encontrado.');
}

/* ---------- lista de episódios (detalhes e player) ---------- */
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
      + '<div class="t"><b><em class="num2">' + esc(x.number) + '. </em><strong>' + esc(x.name) + '</strong><span>' + (x.runtime ? esc(x.runtime) + 'min' : '') + '</span></b><p>' + esc(x.summary) + '</p></div>';
    el.onclick = () => pick(x.number);
    box.appendChild(el);
    if (x.tr && x.summary) tr.push({ node: el.querySelector('p'), text: x.summary });   // só o que veio em inglês
  });
  ptMany(tr, (it, r) => { if (it.node.isConnected) it.node.textContent = r; });
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
  if (!d.nums.length) { $('mSin').textContent = d.show.summary || 'Sem episódios listados.'; return; }

  const pos = startPos(d);
  mc = { d, s: pos.s, e: pos.e };
  const bg = s.back || s.big;
  $('mBg').style.backgroundImage = bg ? 'url("' + bg + '")' : '';

  const ep = d.seasons[pos.s].find(x => x.number === pos.e);
  if (pos.resume) {
    $('mProg').hidden = false;
    $('mProg').innerHTML = '<div class="bar"><i style="width:' + pctAbertos(s.id, totalEps(d)) + '%"></i></div><span>T' + pos.s + ':E' + pos.e + '</span>';
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

  // sinopse (do episódio, se estiver continuando); só o que veio em inglês passa pela tradução
  const sin = pos.resume && ep && ep.summary ? { text: ep.summary, tr: ep.tr } : d.show;
  $('mSin').textContent = sin.text || sin.summary || '';
  if (sin.tr) { const t0 = sin.text || sin.summary; pt(t0).then(t => { if (mc && mc.d === d) $('mSin').textContent = t; }); }
  if (pos.resume && ep) $('mCur').textContent = 'T' + pos.s + ':E' + pos.e + ' "' + ep.name + '"';

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
  only('view'); $('view').classList.remove('canal'); $('evch').hidden = true; window.scrollTo(0, 0);
  $('player').innerHTML = ''; $('vTitle').textContent = 'Carregando...'; $('eps').innerHTML = ''; $('epName').textContent = '';
  let d;
  try { d = await loadShow(id); } catch (e) { $('vTitle').textContent = e.message; return; }
  if (!d.nums.length) { $('vTitle').textContent = d.s.name + ' — sem episódios para abrir no player.'; return; }
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
  // o iframe só recebe inteiros (id da TMDB, temporada e episódio)
  const url = PLAYER + (+d.s.id) + '/' + (+s) + '/' + (+e);
  showEmbed(url, d.s.name + ' · T' + s + ':E' + e, '#ver=' + d.s.id);
  const ep = d.seasons[s].find(x => x.number === e);
  const base = 'T' + s + ':E' + e;
  $('epName').textContent = base + (ep && ep.name ? ' — ' + ep.name : '');

  const seen = get(seenKey(d.s.id), []);
  const tag = s + 'x' + e;
  if (!seen.includes(tag)) { seen.push(tag); set(seenKey(d.s.id), seen); }
  const h = salvos('hist').filter(x => x.id !== d.s.id);
  h.unshift({ ...d.s, s, e, of: d.seasons[s].length, tot: totalEps(d) });
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

/* ---------- ao vivo: canais e agenda (SuperFlix) ---------- */
// A lista de canais é um retrato (canais.json) porque o SuperFlix não libera leitura
// direta (CORS). A agenda muda todo dia, então aparece a própria página deles num iframe.
let canais = null, vivoTab = get('vivoTab', 'canais'), catSel = '', qcanal = '', adulto = get('adulto', false);
let canaisBase = null, canaisEm = 0;
// lista ao vivo do Rei dos Embeds (a mesma origem dos canais do SuperFlix), pelo Worker: canais novos e
// removidos, nomes e o programa que está passando agora. O Worker já filtra; aqui se confere de novo.
async function viaWorkerCanais() {
  if (!WORKER) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(WORKER + '/canais', { signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !Array.isArray(j.canais)) return null;
    const s = (v, n) => String(v == null ? '' : v).slice(0, n);
    return j.canais.filter(c => c && /^[A-Za-z0-9_-]{1,60}$/.test(c.s || '')).map(c => ({
      s: c.s, n: s(c.n, 60) || c.s, c: s(c.c, 40), a: c.a ? 1 : 0, np: s(c.np, 80), pr: Math.max(0, Math.min(100, +c.pr || 0)),
      nx: (Array.isArray(c.nx) ? c.nx : []).slice(0, 3).map(p => [s(p && p[0], 80), +(p && p[1]) || 0, +(p && p[2]) || 0]).filter(p => p[0] && p[1]),
    }));
  } catch { return null; } finally { clearTimeout(t); }
}
// a lista ao vivo manda (canal que saiu some, canal novo aparece); as categorias do canais.json (que
// têm mais de uma por canal) são mantidas e somadas à categoria que vier de lá
function mesclaCanais(base, vivos) {
  const antigo = new Map(base.map(c => [c.s, c]));
  return vivos.map(v => {
    const b = antigo.get(v.s);
    const cats = [...new Set([...((b && b.c) || []), ...(v.c ? [v.c] : [])])];
    return { s: v.s, n: v.n, c: cats, ...((b && b.a) || v.a ? { a: 1 } : {}), np: v.np, pr: v.pr, nx: v.nx };
  });
}
async function loadCanais() {
  if (!canaisBase) {
    const r = await fetch('canais.json');
    if (!r.ok) throw new Error('Erro ao carregar a lista de canais');
    canaisBase = await r.json();
    canais = canaisBase;
  }
  if (WORKER && Date.now() - canaisEm > 5 * 60000) {   // atualiza pelo Worker no máximo a cada 5 min
    canaisEm = Date.now();
    let esperou = true;
    const p = viaWorkerCanais().then(v => {
      if (!v || v.length < 50) return;                    // lista pequena demais: provavelmente erro, fica a anterior
      canais = mesclaCanais(canaisBase, v);
      if (!esperou && !$('vivo').hidden && vivoTab === 'canais') montaCanais();   // chegou depois da tela abrir
    });
    await Promise.race([p, new Promise(r => setTimeout(r, 2500))]);
    esperou = false;
  }
  return canais;
}
const semAcento = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function setSeg(v) {
  vivoTab = v === 'agenda' ? 'agenda' : 'canais';
  set('vivoTab', vivoTab);
  document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('on', b.dataset.v === vivoTab));
  $('canaisBox').hidden = vivoTab !== 'canais';
  $('agendaBox').hidden = vivoTab !== 'agenda';
  if (vivoTab === 'agenda') renderAgenda(); else montaCanais();
}
$('seg').onclick = e => { const b = e.target.closest('button'); if (b) { setSeg(b.dataset.v); window.scrollTo(0, 0); } };
$('qc').oninput = () => { qcanal = $('qc').value.trim(); renderCanais(); };

function canalTile(c) {
  const d = document.createElement('div');
  d.className = 'ch';
  const box = document.createElement('div');
  box.className = 'box';
  const img = document.createElement('img');
  img.loading = 'lazy'; img.alt = ''; img.referrerPolicy = 'no-referrer';
  img.src = 'https://superflixapi.fun/img/' + c.s + '.png';
  img.onerror = () => { const fb = document.createElement('div'); fb.className = 'fb'; fb.textContent = c.n; img.replaceWith(fb); };
  box.appendChild(img);
  box.insertAdjacentHTML('beforeend', '<span class="live">AO VIVO</span>');
  d.appendChild(box);
  d.insertAdjacentHTML('beforeend', '<p>' + esc(c.n) + '<small>' + esc(c.c.join(' · ')) + '</small></p>');
  if (c.np) d.insertAdjacentHTML('beforeend', '<div class="np"><span>Agora: ' + esc(c.np) + '</span><b><i style="width:' + (+c.pr || 0) + '%"></i></b></div>');
  d.onclick = () => { location.hash = '#canal=' + c.s; };
  return d;
}

function renderCanais() {
  const q = semAcento(qcanal);
  // canais adultos (a:1) só aparecem no chip 18+, depois da confirmação
  const lista = (canais || []).filter(c => (c.a ? adulto && catSel === 'Adulto' : (!catSel || c.c.includes(catSel))) && (!q || semAcento(c.n).includes(q) || semAcento(c.np || '').includes(q)));   // acha também pelo programa no ar
  $('chgrid').innerHTML = '';
  lista.forEach(c => $('chgrid').appendChild(canalTile(c)));
  $('msg').textContent = lista.length ? '' : 'Nenhum canal encontrado.';
}

const marcaChip = b => [...$('catChips').children].forEach(x => x.classList.toggle('on', x === b));

async function renderVivo() {
  only('vivo'); window.scrollTo(0, 0);
  setSeg(vivoTab);
}

async function montaCanais() {
  $('msg').textContent = 'Carregando...';
  try { await loadCanais(); } catch (e) { $('msg').textContent = e.message; return; }
  const cont = {};
  canais.filter(c => !c.a).forEach(c => c.c.forEach(k => cont[k] = (cont[k] || 0) + 1));
  if (catSel === 'Adulto' && !adulto) catSel = '';
  $('catChips').innerHTML = '';
  ['', ...Object.keys(cont).sort((a, b) => cont[b] - cont[a])].forEach(k => {
    const b = document.createElement('button');
    b.textContent = k || 'Todos';
    if (k === catSel) b.className = 'on';
    b.onclick = () => { catSel = k; marcaChip(b); renderCanais(); };
    $('catChips').appendChild(b);
  });
  const ad = document.createElement('button');
  ad.textContent = '18+';
  ad.className = 'adult' + (catSel === 'Adulto' ? ' on' : '');
  ad.onclick = () => {
    if (!adulto) {
      if (!confirm('Esta seção tem canais de conteúdo adulto. Você confirma que tem 18 anos ou mais?')) return;
      adulto = true; set('adulto', true);
    }
    catSel = 'Adulto'; marcaChip(ad); renderCanais();
  };
  $('catChips').appendChild(ad);
  renderCanais();
}

async function openCanal(slug) {
  only('view'); $('view').classList.add('canal'); $('evch').hidden = true; window.scrollTo(0, 0);
  let lista = [];
  try { lista = await loadCanais(); } catch {}
  const c = lista.find(x => x.s === slug);
  $('vTitle').textContent = c ? c.n : slug;
  $('epName').textContent = (c && c.c.length ? 'Ao vivo · ' + c.c.join(' · ') : 'Ao vivo') + (c && c.np ? ' · Agora: ' + c.np : '');
  // slug validado pelo regex da rota (letras, números, _ e -)
  showEmbed(CANAL + slug, c ? c.n : slug, '#canal=' + slug);
}

// iframe do player; a URL sempre é montada com um prefixo fixo e um identificador validado
const embed = url => '<iframe src="' + url + '" allow="autoplay *; encrypted-media *; picture-in-picture *; fullscreen *; clipboard-write *; accelerometer *; gyroscope *" allowfullscreen frameborder="0" scrolling="no"></iframe>';

/* ---------- player persistente ----------
   O iframe vive em #pbox, fora das telas. Na tela do player o #pbox é posicionado em cima do
   espaço #player; ao sair dela, o mesmo iframe (sem recarregar) vira um miniplayer flutuante
   com botões para voltar ao player e para fechar. */
let pstate = null;
function showEmbed(url, title, hash) {
  if (!pstate || pstate.url !== url) $('pframe').innerHTML = embed(url);
  pstate = { url, title, hash };
  $('ptitle').textContent = title;
  place();
}
function stopEmbed() { pstate = null; $('pframe').innerHTML = ''; place(); }
function place() {
  const box = $('pbox');
  if (!pstate) { box.hidden = true; return; }
  box.hidden = false;
  const cheio = !$('view').hidden && location.hash === pstate.hash;
  box.classList.toggle('mini', !cheio);
  if (cheio) {
    const r = $('player').getBoundingClientRect();
    Object.assign(box.style, { top: (r.top + scrollY) + 'px', left: (r.left + scrollX) + 'px', width: r.width + 'px', height: r.height + 'px' });
  } else Object.assign(box.style, { top: '', left: '', width: '', height: '' });
}
$('pExpand').onclick = () => { if (pstate) location.hash = pstate.hash; };
$('pClose').onclick = stopEmbed;
$('pStop').onclick = () => { stopEmbed(); if (location.hash) history.back(); else route(); };

/* ---------- agenda esportiva ----------
   A API de eventos do SuperFlix não manda o cabeçalho CORS, então o navegador não consegue
   lê-la direto. Um Worker da Cloudflare (cloudflare/worker.js) faz a chamada pelo servidor e
   devolve só o que o app usa; o endereço dele fica em config.js. O app mostra na hora o que
   já está salvo (cache do navegador ou agenda.json do site) e atualiza pelo Worker em segundo
   plano. Cada evento abre pelo embed /eventos/{id}, e dá pra trocar de canal no player. */
let agenda = null, stSel = '', spSel = '';
const ST = { live: 'AO VIVO', upcoming: 'EM BREVE', finished: 'FINALIZADO' };
const ST_ORDEM = { live: 0, upcoming: 1, finished: 2 };
const logoOk = u => typeof u === 'string' && /^https:\/\/(superflixapi\.fun|reidosembeds\.lat)\//.test(u);
// os horários do SuperFlix são de Brasília (UTC-3)
const dataEv = d => new Date(String(d).replace(' ', 'T') + '-03:00');
function quando(d) {
  const t = dataEv(d);
  if (isNaN(t)) return '';
  const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0);
  const dia = Math.round((new Date(t).setHours(0, 0, 0, 0) - hoje0) / 86400000);
  const hora = t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return (dia === 0 ? 'Hoje' : dia === 1 ? 'Amanhã' : dia === -1 ? 'Ontem' : t.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })) + ' · ' + hora;
}
// endereço do Worker da Cloudflare (config.js, gerado por cloudflare/publicar.py); vazio = só agenda.json
const AGENDA_URL = String(window.CHIQUINHA_AGENDA_URL || '').replace(/\/+$/, '');
const AG_CACHE = 'agenda_cache_v2';
const ID_OK = /^[A-Za-z0-9_-]{1,120}$/;
let agUltima = 0, agErro = '', agFonte = '';
// o Worker já devolve o formato compacto; aqui se confere de novo e se descarta o que não for seguro
function limpaEvento(e) {
  if (!e || !ID_OK.test(e.i || '')) return null;
  const s = v => typeof v === 'string' ? v : '';
  const canais = (Array.isArray(e.e) ? e.e : []).filter(c => Array.isArray(c) && /^[A-Za-z0-9_-]{1,60}$/.test(c[1] || '')).map(c => [s(c[0]) || c[1], c[1], s(c[2])]);
  return { i: e.i, t: s(e.t) || e.i, st: ['live', 'upcoming', 'finished'].includes(e.st) ? e.st : 'upcoming', sp: s(e.sp), c: s(e.c), d: s(e.d), a: s(e.a), b: s(e.b), la: s(e.la), lb: s(e.lb), el: s(e.el), e: canais };
}
async function viaWorker() {
  if (!AGENDA_URL) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(AGENDA_URL + '/agenda', { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) { agErro = 'o Worker respondeu HTTP ' + r.status; return null; }
    const j = await r.json();
    if (!j || !Array.isArray(j.eventos)) { agErro = 'resposta inesperada do Worker'; return null; }
    return { gerado: j.gerado && !isNaN(new Date(j.gerado)) ? j.gerado : new Date().toISOString(), fonte: j.fonte === 'rde' ? 'rde' : 'superflix', eventos: j.eventos.map(limpaEvento).filter(Boolean) };
  } catch { agErro = 'não consegui falar com o Worker'; return null; } finally { clearTimeout(t); }
}
const AG_FALHA = 'agenda_worker_falha';
let agTentando = false;
// base rápida: o que já está salvo (cache do navegador ou agenda.json do site), a mais nova das duas.
// Retorna true se o cache for recente o bastante para nem chamar o Worker.
async function loadBase() {
  agErro = '';
  const cache = get(AG_CACHE, null);
  const valido = cache && Array.isArray(cache.eventos) && cache.gerado;
  if (valido && Date.now() - new Date(cache.gerado) < 5 * 60000) { agenda = cache; agFonte = 'cache'; return true; }
  let arq = null;
  try {
    const r = await fetch('agenda.json?m=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
    if (r.ok) { const x = await r.json(); if (x && Array.isArray(x.eventos) && x.gerado) arq = x; }
  } catch {}
  if (arq && (!valido || new Date(arq.gerado) >= new Date(cache.gerado))) { agenda = arq; agFonte = 'arquivo'; }
  else if (valido) { agenda = cache; agFonte = 'salva'; }
  else { agenda = { gerado: null, eventos: [] }; agFonte = ''; }
  return false;
}
async function loadAgenda() { if (!agenda) await loadBase(); return agenda; }
// se o arquivo estiver velho, corrige o status pelo horário (ao vivo ~3 h depois do início)
function statusEv(e, velha) {
  if (!velha) return e.st;
  const h = (Date.now() - dataEv(e.d)) / 3600000;
  if (isNaN(h)) return e.st;
  if (e.st === 'upcoming') return h < 0 ? 'upcoming' : h < 3 ? 'live' : 'finished';
  if (e.st === 'live') return h > 4 ? 'finished' : 'live';
  return e.st;
}
function chipsDe(box, itens, atual, onPick) {
  box.innerHTML = '';
  itens.forEach(([v, rotulo]) => {
    const b = document.createElement('button');
    b.textContent = rotulo;
    if (v === atual) b.className = 'on';
    b.onclick = () => { onPick(v); [...box.children].forEach(x => x.classList.toggle('on', x === b)); renderAgList(); };
    box.appendChild(b);
  });
}
function montaAgenda() {
  const cont = {};
  agenda.eventos.forEach(e => cont[e.sp] = (cont[e.sp] || 0) + 1);
  chipsDe($('stChips'), [['', 'Todos'], ['live', 'Ao vivo'], ['upcoming', 'Em breve'], ['finished', 'Finalizado']], stSel, v => stSel = v);
  chipsDe($('spChips'), [['', 'Todas as modalidades'], ...Object.keys(cont).sort((a, b) => cont[b] - cont[a]).map(k => [k, k])], spSel, v => spSel = v);
  renderAgList();
}
async function renderAgenda(forcar = false) {
  $('agMeta').textContent = 'Carregando...'; $('aglist').innerHTML = '';
  $('agRefresh').onclick = () => { if (!agTentando && Date.now() - agUltima > 10000) renderAgenda(true); };
  const fresca = await loadBase();
  montaAgenda();                       // já mostra o que existe, sem esperar o Worker
  if (!AGENDA_URL || (fresca && !forcar)) return;    // sem Worker configurado: só o que já existe
  if (!forcar && Date.now() - get(AG_FALHA, 0) < 5 * 60000) { agErro = 'Worker indisponível há pouco; nova tentativa em até 5 min (Atualizar força)'; renderAgList(); return; }
  agUltima = Date.now(); agTentando = true; renderAgList();
  const nova = await viaWorker();
  agTentando = false;
  if (nova) { agenda = nova; agFonte = 'worker'; agErro = ''; set(AG_CACHE, nova); set(AG_FALHA, 0); montaAgenda(); }
  else { set(AG_FALHA, Date.now()); renderAgList(); }
}
function renderAgList() {
  const min = agenda.gerado ? Math.round((Date.now() - new Date(agenda.gerado)) / 60000) : null;
  const velha = min !== null && min > 30;
  const todos = agenda.eventos.map(e => ({ ...e, st: statusEv(e, velha) }));
  const lista = todos
    .filter(e => (!stSel || e.st === stSel) && (!spSel || e.sp === spSel))
    .sort((a, b) => (ST_ORDEM[a.st] - ST_ORDEM[b.st]) || (a.st === 'finished' ? dataEv(b.d) - dataEv(a.d) : dataEv(a.d) - dataEv(b.d)));
  const box = $('aglist');
  box.innerHTML = '';
  const vivo = agenda.fonte === 'rde' ? 'Direto do Rei dos Embeds (via Cloudflare; o SuperFlix não respondeu)' : 'Direto do SuperFlix (via Cloudflare)';
  const origem = { worker: vivo, cache: vivo, salva: 'Última agenda salva neste navegador', arquivo: 'Agenda publicada no site' }[agFonte] || '';
  if (min === null) $('agMeta').textContent = 'Não consegui carregar a agenda' + (agErro ? ': ' + agErro : '') + '. Toque em Atualizar daqui a pouco.';
  else $('agMeta').textContent = origem + ' · atualizada ' + (min < 1 ? 'agora há pouco' : min < 60 ? 'há ' + min + ' min' : min < 2880 ? 'há ' + Math.round(min / 60) + ' h' : 'há ' + Math.round(min / 1440) + ' dias')
    + (agTentando ? ' · tentando atualizar pela Cloudflare…' : agErro ? ' · ' + agErro : '') + (velha ? ' · status ajustado pelo horário' : '') + ' · horários no seu fuso';
  lista.forEach(e => {
    const d = document.createElement('div');
    d.className = 'ev';
    const logos = (logoOk(e.la) && logoOk(e.lb))
      ? '<img src="' + esc(e.la) + '" alt=""><span>x</span><img src="' + esc(e.lb) + '" alt="">'
      : logoOk(e.el) ? '<img src="' + esc(e.el) + '" alt="">' : '<span class="sp">' + esc((e.sp || '?').slice(0, 3).toUpperCase()) + '</span>';
    d.innerHTML = '<div class="ev-logos">' + logos + '</div>'
      + '<div class="ev-info"><span class="stb ' + esc(e.st) + '">' + esc(ST[e.st] || e.st) + '</span><b>' + esc(e.t) + '</b>'
      + '<small>' + esc([e.sp, e.c].filter(Boolean).join(' · ')) + '</small>'
      + '<small>' + esc(quando(e.d)) + ' · ' + (e.e ? e.e.length : 0) + ((e.e ? e.e.length : 0) === 1 ? ' canal' : ' canais') + '</small></div><span class="go">▶</span>';
    d.querySelectorAll('img').forEach(i => { i.referrerPolicy = 'no-referrer'; i.onerror = () => i.remove(); });
    d.onclick = () => { location.hash = '#evento=' + e.i; };
    box.appendChild(d);
  });
  if (!lista.length && agenda.gerado) box.innerHTML = '<p class="agmeta">Nenhum evento nesse filtro.</p>';
}

async function openEvento(slug) {
  only('view'); $('view').classList.add('canal'); window.scrollTo(0, 0);
  if (!agenda) await loadAgenda();
  const e = agenda.eventos.find(x => x.i === slug);
  $('vTitle').textContent = e ? e.t : slug;
  $('epName').textContent = e ? [e.sp, e.c, quando(e.d)].filter(Boolean).join(' · ') : 'Evento';
  const box = $('evch');
  box.innerHTML = '';
  const tocar = (url, btn) => { showEmbed(url, e ? e.t : slug, '#evento=' + slug); [...box.children].forEach(x => x.classList.toggle('on', x === btn)); };
  const itens = [['Evento (todos os canais)', EVENTO + slug]];
  (e && e.e ? e.e : []).forEach(([nome, cs, q]) => { if (/^[A-Za-z0-9_-]{1,60}$/.test(cs)) itens.push([nome + (q ? ' · ' + q : ''), CANAL + cs]); });
  itens.forEach(([rotulo, url]) => {
    const b = document.createElement('button');
    b.textContent = rotulo;
    b.onclick = () => tocar(url, b);
    box.appendChild(b);
  });
  box.hidden = itens.length < 2;
  tocar(itens[0][1], box.firstChild);
}

route();

/* ---------- PWA: service worker (instalável e abre sem rede) ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
