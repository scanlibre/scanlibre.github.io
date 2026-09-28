// ScanLibre · imagen/nitidez.js
// ¿La foto salió borrosa? Se mide qué tan angostos son los bordes de las
// letras: en un borde nítido el brillo cambia de golpe (gradiente alto para su
// contraste); en uno borroso cambia de a poco. Como se divide por el contraste
// de la zona, no depende de la luz ni del filtro. Se mide a 800 px de ancho,
// en el centro de cada borde.
// Calibrado con fotos reales de teléfono: nítidas 0,27-0,42; desenfocadas
// 0,21-0,24 (una nítida desenfocada a propósito baja de 0,25 desde un radio de 2 px).

export const UMBRAL_BORROSA = 0.25;
const ANCHO = 800, CONTRASTE_MIN = 40, RADIO = 3; // ventana de 7×7

/** Gris a ANCHO px de ancho (promedio por áreas) */
function grisChico({ data, width: w, height: h }) {
  const k = Math.min(1, ANCHO / w);
  const cw = Math.max(8, Math.round(w * k)), ch = Math.max(8, Math.round(h * k));
  const suma = new Float32Array(cw * ch), cuenta = new Uint16Array(cw * ch);
  for (let y = 0; y < h; y++) {
    const cy = Math.min(ch - 1, (y * k) | 0);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, j = cy * cw + Math.min(cw - 1, (x * k) | 0);
      suma[j] += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      cuenta[j]++;
    }
  }
  for (let j = 0; j < suma.length; j++) suma[j] /= cuenta[j] || 1;
  return { g: suma, w: cw, h: ch };
}

/** Máximo o mínimo en una ventana cuadrada, por filas y luego por columnas */
function extremo(g, w, h, esMax) {
  const t = new Float32Array(w * h), out = new Float32Array(w * h);
  const mejor = esMax ? Math.max : Math.min;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = g[y * w + x];
    for (let d = -RADIO; d <= RADIO; d++) { const xx = x + d; if (xx >= 0 && xx < w) v = mejor(v, g[y * w + xx]); }
    t[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = t[y * w + x];
    for (let d = -RADIO; d <= RADIO; d++) { const yy = y + d; if (yy >= 0 && yy < h) v = mejor(v, t[yy * w + x]); }
    out[y * w + x] = v;
  }
  return out;
}

/**
 * @returns { valor, borrosa } — valor null si casi no hay bordes (una hoja en
 *          blanco): en ese caso no se puede saber y no se avisa
 */
export function medirNitidez(img) {
  const { g, w, h } = grisChico(img);
  const max = extremo(g, w, h, true), min = extremo(g, w, h, false);
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    gx[i] = (g[i + 1] - g[i - 1]) / 2; gy[i] = (g[i + w] - g[i - w]) / 2;
    mag[i] = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
  }
  // Solo el centro de cada borde (máximo del gradiente a lo ancho del borde):
  // ahí gradiente/contraste ≈ 0,4 / ancho del borde
  const BINS = 1000, hist = new Uint32Array(BINS);
  let n = 0;
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x, cont = max[i] - min[i];
    if (cont < CONTRASTE_MIN) continue;
    const m = mag[i], ax = Math.abs(gx[i]), ay = Math.abs(gy[i]);
    // Sin cambio de brillo no hay borde (en una imagen digital limpia, el papel es parejo del todo)
    if (m < 0.05 * cont) continue;
    const paso = ay <= ax * 0.4142 ? 1 : ay >= ax * 2.4142 ? w : gx[i] * gy[i] > 0 ? w + 1 : w - 1;
    if (m < mag[i - paso] || m < mag[i + paso]) continue;
    hist[Math.min(BINS - 1, (m / cont * BINS) | 0)]++;
    n++;
  }
  if (n < 200) return { valor: null, borrosa: false };
  let acum = 0, i = 0;
  for (; i < BINS; i++) { acum += hist[i]; if (acum >= n / 2) break; }
  const valor = (i + 0.5) / BINS;
  return { valor, borrosa: valor < UMBRAL_BORROSA };
}
