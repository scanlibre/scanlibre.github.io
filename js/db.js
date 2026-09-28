// ScanLibre · db.js
// Los documentos y sus páginas viven en IndexedDB, dentro del teléfono.
//  carpetas:   { id, nombre, creada }
//  documentos: { id, nombre, creado, modificado, paginas: [idPagina, ...], carpetaId }
//  paginas:    { id, docId, original, ancho, alto, esquinas, filtro, rotacion,
//                procesada, procAncho, procAlto, miniatura }  (original/procesada/miniatura son Blob)

// Versión 2: se agregaron las carpetas (los documentos de antes quedan sin carpeta)
const NOMBRE = 'scanlibre', VERSION = 2;
let conexion = null;

function abrir() {
  if (conexion) return conexion;
  conexion = new Promise((resolver, rechazar) => {
    const pedido = indexedDB.open(NOMBRE, VERSION);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains('documentos')) db.createObjectStore('documentos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('paginas')) db.createObjectStore('paginas', { keyPath: 'id' }).createIndex('docId', 'docId');
      if (!db.objectStoreNames.contains('carpetas')) db.createObjectStore('carpetas', { keyPath: 'id' });
    };
    pedido.onsuccess = () => {
      const db = pedido.result;
      // Si otra pestaña abre una versión nueva de la app, esta suelta la base para que se pueda actualizar
      db.onversionchange = () => { db.close(); conexion = null; };
      resolver(db);
    };
    pedido.onerror = () => { conexion = null; rechazar(pedido.error); };
  });
  return conexion;
}

function hecho(req) {
  return new Promise((resolver, rechazar) => { req.onsuccess = () => resolver(req.result); req.onerror = () => rechazar(req.error); });
}

async function tienda(nombre, modo = 'readonly') {
  return (await abrir()).transaction(nombre, modo).objectStore(nombre);
}

export async function listarDocumentos() {
  const docs = await hecho((await tienda('documentos')).getAll());
  return docs.sort((a, b) => b.modificado - a.modificado);
}

export async function obtenerDocumento(id) {
  return hecho((await tienda('documentos')).get(id));
}

export async function guardarDocumento(doc) {
  await hecho((await tienda('documentos', 'readwrite')).put(doc));
  pedirAlmacenamientoPersistente();
  return doc;
}

export async function obtenerPagina(id) {
  return hecho((await tienda('paginas')).get(id));
}

export async function guardarPagina(pagina) {
  await hecho((await tienda('paginas', 'readwrite')).put(pagina));
  return pagina;
}

/** Todas las páginas de todos los documentos (para buscar) */
export async function listarPaginas() {
  return hecho((await tienda('paginas')).getAll());
}

export async function paginasDe(doc) {
  const todas = await Promise.all(doc.paginas.map(obtenerPagina));
  return todas.filter(Boolean);
}

/** Guarda la página y la agrega al final del documento, en una sola transacción */
export async function agregarPagina(docId, pagina) {
  const db = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(['documentos', 'paginas'], 'readwrite');
    const docs = tx.objectStore('documentos');
    docs.get(docId).onsuccess = e => {
      const doc = e.target.result;
      if (!doc) { tx.abort(); return; }
      doc.paginas.push(pagina.id);
      doc.modificado = Date.now();
      docs.put(doc);
      tx.objectStore('paginas').put({ ...pagina, docId });
    };
    tx.oncomplete = () => resolver();
    tx.onabort = tx.onerror = () => rechazar(tx.error || new Error('No se encontró el documento'));
  });
}

/** Pone `nueva` en el lugar de la página `paginaId` (mismo número de página) */
export async function reemplazarPagina(docId, paginaId, nueva) {
  const db = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(['documentos', 'paginas'], 'readwrite');
    const pags = tx.objectStore('paginas'), docs = tx.objectStore('documentos');
    pags.get(paginaId).onsuccess = e => {
      const vieja = e.target.result;
      pags.put({ ...nueva, id: paginaId, docId, creada: vieja?.creada ?? nueva.creada });
    };
    docs.get(docId).onsuccess = e => {
      const doc = e.target.result;
      if (doc) { doc.modificado = Date.now(); docs.put(doc); }
    };
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error);
  });
}

/** Guarda la página nueva justo después de `despuesDe` en el documento */
export async function insertarPaginaDespues(docId, despuesDe, pagina) {
  const db = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(['documentos', 'paginas'], 'readwrite');
    const docs = tx.objectStore('documentos');
    docs.get(docId).onsuccess = e => {
      const doc = e.target.result;
      if (!doc) { tx.abort(); return; }
      const i = doc.paginas.indexOf(despuesDe);
      doc.paginas.splice(i < 0 ? doc.paginas.length : i + 1, 0, pagina.id);
      doc.modificado = Date.now();
      docs.put(doc);
      tx.objectStore('paginas').put({ ...pagina, docId });
    };
    tx.oncomplete = () => resolver();
    tx.onabort = tx.onerror = () => rechazar(tx.error || new Error('No se encontró el documento'));
  });
}

