/* ============================================================================
   services.js — camada de dados (SQLite via sql.js)
   Expõe o objeto global `Services` com funções que executam SQL e devolvem
   arrays/objetos JavaScript. Nenhuma lógica de UI aqui.
   ============================================================================ */
(function () {
  'use strict';

  const SQLJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/';
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

  function advogadosRelacionados(nome, limite = 5) {
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

  /* ----------------------------------------------------- 5. Busca geral */
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
    buscaGeral,
  };
})();
