// ScanLibre · imagen/movimiento.js
// ¿El teléfono está quieto? Se compara cada cuadro del video con el anterior,
// en chiquito (40 px de ancho). Se descuenta el cambio de brillo general (la
// cámara ajusta la exposición sola), así solo cuenta lo que se movió.
// Medido en un video real de un Samsung, cada 130 ms: con la mano quieta
// 2-3 (a veces 5); acomodando la hoja, 14; moviendo el teléfono, 28 o más;
// el golpe de tocar el botón, 35-45.

export const MOV_QUIETO = 3.5;

const ANCHO = 40;

/** Gris de 40 px de ancho (promedio por bloques) */
export function miniGris({ data, width: w, height: h }) {
  const cw = ANCHO, ch = Math.max(1, Math.round(h * cw / w));
  const suma = new Float32Array(cw * ch), cuenta = new Float32Array(cw * ch);
  for (let y = 0; y < h; y += 2) {
    const fy = Math.min(ch - 1, (y * ch / h) | 0) * cw;
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4, j = fy + Math.min(cw - 1, (x * cw / w) | 0);
      suma[j] += data[i] + 2 * data[i + 1] + data[i + 2];
      cuenta[j] += 4;
    }
  }
  for (let j = 0; j < suma.length; j++) suma[j] /= cuenta[j] || 1;
  return suma;
}

/**
 * Diferencia media entre dos cuadros chiquitos, sin el cambio de brillo
 * general (la exposición multiplica todo el cuadro por un mismo factor)
 */
export function diferenciaMedia(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) { sa += a[i]; sb += b[i]; }
  const k = sb > 0 ? sa / sb : 1;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i] * k);
  return s / a.length;
}
