// ScanLibre · paginas.js
// De la foto a la página guardada: buscar la hoja, enderezar, filtrar y guardar.
// Las fotos en ráfaga o importadas pasan por una cola, una por una, para no
// llenar la memoria del teléfono.

import { detectar, procesar, nitidez as medir, dividirLibro, luz } from './motor.js';
import { UMBRAL_BORROSA } from './imagen/nitidez.js';
import { abrirFoto, aCanvas, aImageData, canvasABlob, imageDataABlob, normalizarFoto, soltarCanvas } from './fotos.js';
import { agregarPagina, guardarDocumento, guardarPagina, obtenerDocumento, obtenerPagina, listarCarpetas, listarDocumentos, insertarPaginaDespues } from './db.js';
import { nuevoId, nombrePorDefecto, fechaDeClase } from './util.js';
import { ajustes } from './ajustes.js';
import { dibujarMarcas, girarMarcas } from './marcas.js';

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
async function renderizar(fuente, { esquinas, filtro, rotacion, aplanar = true, dedos = true, brillo = 0, contraste = 0, marcas = null }) {
  const { imagen: res, nitidez, aplanada, sinDedos } = await procesar(aImageData(fuente), { esquinas, filtro, rotacion, aplanar, dedos, brillo, contraste, maxLado: 3000 });
  // El blanco y negro se guarda en PNG: sin pérdida y liviano
  const procesada = await imageDataABlob(res, filtro === 'bn' ? 'image/png' : 'image/jpeg', 0.9);
  const lienzo = document.createElement('canvas');
  lienzo.width = res.width; lienzo.height = res.height;
  lienzo.getContext('2d').putImageData(res, 0, 0);
  const chico = aCanvas(lienzo, 360);
  soltarCanvas(lienzo);
  // La miniatura con las marcas encima (la página guardada va sin ellas)
  if (marcas?.length) dibujarMarcas(chico.getContext('2d'), marcas, chico.width, chico.height);
  const miniatura = await canvasABlob(chico, 'image/jpeg', 0.8);
  soltarCanvas(chico);
  return { procesada, procAncho: res.width, procAlto: res.height, miniatura, nitidez, aplanada, sinDedos };
}

/**
 * Página nueva a partir de una foto ya normalizada ({ blob, ancho, alto, canvas }).
 * Si todo sale bien, el canvas de la foto se suelta: ya no se necesita.
 */
export async function crearPagina(foto, esquinas, { soltar = true } = {}) {
  const filtro = ajustes().filtro;
  const esq = esquinas || await buscarHoja(foto.canvas) || TODA_LA_FOTO;
  const r = await renderizar(foto.canvas, { esquinas: esq, filtro, rotacion: 0 });
  if (soltar) soltarCanvas(foto.canvas);
  return { id: nuevoId(), original: foto.blob, ancho: foto.ancho, alto: foto.alto, esquinas: esq, filtro, rotacion: 0, aplanar: true, dedos: true, creada: Date.now(), ...r };
}

/** Las esquinas de las dos páginas de un libro abierto en la foto (canvas o bitmap), o null */
export async function esquinasDeLibro(fuente, esquinas) {
  return dividirLibro(aImageData(fuente, 2000), esquinas);
}

/**
 * Libro abierto: sus dos páginas (izquierda y derecha) de una sola foto. Si
 * no se encuentra el lomo, queda como una sola página.
 * @returns [página] o [izquierda, derecha]
 */
export async function crearPaginasDeLibro(foto, esquinas) {
  const esq = esquinas || await buscarHoja(foto.canvas) || TODA_LA_FOTO;
  const mitades = await esquinasDeLibro(foto.canvas, esq);
  if (!mitades) return [await crearPagina(foto, esq)];
  const izquierda = await crearPagina(foto, mitades[0], { soltar: false });
  return [izquierda, await crearPagina(foto, mitades[1])];
}

/**
 * Una página que es un libro abierto se separa en sus dos páginas: la de la
 * izquierda queda en su lugar y la de la derecha justo después.
 * @returns [izquierda, derecha], o null si no se encuentra el lomo
 */
