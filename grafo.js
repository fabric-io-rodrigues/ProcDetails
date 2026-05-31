/* ==========================================================================
   grafo.js — Grafo de relacionamento entre advogados (estilo Les Misérables)
   Lazy-carrega D3 v7. Usa variáveis CSS do tema.
   Expõe: window.GrafoAdv = { loadD3, render }

   render(container, centralNome, { nodes, edges })
     nodes : [{ id, nome, oab, n_com_central, central }]
     edges : [{ source, target, n_comum }]  — todos os pares
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
  const esc    = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function abbrev(name, central) {
    const parts = String(name || '').trim().split(/\s+/);
    if (central) return parts[0] || name;
    if (parts.length === 1) return parts[0].slice(0, 9);
    return parts[0] + ' ' + parts[parts.length - 1][0] + '.';
  }

  function render(container, centralNome, graphData) {
    const nodes = (graphData && graphData.nodes) || [];
    const edges = (graphData && graphData.edges) || [];

    if (!nodes.length) { container.textContent = 'Sem dados de relacionamento.'; return; }

    /* --- cores do tema --------------------------------------------------- */
    const accent    = cssVar('--accent')     || '#0E7C66';
    const accentInk = cssVar('--accent-ink') || '#ffffff';
    const ink       = cssVar('--ink')        || '#161B22';
    const muted     = cssVar('--muted')      || '#6B7585';
    const faint     = cssVar('--faint')      || '#97A0AE';
    const line      = cssVar('--line')       || '#E0E4EA';
    const surface   = cssVar('--surface')    || '#FFFFFF';

    /* --- dimensões ------------------------------------------------------- */
    const W = container.clientWidth || 520;
    const n = nodes.length;
    const H = Math.max(400, Math.min(660, 240 + n * 16));
    container.style.height = H + 'px';

    /* --- limpar ---------------------------------------------------------- */
    container.querySelectorAll('svg, .grafo-tooltip, .grafo-reset, .grafo-hint').forEach(e => e.remove());

    /* --- tooltip --------------------------------------------------------- */
    const tip = document.createElement('div');
    tip.className = 'grafo-tooltip';
    container.appendChild(tip);

    /* --- botão reset zoom ------------------------------------------------ */
    const resetBtn = document.createElement('button');
    resetBtn.className = 'grafo-reset';
    resetBtn.title = 'Resetar zoom';
    resetBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 5V1h4M15 5V1h-4M1 11v4h4M15 11v4h-4"/></svg>';
    container.appendChild(resetBtn);

    /* --- hint ------------------------------------------------------------ */
    const hint = document.createElement('div');
    hint.className = 'grafo-hint';
    hint.textContent = 'scroll para zoom · arraste para mover · hover para destacar';
    container.appendChild(hint);

    /* --- escalas --------------------------------------------------------- */
    const maxCentral = nodes.reduce((m, d) => Math.max(m, d.n_com_central || 0), 1);
    const maxEdge    = edges.reduce((m, e) => Math.max(m, e.n_comum || 1), 1);

    /* Marca arestas ANTES que o forceLink mute source/target para objetos */
    edges.forEach(e => {
      e._central = (e.source === centralNome || e.target === centralNome);
    });
    const subEdges     = edges.filter(e => !e._central);
    const centralEdges = edges.filter(e => e._central);

    /* helper pós-mutação */
    const nodeId = (x) => (x && typeof x === 'object') ? x.id : x;
    const connectedTo = (e, id) => nodeId(e.source) === id || nodeId(e.target) === id;

    /* --- funções de escala ----------------------------------------------- */
    const nodeR = (d) => d.central ? 22 : 7 + Math.round((d.n_com_central / maxCentral) * 11);
    const fillOp   = (d) => d.central ? 1   : 0.13 + 0.87 * (d.n_com_central / maxCentral);
    const strokeOp = (d) => d.central ? 0   : 0.25 + 0.75 * (d.n_com_central / maxCentral);
    const labelOp  = (d) => d.central ? 1   : 0.35 + 0.65 * (d.n_com_central / maxCentral);

    const subEdgeOp  = (e) => 0.18 + 0.45 * (e.n_comum / maxEdge);
    const subEdgeW   = (e) => 0.6  + (e.n_comum / maxEdge) * 2.0;
    const centEdgeOp = (e) => 0.30 + 0.55 * (e.n_comum / maxEdge);
    const centEdgeW  = (e) => 1.0  + (e.n_comum / maxEdge) * 2.2;

    function clamp(v, max) { return Math.max(28, Math.min((max || 400) - 28, v || 0)); }

    /* --- SVG + grupo de zoom -------------------------------------------- */
    const svg = d3.select(container).append('svg')
      .attr('width', W).attr('height', H)
      .style('cursor', 'grab');

    const zoomG = svg.append('g');

    /* gradiente suave de fundo */
    const defs = svg.append('defs');
    const grd = defs.append('radialGradient').attr('id', 'gbg2')
      .attr('cx', '50%').attr('cy', '50%').attr('r', '55%');
    grd.append('stop').attr('offset', '0%').attr('stop-color', accent).attr('stop-opacity', 0.07);
    grd.append('stop').attr('offset', '100%').attr('stop-color', surface).attr('stop-opacity', 0);
    zoomG.append('rect').attr('width', W).attr('height', H).attr('fill', 'url(#gbg2)').attr('pointer-events', 'none');

    /* --- zoom + pan ------------------------------------------------------ */
    const zoom = d3.zoom()
      .scaleExtent([0.25, 5])
      .on('zoom', (ev) => zoomG.attr('transform', ev.transform));
    svg.call(zoom);
    resetBtn.addEventListener('click', () =>
      svg.transition().duration(350).call(zoom.transform, d3.zoomIdentity)
    );

    /* --- simulação de forças -------------------------------------------- */
    /* Chave: arestas centrais fracas → satélites se espalham.
       Arestas entre satélites fortes → comunidades se agrupam. */
    const repulsion = n > 40 ? -260 : n > 20 ? -220 : -180;
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges)
        .id(d => d.id)
        .distance(e => e._central ? 115 : 45 + (1 - e.n_comum / maxEdge) * 45)
        .strength(e => e._central ? 0.06 : 0.30 + 0.50 * (e.n_comum / maxEdge)))
      .force('charge', d3.forceManyBody().strength(repulsion).distanceMax(300))
      .force('x', d3.forceX(W / 2).strength(0.04))
      .force('y', d3.forceY(H / 2).strength(0.04))
      .force('collision', d3.forceCollide().radius(d => nodeR(d) + 10));

    /* --- arestas em duas camadas:
         Camada 1 (fundo): sub-conexões — faint/muted, finas
         Camada 2 (frente): conexões ao central — accent, mais espessas      */
    const subLinkSel = zoomG.append('g').attr('class', 'g-sub-links')
      .selectAll('line').data(subEdges).join('line')
      .attr('stroke', faint)
      .attr('stroke-opacity', subEdgeOp)
      .attr('stroke-width', subEdgeW);

    const centLinkSel = zoomG.append('g').attr('class', 'g-cent-links')
      .selectAll('line').data(centralEdges).join('line')
      .attr('stroke', accent)
      .attr('stroke-opacity', centEdgeOp)
      .attr('stroke-width', centEdgeW);

    /* --- grupos de nós --------------------------------------------------- */
    const nodeG = zoomG.append('g').attr('class', 'g-nodes')
      .selectAll('g').data(nodes).join('g')
      .style('cursor', 'grab');

    /* círculo principal */
    nodeG.append('circle')
      .attr('r', nodeR)
      .attr('fill', accent)
      .attr('fill-opacity', fillOp)
      .attr('stroke', accent)
      .attr('stroke-opacity', strokeOp)
      .attr('stroke-width', 1.5);

    /* anel tracejado no nó central */
    nodeG.filter(d => d.central)
      .append('circle')
      .attr('r', d => nodeR(d) + 6)
      .attr('fill', 'none')
      .attr('stroke', accent)
      .attr('stroke-opacity', 0.28)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 3');

    /* inicial no centro do nó central */
    nodeG.filter(d => d.central)
      .append('text')
      .text(d => (d.label || d.nome || '?')[0].toUpperCase())
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('font-size', 13).attr('font-weight', '700')
      .attr('font-family', 'IBM Plex Sans, system-ui, sans-serif')
      .attr('fill', accentInk).attr('pointer-events', 'none');

    /* rótulo abaixo do nó */
    nodeG.append('text')
      .text(d => abbrev(d.label || d.nome, d.central))
      .attr('text-anchor', 'middle')
      .attr('y', d => nodeR(d) + 12)
      .attr('font-size', 10.5)
      .attr('font-family', 'IBM Plex Sans, system-ui, sans-serif')
      .attr('fill', ink).attr('fill-opacity', labelOp)
      .attr('pointer-events', 'none');

    /* --- drag nos nós ---------------------------------------------------- */
    nodeG.call(d3.drag()
      .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag',  (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on('end',   (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    );

    /* --- highlight ao hover ---------------------------------------------- */
    function highlightNode(d) {
      const conns = new Set([d.id]);
      edges.forEach(e => {
        if (connectedTo(e, d.id)) { conns.add(nodeId(e.source)); conns.add(nodeId(e.target)); }
      });

      nodeG.transition().duration(80)
        .attr('opacity', nd => conns.has(nd.id) ? 1 : 0.10);

      subLinkSel.transition().duration(80)
        .attr('stroke-opacity', e => connectedTo(e, d.id) ? 0.85 : 0.03)
        .attr('stroke-width',   e => connectedTo(e, d.id) ? subEdgeW(e) * 1.6 : subEdgeW(e));

      centLinkSel.transition().duration(80)
        .attr('stroke-opacity', e => connectedTo(e, d.id) ? 0.95 : 0.03)
        .attr('stroke-width',   e => connectedTo(e, d.id) ? centEdgeW(e) * 1.4 : centEdgeW(e));
    }

    function resetHighlight() {
      nodeG.transition().duration(120).attr('opacity', 1);
      subLinkSel.transition().duration(120)
        .attr('stroke-opacity', subEdgeOp).attr('stroke-width', subEdgeW);
      centLinkSel.transition().duration(120)
        .attr('stroke-opacity', centEdgeOp).attr('stroke-width', centEdgeW);
      tip.classList.remove('show');
    }

    nodeG
      .on('mouseenter', (ev, d) => {
        highlightNode(d);
        const ratio = d.central ? 1 : d.n_com_central / maxCentral;
        const bar = `<span style="display:inline-block;width:${Math.round(ratio*48)}px;height:4px;border-radius:2px;background:${accent};opacity:${0.3+0.7*ratio};margin-right:4px;vertical-align:middle"></span>`;
        const grau = edges.filter(e => connectedTo(e, d.id)).length;
        let html = `<b>${esc(d.label || d.nome)}</b>`;
        if (d.oab) html += ` <span style="font-family:monospace;font-size:10px;color:${muted}">OAB ${esc(d.oab)}</span>`;
        if (!d.central) {
          html += `<br>${bar}<span style="font-size:11px;color:${accent}">${d.n_com_central} proc. com ${esc(centralNome.split(' ')[0])}</span>`;
          html += `<br><span style="font-size:11px;color:${muted}">${grau} conexão${grau !== 1 ? 'ões' : ''} neste subgrafo</span>`;
        } else {
          html += `<br><span style="font-size:11px;color:${muted}">advogado central · ${nodes.length - 1} colaboradores</span>`;
        }
        tip.innerHTML = html;
        tip.classList.add('show');
        moveTip(ev);
      })
      .on('mousemove', moveTip)
      .on('mouseleave', resetHighlight);

    /* --- tick ------------------------------------------------------------ */
    sim.on('tick', () => {
      const updLine = (sel) => sel
        .attr('x1', e => clamp(e.source.x, W)).attr('y1', e => clamp(e.source.y, H))
        .attr('x2', e => clamp(e.target.x, W)).attr('y2', e => clamp(e.target.y, H));
      updLine(subLinkSel);
      updLine(centLinkSel);
      nodeG.attr('transform', d => `translate(${clamp(d.x, W)},${clamp(d.y, H)})`);
    });

    /* --- posição do tooltip ----------------------------------------------- */
    function moveTip(ev) {
      const rect = container.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const tw = tip.offsetWidth || 190;
      const th = tip.offsetHeight || 48;
      tip.style.left = (x + 14 + tw > W ? x - tw - 8 : x + 14) + 'px';
      tip.style.top  = Math.max(4, Math.min(H - th - 4, y - th / 2)) + 'px';
    }
  }

  /* ==========================================================================
     renderPontes — grafo "A ✕ B": dois polos e os advogados-ponte no meio.
       data = { A:{nome,oab,n}, B:{nome,oab,n}, direto:[...], pontes:[{nome,oab,n_comA,n_comB}] }
     ========================================================================== */
  function renderPontes(container, data) {
    const A = data && data.A, B = data && data.B;
    const pontes = (data && data.pontes) || [];

    container.querySelectorAll('svg, .grafo-tooltip, .grafo-reset, .grafo-hint, .grafo-empty, .grafo-poles').forEach(e => e.remove());

    if (!A || !B) { container.textContent = 'Selecione dois advogados.'; return; }

    const accent  = cssVar('--accent')  || '#0E7C66';
    const accentInk = cssVar('--accent-ink') || '#fff';
    const ink     = cssVar('--ink')     || '#161B22';
    const muted   = cssVar('--muted')   || '#6B7585';
    const faint   = cssVar('--faint')   || '#97A0AE';
    const line    = cssVar('--line')    || '#E0E4EA';
    const surface = cssVar('--surface') || '#FFFFFF';
    const accent2 = '#C77D1A'; // segunda cor (polo B) — quente, contrasta com o accent

    if (!pontes.length) {
      const d = document.createElement('div');
      d.className = 'grafo-empty';
      d.innerHTML = `Nenhum advogado em comum liga <b>${esc(A.nome.split(' ')[0])}</b> e <b>${esc(B.nome.split(' ')[0])}</b>.` +
        (data.direto && data.direto.length ? `<br><span style="color:${muted}">Mas atuam juntos em ${data.direto.length} processo(s) diretamente.</span>` : '');
      container.appendChild(d);
      return;
    }

    const W = container.clientWidth || 540;
    const N = pontes.length;
    const H = Math.max(360, Math.min(720, 160 + N * 26));
    container.style.height = H + 'px';

    const maxEdge = pontes.reduce((m, p) => Math.max(m, p.n_comA, p.n_comB), 1);
    const xA = 64, xB = W - 64;

    // nós
    const nA = { id: '__A__', nome: A.nome, oab: A.oab, pole: 'A', fx: xA, fy: H / 2 };
    const nB = { id: '__B__', nome: B.nome, oab: B.oab, pole: 'B', fx: xB, fy: H / 2 };
    const mid = pontes.map((p, i) => ({
      id: 'p' + i, nome: p.nome, oab: p.oab, n_comA: p.n_comA, n_comB: p.n_comB,
      // posição-alvo horizontal: pende para o polo com quem compartilha mais processos
      tx: xA + (p.n_comB / (p.n_comA + p.n_comB)) * (xB - xA),
    }));
    const nodes = [nA, nB, ...mid];

    const links = [];
    mid.forEach((m) => {
      links.push({ source: nA, target: m, w: m.n_comA });
      links.push({ source: m, target: nB, w: m.n_comB });
    });

    const edgeW = (w) => 0.8 + (w / maxEdge) * 4.0;
    const edgeOp = (w) => 0.25 + 0.55 * (w / maxEdge);
    const midR = (m) => 6 + Math.round((Math.min(m.n_comA, m.n_comB) / maxEdge) * 10);

    const svg = d3.select(container).append('svg').attr('width', W).attr('height', H).style('cursor', 'grab');
    const zoomG = svg.append('g');
    const zoom = d3.zoom().scaleExtent([0.4, 4]).on('zoom', (ev) => zoomG.attr('transform', ev.transform));
    svg.call(zoom);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'grafo-reset';
    resetBtn.title = 'Resetar zoom';
    resetBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 5V1h4M15 5V1h-4M1 11v4h4M15 11v4h-4"/></svg>';
    container.appendChild(resetBtn);
    resetBtn.addEventListener('click', () => svg.transition().duration(350).call(zoom.transform, d3.zoomIdentity));

    const tip = document.createElement('div');
    tip.className = 'grafo-tooltip';
    container.appendChild(tip);

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).distance(d => 70).strength(0.25))
      .force('charge', d3.forceManyBody().strength(-160).distanceMax(280))
      .force('x', d3.forceX(d => d.pole ? (d.pole === 'A' ? xA : xB) : d.tx).strength(d => d.pole ? 1 : 0.45))
      .force('y', d3.forceY(H / 2).strength(0.05))
      .force('collision', d3.forceCollide().radius(d => (d.pole ? 26 : midR(d) + 12)));

    const linkSel = zoomG.append('g').selectAll('line').data(links).join('line')
      .attr('stroke', d => (d.source.pole === 'A' || d.target.pole === 'A') ? accent : accent2)
      .attr('stroke-opacity', d => edgeOp(d.w))
      .attr('stroke-width', d => edgeW(d.w));

    const clampX = v => Math.max(20, Math.min(W - 20, v || 0));
    const clampY = v => Math.max(20, Math.min(H - 20, v || 0));

    const nodeG = zoomG.append('g').selectAll('g').data(nodes).join('g').style('cursor', 'grab');

    // polos (A e B) — círculos grandes coloridos
    nodeG.filter(d => d.pole).append('circle')
      .attr('r', 20)
      .attr('fill', d => d.pole === 'A' ? accent : accent2)
      .attr('stroke', surface).attr('stroke-width', 2);
    nodeG.filter(d => d.pole).append('text')
      .text(d => (d.nome || '?')[0].toUpperCase())
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('font-size', 13).attr('font-weight', 700)
      .attr('font-family', 'IBM Plex Sans, system-ui, sans-serif')
      .attr('fill', accentInk).attr('pointer-events', 'none');

    // pontes — círculos neutros
    nodeG.filter(d => !d.pole).append('circle')
      .attr('r', midR)
      .attr('fill', faint).attr('fill-opacity', 0.85)
      .attr('stroke', muted).attr('stroke-opacity', 0.5).attr('stroke-width', 1);

    // rótulos
    nodeG.append('text')
      .text(d => abbrev(d.nome, !!d.pole))
      .attr('text-anchor', 'middle')
      .attr('y', d => (d.pole ? 34 : midR(d) + 12))
      .attr('font-size', d => d.pole ? 11.5 : 10)
      .attr('font-weight', d => d.pole ? 600 : 400)
      .attr('font-family', 'IBM Plex Sans, system-ui, sans-serif')
      .attr('fill', ink).attr('pointer-events', 'none');

    nodeG.call(d3.drag()
      .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); if (!d.pole) { d.fx = null; d.fy = null; } }));

    nodeG.on('mouseenter', (ev, d) => {
      let html = `<b>${esc(d.nome)}</b>`;
      if (d.oab) html += ` <span style="font-family:monospace;font-size:10px;color:${muted}">${esc(String(d.oab).replace(/^OAB[\s/]*/i, ''))}</span>`;
      if (d.pole) {
        html += `<br><span style="font-size:11px;color:${muted}">${d.pole === 'A' ? 'advogado A' : 'advogado B'}</span>`;
      } else {
        html += `<br><span style="font-size:11px;color:${accent}">${d.n_comA} proc. com ${esc(A.nome.split(' ')[0])}</span>`;
        html += `<br><span style="font-size:11px;color:${accent2}">${d.n_comB} proc. com ${esc(B.nome.split(' ')[0])}</span>`;
      }
      tip.innerHTML = html; tip.classList.add('show'); moveTip(ev);
    }).on('mousemove', moveTip).on('mouseleave', () => tip.classList.remove('show'));

    function moveTip(ev) {
      const rect = container.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      const tw = tip.offsetWidth || 190, th = tip.offsetHeight || 48;
      tip.style.left = (x + 14 + tw > W ? x - tw - 8 : x + 14) + 'px';
      tip.style.top = Math.max(4, Math.min(H - th - 4, y - th / 2)) + 'px';
    }

    sim.on('tick', () => {
      linkSel
        .attr('x1', d => clampX(d.source.x)).attr('y1', d => clampY(d.source.y))
        .attr('x2', d => clampX(d.target.x)).attr('y2', d => clampY(d.target.y));
      nodeG.attr('transform', d => `translate(${clampX(d.x)},${clampY(d.y)})`);
    });
  }

  window.GrafoAdv = { loadD3, render, renderPontes };
})();
