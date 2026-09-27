// ScanLibre · imagen/deteccion.js
// Encuentra la hoja en una foto chica (≈ 300-600 px de lado). Pasos:
//  1. Bordes (Canny) sobre el brillo y la saturación: una hoja blanca sobre una
//     mesa de color se distingue aunque el brillo sea parecido.
//  2. Candidatos: cada grupo grande de bordes conectados, las zonas claras u
//     oscuras más grandes, y cuadriláteros armados con las rectas más largas
//     (Hough). De cada grupo sale un cuadrilátero (envolvente → 4 esquinas).
//  3. Cada cuadrilátero se afina ajustando una recta a los bordes de cada lado
//     y se califica: cuánto de cada lado cae sobre un borde real y si separa
//     dos zonas distintas (hoja por dentro, mesa por fuera).
// Devuelve las esquinas en fracciones (0..1) del ancho y alto, o null.

import { envolventeConvexa, reducirACuatro, ordenarEsquinas, esConvexo, angulos, area, ajustarRecta, interseccion, distancia } from './geometria.js';

function desenfocar(src, w, h) {
  // Binomial 1-4-6-4-1 separable, aplicado dos veces (σ ≈ 1.4)
  let a = src, b = new Float32Array(w * h);
  for (let pasada = 0; pasada < 2; pasada++) {
    for (let y = 0; y < h; y++) {
      const f = y * w;
      for (let x = 0; x < w; x++) {
        const x1 = x > 0 ? x - 1 : 0, x2 = x > 1 ? x - 2 : x1;
        const x3 = x < w - 1 ? x + 1 : x, x4 = x < w - 2 ? x + 2 : x3;
        b[f + x] = (a[f + x2] + 4 * a[f + x1] + 6 * a[f + x] + 4 * a[f + x3] + a[f + x4]) / 16;
      }
    }
    const c = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const y1 = y > 0 ? y - 1 : 0, y2 = y > 1 ? y - 2 : y1;
      const y3 = y < h - 1 ? y + 1 : y, y4 = y < h - 2 ? y + 2 : y3;
      for (let x = 0; x < w; x++) {
        c[y * w + x] = (b[y2 * w + x] + 4 * b[y1 * w + x] + 6 * b[y * w + x] + 4 * b[y3 * w + x] + b[y4 * w + x]) / 16;
      }
    }
    a = c;
  }
  return a;
}

function sobel(c, w, h) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const tl = c[i - w - 1], t = c[i - w], tr = c[i - w + 1];
    const l = c[i - 1], r = c[i + 1];
    const bl = c[i + w - 1], b = c[i + w], br = c[i + w + 1];
    gx[i] = (tr + 2 * r + br) - (tl + 2 * l + bl);
    gy[i] = (bl + 2 * b + br) - (tl + 2 * t + tr);
  }
  return { gx, gy };
}

/** Gradiente combinado: en cada píxel gana el canal (brillo o saturación) con más contraste */
function gradiente(img) {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const brillo = new Float32Array(n), sat = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = data[j], g = data[j + 1], b = data[j + 2];
    brillo[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  const bs = desenfocar(brillo, w, h), ss = desenfocar(sat, w, h);
  const g1 = sobel(bs, w, h), g2 = sobel(ss, w, h);
  const gx = new Float32Array(n), gy = new Float32Array(n), mag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m1 = Math.sqrt(g1.gx[i] * g1.gx[i] + g1.gy[i] * g1.gy[i]), m2 = Math.sqrt(g2.gx[i] * g2.gx[i] + g2.gy[i] * g2.gy[i]);
    // La saturación va con el signo al revés: el papel es claro y sin color, así
    // los dos canales marcan el mismo sentido de contraste en el borde de la hoja
    if (m1 >= m2) { gx[i] = g1.gx[i]; gy[i] = g1.gy[i]; mag[i] = m1; }
    else { gx[i] = -g2.gx[i]; gy[i] = -g2.gy[i]; mag[i] = m2; }
  }
  return { gx, gy, mag, brillo: bs, sat: ss };
}

