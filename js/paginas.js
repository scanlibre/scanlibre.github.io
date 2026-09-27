// ScanLibre · paginas.js
// De la foto a la página guardada: buscar la hoja, enderezar, filtrar y guardar.
// Las fotos en ráfaga o importadas pasan por una cola, una por una, para no
// llenar la memoria del teléfono.

import { detectar, procesar } from './motor.js';
import { abrirFoto, aCanvas, aImageData, canvasABlob, imageDataABlob, normalizarFoto, soltarCanvas } from './fotos.js';
import { agregarPagina, guardarDocumento, guardarPagina, obtenerDocumento, obtenerPagina } from './db.js';
import { nuevoId, nombrePorDefecto } from './util.js';
import { ajustes } from './ajustes.js';

export const TODA_LA_FOTO = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

/** Busca la hoja en la foto (canvas o bitmap). Devuelve las esquinas o null */
export async function buscarHoja(fuente) {
  const r = await detectar(aImageData(fuente, 480));
  return r && r.confianza >= 0.5 ? r.esquinas : null;
}

/** Endereza y filtra la foto; devuelve los Blob de la página y de su miniatura */
async function renderizar(fuente, { esquinas, filtro, rotacion }) {
  const res = await procesar(aImageData(fuente), { esquinas, filtro, rotacion, maxLado: 3000 });
  // El blanco y negro se guarda en PNG: sin pérdida y liviano
  const procesada = await imageDataABlob(res, filtro === 'bn' ? 'image/png' : 'image/jpeg', 0.9);
  const lienzo = document.createElement('canvas');
  lienzo.width = res.width; lienzo.height = res.height;
  lienzo.getContext('2d').putImageData(res, 0, 0);
  const chico = aCanvas(lienzo, 360);
  soltarCanvas(lienzo);
  const miniatura = await canvasABlob(chico, 'image/jpeg', 0.8);
  soltarCanvas(chico);
  return { procesada, procAncho: res.width, procAlto: res.height, miniatura };
}

/**
 * Página nueva a partir de una foto ya normalizada ({ blob, ancho, alto, canvas }).
 * Si todo sale bien, el canvas de la foto se suelta: ya no se necesita.
 */
export async function crearPagina(foto, esquinas) {
  const filtro = ajustes().filtro;
  const esq = esquinas || await buscarHoja(foto.canvas) || TODA_LA_FOTO;
  const r = await renderizar(foto.canvas, { esquinas: esq, filtro, rotacion: 0 });
  soltarCanvas(foto.canvas);
  return { id: nuevoId(), original: foto.blob, ancho: foto.ancho, alto: foto.alto, esquinas: esq, filtro, rotacion: 0, creada: Date.now(), ...r };
}

/** Vuelve a armar la página con otras esquinas, filtro o giro, y la guarda */
export async function reprocesar(pagina, cambios) {
  const datos = { esquinas: pagina.esquinas, filtro: pagina.filtro, rotacion: pagina.rotacion, ...cambios };
  const bitmap = await abrirFoto(pagina.original);
  const r = await renderizar(bitmap, datos);
  bitmap.close?.();
  // El texto leído ya no corresponde a la página nueva
  const nueva = { ...pagina, ...datos, ...r, ocr: null };
  await guardarPagina(nueva);
  const doc = await obtenerDocumento(pagina.docId);
  if (doc) { doc.modificado = Date.now(); await guardarDocumento(doc); }
  return nueva;
}

/** Qué versión de la página es: si cambia (filtro, recorte, giro), el texto leído deja de servir */
const versionDe = p => `${p.filtro}|${p.rotacion}|${p.procAncho}x${p.procAlto}|${JSON.stringify(p.esquinas)}`;

/**
 * Texto de la página con el lector de texto (OCR). Si ya se leyó con ese
 * idioma, no se vuelve a leer. El resultado se guarda con la página.
 */
export async function textoDePagina(pagina, { idioma = 'spa', alAvanzar } = {}) {
  if (pagina.ocr && pagina.ocr.idioma === idioma && pagina.ocr.version === versionDe(pagina)) return pagina.ocr;
  const { leerTexto } = await import('./ocr.js');
  const version = versionDe(pagina);
  const ocr = { ...(await leerTexto(pagina.procesada, { idioma, alAvanzar })), ancho: pagina.procAncho, alto: pagina.procAlto, version };
  // Si mientras se leía la página cambió (otro filtro, otro recorte), este texto no se guarda
  const actual = await obtenerPagina(pagina.id);
  if (actual && versionDe(actual) === version) {
    await guardarPagina({ ...actual, ocr });
    if (versionDe(pagina) === version) pagina.ocr = ocr;
  }
  return ocr;
}

export async function nuevoDocumento() {
  const ahora = Date.now();
  return guardarDocumento({ id: nuevoId(), nombre: nombrePorDefecto(), creado: ahora, modificado: ahora, paginas: [] });
}

// ── Cola de fotos ───────────────────────────────────────────────────
export const eventosPaginas = new EventTarget();
let cadena = Promise.resolve();
const pendientes = new Map(); // docId → fotos que faltan

const avisar = (tipo, detalle) => eventosPaginas.dispatchEvent(new CustomEvent(tipo, { detail: detalle }));

/** Agrega al documento, en orden, la página que arme `trabajo()` */
export function encolar(docId, trabajo) {
  pendientes.set(docId, (pendientes.get(docId) || 0) + 1);
  avisar('cambio', { docId });
  cadena = cadena.then(async () => {
    try {
      await agregarPagina(docId, await trabajo());
    } catch (e) {
      console.error(e);
      avisar('error', { docId, error: e });
    } finally {
      pendientes.set(docId, pendientes.get(docId) - 1);
      if (!pendientes.get(docId)) pendientes.delete(docId);
      avisar('cambio', { docId });
    }
  });
  return cadena;
}

export const pendientesEnCola = docId => pendientes.get(docId) || 0;

/** Fotos de la galería o de un archivo: cada una se normaliza, se busca la hoja y se guarda */
export function importarArchivos(docId, archivos) {
  for (const archivo of archivos) encolar(docId, async () => crearPagina(await normalizarFoto(archivo)));
  return cadena;
}
