/* ============================================================================
   app.js — UI, roteamento por hash e telas. Vanilla JS.
   Depende de: Services (services.js), Store (store.js)
   ============================================================================ */
(function () {
  'use strict';

  /* ============================ utilidades ============================== */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const view = () => $('#view');

  function el(tag, attrs = {}, children) {
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    if (children != null) (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---- paleta suave determinística (avatares de advogados e tags) ---- */
  const SOFT_PALETTE = ['#6366F1', '#0E9F8E', '#C77D1A', '#D9456E', '#8B5CF6', '#2E8BD6', '#CC5A3A', '#3C9A5F', '#0E8CA8', '#B5559E'];
  function hashStr(s) { let h = 0; const str = String(s || '').toLowerCase(); for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; }
  function colorFor(s) { return SOFT_PALETTE[hashStr(s) % SOFT_PALETTE.length]; }

  /* ---- tags hierárquicas: "Familia/Guarda" (aceita \ ou /) ---- */
  function normTag(t) {
    return String(t || '').replace(/\\/g, '/').split('/').map((s) => s.trim()).filter(Boolean).join('/');
  }
  function tagParts(t) { return normTag(t).split('/').filter(Boolean); }
  function tagRoot(t)  { return tagParts(t)[0] || ''; }
  // cor pela RAIZ → "Familia/Guarda" e "Familia/Pensao" compartilham a cor
  function tagChip(t, extraClass) {
    const parts = tagParts(t);
    const c = el('span', { class: 'chip tag' + (parts.length > 1 ? ' tag-hier' : '') + (extraClass ? ' ' + extraClass : '') });
    c.style.setProperty('--c', colorFor(parts[0] || t));
    parts.forEach((p, i) => {
      if (i > 0) c.appendChild(el('span', { class: 'tag-sep', text: '/' }));
      c.appendChild(el('span', { class: 'tag-seg' + (i === parts.length - 1 ? ' leaf' : ''), text: p }));
    });
    if (!parts.length) c.textContent = t;
    return c;
  }

  function toast(msg) {
    const t = el('div', { class: 'toast', text: msg });
    $('#toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 2200);
  }

  /* ------------------------- modal de tags ----------------------------- */
  function openTagsModal(titulo, currentTags, onSave) {
    let tags = [...(currentTags || [])];
    const overlay = el('div', { class: 'modal-overlay' });
    const card = el('div', { class: 'modal-card' });
    card.appendChild(el('h3', { class: 'modal-title', text: titulo }));
    card.appendChild(el('p', { class: 'modal-sub', text: 'Enter ou vírgula adiciona. Use “/” para hierarquia (ex.: Família/Guarda). Backspace remove a última.' }));

    const tagInput = el('div', { class: 'tag-input' });
    const field = el('input', { class: 'tag-input-field', type: 'text', placeholder: 'Adicionar tag… (ex.: Família/Guarda)' });
    tagInput.appendChild(field);
    card.appendChild(tagInput);

    const sugg = el('div', { class: 'tag-sugg' });
    card.appendChild(sugg);

    function renderChips() {
      [...tagInput.querySelectorAll('.tag-chip')].forEach((n) => n.remove());
      tags.forEach((t, i) => {
        const parts = tagParts(t);
        const c = el('span', { class: 'tag-chip' + (parts.length > 1 ? ' tag-hier' : '') });
        c.style.setProperty('--c', colorFor(parts[0] || t));
        const lbl = el('span');
        parts.forEach((p, j) => {
          if (j > 0) lbl.appendChild(el('span', { class: 'tag-sep', text: '/' }));
          lbl.appendChild(el('span', { class: 'tag-seg' + (j === parts.length - 1 ? ' leaf' : ''), text: p }));
        });
        if (!parts.length) lbl.textContent = t;
        c.appendChild(lbl);
        const x = el('button', { class: 'tx', type: 'button', text: '✕' });
        x.addEventListener('click', () => { tags.splice(i, 1); renderChips(); renderSugg(); field.focus(); });
        c.appendChild(x);
        tagInput.insertBefore(c, field);
      });
    }
    function addTag(v) { v = normTag(v); if (v && !tags.includes(v)) { tags.push(v); renderChips(); renderSugg(); } }
    async function renderSugg() {
      let all = []; try { all = await Store.todasTags(); } catch (e) {}
      // sugere tags existentes E os ramos-pai já usados (para reaproveitar hierarquia)
      const roots = new Set(all.map(tagRoot).filter(Boolean));
      const opcoes = [...new Set([...roots, ...all])].sort((a, b) => a.localeCompare(b, 'pt'));
      sugg.innerHTML = '';
      const avail = opcoes.filter((t) => !tags.includes(t));
      if (!avail.length) return;
      sugg.appendChild(el('span', { class: 'tag-sugg-label', text: 'Existentes:' }));
      avail.slice(0, 16).forEach((t) => {
        const b = el('button', { class: 'tag-sugg-chip', type: 'button', text: t });
        b.addEventListener('click', () => { addTag(t); field.focus(); });
        sugg.appendChild(b);
      });
    }
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(field.value); field.value = ''; }
      else if (e.key === 'Backspace' && !field.value && tags.length) { tags.pop(); renderChips(); renderSugg(); }
    });

    const acts = el('div', { class: 'modal-actions' });
    const cancel = el('button', { class: 'btn', type: 'button', text: 'Cancelar' });
    const save = el('button', { class: 'btn primary', type: 'button', text: 'Salvar' });
    acts.append(cancel, save);
    card.appendChild(acts);

    function close() { overlay.classList.remove('show'); document.removeEventListener('keydown', onKey); setTimeout(() => overlay.remove(), 160); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    cancel.addEventListener('click', close);
    save.addEventListener('click', () => { addTag(field.value); field.value = ''; onSave(tags); close(); });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    renderChips(); renderSugg();
    requestAnimationFrame(() => overlay.classList.add('show'));
    setTimeout(() => field.focus(), 40);
  }

  /* ------------------------------- datas ------------------------------- */
  const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const DIAS = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  function parseISO(s) {
    if (!s) return null;
    const m = String(s).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function fmtData(s) { const d = parseISO(s); if (!d) return '—'; return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }
  function fmtDiaMes(s) { const d = parseISO(s); if (!d) return '—'; return `${String(d.getDate()).padStart(2,'0')} ${MESES[d.getMonth()]}`; }
  function hojeISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function diffDias(s) {
    const d = parseISO(s); if (!d) return null;
    const h = new Date(); h.setHours(0,0,0,0);
    return Math.round((d - h) / 86400000);
  }
  function relData(s) {
    const n = diffDias(s); if (n == null) return '';
    if (n === 0) return 'hoje';
    if (n === 1) return 'amanhã'; if (n === -1) return 'ontem';
    if (n < 0) return `há ${-n} dias`;
    return `em ${n} dias`;
  }

  function fmtCNJ(numero, cnj) {
    if (cnj && /\d{7}-\d{2}/.test(cnj)) return cnj;
    const d = String(numero || '').replace(/\D/g, '');
    if (d.length === 20) return `${d.slice(0,7)}-${d.slice(7,9)}.${d.slice(9,13)}.${d.slice(13,14)}.${d.slice(14,16)}.${d.slice(16)}`;
    return numero || '—';
  }

  function parseAdvogados(str) {
    if (!str) return [];
    return str.split('|').map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/^(.*?)\s*\(([^)]*\d[^)]*)\)\s*$/);
      return m ? { nome: m[1].trim(), oab: m[2].trim() } : { nome: s, oab: '' };
    });
  }
  function parsePartes(str) {
    if (!str) return [];
    return str.split('|').map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      return m ? { nome: m[1].trim(), polo: m[2].trim() } : { nome: s, polo: '' };
    });
  }

  /* ------------------------------ badges ------------------------------- */
  function badgesProc(p) {
    const wrap = el('span', { class: 'badges' });
    const add = (cls, label, n) => { if (n > 0) wrap.appendChild(el('span', { class: 'badge ' + cls, html: `${label}<span class="n">${n}</span>` })); };
    add('djen', 'DJEN', p.n_comunicacoes);
    add('tjrj', 'TJRJ', p.n_movimentos_tj);
    add('pje', 'PJe', p.n_movimentos_pje);
    add('mprj', 'MPRJ', p.n_movimentos_mp);
    add('evento', 'Evento', p.n_eventos_ia);
    return wrap;
  }

  /* ============================ estado global ========================== */
  const State = {
    favSet: new Set(),
    favData: new Map(),
    classes: [],
    total: 0,
    tweaks: Object.assign({ listLayout: 'tabela', accent: '#3D4ED6', density: 'denso', mostrarAssunto: true }, window.TWEAK_DEFAULTS || {}),
    suppressRoute: false,
    // contexto de navegação: posição de scroll por hash + flag de restauração
    scrollByHash: new Map(),
    curHash: null,
    restoringContext: false,
    lastListHash: null,
    backAnim: null,
  };

  // telas que mantêm contexto ao voltar (lista/busca, advogados, agenda, favoritos)
  const SCROLL_KEEP = new Set(['lista', 'advogado', 'partes', 'agenda', 'favoritos']);

  async function carregarFavoritos() {
    const favs = await Store.listarFavoritos();
    State.favSet = new Set(favs.map((f) => f.numero));
    State.favData = new Map(favs.map((f) => [f.numero, f]));
    const c = $('#fav-count');
    if (favs.length) { c.hidden = false; c.textContent = favs.length; } else c.hidden = true;
    const tc = $('#tab-fav-count');
    if (tc) { if (favs.length) { tc.hidden = false; tc.textContent = favs.length > 99 ? '99+' : favs.length; } else tc.hidden = true; }
    renderFavRail(favs);
  }

  function renderFavRail(favs) {
    const list = $('#fav-rail-list'); const empty = $('#fav-rail-empty');
    if (!list) return;
    list.innerHTML = '';
    if (!favs.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    favs.forEach((f) => {
      const a = el('div', { class: 'fav-mini' });
      a.addEventListener('click', () => go(`#/processo/${f.numero}`));
      const cnj = el('div', { class: 'fm-cnj' });
      cnj.innerHTML = '<svg class="fm-star" viewBox="0 0 20 20" width="11" height="11" fill="currentColor"><path d="M10 2.6l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4L5.5 16.8l.9-5L2.8 8.3l5-.7z"/></svg>';
      cnj.appendChild(el('span', { text: f.cnj || fmtCNJ(f.numero) }));
      a.appendChild(cnj);
      if (f.classe) a.appendChild(el('div', { class: 'fm-sub', text: f.classe }));
      if (f.tags && f.tags.length) {
        const tg = el('div', { class: 'fm-tags' });
        f.tags.slice(0, 4).forEach((t) => { const tc = el('span', { class: 'fm-tag', text: t }); tc.style.setProperty('--c', colorFor(t)); tg.appendChild(tc); });
        a.appendChild(tg);
      }
      list.appendChild(a);
    });
  }

  /* ============================ favoritar ============================== */
  async function toggleFav(p, btn) {
    const numero = p.numero;
    if (State.favSet.has(numero)) {
      await Store.removerFavorito(numero);
      State.favSet.delete(numero); State.favData.delete(numero);
      toast('Removido dos favoritos');
    } else {
      const rec = await Store.adicionarFavorito({ numero, cnj: fmtCNJ(p.numero, p.cnj), classe: p.classe, tags: [] });
      State.favSet.add(numero); State.favData.set(numero, rec);
      toast('Adicionado aos favoritos');
    }
    await carregarFavoritos();
    if (btn) btn.classList.toggle('on', State.favSet.has(numero));
    document.dispatchEvent(new CustomEvent('fav-changed', { detail: { numero } }));
  }

  function starBtn(p) {
    const on = State.favSet.has(p.numero);
    const b = el('button', { class: 'star' + (on ? ' on' : ''), title: on ? 'Desfavoritar' : 'Favoritar', 'aria-label': 'Favoritar' });
    b.innerHTML = `<svg viewBox="0 0 20 20" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M10 2.6l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4L5.5 16.8l.9-5L2.8 8.3l5-.7z"/></svg>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(p, b).then(() => { b.querySelector('svg').setAttribute('fill', State.favSet.has(p.numero) ? 'currentColor' : 'none'); }); });
    return b;
  }

  /* ====================== render lista de processos ==================== */
  function renderListaProcessos(rows, container, opts = {}) {
    container.innerHTML = '';
    if (!rows.length) {
      container.appendChild(emptyState('Nenhum processo encontrado', 'Ajuste a busca ou os filtros para ver resultados.'));
      return;
    }
    const layout = State.tweaks.listLayout;
    const goQ = opts.goQ;
    if (layout === 'cards') return container.appendChild(listaCards(rows, goQ));
    if (layout === 'compacta') return container.appendChild(listaCompacta(rows, goQ));
    return container.appendChild(listaTabela(rows, goQ));
  }

  function procHref(numero, goQ) {
    return `#/processo/${numero}` + (goQ ? `?q=${encodeURIComponent(goQ)}` : '');
  }

  function listaTabela(rows, goQ) {
    const wrap = el('div', { class: 'list-wrap' });
    const t = el('table', { class: 'ptable' });
    t.innerHTML = `<thead><tr>
      <th class="col-star"></th>
      <th>Processo (CNJ)</th>
      <th>Classe / Órgão</th>
      <th>Atividade</th>
      <th>Última mov.</th>
    </tr></thead>`;
    const tb = el('tbody');
    rows.forEach((p) => {
      const tr = el('tr');
      tr.addEventListener('click', () => go(procHref(p.numero, goQ)));
      const tdStar = el('td', { class: 'col-star' }); tdStar.appendChild(starBtn(p));
      const tdCnj = el('td', {}, el('span', { class: 'cnj', text: fmtCNJ(p.numero, p.cnj) }));
      const tdCls = el('td');
      tdCls.appendChild(el('div', { class: 'cell-classe', text: p.classe || '—' }));
      tdCls.appendChild(el('div', { class: 'cell-sub', text: p.orgao || '' }));
      const tdAct = el('td', {}, badgesProc(p));
      const tdDate = el('td');
      const dt = el('span', { class: 'cell-date' });
      dt.appendChild(document.createTextNode(fmtData(p.data_ultima_com || p.data_ultimo_mov)));
      const rel = relData(p.data_ultima_com || p.data_ultimo_mov);
      if (rel) dt.appendChild(el('span', { class: 'rel', text: rel }));
      tdDate.appendChild(dt);
      tr.append(tdStar, tdCnj, tdCls, tdAct, tdDate);
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t);
    return wrap;
  }

  function listaCards(rows, goQ) {
    const grid = el('div', { class: 'cards' });
    rows.forEach((p) => {
      const c = el('div', { class: 'pcard' });
      c.addEventListener('click', () => go(procHref(p.numero, goQ)));
      const top = el('div', { class: 'pc-top' });
      top.appendChild(el('span', { class: 'cnj', text: fmtCNJ(p.numero, p.cnj) }));
      const s = starBtn(p); top.appendChild(s);
      c.appendChild(top);
      c.appendChild(el('div', { class: 'pc-classe', text: p.classe || '—' }));
      c.appendChild(el('div', { class: 'pc-org', text: p.orgao || '' }));
      const foot = el('div', { class: 'pc-foot' });
      foot.appendChild(badgesProc(p));
      foot.appendChild(el('span', { class: 'pc-date', text: fmtData(p.data_ultima_com || p.data_ultimo_mov) }));
      c.appendChild(foot);
      grid.appendChild(c);
    });
    return grid;
  }

  function listaCompacta(rows, goQ) {
    const wrap = el('div', { class: 'compact-list' });
    rows.forEach((p) => {
      const r = el('div', { class: 'crow' });
      r.addEventListener('click', () => go(procHref(p.numero, goQ)));
      const st = starBtn(p); st.style.flex = 'none';
      r.appendChild(st);
      r.appendChild(el('span', { class: 'cnj', text: fmtCNJ(p.numero, p.cnj) }));
      const mid = el('div', { class: 'crow-mid' });
      mid.appendChild(el('div', { class: 't', text: p.classe || '—' }));
      mid.appendChild(el('div', { class: 's', text: p.orgao || '' }));
      r.appendChild(mid);
      r.appendChild(badgesProc(p));
      r.appendChild(el('span', { class: 'cell-date', text: fmtData(p.data_ultima_com || p.data_ultimo_mov) }));
      wrap.appendChild(r);
    });
    return wrap;
  }

  function emptyState(titulo, msg, icon) {
    const e = el('div', { class: 'empty' });
    e.innerHTML = `<svg class="em-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">${icon || '<path d="M4 5h16M4 12h16M4 19h10"/>'}</svg><h3>${esc(titulo)}</h3><p>${esc(msg)}</p>`;
    return e;
  }

  /* ============================== TELA 1: lista ======================== */
  function screenLista(params) {
    const q = params.q || '';
    const v = view();
    v.innerHTML = '';
    setActiveNav(q ? 'lista' : 'lista');

    const top = el('div', { class: 'topbar' });
    const row = el('div', { class: 'topbar-row' });
    row.appendChild(el('h1', { class: 'page-title', text: 'Processos' }));
    const meta = el('span', { class: 'page-sub' }); meta.id = 'lista-meta';
    row.appendChild(meta);
    top.appendChild(row);

    const tools = el('div', { class: 'topbar-row', style: 'margin-top:14px;' });
    const field = el('div', { class: 'field', style: 'flex:1; max-width:520px;' });
    field.innerHTML = `<svg class="ico-search" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="6"/><path d="M14 14l4 4" stroke-linecap="round"/></svg>`;
    const input = el('input', { class: 'input', type: 'search', placeholder: 'Buscar em processos, comunicações e movimentos…', value: q });
    field.appendChild(input);
    tools.appendChild(field);

    const selClasse = el('select', { class: 'input', style: 'width:auto; min-width:170px; max-width:260px;' });
    selClasse.appendChild(el('option', { value: '', text: 'Todas as classes' }));
    State.classes.forEach((c) => selClasse.appendChild(el('option', { value: c.classe, text: `${c.classe} (${c.n})` })));
    selClasse.value = params.classe || '';
    tools.appendChild(selClasse);

    const togFav = el('div', { class: 'toggle', tabindex: '0' });
    togFav.innerHTML = `<span class="sw"></span><span>Só favoritos</span>`;
    tools.appendChild(togFav);
    top.appendChild(tools);
    v.appendChild(top);

    const content = el('div', { class: 'content' });
    const results = el('div'); results.id = 'lista-results';
    content.appendChild(results);
    v.appendChild(content);

    let soFav = false;
    let curQ = q, curClasse = selClasse.value;

    function run() {
      let rows;
      if (curQ.trim()) {
        try {
          rows = Services.buscaGeral(curQ);
        } catch (e) {
          // FTS5 indisponível: fallback para busca LIKE
          rows = Services.listarProcessos({ classe: curClasse }).filter((r) => {
            const t = curQ.toLowerCase();
            return (r.numero || '').includes(t) || (r.cnj || '').toLowerCase().includes(t)
              || (r.assunto || '').toLowerCase().includes(t) || (r.partes || '').toLowerCase().includes(t)
              || (r.advogados || '').toLowerCase().includes(t);
          });
        }
        if (curClasse) rows = rows.filter((r) => r.classe === curClasse);
        if (soFav) rows = rows.filter((r) => State.favSet.has(r.numero));
        meta.textContent = `${rows.length} resultado${rows.length !== 1 ? 's' : ''} para "${curQ.trim()}"`;
      } else {
        rows = Services.listarProcessos({ classe: curClasse });
        if (soFav) rows = rows.filter((r) => State.favSet.has(r.numero));
        meta.textContent = `${rows.length} de ${State.total}`;
      }
      renderListaProcessos(rows, results, { goQ: curQ.trim() || undefined });
    }

    let deb;
    input.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(() => {
        curQ = input.value;
        const h = curQ.trim() ? `#/buscar?q=${encodeURIComponent(curQ.trim())}` : '#/';
        State.suppressRoute = true; location.hash = h; setTimeout(() => State.suppressRoute = false, 0);
        run();
      }, 400);
    });
    selClasse.addEventListener('change', () => { curClasse = selClasse.value; run(); });
    togFav.addEventListener('click', () => { soFav = !soFav; togFav.classList.toggle('on', soFav); run(); });

    run();
    // não rouba o foco ao voltar (evita o "pulo" para o campo no mobile)
    if (q && !State.restoringContext) setTimeout(() => input.focus(), 30);
  }

  /* ============================== TELA 2: detalhe ====================== */
  function poloClasse(polo) {
    const s = (polo || '').toLowerCase();
    if (s.includes('ativo') || s.includes('autor') || s.includes('exequente') || s.includes('requerente') || s.includes('impetrante') || s.includes('agravante') || s.includes('apelante')) return 'ativo';
    if (s.includes('passivo') || s.includes('réu') || s.includes('reu') || s.includes('executad') || s.includes('requerid') || s.includes('impetrad') || s.includes('agravad') || s.includes('apelad')) return 'passivo';
    return 'outro';
  }
  const POLO_LABEL = { ativo: 'Polo ativo', passivo: 'Polo passivo', outro: 'Demais partes' };

  function screenDetalhe(numero, sub) {
    const v = view();
    const p = Services.obterProcesso(numero);
    if (!p) {
      v.innerHTML = '';
      const e = emptyState('Processo não encontrado', `Não há processo com o número ${numero} no banco.`, '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>');
      const back = el('a', { class: 'btn', href: '#/', style: 'margin-top:18px; display:inline-flex;', text: '← Voltar para processos' });
      e.appendChild(back);
      const wrap = el('div', { class: 'content' }); wrap.appendChild(e); v.appendChild(wrap);
      return;
    }
    v.innerHTML = '';

    /* ---------------- cabeçalho ---------------- */
    const head = el('div', { class: 'detail-head' });
    // "voltar" preserva o contexto de origem (busca/advogado/agenda/favoritos)
    const backHref = State.lastListHash
      || (sub && sub.q ? `#/buscar?q=${encodeURIComponent(sub.q)}` : '#/');
    const backLabel = (backHref && backHref !== '#/' && !backHref.startsWith('#/processo')) ? 'Voltar' : 'Processos';
    head.appendChild(el('a', { class: 'back-link', href: backHref, html: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 3L5 8l5 5" stroke-linecap="round" stroke-linejoin="round"/></svg> ' + backLabel }));

    const main = el('div', { class: 'dh-main' });
    const title = el('div', { class: 'dh-title' });
    title.appendChild(el('div', { class: 'dh-cnj', text: fmtCNJ(p.numero, p.cnj) }));
    title.appendChild(el('div', { class: 'dh-classe', text: p.classe || '—' }));
    const dmeta = el('div', { class: 'dh-meta' });
    if (p.orgao) dmeta.appendChild(el('span', { text: p.orgao }));
    if (p.assunto) dmeta.appendChild(el('span', { text: '· ' + p.assunto }));
    title.appendChild(dmeta);
    main.appendChild(title);

    const actions = el('div', { class: 'dh-actions' });
    const favOn = State.favSet.has(p.numero);
    const favBtn = el('button', { class: 'btn' + (favOn ? ' active' : '') });
    favBtn.innerHTML = `<svg class="ico" viewBox="0 0 20 20" fill="${favOn ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M10 2.6l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4L5.5 16.8l.9-5L2.8 8.3l5-.7z"/></svg> <span>${favOn ? 'Favoritado' : 'Favoritar'}</span>`;
    const tagBtn = el('button', { class: 'btn', html: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3h6l8 8-6 6-8-8V3z" stroke-linejoin="round"/><circle cx="6.5" cy="6.5" r="1.2" fill="currentColor"/></svg> <span>Tags</span>' });
    const printBtn = el('button', { class: 'btn icon', title: 'Imprimir', html: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 8V3h8v5M6 14H4v-4h12v4h-2M6 12h8v5H6z"/></svg>' });
    printBtn.addEventListener('click', () => window.print());
    favBtn.addEventListener('click', async () => {
      await toggleFav(p, null);
      const on = State.favSet.has(p.numero);
      favBtn.classList.toggle('active', on);
      favBtn.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none');
      favBtn.querySelector('span').textContent = on ? 'Favoritado' : 'Favoritar';
      renderTagCard();
    });
    tagBtn.addEventListener('click', () => {
      if (!State.favSet.has(p.numero)) { toggleFav(p, null).then(() => { favBtn.classList.add('active'); favBtn.querySelector('svg').setAttribute('fill','currentColor'); favBtn.querySelector('span').textContent='Favoritado'; openTags(p); }); }
      else openTags(p);
    });
    actions.append(favBtn, tagBtn, printBtn);
    main.appendChild(actions);
    head.appendChild(main);
    v.appendChild(head);

    /* ---------------- grid 2 colunas ---------------- */
    const grid = el('div', { class: 'detail-grid' });
    const mainCol = el('div', { class: 'detail-main' });
    const rail = el('aside', { class: 'detail-rail' });
    grid.append(mainCol, rail);
    v.appendChild(grid);

    const totalMov = (p.n_movimentos_tj || 0) + (p.n_movimentos_pje || 0) + (p.n_movimentos_mp || 0);
    const tabsDef = [
      { id: 'tudo',         label: 'Tudo',         n: totalMov + (p.n_comunicacoes || 0) + (p.n_eventos_ia || 0), always: true },
      { id: 'movimentos',   label: 'Movimentos',   n: totalMov },
      { id: 'comunicacoes', label: 'Comunicações', n: p.n_comunicacoes || 0 },
      { id: 'eventos',      label: 'Eventos',      n: p.n_eventos_ia || 0 },
    ].filter((t) => t.always || t.n > 0);
    const tabs = el('div', { class: 'tabs' });
    tabsDef.forEach((t) => tabs.appendChild(el('button', { class: 'tab', 'data-tab': t.id, html: `${t.label}<span class="cnt">${t.n}</span>` })));
    mainCol.appendChild(tabs);

    const searchRow = el('div', { class: 'detail-search' });
    const fld = el('div', { class: 'field' });
    fld.innerHTML = `<svg class="ico-search" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="6"/><path d="M14 14l4 4" stroke-linecap="round"/></svg>`;
    const searchInput = el('input', { class: 'input', type: 'search', placeholder: 'Buscar nesta linha do tempo…' });
    fld.appendChild(searchInput);
    searchRow.appendChild(fld);
    mainCol.appendChild(searchRow);

    const body = el('div', { class: 'detail-body' });
    mainCol.appendChild(body);

    const printHead = el('div', { class: 'print-head' });
    printHead.innerHTML = `<div class="ph-cnj">${esc(fmtCNJ(p.numero, p.cnj))}</div><div class="ph-meta">${esc(p.classe||'')} · ${esc(p.orgao||'')} — gerado em ${fmtData(hojeISO())}</div>`;
    v.insertBefore(printHead, v.firstChild);

    const validTabs = new Set(tabsDef.map((t) => t.id));
    let aba = (sub && sub.tab && validTabs.has(sub.tab)) ? sub.tab : 'tudo';
    // a busca da timeline é independente da busca da lista principal.
    // (sub.q vem da URL só para o "voltar" preservar o contexto da lista.)
    let filtro = '';
    function activate(tab) {
      aba = tab;
      $$('.tab', tabs).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      Store.setPref('ultima_aba_processo', tab);
      let panel = $('#tab-panel');
      if (!panel) { panel = el('div', { id: 'tab-panel' }); body.appendChild(panel); }
      panel.innerHTML = '';
      panel.appendChild(renderTab(tab, p, sub, filtro));
    }
    $$('.tab', tabs).forEach((b) => b.addEventListener('click', () => { history.replaceState(null, '', `#/processo/${numero}`); activate(b.dataset.tab); }));
    let debS;
    searchInput.addEventListener('input', () => { clearTimeout(debS); debS = setTimeout(() => { filtro = searchInput.value; activate(aba); }, 250); });
    activate(aba);

    const printAll = el('div', { class: 'print-only' });
    printAll.appendChild(renderTab('tudo', p, { expandAll: true }, ''));
    body.appendChild(printAll);

    /* ---------------- rail ---------------- */
    const tagCard = el('div', { class: 'rail-card' });
    function renderTagCard() {
      const rec = State.favData.get(p.numero);
      tagCard.innerHTML = '';
      if (!rec || !rec.tags || !rec.tags.length) { tagCard.style.display = 'none'; return; }
      tagCard.style.display = 'block';
      tagCard.appendChild(el('h4', { text: 'Tags' }));
      const chips = el('div', { class: 'chips' });
      rec.tags.forEach((t) => chips.appendChild(tagChip(t)));
      tagCard.appendChild(chips);
    }
    function openTags(proc) {
      const rec = State.favData.get(proc.numero) || { tags: [] };
      openTagsModal('Tags · ' + fmtCNJ(proc.numero, proc.cnj), rec.tags || [], (tags) => {
        Store.atualizarTags(proc.numero, tags).then((r) => { if (r) State.favData.set(proc.numero, r); renderTagCard(); carregarFavoritos(); toast('Tags atualizadas'); });
      });
    }

    const resumo = el('div', { class: 'rail-card' });
    resumo.appendChild(el('h4', { text: 'Resumo do processo' }));
    const facts = el('div', { class: 'rail-facts' });
    const addFact = (k, val, mono) => { if (!val) return; const f = el('div', { class: 'rail-fact' }); f.appendChild(el('span', { class: 'k', text: k })); f.appendChild(el('span', { class: 'v' + (mono ? ' mono' : ''), text: val })); facts.appendChild(f); };
    addFact('Órgão', p.orgao);
    addFact('Comarca', p.comarca);
    addFact('Vara', p.vara && p.vara !== p.orgao ? p.vara : null);
    addFact('Assunto', p.assunto);
    addFact('Rito', p.desc_rito);
    addFact('Nº MP', p.numero_mp, true);
    addFact('Cód. TJRJ', p.codigo_tjrj, true);
    addFact('Última com.', fmtData(p.data_ultima_com), true);
    addFact('Último mov.', fmtData(p.data_ultimo_mov), true);
    resumo.appendChild(facts);
    const badgeRow = el('div', { class: 'rail-badges' }); badgeRow.appendChild(badgesProc(p)); resumo.appendChild(badgeRow);
    rail.appendChild(resumo);

    renderTagCard();
    rail.appendChild(tagCard);

    // Partes: identificadas (tabela partes_processo, com polo+fonte) acima; demais (string) abaixo
    const identP = Services.partesDoProcesso(p.numero);
    const partesStr = parsePartes(p.partes);
    if (identP.length || partesStr.length) {
      const card = el('div', { class: 'rail-card' });
      const ordem = { ativo: 0, passivo: 1, outro: 2 };
      const ident = identP.slice().sort((a, b) => (ordem[a.polo] - ordem[b.polo]) || a.nome.localeCompare(b.nome, 'pt'));
      const idKeys = new Set(ident.map((x) => x.key));
      const outras = partesStr.filter((x) => !idKeys.has(Services.keyPessoa(x.nome)));
      card.appendChild(el('h4', { text: `Partes (${ident.length + outras.length})` }));

      if (ident.length) {
        const wrap = el('div', { class: 'parte-ident' });
        ident.forEach((x) => {
          const row = el('div', { class: 'parte-row polo-parte-link' });
          row.addEventListener('click', () => go('#/partes?q=' + encodeURIComponent(x.nome)));
          row.appendChild(el('span', { class: 'parte-nome', text: x.nome }));
          const tag = el('span', { class: 'parte-tag' });
          tag.appendChild(el('span', { class: 'parte-tag-dot polo-' + x.polo }));
          const parts = [];
          if (x.polo === 'ativo' || x.polo === 'passivo') parts.push(POLO_LABEL[x.polo]);
          if (x.fonte) parts.push(x.fonte);
          tag.appendChild(el('span', { text: parts.join(' · ') || '—' }));
          row.appendChild(tag);
          wrap.appendChild(row);
        });
        card.appendChild(wrap);
      }
      if (outras.length) {
        const gr = el('div', { class: 'polo-group', style: ident.length ? 'margin-top:14px;' : '' });
        gr.appendChild(el('div', { class: 'polo-label outro', text: 'Outras' }));
        outras.forEach((x) => gr.appendChild(el('div', { class: 'polo-parte', text: x.nome })));
        card.appendChild(gr);
      }
      rail.appendChild(card);
    }

    const advs = parseAdvogados(p.advogados);
    if (advs.length) {
      const card = el('div', { class: 'rail-card' });
      card.appendChild(el('h4', { text: `Advogados (${advs.length})` }));
      const chips = el('div', { class: 'chips' });
      advs.slice(0, 16).forEach((a) => {
        const c = el('span', { class: 'chip click' });
        c.appendChild(el('span', { text: a.nome }));
        if (a.oab) c.appendChild(el('span', { class: 'oab', text: a.oab.replace(/^OAB[\s/]*/i, '') }));
        c.addEventListener('click', () => go(`#/advogado?q=${encodeURIComponent(a.nome)}`));
        chips.appendChild(c);
      });
      if (advs.length > 16) chips.appendChild(el('span', { class: 'chip', text: `+${advs.length - 16}` }));
      card.appendChild(chips);
      rail.appendChild(card);
    }
  }

  /* ---- ícones e helpers da linha do tempo ---- */
  const TL_ICON = {
    tjrj: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8l5-5 3 3-5 5zM6 6l3 3M11 11l5 5M8.5 8.5l3 3M3 17h8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mprj: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 2v16M5 6h10M5 6l-2.5 5h5zM15 6l2.5 5h-5z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pje: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="4" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 14v3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    djen: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="14" height="11" rx="1.5"/><path d="M3.5 6l6.5 5 6.5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    evento: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M3 8h14M7 2v3M13 2v3" stroke-linecap="round"/></svg>',
    pdf: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2h6l4 4v12H6z" stroke-linejoin="round"/><path d="M12 2v4h4" stroke-linejoin="round"/><path d="M8 12h4M8 15h3" stroke-linecap="round"/></svg>',
    ext: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 4H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3M12 3h5v5M9 11l8-8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function tlItem(dataISO, dotClass, bodyEl) {
    const item = el('div', { class: 'tl-item' });
    const date = el('div', { class: 'tl-date' });
    date.appendChild(el('div', { class: 'd', text: fmtDiaMes(dataISO) }));
    const d = parseISO(dataISO); date.appendChild(el('div', { class: 'y', text: d ? d.getFullYear() : '' }));
    const track = el('div', { class: 'tl-track' });
    track.appendChild(el('span', { class: 'tl-dot ' + dotClass }));
    track.appendChild(bodyEl);
    item.append(date, track);
    return item;
  }
  function movCardBody(m) {
    const f = (m.fonte || '').toUpperCase();
    const src = f.includes('PJE') ? 'pje' : f.includes('MP') ? 'mprj' : 'tjrj';
    const card = el('div', { class: 'tl-card' });
    const lbl = el('div', { class: 'tl-src ' + src, html: TL_ICON[src] });
    lbl.appendChild(el('span', { text: 'Movimento · ' + (m.fonte || src.toUpperCase()) }));
    card.appendChild(lbl);
    card.appendChild(el('div', { class: 'tl-desc', text: m.descricao || '—' }));
    if (m.detalhe && m.detalhe.trim()) card.appendChild(el('div', { class: 'tl-detail', text: m.detalhe.trim() }));
    return { card, src };
  }
  function evCardBody(e) {
    const future = (diffDias(e.data_iso) || -1) >= 0;
    const card = el('div', { class: 'tl-card' + (future ? ' tl-future' : '') });
    const lbl = el('div', { class: 'tl-src evento', html: TL_ICON.evento });
    lbl.appendChild(el('span', { text: future ? 'Evento · ' + relData(e.data_iso) : 'Evento' }));
    card.appendChild(lbl);
    card.appendChild(el('div', { class: 'tl-desc', text: e.evento || '—' }));
    return card;
  }

  function comCertidaoHref(c) {
    const h = c.hash || c.hash_certidao;
    return h ? `https://comunicaapi.pje.jus.br/api/v1/comunicacao/${encodeURIComponent(h)}/certidao` : '';
  }
  function comLinkHref(c, p) {
    const num = c.numero_comunicacao || c.id_comunicacao;
    if (num) return `https://comunica.pje.jus.br/consulta?numeroComunicacao=${encodeURIComponent(num)}&numeroProcesso=${encodeURIComponent(p.numero)}`;
    return c.link || '';
  }
  function comunicacaoItem(c, p, opts = {}) {
    const com = el('div', { class: 'com' + (opts.inTimeline ? ' com--tl' : '') });
    const head = el('div', { class: 'com-head' });
    head.appendChild(el('span', { class: 'com-date', text: fmtData(c.data_disponibilizacao) }));
    head.appendChild(el('div', { class: 'com-title', text: c.tipo_comunicacao || 'Comunicação' }));
    const acts = el('div', { class: 'com-actions' });
    const cert = comCertidaoHref(c);
    if (cert) acts.appendChild(el('a', { class: 'com-btn', href: cert, target: '_blank', rel: 'noopener', title: 'Abrir certidão (PDF)', html: TL_ICON.pdf + '<span>Certidão</span>' }));
    const link = comLinkHref(c, p);
    if (link) acts.appendChild(el('a', { class: 'com-btn', href: link, target: '_blank', rel: 'noopener', title: 'Abrir no Comunica PJe', html: TL_ICON.ext + '<span>Link</span>' }));
    head.appendChild(acts);
    com.appendChild(head);

    const sline = [c.tipo_documento, c.nome_orgao].filter(Boolean).join(' · ');
    if (sline) com.appendChild(el('div', { class: 'com-sub', text: sline }));

    const isLong = (c.texto_len || 0) > 300;
    const preview = el('div', { class: 'com-preview' });
    const txt = (c.preview || '').trim();
    const previewText = el('span', { class: 'com-preview-text', text: txt + (isLong ? '… ' : '') });
    preview.appendChild(previewText);
    com.appendChild(preview);

    const full = el('div', { class: 'com-full' }); full.style.display = 'none';
    let loaded = false;
    function expand() {
      if (!loaded) { full.textContent = Services.obterTextoComunicacao(c.id) || '(texto vazio)'; loaded = true; }
      full.style.display = 'block'; previewText.style.display = 'none'; if (moreBtn) moreBtn.textContent = 'Recolher texto';
    }
    function collapse() { full.style.display = 'none'; previewText.style.display = ''; if (moreBtn) moreBtn.textContent = 'Ver texto completo'; }

    let moreBtn = null;
    if (isLong) {
      moreBtn = el('button', { class: 'com-more', text: 'Ver texto completo' });
      moreBtn.addEventListener('click', () => { full.style.display === 'none' ? expand() : collapse(); });
      preview.appendChild(document.createTextNode(' '));
      preview.appendChild(moreBtn);
      com.appendChild(full);
    }
    if (opts.expandAll && isLong) expand();
    com._expand = isLong ? expand : () => {};
    return com;
  }

  const _inc = (s, t) => String(s == null ? '' : s).toLowerCase().includes(t);
  const movMatch = (m, t) => _inc(m.descricao, t) || _inc(m.detalhe, t) || _inc(m.fonte, t);
  const comMatch = (c, t) => _inc(c.preview, t) || _inc(c.tipo_comunicacao, t) || _inc(c.tipo_documento, t) || _inc(c.nome_orgao, t);
  const comMatchFull = (c, t) => comMatch(c, t) || _inc(Services.obterTextoComunicacao(c.id), t);
  const evMatch = (e, t) => _inc(e.evento, t);

  function renderTab(tab, p, sub, filtro) {
    const t = (filtro || '').trim().toLowerCase();
    if (tab === 'tudo') return tabTudo(p, sub, t);
    if (tab === 'movimentos') return tabMovimentos(p, t);
    if (tab === 'comunicacoes') return tabComunicacoes(p, sub, t);
    return tabEventos(p, t);
  }

  function tabTudo(p, sub, t) {
    const movs = Services.listarMovimentos(p.numero).map((m) => ({ k: 'mov', data: m.data_iso, m }));
    const coms = Services.listarComunicacoes(p.numero).map((c) => ({ k: 'com', data: c.data_disponibilizacao, c }));
    const evs = Services.listarEventos(p.numero).map((e) => ({ k: 'evt', data: e.data_iso, e }));
    let all = [...movs, ...coms, ...evs];
    if (t) all = all.filter((x) => x.k === 'mov' ? movMatch(x.m, t) : x.k === 'com' ? comMatchFull(x.c, t) : evMatch(x.e, t));
    if (!all.length) return emptyState(t ? 'Nada encontrado' : 'Sem registros', t ? 'Nenhum item corresponde à busca.' : 'Este processo não possui registros.');
    all.sort((a, b) => { const da = a.data || '', db = b.data || ''; return da < db ? 1 : da > db ? -1 : 0; });
    const tl = el('div', { class: 'timeline' });
    const expandId = sub && sub.comId ? String(sub.comId) : null;
    all.forEach((x) => {
      if (x.k === 'mov') { const { card, src } = movCardBody(x.m); tl.appendChild(tlItem(x.data, src, card)); }
      else if (x.k === 'com') {
        const autoExpand = (sub && sub.expandAll) || (!!t && !comMatch(x.c, t)); // expand se match só no texto completo
        const com = comunicacaoItem(x.c, p, { expandAll: autoExpand, inTimeline: true });
        if (expandId && String(x.c.id) === expandId) { com._expand(); setTimeout(() => com.scrollIntoView({ block: 'center' }), 80); }
        tl.appendChild(tlItem(x.data, 'djen', com));
      } else { tl.appendChild(tlItem(x.data, 'evento', evCardBody(x.e))); }
    });
    return tl;
  }

  function tabMovimentos(p, t) {
    let movs = Services.listarMovimentos(p.numero);
    if (t) movs = movs.filter((m) => movMatch(m, t));
    if (!movs.length) return emptyState('Sem movimentos', t ? 'Nenhum movimento corresponde à busca.' : 'Este processo não possui movimentos registrados.');
    const tl = el('div', { class: 'timeline' });
    movs.forEach((m) => { const { card, src } = movCardBody(m); tl.appendChild(tlItem(m.data_iso, src, card)); });
    return tl;
  }

  function tabComunicacoes(p, sub, t) {
    let coms = Services.listarComunicacoes(p.numero);
    if (t) coms = coms.filter((c) => comMatchFull(c, t));
    if (!coms.length) return emptyState('Sem comunicações', t ? 'Nenhuma comunicação corresponde à busca.' : 'Não há comunicações (DJEN) para este processo.');
    const list = el('div', { class: 'com-list' });
    const expandId = sub && sub.comId ? String(sub.comId) : null;
    coms.forEach((c) => {
      const autoExpand = (sub && sub.expandAll) || (!!t && !comMatch(c, t));
      const com = comunicacaoItem(c, p, { expandAll: autoExpand });
      if (expandId && String(c.id) === expandId) { com._expand(); setTimeout(() => com.scrollIntoView({ block: 'center' }), 80); }
      list.appendChild(com);
    });
    return list;
  }

  function tabEventos(p, t) {
    let evs = Services.listarEventos(p.numero);
    if (t) evs = evs.filter((e) => evMatch(e, t));
    if (!evs.length) return emptyState('Sem eventos', t ? 'Nenhum evento corresponde à busca.' : 'Nenhum evento registrado para este processo.');
    const list = el('div', { class: 'ev-list' });
    evs.forEach((e) => {
      const future = (diffDias(e.data_iso) || -1) >= 0;
      const row = el('div', { class: 'ev' + (future ? ' future' : '') });
      const dt = el('div');
      dt.appendChild(el('div', { class: 'ev-date', text: fmtData(e.data_iso) }));
      if (future) dt.appendChild(el('span', { class: 'ev-flag', text: relData(e.data_iso) }));
      row.appendChild(dt);
      row.appendChild(el('div', { class: 'ev-text', text: e.evento || '—' }));
      list.appendChild(row);
    });
    return list;
  }

  /* ============================== TELA 3: advogado ===================== */
  function iniciais(nome) {
    const p = String(nome || '').trim().split(/\s+/);
    return (((p[0] || '')[0] || '') + ((p.length > 1 ? p[p.length - 1] : '')[0] || '')).toUpperCase() || '?';
  }
  function advCard(x) {
    const c = el('button', { class: 'adv-card' });
    c.style.setProperty('--c', colorFor(x.key || x.nome));
    c.appendChild(el('span', { class: 'adv-avatar', text: iniciais(x.nome) }));
    const info = el('div', { class: 'adv-info' });
    info.appendChild(el('div', { class: 'adv-name', text: x.nome }));
    if (x.oab) info.appendChild(el('div', { class: 'adv-oab', text: x.oab.replace(/^OAB[\s/]*/i, '') }));
    c.appendChild(info);
    const cnt = el('div', { class: 'adv-count' });
    cnt.appendChild(el('div', { class: 'num', text: x.n }));
    cnt.appendChild(el('div', { class: 'lab', text: x.n === 1 ? 'processo' : 'processos' }));
    c.appendChild(cnt);
    c.addEventListener('click', () => go('#/advogado?q=' + encodeURIComponent(x.nome)));
    return c;
  }
  function painelRelacionados(nome, rel, setB, onPick, b) {
    const card = el('div', { class: 'adv-related' });
    const compara = !!b;
    const pontesData = compara ? Services.grafoPontes(nome, b) : null;
    const pontes = pontesData ? pontesData.pontes : [];
    const direto = pontesData ? pontesData.direto : [];

    // Header: título + subtítulo à esquerda, toggle Lista/Rede à direita
    const toggle = el('div', { class: 'rel-toggle' });
    const btnLista = el('button', { class: 'rel-toggle-btn', text: 'Lista' });
    const btnRede  = el('button', { class: 'rel-toggle-btn', text: 'Rede' });
    toggle.append(btnLista, btnRede);

    const head = el('div', { class: 'adv-related-head' });
    const headLeft = el('div');
    if (compara) {
      headLeft.appendChild(el('h3', { html: `${esc(nome)} <span class="rel-x">✕</span> ${esc(b)}` }));
      const dir = direto.length ? ` · atuam juntos diretamente em ${direto.length} processo${direto.length !== 1 ? 's' : ''}` : '';
      headLeft.appendChild(el('div', { class: 'sub', text: `${pontes.length} advogado${pontes.length !== 1 ? 's' : ''} em comum ligam os dois${dir}` }));
    } else {
      headLeft.appendChild(el('h3', { text: nome }));
      headLeft.appendChild(el('div', { class: 'sub', text: `${rel.length} colaborador${rel.length !== 1 ? 'es' : ''} em processos — clique em um nome para comparar` }));
    }
    head.append(headLeft, toggle);
    card.appendChild(head);

    /* ----- LISTA ----- */
    const relList = el('div', { class: 'rel-list' });
    if (compara) {
      if (!pontes.length) {
        relList.appendChild(el('p', { class: 'result-meta', text: 'Nenhum advogado em comum entre os dois.' }));
      }
      const maxP = pontes.length ? Math.max(...pontes.map((p) => Math.max(p.n_comA, p.n_comB))) : 1;
      const firstName = (s) => String(s || '').trim().split(/\s+/)[0];
      pontes.forEach((p, i) => {
        const it = el('div', { class: 'rel-item rel-ponte' });
        it.appendChild(el('span', { class: 'rel-rank', text: '#' + (i + 1) }));
        const nm = el('span', { class: 'rel-name' });
        nm.appendChild(el('span', { text: p.nome }));
        if (p.oab) nm.appendChild(el('span', { class: 'oab', text: String(p.oab).replace(/^OAB[\s/]*/i, '') }));
        it.appendChild(nm);
        const dual = el('span', { class: 'rel-dual' });
        const mk = (cls, n) => {
          const seg = el('span', { class: 'rel-dual-seg ' + cls });
          const bar = el('i'); bar.style.width = Math.round((n / maxP) * 100) + '%';
          seg.appendChild(bar);
          seg.appendChild(el('b', { text: String(n) }));
          return seg;
        };
        dual.append(mk('seg-a', p.n_comA), mk('seg-b', p.n_comB));
        it.appendChild(dual);
        it.title = `${p.n_comA} processo(s) com ${firstName(nome)} · ${p.n_comB} com ${firstName(b)}`;
        it.addEventListener('click', () => go('#/advogado?q=' + encodeURIComponent(p.nome)));
        relList.appendChild(it);
      });
    } else {
      const max = rel[0].n_comum || 1;
      rel.forEach((r, i) => {
        const it = el('div', { class: 'rel-item' });
        it.appendChild(el('span', { class: 'rel-rank', text: '#' + (i + 1) }));
        const nm = el('span', { class: 'rel-name' });
        nm.appendChild(el('span', { text: r.nome }));
        if (r.oab) nm.appendChild(el('span', { class: 'oab', text: r.oab.replace(/^OAB[\s/]*/i, '') }));
        it.appendChild(nm);
        const bar = el('div', { class: 'rel-bar' }); const fill = el('i'); fill.style.width = Math.round((r.n_comum / max) * 100) + '%'; bar.appendChild(fill); it.appendChild(bar);
        it.appendChild(el('span', { class: 'rel-num', html: `<b>${r.n_comum}</b> em comum` }));
        it.addEventListener('click', () => { if (typeof setB === 'function') setB(r.nome); onPick(); });
        relList.appendChild(it);
      });
    }
    card.appendChild(relList);

    /* ----- REDE (grafo) ----- */
    const grafoWrap = el('div', { class: 'grafo-wrap' });
    grafoWrap.style.display = 'none';
    card.appendChild(grafoWrap);

    let grafoRendered = false;
    function showLista() {
      btnLista.classList.add('active'); btnRede.classList.remove('active');
      relList.style.display = ''; grafoWrap.style.display = 'none';
    }
    function showRede() {
      btnLista.classList.remove('active'); btnRede.classList.add('active');
      relList.style.display = 'none'; grafoWrap.style.display = '';
      if (!grafoRendered) {
        grafoRendered = true;
        if (window.GrafoAdv) {
          GrafoAdv.loadD3()
            .then(() => {
              if (compara) {
                GrafoAdv.renderPontes(grafoWrap, pontesData);
              } else {
                const gdata = Services.grafoAdvogado(nome, Math.min(rel.length, 50));
                GrafoAdv.render(grafoWrap, nome, gdata);
              }
            })
            .catch(() => { grafoWrap.textContent = 'Não foi possível carregar o diagrama.'; });
        } else {
          grafoWrap.textContent = 'grafo.js não carregado.';
        }
      }
    }
    btnLista.addEventListener('click', showLista);
    btnRede.addEventListener('click', showRede);

    // Ao comparar dois advogados, a Rede é a visão mais útil → abre nela.
    if (compara) showRede(); else showLista();

    return card;
  }

  /* Seção: overview da atuação do advogado (treemap tribunal → comarca → vara) */
  function painelAtuacao(nome, onFocus) {
    const card = el('div', { class: 'adv-related adv-atuacao' });
    const head = el('div', { class: 'adv-related-head' });
    const headLeft = el('div');
    headLeft.appendChild(el('h3', { text: 'Atuação por tribunal, comarca e vara' }));
    headLeft.appendChild(el('div', { class: 'sub', text: 'Área proporcional ao nº de comunicações — toque num bloco para descer um nível (tribunal → comarca → vara); use a trilha para voltar' }));
    head.appendChild(headLeft);
    card.appendChild(head);

    const wrap = el('div', { class: 'treemap-wrap' });
    wrap.textContent = 'Carregando…';
    card.appendChild(wrap);

    if (window.Charts) {
      Charts.loadD3()
        .then(() => {
          // hierarquia rica (orgaos_localizacao); cai no treemap simples se ausente
          const arvore = Services.atuacaoHierarquia(nome);
          if (arvore) Charts.renderTreemapDrill(wrap, arvore, { onFocus });
          else Charts.renderTreemap(wrap, Services.atuacaoAdvogado(nome));
        })
        .catch(() => { wrap.textContent = 'Não foi possível carregar o treemap.'; });
    } else {
      wrap.textContent = 'charts.js não carregado.';
    }
    return card;
  }

  function screenAdvogado(params) {
    const v = view(); v.innerHTML = ''; setActiveNav('advogado');
    const top = el('div', { class: 'topbar' });
    top.appendChild(el('div', { class: 'topbar-row', html: '<h1 class="page-title">Advogados</h1><span class="page-sub" id="adv-sub"></span>' }));
    const tools = el('div', { class: 'adv-toolbar', style: 'margin-top:14px;' });
    const fA = el('div', { class: 'field', style: 'flex:1; min-width:230px; max-width:340px;' });
    fA.innerHTML = `<svg class="ico-search" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="6"/><path d="M14 14l4 4" stroke-linecap="round"/></svg>`;
    const acA = makeAdvAC('Nome ou nº OAB', params.q || '');
    fA.appendChild(acA.el);
    const fB = el('div', { class: 'field', style: 'flex:1; min-width:230px; max-width:340px;' });
    fB.innerHTML = `<svg class="ico-search" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="6"/><path d="M14 14l4 4" stroke-linecap="round"/></svg>`;
    const acB = makeAdvAC('E também… (atuam juntos)', params.b || '');
    fB.appendChild(acB.el);
    const btn = el('button', { class: 'btn primary', text: 'Buscar' });
    const btnAll = el('a', { class: 'btn', href: '#/advogado', text: 'Ver todos' });
    tools.append(fA, fB, btn, btnAll);
    top.appendChild(tools);
    v.appendChild(top);

    const content = el('div', { class: 'content' });
    const results = el('div'); content.appendChild(results); v.appendChild(content);

    function navTo() {
      const a = acA.getValue(), b = acB.getValue();
      if (!a) { State.suppressRoute = true; location.hash = '#/advogado'; setTimeout(() => State.suppressRoute = false, 0); render(); return; }
      const h = '#/advogado?q=' + encodeURIComponent(a) + (b ? '&b=' + encodeURIComponent(b) : '');
      State.suppressRoute = true; location.hash = h; setTimeout(() => State.suppressRoute = false, 0);
      render();
    }
    btn.addEventListener('click', navTo);
    [acA, acB].forEach((ac) => {
      ac.addEventListener('keydown', (e) => { if (e.key === 'Enter') navTo(); });
      ac.addEventListener('change', navTo);
    });

    function render() {
      const a = acA.getValue(), b = acB.getValue();
      results.innerHTML = '';
      const sub = $('#adv-sub');
      if (!a) { renderDiretorio(sub); return; }
      sub.textContent = '';
      const rel = Services.advogadosRelacionados(a);
      if (rel.length || b) results.appendChild(painelRelacionados(a, rel, (v) => acB.setValue(v), navTo, b));
      results.appendChild(painelPartesAdv(a, b));

      const allRows = b ? Services.buscarDoisAdvogados(a, b) : Services.buscarPorAdvogado(a);
      const baseMeta = b ? `processos com <b>${esc(a)}</b> e <b>${esc(b)}</b>` : `processos com <b>${esc(a)}</b>`;
      let orgFilter = null; // { numeros:Set, label:string }

      const filterBar = el('div', { class: 'org-filter' });
      const metaEl = el('p', { class: 'result-meta' });
      const cont = el('div');

      function paintList() {
        const rows = orgFilter ? allRows.filter((r) => orgFilter.numeros.has(r.numero)) : allRows;
        metaEl.innerHTML = `<b>${rows.length}</b> ${baseMeta}`;
        filterBar.innerHTML = '';
        if (orgFilter) {
          filterBar.style.display = 'flex';
          filterBar.appendChild(el('span', { class: 'org-filter-label', text: 'Filtrando por' }));
          const chip = el('span', { class: 'org-filter-chip' });
          chip.innerHTML = '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 2.5c-3 0-5.5 2.3-5.5 5.3 0 4 5.5 9.7 5.5 9.7s5.5-5.7 5.5-9.7C15.5 4.8 13 2.5 10 2.5z" stroke-linejoin="round"/><circle cx="10" cy="7.8" r="1.9"/></svg>';
          chip.appendChild(el('span', { text: orgFilter.label }));
          const x = el('button', { class: 'ofc-x', type: 'button', text: '✕', title: 'Limpar filtro', 'aria-label': 'Limpar filtro' });
          x.addEventListener('click', () => { orgFilter = null; paintList(); });
          chip.appendChild(x);
          filterBar.appendChild(chip);
        } else {
          filterBar.style.display = 'none';
        }
        renderListaProcessos(rows, cont);
      }

      const onFocus = (node, names, viaLeaf) => {
        if (!node || node.level === 'root' || !node.numeros || !node.numeros.length) {
          orgFilter = null;
        } else {
          orgFilter = { numeros: new Set(node.numeros), label: (names && names.length ? names.join(' › ') : node.name) };
        }
        paintList();
        // toque numa vara (folha) leva o usuário até os resultados; navegar não rola
        if (viaLeaf) requestAnimationFrame(() => filterBar.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      };

      results.appendChild(painelAtuacao(a, onFocus));
      results.appendChild(filterBar);
      results.appendChild(metaEl);
      results.appendChild(cont);
      paintList();
    }

    function renderDiretorio(sub) {
      const all = Services.listarAdvogados();
      sub.textContent = `${all.length.toLocaleString('pt-BR')} advogados na base`;
      results.appendChild(el('p', { class: 'result-meta', text: 'Mais atuantes primeiro. Clique em um advogado para ver seus processos e parcerias.' }));
      const grid = el('div', { class: 'adv-grid' });
      results.appendChild(grid);
      function paint(term) {
        grid.innerHTML = '';
        const t = (term || '').trim().toLowerCase();
        const list = t ? all.filter((x) => x.nome.toLowerCase().includes(t) || (x.oab || '').toLowerCase().includes(t)) : all;
        list.slice(0, 400).forEach((x) => grid.appendChild(advCard(x)));
        if (!list.length) grid.appendChild(emptyState('Nenhum advogado', 'Ajuste o filtro.', '<circle cx="11" cy="9" r="3"/><path d="M5 19c0-3 3-5 6-5s6 2 6 5"/>'));
      }
      let deb;
      acA.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => paint(acA.getValue()), 220); });
      paint('');
    }

    render();
    if (!params.q && !State.restoringContext) setTimeout(() => acA.el.querySelector('input').focus(), 30);
  }

  /* ============================== TELA: Partes (pessoas) =============== */
  const REL_LABEL = { oposto: 'Polo oposto', mesmo: 'Mesmo polo', desconhecido: 'Polo indefinido', advogado: 'Advogado', central: 'Selecionado' };
  const POLO_TAG  = { ativo: 'Polo ativo', passivo: 'Polo passivo', outro: '' };
  function relCor(rel) {
    const cv = (n, fb) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;
    switch (rel) {
      case 'oposto':      return '#D9456E';
      case 'mesmo':       return cv('--djen', '#2563EB');
      case 'advogado':    return cv('--tjrj', '#15803D');
      case 'central':     return cv('--accent', '#0E7C66');
      default:            return cv('--muted', '#6B7585');
    }
  }

  // box exibido na tela de Advogados (pessoas do advogado, ou em comum entre dois)
  function painelPartesAdv(a, b) {
    const card = el('div', { class: 'adv-related' });
    const head = el('div', { class: 'adv-related-head' });
    const hl = el('div');
    if (b) {
      hl.appendChild(el('h3', { text: 'Partes em comum' }));
      hl.appendChild(el('div', { class: 'sub', text: `Pessoas presentes nos processos de ${a} e de ${b}` }));
    } else {
      hl.appendChild(el('h3', { text: 'Pessoas nos processos' }));
      hl.appendChild(el('div', { class: 'sub', text: `Partes que aparecem nos processos de ${a} — clique para explorar` }));
    }
    head.appendChild(hl); card.appendChild(head);

    const lista = el('div', { class: 'rel-list' });
    const firstName = (s) => String(s || '').trim().split(/\s+/)[0];
    if (b) {
      const comuns = Services.partesComunsAdvogados(a, b);
      if (!comuns.length) lista.appendChild(el('p', { class: 'result-meta', text: 'Nenhuma parte em comum entre os dois.' }));
      const maxP = comuns.length ? Math.max(...comuns.map((p) => Math.max(p.n_emA, p.n_emB))) : 1;
      comuns.slice(0, 80).forEach((p, i) => {
        const it = el('div', { class: 'rel-item rel-ponte' });
        it.appendChild(el('span', { class: 'rel-rank', text: '#' + (i + 1) }));
        it.appendChild(el('span', { class: 'rel-name' }, el('span', { text: p.nome })));
        const dual = el('span', { class: 'rel-dual' });
        const mk = (cls, n) => { const seg = el('span', { class: 'rel-dual-seg ' + cls }); const bar = el('i'); bar.style.width = Math.round((n / maxP) * 100) + '%'; seg.append(bar, el('b', { text: String(n) })); return seg; };
        dual.append(mk('seg-a', p.n_emA), mk('seg-b', p.n_emB));
        it.appendChild(dual);
        it.title = `${p.n_emA} proc. com ${firstName(a)} · ${p.n_emB} com ${firstName(b)}`;
        it.addEventListener('click', () => go('#/partes?q=' + encodeURIComponent(p.nome)));
        lista.appendChild(it);
      });
    } else {
      const pessoas = Services.partesDoAdvogado(a);
      if (!pessoas.length) lista.appendChild(el('p', { class: 'result-meta', text: 'Sem partes registradas nesses processos.' }));
      const max = pessoas.length ? pessoas[0].n : 1;
      pessoas.slice(0, 80).forEach((p, i) => {
        const it = el('div', { class: 'rel-item' });
        it.appendChild(el('span', { class: 'rel-rank', text: '#' + (i + 1) }));
        it.appendChild(el('span', { class: 'rel-name' }, el('span', { text: p.nome })));
        const bar = el('div', { class: 'rel-bar' }); const fill = el('i'); fill.style.width = Math.round((p.n / max) * 100) + '%'; bar.appendChild(fill); it.appendChild(bar);
        it.appendChild(el('span', { class: 'rel-num', html: `<b>${p.n}</b> proc.` }));
        it.addEventListener('click', () => go('#/partes?q=' + encodeURIComponent(p.nome)));
        lista.appendChild(it);
      });
    }
    card.appendChild(lista);
    return card;
  }

  function parteCard(x) {
    const c = el('button', { class: 'adv-card' });
    c.style.setProperty('--c', colorFor(x.key || x.nome));
    c.appendChild(el('span', { class: 'adv-avatar', text: iniciais(x.nome) }));
    const info = el('div', { class: 'adv-info' });
    info.appendChild(el('div', { class: 'adv-name', text: x.nome }));
    const meta = [];
    if (x.polo && POLO_TAG[x.polo]) meta.push(POLO_TAG[x.polo]);
    if (x.temDoc) meta.push('documento');
    if (meta.length) info.appendChild(el('div', { class: 'adv-oab', text: meta.join(' · ') }));
    c.appendChild(info);
    const cnt = el('div', { class: 'adv-count' });
    cnt.appendChild(el('div', { class: 'num', text: x.n }));
    cnt.appendChild(el('div', { class: 'lab', text: x.n === 1 ? 'processo' : 'processos' }));
    c.appendChild(cnt);
    c.addEventListener('click', () => go('#/partes?q=' + encodeURIComponent(x.nome)));
    return c;
  }

  // painel de uma pessoa: relações (Lista/Rede) + detalhes + lista de processos
  function painelParte(nome) {
    const det = Services.obterParte(nome);
    const nomeDisp = det ? det.nome : nome;
    const wrapAll = el('div');

    const card = el('div', { class: 'adv-related' });
    const head = el('div', { class: 'adv-related-head' });
    const hl = el('div');
    hl.appendChild(el('h3', { text: nomeDisp }));
    hl.appendChild(el('div', { class: 'sub', text: 'Conexões com outras partes (por polo) e com os advogados dos processos' }));
    const toggle = el('div', { class: 'rel-toggle' });
    const btnLista = el('button', { class: 'rel-toggle-btn', text: 'Lista' });
    const btnRede = el('button', { class: 'rel-toggle-btn', text: 'Rede' });
    toggle.append(btnLista, btnRede);
    head.append(hl, toggle); card.appendChild(head);

    const leg = el('div', { class: 'grafo-legenda' });
    [['advogado', 'Advogado'], ['oposto', 'Polo oposto'], ['mesmo', 'Mesmo polo'], ['desconhecido', 'Polo indefinido']].forEach(([rel, lab]) => {
      const chip = el('span', { class: 'gl-item' });
      const dot = el('span', { class: 'gl-dot' }); dot.style.background = relCor(rel);
      chip.append(dot, el('span', { text: lab })); leg.appendChild(chip);
    });
    card.appendChild(leg);

    const relList = el('div', { class: 'rel-list' });
    const rel = Services.partesRelacionadas(nome);
    if (!rel.length) relList.appendChild(el('p', { class: 'result-meta', text: 'Sem conexões com outras partes.' }));
    const max = rel.length ? rel[0].n_comum : 1;
    rel.slice(0, 120).forEach((r, i) => {
      const it = el('div', { class: 'rel-item' });
      it.appendChild(el('span', { class: 'rel-rank', text: '#' + (i + 1) }));
      const nm = el('span', { class: 'rel-name' });
      const dot = el('span', { class: 'rel-dot' }); dot.style.background = relCor(r.rel); dot.title = REL_LABEL[r.rel] || '';
      nm.append(dot, el('span', { text: r.nome }));
      it.appendChild(nm);
      const bar = el('div', { class: 'rel-bar' }); const fill = el('i'); fill.style.width = Math.round((r.n_comum / max) * 100) + '%'; bar.appendChild(fill); it.appendChild(bar);
      it.appendChild(el('span', { class: 'rel-num', html: `<b>${r.n_comum}</b> em comum` }));
      it.addEventListener('click', () => go('#/partes?q=' + encodeURIComponent(r.nome)));
      relList.appendChild(it);
    });
    card.appendChild(relList);

    const grafoWrap = el('div', { class: 'grafo-wrap' }); grafoWrap.style.display = 'none'; card.appendChild(grafoWrap);
    let grafoRendered = false;
    function showLista() { btnLista.classList.add('active'); btnRede.classList.remove('active'); relList.style.display = ''; grafoWrap.style.display = 'none'; }
    function showRede() {
      btnLista.classList.remove('active'); btnRede.classList.add('active'); relList.style.display = 'none'; grafoWrap.style.display = '';
      if (!grafoRendered) {
        grafoRendered = true;
        if (window.GrafoAdv) {
          GrafoAdv.loadD3().then(() => {
            const g = Services.grafoParte(nome);
            g.nodes.forEach((n) => { n.cor = relCor(n.rel); });
            GrafoAdv.render(grafoWrap, nomeDisp, g);
          }).catch(() => { grafoWrap.textContent = 'Não foi possível carregar o diagrama.'; });
        } else { grafoWrap.textContent = 'grafo.js não carregado.'; }
      }
    }
    btnLista.addEventListener('click', showLista); btnRede.addEventListener('click', showRede);
    showLista();
    wrapAll.appendChild(card);

    if (det) {
      const dcard = el('div', { class: 'rail-card', style: 'margin-top:16px;' });
      dcard.appendChild(el('h4', { text: 'Detalhes' }));
      const facts = el('div', { class: 'rail-facts' });
      const addF = (k, val, mono) => { if (!val) return; const f = el('div', { class: 'rail-fact' }); f.append(el('span', { class: 'k', text: k }), el('span', { class: 'v' + (mono ? ' mono' : ''), text: val })); facts.appendChild(f); };
      addF('Processos', String(det.n));
      const polosTxt = [det.polos.ativo ? `${det.polos.ativo} ativo` : '', det.polos.passivo ? `${det.polos.passivo} passivo` : '', det.polos.outro ? `${det.polos.outro} outro` : ''].filter(Boolean).join(' · ');
      addF('Polo', polosTxt);
      if (det.documentos.length) addF('Documento', det.documentos.join(', '), true);
      if (det.nascimentos.length) addF('Nascimento', det.nascimentos.join(', '), true);
      if (det.fontes.length) addF('Fonte', det.fontes.join(', '));
      dcard.appendChild(facts);
      wrapAll.appendChild(dcard);
    }

    // advogados presentes em TODOS os processos da pessoa
    const advComuns = Services.advogadosComunsDaParte(nome);
    if (advComuns.length) {
      const acard = el('div', { class: 'rail-card', style: 'margin-top:16px;' });
      acard.appendChild(el('h4', { text: `Advogados em comum (${advComuns.length})` }));
      acard.appendChild(el('div', { class: 'sub', style: 'margin:-2px 0 10px;', text: 'Presentes em todos os processos desta pessoa' }));
      const chips = el('div', { class: 'chips' });
      advComuns.slice(0, 24).forEach((a) => {
        const c = el('span', { class: 'chip click' });
        c.appendChild(el('span', { text: a.nome }));
        if (a.oab) c.appendChild(el('span', { class: 'oab', text: a.oab.replace(/^OAB[\s/]*/i, '') }));
        c.addEventListener('click', () => go('#/advogado?q=' + encodeURIComponent(a.nome)));
        chips.appendChild(c);
      });
      acard.appendChild(chips);
      wrapAll.appendChild(acard);
    }

    const rows = Services.buscarPorParte(nome);
    wrapAll.appendChild(el('p', { class: 'result-meta', style: 'margin-top:16px;', html: `<b>${rows.length}</b> processo${rows.length !== 1 ? 's' : ''} com <b>${esc(nomeDisp)}</b>` }));
    const cont = el('div'); renderListaProcessos(rows, cont); wrapAll.appendChild(cont);
    return wrapAll;
  }

  function renderDiretorioPartes(sub, results, ac) {
    const all = Services.listarPartes();
    sub.textContent = `${all.length.toLocaleString('pt-BR')} pessoas na base`;
    results.appendChild(el('p', { class: 'result-meta', text: 'Mais frequentes primeiro. Clique em uma pessoa para ver conexões e processos.' }));
    const grid = el('div', { class: 'adv-grid' });
    results.appendChild(grid);
    function paint(term) {
      grid.innerHTML = '';
      const t = (term || '').trim().toLowerCase();
      const list = t ? all.filter((x) => x.nome.toLowerCase().includes(t)) : all;
      list.slice(0, 400).forEach((x) => grid.appendChild(parteCard(x)));
      if (!list.length) grid.appendChild(emptyState('Nenhuma pessoa', 'Ajuste o filtro.', '<circle cx="11" cy="9" r="3"/><path d="M5 19c0-3 3-5 6-5s6 2 6 5"/>'));
    }
    let deb;
    ac.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => paint(ac.getValue()), 220); });
    paint('');
  }

  function screenPartes(params) {
    const v = view(); v.innerHTML = ''; setActiveNav('partes');
    const top = el('div', { class: 'topbar' });
    top.appendChild(el('div', { class: 'topbar-row', html: '<h1 class="page-title">Partes</h1><span class="page-sub" id="partes-sub"></span>' }));
    const tools = el('div', { class: 'adv-toolbar', style: 'margin-top:14px;' });
    const fA = el('div', { class: 'field', style: 'flex:1; min-width:230px; max-width:360px;' });
    fA.innerHTML = `<svg class="ico-search" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="6"/><path d="M14 14l4 4" stroke-linecap="round"/></svg>`;
    const ac = makeAdvAC('Nome da pessoa…', params.q || '', Services.listarPartes);
    fA.appendChild(ac.el);
    const btn = el('button', { class: 'btn primary', text: 'Buscar' });
    const btnAll = el('a', { class: 'btn', href: '#/partes', text: 'Ver todas' });
    tools.append(fA, btn, btnAll);
    top.appendChild(tools); v.appendChild(top);

    const content = el('div', { class: 'content' });
    const results = el('div'); content.appendChild(results); v.appendChild(content);

    function navTo() {
      const q = ac.getValue();
      const h = q ? '#/partes?q=' + encodeURIComponent(q) : '#/partes';
      State.suppressRoute = true; location.hash = h; setTimeout(() => State.suppressRoute = false, 0);
      render();
    }
    btn.addEventListener('click', navTo);
    ac.addEventListener('keydown', (e) => { if (e.key === 'Enter') navTo(); });
    ac.addEventListener('change', navTo);

    function render() {
      const q = ac.getValue(); results.innerHTML = '';
      const sub = $('#partes-sub');
      if (!q) { renderDiretorioPartes(sub, results, ac); return; }
      sub.textContent = '';
      results.appendChild(painelParte(q));
    }
    render();
    if (!params.q && !State.restoringContext) setTimeout(() => ac.el.querySelector('input').focus(), 30);
  }

  /* ============================== autocomplete advogado ================ */
  function makeAdvAC(placeholder, initialValue, listFn) {
    const fetchList = listFn || (() => Services.listarAdvogados());
    const wrap = el('div', { class: 'adv-ac' });
    const input = el('input', { class: 'input', type: 'search', placeholder, value: initialValue || '' });
    const list = el('div', { class: 'adv-ac-list' });
    wrap.appendChild(input); wrap.appendChild(list);

    let focusedIdx = -1;
    let allAdvs = null;

    function norm(s) {
      return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }

    function open(items) {
      list.innerHTML = '';
      focusedIdx = -1;
      if (!items.length) { list.classList.remove('open'); return; }
      items.forEach((a) => {
        const item = el('div', { class: 'adv-ac-item' });
        const nameSpan = document.createElement('span');
        nameSpan.textContent = a.nome;
        item.appendChild(nameSpan);
        if (a.oab) {
          const oabSpan = el('span', { class: 'ac-oab', text: a.oab.replace(/^OAB[\s/]*/i, '') });
          item.appendChild(oabSpan);
        }
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = a.nome;
          list.classList.remove('open');
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        list.appendChild(item);
      });
      list.classList.add('open');
    }

    function close() { list.classList.remove('open'); focusedIdx = -1; }

    function setFocus(idx) {
      const items = list.querySelectorAll('.adv-ac-item');
      items.forEach((it, i) => it.classList.toggle('focused', i === idx));
      focusedIdx = idx;
      if (idx >= 0 && items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
    }

    function suggest(q) {
      if (!allAdvs) allAdvs = fetchList();
      if (q && q.length >= 2) {
        const nq = norm(q);
        open(allAdvs.filter((a) => norm(a.nome).includes(nq)).slice(0, 12));
      } else {
        open(allAdvs.slice(0, 5));
      }
    }

    input.addEventListener('focus', () => suggest(input.value));
    input.addEventListener('input', () => {
      const q = input.value;
      if (!q) { suggest(''); } else { suggest(q); }
    });

    input.addEventListener('keydown', (e) => {
      if (!list.classList.contains('open')) return;
      const items = list.querySelectorAll('.adv-ac-item');
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocus(Math.min(focusedIdx + 1, items.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus(Math.max(focusedIdx - 1, 0)); }
      else if (e.key === 'Enter' && focusedIdx >= 0) {
        e.preventDefault();
        input.value = items[focusedIdx].querySelector('span').textContent;
        close();
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (e.key === 'Escape') { close(); }
    });

    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });

    return {
      el: wrap,
      getValue() { return input.value.trim(); },
      setValue(v) { input.value = v || ''; },
      addEventListener: (type, fn) => input.addEventListener(type, fn),
    };
  }

  /* ============================== TELA 4: agenda ======================= */
  function screenAgenda(params) {
    const v = view(); v.innerHTML = ''; setActiveNav('agenda');
    const ref = params.ref || hojeISO();

    const top = el('div', { class: 'topbar' });
    top.appendChild(el('div', { class: 'topbar-row', html: '<h1 class="page-title">Agenda</h1><span class="page-sub">Próximos prazos e eventos</span>' }));
    const ctrls = el('div', { class: 'agenda-ctrls', style: 'margin-top:14px;' });
    const g1 = el('div', { class: 'ctrl-group' });
    g1.appendChild(el('label', { text: 'A partir de' }));
    const inDate = el('input', { class: 'input', type: 'date', value: ref, style: 'width:auto;' });
    g1.appendChild(inDate);
    const acAdv = makeAdvAC('Filtrar por advogado…', params.adv || '');
    const acAdv2 = makeAdvAC('Segundo advogado…', params.adv2 || '');
    const gA = el('div', { class: 'ctrl-group' });
    gA.appendChild(el('label', { text: 'Advogado' }));
    gA.appendChild(acAdv.el);
    const gB = el('div', { class: 'ctrl-group' });
    gB.appendChild(el('label', { text: 'E também (em comum)' }));
    gB.appendChild(acAdv2.el);
    ctrls.append(g1, gA, gB);
    top.appendChild(ctrls);
    v.appendChild(top);

    const content = el('div', { class: 'content' });
    const results = el('div'); content.appendChild(results); v.appendChild(content);

    function run() {
      const r = inDate.value || hojeISO();
      const advA = acAdv.getValue(), advB = acAdv2.getValue();
      const opts = {}; if (advA) opts.advA = advA; if (advB) opts.advB = advB;
      let h = `#/agenda?ref=${r}`;
      if (advA) h += '&adv=' + encodeURIComponent(advA);
      if (advB) h += '&adv2=' + encodeURIComponent(advB);
      State.suppressRoute = true; location.hash = h; setTimeout(() => State.suppressRoute = false, 0);

      const futuros = Services.agenda(r, null, opts);
      results.innerHTML = '';
      const filtroTxt = advA ? (advB ? ` · <b>${esc(advA)}</b> &amp; <b>${esc(advB)}</b>` : ` · <b>${esc(advA)}</b>`) : '';
      if (!futuros.length) {
        results.appendChild(emptyState('Nada na agenda', advA ? `Sem eventos para ${advA}${advB ? ' e ' + advB : ''} a partir dessa data.` : `Sem eventos futuros a partir de ${fmtData(r)}.`, '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>'));
        return;
      }
      results.appendChild(el('p', { class: 'result-meta', html: `<b>${futuros.length}</b> evento${futuros.length !== 1 ? 's' : ''} a partir de <b>${fmtData(r)}</b>${filtroTxt}` }));
      const grupos = new Map();
      futuros.forEach((e) => addGrp(grupos, e));
      [...grupos.keys()].sort().forEach((dia) => results.appendChild(renderDiaAgenda(dia, grupos.get(dia), r)));
    }
    function addGrp(map, e) { if (!map.has(e.data_iso)) map.set(e.data_iso, []); map.get(e.data_iso).push(e); }

    inDate.addEventListener('change', run);
    let debA;
    [acAdv, acAdv2].forEach((ac) => {
      ac.addEventListener('change', run);
      ac.addEventListener('input', () => { clearTimeout(debA); debA = setTimeout(run, 350); });
    });
    run();
  }

  function renderDiaAgenda(dia, itens, ref) {
    const d = parseISO(dia);
    const past = dia < ref;
    const wrap = el('div', { class: 'agenda-day' + (past ? ' past' : '') });
    const head = el('div', { class: 'day-head' + (past ? ' past' : '') });
    head.appendChild(el('span', { class: 'dh-dot' }));
    head.appendChild(el('span', { class: 'dh-d', text: fmtData(dia) }));
    head.appendChild(el('span', { class: 'dh-wd', text: d ? DIAS[d.getDay()] : '' }));
    const rel = relData(dia);
    if (rel === 'hoje') head.appendChild(el('span', { class: 'today-pill', text: 'HOJE' }));
    else if (rel) head.appendChild(el('span', { class: 'dh-rel', text: rel }));
    head.appendChild(el('span', { class: 'ln' }));
    wrap.appendChild(head);
    itens.forEach((e) => {
      const it = el('div', { class: 'ag-item' });
      it.addEventListener('click', () => go(`#/processo/${e.numero}`));
      const proc = el('div', { class: 'ag-proc' });
      proc.appendChild(el('span', { class: 'cnj', text: fmtCNJ(e.numero, e.cnj) }));
      proc.appendChild(el('div', { class: 's', text: [e.classe, e.orgao].filter(Boolean).join(' · ') }));
      it.appendChild(proc);
      it.appendChild(el('div', { class: 'ag-ev', text: e.evento || '—' }));
      wrap.appendChild(it);
    });
    return wrap;
  }

  /* ============================== TELA 5: favoritos ==================== */
  async function screenFavoritos() {
    const v = view(); v.innerHTML = ''; setActiveNav('favoritos');
    await carregarFavoritos();
    const favs = await Store.listarFavoritos();
    const tags = await Store.todasTags();

    const top = el('div', { class: 'topbar' });
    top.appendChild(el('div', { class: 'topbar-row', html: `<h1 class="page-title">Favoritos</h1><span class="page-sub">${favs.length} processo${favs.length===1?'':'s'}</span>` }));
    let filtroTag = null;
    if (tags.length) {
      // chips = raízes "guarda-chuva" (que têm filhos) + tags completas, ordenadas
      const roots = [...new Set(tags.map(tagRoot).filter(Boolean))];
      const rootsComFilho = roots.filter((r) => tags.some((t) => t.startsWith(r + '/')));
      const chipTags = [...new Set([...rootsComFilho, ...tags])].sort((a, b) => a.localeCompare(b, 'pt'));
      const chips = el('div', { class: 'chips', style: 'margin-top:14px;' });
      const all = el('span', { class: 'chip tag active', text: 'Todas' });
      chips.appendChild(all);
      const tagEls = [all];
      chipTags.forEach((t) => { const c = tagChip(t); chips.appendChild(c); tagEls.push(c); c._tag = t; });
      tagEls.forEach((c) => c.addEventListener('click', () => { filtroTag = c._tag || null; tagEls.forEach((x) => x.classList.toggle('active', x === c)); render(); }));
      top.appendChild(chips);
    }
    v.appendChild(top);

    const content = el('div', { class: 'content' });
    const results = el('div'); content.appendChild(results); v.appendChild(content);

    function render() {
      results.innerHTML = '';
      let lista = favs;
      // filtro hierárquico: "Família" casa com "Família", "Família/Guarda", "Família/Pensao"…
      if (filtroTag) lista = favs.filter((f) => (f.tags || []).some((t) => t === filtroTag || t.startsWith(filtroTag + '/')));
      if (!lista.length) { results.appendChild(emptyState('Nenhum favorito', filtroTag ? 'Nenhum favorito com essa tag.' : 'Favorite processos na lista ou no detalhe para acompanhá-los aqui.', '<path d="M12 4l2.5 5 5.5.8-4 3.9.9 5.5L12 16.5 7.1 19l.9-5.5-4-3.9L9.5 9z"/>')); return; }
      lista.forEach((f) => {
        const p = Services.obterProcesso(f.numero);
        if (!p) return;
        const card = el('div', { class: 'pcard', style: 'margin-bottom:12px;' });
        card.addEventListener('click', (e) => { if (e.target.closest('button')) return; go(`#/processo/${p.numero}`); });
        const top2 = el('div', { class: 'pc-top' });
        top2.appendChild(el('span', { class: 'cnj', text: fmtCNJ(p.numero, p.cnj) }));
        const acts = el('div', { style: 'display:flex; gap:6px;' });
        const tagB = el('button', { class: 'btn sm', text: 'Tags' });
        const delB = el('button', { class: 'btn sm', text: 'Remover' });
        acts.append(tagB, delB); top2.appendChild(acts);
        card.appendChild(top2);
        card.appendChild(el('div', { class: 'pc-classe', text: p.classe || '—' }));
        card.appendChild(el('div', { class: 'pc-org', text: p.orgao || '' }));
        const foot = el('div', { class: 'pc-foot' });
        foot.appendChild(badgesProc(p));
        foot.appendChild(el('span', { class: 'pc-date', text: fmtData(p.data_ultima_com || p.data_ultimo_mov) }));
        card.appendChild(foot);
        if ((f.tags || []).length) {
          const tagsRow = el('div', { class: 'chips', style: 'margin-top:10px;' });
          f.tags.forEach((t) => tagsRow.appendChild(tagChip(t)));
          card.appendChild(tagsRow);
        }
        delB.addEventListener('click', async (e) => { e.stopPropagation(); await Store.removerFavorito(f.numero); State.favSet.delete(f.numero); await carregarFavoritos(); screenFavoritos(); toast('Removido'); });
        tagB.addEventListener('click', (e) => {
          e.stopPropagation();
          openTagsModal('Tags · ' + fmtCNJ(p.numero, p.cnj), f.tags || [], (tg) => {
            Store.atualizarTags(f.numero, tg).then(() => screenFavoritos());
          });
        });
        results.appendChild(card);
      });
    }
    render();
  }

  /* ============================ navegação ============================== */
  let _advDatalistDone = false;
  function ensureAdvDatalist() {
    if (_advDatalistDone) return;
    _advDatalistDone = true;
    const dl = $('#adv-datalist'); if (!dl) return;
    try {
      Services.listarAdvogados().slice(0, 1200).forEach((x) => dl.appendChild(el('option', { value: x.nome })));
    } catch (e) { _advDatalistDone = false; }
  }
  function go(hash) { location.hash = hash; }
  function setActiveNav(route) { $$('.nav-item, .tab-item').forEach((a) => a.classList.toggle('active', a.dataset.route === route)); }

  function parseHash() {
    let h = location.hash.replace(/^#/, '');
    if (!h || h === '/') return { screen: 'lista', params: {} };
    const [path, qs] = h.split('?');
    const params = {};
    if (qs) qs.split('&').forEach((kv) => { const [k, val] = kv.split('='); params[k] = decodeURIComponent(val || ''); });
    const parts = path.split('/').filter(Boolean);
    if (parts[0] === 'processo') {
      const numero = parts[1];
      if (parts[2] === 'comunicacao' && parts[3]) return { screen: 'detalhe', numero, sub: { tab: 'comunicacoes', comId: parts[3] } };
      return { screen: 'detalhe', numero, sub: params };
    }
    if (parts[0] === 'advogado') return { screen: 'advogado', params };
    if (parts[0] === 'partes') return { screen: 'partes', params };
    if (parts[0] === 'agenda') return { screen: 'agenda', params };
    if (parts[0] === 'favoritos') return { screen: 'favoritos', params };
    if (parts[0] === 'buscar') return { screen: 'lista', params };
    return { screen: 'lista', params: {} };
  }

  function route() {
    if (State.suppressRoute) return;
    const main = $('#main');

    // limpa qualquer transform/arraste preso (gesto de voltar interrompido)
    const _v = $('#view'); if (_v) _v.style.transform = '';
    const _app = $('#app'); if (_app) _app.classList.remove('view-dragging', 'view-snap', 'drawer-dragging');

    // 1) salva a posição da tela ANTERIOR (o hash ainda não rolou o #main)
    if (main && State.curHash != null) State.scrollByHash.set(State.curHash, main.scrollTop);

    const r = parseHash();
    const newHash = location.hash || '#/';
    const keep = SCROLL_KEEP.has(r.screen);
    const restore = keep && State.scrollByHash.has(newHash);

    // lembra a última lista de origem (para o "voltar" do detalhe)
    if (keep) State.lastListHash = newHash;
    State.restoringContext = restore;
    State.curHash = newHash;

    try {
      if (r.screen === 'detalhe') screenDetalhe(r.numero, r.sub);
      else if (r.screen === 'advogado') screenAdvogado(r.params);
      else if (r.screen === 'partes') screenPartes(r.params);
      else if (r.screen === 'agenda') screenAgenda(r.params);
      else if (r.screen === 'favoritos') screenFavoritos();
      else screenLista(r.params);
    } catch (e) {
      console.error(e);
      view().innerHTML = '';
      const wrap = el('div', { class: 'content' });
      wrap.appendChild(emptyState('Erro ao carregar a tela', String(e.message || e), '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v.5"/>'));
      view().appendChild(wrap);
    }

    // 2) restaura (volta) ou zera (navegação nova) o scroll após o layout
    if (main) {
      const y = restore ? (State.scrollByHash.get(newHash) || 0) : 0;
      requestAnimationFrame(() => {
        main.scrollTop = y;
        requestAnimationFrame(() => { main.scrollTop = y; });
      });
    }

    // 3) animação "voltar" estilo iOS: a foto do detalhe sai à direita e
    //    a lista (já renderizada por baixo) entra com leve parallax.
    if (State.backAnim) {
      const snap = State.backAnim; State.backAnim = null;
      const v = $('#view');
      if (v) { v.style.transition = 'none'; v.style.transform = 'translateX(-16%)'; v.style.willChange = 'transform'; }
      requestAnimationFrame(() => {
        const ease = 'transform .28s cubic-bezier(.22,.61,.36,1)';
        if (v) { v.style.transition = ease; v.style.transform = ''; }
        snap.style.transition = ease;
        snap.style.transform = 'translateX(100%)';
        const done = () => { snap.remove(); if (v) { v.style.transition = ''; v.style.willChange = ''; } };
        snap.addEventListener('transitionend', done, { once: true });
        setTimeout(done, 420);
      });
    }

    State.restoringContext = false;
  }

  /* ============================== tema ================================= */
  function aplicarTema(pref) {
    const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-tema-pref', pref);
    $$('.theme-switch button').forEach((b) => b.classList.toggle('active', b.dataset.tema === pref));
  }
  function initTema() {
    const pref = localStorage.getItem('tema') || 'system';
    aplicarTema(pref);
    $$('.theme-switch button').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.tema; localStorage.setItem('tema', t); Store.setPref('tema', t); aplicarTema(t);
    }));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((localStorage.getItem('tema') || 'system') === 'system') aplicarTema('system');
    });
  }

  /* ============================== tweaks =============================== */
  function aplicarTweaks() {
    const t = State.tweaks;
    document.documentElement.style.setProperty('--accent', t.accent);
    $('#app').setAttribute('data-density', t.density);
  }
  function persistTweaks(edits) {
    Object.assign(State.tweaks, edits);
    try { window.parent.postMessage({ type: '__edit_mode_set_keys', edits }, '*'); } catch (e) {}
  }
  function buildTweaksPanel() {
    const body = $('#tweaks-body');
    body.innerHTML = '';
    body.appendChild(segGroup('Layout da lista', [
      ['tabela', 'Tabela'], ['cards', 'Cards'], ['compacta', 'Compacta'],
    ], State.tweaks.listLayout, (val) => {
      persistTweaks({ listLayout: val }); refreshSeg('listLayout', val);
      if (parseHash().screen === 'lista' || parseHash().screen === 'advogado' || parseHash().screen === 'favoritos') route();
    }, 'listLayout'));
    body.appendChild(segGroup('Densidade', [
      ['denso', 'Denso'], ['confortavel', 'Confortável'],
    ], State.tweaks.density, (val) => { persistTweaks({ density: val }); aplicarTweaks(); refreshSeg('density', val); }, 'density'));
    const g = el('div', { class: 'tw-group' });
    g.appendChild(el('label', { class: 'tw-label', text: 'Cor de destaque' }));
    const sw = el('div', { class: 'swatches' });
    ['#3D4ED6', '#0E7C66', '#9333EA', '#C2410C', '#0F172A'].forEach((c) => {
      const b = el('span', { class: 'swatch' + (c === State.tweaks.accent ? ' active' : ''), style: `background:${c}`, 'data-c': c });
      b.addEventListener('click', () => { persistTweaks({ accent: c }); aplicarTweaks(); $$('.swatch', sw).forEach((x) => x.classList.toggle('active', x.dataset.c === c)); });
      sw.appendChild(b);
    });
    g.appendChild(sw); body.appendChild(g);
  }
  function segGroup(label, opts, cur, onPick, key) {
    const g = el('div', { class: 'tw-group', 'data-key': key });
    g.appendChild(el('label', { class: 'tw-label', text: label }));
    const seg = el('div', { class: 'seg' });
    opts.forEach(([val, lab]) => {
      const b = el('button', { class: val === cur ? 'active' : '', 'data-val': val, text: lab });
      b.addEventListener('click', () => onPick(val));
      seg.appendChild(b);
    });
    g.appendChild(seg);
    return g;
  }
  function refreshSeg(key, val) {
    const g = $(`.tw-group[data-key="${key}"]`); if (!g) return;
    $$('.seg button', g).forEach((b) => b.classList.toggle('active', b.dataset.val === val));
  }
  function initTweaks() {
    window.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === '__activate_edit_mode') { buildTweaksPanel(); $('#tweaks').hidden = false; }
      else if (d.type === '__deactivate_edit_mode') { $('#tweaks').hidden = true; }
    });
    $('#tweaks-close').addEventListener('click', () => { $('#tweaks').hidden = true; try { window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); } catch (e) {} });
    try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (e) {}
  }

  /* ============================== chrome =============================== */
  function initChrome() {
    $('#btn-collapse').addEventListener('click', () => $('#app').classList.toggle('collapsed'));
    const app = $('#app');
    const openDrawer = () => app.classList.add('drawer-open');
    const closeDrawer = () => app.classList.remove('drawer-open');
    const btnD = $('#btn-drawer'); if (btnD) btnD.addEventListener('click', openDrawer);
    const scrim = $('#drawer-scrim'); if (scrim) scrim.addEventListener('click', closeDrawer);
    $$('.nav-item').forEach((a) => a.addEventListener('click', closeDrawer));
    const railAll = $('.fav-rail-all'); if (railAll) railAll.addEventListener('click', closeDrawer);
    const favList = $('#fav-rail-list'); if (favList) favList.addEventListener('click', closeDrawer);
    const brand = $('.brand'); if (brand) brand.addEventListener('click', closeDrawer);
    window.addEventListener('hashchange', closeDrawer);
    const btnTM = $('#btn-theme-mobile');
    if (btnTM) btnTM.addEventListener('click', () => {
      const seq = ['light', 'dark', 'system'];
      const cur = localStorage.getItem('tema') || 'system';
      const next = seq[(seq.indexOf(cur) + 1) % seq.length];
      localStorage.setItem('tema', next); Store.setPref('tema', next); aplicarTema(next);
      toast('Tema: ' + ({ light: 'claro', dark: 'escuro', system: 'sistema' }[next]));
    });

    // Gesto de borda removido: a navegação agora é pela barra inferior (estilo app)
    // e o "voltar" pela seta do cabeçalho. (initEdgeSwipe mantido no código, sem uso.)
    // initEdgeSwipe(app, openDrawer, closeDrawer);
  }

  /* -------- gesto de borda (estilo X): abrir menu / voltar arrastando ------ */
  function initEdgeSwipe(app, openDrawer, closeDrawer) {
    const mq = window.matchMedia('(max-width: 760px)');
    const sidebar = $('#sidebar');
    const scrim = $('#drawer-scrim');
    const viewEl = () => $('#view');

    const EDGE = 28;   // zona da borda esquerda que ativa "abrir/voltar"
    const SLOP = 8;    // limiar para decidir horizontal x vertical
    let active = false, decided = false, mode = null; // 'open' | 'close' | 'back'
    let x0 = 0, y0 = 0, width = 280, lastX = 0, lastT = 0, vx = 0;

    const isDetail = () => /^#\/processo\//.test(location.hash);
    const isOpen = () => app.classList.contains('drawer-open');
    const blocked = (t) => !!(t && t.closest && t.closest('.grafo-wrap, .tabs, .com-full, .treemap-wrap, input, textarea, select, [data-no-swipe]'));
    const txOf = (elm) => parseFloat((elm.style.transform.match(/-?[\d.]+/) || [0])[0]) || 0;

    // navegação primária é a barra inferior: o drawer não é usado no mobile.
    // Mantemos só o gesto de "voltar" (da borda) nas telas de detalhe.
    const NAV_BOTTOM = true;

    function onStart(e) {
      if (!mq.matches || (e.touches && e.touches.length > 1)) return;
      const t = e.touches ? e.touches[0] : e;
      active = false; decided = false; mode = null;
      if (!NAV_BOTTOM && isOpen()) {
        mode = 'close';
      } else {
        if (t.clientX > EDGE || blocked(e.target)) return;
        if (isDetail()) mode = 'back';
        else if (!NAV_BOTTOM) mode = 'open';
        else return;                       // lista: sem drawer, nada a fazer
      }
      active = true;
      x0 = lastX = t.clientX; y0 = t.clientY; lastT = performance.now(); vx = 0;
      const sbW = sidebar ? sidebar.getBoundingClientRect().width : 0;
      // no modo "voltar" o referencial é a viewport; no drawer, a largura do menu
      width = (mode === 'back') ? window.innerWidth
            : (sbW > 0 ? sbW : Math.min(280, window.innerWidth * 0.84));
    }

    function setDrawerX(px) {
      sidebar.style.transform = `translateX(${px}px)`;
      scrim.style.opacity = String(Math.max(0, Math.min(1, (px + width) / width)));
    }

    function onMove(e) {
      if (!active) return;
      const t = e.touches ? e.touches[0] : e;
      const dx = t.clientX - x0, dy = t.clientY - y0;
      const now = performance.now();
      if (now > lastT) { vx = (t.clientX - lastX) / (now - lastT); lastX = t.clientX; lastT = now; }
      if (!decided) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        if (Math.abs(dy) > Math.abs(dx)) { active = false; return; }      // vertical → rola normal
        if ((mode === 'open' || mode === 'back') && dx <= 0) { active = false; return; }
        if (mode === 'close' && dx >= 0) { active = false; return; }
        decided = true;
        app.classList.add(mode === 'back' ? 'view-dragging' : 'drawer-dragging');
      }
      if (e.cancelable) e.preventDefault();  // trava rolagem durante o arraste horizontal
      if (mode === 'open') setDrawerX(Math.min(0, -width + dx));
      else if (mode === 'close') setDrawerX(Math.max(-width, dx));
      else { const v = viewEl(); if (v) v.style.transform = `translateX(${Math.max(0, Math.min(width, dx))}px)`; }
    }

    function commitDrawer(openIt) {
      app.classList.remove('drawer-dragging');
      sidebar.style.transform = ''; scrim.style.opacity = '';
      openIt ? openDrawer() : closeDrawer();
    }

    function onEnd() {
      if (!active) {
        // segurança: nunca deixa um transform órfão no #view (some o "espaço cinza")
        const v0 = viewEl();
        if (v0 && v0.style.transform) { app.classList.remove('view-dragging'); app.classList.add('view-snap'); v0.style.transform = ''; setTimeout(() => app.classList.remove('view-snap'), 240); }
        decided = false; mode = null; return;
      }
      active = false;
      if (!decided) { mode = null; return; }
      const fast = Math.abs(vx) > 0.5;
      if (mode === 'open') {
        commitDrawer(txOf(sidebar) > -width * 0.55 || (fast && vx > 0));
      } else if (mode === 'close') {
        const closed = txOf(sidebar) < -width * 0.45 || (fast && vx < 0);
        commitDrawer(!closed);
      } else if (mode === 'back') {
        const v = viewEl();
        const dx = v ? txOf(v) : 0;
        const commitBack = dx > width * 0.4 || (fast && vx > 0.5 && dx > 40);
        app.classList.remove('view-dragging');
        if (commitBack) { beginBackAnim(v, dx); }
        else if (v) { app.classList.add('view-snap'); v.style.transform = ''; setTimeout(() => app.classList.remove('view-snap'), 240); }
      }
      decided = false; mode = null;
    }

    // tira uma "foto" do detalhe atual, deixa a lista renderizar por baixo
    // (escondendo o rebuild) e navega. A animação de saída roda no route().
    function beginBackAnim(v, startX) {
      if (!v || !mq.matches) { if (v) v.style.transform = ''; voltarNav(); return; }
      const main = $('#main');
      const bar = $('#mobile-bar');
      const top = bar ? Math.max(0, Math.round(bar.getBoundingClientRect().bottom)) : 0;
      const snap = document.createElement('div');
      snap.className = 'nav-snap';
      snap.style.top = top + 'px';
      snap.style.transform = `translateX(${startX || 0}px)`;
      const inner = v.cloneNode(true);
      inner.style.transform = `translateY(${-(main ? main.scrollTop : 0)}px)`;
      snap.appendChild(inner);
      document.body.appendChild(snap);
      State.backAnim = snap;
      v.style.transform = '';
      voltarNav();
      // segurança: se o route não consumir (hash não mudou), remove a foto
      setTimeout(() => {
        if (State.backAnim === snap) { State.backAnim = null; snap.remove(); }
      }, 500);
    }

    function voltarNav() {
      if (State.lastListHash && State.lastListHash !== location.hash) { go(State.lastListHash); }
      else if (window.history.length > 1) history.back();
      else go('#/');
    }

    const opt = { passive: false };
    document.addEventListener('touchstart', onStart, opt);
    document.addEventListener('touchmove', onMove, opt);
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }

  /* =============================== boot ================================ */
  async function carregarBase(password) {
    const bar = $('#progress-bar'), pct = $('#splash-pct'), sub = $('#splash-sub');
    sub.textContent = 'Decifrando base de dados…';
    bar.style.width = '0%'; pct.textContent = '0%';
    await Services.initDB({
      password,
      onProgress: (p) => {
        const v = Math.round(p * 100);
        bar.style.width = v + '%'; pct.textContent = v + '%';
        if (p >= 0.95) sub.textContent = 'Indexando…';
        else if (p >= 0.8) sub.textContent = 'Descomprimindo…';
        else if (p >= 0.6) sub.textContent = 'Decifrando…';
        else sub.textContent = 'Carregando base de dados…';
      },
    });
    State.total = Services.contarProcessos();
    State.classes = Services.listarClasses();
    await carregarFavoritos();

    $('#db-status').classList.add('ok');
    $('#db-status-text').textContent = `${State.total.toLocaleString('pt-BR')} processos`;
    $('#brand-meta').textContent = `${State.total} processos`;

    $('#app').hidden = false;
    $('#splash').classList.add('hide');
    setTimeout(() => { const s = $('#splash'); if (s) s.remove(); }, 600);

    window.addEventListener('hashchange', route);
    route();
  }

  function splashFatal(msg) {
    const sub = $('#splash-sub'); if (sub) sub.textContent = 'Falha ao carregar';
    const prog = $('.progress'); if (prog) prog.style.display = 'none';
    const pct = $('#splash-pct'); if (pct) pct.style.display = 'none';
    $('.splash-card').appendChild(el('div', { class: 'splash-error', text: msg }));
    $('#db-status').classList.add('err'); $('#db-status-text').textContent = 'erro';
  }

  function mostrarLogin() {
    const login = $('#login'), splash = $('#splash');
    if (splash) splash.style.display = 'none';
    login.hidden = false;
    const form = $('#login-form'), pass = $('#login-pass'), erro = $('#login-error'), submit = $('#login-submit'), eye = $('#login-eye');
    eye.onclick = () => {
      pass.type = pass.type === 'password' ? 'text' : 'password';
      pass.focus();
    };
    let busy = false;
    async function doLogin() {
      if (busy) return;
      const pw = pass.value;
      if (!pw) { erro.textContent = 'Digite a senha.'; erro.hidden = false; pass.focus(); return; }
      busy = true;
      erro.hidden = true; submit.disabled = true; submit.textContent = 'Entrando…';
      try { sessionStorage.setItem('pd_pw', pw); } catch (e2) {}
      try {
        login.classList.add('hide');
        if (splash) splash.style.display = '';
        await new Promise((r) => setTimeout(r, 280));
        login.hidden = true; login.classList.remove('hide');
        await carregarBase(pw);
      } catch (err) {
        if (splash) splash.style.display = 'none';
        login.hidden = false; login.classList.remove('hide');
        submit.disabled = false; submit.textContent = 'Entrar'; busy = false;
        try { sessionStorage.removeItem('pd_pw'); } catch (e2) {}
        if (err && (err.message === 'SENHA_INCORRETA' || err.message === 'ARQUIVO_INVALIDO')) {
          erro.textContent = err.message === 'SENHA_INCORRETA'
            ? 'Senha incorreta. Tente novamente.'
            : 'Arquivo da base inválido ou corrompido.';
        } else {
          erro.textContent = 'Erro ao carregar o banco: ' + (err && err.message || err);
        }
        erro.hidden = false;
        pass.value = ''; pass.focus();
      }
    }
    form.onsubmit = (e) => { e.preventDefault(); doLogin(); return false; };
    submit.onclick = (e) => { e.preventDefault(); doLogin(); };
    pass.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doLogin(); } };
    setTimeout(() => pass.focus(), 60);
  }

  async function boot() {
    initTema();
    initChrome();
    initTweaks();
    aplicarTweaks();

    if (typeof initSqlJs === 'undefined') { splashFatal('sql.js não carregou — verifique a conexão.'); return; }

    // Reaproveita senha da sessão (evita re-digitar ao recarregar a aba)
    let saved = null;
    try { saved = sessionStorage.getItem('pd_pw'); } catch (e) {}
    if (saved) {
      try {
        await carregarBase(saved);
        return;
      } catch (e) {
        try { sessionStorage.removeItem('pd_pw'); } catch (e2) {}
        if (e && (e.message === 'SENHA_INCORRETA' || e.message === 'ARQUIVO_INVALIDO')) {
          mostrarLogin();
          return;
        }
        splashFatal(String(e.message || e));
        return;
      }
    }

    mostrarLogin();
  }

  boot();
})();