/** Deja solo los máximos del gradiente a lo ancho del borde (líneas de 1 px) */
function supresionNoMaxima({ gx, gy, mag }, w, h) {
  const nms = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, m = mag[i];
    if (m < 1) continue;
    const ax = Math.abs(gx[i]), ay = Math.abs(gy[i]);
    let a, b;
    if (ay <= ax * 0.4142) { a = mag[i - 1]; b = mag[i + 1]; }
    else if (ay >= ax * 2.4142) { a = mag[i - w]; b = mag[i + w]; }
    else if (gx[i] * gy[i] > 0) { a = mag[i - w - 1]; b = mag[i + w + 1]; }
    else { a = mag[i - w + 1]; b = mag[i + w - 1]; }
    if (m >= a && m >= b) nms[i] = m;
  }
  return nms;
}

/** Percentiles de los bordes (sin contar ceros), con un histograma: sin ordenar nada */
function percentiles(nms, ps) {
  const hist = new Uint32Array(2048);
  let n = 0;
  for (let i = 0; i < nms.length; i++) if (nms[i] > 0) { hist[Math.min(2047, nms[i] | 0)]++; n++; }
  return ps.map(p => {
    if (!n) return 0;
    const meta = p * n;
    let acum = 0;
    for (let v = 0; v < 2048; v++) { acum += hist[v]; if (acum > meta) return v + 0.5; }
    return 2047;
  });
}

/** Histéresis de Canny: bordes fuertes y los débiles que se conectan a ellos */
function histeresis(nms, w, h, alto, bajo) {
  const borde = new Uint8Array(w * h);
  const pila = [];
  for (let i = 0; i < nms.length; i++) {
    if (nms[i] >= alto && !borde[i]) {
      borde[i] = 1; pila.push(i);
      while (pila.length) {
        const j = pila.pop(), x = j % w;
        for (let dy = -w; dy <= w; dy += w) for (let dx = -1; dx <= 1; dx++) {
          if ((x === 0 && dx < 0) || (x === w - 1 && dx > 0)) continue;
          const k = j + dy + dx;
          if (k >= 0 && k < nms.length && !borde[k] && nms[k] >= bajo) { borde[k] = 1; pila.push(k); }
        }
      }
    }
  }
  return borde;
}

function dilatar(m, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w) out[yy * w + xx] = 1;
    }
  }
  return out;
}

/**
 * Grupos conectados de píxeles marcados. De cada grupo grande se guardan solo
 * sus extremos por fila y por columna: bastan para la envolvente convexa.
 */
let _memoria = null;
function memoria(n) {
  if (!_memoria || _memoria.n < n) _memoria = { n, visto: new Uint8Array(n), pila: new Int32Array(n), miembros: new Int32Array(n) };
  _memoria.visto.fill(0, 0, n);
  return _memoria;
}

function grupos(m, w, h, minPixeles, vecinos8, minAncho = 0, minAlto = 0) {
  const { visto, pila, miembros } = memoria(w * h);
  const filMin = new Int32Array(h), filMax = new Int32Array(h), colMin = new Int32Array(w), colMax = new Int32Array(w);
  const res = [];
  for (let inicio = 0; inicio < m.length; inicio++) {
    if (!m[inicio] || visto[inicio]) continue;
    let n = 0, tope = 0, xmin = w, xmax = 0, ymin = h, ymax = 0;
    visto[inicio] = 1; pila[tope++] = inicio;
    while (tope) {
      const j = pila[--tope], x = j % w, y = (j - x) / w;
      miembros[n++] = j;
      if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || (!vecinos8 && dx && dy)) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const k = yy * w + xx;
          if (m[k] && !visto[k]) { visto[k] = 1; pila[tope++] = k; }
        }
      }
    }
    if (n < minPixeles || xmax - xmin + 1 < minAncho || ymax - ymin + 1 < minAlto) continue;
    filMin.fill(w, ymin, ymax + 1); filMax.fill(-1, ymin, ymax + 1);
    colMin.fill(h, xmin, xmax + 1); colMax.fill(-1, xmin, xmax + 1);
    for (let k = 0; k < n; k++) {
      const j = miembros[k], x = j % w, y = (j - x) / w;
      if (x < filMin[y]) filMin[y] = x; if (x > filMax[y]) filMax[y] = x;
      if (y < colMin[x]) colMin[x] = y; if (y > colMax[x]) colMax[x] = y;
    }
    const puntos = [];
    for (let y = ymin; y <= ymax; y++) if (filMax[y] >= 0) puntos.push({ x: filMin[y], y }, { x: filMax[y], y });
    for (let x = xmin; x <= xmax; x++) if (colMax[x] >= 0) puntos.push({ x, y: colMin[x] }, { x, y: colMax[x] });
    res.push({ n, puntos, ancho: xmax - xmin + 1, alto: ymax - ymin + 1 });
  }
  return res;
}

