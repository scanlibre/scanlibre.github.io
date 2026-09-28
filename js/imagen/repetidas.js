// ScanLibre · imagen/repetidas.js
// ¿Esta página ya estaba? (en ráfaga es fácil tomar la misma dos veces). La
// "huella" de una página es su imagen chica en gris, sin lo que es parejo a
// lo largo de cada renglón: así queda el dibujo que forman las palabras, que
// cambia de una página a otra aunque los renglones estén en el mismo lugar
// (dos páginas del mismo libro no se confunden). Dos huellas se comparan con
// la correlación, corriéndolas unos píxeles (la hoja no queda recortada
// exactamente igual en dos fotos).

export const ANCHO = 72, ALTO = 96;
const ENERGIA_MIN = 4;    // menos que esto es una página casi en blanco: no se compara
export const PARECIDO = 0.55; // desde aquí, es la misma página

/** @param img { data, width, height } (la miniatura de la página basta) */
export function huella(img) {
  const { data, width: W, height: H } = img;
  const suma = new Float32Array(ANCHO * ALTO), n = new Float32Array(ANCHO * ALTO);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(ALTO - 1, Math.floor(y * ALTO / H)) * ANCHO;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, j = fy + Math.min(ANCHO - 1, Math.floor(x * ANCHO / W));
      suma[j] += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; n[j]++;
    }
  }
  for (let j = 0; j < suma.length; j++) suma[j] /= n[j] || 1;
  // Lo que queda al quitar el promedio de alrededor a lo largo del renglón (±4 píxeles)
  const v = new Float32Array(ANCHO * ALTO), R = 4;
  for (let y = 0; y < ALTO; y++) for (let x = 0; x < ANCHO; x++) {
    let s = 0, c = 0;
    for (let d = -R; d <= R; d++) { const xx = x + d; if (xx >= 0 && xx < ANCHO) { s += suma[y * ANCHO + xx]; c++; } }
    v[y * ANCHO + x] = suma[y * ANCHO + x] - s / c;
  }
  // Sin el borde (donde quedan la orilla de la hoja o la mesa, que se parecen en todas las fotos)
  const bx = Math.round(ANCHO * 0.06), by = Math.round(ALTO * 0.05);
  for (let y = 0; y < ALTO; y++) for (let x = 0; x < ANCHO; x++) if (x < bx || x >= ANCHO - bx || y < by || y >= ALTO - by) v[y * ANCHO + x] = 0;
  let media = 0, var2 = 0;
  for (const x of v) media += x;
  media /= v.length;
  for (let j = 0; j < v.length; j++) { v[j] -= media; var2 += v[j] * v[j]; }
  const energia = Math.sqrt(var2 / v.length);
  // Los cambios muy fuertes (una sombra, un dibujo grande) no deciden solos: se recortan
  const tope = 2 * energia;
  for (let j = 0; j < v.length; j++) v[j] = Math.max(-tope, Math.min(tope, v[j]));
  return { v, energia, aspecto: W / H };
}

/**
 * Qué tan parecidas son dos páginas: de -1 a 1 (1 = iguales). 0 si una está
 * casi en blanco o si tienen otra forma.
 */
export function parecido(a, b, correr = 3) {
  if (!a || !b) return 0;
  if (Math.abs(a.aspecto - b.aspecto) / Math.max(a.aspecto, b.aspecto) > 0.12) return 0;
  if (a.energia < ENERGIA_MIN || b.energia < ENERGIA_MIN) return 0;
  let mejor = -1;
  for (let dy = -correr; dy <= correr; dy++) for (let dx = -correr; dx <= correr; dx++) {
    let ab = 0, aa = 0, bb = 0;
    const y0 = Math.max(0, -dy), y1 = Math.min(ALTO, ALTO - dy), x0 = Math.max(0, -dx), x1 = Math.min(ANCHO, ANCHO - dx);
    for (let y = y0; y < y1; y++) {
      let ia = y * ANCHO + x0, ib = (y + dy) * ANCHO + x0 + dx;
      for (let x = x0; x < x1; x++, ia++, ib++) { const p = a.v[ia], q = b.v[ib]; ab += p * q; aa += p * p; bb += q * q; }
    }
    const r = ab / Math.sqrt(aa * bb || 1);
    if (r > mejor) mejor = r;
  }
  return mejor;
}

export const esRepetida = (a, b) => parecido(a, b) >= PARECIDO;
