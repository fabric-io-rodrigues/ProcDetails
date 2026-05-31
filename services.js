/* ============================================================================
   services.js — camada de dados (SQLite via sql.js)
   Expõe o objeto global `Services` com funções que executam SQL e devolvem
   arrays/objetos JavaScript. Nenhuma lógica de UI aqui.
   ============================================================================ */
(function () {
  'use strict';

  const SQLJS_CDN = 'https://cdn.jsdelivr.net/npm/sql.js-fts5/dist/';
  const ENC_URL   = window.PROCDETAILS_ENC_URL || './base_processos.enc';

  /* ----------------------------------------------------------------- AUTH
     precheck() informa que a base sempre precisa de senha.
     verificarSenha() retorna true incondicionalmente — a validação real
     ocorre durante a decifragem em initDB (senha errada → AES-GCM lança). */
  function precheck() { return { needsPassword: true, demoHint: null }; }
  function verificarSenha() { return true; }

  let _db = null;

  /* ---------------------------------------------------------------- crypto
     Formato PJDB (definido em deploy_base.py):
       bytes[0..3]  = 'PJDB'  (magic, 4 bytes)
       bytes[4]     = 0x01    (version, 1 byte)
       bytes[5..20] = salt    (16 bytes)
       bytes[21..32]= nonce   (12 bytes)
       bytes[33..]  = ciphertext + 16-byte GCM tag                         */

  async function derivarChave(password, salt) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  }

  async function decifrar(encBytes, password) {
    const magic = String.fromCharCode(encBytes[0], encBytes[1], encBytes[2], encBytes[3]);
    if (magic !== 'PJDB') throw new Error('ARQUIVO_INVALIDO');
    if (encBytes[4] !== 0x01) throw new Error('ARQUIVO_INVALIDO');

    const salt       = encBytes.slice(5, 21);
    const nonce      = encBytes.slice(21, 33);
    const ciphertext = encBytes.slice(33);

    const chave = await derivarChave(password, salt);
    let decrypted;
    try {
      decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce },
        chave,
        ciphertext
      );
    } catch (e) {
      throw new Error('SENHA_INCORRETA');
    }
    return new Uint8Array(decrypted);
  }

  async function descomprimirGzip(compressed) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream não suportado. Use Chrome 80+, Firefox 113+ ou Safari 16.4+.');
    }
    try {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) {
      throw new Error('Falha ao descomprimir: ' + (e && e.message || e));
    }
  }

  /* ------------------------------------------------------------------ init */
  async function initDB(opts = {}) {
    const password   = opts.password || '';
    const onProgress = typeof opts === 'function' ? opts : opts.onProgress;

    if (!password) throw new Error('Senha não pode ser vazia.');

    /* 1. Carregar sql.js */
    const SQL = await initSqlJs({ locateFile: (f) => SQLJS_CDN + f });

    /* 2. Buscar base cifrada com barra de progresso */
    const encBuf = await fetchWithProgress(ENC_URL, onProgress ? (p) => onProgress(p * 0.6) : null);

    /* 3. Decifrar (PBKDF2 + AES-256-GCM) */
    if (onProgress) onProgress(0.65);
    const encBytes   = new Uint8Array(encBuf);
    const compressed = await decifrar(encBytes, password);

    /* 4. Descomprimir gzip */
    if (onProgress) onProgress(0.80);
    const sqliteBytes = await descomprimirGzip(compressed);

    /* 5. Abrir banco */
    if (onProgress) onProgress(0.95);
    _db = new SQL.Database(sqliteBytes);
    _db.exec('SELECT 1 FROM processos LIMIT 1');
    window._db = _db;

    if (onProgress) onProgress(1);
    return _db;
  }

  async function fetchWithProgress(url, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ao buscar ' + url);
    const total = +(res.headers.get('Content-Length') || 0);
    if (!res.body || !total || !onProgress) {
      const ab = await res.arrayBuffer();
      if (onProgress) onProgress(1);
      return ab;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(Math.min(received / total, 0.99));
    }
    onProgress(1);
    const out = new Uint8Array(received);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out.buffer;
  }

  /* --------------------------------------------------------------- helpers */
  function query(sql, params = []) {
    if (!_db) throw new Error('Banco não inicializado');
    const stmt = _db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function queryOne(sql, params = []) {
    const rows = query(sql, params);
    return rows.length ? rows[0] : null;
  }

  function ftsExpr(q) {
    const tokens = String(q || '')
      .toLowerCase()
      .replace(/["()*:^]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (!tokens.length) return null;
    return tokens.map((t) => '"' + t + '"*').join(' ');
  }

  /* ----------------------------------------------------------- 1. Lista */
  function listarProcessos({ busca = '', classe = '' } = {}) {
    const cols = `p.numero, p.cnj, p.classe, p.orgao, p.assunto, p.advogados, p.partes,
                  p.n_comunicacoes, p.n_movimentos_tj, p.n_movimentos_mp, p.n_eventos_ia,
                  p.data_ultima_com, p.data_ultimo_mov`;
    const expr = ftsExpr(busca);
    const where = [];
    const params = [];

    let sql;
    if (expr) {
      sql = `SELECT ${cols}
             FROM processos_fts f
             JOIN processos p ON p.numero = f.numero
             WHERE processos_fts MATCH ?`;
      params.push(expr);
      if (classe) { sql += ` AND p.classe = ?`; params.push(classe); }
      sql += ` ORDER BY p.data_ultima_com DESC NULLS LAST`;
    } else {
      sql = `SELECT ${cols} FROM processos p`;
      if (classe) { where.push('p.classe = ?'); params.push(classe); }
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      sql += ` ORDER BY p.data_ultima_com DESC NULLS LAST`;
    }
    return query(sql, params);
  }

  function listarClasses() {
    return query(
      `SELECT classe, COUNT(*) AS n FROM processos
       WHERE classe IS NOT NULL AND classe <> ''
       GROUP BY classe ORDER BY n DESC, classe`
    );
  }

  function contarProcessos() {
    const r = queryOne('SELECT COUNT(*) AS n FROM processos');
    return r ? r.n : 0;
  }

  /* --------------------------------------------------------- 2. Detalhe */
  function obterProcesso(numero) {
    return queryOne('SELECT * FROM processos WHERE numero = ?', [numero]);
  }

  function listarMovimentos(numero) {
    return query(
      `SELECT fonte, data_iso, data_original, descricao, detalhe
       FROM movimentos WHERE numero_processo = ?
       ORDER BY data_iso DESC, id DESC`,
      [numero]
    );
  }

  let _comCols = null;
  function _comunicacaoCols() {
    if (_comCols) return _comCols;
    try { _comCols = new Set(query('PRAGMA table_info(comunicacoes)').map((r) => r.name)); }
    catch (e) { _comCols = new Set(); }
    return _comCols;
  }

  function listarComunicacoes(numero) {
    const cols = _comunicacaoCols();
    const extra = [];
    ['hash', 'hash_certidao', 'numero_comunicacao', 'id_comunicacao'].forEach((c) => { if (cols.has(c)) extra.push(c); });
    const extraSel = extra.length ? ', ' + extra.join(', ') : '';
    return query(
      `SELECT id, data_disponibilizacao, tipo_comunicacao, tipo_documento,
              nome_orgao, link,
              substr(texto, 1, 300) AS preview,
              length(texto)        AS texto_len${extraSel}
       FROM comunicacoes WHERE numero_processo = ?
       ORDER BY data_disponibilizacao DESC`,
      [numero]
    );
  }

  function obterTextoComunicacao(id) {
    const r = queryOne('SELECT texto FROM comunicacoes WHERE id = ?', [id]);
    return r ? r.texto : '';
  }

  function listarEventos(numero) {
    return query(
      `SELECT data_iso, data_original, evento
       FROM eventos_ia WHERE numero_processo = ?
       ORDER BY data_iso`,
      [numero]
    );
  }

  /* ----------------------------------------------------------- 3. Agenda */
  function _advWhere(opts) {
    const cl = [], pr = [];
    if (opts && opts.advA) { cl.push("p.advogados LIKE '%' || ? || '%'"); pr.push(opts.advA); }
    if (opts && opts.advB) { cl.push("p.advogados LIKE '%' || ? || '%'"); pr.push(opts.advB); }
    return { sql: cl.length ? ' AND ' + cl.join(' AND ') : '', pr };
  }

  function agenda(referencia, diasAFrente = null, opts = {}) {
    const w = _advWhere(opts);
    const tetoSQL = diasAFrente ? " AND e.data_iso <= date(?, '+' || ? || ' days')" : '';
    const tetoPr  = diasAFrente ? [referencia, String(diasAFrente)] : [];
    return query(
      `SELECT e.data_iso, e.data_original, e.evento,
              p.numero, p.cnj, p.classe, p.orgao, p.advogados
       FROM eventos_ia e
       JOIN processos p ON p.numero = e.numero_processo
       WHERE e.data_iso IS NOT NULL
         AND e.data_iso >= ?${tetoSQL}${w.sql}
       ORDER BY e.data_iso`,
      [referencia, ...tetoPr, ...w.pr]
    );
  }

  function agendaPassada(referencia, diasAtras = 14, opts = {}) {
    const w = _advWhere(opts);
    return query(
      `SELECT e.data_iso, e.data_original, e.evento,
              p.numero, p.cnj, p.classe, p.orgao, p.advogados
       FROM eventos_ia e
       JOIN processos p ON p.numero = e.numero_processo
       WHERE e.data_iso IS NOT NULL
         AND e.data_iso <  ?
         AND e.data_iso >= date(?, '-' || ? || ' days')${w.sql}
       ORDER BY e.data_iso`,
      [referencia, referencia, String(diasAtras), ...w.pr]
    );
  }

  /* ------------------------------------------------------- 4. Advogados */
  function buscarPorAdvogado(termo) {
    return query(
      `SELECT numero, cnj, classe, orgao, assunto, advogados, partes,
              n_comunicacoes, n_movimentos_tj, n_movimentos_mp, n_eventos_ia,
              data_ultima_com, data_ultimo_mov
       FROM processos
       WHERE advogados LIKE '%' || ? || '%'
       ORDER BY data_ultima_com DESC NULLS LAST`,
      [termo]
    );
  }

  function buscarDoisAdvogados(termoA, termoB) {
    return query(
      `SELECT numero, cnj, classe, orgao, assunto, advogados, partes,
              n_comunicacoes, n_movimentos_tj, n_movimentos_mp, n_eventos_ia,
              data_ultima_com, data_ultimo_mov
       FROM processos
       WHERE advogados LIKE '%' || ? || '%'
         AND advogados LIKE '%' || ? || '%'
       ORDER BY data_ultima_com DESC NULLS LAST`,
      [termoA, termoB]
    );
  }

  /* --------------------------------------------- índice de advogados */
  let _advIndex = null;
  function _advKey(nome) {
    return String(nome || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/\bDR[A]?\.?\b/g, '')
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function _parseAdv(str) {
    if (!str) return [];
    return str.split('|').map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/^(.*?)\s*\(([^)]*\d[^)]*)\)\s*$/);
      return m ? { nome: m[1].trim(), oab: m[2].trim() } : { nome: s, oab: '' };
    });
  }
  function _buildAdvIndex() {
    const rows = query("SELECT numero, advogados FROM processos WHERE advogados IS NOT NULL AND advogados <> ''");
    const info = new Map();
    const procToKeys = new Map();
    for (const r of rows) {
      const keys = [];
      for (const a of _parseAdv(r.advogados)) {
        const k = _advKey(a.nome);
        if (!k || k.length < 3) continue;
        keys.push(k);
        let rec = info.get(k);
        if (!rec) { rec = { key: k, oab: a.oab || '', numeros: new Set(), nomes: new Map() }; info.set(k, rec); }
        rec.numeros.add(r.numero);
        if (a.oab && !rec.oab) rec.oab = a.oab;
        rec.nomes.set(a.nome, (rec.nomes.get(a.nome) || 0) + 1);
      }
      procToKeys.set(r.numero, [...new Set(keys)]);
    }
    for (const rec of info.values()) {
      let best = '', bc = -1;
      for (const [nm, c] of rec.nomes) if (c > bc) { bc = c; best = nm; }
      rec.nome = best;
    }
    _advIndex = { info, procToKeys };
  }
  function _ensureAdv() { if (!_advIndex) _buildAdvIndex(); return _advIndex; }

  function listarAdvogados() {
    const { info } = _ensureAdv();
    return [...info.values()]
      .map((r) => ({ nome: r.nome, oab: r.oab, key: r.key, n: r.numeros.size }))
      .sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome, 'pt'));
  }
  function statsAdvogados() { const { info } = _ensureAdv(); return { total: info.size }; }

  function advogadosRelacionados(nome, limite = 999) {
    const { info, procToKeys } = _ensureAdv();
    const k = _advKey(nome);
    const rec = info.get(k);
    if (!rec) return [];
    const cnt = new Map();
    for (const numero of rec.numeros) {
      for (const ok of (procToKeys.get(numero) || [])) {
        if (ok === k) continue;
        cnt.set(ok, (cnt.get(ok) || 0) + 1);
      }
    }
    return [...cnt.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limite)
      .map(([ok, c]) => {
        const r = info.get(ok);
        return { nome: r ? r.nome : ok, oab: r ? r.oab : '', n_comum: c, n_total: r ? r.numeros.size : 0 };
      });
  }

  /* ----------------------------------- 5. Grafo completo de relações */
  /**
   * Retorna { nodes, edges } para o grafo Les-Misérables de `nome`.
   * Nodes: advogado central + até `limiteNos` satélites (top por n_com_central).
   * Edges: todos os pares com ≥1 processo em comum (inclui central↔satélite e satélite↔satélite).
   */
  function grafoAdvogado(nome, limiteNos) {
    if (limiteNos === undefined) limiteNos = 50;
    const { info, procToKeys } = _ensureAdv();
    const k = _advKey(nome);
    const rec = info.get(k);
    if (!rec) return { nodes: [], edges: [] };

    // Conexões diretas com o central
    const cntCentral = new Map();
    for (const numero of rec.numeros) {
      for (const ok of (procToKeys.get(numero) || [])) {
        if (ok === k) continue;
        cntCentral.set(ok, (cntCentral.get(ok) || 0) + 1);
      }
    }

    // Top N satélites por n_com_central
    const satKeys = [...cntCentral.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limiteNos)
      .map(([ok]) => ok);

    const allKeys = [k, ...satKeys];

    // Nós
    const nodes = allKeys.map((ok) => {
      const r = info.get(ok);
      return {
        id:            r ? r.nome : ok,
        nome:          r ? r.nome : ok,
        oab:           r ? r.oab  : '',
        n_com_central: ok === k ? 0 : (cntCentral.get(ok) || 0),
        central:       ok === k,
      };
    });

    // Arestas — interseção de conjuntos de processos para cada par
    const edges = [];
    for (let i = 0; i < allKeys.length; i++) {
      for (let j = i + 1; j < allKeys.length; j++) {
        const ri = info.get(allKeys[i]);
        const rj = info.get(allKeys[j]);
        if (!ri || !rj) continue;
        const [small, large] = ri.numeros.size <= rj.numeros.size
          ? [ri, rj] : [rj, ri];
        let shared = 0;
        for (const num of small.numeros) { if (large.numeros.has(num)) shared++; }
        if (shared > 0) edges.push({ source: ri.nome, target: rj.nome, n_comum: shared });
      }
    }

    return { nodes, edges };
  }

  /* ------------------------- 5b. Pontes entre dois advogados ----------
   * Acha os advogados que compartilham processo com A E com B
   * (o "advogado do meio" que conecta os dois). Co-ocorrência a nível
   * de PROCESSO — o único disponível no banco web. */
  function grafoPontes(nomeA, nomeB) {
    const { info, procToKeys } = _ensureAdv();
    const kA = _advKey(nomeA), kB = _advKey(nomeB);
    const recA = info.get(kA), recB = info.get(kB);
    if (!recA || !recB) return null;

    // processos diretos em comum (A e B no mesmo processo)
    const direto = [...recA.numeros].filter((n) => recB.numeros.has(n));

    // candidatos = advogados que aparecem nos processos de A
    const cA = new Map();
    for (const n of recA.numeros) {
      for (const ok of (procToKeys.get(n) || [])) {
        if (ok === kA || ok === kB) continue;
        cA.set(ok, (cA.get(ok) || 0) + 1);
      }
    }
    // mantém só os que também aparecem em processos de B
    const pontes = [];
    for (const [ok, nA] of cA) {
      const rec = info.get(ok);
      if (!rec) continue;
      let nB = 0;
      for (const n of rec.numeros) if (recB.numeros.has(n)) nB++;
      if (nB > 0) pontes.push({ nome: rec.nome, oab: rec.oab, key: ok, n_comA: nA, n_comB: nB });
    }
    // ordena por "gargalo" (min) e depois pela soma — pontes mais equilibradas no topo
    pontes.sort((x, y) =>
      (Math.min(y.n_comA, y.n_comB) - Math.min(x.n_comA, x.n_comB)) ||
      ((y.n_comA + y.n_comB) - (x.n_comA + x.n_comB))
    );

    return {
      A: { nome: recA.nome, oab: recA.oab, key: kA, n: recA.numeros.size },
      B: { nome: recB.nome, oab: recB.oab, key: kB, n: recB.numeros.size },
      direto,
      pontes,
    };
  }

  /* --------------------- 5c. Tribunal derivado do nº CNJ --------------
   * O banco web não guarda siglaTribunal; derivamos do número (validado
   * em 458/459 processos). Posições CNJ: ...[13]=segmento [14:16]=tribunal */
  const _UF_EST = {
    '01': 'AC', '02': 'AL', '03': 'AP', '04': 'AM', '05': 'BA', '06': 'CE',
    '07': 'DFT', '08': 'ES', '09': 'GO', '10': 'MA', '11': 'MT', '12': 'MS',
    '13': 'MG', '14': 'PA', '15': 'PB', '16': 'PR', '17': 'PE', '18': 'PI',
    '19': 'RJ', '20': 'RN', '21': 'RS', '22': 'RO', '23': 'RR', '24': 'SC',
    '25': 'SE', '26': 'SP', '27': 'TO',
  };
  function tribunalCNJ(numero) {
    const d = String(numero || '').replace(/\D/g, '');
    if (d.length !== 20) return '?';
    const J = d[13], TR = d.slice(14, 16);
    if (J === '8') return 'TJ' + (_UF_EST[TR] || TR);
    if (J === '5') return 'TRT' + String(parseInt(TR, 10) || TR);
    if (J === '4') return 'TRF' + String(parseInt(TR, 10) || TR);
    if (J === '6') return 'TRE' + (_UF_EST[TR] || TR);
    if (J === '3') return 'STJ';
    if (J === '1') return 'STF';
    if (J === '7') return 'JMU';
    return 'J' + J + '-' + TR;
  }

  /* --------------------- 5d. Atuação do advogado (treemap) ------------
   * Retorna { tribunais: [{ sigla, total, varas: [{orgao, n}] }] }
   * onde n = nº de comunicações. Hierarquia tribunal → vara/órgão. */
  function atuacaoAdvogado(nome) {
    const { info } = _ensureAdv();
    const rec = info.get(_advKey(nome));
    if (!rec) return { tribunais: [] };
    const nums = [...rec.numeros];
    if (!nums.length) return { tribunais: [] };

    const ph = nums.map(() => '?').join(',');
    const rows = query(
      `SELECT numero_processo AS np, nome_orgao AS orgao, COUNT(*) AS n
       FROM comunicacoes WHERE numero_processo IN (${ph})
       GROUP BY numero_processo, nome_orgao`,
      nums
    );

    const trib = new Map(); // sigla -> Map(orgao -> count)
    for (const r of rows) {
      const t = tribunalCNJ(r.np);
      const o = r.orgao || '(sem órgão)';
      if (!trib.has(t)) trib.set(t, new Map());
      const m = trib.get(t);
      m.set(o, (m.get(o) || 0) + r.n);
    }

    const tribunais = [...trib.entries()].map(([sigla, m]) => ({
      sigla,
      total: [...m.values()].reduce((a, b) => a + b, 0),
      varas: [...m.entries()]
        .map(([orgao, n]) => ({ orgao, n }))
        .sort((a, b) => b.n - a.n),
    })).sort((a, b) => b.total - a.total);

    return { tribunais };
  }

  /* ----------------------------------------------------- 6. Busca geral */
  function buscaGeral(q) {
    const expr = ftsExpr(q);
    if (!expr) return [];
    const cols = `p.numero, p.cnj, p.classe, p.orgao, p.assunto, p.advogados, p.partes,
                  p.n_comunicacoes, p.n_movimentos_tj, p.n_movimentos_mp, p.n_eventos_ia,
                  p.data_ultima_com, p.data_ultimo_mov`;
    return query(
      `WITH hits AS (
         SELECT DISTINCT numero_processo AS numero FROM comunicacoes_fts WHERE comunicacoes_fts MATCH ?
         UNION
         SELECT DISTINCT numero_processo AS numero FROM movimentos_fts   WHERE movimentos_fts   MATCH ?
         UNION
         SELECT DISTINCT numero          AS numero FROM processos_fts    WHERE processos_fts    MATCH ?
       )
       SELECT ${cols}
       FROM processos p JOIN hits h ON h.numero = p.numero
       ORDER BY p.data_ultima_com DESC NULLS LAST`,
      [expr, expr, expr]
    );
  }

  /* ----------------------------------------------------------- exporta */
  window.Services = {
    initDB,
    precheck,
    verificarSenha,
    listarProcessos,
    listarClasses,
    contarProcessos,
    obterProcesso,
    listarMovimentos,
    listarComunicacoes,
    obterTextoComunicacao,
    listarEventos,
    agenda,
    agendaPassada,
    buscarPorAdvogado,
    buscarDoisAdvogados,
    listarAdvogados,
    statsAdvogados,
    advogadosRelacionados,
    grafoAdvogado,
    grafoPontes,
    atuacaoAdvogado,
    tribunalCNJ,
    buscaGeral,
  };
})();