function otsu(brillo) {
  const hist = new Float64Array(256);
  for (let i = 0; i < brillo.length; i++) hist[Math.min(255, brillo[i] | 0)]++;
  const total = brillo.length;
  let suma = 0;
  for (let i = 0; i < 256; i++) suma += i * hist[i];
  let sumaB = 0, pesoB = 0, mejor = 0, umbral = 128;
  for (let t = 0; t < 256; t++) {
    pesoB += hist[t];
    if (!pesoB) continue;
    const pesoF = total - pesoB;
    if (!pesoF) break;
    sumaB += t * hist[t];
    const mB = sumaB / pesoB, mF = (suma - sumaB) / pesoF;
    const entre = pesoB * pesoF * (mB - mF) ** 2;
    if (entre > mejor) { mejor = entre; umbral = t; }
  }
  return umbral;
}

function cuadrilateroDe(puntos) {
  const env = envolventeConvexa(puntos);
  if (env.length < 4) return null;
  const q = ordenarEsquinas(reducirACuatro(env));
  return esConvexo(q) ? q : null;
}

/** Lado que corre pegado a un borde de la foto (la hoja se sale del cuadro) */
function ladoEnElMarco(p, q, w, h) {
  const mx = w * 0.02, my = h * 0.02;
  return (p.x < mx && q.x < mx) || (p.x > w - 1 - mx && q.x > w - 1 - mx) ||
    (p.y < my && q.y < my) || (p.y > h - 1 - my && q.y > h - 1 - my);
}

/**
 * Busca, a lo largo del lado p→q (a ±tol px), el borde más fuerte en cada
 * sentido de contraste. Un lado real tiene el mismo sentido en todo su largo
 * (hoja más clara que la mesa, o al revés); las rayas de un fondo revuelto
 * alternan. Por eso solo cuenta el sentido que más se repite.
 * Devuelve esos puntos y qué fracción del lado tiene borde.
 */
