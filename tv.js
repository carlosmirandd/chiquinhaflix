// ChiquinhaFlix — modo TV: navegação pelas setas do controle remoto (Android TV, Tizen, webOS...).
// Liga sozinho em TVs/boxes conhecidas; também por ?tv=1 (desliga com ?tv=0) ou pelo link no rodapé.
(() => {
  const KEY = 'tv';
  const lerFlag = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const gravaFlag = v => { try { localStorage.setItem(KEY, v); } catch (e) {} };
  const q = new URLSearchParams(location.search).get('tv');
  if (q === '1' || q === '0') gravaFlag(q);
  const auto = /SMART-TV|SmartTV|Tizen|Web0S|WebOS|NetCast|Android TV|GoogleTV|AFTM|AFTT|AFTS|BRAVIA|CrKey|HbbTV|Viera|AquosBrowser|TV Safari|; TV/i.test(navigator.userAgent);
  const ligado = () => { const f = lerFlag(); return f === '1' || (f !== '0' && auto); };

  const FOCAVEL = 'button, a[href], input, select, textarea, .tile, .li, .ep, .ch, .ev';
  const CARTAO = '.tile, .li, .ep, .ch, .ev';
  const aplicar = () => {
    document.documentElement.classList.toggle('tv', ligado());
    const t = document.getElementById('tvToggle');
    if (t) t.textContent = 'Modo TV: ' + (ligado() ? 'ligado' : 'desligado');
  };
  aplicar();
  const tg = document.getElementById('tvToggle');
  if (tg) tg.onclick = e => { e.preventDefault(); gravaFlag(ligado() ? '0' : '1'); aplicar(); preparar(); };

  const visivel = el => {
    if (el.closest('[hidden], .arrow') || el.disabled) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  };
  const modalAberto = () => { const m = document.getElementById('modal'); return m && !m.hidden ? m : null; };
  const lista = () => [...(modalAberto() || document).querySelectorAll(FOCAVEL)].filter(visivel);

  // cartões são <div>: para receberem foco precisam de tabindex
  function preparar() {
    if (!ligado()) return;
    document.querySelectorAll(CARTAO).forEach(el => { if (!el.hasAttribute('tabindex')) el.tabIndex = 0; });
    const fa = document.activeElement, m = modalAberto();
    if (m && !m.contains(fa)) { antesModal = fa; focoInicial(); return; }          // abriu os detalhes: foco no Assistir
    if (!m && antesModal) {                                                         // fechou: volta ao cartão de onde saiu
      const volta = antesModal; antesModal = null;
      if (volta.isConnected && visivel(volta)) { volta.focus({ preventScroll: true }); return; }
    }
    if (!fa || fa === document.body || !fa.isConnected || !visivel(fa)) focoInicial();
  }
  let antesModal = null;
  function focoInicial() {
    const m = modalAberto();
    const prefer = m ? ['#mPlay'] : ['#heroPlay', '#back', '.tile', '.ch', '.ev', '.li', '#nav button.on'];
    for (const s of prefer) {
      const el = [...(m || document).querySelectorAll(s)].find(visivel);
      if (el) { el.focus({ preventScroll: true }); return; }
    }
  }
  let tmr;
  new MutationObserver(() => { clearTimeout(tmr); tmr = setTimeout(preparar, 250); })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('hashchange', () => setTimeout(preparar, 400));
  setTimeout(preparar, 600);

  function mover(dir) {
    const atual = document.activeElement;
    if (!atual || atual === document.body || !visivel(atual)) { focoInicial(); return; }
    const a = atual.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let melhor = null, nota = Infinity;
    for (const el of lista()) {
      if (el === atual || atual.contains(el) || el.contains(atual)) continue;
      const r = el.getBoundingClientRect();
      const dx = r.left + r.width / 2 - ax, dy = r.top + r.height / 2 - ay;
      let prim, sec;
      const mesmaLinha = Math.abs(dy) < (a.height + r.height) / 2;   // esquerda/direita ficam na mesma linha
      if (dir === 'ArrowRight') { if (dx < Math.min(a.width, r.width) * .4 || !mesmaLinha) continue; prim = dx; sec = Math.abs(dy); }
      else if (dir === 'ArrowLeft') { if (-dx < Math.min(a.width, r.width) * .4 || !mesmaLinha) continue; prim = -dx; sec = Math.abs(dy); }
      else if (dir === 'ArrowDown') { if (dy < Math.min(a.height, r.height) * .4) continue; prim = dy; sec = Math.abs(dx); }
      else { if (-dy < Math.min(a.height, r.height) * .4) continue; prim = -dy; sec = Math.abs(dx); }
      const n = prim + sec * 2.5;
      if (n < nota) { nota = n; melhor = el; }
    }
    if (melhor) {
      melhor.focus({ preventScroll: true });
      melhor.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    } else if (dir === 'ArrowUp' || dir === 'ArrowDown') {
      scrollBy(0, dir === 'ArrowDown' ? 240 : -240);
    }
  }

  function voltar() {
    if (modalAberto()) { document.getElementById('mClose').click(); return true; }
    if (location.hash) { if (history.length > 1) history.back(); else location.hash = ''; return true; }
    const home = document.querySelector('#nav button[data-p="home"]');
    if (home && !home.classList.contains('on')) { home.click(); return true; }
    return false;
  }

  document.addEventListener('keydown', e => {
    if (!ligado() || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = document.activeElement;
    const campo = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    const k = e.key, c = e.keyCode;
    if (k && k.indexOf('Arrow') === 0) {
      if (campo && (k === 'ArrowLeft' || k === 'ArrowRight') && el.value) return;   // mexer no cursor do texto
      if (el && el.tagName === 'SELECT' && (k === 'ArrowUp' || k === 'ArrowDown')) return;
      e.preventDefault(); mover(k); return;
    }
    if (k === 'Enter' || c === 13) {
      if (el && el.matches && el.matches(CARTAO)) { e.preventDefault(); el.click(); }
      else if (campo) el.blur();
      return;
    }
    const volta = k === 'Escape' || k === 'BrowserBack' || k === 'GoBack' || c === 10009 || c === 461 || (k === 'Backspace' && !campo);
    if (volta && voltar()) e.preventDefault();
  }, true);

  // botão "Controlar vídeo": passa o foco do teclado para dentro do player (embed)
  const ctl = document.getElementById('tvCtl');
  if (ctl) ctl.onclick = () => {
    const f = document.querySelector('#pframe iframe');
    if (!f) return;
    f.setAttribute('tabindex', '0'); f.focus();
    const m = document.getElementById('msg');
    if (m) {
      m.textContent = 'Controles do vídeo ativos. Para sair do vídeo, use o botão Voltar do controle.';
      setTimeout(() => { if (m.textContent.indexOf('Controles') === 0) m.textContent = ''; }, 5000);
    }
  };
})();
