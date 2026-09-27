// ScanLibre · imagen/filtros.js
// Filtros para la hoja ya enderezada. La idea central: estimar el brillo del
// papel en cada zona (la "luz de fondo") y dividir por él. Así desaparecen las
// sombras de la mano o del teléfono y el papel queda blanco parejo.

export const FILTROS = {
  original: 'Original',
  mejorada: 'Mejorada',
  dibujo: 'Dibujo',
  gris: 'Gris',
  bn: 'B/N'
};

export function aplicarFiltro(img, filtro) {
  if (filtro === 'mejorada') return realzar(img, CURVA);
  if (filtro === 'dibujo') return realzar(img, CURVA_DIBUJO);
  if (filtro === 'gris') return gris(img);
  if (filtro === 'bn') return blancoYNegro(img);
  return img;
}

function luminancia(img) {
  const { data, width, height } = img;
  const n = width * height;
  const L = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) L[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  return L;
}

/** Recorre la imagen fila por fila con el valor de una cuadrícula interpolado en cada píxel */
function recorrerSuave(cuadro, gw, gh, bloque, w, h, alHacerFila) {
  const x0 = new Int32Array(w), x1 = new Int32Array(w), ax = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let g = (x + 0.5) / bloque - 0.5;
    if (g < 0) g = 0; else if (g > gw - 1) g = gw - 1;
    x0[x] = g | 0; x1[x] = Math.min(gw - 1, x0[x] + 1); ax[x] = g - x0[x];
  }
  const filaCuadro = new Float32Array(gw), fila = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    let g = (y + 0.5) / bloque - 0.5;
    if (g < 0) g = 0; else if (g > gh - 1) g = gh - 1;
    const y0 = g | 0, y1 = Math.min(gh - 1, y0 + 1), ay = g - y0;
    for (let i = 0; i < gw; i++) filaCuadro[i] = cuadro[y0 * gw + i] * (1 - ay) + cuadro[y1 * gw + i] * ay;
    for (let x = 0; x < w; x++) fila[x] = filaCuadro[x0[x]] * (1 - ax[x]) + filaCuadro[x1[x]] * ax[x];
    alHacerFila(fila, y);
  }
}

function desenfocarCuadro(c, gw, gh) {
  const t = new Float32Array(c.length);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) { s += c[yy * gw + xx]; n++; }
    }
    t[y * gw + x] = s / n;
  }
  return t;
}

/**
 * Brillo del papel por bloques. En cada bloque se toma un percentil alto (el
 * papel es lo más claro); los bloques mucho más oscuros que sus vecinos (una
 * foto, una tabla rellena) no son papel y se rellenan con los de alrededor.
 */
function fondoDelPapel(L, w, h) {
  const bloque = Math.max(4, Math.round(Math.max(w, h) / 48));
  const gw = Math.ceil(w / bloque), gh = Math.ceil(h / bloque);
  const c = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);
  for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
    hist.fill(0);
    const xa = bx * bloque, xb = Math.min(w, xa + bloque), ya = by * bloque, yb = Math.min(h, ya + bloque);
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) hist[L[y * w + x]]++;
    const meta = (xb - xa) * (yb - ya) * 0.1;
    let acum = 0, v = 255;
    for (; v > 0; v--) { acum += hist[v]; if (acum >= meta) break; }
    c[by * gw + bx] = v;
  }
  // Bloques que no son papel: mucho más oscuros que el más claro de su vecindario (5×5)
  const papel = new Uint8Array(gw * gh);
  let hayPapel = false;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let max = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) max = Math.max(max, c[yy * gw + xx]);
    }
    if (c[y * gw + x] >= 0.72 * max && c[y * gw + x] > 40) { papel[y * gw + x] = 1; hayPapel = true; }
  }
  if (hayPapel) {
    let faltan = true;
    while (faltan) {
      faltan = false;
      const nuevos = [];
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        if (papel[y * gw + x]) continue;
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < gh && xx >= 0 && xx < gw && papel[yy * gw + xx]) { s += c[yy * gw + xx]; n++; }
        }
        if (n) nuevos.push([y * gw + x, s / n]); else faltan = true;
      }
      if (!nuevos.length) break;
      for (const [i, v] of nuevos) { c[i] = v; papel[i] = 1; }
    }
  }
  const suave = desenfocarCuadro(desenfocarCuadro(c, gw, gh), gw, gh);
  for (let i = 0; i < suave.length; i++) if (suave[i] < 16) suave[i] = 16;
  return { cuadro: suave, gw, gh, bloque };
}

/** Balance de blancos: el color promedio del papel se lleva a gris neutro */
function gananciasDeBlanco(img, L, w, h, fondo) {
  const { data } = img;
  let sr = 0, sg = 0, sb = 0, sl = 0, n = 0;
  recorrerSuave(fondo.cuadro, fondo.gw, fondo.gh, fondo.bloque, w, h, (fila, y) => {
    if (y % 4) return;
    for (let x = 0; x < w; x += 4) {
      const i = y * w + x;
      if (L[i] >= 0.9 * fila[x]) {
        sr += data[i * 4]; sg += data[i * 4 + 1]; sb += data[i * 4 + 2]; sl += L[i]; n++;
      }
    }
  });
  if (!n) return [1, 1, 1];
  const lim = g => Math.min(1.5, Math.max(0.7, g));
  return [lim(sl / sr), lim(sl / sg), lim(sl / sb)];
}