function recorrerLado(p, q, grad, w, h, tol, minimo, muestrasMax = Infinity, margen = 0.08) {
  const { gx, gy } = grad;
  const largo = distancia(p, q);
  const tx = (q.x - p.x) / largo, ty = (q.y - p.y) / largo;
  const nx = -ty, ny = tx;
  const muestras = Math.min(muestrasMax, Math.max(12, Math.round(largo / 2)));
  const puntos = [[], []];
  const proy = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) return 0;
    const i = yi * w + xi;
    const a = gx[i], b = gy[i];
    const g = Math.sqrt(a * a + b * b);
    if (g < 1e-6) return 0;
    const pr = a * nx + b * ny;
    return Math.abs(pr) >= 0.85 * g ? pr : 0; // la dirección del borde tiene que coincidir con la del lado
  };
  // Por cada muestra, el mejor borde en cada sentido de contraste (0: negativo, 1: positivo)
  const subpixel = (cx, cy, d, mejor, signo) => {
    const a = Math.max(0, (signo ? 1 : -1) * proy(cx + nx * (d - 1), cy + ny * (d - 1)));
    const c = Math.max(0, (signo ? 1 : -1) * proy(cx + nx * (d + 1), cy + ny * (d + 1)));
    const den = a - 2 * mejor + c;
    const off = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0;
    return { x: cx + nx * (d + off), y: cy + ny * (d + off) };
  };
  const fuerza = [0, 0];
  for (let s = 0; s < muestras; s++) {
    const t = margen + (1 - 2 * margen) * (s + 0.5) / muestras;
    const cx = p.x + (q.x - p.x) * t, cy = p.y + (q.y - p.y) * t;
    let pos = 0, dPos = 0, neg = 0, dNeg = 0;
    for (let d = -tol; d <= tol; d++) {
      const v = proy(cx + nx * d, cy + ny * d);
      if (v > pos) { pos = v; dPos = d; } else if (-v > neg) { neg = -v; dNeg = d; }
    }
    if (pos >= minimo) { puntos[1].push(subpixel(cx, cy, dPos, pos, 1)); fuerza[1] += pos; }
    if (neg >= minimo) { puntos[0].push(subpixel(cx, cy, dNeg, neg, 0)); fuerza[0] += neg; }
  }
  const n0 = puntos[0].length, n1 = puntos[1].length;
  const dominante = n0 > n1 || (n0 === n1 && fuerza[0] >= fuerza[1]) ? puntos[0] : puntos[1];
  return { puntos: dominante, apoyo: dominante.length / muestras };
}

/**
 * Recta que pasa cerca de la mayor cantidad de puntos (si en la banda de
 * búsqueda se colaron puntos de otro borde, no la tuercen). Se prueban rectas
 * por pares de puntos repartidos y se ajusta la ganadora con sus puntos.
 */
function rectaRobusta(puntos) {
  const n = puntos.length;
  const cerca = (r, pt) => Math.abs((pt.x - r.px) * -r.dy + (pt.y - r.py) * r.dx) < 1.5;
  let mejor = null, mejorCuenta = -1;
  const pasos = Math.min(12, n >> 1);
  for (let a = 0; a < pasos; a++) for (let b = a + 1; b <= pasos; b++) {
    const p = puntos[Math.floor(a * (n - 1) / pasos)], q = puntos[Math.floor(b * (n - 1) / pasos)];
    const L = distancia(p, q);
    if (L < 1e-6) continue;
    const r = { px: p.x, py: p.y, dx: (q.x - p.x) / L, dy: (q.y - p.y) / L };
    let cuenta = 0;
    for (const pt of puntos) if (cerca(r, pt)) cuenta++;
    if (cuenta > mejorCuenta) { mejorCuenta = cuenta; mejor = r; }
  }
  if (!mejor) return ajustarRecta(puntos);
  // Mínimos cuadrados con los puntos de la ganadora, y una vuelta más con la recta ya ajustada
  let r = ajustarRecta(puntos.filter(pt => cerca(mejor, pt)));
  const dentro = puntos.filter(pt => cerca(r, pt));
  if (dentro.length >= 3) r = ajustarRecta(dentro);
  return r;
}

/** Ajusta una recta a cada lado y cruza las rectas para obtener esquinas más exactas */
function afinar(q, grad, w, h, minimo) {
  const diag = Math.hypot(w, h);
  let actual = q;
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const nuevas = afinarUnaVez(actual, grad, w, h, minimo);
    if (nuevas === actual) break;
    if (nuevas.some((p, i) => distancia(p, q[i]) > diag * 0.08)) break;
    const movio = Math.max(...nuevas.map((p, i) => distancia(p, actual[i])));
    actual = nuevas;
    if (movio < 0.5) break;
  }
  return actual;
}