/** Guarda la página nueva en el lugar `indice` del documento (0 = la primera) */
export async function insertarPaginaEn(docId, pagina, indice) {
  const db = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(['documentos', 'paginas'], 'readwrite');
    const docs = tx.objectStore('documentos');
    docs.get(docId).onsuccess = e => {
      const doc = e.target.result;
      if (!doc) { tx.abort(); return; }
      doc.paginas.splice(Math.max(0, Math.min(indice, doc.paginas.length)), 0, pagina.id);
      doc.modificado = Date.now();
      docs.put(doc);
      tx.objectStore('paginas').put({ ...pagina, docId });
    };
    tx.oncomplete = () => resolver();
    tx.onabort = tx.onerror = () => rechazar(tx.error || new Error('No se encontró el documento'));
  });
}

export async function borrarPagina(docId, paginaId) {
  const db = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(['documentos', 'paginas'], 'readwrite');
    const docs = tx.objectStore('documentos');
    docs.get(docId).onsuccess = e => {
      const doc = e.target.result;
      if (doc) { doc.paginas = doc.paginas.filter(p => p !== paginaId); doc.modificado = Date.now(); docs.put(doc); }
      tx.objectStore('paginas').delete(paginaId);
    };
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error);
  });
}

/** Borra varias páginas del documento en una sola vez */
export async function borrarPaginas(docId, ids) {
  const quitar = new Set(ids);
  const db = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(['documentos', 'paginas'], 'readwrite');
    const docs = tx.objectStore('documentos'), pags = tx.objectStore('paginas');
    docs.get(docId).onsuccess = e => {
      const doc = e.target.result;
      if (doc) { doc.paginas = doc.paginas.filter(p => !quitar.has(p)); doc.modificado = Date.now(); docs.put(doc); }
      for (const id of quitar) pags.delete(id);
    };
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error);
  });
}

/** Pasa páginas de un documento a otro (al final, en el orden en que estaban) */
export async function moverPaginas(deId, aId, ids) {
  const mover = new Set(ids);
  const db = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(['documentos', 'paginas'], 'readwrite');
    const docs = tx.objectStore('documentos'), pags = tx.objectStore('paginas');
    docs.get(deId).onsuccess = e => {
      const de = e.target.result;
      if (!de) { tx.abort(); return; }
      const lista = de.paginas.filter(p => mover.has(p));
      de.paginas = de.paginas.filter(p => !mover.has(p));
      de.modificado = Date.now();
      docs.put(de);
      docs.get(aId).onsuccess = e2 => {
        const a = e2.target.result;
        if (!a) { tx.abort(); return; }
        a.paginas.push(...lista);
        a.modificado = Date.now();
        docs.put(a);
        for (const id of lista) pags.get(id).onsuccess = e3 => { if (e3.target.result) pags.put({ ...e3.target.result, docId: aId }); };
      };
    };
    tx.oncomplete = () => resolver();
    tx.onabort = tx.onerror = () => rechazar(tx.error || new Error('No se encontró el documento'));
  });
}

export async function borrarDocumento(id) {
  const db = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(['documentos', 'paginas'], 'readwrite');
    const pags = tx.objectStore('paginas');
    pags.index('docId').getAllKeys(id).onsuccess = e => { for (const k of e.target.result) pags.delete(k); };
    tx.objectStore('documentos').delete(id);
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error);
  });
}

/** Guarda un documento completo con sus páginas; si ya existía, sus páginas viejas se reemplazan */
export async function reemplazarDocumento(doc, paginas) {
  const db = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(['documentos', 'paginas'], 'readwrite');
    const pags = tx.objectStore('paginas');
    pags.index('docId').getAllKeys(doc.id).onsuccess = e => {
      for (const k of e.target.result) pags.delete(k);
      for (const p of paginas) pags.put({ ...p, docId: doc.id });
      tx.objectStore('documentos').put({ ...doc, paginas: paginas.map(p => p.id) });
    };
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error);
  });
}

// ── Carpetas ────────────────────────────────────────────────────────
export async function listarCarpetas() {
  const cs = await hecho((await tienda('carpetas')).getAll());
  return cs.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
}

export async function guardarCarpeta(carpeta) {
  await hecho((await tienda('carpetas', 'readwrite')).put(carpeta));
  return carpeta;
}

/** Borra la carpeta; sus documentos no se borran: quedan sin carpeta */
export async function borrarCarpeta(id) {
  const db = await abrir();
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(['carpetas', 'documentos'], 'readwrite');
    const docs = tx.objectStore('documentos');
    docs.getAll().onsuccess = e => {
      for (const d of e.target.result) if (d.carpetaId === id) docs.put({ ...d, carpetaId: null });
      tx.objectStore('carpetas').delete(id);
    };
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error);
  });
}

let persistencia = false;
/** Pide al navegador que no borre los escaneos cuando le falte espacio */
function pedirAlmacenamientoPersistente() {
  if (persistencia) return;
  persistencia = true;
  try { navigator.storage?.persist?.(); } catch (e) {}
}
