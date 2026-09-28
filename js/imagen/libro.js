// ScanLibre · imagen/libro.js
// Modo libro: una foto del libro abierto se vuelve dos páginas. En el libro
// ya enderezado se busca el lomo: la franja del centro donde no hay letras
// (entre los márgenes de adentro de las dos páginas), y dentro de ella lo más
// oscuro (la sombra del doblez). Después se parten las cuatro esquinas de la
// foto en dos hojas, siguiendo la misma perspectiva: cada página queda como
// una página normal (se puede recortar, filtrar y enderezar).

import { aplicarFiltro } from './filtros.js';
import { homografia, aplicar } from './geometria.js';

const ANCHO = 800;

/** Luminancia sin corregir (para ver la sombra) y gris parejo (para ver las letras), a ANCHO px */
function medir(img) {
  const k = Math.min(1, ANCHO / img.width);
  const w = Math.max(8, Math.round(img.width * k)), h = Math.max(8, Math.round(img.height * k));
  const rgba = new Uint8ClampedArray(w * h * 4), cuenta = new Float32Array(w * h), suma = new Float32Array(w * h * 3);
  const { data, width: W, height: H } = img;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, (y * k) | 0) * w;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, j = fy + Math.min(w - 1, (x * k) | 0);
      suma[j * 3] += data[i]; suma[j * 3 + 1] += data[i + 1]; suma[j * 3 + 2] += data[i + 2]; cuenta[j]++;
    }
  }
  const lum = new Float32Array(w * h);
  for (let j = 0; j < w * h; j++) {
    const n = cuenta[j] || 1, r = suma[j * 3] / n, g = suma[j * 3 + 1] / n, b = suma[j * 3 + 2] / n;
    rgba[j * 4] = r; rgba[j * 4 + 1] = g; rgba[j * 4 + 2] = b; rgba[j * 4 + 3] = 255;
    lum[j] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  const gris = aplicarFiltro({ data: rgba, width: w, height: h }, 'gris').data;
  return { lum, gris, w, h };
}

function suavizar(v, r) {
  const n = v.length, out = new Float32Array(n);
  let s = 0;
  for (let i = -r; i <= r; i++) s += v[Math.min(n - 1, Math.max(0, i))];
  for (let i = 0; i < n; i++) {
    out[i] = s / (2 * r + 1);
    s += v[Math.min(n - 1, i + r + 1)] - v[Math.max(0, i - r)];
  }
  return out;
}

const mediana = v => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1] || 0; };

/**
 * ¿Dónde está el lomo? En el libro abierto ya enderezado (acostado: las dos
 * páginas una al lado de la otra).
 * @returns la posición (fracción del ancho, entre 0,3 y 0,7) o null si no se encuentra
 */
export function buscarLomo(img) {
  const { lum, gris, w, h } = medir(img);
  const y0 = Math.round(h * 0.08), y1 = Math.round(h * 0.92);
  const tinta = new Float32Array(w), luz = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let t = 0, l = 0;
    for (let y = y0; y < y1; y++) { t += gris[(y * w + x) * 4] < 150 ? 1 : 0; l += lum[y * w + x]; }
    tinta[x] = t / (y1 - y0); luz[x] = l / (y1 - y0);
  }
  const tintaS = suavizar(tinta, Math.max(2, Math.round(w / 100))), luzS = suavizar(luz, Math.max(1, Math.round(w / 200)));
  const desde = Math.round(w * 0.3), hasta = Math.round(w * 0.7);
  // Qué es "sin letras": mucho menos que la tinta típica de las páginas
  const tipica = mediana([...tintaS.subarray(Math.round(w * 0.08), desde), ...tintaS.subarray(hasta, Math.round(w * 0.92))].filter(v => v > 0.005));
  if (!tipica) return null;
  const vacia = x => tintaS[x] < Math.max(0.004, tipica * 0.12);
  // La franja sin letras más ancha en el centro
  let mejor = null;
  for (let x = desde; x <= hasta; x++) {
    if (!vacia(x)) continue;
    let fin = x;
    while (fin + 1 <= hasta && vacia(fin + 1)) fin++;
    if (!mejor || fin - x > mejor.fin - mejor.inicio) mejor = { inicio: x, fin };
    x = fin;
  }
  if (!mejor || mejor.fin - mejor.inicio < w * 0.012) return null;
  // Tiene que haber texto a los dos lados (si no, es una sola página con margen)
  const lado = (a, b) => { let s = 0; for (let x = a; x < b; x++) s += tinta[x]; return s / Math.max(1, b - a); };
  const izq = lado(Math.round(w * 0.05), mejor.inicio), der = lado(mejor.fin, Math.round(w * 0.95));
  if (izq < tipica * 0.3 || der < tipica * 0.3) return null;
  // Dentro de la franja, la sombra del doblez (si se nota); si no, el medio de la franja
  let lomo = (mejor.inicio + mejor.fin) / 2, oscuro = Infinity;
  for (let x = mejor.inicio; x <= mejor.fin; x++) if (luzS[x] < oscuro) { oscuro = luzS[x]; lomo = x; }
  const papel = mediana(luzS.subarray(mejor.inicio, mejor.fin + 1));
  if (oscuro > papel * 0.97) lomo = (mejor.inicio + mejor.fin) / 2;
  return (lomo + 0.5) / w;
}

/**
 * Parte las esquinas del libro abierto en las de sus dos páginas.
 * @param esquinas [tl, tr, br, bl] del libro (fracciones de la foto)
 * @param s        dónde está el lomo (fracción del ancho del libro enderezado)
 * @returns [izquierda, derecha], cada una [tl, tr, br, bl]
 */
export function dividirEsquinas(esquinas, s) {
  // Del cuadrado unidad (el libro enderezado) a la foto: la línea x = s cae sobre el lomo en la foto
  const H = homografia([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], esquinas);
  const arriba = aplicar(H, s, 0), abajo = aplicar(H, s, 1);
  const [tl, tr, br, bl] = esquinas;
  return [[tl, arriba, abajo, bl], [arriba, tr, br, abajo]];
}