function afinarUnaVez(q, grad, w, h, minimo) {
  const diag = Math.hypot(w, h);
  const rectas = [];
  for (let i = 0; i < 4; i++) {
    const p = q[i], r = q[(i + 1) % 4];
    const directa = { px: p.x, py: p.y, dx: (r.x - p.x) / distancia(p, r), dy: (r.y - p.y) / distancia(p, r) };
    if (ladoEnElMarco(p, r, w, h)) { rectas.push(directa); continue; }
    let { puntos } = recorrerLado(p, r, grad, w, h, Math.max(3, Math.round(diag * 0.015)), minimo);
    if (puntos.length < 8) { rectas.push(directa); continue; }
    rectas.push(rectaRobusta(puntos));
  }
  const nuevas = [];
  for (let i = 0; i < 4; i++) {
    const c = interseccion(rectas[(i + 3) % 4], rectas[i]);
    if (!c || distancia(c, q[i]) > diag * 0.05) return q;
    nuevas.push({ x: Math.max(0, Math.min(w - 1, c.x)), y: Math.max(0, Math.min(h - 1, c.y)) });
  }
  return esConvexo(nuevas) ? nuevas : q;
}

/**
 * Qué fracción del lado separa dos zonas distintas: lo de adentro (la hoja) y
 * lo de afuera (la mesa). Un renglón de texto tiene borde, pero a los dos
 * lados hay papel; el borde real de la hoja tiene papel de un lado y mesa del otro.
 */
function contrasteDeZonas(p, q, centro, grad, w, h) {
  const { brillo, sat } = grad;
  const largo = distancia(p, q);
  let nx = -(q.y - p.y) / largo, ny = (q.x - p.x) / largo;
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  if ((centro.x - mx) * nx + (centro.y - my) * ny > 0) { nx = -nx; ny = -ny; } // n apunta hacia afuera
  const k = Math.max(3, Math.round(Math.hypot(w, h) * 0.01));
  const muestras = Math.max(12, Math.round(largo / 3));
  const valor = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return null;
    const i = yi * w + xi;
    return [brillo[i], sat[i]];
  };
  let distintas = 0, validas = 0;
  for (let s = 0; s < muestras; s++) {
    const t = 0.05 + 0.9 * (s + 0.5) / muestras;
    const cx = p.x + (q.x - p.x) * t, cy = p.y + (q.y - p.y) * t;
    const a = valor(cx - nx * k, cy - ny * k), b = valor(cx + nx * k, cy + ny * k);
    if (!a || !b) continue;
    validas++;
    if (Math.abs(a[0] - b[0]) + 0.5 * Math.abs(a[1] - b[1]) > 18) distintas++;
  }
  return validas ? distintas / validas : 0;
}

function calificar(q, grad, w, h, minimo) {
  const fraccion = area(q) / (w * h);
  if (fraccion < 0.08 || fraccion > 0.995) return null;
  const angs = angulos(q);
  if (angs.some(a => a < 30 || a > 150)) return null;
  const apoyos = [];
  const centro = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
  let enMarco = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i], r = q[(i + 1) % 4];
    if (ladoEnElMarco(p, r, w, h)) { enMarco++; apoyos.push(0.45); continue; }
    const borde = recorrerLado(p, r, grad, w, h, 2, minimo, Infinity, 0.03).apoyo;
    apoyos.push(0.5 * borde + 0.5 * contrasteDeZonas(p, r, centro, grad, w, h));
  }
  if (enMarco >= 3) return null;
  const media = apoyos.reduce((s, a) => s + a, 0) / 4;
  if (media < 0.45 || Math.min(...apoyos) < 0.25) return null;
  const forma = angs.every(a => a > 45 && a < 135) ? 1 : 0.7;
  return { puntaje: media * media * Math.sqrt(fraccion) * forma, confianza: media };
}

/**
 * Rectas largas con la transformada de Hough. Cada píxel de borde vota solo
 * cerca del ángulo de su gradiente, y el ángulo va de 0 a 360°: así el sentido
 * del contraste cuenta. Un lado de la hoja suma todos sus votos en un solo
 * sentido; las rayas de un fondo revuelto reparten los suyos entre los dos.
 * Sirve también cuando un lado se pierde en una sombra: la recta se prolonga
 * hasta la esquina.
 */
