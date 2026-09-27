// ScanLibre · exportar.js
// Arma el PDF del documento con la calidad elegida y lo comparte o descarga.

import { crearPDF, crearPDFConContrasena, aBits } from './pdf.js';
import { abrirFoto, aCanvas, canvasABlob } from './fotos.js';

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

/**
 * @param conTexto  si las páginas traen `ocr`, el PDF lleva el texto invisible encima (se puede buscar)
 * @param alAvanzar (hechas, total) para mostrar el avance
 * @returns Blob del PDF
 */
export async function generarPDF(doc, paginas, { tamano = 'carta', calidad = 'normal', conTexto = false, contrasena = '' } = {}, alAvanzar) {
  const cfg = CALIDADES[calidad] || CALIDADES.normal;
  const partes = [];
  for (let i = 0; i < paginas.length; i++) {
    alAvanzar?.(i, paginas.length);
    const p = paginas[i];
    const bmp = await abrirFoto(p.procesada);
    const c = aCanvas(bmp, cfg.maxLado);
    bmp.close?.();
    if (p.filtro === 'bn' && typeof CompressionStream !== 'undefined') {
      const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      partes.push({ tipo: 'bits', bytes: await comprimir(aBits(img)), ancho: c.width, alto: c.height });
    } else {
      const b = await canvasABlob(c, 'image/jpeg', cfg.jpeg);
      partes.push({ tipo: 'jpeg', bytes: new Uint8Array(await b.arrayBuffer()) });
    }
    if (conTexto && p.ocr?.lineas?.length) partes[partes.length - 1].texto = p.ocr;
    c.width = c.height = 0; // soltar la memoria del canvas ya
  }
  alAvanzar?.(paginas.length, paginas.length);
  const opciones = { tamano, titulo: doc.nombre };
  const bytes = contrasena ? await crearPDFConContrasena(partes, opciones, contrasena) : crearPDF(partes, opciones);
  return new Blob([bytes], { type: 'application/pdf' });
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
