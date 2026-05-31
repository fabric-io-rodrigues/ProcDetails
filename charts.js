/* ==========================================================================
   charts.js — gráficos de dados (treemap de atuação).
   Independente de grafo.js. Lazy-carrega D3 v7. Usa variáveis CSS do tema.
   Expõe: window.Charts = { loadD3, renderTreemap }

   renderTreemap(container, { tribunais: [{ sigla, total, varas:[{orgao, n}] }] })
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

  function renderTreemap(container, data) {
    [...container.childNodes].forEach(n => { if (n.nodeType === 3) n.remove(); });
    container.querySelectorAll('svg, .grafo-tooltip, .grafo-empty').forEach(e => e.remove());
    const tribunais = (data && data.tribunais) || [];
    if (!tribunais.length) { container.textContent = 'Sem dados de atuação.'; return; }

    const ink     = cssVar('--ink')     || '#161B22';
    const muted   = cssVar('--muted')   || '#6B7585';
    const surface = cssVar('--surface') || '#FFFFFF';
    const line    = cssVar('--line')    || '#E0E4EA';

    // paleta determinística por tribunal
    const PAL = ['#0E7C66', '#2E8BD6', '#C77D1A', '#8B5CF6', '#D9456E', '#3C9A5F', '#0E8CA8', '#B5559E', '#6366F1', '#CC5A3A'];
    const hash = (s) => { let h = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
    const colorTrib = (sig) => PAL[hash(sig) % PAL.length];

    const root = {
      name: 'root',
      children: tribunais.map(t => ({
        name: t.sigla,
        children: t.varas.map(v => ({ name: v.orgao, value: v.n, sigla: t.sigla })),
      })),
    };

    const W = container.clientWidth || 540;
    const total = tribunais.reduce((a, t) => a + t.total, 0);
    const H = Math.max(280, Math.min(560, 240 + Math.sqrt(total) * 6));
    container.style.height = H + 'px';

    const hierarchy = d3.hierarchy(root).sum(d => d.value || 0).sort((a, b) => b.value - a.value);
    d3.treemap().size([W, H]).paddingInner(2).paddingTop(18).paddingOuter(2).round(true)(hierarchy);

    const svg = d3.select(container).append('svg').attr('width', W).attr('height', H);

    const tip = document.createElement('div');
    tip.className = 'grafo-tooltip';
    container.appendChild(tip);

    // títulos dos tribunais (nível 1)
    const t1 = svg.append('g').selectAll('g').data(hierarchy.children || []).join('g');
    t1.append('rect')
      .attr('x', d => d.x0).attr('y', d => d.y0)
      .attr('width', d => Math.max(0, d.x1 - d.x0)).attr('height', d => Math.max(0, d.y1 - d.y0))
      .attr('fill', 'none').attr('stroke', line).attr('stroke-width', 1).attr('rx', 4);
    t1.append('text')
      .attr('x', d => d.x0 + 6).attr('y', d => d.y0 + 12)
      .attr('font-size', 11).attr('font-weight', 700)
      .attr('font-family', 'IBM Plex Sans, system-ui, sans-serif')
      .attr('fill', d => colorTrib(d.data.name))
      .text(d => `${d.data.name} · ${d.value}`);

    // folhas (varas)
    const leaves = svg.append('g').selectAll('g').data(hierarchy.leaves()).join('g');
    leaves.append('rect')
      .attr('x', d => d.x0).attr('y', d => d.y0)
      .attr('width', d => Math.max(0, d.x1 - d.x0)).attr('height', d => Math.max(0, d.y1 - d.y0))
      .attr('fill', d => colorTrib(d.data.sigla)).attr('fill-opacity', 0.78)
      .attr('rx', 2).style('cursor', 'default')
      .on('mouseenter', (ev, d) => {
        tip.innerHTML = `<b>${esc(d.data.name)}</b><br><span style="font-size:11px;color:${muted}">${d.data.sigla} · ${d.value} comunicaç${d.value === 1 ? 'ão' : 'ões'}</span>`;
        tip.classList.add('show'); moveTip(ev);
      })
      .on('mousemove', moveTip)
      .on('mouseleave', () => tip.classList.remove('show'));

    // rótulo da vara quando couber
    leaves.append('text')
      .attr('x', d => d.x0 + 4).attr('y', d => d.y0 + 13)
      .attr('font-size', 10).attr('font-family', 'IBM Plex Sans, system-ui, sans-serif')
      .attr('fill', '#fff').attr('pointer-events', 'none')
      .each(function (d) {
        const w = d.x1 - d.x0, h = d.y1 - d.y0;
        if (w < 42 || h < 18) return;
        const max = Math.floor(w / 6);
        let nm = d.data.name;
        if (nm.length > max) nm = nm.slice(0, Math.max(3, max - 1)) + '…';
        d3.select(this).text(nm);
      });

    function moveTip(ev) {
      const rect = container.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      const tw = tip.offsetWidth || 200, th = tip.offsetHeight || 44;
      tip.style.left = (x + 14 + tw > W ? x - tw - 8 : x + 14) + 'px';
      tip.style.top = Math.max(4, Math.min(H - th - 4, y - th / 2)) + 'px';
    }
  }

  window.Charts = { loadD3, renderTreemap };
})();
