/* ==========================================================================
   charts.js — gráficos de dados (treemap de atuação).
   Independente de grafo.js. Lazy-carrega D3 v7. Usa variáveis CSS do tema.
   Expõe: window.Charts = { loadD3, renderTreemap, renderTreemapDrill }

   renderTreemapDrill(container, root)
     root = árvore aninhada { name, level, children:[…] | value }
     Navegação do maior nível ao menor (Tribunal → Comarca → Vara): toque/clique
     em um bloco com filhos faz "zoom"; a trilha (breadcrumb) volta níveis.

   renderTreemap(container, data)  — compatível com a forma antiga
     { tribunais: [{ sigla, total, varas:[{orgao, n}] }] } → converte e delega.
   ========================================================================== */
(function () {
  'use strict';

  const D3_URL = 'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js';
  let _d3Promise = null;

  function loadD3() {
    if (window.d3) return Promise.resolve();
    if (_d3Promise) return _d3Promise;
    _d3Promise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = D3_URL;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Falha ao carregar D3.js'));
      document.head.appendChild(s);
    });
    return _d3Promise;
  }

  const cssVar = (p) => getComputedStyle(document.documentElement).getPropertyValue(p).trim();
  const esc    = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // paleta determinística por tribunal
  const PAL = ['#0E7C66', '#2E8BD6', '#C77D1A', '#8B5CF6', '#D9456E', '#3C9A5F', '#0E8CA8', '#B5559E', '#6366F1', '#CC5A3A'];
  const hash = (s) => { let h = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  const colorTrib = (sig) => PAL[hash(sig) % PAL.length];

  const sumNode = (n) => (n.children && n.children.length)
    ? n.children.reduce((a, c) => a + sumNode(c), 0)
    : (n.value || 0);

  const LEVEL_PT = { root: '', tribunal: 'tribunal', comarca: 'comarca/regional', vara: 'vara/órgão' };
  const CHILD_PT = { root: 'tribunais', tribunal: 'comarcas', comarca: 'varas' };

  /* ------------------------------------------------------------------ drill */
  function renderTreemapDrill(container, root, opts) {
    const onFocus = (opts && opts.onFocus) || null;
    container.innerHTML = '';
    container.classList.add('treemap-drill');
    if (!root || !root.children || !root.children.length) {
      container.classList.remove('treemap-drill');
      container.textContent = 'Sem dados de atuação.';
      return;
    }

    const muted = cssVar('--muted') || '#6B7585';

    // trilha inicial: desce enquanto houver um único filho (evita níveis "chapados")
    const path = [root];
    while (true) {
      const last = path[path.length - 1];
      if (last.children && last.children.length === 1 && last.children[0].children) {
        path.push(last.children[0]);
      } else break;
    }

    const crumbs = document.createElement('div');
    crumbs.className = 'tm-crumbs';
    const canvas = document.createElement('div');
    canvas.className = 'tm-canvas';
    const tip = document.createElement('div');
    tip.className = 'grafo-tooltip';
    container.append(crumbs, canvas, tip);

    function tribContext() {
      const t = path.find((n) => n.level === 'tribunal');
      return t ? t.name : path[path.length - 1].name;
    }

    // nomes da trilha (sem o "Todos"/root) — usados no rótulo do filtro da lista
    const pathNames = () => path.filter((n) => n.level !== 'root').map((n) => n.name);
    const emitFocus = (node, names, viaLeaf) => { if (onFocus) onFocus(node, names, !!viaLeaf); };

    function renderCrumbs() {
      crumbs.innerHTML = '';
      path.forEach((n, i) => {
        const isLast = i === path.length - 1;
        const label = n.level === 'root' ? 'Todos' : n.name;
        const c = document.createElement(isLast ? 'span' : 'button');
        c.className = 'tm-crumb' + (isLast ? ' current' : '');
        c.textContent = label;
        c.style.setProperty('--c', colorTrib(tribContext()));
        if (!isLast) c.addEventListener('click', () => { path.splice(i + 1); update(true); });
        crumbs.appendChild(c);
        if (!isLast) {
          const sep = document.createElement('span');
          sep.className = 'tm-sep';
          sep.textContent = '›';
          crumbs.appendChild(sep);
        }
      });
      // dica de nível atual (o que um toque revela em seguida)
      const cur = path[path.length - 1];
      const hint = document.createElement('span');
      hint.className = 'tm-level-hint';
      const childLvl = CHILD_PT[cur.level];
      const drillable = (cur.children || []).some((c) => c.children && c.children.length);
      hint.textContent = childLvl
        ? `${(cur.children || []).length} ${childLvl}${drillable ? ' · toque para detalhar' : ''}`
        : '';
      crumbs.appendChild(hint);
    }

    function update(emit) {
      renderCrumbs();
      const cur = path[path.length - 1];
      canvas.querySelectorAll('svg').forEach((s) => s.remove());
      tip.classList.remove('show');

      const W = container.clientWidth || canvas.clientWidth || 540;
      const total = sumNode(cur) || 1;
      const H = Math.max(260, Math.min(540, 220 + Math.sqrt(total) * 7));
      canvas.style.height = H + 'px';

      // hierarquia de UM nível: filhos diretos do nó atual
      const h = d3.hierarchy(cur).sum((d) => (d.children && d.children.length) ? 0 : (d.value || 0));
      d3.treemap().size([W, H]).paddingInner(3).round(true)(h);
      const cells = (h.children || []).filter((c) => (c.x1 - c.x0) > 0 && (c.y1 - c.y0) > 0);

      const atTribunais = cur.level === 'root';
      const baseColor = colorTrib(tribContext());

      const svg = d3.select(canvas).append('svg').attr('width', W).attr('height', H);
      const g = svg.append('g').selectAll('g').data(cells).join('g');

      g.append('rect')
        .attr('x', (d) => d.x0).attr('y', (d) => d.y0)
        .attr('width', (d) => d.x1 - d.x0).attr('height', (d) => d.y1 - d.y0)
        .attr('rx', 4)
        .attr('fill', (d, i) => atTribunais ? colorTrib(d.data.name) : baseColor)
        .attr('fill-opacity', (d, i) => atTribunais ? 0.82 : (0.85 - (i % 6) * 0.085))
        .attr('stroke', cssVar('--surface') || '#fff').attr('stroke-width', 1)
        .style('cursor', (d) => (d.data.children && d.data.children.length) ? 'pointer' : 'default')
        .on('mouseenter', (ev, d) => showTip(ev, d))
        .on('mousemove', moveTip)
        .on('mouseleave', () => tip.classList.remove('show'))
        .on('click', (ev, d) => drill(ev, d));

      // rótulo: nome + contagem quando couber
      g.append('text')
        .attr('x', (d) => d.x0 + 7).attr('y', (d) => d.y0 + 16)
        .attr('font-size', 11.5).attr('font-weight', 600)
        .attr('font-family', 'IBM Plex Sans, system-ui, sans-serif')
        .attr('fill', '#fff').attr('pointer-events', 'none')
        .each(function (d) {
          const w = d.x1 - d.x0, hh = d.y1 - d.y0;
          if (w < 46 || hh < 22) return;
          const sel = d3.select(this);
          const max = Math.floor(w / 6.3);
          let nm = d.data.name;
          if (nm.length > max) nm = nm.slice(0, Math.max(3, max - 1)) + '…';
          sel.text(nm);
          if (hh >= 36 && w >= 60) {
            sel.append('tspan')
              .attr('x', d.x0 + 7).attr('dy', 15)
              .attr('font-size', 10.5).attr('font-weight', 500).attr('fill-opacity', 0.85)
              .text(d.value + (d.data.children ? ' • ' + d.data.children.length + ' ' + (CHILD_PT[d.data.level] || '') : ''));
          }
        });

      function showTip(ev, d) {
        const pct = Math.round((d.value / total) * 100);
        const sub = d.data.children && d.data.children.length
          ? `${d.data.children.length} ${CHILD_PT[d.data.level] || 'itens'} · ${d.value} comunicaç${d.value === 1 ? 'ão' : 'ões'} · ${pct}%`
          : `${d.value} comunicaç${d.value === 1 ? 'ão' : 'ões'} · ${pct}%`;
        const tail = (d.data.children && d.data.children.length) ? '<br><span class="tm-tip-go">toque para abrir →</span>' : '';
        tip.innerHTML = `<b>${esc(d.data.name)}</b><br><span style="font-size:11px;color:${muted}">${sub}</span>${tail}`;
        tip.classList.add('show');
        moveTip(ev);
      }
      function moveTip(ev) {
        const rect = canvas.getBoundingClientRect();
        const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
        const tw = tip.offsetWidth || 200, th = tip.offsetHeight || 44;
        tip.style.left = (x + 14 + tw > rect.width ? x - tw - 8 : x + 14) + 'px';
        tip.style.top = Math.max(4, Math.min(rect.height - th - 4, y - th / 2)) + 'px';
      }
      function drill(ev, d) {
        if (d.data.children && d.data.children.length) {
          path.push(d.data);
          update(true);   // navegou → a lista passa a refletir este nível
        } else {
          // folha (vara): seleciona, destaca e filtra a lista por este órgão
          g.selectAll('rect').attr('stroke', cssVar('--surface') || '#fff').attr('stroke-width', 1);
          d3.select(ev.currentTarget).attr('stroke', '#fff').attr('stroke-width', 3);
          showTip(ev, d);
          emitFocus(d.data, [...pathNames(), d.data.name], true);
        }
      }

      // ao navegar (drill/trilha) a lista acompanha o nível atual; não emite no 1º render
      if (emit) emitFocus(cur, pathNames());
    }

    update(false);
    // re-layout em mudança de tamanho (rotação/redimensionamento) — sem reemitir foco
    if (window.ResizeObserver && !container._tmRO) {
      let raf = 0, lastW = container.clientWidth;
      container._tmRO = new ResizeObserver(() => {
        if (Math.abs(container.clientWidth - lastW) < 4) return;
        lastW = container.clientWidth;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => update(false));
      });
      container._tmRO.observe(container);
    }
  }

  /* ----------------------------------------- compat: forma antiga (flat) */
  function renderTreemap(container, data) {
    // nova forma hierárquica
    if (data && data.children) return renderTreemapDrill(container, data);
    // forma antiga { tribunais:[{sigla,total,varas:[{orgao,n}]}] } → árvore
    const tribunais = (data && data.tribunais) || [];
    if (!tribunais.length) {
      [...container.childNodes].forEach((n) => { if (n.nodeType === 3) n.remove(); });
      container.querySelectorAll('svg, .grafo-tooltip').forEach((e) => e.remove());
      container.textContent = 'Sem dados de atuação.';
      return;
    }
    const root = {
      name: 'Atuação', level: 'root',
      children: tribunais.map((t) => ({
        name: t.sigla, level: 'tribunal',
        children: t.varas.map((v) => ({ name: v.orgao, level: 'vara', value: v.n })),
      })),
    };
    return renderTreemapDrill(container, root);
  }

  window.Charts = { loadD3, renderTreemap, renderTreemapDrill };
})();
