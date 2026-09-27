// ScanLibre · paginas.js
// De la foto a la página guardada: buscar la hoja, enderezar, filtrar y guardar.
// Las fotos en ráfaga o importadas pasan por una cola, una por una, para no
// llenar la memoria del teléfono.

import { detectar, procesar, nitidez as medir } from './motor.js';
import { UMBRAL_BORROSA } from './imagen/nitidez.js';
import { abrirFoto, aCanvas, aImageData, canvasABlob, imageDataABlob, normalizarFoto, soltarCanvas } from './fotos.js';
import { agregarPagina, guardarDocumento, guardarPagina, obtenerDocumento, obtenerPagina, listarCarpetas, listarDocumentos } from './db.js';
import { nuevoId, nombrePorDefecto, fechaDeClase } from './util.js';
import { ajustes } from './ajustes.js';

export const TODA_LA_FOTO = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

/** ¿La página salió borrosa? (en un dibujo a lápiz lo suave es normal: no se avisa) */
export const esBorrosa = p => p.filtro !== 'dibujo' && typeof p.nitidez === 'number' && p.nitidez < UMBRAL_BORROSA;

/**
 * ¿La hoja de esta foto se ve borrosa? (para avisar antes de guardar). Se mide
 * con la hoja a 800 px de ancho, igual que la página guardada: así el recorte
 * y el documento dicen lo mismo.
 */
export async function fotoBorrosa(fuente, esquinas) {
  return (await medir(aImageData(fuente, 2400), esquinas)).borrosa;
}

/** Busca la hoja en la foto (canvas o bitmap). Devuelve las esquinas o null */
export async function buscarHoja(fuente) {
  const r = await detectar(aImageData(fuente, 480));
  return r && r.confianza >= 0.5 ? r.esquinas : null;
}

/** Endereza y filtra la foto; devuelve los Blob de la página y de su miniatura */
async function renderizar(fuente, { esquinas, filtro, rotacion, aplanar = true }) {
  const { imagen: res, nitidez, aplanada } = await procesar(aImageData(fuente), { esquinas, filtro, rotacion, aplanar, maxLado: 3000 });
  // El blanco y negro se guarda en PNG: sin pérdida y liviano
  const procesada = await imageDataABlob(res, filtro === 'bn' ? 'image/png' : 'image/jpeg', 0.9);
  const lienzo = document.createElement('canvas');
  lienzo.width = res.width; lienzo.height = res.height;
  lienzo.getContext('2d').putImageData(res, 0, 0);
  const chico = aCanvas(lienzo, 360);
  soltarCanvas(lienzo);
  const miniatura = await canvasABlob(chico, 'image/jpeg', 0.8);
  soltarCanvas(chico);
  return { procesada, procAncho: res.width, procAlto: res.height, miniatura, nitidez, aplanada };
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
  return { id: nuevoId(), original: foto.blob, ancho: foto.ancho, alto: foto.alto, esquinas: esq, filtro, rotacion: 0, aplanar: true, creada: Date.now(), ...r };
}

/** Vuelve a armar la página con otras esquinas, filtro, giro o aplanado, y la guarda */
export async function reprocesar(pagina, cambios) {
  const datos = { esquinas: pagina.esquinas, filtro: pagina.filtro, rotacion: pagina.rotacion, aplanar: pagina.aplanar !== false, ...cambios };
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
// LECTOR sube cuando cambia cómo se lee (así los textos viejos se vuelven a leer)
const LECTOR = 3;
const versionDe = p => `l${LECTOR}|${p.filtro}|${p.rotacion}|${p.aplanar !== false}|${p.procAncho}x${p.procAlto}|${JSON.stringify(p.esquinas)}`;

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

/**
 * Documento nuevo. Si hay una carpeta elegida en el inicio, va en ella y se
 * llama como la clase y la fecha: «Cálculo – 27 sept» (o «… (2)» si ya hay uno).
 */
export async function nuevoDocumento(carpetaId = ajustes().carpeta) {
  const ahora = Date.now();
  const carpeta = carpetaId ? (await listarCarpetas()).find(c => c.id === carpetaId) : null;
  let nombre = nombrePorDefecto();
  if (carpeta) {
    const base = `${carpeta.nombre} – ${fechaDeClase()}`;
    const usados = new Set((await listarDocumentos()).map(d => d.nombre));
    nombre = base;
    for (let i = 2; usados.has(nombre); i++) nombre = `${base} (${i})`;
  }
  return guardarDocumento({ id: nuevoId(), nombre, creado: ahora, modificado: ahora, paginas: [], carpetaId: carpeta?.id || null });
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
/** ¿No queda ninguna foto armándose? (entonces se puede recargar la app sin perder nada) */
export const colaVacia = () => pendientes.size === 0;

/** Fotos de la galería o de un archivo: cada una se normaliza, se busca la hoja y se guarda */
export function importarArchivos(docId, archivos) {
  for (const archivo of archivos) encolar(docId, async () => crearPagina(await normalizarFoto(archivo)));
  return cadena;
}
