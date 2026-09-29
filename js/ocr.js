// ScanLibre · ocr.js
// Lector de texto (OCR) con Tesseract.js. Todo va dentro de la app
// (vendor/tesseract): nada se sube a internet. Se carga la primera vez que se
// usa y el lector se cierra solo después de un minuto sin uso (ocupa memoria).
// Antes de leer, la página se prepara (imagen/lectura.js): papel parejo, más
// contraste y nitidez. Así lee también la letra chica de un libro.

import { abrirFoto, aImageData, soltarCanvas } from './fotos.js';
import { paraLeer, fotosEnWorker, paraLeerEnWorker } from './motor.js';

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;

export const IDIOMAS = {
  spa: 'Español',
  eng: 'Inglés',
  'spa+eng': 'Los dos'
};

/** Megas que se bajan la primera vez con cada idioma (núcleo + idioma) */
export const PRIMERA_DESCARGA = { spa: 6, eng: 7, 'spa+eng': 9 };

let libreria = null, trabajador = null, idiomaActual = null, reloj = null, avance = null;

function cargarLibreria() {
  if (window.Tesseract) return Promise.resolve();
  if (!libreria) {
    libreria = new Promise((resolver, rechazar) => {
      const s = document.createElement('script');
      s.src = BASE + 'tesseract.min.js';
      s.onload = resolver;
      s.onerror = () => { libreria = null; s.remove(); rechazar(new Error('No se pudo cargar el lector de texto. Revisa tu conexión la primera vez.')); };
      document.head.append(s);
    });
  }
  return libreria;
}

async function obtenerTrabajador(idioma) {
  if (trabajador && idiomaActual === idioma) return trabajador;
  if (trabajador) { await trabajador.terminate(); trabajador = null; }
  await cargarLibreria();
  trabajador = await window.Tesseract.createWorker(idioma, 1 /* solo LSTM */, {
    workerPath: BASE + 'worker.min.js',
    corePath: BASE + 'core',
    langPath: BASE + 'idiomas',
    workerBlobURL: false,  // el worker se abre desde el mismo sitio (lo permite la política de seguridad)
    cacheMethod: 'none',   // el service worker ya guarda los idiomas: no hace falta otra copia
    logger: m => avance?.(m)
  });
  idiomaActual = idioma;
  return trabajador;
}

function cerrarLuego() {
  clearTimeout(reloj);
  reloj = setTimeout(() => {
    trabajador?.terminate();
    trabajador = null;
    idiomaActual = null;
  }, 60000);
}

/**
 * La página lista para leer. Si se puede, se arma en el worker y llega en PNG
 * (en el iPhone, armarla aquí y pasarla por un canvas trababa la pantalla
 * varios segundos); si no, en un canvas aquí.
 */
async function prepararImagen(blob) {
  if (await fotosEnWorker()) {
    try { return await paraLeerEnWorker(blob); } catch (e) { console.warn('Lectura en la página:', e); }
  }
  const foto = await abrirFoto(blob);
  const img = aImageData(foto);
  foto.close?.();
  const lista = await paraLeer(img);
  const lienzo = document.createElement('canvas');
  lienzo.width = lista.width; lienzo.height = lista.height;
  lienzo.getContext('2d').putImageData(lista, 0, 0);
  return lienzo;
}

/**
 * Lee el texto de una imagen (Blob).
 * @param alAvanzar ({ etapa, progreso }) con etapa 'preparando' | 'leyendo' y progreso 0..1
 * @returns { idioma, texto, lineas: [{ y0, y1, base: [x0, y0, x1, y1], palabras: [{ t, x0, y0, x1, y1 }] }] }
 *          con las posiciones en píxeles de la imagen
 */
export async function leerTexto(imagen, { idioma = 'spa', alAvanzar } = {}) {
  clearTimeout(reloj);
  avance = m => alAvanzar?.({ etapa: m.status === 'recognizing text' ? 'leyendo' : 'preparando', progreso: m.progress || 0 });
  try {
    const t = await obtenerTrabajador(idioma);
    const lienzo = await prepararImagen(imagen);
    try {
      const { data } = await t.recognize(lienzo, {}, { blocks: true });
      return resultado(data, idioma);
    } finally {
      soltarCanvas(lienzo);
    }
  } finally {
    avance = null;
    cerrarLuego();
  }
}

/**
 * El lector también "lee" rayas, bordes, dibujos y renglones doblados (en la
 * curva de un libro). Esa basura se reconoce por su poca confianza: en seis
 * páginas reales, las palabras de verdad tenían confianza 95 (mediana) y la
 * basura 53. Con estas reglas se va un tercio de la basura y se queda el 95 %
 * de las palabras de verdad (quitar todo lo de poca confianza borraba 4 de
 * cada 10 palabras buenas).
 */
export const esTexto = t => /[\p{L}\p{N}]/u.test(t);
const letras = t => (t.match(/[\p{L}\p{N}]/gu) || []).length;
/** Una palabra "bien armada" (letras, minúsculas o solo la primera mayúscula): aunque el lector dude, casi siempre es real */
const bienArmada = t => /^[¿¡("“«]?\p{Lu}?\p{Ll}{4,}[.,;:)?!"”»-]?$/u.test(t);
const confianza = x => x.confidence ?? 100;

function palabrasConfiables(linea) {
  const ws = linea.words.filter(p => esTexto(p.text) && (confianza(p) >= 25 || (confianza(p) >= 10 && bienArmada(p.text.trim()))));
  // Pedacitos dudosos en las puntas del renglón (ahí es donde el renglón se dobla o llega el borde)
  while (ws.length && letras(ws.at(-1).text) <= 3 && confianza(ws.at(-1)) < 75) ws.pop();
  while (ws.length && letras(ws[0].text) <= 2 && confianza(ws[0]) < 50) ws.shift();
  return ws;
}

/** Une los renglones de un párrafo; "instalacio-" + "nes" queda "instalaciones" */
function unirRenglones(renglones) {
  let texto = '';
  for (const r of renglones) {
    if (/\p{L}[-‐]$/u.test(texto) && /^\p{Ll}/u.test(r)) texto = texto.slice(0, -1) + r;
    else texto += (texto ? '\n' : '') + r;
  }
  return texto;
}

/** Texto y renglones sin la basura, con las posiciones en píxeles de la página */
export function resultado(data, idioma) {
  const lineas = [], parrafos = [];
  for (const bloque of data.blocks || []) for (const parrafo of bloque.paragraphs) {
    const renglones = [];
    for (const linea of parrafo.lines) {
      if (confianza(linea) < 30) continue; // renglón casi todo basura
      const palabras = palabrasConfiables(linea)
        .map(p => ({ t: p.text.trim(), x0: p.bbox.x0, y0: p.bbox.y0, x1: p.bbox.x1, y1: p.bbox.y1 }));
      if (!palabras.length) continue;
      const b = linea.baseline;
      lineas.push({ y0: linea.bbox.y0, y1: linea.bbox.y1, base: b ? [b.x0, b.y0, b.x1, b.y1] : null, palabras });
      renglones.push(palabras.map(p => p.t).join(' '));
    }
    if (renglones.length) parrafos.push(unirRenglones(renglones));
  }
  return { idioma, texto: parrafos.join('\n\n'), lineas };
}
