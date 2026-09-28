// ScanLibre · marcas.js
// Lo que uno le pone encima a la página: resaltador, lápiz, notas y firmas.
// Se guardan aparte de la imagen (se pueden quitar o cambiar cuando uno
// quiera) y se dibujan encima al verla, en la miniatura, en el PDF y al
// guardarla como imagen. El lector de texto lee la página sin marcas.
//
// Todo va en fracciones de la página (0..1): sirve para cualquier tamaño.
//  { tipo: 'resaltador' | 'lapiz', color, grosor (fracción del ancho), puntos: [x, y, x, y, …], recto? }
//  { tipo: 'nota', x, y (el centro), texto, tam (tamaño de la letra, fracción del ancho) }
//  { tipo: 'firma', x, y (el centro), ancho (fracción del ancho de la página), aspecto (alto / ancho),
//    color, grosor (fracción del ancho de la firma), trazos: [[x, y, …], …] (fracciones de la firma) }

export const RESALTADORES = { amarillo: '#ffe84a', verde: '#a8f07c', rosado: '#ffa0d8', celeste: '#96dcff' };
export const LAPICES = { azul: '#1d4ed8', rojo: '#d7261e', negro: '#15171c' };
export const GROSOR = { resaltador: 0.024, lapiz: 0.0045 };
export const TAM_NOTA = 0.026;
const FUENTE = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const NOTA_FONDO = '#fff2a1', NOTA_BORDE = '#d4b106', NOTA_TEXTO = '#3a3000';

/** Un trazo suave: curvas por los puntos medios (sx, sy pasan de fracciones a píxeles) */
function camino(ctx, pts, sx, sy, ox = 0, oy = 0) {
  const n = pts.length / 2;
  const X = i => ox + pts[2 * i] * sx, Y = i => oy + pts[2 * i + 1] * sy;
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0));
  if (n === 1) { ctx.lineTo(X(0) + 0.01, Y(0)); return; } // un punto: con la punta redonda se ve
  for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(X(i), Y(i), (X(i) + X(i + 1)) / 2, (Y(i) + Y(i + 1)) / 2);
  ctx.lineTo(X(n - 1), Y(n - 1));
}

