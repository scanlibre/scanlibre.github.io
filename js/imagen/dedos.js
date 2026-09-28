// ScanLibre · imagen/dedos.js
// Quita los dedos que sostienen la hoja (sobre todo en libros): lo que tiene
// color de piel, está pegado a un borde de la hoja y tiene forma de dedo se
// tapa con el color del papel de alrededor.
// Seguros para no borrar lo que no es un dedo:
//  · color de piel en YCbCr (Chai y Ngan) y por tono: rojizo (la piel anda
//    por los 10-30°, una hoja amarillenta por los 40°), con algo de color, de
//    piel clara a morena y también en sombra (la regla de Kovač solo acepta
//    piel clara y bien iluminada);
//  · más oscuro que el papel (la piel refleja menos luz que una hoja) y más
//    rojo que el tinte del propio papel: así una hoja vieja, beige o con
//    sombra no cuenta;
//  · pegado al borde: un dibujo o unas letras rojas en medio de la página no se tocan;
//  · tamaño y forma de dedo: una mancha llena, ni diminuta ni enorme.

const ANCHO = 400;

const crDe = (r, g, b) => 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

/** @param papel { y, cr } brillo y rojez del papel de esta hoja */
function esPiel(r, g, b, papel) {
  if (!(r > g && g >= b && r - b > 12)) return false;
  const max = r, min = b, sat = (max - min) / max;
  const tono = 60 * (g - b) / (max - min); // en grados: 0 rojo, 60 amarillo
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = crDe(r, g, b);
  return sat >= 0.15 && sat <= 0.8 && tono >= 3 && tono <= 40 && y >= 30 && y < papel.y * 0.88 &&
    cb >= 77 && cb <= 127 && cr >= 133 && cr <= 180 && cr - papel.cr >= 10;
}

/** Imagen chica (promedio por áreas), para buscar con calma */
function reducir(img) {
  const k = Math.min(1, ANCHO / img.width);
  const w = Math.max(8, Math.round(img.width * k)), h = Math.max(8, Math.round(img.height * k));
  const suma = new Float32Array(w * h * 3), cuenta = new Float32Array(w * h);
  const { data, width: W, height: H } = img;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, (y * k) | 0) * w;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, j = fy + Math.min(w - 1, (x * k) | 0);
      suma[j * 3] += data[i]; suma[j * 3 + 1] += data[i + 1]; suma[j * 3 + 2] += data[i + 2]; cuenta[j]++;
    }
  }
  for (let j = 0; j < w * h; j++) { const n = cuenta[j] || 1; suma[j * 3] /= n; suma[j * 3 + 1] /= n; suma[j * 3 + 2] /= n; }
  return { rgb: suma, w, h, k };
}

