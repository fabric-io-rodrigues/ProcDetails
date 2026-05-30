/* ==========================================================================
   grafo.js — Grafo de relacionamento entre advogados (estilo Les Misérables)
   Lazy-carrega D3 v7. Usa variáveis CSS do tema.
   Expõe: window.GrafoAdv = { loadD3, render }

   render(container, centralNome, { nodes, edges })
     nodes : [{ id, nome, oab, n_com_central, central }]
     edges : [{ source, target, n_comum }]   ← todos os pares, não só estrela
   ========================================================================== */
(function () {
  'use strict';

  const D3_URL = 'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js';
  let _d3Promise = null;

  function loadD3() {
    if (window.d3) return Promise.resolve();
    if (_d3Promise) return _d3Promise;
    _d3Promise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = D3_URL;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Falha ao carregar D3.js')); };
      document.head.appendChild(s);
    });
    return _d3Promise;
  }

  function cssVar(prop) {
    return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function abbrev(name, central) {
    var parts = String(name || '').trim().split(/\s+/);
    if (central) return parts[0] || name;
    if (parts.length === 1) return parts[0].slice(0, 9);
    return parts[0] + ' ' + parts[parts.length - 1][0] + '.';
  }

  /**
   * render(container, centralNome, graphData)
   *   graphData = { nodes: [...], edges: [...] }  — retornado por Services.grafoAdvogado()
   */
  function render(container, centralNome, graphData) {
    var nodes = (graphData && graphData.nodes) || [];
    var edges = (graphData && graphData.edges) || [];

    if (!nodes.length) {
      container.textContent = 'Sem dados de relacionamento.';
      return;
    }

    /* --- cores do tema --------------------------------------------------- */
    var accent    = cssVar('--accent')     || '#3D4ED6';
    var accentInk = cssVar('--accent-ink') || '#ffffff';
    var ink       = cssVar('--ink')        || '#161B22';
    var muted     = cssVar('--muted')      || '#6B7585';
    var line      = cssVar('--line')       || '#E0E4EA';
    var surface   = cssVar('--surface')    || '#FFFFFF';

    /* --- dimensões: cresce com o número de nós -------------------------- */
    var W = container.clientWidth || 480;
    var n = nodes.length;
    var H = Math.max(380, Math.min(640, 220 + n * 16));
    container.style.height = H + 'px';

    /* --- limpar ---------------------------------------------------------- */
    container.querySelectorAll('svg, .grafo-tooltip').forEach(function (e) { e.remove(); });

    /* --- tooltip --------------------------------------------------------- */
    var tip = document.createElement('div');
    tip.className = 'grafo-tooltip';
    container.appendChild(tip);

    /* --- escalas --------------------------------------------------------- */
    var maxCentral = nodes.reduce(function (m, d) { return Math.max(m, d.n_com_central || 0); }, 1);
    var maxEdge    = edges.reduce(function (m, e) { return Math.max(m, e.n_comum || 1); }, 1);

    /* raio: central fixo, satélites proporcionais a n_com_central */
    function nodeR(d) {
      if (d.central) return 22;
      return 7 + Math.round((d.n_com_central / maxCentral) * 11);
    }

    /* opacidade do fill do nó — fantasma (pouca conexão) → sólido (muita) */
    function fillOpacity(d) {
      if (d.central) return 1;
      return 0.12 + 0.88 * (d.n_com_central / maxCentral);
    }
    function strokeOpacity(d) {
      if (d.central) return 0;
      return 0.28 + 0.72 * (d.n_com_central / maxCentral);
    }
    function labelOpacity(d) {
      if (d.central) return 1;
      return 0.35 + 0.65 * (d.n_com_central / maxCentral);
    }

    /* opacidade e espessura das arestas — por n_comum */
    function edgeOpacity(e) {
      var isCentralEdge = (e.source.id || e.source) === centralNome
                       || (e.target.id || e.target) === centralNome;
      var base = isCentralEdge ? 0.55 : 0.18;
      return base + (1 - base) * (e.n_comum / maxEdge);
    }
    function edgeWidth(e) {
      return 0.8 + (e.n_comum / maxEdge) * 2.4;
    }

    function clamp(v, max) { return Math.max(28, Math.min((max || 400) - 28, v || 0)); }

    /* --- SVG ------------------------------------------------------------- */
    var svg = d3.select(container).append('svg')
      .attr('width', W).attr('height', H);

    /* gradiente de fundo */
    var defs = svg.append('defs');
    var grd = defs.append('radialGradient').attr('id', 'gbg')
      .attr('cx', '50%').attr('cy', '50%').attr('r', '55%');
    grd.append('stop').attr('offset', '0%').attr('stop-color', accent).attr('stop-opacity', 0.06);
    grd.append('stop').attr('offset', '100%').attr('stop-color', surface).attr('stop-opacity', 0);
    svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'url(#gbg)');

    /* --- simulação -------------------------------------------------------- */
    var repulsion = n > 35 ? -280 : n > 20 ? -230 : n > 10 ? -190 : -160;
    var sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges)
        .id(function (d) { return d.id; })
        /* arestas pesadas mantêm nós mais próximos */
        .distance(function (e) { return 60 + (1 - e.n_comum / maxEdge) * 60; })
        .strength(function (e) { return 0.3 + 0.5 * (e.n_comum / maxEdge); }))
      .force('charge', d3.forceManyBody().strength(repulsion))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide().radius(function (d) { return nodeR(d) + 12; }));

    /* --- arestas --------------------------------------------------------- */
    var link = svg.append('g')
      .selectAll('line').data(edges).join('line')
      .attr('stroke', accent)
      .attr('stroke-opacity', edgeOpacity)
      .attr('stroke-width', edgeWidth);

    /* --- grupos de nós --------------------------------------------------- */
    var nodeG = svg.append('g')
      .selectAll('g').data(nodes).join('g')
      .style('cursor', function (d) { return d.central ? 'default' : 'pointer'; });

    /* círculo principal */
    nodeG.append('circle')
      .attr('r', nodeR)
      .attr('fill', accent)
      .attr('fill-opacity', fillOpacity)
      .attr('stroke', accent)
      .attr('stroke-opacity', strokeOpacity)
      .attr('stroke-width', 1.5);

    /* anel tracejado no nó central */
    nodeG.filter(function (d) { return d.central; })
      .append('circle')
      .attr('r', function (d) { return nodeR(d) + 6; })
      .attr('fill', 'none')
      .attr('stroke', accent)
      .attr('stroke-opacity', 0.30)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 3');

    /* letra inicial no nó central */
    nodeG.filter(function (d) { return d.central; })
      .append('text')
      .text(function (d) { return (d.label || d.nome || '?')[0].toUpperCase(); })
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('font-size', 13).attr('font-weight', '700')
      .attr('font-family', 'IBM Plex Sans, system-ui, sans-serif')
      .attr('fill', accentInk).attr('pointer-events', 'none');

    /* rótulo abaixo do nó */
    nodeG.append('text')
      .text(function (d) { return abbrev(d.label || d.nome, d.central); })
      .attr('text-anchor', 'middle')
      .attr('y', function (d) { return nodeR(d) + 12; })
      .attr('font-size', 10.5)
      .attr('font-family', 'IBM Plex Sans, system-ui, sans-serif')
      .attr('fill', ink)
      .attr('fill-opacity', labelOpacity)
      .attr('pointer-events', 'none');

    /* --- drag ------------------------------------------------------------ */
    nodeG.call(d3.drag()
      .on('start', function (ev, d) { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag',  function (ev, d) { d.fx = ev.x; d.fy = ev.y; })
      .on('end',   function (ev, d) { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    );

    /* --- tooltip --------------------------------------------------------- */
    nodeG
      .on('mouseenter', function (ev, d) {
        var ratio = d.central ? 1 : d.n_com_central / maxCentral;
        var bar = '<span style="display:inline-block;width:' + Math.round(ratio * 48) + 'px;'
          + 'height:4px;border-radius:2px;background:' + accent + ';opacity:' + (0.3 + 0.7 * ratio)
          + ';margin-right:4px;vertical-align:middle"></span>';
        var html = '<b>' + esc(d.label || d.nome) + '</b>';
        if (d.oab) html += ' <span style="font-family:monospace;font-size:10px;color:' + muted + '">OAB ' + esc(d.oab) + '</span>';
        if (!d.central) {
          html += '<br>' + bar + '<span style="font-size:11px;color:' + accent + '">'
            + d.n_com_central + ' proc. em comum com ' + esc(centralNome.split(' ')[0]) + '</span>';
          /* contar grau total no subgrafo */
          var grau = edges.filter(function (e) {
            return (e.source.id || e.source) === d.id || (e.target.id || e.target) === d.id;
          }).length;
          html += '<br><span style="font-size:11px;color:' + muted + '">'
            + grau + ' conexão' + (grau !== 1 ? 'ões' : '') + ' neste subgrafo</span>';
        } else {
          html += '<br><span style="font-size:11px;color:' + muted + '">advogado central · '
            + (nodes.length - 1) + ' colaboradores</span>';
        }
        tip.innerHTML = html;
        tip.classList.add('show');
        moveTip(ev);
      })
      .on('mousemove', moveTip)
      .on('mouseleave', function () { tip.classList.remove('show'); });

    /* clique em satélite navega para sua tela */
    nodeG.filter(function (d) { return !d.central; })
      .on('click', function (ev, d) {
        window.location.hash = '#/advogado?q=' + encodeURIComponent(d.label || d.nome);
      });

    /* --- tick ------------------------------------------------------------ */
    sim.on('tick', function () {
      link
        .attr('x1', function (d) { return clamp(d.source.x, W); })
        .attr('y1', function (d) { return clamp(d.source.y, H); })
        .attr('x2', function (d) { return clamp(d.target.x, W); })
        .attr('y2', function (d) { return clamp(d.target.y, H); });
      nodeG.attr('transform', function (d) {
        return 'translate(' + clamp(d.x, W) + ',' + clamp(d.y, H) + ')';
      });
    });

    /* --- posição do tooltip ---------------------------------------------- */
    function moveTip(ev) {
      var rect = container.getBoundingClientRect();
      var x = ev.clientX - rect.left;
      var y = ev.clientY - rect.top;
      var tw = tip.offsetWidth || 180;
      var th = tip.offsetHeight || 44;
      tip.style.left = (x + 14 + tw > W ? x - tw - 8 : x + 14) + 'px';
      tip.style.top  = Math.max(4, Math.min(H - th - 4, y - th / 2)) + 'px';
    }
  }

  window.GrafoAdv = { loadD3: loadD3, render: render };
})();