function lineasHough(bordes, grad, w, h) {
  const diag = Math.ceil(Math.hypot(w, h));
  const NT = 360, NR = 2 * diag + 1;
  const acc = new Uint16Array(NT * NR);
  const cosT = new Float32Array(NT), sinT = new Float32Array(NT);
  for (let t = 0; t < NT; t++) { cosT[t] = Math.cos(t * 2 * Math.PI / NT); sinT[t] = Math.sin(t * 2 * Math.PI / NT); }
  for (let i = 0; i < bordes.length; i++) {
    if (!bordes[i]) continue;
    const x = i % w, y = (i - x) / w;
    let th = Math.atan2(grad.gy[i], grad.gx[i]);
    if (th < 0) th += 2 * Math.PI;
    const tc = Math.round(th * NT / (2 * Math.PI));
    for (let d = -2; d <= 2; d++) {
      const t = (tc + d + NT) % NT;
      acc[t * NR + Math.round(x * cosT[t] + y * sinT[t]) + diag]++;
    }
  }
  const minVotos = Math.max(20, Math.round(0.1 * Math.min(w, h)));
  const picos = [];
  for (let t = 0; t < NT; t++) for (let r = 0; r < NR; r++) {
    const v = acc[t * NR + r];
    if (v < minVotos) continue;
    let esMax = true;
    for (let dt = -2; dt <= 2 && esMax; dt++) for (let dr = -4; dr <= 4; dr++) {
      const tt = (t + dt + NT) % NT, rr = r + dr;
      if ((dt || dr) && rr >= 0 && rr < NR && acc[tt * NR + rr] > v) { esMax = false; break; }
    }
    if (esMax) picos.push({ th: t * 2 * Math.PI / NT, rho: r - diag, votos: v });
  }
  picos.sort((a, b) => b.votos - a.votos);
  // Sin repetidas: la misma recta puede salir con los dos sentidos de contraste
  const cx = w / 2, cy = h / 2, lineas = [];
  for (const pk of picos) {
    const nx = Math.cos(pk.th), ny = Math.sin(pk.th);
    const dist = cx * nx + cy * ny - pk.rho;
    const th = pk.th % Math.PI;
    const recta = { px: cx - dist * nx, py: cy - dist * ny, dx: -ny, dy: nx, th };
    const repetida = lineas.some(l => {
      const dth = Math.abs(l.th - th);
      return Math.min(dth, Math.PI - dth) < 0.06 && Math.hypot(l.px - recta.px, l.py - recta.py) < 6;
    });
    if (!repetida) lineas.push(recta);
    if (lineas.length >= 14) break;
  }
  return lineas;
}

/** Cuadriláteros formados por dos pares de rectas casi opuestas */
function cuadrilaterosDeLineas(lineas, grad, w, h, minimo) {
  const difAng = (a, b) => { const d = Math.abs(((a - b) % Math.PI + Math.PI) % Math.PI); return Math.min(d, Math.PI - d); };
  const pares = [];
  for (let i = 0; i < lineas.length; i++) for (let j = i + 1; j < lineas.length; j++) {
    const a = lineas[i], b = lineas[j];
    if (difAng(a.th, b.th) > 0.6) continue; // ~35°: la perspectiva abre los lados opuestos
    const sep = Math.abs((b.px - a.px) * -a.dy + (b.py - a.py) * a.dx);
    if (sep < 0.15 * Math.min(w, h)) continue;
    const m = Math.atan2(Math.sin(2 * a.th) + Math.sin(2 * b.th), Math.cos(2 * a.th) + Math.cos(2 * b.th)) / 2;
    pares.push({ a, b, th: m });
  }
  const res = [];
  const mx = 0.03 * w, my = 0.03 * h;
  for (let i = 0; i < pares.length; i++) for (let j = i + 1; j < pares.length; j++) {
    const P = pares[i], Q = pares[j];
    if (P.a === Q.a || P.a === Q.b || P.b === Q.a || P.b === Q.b) continue;
    if (difAng(P.th, Q.th) < 0.8) continue; // ~45°
    const esq = [interseccion(P.a, Q.a), interseccion(P.a, Q.b), interseccion(P.b, Q.b), interseccion(P.b, Q.a)];
    if (esq.some(c => !c || c.x < -mx || c.y < -my || c.x > w - 1 + mx || c.y > h - 1 + my)) continue;
    const q = ordenarEsquinas(esq.map(c => ({ x: Math.max(0, Math.min(w - 1, c.x)), y: Math.max(0, Math.min(h - 1, c.y)) })));
    if (!esConvexo(q)) continue;
    // Nota rápida con pocas muestras para quedarse con los mejores
    let s = 0;
    for (let k = 0; k < 4; k++) {
      const p1 = q[k], p2 = q[(k + 1) % 4];
      s += ladoEnElMarco(p1, p2, w, h) ? 0.45 : recorrerLado(p1, p2, grad, w, h, 2, minimo, 24).apoyo;
    }
    res.push({ q, nota: (s / 4) ** 2 * Math.sqrt(area(q) / (w * h)) });
  }
  return res.sort((a, b) => b.nota - a.nota).slice(0, 6).map(r => r.q);
}