/** Promedio en una ventana de radio r (por filas y por columnas) */
function difuminar(v, w, h, r) {
  const t = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += v[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { t[y * w + x] = s / (2 * r + 1); s += v[y * w + Math.min(w - 1, x + r + 1)] - v[y * w + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += t[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s / (2 * r + 1); s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; }
  }
  return out;
}

/**
 * Busca los dedos.
 * @returns null si no hay, o { mascara (0..1, suave), papel (color de fondo por zonas), w, h, k }
 */
export function buscarDedos(img) {
  const { rgb, w, h, k } = reducir(img);
  const n = w * h;
  // Brillo del papel: el de las zonas claras de la hoja
  const ys = new Float32Array(n);
  for (let j = 0; j < n; j++) ys[j] = 0.299 * rgb[j * 3] + 0.587 * rgb[j * 3 + 1] + 0.114 * rgb[j * 3 + 2];
  const papel = [...ys].sort((a, b) => a - b)[Math.floor(n * 0.9)];
  // El tinte del papel (blanco, amarillento…): el de sus puntos más claros
  let crPapel = 0, cuantos = 0;
  for (let j = 0; j < n; j++) if (ys[j] >= papel * 0.97) { crPapel += crDe(rgb[j * 3], rgb[j * 3 + 1], rgb[j * 3 + 2]); cuantos++; }
  const tinte = { y: papel, cr: cuantos ? crPapel / cuantos : 128 };
  const piel = new Uint8Array(n);
  for (let j = 0; j < n; j++) piel[j] = esPiel(rgb[j * 3], rgb[j * 3 + 1], rgb[j * 3 + 2], tinte) ? 1 : 0;

  // Manchas de piel (vecinos de 4 lados); se quedan las que tienen forma de dedo en un borde
  const grupo = new Int32Array(n).fill(-1), dedo = new Uint8Array(n);
  const cola = new Int32Array(n);
  let hay = false;
  for (let inicio = 0; inicio < n; inicio++) {
    if (!piel[inicio] || grupo[inicio] >= 0) continue;
    let largo = 0, x0 = w, x1 = 0, y0 = h, y1 = 0, borde = false;
    cola[largo++] = inicio; grupo[inicio] = inicio;
    for (let q = 0; q < largo; q++) {
      const j = cola[q], x = j % w, y = (j / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x <= 1 || y <= 1 || x >= w - 2 || y >= h - 2) borde = true;
      for (const v of [x > 0 && j - 1, x < w - 1 && j + 1, y > 0 && j - w, y < h - 1 && j + w]) {
        if (v !== false && piel[v] && grupo[v] < 0) { grupo[v] = inicio; cola[largo++] = v; }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const pareceDedo = borde && largo >= n * 0.001 && largo <= n * 0.12 && bw <= w * 0.6 && bh <= h * 0.6 && largo / (bw * bh) >= 0.25;
    if (pareceDedo) { hay = true; for (let q = 0; q < largo; q++) dedo[cola[q]] = 1; }
  }
  if (!hay) return null;

  // La sombra oscura y maciza pegada al dedo (entre los dedos, o el dedo muy en sombra) también
  // se tapa. Las letras son trazos finos: no llegan a ser "macizas" y no se tocan
  const oscuro = new Float32Array(n);
  for (let j = 0; j < n; j++) oscuro[j] = ys[j] < papel * 0.55 ? 1 : 0;
  const macizo = difuminar(oscuro, w, h, 3);
  let largo = 0;
  for (let j = 0; j < n; j++) if (dedo[j]) cola[largo++] = j;
  for (let q = 0; q < largo; q++) {
    const j = cola[q], x = j % w, y = (j / w) | 0;
    for (const v of [x > 0 && j - 1, x < w - 1 && j + 1, y > 0 && j - w, y < h - 1 && j + w]) {
      if (v !== false && !dedo[v] && macizo[v] > 0.85) { dedo[v] = 1; cola[largo++] = v; }
    }
  }

  // Un poco más grande (los bordes del dedo y su sombra) y con el borde suave
  const r = Math.max(2, Math.round(w * 0.012));
  const crecida = difuminar(dedo, w, h, r);
  const mascara = new Float32Array(n);
  for (let j = 0; j < n; j++) mascara[j] = crecida[j] > 0.02 ? 1 : 0;
  const suave = difuminar(mascara, w, h, Math.max(1, r >> 1));

  // Color del papel por zonas (sin el dedo), para taparlo con lo que hay alrededor
  const peso = new Float32Array(n), cr = new Float32Array(n), cg = new Float32Array(n), cbz = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const esPapel = !mascara[j] && ys[j] > papel * 0.8 ? 1 : 0;
    peso[j] = esPapel; cr[j] = rgb[j * 3] * esPapel; cg[j] = rgb[j * 3 + 1] * esPapel; cbz[j] = rgb[j * 3 + 2] * esPapel;
  }
  const radio = Math.round(w * 0.06);
  const [pw, pr, pg, pb] = [peso, cr, cg, cbz].map(v => difuminar(v, w, h, radio));
  const fondo = new Float32Array(n * 3);
  for (let j = 0; j < n; j++) {
    const p = pw[j];
    fondo[j * 3] = p > 0.01 ? pr[j] / p : papel; fondo[j * 3 + 1] = p > 0.01 ? pg[j] / p : papel; fondo[j * 3 + 2] = p > 0.01 ? pb[j] / p : papel;
  }
  return { mascara: suave, fondo, w, h, k };
}

/**
 * La página sin los dedos de los bordes.
 * @returns { imagen, quitados } — si no había, la misma imagen y quitados: false
 */
export function quitarDedos(img) {
  const d = buscarDedos(img);
  if (!d) return { imagen: img, quitados: false };
  const { mascara, fondo, w, h, k } = d;
  const { data, width: W, height: H } = img;
  const out = new Uint8ClampedArray(data);
  for (let Y = 0; Y < H; Y++) {
    const y = Math.min(h - 1, (Y * k) | 0);
    for (let X = 0; X < W; X++) {
      const j = y * w + Math.min(w - 1, (X * k) | 0), a = mascara[j];
      if (a <= 0) continue;
      const i = (Y * W + X) * 4;
      out[i] = data[i] + (fondo[j * 3] - data[i]) * a;
      out[i + 1] = data[i + 1] + (fondo[j * 3 + 1] - data[i + 1]) * a;
      out[i + 2] = data[i + 2] + (fondo[j * 3 + 2] - data[i + 2]) * a;
    }
  }
  return { imagen: { data: out, width: W, height: H }, quitados: true };
}
