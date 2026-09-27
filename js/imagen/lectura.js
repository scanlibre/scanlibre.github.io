// ScanLibre · imagen/lectura.js
// Prepara una página para el lector de texto (OCR). Tesseract lee mejor letra
// oscura sobre un blanco parejo y con bordes firmes. En una foto de teléfono
// la letra de un libro queda chica y un poco suave: aquí se empareja el papel,
// se estira el contraste (como el filtro Gris) y se le da nitidez. La página
// guardada no cambia: esto es solo para leer.
// Con la contratapa de un libro fotografiada con un Samsung, el lector pasó de
// 20 palabras (solo los títulos) a 147 (también las dos columnas de letra
// chica); en un índice de libro y una tabla, igual o mejor. Agrandar la
// página no ayudó: lo que sirve es la nitidez.

import { aplicarFiltro } from './filtros.js';

const CANTIDAD = 1.5, UMBRAL = 2; // cuánto se refuerzan los bordes, y desde qué diferencia

/** Suavizado de caja de 3×3, por filas y luego por columnas (en el lugar) */
function caja(v, w, h) {
  const t = new Float32Array(Math.max(w, h));
  const pasar = (inicio, paso, n) => {
    for (let i = 0; i < n; i++) {
      t[i] = (v[inicio + Math.max(0, i - 1) * paso] + v[inicio + i * paso] + v[inicio + Math.min(n - 1, i + 1) * paso]) / 3;
    }
    for (let i = 0; i < n; i++) v[inicio + i * paso] = t[i];
  };
  for (let y = 0; y < h; y++) pasar(y * w, 1, w);
  for (let x = 0; x < w; x++) pasar(x, w, h);
}

/**
 * @param img  ImageData (RGBA) de la página
 * @returns    ImageData en gris, del mismo tamaño
 */
export function prepararParaLeer(img) {
  const { width: w, height: h } = img;
  const gris = aplicarFiltro(img, 'gris').data;
  const G = new Float32Array(w * h);
  for (let i = 0; i < G.length; i++) G[i] = gris[i * 4];
  // Nitidez (máscara de enfoque): a cada punto se le suma su diferencia con
  // una versión suave. Dos pasadas de caja ≈ una gaussiana chica
  const suave = G.slice();
  caja(suave, w, h); caja(suave, w, h);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < G.length; i++, j += 4) {
    const d = G[i] - suave[i];
    data[j] = data[j + 1] = data[j + 2] = Math.abs(d) > UMBRAL ? G[i] + CANTIDAD * d : G[i];
    data[j + 3] = 255;
  }
  return { data, width: w, height: h };
}