export async function separarLibro(pagina) {
  const bitmap = await abrirFoto(pagina.original);
  try {
    const mitades = await esquinasDeLibro(bitmap, pagina.esquinas);
    if (!mitades) return null;
    // Las marcas no se reparten entre las dos páginas: se quitan (la vista lo avisa antes)
    const datos = { filtro: pagina.filtro, rotacion: 0, aplanar: pagina.aplanar !== false, dedos: pagina.dedos !== false, brillo: pagina.brillo || 0, contraste: pagina.contraste || 0, marcas: [] };
    const izquierda = { ...pagina, ...datos, esquinas: mitades[0], ...(await renderizar(bitmap, { ...datos, esquinas: mitades[0] })), ocr: null };
    const derecha = { ...pagina, ...datos, id: nuevoId(), creada: Date.now(), esquinas: mitades[1], ...(await renderizar(bitmap, { ...datos, esquinas: mitades[1] })), ocr: null };
    await guardarPagina(izquierda);
    await insertarPaginaDespues(pagina.docId, pagina.id, derecha);
    return [izquierda, derecha];
  } finally {
    bitmap.close?.();
  }
}

/** Vuelve a armar la página con otras esquinas, filtro, giro, aplanado o brillo, y la guarda */
export async function reprocesar(pagina, cambios) {
  const datos = { esquinas: pagina.esquinas, filtro: pagina.filtro, rotacion: pagina.rotacion, aplanar: pagina.aplanar !== false, dedos: pagina.dedos !== false, brillo: pagina.brillo || 0, contraste: pagina.contraste || 0, marcas: pagina.marcas || [], ...cambios };
  // Al girar la página, sus marcas giran con ella
  const vueltas = ((datos.rotacion - pagina.rotacion) % 4 + 4) % 4;
  if (vueltas && datos.marcas.length && !('marcas' in cambios)) datos.marcas = girarMarcas(datos.marcas, vueltas, pagina.procAncho, pagina.procAlto);
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

/** La página con sus marcas encima, en un canvas de lado máximo `maxLado` */
export async function lienzoConMarcas(pagina, maxLado = Infinity) {
  const bmp = await abrirFoto(pagina.procesada);
  const c = aCanvas(bmp, maxLado);
  bmp.close?.();
  if (pagina.marcas?.length) dibujarMarcas(c.getContext('2d'), pagina.marcas, c.width, c.height);
  return c;
}

/** Guarda las marcas de la página (y su miniatura con ellas) */
export async function guardarMarcas(pagina, marcas) {
  const actual = (await obtenerPagina(pagina.id)) || pagina;
  const nueva = { ...actual, marcas };
  const c = await lienzoConMarcas(nueva, 360);
  nueva.miniatura = await canvasABlob(c, 'image/jpeg', 0.8);
  soltarCanvas(c);
  await guardarPagina(nueva);
  const doc = await obtenerDocumento(actual.docId);
  if (doc) { doc.modificado = Date.now(); await guardarDocumento(doc); }
  return nueva;
}

/**
 * Para ver el brillo y el contraste mientras se mueven las barras: la página
 * enderezada y sin filtro, más chica (se arma una vez al abrir las barras).
 */
export async function baseParaLuz(pagina, maxLado = 1400) {
  const bitmap = await abrirFoto(pagina.original);
  try {
    const { imagen } = await procesar(aImageData(bitmap), {
      esquinas: pagina.esquinas, filtro: 'original', rotacion: pagina.rotacion, aplanar: pagina.aplanar !== false, dedos: pagina.dedos !== false, maxLado
    });
    return imagen;
  } finally {
    bitmap.close?.();
  }
}

/** Cómo queda la base con el filtro, el brillo y el contraste (la base no se toca) */
export const conLuz = (base, filtro, brillo, contraste) =>
  luz(new ImageData(new Uint8ClampedArray(base.data), base.width, base.height), { filtro, brillo, contraste });

/** Qué versión de la página es: si cambia (filtro, recorte, giro), el texto leído deja de servir */
// LECTOR sube cuando cambia cómo se lee (así los textos viejos se vuelven a leer)
const LECTOR = 3;
// (el brillo va solo si se cambió: así el texto ya leído de las páginas de antes sigue valiendo)
const versionDe = p => `l${LECTOR}|${p.filtro}|${p.rotacion}|${p.aplanar !== false}|${p.dedos !== false}|${p.procAncho}x${p.procAlto}|${JSON.stringify(p.esquinas)}` +
  (p.brillo || p.contraste ? `|luz${p.brillo || 0},${p.contraste || 0}` : '');

/** El texto ya leído de la página, si sigue siendo de esta versión de la página (si no, null) */
export const textoLeido = p => (p.ocr && p.ocr.version === versionDe(p) ? p.ocr.texto : null);

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

/** Agrega al documento, en orden, la página (o las páginas) que arme `trabajo()` */
export function encolar(docId, trabajo) {
  pendientes.set(docId, (pendientes.get(docId) || 0) + 1);
  avisar('cambio', { docId });
  cadena = cadena.then(async () => {
    try {
      for (const pagina of [await trabajo()].flat()) await agregarPagina(docId, pagina);
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
