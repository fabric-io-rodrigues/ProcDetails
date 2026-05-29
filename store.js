/* ============================================================================
   store.js — persistência local do usuário (IndexedDB, API nativa)
   Stores: favoritos, preferencias, processos_cache (TTL 30 min)
   Expõe `Store` (Promise-based).
   ========================================================================== */
(function () {
  'use strict';

  const DB_NAME = 'procdetails';
  const DB_VERSION = 1;
  const CACHE_TTL = 30 * 60 * 1000; // 30 min
  let _idb = null;

  function open() {
    if (_idb) return Promise.resolve(_idb);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('favoritos'))
          db.createObjectStore('favoritos', { keyPath: 'numero' });
        if (!db.objectStoreNames.contains('preferencias'))
          db.createObjectStore('preferencias', { keyPath: 'k' });
        if (!db.objectStoreNames.contains('processos_cache'))
          db.createObjectStore('processos_cache', { keyPath: 'numero' });
      };
      req.onsuccess = () => { _idb = req.result; resolve(_idb); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode) {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }
  function reqP(r) {
    return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }

  /* ----------------------------------------------------------- favoritos */
  async function listarFavoritos() {
    const os = await tx('favoritos', 'readonly');
    const rows = await reqP(os.getAll());
    return rows.sort((a, b) => (b.adicionado_em || 0) - (a.adicionado_em || 0));
  }
  async function obterFavorito(numero) {
    const os = await tx('favoritos', 'readonly');
    return reqP(os.get(numero));
  }
  async function ehFavorito(numero) {
    return !!(await obterFavorito(numero));
  }
  async function adicionarFavorito({ numero, cnj, classe, tags = [] }) {
    const os = await tx('favoritos', 'readwrite');
    const existente = await reqP(os.get(numero));
    const rec = {
      numero, cnj, classe,
      tags: tags || (existente ? existente.tags : []) || [],
      adicionado_em: existente ? existente.adicionado_em : Date.now(),
    };
    await reqP(os.put(rec));
    return rec;
  }
  async function removerFavorito(numero) {
    const os = await tx('favoritos', 'readwrite');
    await reqP(os.delete(numero));
  }
  async function atualizarTags(numero, tags) {
    const os = await tx('favoritos', 'readwrite');
    const rec = await reqP(os.get(numero));
    if (!rec) return null;
    rec.tags = tags;
    await reqP(os.put(rec));
    return rec;
  }
  async function todasTags() {
    const favs = await listarFavoritos();
    const set = new Set();
    favs.forEach((f) => (f.tags || []).forEach((t) => set.add(t)));
    return [...set].sort((a, b) => a.localeCompare(b, 'pt'));
  }

  /* -------------------------------------------------------- preferencias */
  async function getPref(k, fallback) {
    const os = await tx('preferencias', 'readonly');
    const rec = await reqP(os.get(k));
    return rec ? rec.v : fallback;
  }
  async function setPref(k, v) {
    const os = await tx('preferencias', 'readwrite');
    await reqP(os.put({ k, v }));
  }

  /* --------------------------------------------------------------- cache */
  async function getCache(numero) {
    const os = await tx('processos_cache', 'readonly');
    const rec = await reqP(os.get(numero));
    if (!rec) return null;
    if (Date.now() - rec.cached_at > CACHE_TTL) return null;
    return rec.dados;
  }
  async function setCache(numero, dados) {
    const os = await tx('processos_cache', 'readwrite');
    await reqP(os.put({ numero, dados, cached_at: Date.now() }));
  }

  window.Store = {
    listarFavoritos, obterFavorito, ehFavorito, adicionarFavorito,
    removerFavorito, atualizarTags, todasTags,
    getPref, setPref, getCache, setCache,
  };
})();