function rectRedondo(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Los renglones de la nota y el tamaño de su recuadro (en px de una página de ancho W) */
export function medidaNota(ctx, m, W) {
  const tam = Math.max(4, m.tam * W), pad = tam * 0.55, renglon = tam * 1.3, max = W * 0.46 - 2 * pad;
  ctx.font = `500 ${tam}px ${FUENTE}`;
  const mide = t => ctx.measureText(t).width;
  const lineas = [];
  for (const parrafo of String(m.texto || '').split('\n')) {
    let linea = '';
    for (let palabra of parrafo.split(/\s+/).filter(Boolean)) {
      // Una palabra más larga que la nota se parte
      while (mide(palabra) > max && palabra.length > 1) {
        let k = palabra.length - 1;
        while (k > 1 && mide(palabra.slice(0, k)) > max) k--;
        if (linea) { lineas.push(linea); linea = ''; }
        lineas.push(palabra.slice(0, k));
        palabra = palabra.slice(k);
      }
      const prueba = linea ? `${linea} ${palabra}` : palabra;
      if (!linea || mide(prueba) <= max) linea = prueba;
      else { lineas.push(linea); linea = palabra; }
    }
    lineas.push(linea);
  }
  const ancho = Math.max(tam * 2, ...lineas.map(mide)) + 2 * pad;
  const alto = 2 * pad + (lineas.length - 1) * renglon + tam * 1.2;
  return { lineas, ancho, alto, tam, pad, renglon };
}

/** Dónde queda la marca en la página (px): { x, y, w, h } */
export function caja(ctx, m, W, H) {
  if (m.tipo === 'nota') {
    const { ancho, alto } = medidaNota(ctx, m, W);
    return { x: m.x * W - ancho / 2, y: m.y * H - alto / 2, w: ancho, h: alto };
  }
  if (m.tipo === 'firma') {
    const w = m.ancho * W, h = w * m.aspecto;
    return { x: m.x * W - w / 2, y: m.y * H - h / 2, w, h };
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < m.puntos.length; i += 2) {
    x0 = Math.min(x0, m.puntos[i] * W); x1 = Math.max(x1, m.puntos[i] * W);
    y0 = Math.min(y0, m.puntos[i + 1] * H); y1 = Math.max(y1, m.puntos[i + 1] * H);
  }
  const g = m.grosor * W / 2;
  return { x: x0 - g, y: y0 - g, w: x1 - x0 + 2 * g, h: y1 - y0 + 2 * g };
}

function dibujarNota(ctx, m, W, H) {
  const d = medidaNota(ctx, m, W);
  const x = m.x * W - d.ancho / 2, y = m.y * H - d.alto / 2;
  rectRedondo(ctx, x, y, d.ancho, d.alto, d.tam * 0.35);
  ctx.fillStyle = NOTA_FONDO;
  ctx.fill();
  ctx.lineWidth = Math.max(1, d.tam * 0.07);
  ctx.strokeStyle = NOTA_BORDE;
  ctx.stroke();
  ctx.fillStyle = NOTA_TEXTO;
  ctx.textBaseline = 'top';
  ctx.font = `500 ${d.tam}px ${FUENTE}`;
  d.lineas.forEach((l, i) => ctx.fillText(l, x + d.pad, y + d.pad + i * d.renglon + d.tam * 0.08));
}

function dibujarFirma(ctx, m, W, H) {
  const b = caja(ctx, m, W, H);
  ctx.strokeStyle = m.color;
  ctx.lineWidth = Math.max(1, m.grosor * b.w);
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const t of m.trazos) { camino(ctx, t, b.w, b.h, b.x, b.y); ctx.stroke(); }
}

/**
 * Dibuja las marcas sobre la página, que ocupa (0, 0)–(W, H) en el ctx.
 * El resaltador "multiplica": las letras de abajo se siguen viendo negras.
 */
export function dibujarMarcas(ctx, marcas, W, H) {
  for (const m of marcas || []) {
    ctx.save();
    if (m.tipo === 'resaltador' || m.tipo === 'lapiz') {
      ctx.globalCompositeOperation = m.tipo === 'resaltador' ? 'multiply' : 'source-over';
      ctx.strokeStyle = m.color;
      ctx.lineWidth = Math.max(1, m.grosor * W);
      ctx.lineCap = m.recto ? 'butt' : 'round';
      ctx.lineJoin = 'round';
      camino(ctx, m.puntos, W, H);
      ctx.stroke();
    } else if (m.tipo === 'nota') dibujarNota(ctx, m, W, H);
    else if (m.tipo === 'firma') dibujarFirma(ctx, m, W, H);
    ctx.restore();
  }
}

const distSegmento = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};

/** La marca que está en (px, py) (px de la página), la de más arriba; -1 si no hay */
export function marcaEn(ctx, marcas, px, py, W, H, margen = 0) {
  for (let k = marcas.length - 1; k >= 0; k--) {
    const m = marcas[k];
    if (m.tipo === 'nota' || m.tipo === 'firma') {
      const b = caja(ctx, m, W, H);
      if (px >= b.x - margen && px <= b.x + b.w + margen && py >= b.y - margen && py <= b.y + b.h + margen) return k;
      continue;
    }
    const p = m.puntos, lim = m.grosor * W / 2 + margen;
    if (p.length === 2 && Math.hypot(px - p[0] * W, py - p[1] * H) <= lim) return k;
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (distSegmento(px, py, p[i] * W, p[i + 1] * H, p[i + 2] * W, p[i + 3] * H) <= lim) return k;
    }
  }
  return -1;
}

/**
 * La página en gris y chica (de ancho máximo `maxAncho`), para buscar los
 * renglones bajo el resaltador. `fuente` es un canvas o un bitmap.
 */
