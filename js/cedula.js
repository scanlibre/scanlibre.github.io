// ScanLibre · cedula.js
// Modo cédula: el frente y el reverso de una cédula, un carné o una tarjeta
// en una sola hoja carta o A4, a tamaño real (85,6 × 54 mm, la medida
// ID-1 de las tarjetas), como la fotocopia que piden en los trámites. Al
// imprimir el PDF "a tamaño real" (100 %), la cédula mide lo mismo que la de verdad.

import { procesar } from './motor.js';
import { aImageData, abrirFoto, canvasABlob, soltarCanvas } from './fotos.js';

export const ID1 = { ancho: 85.6, alto: 53.98 };           // mm
export const HOJAS = { carta: [215.9, 279.4], a4: [210, 297] }; // mm
export const PPP = 300 / 25.4;                               // 300 puntos por pulgada, en px por mm
const MARGEN = 25, ENTRE = 15;                               // mm

/**
 * Dónde va cada cara en la hoja (px a 300 ppp): centradas, una debajo de la otra.
 * @param caras [{ vertical }] (una cédula vertical va parada)
 */
export function disposicion(tamano, caras) {
  const [pw, ph] = HOJAS[tamano] || HOJAS.carta;
  const W = Math.round(pw * PPP), H = Math.round(ph * PPP);
  let y = Math.round(MARGEN * PPP);
  const lugares = caras.map(c => {
    const w = Math.round((c.vertical ? ID1.alto : ID1.ancho) * PPP);
    const h = Math.round((c.vertical ? ID1.ancho : ID1.alto) * PPP);
    const r = { x: Math.round((W - w) / 2), y, w, h };
    y += h + Math.round(ENTRE * PPP);
    return r;
  });
  return { W, H, lugares };
}

/**
 * Una cara, enderezada y a la proporción exacta de una tarjeta.
 * @param fuente   la foto (canvas o bitmap)
 * @returns { blob, vertical }
 */
export async function caraDeCedula(fuente, esquinas) {
  const { imagen } = await procesar(aImageData(fuente), { esquinas, filtro: 'original', rotacion: 0, aplanar: false, dedos: false, maxLado: 1600 });
  const vertical = imagen.height > imagen.width;
  const w = Math.round((vertical ? ID1.alto : ID1.ancho) * PPP), h = Math.round((vertical ? ID1.ancho : ID1.alto) * PPP);
  const plana = document.createElement('canvas');
  plana.width = imagen.width; plana.height = imagen.height;
  plana.getContext('2d').putImageData(imagen, 0, 0);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(plana, 0, 0, w, h);
  soltarCanvas(plana);
  try { return { blob: await canvasABlob(c, 'image/jpeg', 0.92), vertical }; } finally { soltarCanvas(c); }
}

/**
 * La hoja con las caras (una o dos), con una raya gris fina alrededor de
 * cada una para recortarlas.
 * @returns { canvas, blob, ancho, alto }
 */
export async function hojaDeCedula(caras, tamano = 'carta') {
  const { W, H, lugares } = disposicion(tamano, caras);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high';
  for (let i = 0; i < caras.length; i++) {
    const bmp = await abrirFoto(caras[i].blob), r = lugares[i];
    ctx.drawImage(bmp, r.x, r.y, r.w, r.h);
    bmp.close?.();
    ctx.strokeStyle = '#c4c4c4';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
  }
  return { canvas: c, blob: await canvasABlob(c, 'image/jpeg', 0.92), ancho: W, alto: H };
}
