// ScanLibre · db.js
// Los documentos y sus páginas viven en IndexedDB, dentro del teléfono.
//  documentos: { id, nombre, creado, modificado, paginas: [idPagina, ...] }
//  paginas:    { id, docId, original, ancho, alto, esquinas, filtro, rotacion,
//                procesada, procAncho, procAlto, miniatura }  (original/procesada/miniatura son Blob)

const NOMBRE = 'scanlibre', VERSION = 1;
let conexion = null;

function abrir() {
  if (conexion) return conexion;
  conexion = new Promise((resolver, rechazar) => {
    const pedido = indexedDB.open(NOMBRE, VERSION);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains('documentos')) db.createObjectStore('documentos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('paginas')) db.createObjectStore('paginas', { keyPath: 'id' }).createIndex('docId', 'docId');
    };
    pedido.onsuccess = () => resolver(pedido.result);
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

let persistencia = false;
/** Pide al navegador que no borre los escaneos cuando le falte espacio */
function pedirAlmacenamientoPersistente() {
  if (persistencia) return;
  persistencia = true;
  try { navigator.storage?.persist?.(); } catch (e) {}
}
