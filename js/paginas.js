// ScanLibre · paginas.js
// De la foto a la página guardada: buscar la hoja, enderezar, filtrar y guardar.
// Las fotos en ráfaga o importadas pasan por una cola, una por una, para no
// llenar la memoria del teléfono.

import { detectar, procesar, nitidez as medir, dividirLibro, luz, fotosEnWorker, fotoEnWorker, paginaEnWorker } from './motor.js';
import { ladoFoto, ladoPagina, ladoVista, anotarDemora } from './rendimiento.js';
import { UMBRAL_BORROSA } from './imagen/nitidez.js';
import { abrirFoto, aCanvas, aImageData, canvasABlob, imageDataABlob, normalizarFoto, soltarCanvas } from './fotos.js';
import { agregarPagina, guardarDocumento, guardarPagina, obtenerDocumento, obtenerPagina, listarCarpetas, listarDocumentos, insertarPaginaDespues } from './db.js';
import { nuevoId, nombrePorDefecto, fechaDeClase } from './util.js';
import { ajustes } from './ajustes.js';
import { dibujarMarcas, girarMarcas } from './marcas.js';
import { hojaDeCedula } from './cedula.js';
import { esPDF, abrirPDF } from './importar.js';
import { dibujarPortada } from './portada.js';
import { huella, esRepetida } from './imagen/repetidas.js';

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

/**
 * La foto (de la cámara o de la galería) lista para usar: orientada, sin
 * pasar de ladoFoto() y en JPEG, con una vista chica para el recorte y la
 * miniatura. Si se puede, todo se hace en el worker: la página no se traba.
 * @param hoja    buscar las esquinas de la hoja
 * @param nitidez medir si la hoja salió borrosa
 * @returns { blob, ancho, alto, anchoOriginal, altoOriginal, vista, esquinas, borrosa, ms }
 *   (la vista es un ImageBitmap o un canvas: soltarla con soltarVista cuando ya no se use)
 */
export async function prepararFoto(archivo, { hoja = true, nitidez = false } = {}) {
  const inicio = performance.now();
  let foto;
  if (await fotosEnWorker()) {
    try { foto = await fotoEnWorker(archivo, { maxLado: ladoFoto(), vista: ladoVista(), hoja, nitidez }); } catch (e) { console.warn('Foto en la página:', e); }
  }
  if (!foto) {
    // Sin OffscreenCanvas en el worker: como antes, aquí en la página
    const f = await normalizarFoto(archivo, ladoFoto());
    let esquinas = null, borrosa = false;
    if (hoja) esquinas = await buscarHoja(f.canvas);
    if (nitidez) { try { borrosa = await fotoBorrosa(f.canvas, esquinas || TODA_LA_FOTO); } catch (e) {} }
    const vista = aCanvas(f.canvas, ladoVista());
    soltarCanvas(f.canvas);
    foto = { blob: f.blob, ancho: f.ancho, alto: f.alto, anchoOriginal: f.anchoOriginal, altoOriginal: f.altoOriginal, vista, esquinas, borrosa };
  }
  foto.ms = Math.round(performance.now() - inicio);
  anotarDemora(foto.ms);
  return foto;
}

/** Suelta la vista chica de una foto de prepararFoto */
export function soltarVista(foto) {
  const v = foto?.vista;
  if (!v) return;
  if (v.close) v.close(); else soltarCanvas(v);
  foto.vista = null;
}

/**
 * Endereza y filtra la foto; devuelve los Blob de la página y de su miniatura.
 * @param fuente el archivo de la foto (Blob: se hace todo en el worker si se puede), o un canvas o bitmap
 */