export function detectarHoja(img) {
  const { width: w, height: h } = img;
  if (w < 16 || h < 16) return null;
  const grad = gradiente(img);
  const nms = supresionNoMaxima(grad, w, h);
  const [p50, p75, p90] = percentiles(nms, [0.5, 0.75, 0.9]);
  if (!p90) return null;
  // Mínimo de contraste para decir que un lado "tiene borde"
  const minimo = Math.max(12, p50 * 0.8);
  const minPix = (w + h) * 0.3;

  const candidatos = [];
  for (const alto of [p90, p75, p50]) {
    const finos = histeresis(nms, w, h, alto, alto * 0.5);
    if (alto === p75) candidatos.push(...cuadrilaterosDeLineas(lineasHough(finos, grad, w, h), grad, w, h, minimo));
    const bordes = dilatar(finos, w, h);
    for (const g of grupos(bordes, w, h, minPix, true, w * 0.25, h * 0.25)) {
      const q = cuadrilateroDe(g.puntos);
      if (q) candidatos.push(q);
    }
  }
  // La zona clara (hoja blanca) y la oscura más grandes, separadas con Otsu.
  // Un segundo Otsu dentro de lo claro separa la hoja de una mesa gris.
  const u = otsu(grad.brillo);
  const claros = grad.brillo.filter((v, i) => v > u && (i & 3) === 0);
  const u2 = claros.length > w * h * 0.1 ? otsu(claros) : u;
  const zonas = u2 === u ? [[u, true], [u, false]] : [[u, true], [u, false], [u2, true]];
  const mw = w >> 1, mh = h >> 1;
  const mascara = new Uint8Array(mw * mh);
  for (const [umbral, claro] of zonas) {
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      mascara[y * mw + x] = (grad.brillo[(2 * y) * w + 2 * x] > umbral) === claro ? 1 : 0;
    }
    const gs = grupos(mascara, mw, mh, mw * mh * 0.08, false).sort((a, b) => b.n - a.n).slice(0, 2);
    for (const g of gs) {
      const q = cuadrilateroDe(g.puntos.map(p => ({ x: 2 * p.x + 0.5, y: 2 * p.y + 0.5 })));
      if (q) candidatos.push(q);
    }
  }

  let mejor = null;
  for (const c of candidatos) {
    const q = afinar(c, grad, w, h, minimo);
    const nota = calificar(q, grad, w, h, minimo);
    if (nota && (!mejor || nota.puntaje > mejor.puntaje)) mejor = { ...nota, q };
  }
  if (!mejor) return null;
  return {
    esquinas: mejor.q.map(p => ({ x: (p.x + 0.5) / w, y: (p.y + 0.5) / h })),
    confianza: mejor.confianza
  };
}