export function mapaDeGris(fuente, maxAncho = 1200) {
  const k = Math.min(1, maxAncho / fuente.width);
  const w = Math.max(1, Math.round(fuente.width * k)), h = Math.max(1, Math.round(fuente.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(fuente, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  c.width = c.height = 0;
  const lum = new Uint8Array(w * h);
  for (let i = 0; i < lum.length; i++) lum[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
  return { lum, w, h };
}

/**
 * El renglón de texto que tapa un trazo derecho (en px del mapa): busca las
 * filas con tinta alrededor de `ym` y, en ellas, las palabras (tinta separada
 * por huecos anchos) que el trazo toca.
 * @returns { x0, x1, y0, y1 } o null si ahí no hay un renglón claro
 */
export function renglonBajo({ lum, w, h }, xa, xb, ym, g) {
  const x0 = Math.max(0, Math.floor(xa)), x1 = Math.min(w - 1, Math.ceil(xb));
  const ya = Math.max(0, Math.floor(ym - 2.2 * g)), yb = Math.min(h - 1, Math.ceil(ym + 2.2 * g));
  if (x1 - x0 < 3 || yb - ya < 3) return null;
  // El papel: lo más claro de la franja; la tinta, lo bastante más oscuro que él
  const muestras = [];
  for (let y = ya; y <= yb; y += 2) for (let x = x0; x <= x1; x += 2) muestras.push(lum[y * w + x]);
  muestras.sort((a, b) => a - b);
  const papel = muestras[Math.floor(muestras.length * 0.9)];
  if (papel < 60) return null;
  const corte = papel * 0.62;
  const conTinta = [];
  for (let y = ya; y <= yb; y++) {
    let t = 0;
    for (let x = x0; x <= x1; x++) if (lum[y * w + x] < corte) t++;
    conTinta.push(t / (x1 - x0 + 1) > 0.03);
  }
  // Tramos de filas con tinta (un hueco de una fila no los corta)
  const tramos = [];
  for (let i = 0; i < conTinta.length; i++) {
    if (!conTinta[i]) continue;
    let f = i;
    while (f + 1 < conTinta.length && (conTinta[f + 1] || (f + 2 < conTinta.length && conTinta[f + 2]))) f++;
    tramos.push({ y0: ya + i, y1: ya + f + 1 });
    i = f;
  }
  let mejor = null, dist = Infinity;
  for (const t of tramos) {
    const d = ym < t.y0 ? t.y0 - ym : ym > t.y1 ? ym - t.y1 : 0;
    if (d < dist) { dist = d; mejor = t; }
  }
  if (!mejor || dist > g * 0.6) return null;
  const alto = mejor.y1 - mejor.y0;
  if (alto < g * 0.25 || alto > g * 2.6) return null;
  // Las palabras del renglón: columnas con tinta, juntando los huecos chicos (entre letras)
  const hueco = Math.max(2, alto * 0.45);
  const palabras = [];
  let inicio = -1, ultimo = -1;
  for (let x = 0; x < w; x++) {
    let tinta = false;
    for (let y = mejor.y0; y < mejor.y1 && !tinta; y++) tinta = lum[y * w + x] < corte;
    if (!tinta) continue;
    if (inicio >= 0 && x - ultimo > hueco) { palabras.push([inicio, ultimo + 1]); inicio = -1; }
    if (inicio < 0) inicio = x;
    ultimo = x;
  }
  if (inicio >= 0) palabras.push([inicio, ultimo + 1]);
  // Las que el trazo toca de verdad (no solo con la punta)
  const tocadas = palabras.filter(([a, b]) => Math.min(b, xb) - Math.max(a, xa) > Math.min(b - a, alto) * 0.3);
  if (!tocadas.length) return null;
  return { x0: tocadas[0][0], x1: tocadas[tocadas.length - 1][1], y0: mejor.y0, y1: mejor.y1 };
}

/**
 * Un trazo de resaltador casi derecho se endereza, como hecho con regla. Si
 * hay `mapa` (la página en gris, de mapaDeGris), además se ajusta al renglón
 * que tapa: a su alto y de la primera a la última palabra que toca.
 * @param puntos [x, y, …] en fracciones; W, H en px de la página
 * @returns { puntos, grosor, recto: true } o null si el trazo no es una línea
 */
export function enderezarTrazo(puntos, grosor, W, H, mapa = null) {
  const n = puntos.length / 2;
  if (n < 2) return null;
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) { xs.push(puntos[2 * i] * W); ys.push(puntos[2 * i + 1] * H); }
  let xa = Math.min(...xs), xb = Math.max(...xs);
  const g = grosor * W;
  if (xb - xa < 2 * g) return null;
  // Recta por los puntos (mínimos cuadrados): casi horizontal y sin irse lejos de ella
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const b = sxy / sxx, a = my - b * mx;
  if (Math.abs(b) > 0.2) return null;
  if (Math.max(...xs.map((x, i) => Math.abs(ys[i] - a - b * x))) > g * 0.9) return null;
  let ya = a + b * xa, yb = a + b * xb, gros = grosor;
  // La página ya está enderezada: los renglones son horizontales
  if (mapa && Math.abs(b) < 0.06) {
    const k = mapa.w / W;
    const r = renglonBajo(mapa, xa * k, xb * k, (ya + yb) / 2 * k, g * k);
    if (r) {
      const alto = (r.y1 - r.y0) / k, extra = alto * 0.12;
      xa = r.x0 / k - extra; xb = r.x1 / k + extra;
      ya = yb = (r.y0 + r.y1) / 2 / k;
      gros = alto * 1.25 / W;
    }
  }
  const c = v => Math.max(0, Math.min(1, v));
  return { puntos: [c(xa / W), c(ya / H), c(xb / W), c(yb / H)], grosor: gros, recto: true };
}

/**
 * Las marcas después de girar la página `vueltas` cuartos de vuelta a la
 * derecha (la página era W × H px). Los trazos giran con la página; las notas
 * y las firmas cambian de lugar pero siguen derechas, para poder leerlas.
 */
export function girarMarcas(marcas, vueltas, W, H) {
  let lista = marcas || [];
  for (let v = 0; v < ((vueltas % 4) + 4) % 4; v++) {
    const k = W / H; // lo que era el ancho ahora es el alto: los tamaños en px se mantienen
    lista = lista.map(m => {
      if (m.tipo === 'nota') return { ...m, x: 1 - m.y, y: m.x, tam: m.tam * k };
      if (m.tipo === 'firma') return { ...m, x: 1 - m.y, y: m.x, ancho: m.ancho * k };
      const puntos = [];
      for (let i = 0; i < m.puntos.length; i += 2) puntos.push(1 - m.puntos[i + 1], m.puntos[i]);
      return { ...m, puntos, grosor: m.grosor * k };
    });
    [W, H] = [H, W];
  }
  return lista;
}

/**
 * Una firma dibujada a mano ([[x, y, …] en px], grosor en px) lista para
 * guardar: recortada a lo que ocupa y en fracciones de su propio recuadro.
 * @returns { trazos, aspecto, grosor } o null si está vacía
 */
export function normalizarFirma(trazos, grosor) {
  const pts = trazos.flat();
  if (pts.length < 4) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  const m = grosor; // margen: medio trazo a cada lado, y un poco más
  x0 -= m; y0 -= m; x1 += m; y1 += m;
  const w = x1 - x0, h = y1 - y0;
  if (w < 8 && h < 8) return null;
  const r = v => Math.round(v * 10000) / 10000;
  return {
    trazos: trazos.map(t => t.map((v, i) => r(i % 2 ? (v - y0) / h : (v - x0) / w))),
    aspecto: h / w,
    grosor: grosor / w
  };
}