async function renderizar(fuente, { esquinas, filtro, rotacion, aplanar = true, dedos = true, brillo = 0, contraste = 0, marcas = null, maxLado = ladoPagina() }) {
  const opciones = { esquinas, filtro, rotacion, aplanar, dedos, brillo, contraste, maxLado };
  if (fuente instanceof Blob) {
    let r = null;
    if (await fotosEnWorker()) {
      try { r = await paginaEnWorker(fuente, opciones, { png: filtro === 'bn' }); }
      catch (e) { console.warn('Página en la página:', e); }
    }
    if (r) {
      // La miniatura con las marcas encima (la página guardada va sin ellas)
      if (marcas?.length) {
        const bmp = await abrirFoto(r.miniatura);
        const c = aCanvas(bmp, 360);
        bmp.close?.();
        dibujarMarcas(c.getContext('2d'), marcas, c.width, c.height);
        r.miniatura = await canvasABlob(c, 'image/jpeg', 0.8);
        soltarCanvas(c);
      }
      return r;
    }
    const bmp = await abrirFoto(fuente);
    try { return await renderizar(bmp, { ...opciones, marcas }); } finally { bmp.close?.(); }
  }
  const { imagen: res, nitidez, aplanada, sinDedos } = await procesar(aImageData(fuente), opciones);
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
 * Página nueva a partir de una foto de prepararFoto ({ blob, ancho, alto, vista, esquinas }).
 * Se arma desde el archivo de la foto (en el worker si se puede); la vista no se suelta aquí.
 */
export async function crearPagina(foto, esquinas, { filtro = ajustes().filtro } = {}) {
  const esq = esquinas || foto.esquinas || (foto.vista && await buscarHoja(foto.vista)) || TODA_LA_FOTO;
  const r = await renderizar(foto.blob, { esquinas: esq, filtro, rotacion: 0 });
  return { id: nuevoId(), original: foto.blob, ancho: foto.ancho, alto: foto.alto, esquinas: esq, filtro, rotacion: 0, aplanar: true, dedos: true, creada: Date.now(), ...r };
}

/**
 * Cédula: la hoja con el frente y el reverso (o solo el frente) a tamaño
 * real, como una página más. No se endereza ni se buscan dedos: ya viene lista.
 * @param caras [{ blob, vertical }] de caraDeCedula
 */
export async function crearPaginaDeCedula(caras, tamano = ajustes().pdfTamano) {
  const hoja = await hojaDeCedula(caras, tamano === 'a4' ? 'a4' : 'carta');
  const datos = { esquinas: TODA_LA_FOTO, filtro: 'original', rotacion: 0, aplanar: false, dedos: false };
  // A tamaño real y nítida (como antes, hasta 3000 px), también en gama baja
  const r = await renderizar(hoja.canvas, { ...datos, maxLado: 3000 });
  soltarCanvas(hoja.canvas);
  // Casi toda la hoja es blanca: la nitidez no dice nada (cada cara se revisó al tomarla)
  return { id: nuevoId(), original: hoja.blob, ancho: hoja.ancho, alto: hoja.alto, ...datos, modo: 'cedula', creada: Date.now(), ...r, nitidez: null };
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
  const esq = esquinas || foto.esquinas || await buscarHoja(foto.vista) || TODA_LA_FOTO;
  // El lomo se busca en la vista (de 1600 a 2000 px): alcanza de sobra
  const mitades = await esquinasDeLibro(foto.vista, esq);
  if (!mitades) return [await crearPagina(foto, esq)];
  const izquierda = await crearPagina(foto, mitades[0]);
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
    const izquierda = { ...pagina, ...datos, esquinas: mitades[0], ...(await renderizar(pagina.original, { ...datos, esquinas: mitades[0] })), ocr: null };
    const derecha = { ...pagina, ...datos, id: nuevoId(), creada: Date.now(), esquinas: mitades[1], ...(await renderizar(pagina.original, { ...datos, esquinas: mitades[1] })), ocr: null };
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
  const r = await renderizar(pagina.original, datos);
  // El texto leído ya no corresponde a la página nueva
  const nueva = { ...pagina, ...datos, ...r, ocr: null };
  if (['cedula', 'pdf', 'portada'].includes(pagina.modo)) nueva.nitidez = null;
  // El texto que traía el PDF sigue valiendo si la página no cambió de forma (otro filtro o brillo)
  const mismaForma = ['esquinas', 'rotacion', 'aplanar', 'dedos'].every(k => JSON.stringify(datos[k]) === JSON.stringify(k === 'aplanar' || k === 'dedos' ? pagina[k] !== false : pagina[k]))
    && r.procAncho === pagina.procAncho && r.procAlto === pagina.procAlto;
  if (pagina.ocr?.idioma === 'pdf' && mismaForma) nueva.ocr = { ...pagina.ocr, version: versionDe(nueva) };
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
  const opciones = { esquinas: pagina.esquinas, filtro: 'original', rotacion: pagina.rotacion, aplanar: pagina.aplanar !== false, dedos: pagina.dedos !== false, maxLado };
  // En el worker, si se puede: abrir la foto completa aquí traba al teléfono
  if (await fotosEnWorker()) {
    const bmp = await abrirFoto((await paginaEnWorker(pagina.original, opciones)).procesada);
    try { return aImageData(bmp); } finally { bmp.close?.(); }
  }
  const bitmap = await abrirFoto(pagina.original);
  try {
    return (await procesar(aImageData(bitmap), opciones)).imagen;
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
  // El texto que traía el PDF vale para cualquier idioma: es el de verdad
  if (pagina.ocr && (pagina.ocr.idioma === idioma || pagina.ocr.idioma === 'pdf') && pagina.ocr.version === versionDe(pagina)) return pagina.ocr;
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
      for (const pagina of [await trabajo()].flat()) await agregarPaginaRevisada(docId, pagina);
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

// ── Páginas repetidas ───────────────────────────────────────────────
const huellas = new Map(); // id de la página → huella (se calcula una vez)
const huellaDe = async p => {
  if (huellas.has(p.id)) return huellas.get(p.id);
  const bmp = await abrirFoto(p.miniatura);
  const h = huella(aImageData(bmp));
  bmp.close?.();
  huellas.set(p.id, h);
  return h;
};
// Las portadas y las páginas de un PDF pueden repetirse a propósito
const comparable = p => p && !p.papelera && p.modo !== 'portada' && p.modo !== 'pdf' && !p.noRepetida;

/**
 * ¿La página es igual a una de las `anteriores` que tiene antes en el
 * documento? Si sí, queda marcada (`repetida` = la otra) y se avisa.
 * @returns el número de la página a la que se parece, o 0
 */
export async function revisarRepetida(docId, id, { anteriores = 3 } = {}) {
  const doc = await obtenerDocumento(docId);
  const i = doc?.paginas.indexOf(id) ?? -1;
  const pagina = i > 0 ? await obtenerPagina(id) : null;
  if (!comparable(pagina)) return 0;
  const h = await huellaDe(pagina);
  for (let k = i - 1; k >= Math.max(0, i - anteriores); k--) {
    const otra = await obtenerPagina(doc.paginas[k]);
    if (!comparable(otra) || !esRepetida(h, await huellaDe(otra))) continue;
    await guardarPagina({ ...(await obtenerPagina(id)), repetida: otra.id });
    avisar('repetida', { docId, id, n: i + 1, igualA: k + 1 });
    return k + 1;
  }
  return 0;
}

/** Agrega la página al final del documento y revisa si repite una de las anteriores */
export async function agregarPaginaRevisada(docId, pagina) {
  await agregarPagina(docId, pagina);
  try { await revisarRepetida(docId, pagina.id); } catch (e) { console.warn('Repetidas:', e); }
}

/** Busca páginas repetidas en todo el documento (cada una contra las 5 anteriores). @returns cuántas */
export async function buscarRepetidas(docId) {
  const doc = await obtenerDocumento(docId);
  let n = 0;
  for (const id of doc.paginas.slice(1)) {
    const p = await obtenerPagina(id);
    if (p?.repetida && doc.paginas.includes(p.repetida)) { n++; continue; }
    if (await revisarRepetida(docId, id, { anteriores: 5 })) n++;
  }
  return n;
}

/** La página no es repetida: se quita el aviso y no se vuelve a marcar */
export async function noEsRepetida(id) {
  const p = await obtenerPagina(id);
  if (p) await guardarPagina({ ...p, repetida: null, noRepetida: true });
}
/** ¿No queda ninguna foto armándose? (entonces se puede recargar la app sin perder nada) */
export const colaVacia = () => pendientes.size === 0;

/** Fotos de la galería o de un archivo: cada una se normaliza, se busca la hoja y se guarda */
export function importarArchivos(docId, archivos, { filtro, pedirClave } = {}) {
  for (const archivo of archivos) {
    if (esPDF(archivo)) importarPDF(docId, archivo, { pedirClave });
    else encolar(docId, async () => {
      const foto = await prepararFoto(archivo);
      try { return await crearPagina(foto, undefined, filtro ? { filtro } : {}); } finally { soltarVista(foto); }
    });
  }
  return cadena;
}

/**
 * Las páginas de un PDF, una por una por la cola. Mientras se abre el PDF, en
 * el documento se ve una página "procesando".
 * @returns cuántas páginas tiene (0 si no se abrió)
 */
export async function importarPDF(docId, archivo, { pedirClave } = {}) {
  let listo;
  const abriendo = new Promise(r => { listo = r; });
  encolar(docId, async () => { await abriendo; return []; }); // marca "procesando" mientras abre
  let pdf;
  try {
    pdf = await abrirPDF(archivo, { pedirClave });
  } catch (e) {
    listo();
    avisar('error', { docId, error: e, pdf: true });
    return 0;
  }
  if (!pdf) { listo(); return 0; }
  let hechas = 0;
  for (let n = 1; n <= pdf.paginas; n++) {
    encolar(docId, async () => {
      try {
        const { canvas, texto } = await pdf.pagina(n);
        try { return await crearPaginaDeImagen(canvas, texto, 'pdf'); } finally { soltarCanvas(canvas); }
      } finally {
        if (++hechas === pdf.paginas) pdf.cerrar();
      }
    });
  }
  listo();
  return pdf.paginas;
}

/**
 * La portada como página (con su texto buscable). Con `anterior`, la
 * reemplaza: mismo id, mismo lugar y sus marcas (por ejemplo, una firma).
 */
export async function paginaDePortada(campos, { tamano = ajustes().pdfTamano, anterior = null } = {}) {
  let logo = null;
  if (campos.logo) {
    logo = new Image();
    logo.src = campos.logo;
    try { await logo.decode(); } catch (e) { logo = null; }
  }
  const { canvas, texto } = dibujarPortada({ ...campos, logo }, tamano === 'a4' ? 'a4' : 'carta');
  let pagina;
  try { pagina = { ...(await crearPaginaDeImagen(canvas, texto, 'portada')), portada: campos }; } finally { soltarCanvas(canvas); }
  if (!anterior) return pagina;
  const nueva = { ...pagina, id: anterior.id, docId: anterior.docId, creada: anterior.creada, marcas: anterior.marcas || [] };
  nueva.ocr = { ...pagina.ocr, version: versionDe(nueva) };
  if (nueva.marcas.length) {
    const c = await lienzoConMarcas(nueva, 360);
    nueva.miniatura = await canvasABlob(c, 'image/jpeg', 0.8);
    soltarCanvas(c);
  }
  return nueva;
}

/**
 * Una página que ya viene lista (de un PDF): no se endereza, no se buscan
 * dedos y va con el filtro Original. Si trae texto, queda como texto leído.
 */
async function crearPaginaDeImagen(canvas, texto, modo) {
  const original = await canvasABlob(canvas, 'image/jpeg', 0.9);
  const datos = { esquinas: TODA_LA_FOTO, filtro: 'original', rotacion: 0, aplanar: false, dedos: false };
  const r = await renderizar(canvas, datos);
  const pagina = { id: nuevoId(), original, ancho: canvas.width, alto: canvas.height, ...datos, modo, creada: Date.now(), ...r, nitidez: null };
  if (texto?.lineas?.length) {
    pagina.ocr = { idioma: 'pdf', texto: texto.texto, lineas: texto.lineas, ancho: canvas.width, alto: canvas.height, version: versionDe(pagina) };
  }
  return pagina;
}
