/* ============================================================================
   resumo.js — Resumo do processo em PDF (capa + movimentos), gerado no navegador.
   Resumo.gerar(numero, etapa): etapa(i) avisa o início de cada fase
   (0 componentes, 1 dados, 2 documento, 3 download).
   ============================================================================ */
(function () {
  'use strict';

  const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';

  const AZUL = [31, 42, 68], CINZA = [85, 85, 85], PRETO = [0, 0, 0], BRANCO = [255, 255, 255];
  const FUNDO_ROTULO = [238, 241, 246], ZEBRA = [244, 246, 249], AMARELO = [251, 243, 228], BORDA = [166, 166, 166];
  const DIARIOS = new Set(['DJERJ', 'DOERJ', 'DJEN']);
  const ORDEM_FONTES = ['TJRJ', 'PJe', 'MPRJ', 'DOERJ', 'DJERJ', 'DJEN'];

  const PT = 25.4 / 72;
  const PAG = { w: 210, h: 297, esq: 20, topo: 20, base: 279 };
  const COLS = [10, 21, 36, 103];
  const TAM = 8.5, LH = TAM * PT * 1.22, PAD = 1.4;

  let _jspdf = null;
  function carregarJsPDF() {
    if (window.jspdf) return Promise.resolve();
    if (_jspdf) return _jspdf;
    _jspdf = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSPDF_URL;
      s.onload = resolve;
      s.onerror = () => { _jspdf = null; reject(new Error('Falha ao carregar o gerador de PDF (sem conexão?)')); };
      document.head.appendChild(s);
    });
    return _jspdf;
  }

  const proximoQuadro = () => new Promise((r) => setTimeout(r, 30));

  /* ------------------------------------------------------------- texto */
  const WINANSI = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
  function pdfTexto(s) {
    return String(s == null ? '' : s).normalize('NFC')
      .replace(/[  -​ ]/g, ' ').replace(/\t/g, ' ').replace(/\r/g, '')
      .replace(/[‐‑−]/g, '-').replace(/→/g, '->')
      .replace(/[^\n\x20-\xff]/g, (c) => (WINANSI.has(c) ? c : '?'));
  }

  function br(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '');
  }

  function cnjFmt(d) {
    return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
  }

  function oabFmt(oab) {
    const m = /^(\d+)\/([A-Z]{2})$/.exec(oab || '');
    return m ? `OAB ${m[2]}${m[1]}` : (oab ? `OAB ${oab}` : '');
  }

  const desfazHifen = (s) => String(s || '').replace(/([a-zà-ÿ])- ([a-zà-ÿ])/g, '$1$2');
  const quebrasDjen = (s) => String(s || '').replace(/(?:\/r)+(?:\/n)+|(?:\/n){2,}/g, '\n');

  /* ----------------------------------------------- layout de texto rico
     run = { t, b (negrito), c (cor) }; parágrafo = { runs, antes (mm) };
     linha = { runs (com largura w), dy (espaço antes, mm) }                     */
  function fonte(doc, b, tam) {
    doc.setFont('helvetica', b ? 'bold' : 'normal');
    doc.setFontSize(tam);
  }

  // o jsPDF desenha sem kerning; getTextWidth desconta os pares (VA, Te…) e cola as palavras
  const largura = (doc, t) => doc.getStringUnitWidth(t, { kerning: {} }) * doc.getFontSize() / doc.internal.scaleFactor;

  function quebrar(doc, runs, larg, tam) {
    const linhas = [];
    let atual = [], w = 0;
    const fecha = () => {
      while (atual.length && atual[atual.length - 1].t === ' ') w -= atual.pop().w;
      linhas.push(atual); atual = []; w = 0;
    };
    for (const r of runs) {
      fonte(doc, r.b, tam);
      for (const tok of pdfTexto(r.t).split(/(\s+)/)) {
        if (!tok) continue;
        const esp = /^\s+$/.test(tok);
        if (esp && !atual.length) continue;
        const t = esp ? ' ' : tok;
        const tw = largura(doc, t);
        if (!esp && w + tw > larg && atual.length) fecha();
        if (!esp && tw > larg) {
          let pedaco = '';
          for (const ch of t) {
            if (pedaco && w + largura(doc, pedaco + ch) > larg) {
              const pw = largura(doc, pedaco);
              atual.push({ ...r, t: pedaco, w: pw }); w += pw; fecha(); pedaco = '';
            }
            pedaco += ch;
          }
          const pw = largura(doc, pedaco);
          atual.push({ ...r, t: pedaco, w: pw }); w += pw;
          continue;
        }
        atual.push({ ...r, t, w: tw }); w += tw;
      }
    }
    if (atual.length || !linhas.length) fecha();
    return linhas;
  }

  function linhasDe(doc, paragrafos, larg, tam = TAM) {
    const out = [];
    for (const p of paragrafos) {
      quebrar(doc, p.runs, larg, tam).forEach((runs, i) => out.push({ runs, dy: i === 0 ? (p.antes || 0) : 0 }));
    }
    return out;
  }

  const altura = (linhas, lh = LH) => linhas.reduce((h, l) => h + l.dy + lh, 0);

  function desenharLinhas(doc, linhas, x, y, larg, { tam = TAM, lh = LH, centro = false } = {}) {
    for (const l of linhas) {
      y += l.dy;
      const total = l.runs.reduce((s, r) => s + r.w, 0);
      let cx = centro ? x + (larg - total) / 2 : x;
      for (const r of l.runs) {
        fonte(doc, r.b, tam);
        doc.setTextColor(...(r.c || PRETO));
        doc.text(r.t, cx, y + lh * 0.78);
        cx += r.w;
      }
      y += lh;
    }
    return y;
  }

  /* --------------------------------------------------------------- capa */
  function arquivamento(movs) {
    const m = movs.filter((x) => x.fonte === 'TJRJ' && /^Arquivamento/.test(x.descricao || '')).pop();
    if (!m) return '';
    const det = {};
    for (const [, k, v] of (m.detalhe || '').matchAll(/^([^:\n]+):\s*(.+)$/gm)) det[k.trim()] = v.trim();
    return [
      det['Maço'] && `maço ${det['Maço']}`,
      det['Data de arquivamento'] && `data de arquivamento ${det['Data de arquivamento']}`,
      det['Tipo de arquivamento'], det['Local de arquivamento'],
      m.data_original && `movimento registrado em ${m.data_original}`,
    ].filter(Boolean).join('; ');
  }

  function capa(doc, d) {
    const { p } = d;
    const larg = PAG.w - 2 * PAG.esq;
    doc.setDrawColor(...BORDA);
    doc.setLineWidth(0.5); doc.rect(10, 10, PAG.w - 20, PAG.h - 20);
    doc.setLineWidth(0.2); doc.rect(11.3, 11.3, PAG.w - 22.6, PAG.h - 22.6);

    let y = 32;
    const centro = (txt, tam, b, cor, lh) => {
      if (!txt) return;
      const ls = linhasDe(doc, [{ runs: [{ t: txt, b, c: cor }] }], larg, tam);
      y = desenharLinhas(doc, ls, PAG.esq, y, larg, { tam, lh: lh || tam * PT * 1.3, centro: true });
    };
    centro('PODER JUDICIÁRIO DO ESTADO DO RIO DE JANEIRO', 13, true, AZUL);
    y += 1.5; centro(p.comarca, 10.5, true);
    y += 14; centro(p.vara || p.orgao, 10.5, true);
    y += 0.5; centro(p.serventia, 10);
    y += 16; centro('PROCESSO Nº', 9, false, CINZA);
    y += 1; centro(d.cnj, 26, true, AZUL, 26 * PT * 1.15);
    y += 1; centro(p.codigo_tjrj && `Nº antigo: ${p.codigo_tjrj}`, 12);
    y += 12;

    const quadro = [['Ação', p.classe !== p.desc_rito ? p.classe : ''], ['Assunto', p.assunto], ['Rito', p.desc_rito]]
      .filter(([, v]) => v);
    const qx = 30, qw = 150, rw = 31, tq = 9.5, lq = tq * PT * 1.25;
    for (const [rot, val] of quadro) {
      const ls = linhasDe(doc, [{ runs: [{ t: val }] }], qw - rw - 2 * PAD - 1, tq);
      const h = altura(ls, lq) + 2 * PAD + 0.6;
      doc.setFillColor(...FUNDO_ROTULO); doc.rect(qx, y, rw, h, 'F');
      doc.setDrawColor(200, 204, 210); doc.setLineWidth(0.2);
      doc.rect(qx, y, rw, h); doc.rect(qx + rw, y, qw - rw, h);
      desenharLinhas(doc, linhasDe(doc, [{ runs: [{ t: rot, b: true }] }], rw - 2 * PAD, tq), qx + PAD + 0.6, y + PAD + 0.3, rw, { tam: tq, lh: lq });
      desenharLinhas(doc, ls, qx + rw + PAD + 0.6, y + PAD + 0.3, qw, { tam: tq, lh: lq });
      y += h;
    }
    y += 10;

    const lr = 10 * PT * 1.3;
    const garantir = (h) => { if (y + h > PAG.base) { doc.addPage(); y = PAG.topo; } };
    const linha = (runs) => {
      const ls = linhasDe(doc, [{ runs }], larg, 10);
      garantir(altura(ls, lr));
      y = desenharLinhas(doc, ls, PAG.esq, y, larg, { tam: 10, lh: lr });
    };
    const secao = (txt) => {
      garantir(14);
      y += 4;
      fonte(doc, true, 9.5); doc.setTextColor(...CINZA);
      doc.text(txt, PAG.esq, y + 3.4);
      y += 5.5;
    };

    const partes = d.pessoas.filter((x) => x.tipo === 'parte');
    if (partes.length) {
      secao('PARTES');
      partes.forEach((x) => linha([{ t: `${x.papel || 'Parte'}: `, b: true }, { t: x.nome }]));
    }
    const advs = d.pessoas.filter((x) => x.tipo === 'advogado');
    secao('ADVOGADOS');
    if (advs.length) advs.forEach((x) => linha([{ t: x.nome, b: true }, { t: x.oab ? ` — ${oabFmt(x.oab)}` : '' }]));
    else linha([{ t: '(nenhum advogado informado nas fontes)', c: CINZA }]);

    const arq = arquivamento(d.movimentos);
    const situacao = [
      ['Distribuição:', br(p.data_inicio)],
      ['Segredo de justiça:', p.segredo],
      ['Localização atual:', p.localizacao],
      arq ? ['Arquivamento mais recente:', arq] : ['Situação:', p.situacao],
    ].filter(([, v]) => v);
    if (situacao.length) {
      secao('DISTRIBUIÇÃO E SITUAÇÃO');
      situacao.forEach(([r, v]) => linha([{ t: r + ' ', b: true }, { t: v }]));
    }

    doc.setPage(1);
    fonte(doc, false, 7.5); doc.setTextColor(...CINZA);
    doc.text(pdfTexto(`Resumo gerado em ${br(d.hoje)} a partir das fontes públicas da base`), PAG.w / 2, PAG.h - 16, { align: 'center' });
    doc.setPage(doc.getNumberOfPages());
  }

  /* ------------------------------------------------------- movimentos */
  function detalheTjrj(texto) {
    const out = [];
    String(texto || '').split(/\n\s*\n/).forEach((bloco, bi) => {
      const rotulo = (s) => /^([^:]{1,45}:)\s*(.*)$/.exec(s || '');
      const linhas = bloco.split('\n').map((s) => s.trim()).filter(Boolean);
      linhas.forEach((ln, li) => {
        const antes = li === 0 && bi > 0 ? 1.3 : 0;
        const m = rotulo(ln);
        const ato = m && (m[2].length > 80 || (li + 1 < linhas.length && !rotulo(linhas[li + 1])));
        if (!m) out.push({ runs: [{ t: ln, b: li === 0 }], antes });
        else if (ato) out.push({ runs: [{ t: m[1] + ' ', b: true }, { t: m[2] }], antes: antes || 0.8 });
        else out.push({ runs: [{ t: m[1] + ' ', c: CINZA }, { t: m[2] }], antes });
      });
    });
    return out;
  }

  function textoPlano(texto) {
    return String(texto || '').split(/\n+/).map((s) => s.trim()).filter(Boolean)
      .map((t, i) => ({ runs: [{ t }], antes: i ? 0.8 : 0 }));
  }

  function itens(d) {
    const movs = d.movimentos.map((m) => {
      const diario = DIARIOS.has(m.fonte);
      return {
        fonte: m.fonte, data: m.data_iso, diario,
        mov: [{ runs: [{ t: diario ? `Publicação no ${m.fonte}` : (m.descricao || ''), b: true }] }],
        det: diario ? textoPlano(desfazHifen(m.detalhe)) : detalheTjrj(m.detalhe),
      };
    });
    const coms = d.comunicacoes.map((c) => ({
      fonte: 'DJEN', data: c.data_disponibilizacao, diario: true,
      mov: [{ runs: [{ t: `${c.tipo_comunicacao || 'Comunicação'} no DJEN`, b: true }] },
            ...(c.tipo_documento ? [{ runs: [{ t: c.tipo_documento }] }] : [])],
      det: [...(c.nome_orgao ? [{ runs: [{ t: c.nome_orgao, c: CINZA }] }] : []),
            ...textoPlano(c.formato_texto === Services.FORMATO_MARKDOWN ? Services.mdParaTexto(c.texto) : quebrasDjen(c.texto)).map((x, i) => (i === 0 && c.nome_orgao ? { ...x, antes: 0.8 } : x))],
    }));
    return [...movs, ...coms]
      .map((x, k) => ({ x, k }))
      .sort((a, b) => ((a.x.data || '9999') < (b.x.data || '9999') ? -1 : (a.x.data || '9999') > (b.x.data || '9999') ? 1 : a.k - b.k))
      .map(({ x }) => x);
  }

  function rotuloContagem(lista) {
    const n = {};
    lista.forEach((x) => { n[x.fonte] = (n[x.fonte] || 0) + 1; });
    const fontes = Object.keys(n).sort((a, b) => {
      const ia = ORDEM_FONTES.indexOf(a), ib = ORDEM_FONTES.indexOf(b);
      return (ia < 0 ? 2.5 : ia) - (ib < 0 ? 2.5 : ib);
    });
    const partes = fontes.map((f) => `${n[f]} do ${f}`);
    return partes.length > 1 ? partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1] : partes.join('');
  }

  function tabela(doc, lista) {
    const x0 = PAG.esq, largT = COLS.reduce((a, b) => a + b, 0);
    let y = PAG.topo;

    const titulo = linhasDe(doc, [{ runs: [{ t: `Movimentos (${rotuloContagem(lista)})`, b: true, c: AZUL }] }], largT, 15);
    y = desenharLinhas(doc, titulo, x0, y, largT, { tam: 15, lh: 15 * PT * 1.3 }) + 2.5;

    const cab = () => {
      const h = 6.4;
      doc.setFillColor(...AZUL); doc.rect(x0, y, largT, h, 'F');
      doc.setDrawColor(...BORDA); doc.setLineWidth(0.2);
      let cx = x0;
      ['Nº', 'Data', 'Movimento', 'Detalhes'].forEach((t, i) => {
        doc.rect(cx, y, COLS[i], h);
        fonte(doc, true, 9); doc.setTextColor(...BRANCO);
        doc.text(pdfTexto(t), cx + PAD + 0.4, y + 4.3);
        cx += COLS[i];
      });
      y += h;
    };
    const novaPagina = () => { doc.addPage(); y = PAG.topo; cab(); };
    const topoTabela = PAG.topo + 6.4;

    const fatia = (celulas, h, fundo) => {
      if (fundo) { doc.setFillColor(...fundo); doc.rect(x0, y, largT, h, 'F'); }
      doc.setDrawColor(...BORDA); doc.setLineWidth(0.2);
      let cx = x0;
      celulas.forEach((ls, i) => {
        doc.rect(cx, y, COLS[i], h);
        desenharLinhas(doc, ls, cx + PAD, y + PAD, COLS[i] - 2 * PAD, { centro: i === 0 });
        cx += COLS[i];
      });
      y += h;
    };

    cab();
    lista.forEach((it, idx) => {
      const n = idx + 1;
      const fundo = it.diario ? AMARELO : (n % 2 === 0 ? ZEBRA : null);
      let resto = [
        linhasDe(doc, [{ runs: [{ t: String(n) }] }], COLS[0] - 2 * PAD),
        linhasDe(doc, [{ runs: [{ t: br(it.data) }] }], COLS[1] - 2 * PAD),
        linhasDe(doc, it.mov, COLS[2] - 2 * PAD),
        linhasDe(doc, it.det.length ? it.det : [{ runs: [{ t: '' }] }], COLS[3] - 2 * PAD),
      ];
      let inteira = true;
      for (;;) {
        const h = Math.max(...resto.map((ls) => altura(ls))) + 2 * PAD;
        const disp = PAG.base - y;
        if (h <= disp) { fatia(resto, h, fundo); break; }
        const noTopo = y <= topoTabela + 0.1;
        if (!noTopo && ((inteira && h <= PAG.base - topoTabela) || disp < 2 * PAD + 3 * LH)) { novaPagina(); continue; }
        const cabe = disp - 2 * PAD;
        const corte = resto.map((ls) => {
          let s = 0, k = 0;
          while (k < ls.length && s + ls[k].dy + LH <= cabe) { s += ls[k].dy + LH; k++; }
          return k;
        });
        fatia(resto.map((ls, i) => ls.slice(0, corte[i])), disp, fundo);
        resto = resto.map((ls, i) => ls.slice(corte[i]).map((l, j) => (j === 0 ? { ...l, dy: 0 } : l)));
        inteira = false;
        novaPagina();
      }
    });
  }

  function cabecalhosERodapes(doc, cnj) {
    const total = doc.getNumberOfPages();
    for (let i = 2; i <= total; i++) {
      doc.setPage(i);
      fonte(doc, true, 8); doc.setTextColor(...CINZA);
      doc.text(cnj, PAG.w - PAG.esq, 12, { align: 'right' });
      const num = String(i);
      fonte(doc, true, 8); doc.setTextColor(...PRETO);
      const wn = doc.getTextWidth(num);
      doc.text(num, PAG.w - PAG.esq, PAG.h - 9, { align: 'right' });
      fonte(doc, false, 8); doc.setTextColor(...CINZA);
      doc.text('Fls.', PAG.w - PAG.esq - wn - 1, PAG.h - 9, { align: 'right' });
    }
  }

  /* ---------------------------------------------------------- entrada */
  async function gerar(numero, etapa = () => {}) {
    etapa(0);
    await carregarJsPDF();

    etapa(1);
    await proximoQuadro();
    const p = Services.obterProcesso(numero);
    if (!p) throw new Error('Processo não encontrado na base.');
    const d = {
      p,
      cnj: p.cnj || cnjFmt(numero),
      hoje: new Date().toISOString().slice(0, 10),
      pessoas: Services.partesDoProcesso(numero),
      movimentos: Services.listarMovimentos(numero).slice().reverse(),
      comunicacoes: Services.listarComunicacoes(numero).slice().reverse()
        .map((c) => ({ ...c, texto: Services.obterTextoComunicacao(c.id) })),
    };

    etapa(2);
    await proximoQuadro();
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    doc.setProperties({ title: `Resumo do processo ${d.cnj}`, creator: 'ProcDetails' });
    capa(doc, d);
    const lista = itens(d);
    if (lista.length) { doc.addPage(); tabela(doc, lista); }
    cabecalhosERodapes(doc, d.cnj);

    etapa(3);
    await proximoQuadro();
    doc.save(`Resumo_${d.cnj}.pdf`);
  }

  window.Resumo = { gerar, paragrafosTjrj: detalheTjrj };
})();
