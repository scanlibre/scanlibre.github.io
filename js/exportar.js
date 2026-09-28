// ScanLibre · exportar.js
// Arma el PDF del documento con la calidad elegida y lo comparte o descarga.

import { crearPDF, crearPDFConContrasena, aBits } from './pdf.js';
import { abrirFoto, aCanvas, canvasABlob } from './fotos.js';
import { dibujarMarcas, dibujarMarcaDeAgua } from './marcas.js';

export const CALIDADES = {
  liviana: { texto: 'Liviana', detalle: 'Para subir a plataformas', maxLado: 1650, jpeg: 0.62 },
  normal: { texto: 'Normal', detalle: 'Buena para leer e imprimir', maxLado: 2200, jpeg: 0.78 },
  alta: { texto: 'Alta', detalle: 'Máxima nitidez, pesa más', maxLado: 3000, jpeg: 0.9 }
};

export const TAMANOS_HOJA = {
  carta: 'Carta',
  a4: 'A4',
  foto: 'Como la foto'
};

async function comprimir(bytes) {
  const flujo = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/** Las páginas listas para el PDF (imagen y texto) con esa resolución y calidad de JPEG */
async function partesDe(paginas, { maxLado, jpeg }, conTexto, alAvanzar, marcaDeAgua = '') {
  const partes = [];
  for (let i = 0; i < paginas.length; i++) {
    alAvanzar?.(i, paginas.length);
    const p = paginas[i];
    const bmp = await abrirFoto(p.procesada);
    const c = aCanvas(bmp, maxLado);
    bmp.close?.();
    // Resaltador, notas y firma encima de la página (con color: la página va en JPEG aunque sea B/N)
    const conMarcas = p.marcas?.length > 0 || !!marcaDeAgua;
    if (p.marcas?.length) dibujarMarcas(c.getContext('2d'), p.marcas, c.width, c.height);
    // La marca de agua va dentro de la imagen: no se puede quitar del PDF
    if (marcaDeAgua) dibujarMarcaDeAgua(c.getContext('2d'), marcaDeAgua, c.width, c.height);
    if (p.filtro === 'bn' && !conMarcas && typeof CompressionStream !== 'undefined') {
      const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      partes.push({ tipo: 'bits', bytes: await comprimir(aBits(img)), ancho: c.width, alto: c.height });
    } else {
      // Una portada es solo letras: siempre con buena calidad
      const b = await canvasABlob(c, 'image/jpeg', p.modo === 'portada' ? Math.max(jpeg, 0.9) : jpeg);
      partes.push({ tipo: 'jpeg', bytes: new Uint8Array(await b.arrayBuffer()) });
    }
    if (conTexto && p.ocr?.lineas?.length) partes[partes.length - 1].texto = p.ocr;
    c.width = c.height = 0; // soltar la memoria del canvas ya
  }
  alAvanzar?.(paginas.length, paginas.length);
  return partes;
}

const armarBytes = (partes, opciones, contrasena) => contrasena ? crearPDFConContrasena(partes, opciones, contrasena) : crearPDF(partes, opciones);

/**
 * @param conTexto  si las páginas traen `ocr`, el PDF lleva el texto invisible encima (se puede buscar)
 * @param porHoja   1, 2 o 4 páginas en cada hoja (para imprimir más barato)
 * @param alAvanzar (hechas, total) para mostrar el avance
 * @returns Blob del PDF
 */
export async function generarPDF(doc, paginas, { tamano = 'carta', calidad = 'normal', conTexto = false, contrasena = '', porHoja = 1, marcaDeAgua = '' } = {}, alAvanzar) {
  const partes = await partesDe(paginas, CALIDADES[calidad] || CALIDADES.normal, conTexto, alAvanzar, marcaDeAgua);
  const bytes = await armarBytes(partes, { tamano, titulo: doc.nombre, porHoja }, contrasena);
  return new Blob([bytes], { type: 'application/pdf' });
}

// De la mejor a la más liviana: resolución de la página y calidad del JPEG
export const ESCALONES = [
  { maxLado: 3000, jpeg: 0.9 }, { maxLado: 2200, jpeg: 0.78 }, { maxLado: 2000, jpeg: 0.7 }, { maxLado: 1800, jpeg: 0.62 },
  { maxLado: 1600, jpeg: 0.55 }, { maxLado: 1400, jpeg: 0.5 }, { maxLado: 1250, jpeg: 0.45 }, { maxLado: 1100, jpeg: 0.4 },
  { maxLado: 950, jpeg: 0.36 }, { maxLado: 800, jpeg: 0.32 }
];
// Cuánto pesa más o menos cada escalón comparado con el 1 (por los píxeles y por la calidad)
const PESO_CALIDAD = q => 0.28 + 0.9 * q * q;
const pesoRelativo = (a, b) => ((a.maxLado / b.maxLado) ** 2) * PESO_CALIDAD(a.jpeg) / PESO_CALIDAD(b.jpeg);

/**
 * El PDF con la mejor calidad que quepa en `limite` bytes (para las
 * plataformas que no aceptan archivos grandes). Se prueba un escalón, se mide
 * y se salta al que según la cuenta debería caber; si no, uno más abajo.
 * @param alAvanzar (hechas, total, { intento })
 * @returns { blob, escalon, excedido } (excedido: ni lo más liviano cupo)
 */
export async function generarPDFConLimite(doc, paginas, { limite, tamano = 'carta', conTexto = false, contrasena = '', porHoja = 1, marcaDeAgua = '' }, alAvanzar) {
  const opciones = { tamano, titulo: doc.nombre, porHoja };
  const meta = limite * 0.97; // un poco de aire (el cifrado y los datos suman unos bytes)
  let i = 1, intento = 0;
  const probar = async k => {
    intento++;
    const partes = await partesDe(paginas, ESCALONES[k], conTexto, (h, t) => alAvanzar?.(h, t, { intento }), marcaDeAgua);
    return { partes, peso: crearPDF(partes, opciones).length };
  };
  let r = await probar(i);
  // Si sobra mucho espacio, se prueba la mejor calidad
  if (r.peso * pesoRelativo(ESCALONES[0], ESCALONES[1]) <= meta) {
    const alta = await probar(0);
    if (alta.peso <= meta) { i = 0; r = alta; }
  }
  while (r.peso > meta && i < ESCALONES.length - 1) {
    // El escalón que según la cuenta debería caber (al menos uno más abajo)
    let j = i + 1;
    while (j < ESCALONES.length - 1 && r.peso * pesoRelativo(ESCALONES[j], ESCALONES[i]) > meta * 0.95) j++;
    i = j;
    r = await probar(i);
  }
  const bytes = await armarBytes(r.partes, opciones, contrasena);
  return { blob: new Blob([bytes], { type: 'application/pdf' }), escalon: ESCALONES[i], excedido: bytes.length > limite, intentos: intento };
}

export function puedeCompartir(blob, nombre) {
  try {
    return !!navigator.canShare?.({ files: [new File([blob], nombre, { type: blob.type })] });
  } catch (e) {
    return false;
  }
}

/** Abre el menú de compartir del teléfono (WhatsApp, Drive, Classroom...). Devuelve false si se canceló */
export async function compartir(blob, nombre) {
  try {
    await navigator.share({ files: [new File([blob], nombre, { type: blob.type })], title: nombre });
    return true;
  } catch (e) {
    if (e.name === 'AbortError') return false;
    throw e;
  }
}

export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