// Curvas de niveles (índice = brillo × 4, ya dividido por el brillo del papel).
// Mejorada: el papel (>= BLANCO) pasa a blanco y la tinta se oscurece un poco.
// BLANCO no puede ser muy bajo: los trazos suaves de lápiz se perderían con el papel.
const NEGRO = 18, BLANCO = 238;
const CURVA = new Uint8ClampedArray(1024);
for (let i = 0; i < 1024; i++) {
  const t = Math.min(1, Math.max(0, (i / 4 - NEGRO) / (BLANCO - NEGRO)));
  CURVA[i] = Math.round(255 * Math.pow(t, 1.45));
}
// Dibujo: solo lo que es casi papel pasa a blanco, y todo trazo se oscurece
// bastante, así el lápiz más suave se sigue viendo.
const PAPEL_DIBUJO = 0.955;
const CURVA_DIBUJO = new Uint8ClampedArray(1024);
for (let i = 0; i < 1024; i++) {
  const t = i / 1020;
  CURVA_DIBUJO[i] = t >= PAPEL_DIBUJO ? 255 : Math.round(255 * Math.pow(t / PAPEL_DIBUJO, 1.9));
}

/**
 * Papel blanco y parejo sin tocar los colores: la curva se aplica solo al
 * brillo y a cada canal se le devuelve su diferencia de color original. Si la
 * curva se aplicara canal por canal, los colores quedarían saturados.
 */
function realzar(img, curva) {
  const { data, width: w, height: h } = img;
  const L = luminancia(img);
  const fondo = fondoDelPapel(L, w, h);
  const [gr, gg, gb] = gananciasDeBlanco(img, L, w, h, fondo);
  const out = new Uint8ClampedArray(data.length);
  recorrerSuave(fondo.cuadro, fondo.gw, fondo.gh, fondo.bloque, w, h, (fila, y) => {
    for (let x = 0, j = y * w * 4; x < w; x++, j += 4) {
      const k = 255 / fila[x];
      const r = data[j] * gr * k, g = data[j + 1] * gg * k, b = data[j + 2] * gb * k;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const nuevo = curva[Math.min(1023, l * 4 | 0)];
      // Cerca del blanco el color se apaga para que el papel quede limpio
      const color = nuevo > 245 ? (255 - nuevo) / 10 : 1;
      out[j] = nuevo + (r - l) * color;
      out[j + 1] = nuevo + (g - l) * color;
      out[j + 2] = nuevo + (b - l) * color;
      out[j + 3] = 255;
    }
  });
  return { data: out, width: w, height: h };
}

/** Luminancia dividida por el brillo del papel (papel ≈ 255 en toda la hoja) */
function luminanciaPareja(img) {
  const { width: w, height: h } = img;
  const L = luminancia(img);
  const fondo = fondoDelPapel(L, w, h);
  const N = new Uint8ClampedArray(w * h);
  recorrerSuave(fondo.cuadro, fondo.gw, fondo.gh, fondo.bloque, w, h, (fila, y) => {
    for (let x = 0, i = y * w; x < w; x++, i++) N[i] = L[i] * 255 / fila[x];
  });
  return N;
}

function gris(img) {
  const { width: w, height: h } = img;
  const N = luminanciaPareja(img);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < N.length; i++, j += 4) {
    const v = CURVA[N[i] * 4];
    out[j] = out[j + 1] = out[j + 2] = v; out[j + 3] = 255;
  }
  return { data: out, width: w, height: h };
}

/**
 * Blanco y negro para texto: umbral local (Bradley) sobre la luminancia ya
 * pareja. Lo muy oscuro siempre es tinta y lo casi blanco siempre es papel;
 * en medio decide el promedio de la zona, así se ven hasta trazos de lápiz.
 */
function blancoYNegro(img) {
  const { width: w, height: h } = img;
  const N = luminanciaPareja(img);
  // Promedio local en una versión 4 veces más chica (rápido y suficiente)
  const r = 4, sw = Math.ceil(w / r), sh = Math.ceil(h / r);
  const peq = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let s = 0, n = 0;
    for (let yy = y * r; yy < Math.min(h, y * r + r); yy++) for (let xx = x * r; xx < Math.min(w, x * r + r); xx++) { s += N[yy * w + xx]; n++; }
    peq[y * sw + x] = s / n;
  }
  const radio = Math.max(2, Math.round(Math.max(sw, sh) / 40));
  const media = cajaSeparable(peq, sw, sh, radio);
  const out = new Uint8ClampedArray(w * h * 4);
  recorrerSuave(media, sw, sh, r, w, h, (fila, y) => {
    for (let x = 0, i = y * w, j = y * w * 4; x < w; x++, i++, j += 4) {
      const v = N[i];
      const tinta = v < 100 || (v < 215 && v < fila[x] * 0.78);
      const c = tinta ? 0 : 255;
      out[j] = out[j + 1] = out[j + 2] = c; out[j + 3] = 255;
    }
  });
  return { data: out, width: w, height: h };
}

function cajaSeparable(src, w, h, radio) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0, n = 0;
    for (let x = -radio; x < w + radio; x++) {
      if (x + radio < w && x + radio >= 0) { s += src[y * w + x + radio]; n++; }
      if (x - radio - 1 >= 0) { s -= src[y * w + x - radio - 1]; n--; }
      if (x >= 0 && x < w) tmp[y * w + x] = s / n;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let y = -radio; y < h + radio; y++) {
      if (y + radio < h && y + radio >= 0) { s += tmp[(y + radio) * w + x]; n++; }
      if (y - radio - 1 >= 0) { s -= tmp[(y - radio - 1) * w + x]; n--; }
      if (y >= 0 && y < h) out[y * w + x] = s / n;
    }
  }
  return out;
}
