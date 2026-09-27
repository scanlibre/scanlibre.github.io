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

/** Máximo en un cuadrado de ±radio alrededor de cada celda (por filas y columnas) */
function maximoEnRadio(c, gw, gh, radio) {
  const t = new Float32Array(c.length), out = new Float32Array(c.length);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let m = 0;
    for (let d = -radio; d <= radio; d++) { const xx = x + d; if (xx >= 0 && xx < gw) m = Math.max(m, c[y * gw + xx]); }
    t[y * gw + x] = m;
  }
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let m = 0;
    for (let d = -radio; d <= radio; d++) { const yy = y + d; if (yy >= 0 && yy < gh) m = Math.max(m, t[yy * gw + x]); }
    out[y * gw + x] = m;
  }
  return out;
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
function fondoDelPapel(L, w, h, img) {
  // Bloques de 1/32 del lado corto (mínimo 16 px) para seguir sombras que
  // cambian rápido, como la del lomo de un libro, sin comerse trazos gruesos
  const bloque = Math.max(16, Math.round(Math.min(w, h) / 32));
  const gw = Math.ceil(w / bloque), gh = Math.ceil(h / bloque);
  const c = new Float32Array(gw * gh), color = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);
  const d = img.data;
  for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
    hist.fill(0);
    const xa = bx * bloque, xb = Math.min(w, xa + bloque), ya = by * bloque, yb = Math.min(h, ya + bloque);
    let sat = 0;
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
      const i = y * w + x, j = i * 4;
      hist[L[i]]++;
      sat += Math.max(d[j], d[j + 1], d[j + 2]) - Math.min(d[j], d[j + 1], d[j + 2]);
    }
    color[by * gw + bx] = sat / ((xb - xa) * (yb - ya));
    const meta = (xb - xa) * (yb - ya) * 0.1;
    let acum = 0, v = 255;
    for (; v > 0; v--) { acum += hist[v]; if (acum >= meta) break; }
    c[by * gw + bx] = v;
  }
  // Bloques que no son papel, comparados con el papel más claro de una zona
  // amplia (un sexto de la hoja a cada lado, así un recuadro grande no se
  // compara solo consigo mismo):
  //  · menos de la mitad de brillo: una foto o una zona muy oscura;
  //  · de color y algo más oscuros: una barra o un recuadro de color, que
  //    conserva su color.
  // Una sombra es gris, aunque sea fuerte como la del lomo de un libro: sigue
  // siendo papel y se aclara.
  const radio = Math.max(2, Math.round(Math.max(gw, gh) / 6));
  const cerca = maximoEnRadio(c, gw, gh, radio);
  // Y el papel de toda la hoja (percentil 90 de los bloques): un recuadro más
  // grande que la zona amplia tampoco se compara consigo mismo
  const global = [...c].sort((a, b) => a - b)[Math.floor(c.length * 0.9)];
  const ref = cerca.map(v => Math.max(v, 0.92 * global));
  const papel = new Uint8Array(gw * gh);
  let hayPapel = false;
  for (let i = 0; i < gw * gh; i++) {
    const v = c[i], deColor = color[i] > 25;
    if (v > 40 && v >= 0.5 * ref[i] && !(deColor && v < 0.85 * ref[i])) { papel[i] = 1; hayPapel = true; }
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
  const suave = desenfocarCuadro(c, gw, gh);
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
 * brillo y los tres canales se escalan en la misma proporción, así el tono y
 * la saturación quedan iguales. Si la curva se aplicara canal por canal (o si
 * se conservara la diferencia de color mientras el brillo baja), los colores
 * quedarían saturados.
 */
function realzar(img, curva) {
  const { data, width: w, height: h } = img;
  const L = luminancia(img);
  const fondo = fondoDelPapel(L, w, h, img);
  const [gr, gg, gb] = gananciasDeBlanco(img, L, w, h, fondo);
  const out = new Uint8ClampedArray(data.length);
  recorrerSuave(fondo.cuadro, fondo.gw, fondo.gh, fondo.bloque, w, h, (fila, y) => {
    for (let x = 0, j = y * w * 4; x < w; x++, j += 4) {
      const k = 255 / fila[x];
      const r = data[j] * gr * k, g = data[j + 1] * gg * k, b = data[j + 2] * gb * k;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const nuevo = curva[Math.min(1023, l * 4 | 0)];
      // Cerca del blanco el color se apaga para que el papel quede limpio
      const color = (nuevo > 245 ? (255 - nuevo) / 10 : 1) * nuevo / Math.max(1, l);
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
  const fondo = fondoDelPapel(L, w, h, img);
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
 * Blanco y negro para texto con el umbral de Sauvola sobre la luminancia ya
 * pareja: en cada zona el corte depende del promedio y de cuánto varía. Donde
 * solo hay papel (varía poco) el corte baja y el papel queda limpio; donde hay
 * letras (varía mucho) el corte sube y se ven hasta las letras suaves o algo
 * borrosas. Una sombra que quedó (el lomo de un libro) varía poco: no se pinta
 * de negro.
 */
const K_SAUVOLA = 0.2, R_SAUVOLA = 128;

function blancoYNegro(img) {
  const { width: w, height: h } = img;
  const N = luminanciaPareja(img);
  // Promedio y variación en una versión 2 veces más chica (rápido y suficiente)
  const r = 2, sw = Math.ceil(w / r), sh = Math.ceil(h / r);
  const m1 = new Float32Array(sw * sh), m2 = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let s = 0, s2 = 0, n = 0;
    for (let yy = y * r; yy < Math.min(h, y * r + r); yy++) for (let xx = x * r; xx < Math.min(w, x * r + r); xx++) {
      const v = N[yy * w + xx]; s += v; s2 += v * v; n++;
    }
    m1[y * sw + x] = s / n; m2[y * sw + x] = s2 / n;
  }
  // Ventana de unas 2 o 3 alturas de letra: 1/30 del lado corto
  const radio = Math.max(4, Math.round(Math.min(sw, sh) / 30));
  const media = cajaSeparable(m1, sw, sh, radio), media2 = cajaSeparable(m2, sw, sh, radio);
  const corte = new Float32Array(sw * sh);
  for (let i = 0; i < corte.length; i++) {
    const desv = Math.sqrt(Math.max(0, media2[i] - media[i] * media[i]));
    corte[i] = media[i] * (1 + K_SAUVOLA * (desv / R_SAUVOLA - 1));
  }
  const out = new Uint8ClampedArray(w * h * 4);
  recorrerSuave(corte, sw, sh, r, w, h, (fila, y) => {
    for (let x = 0, i = y * w, j = y * w * 4; x < w; x++, i++, j += 4) {
      const v = N[i];
      const tinta = v < 40 || (v < 248 && v < fila[x]);
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
