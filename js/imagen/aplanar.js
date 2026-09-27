// ScanLibre · imagen/aplanar.js
// Endereza una página curva (un libro que no queda plano cerca del lomo o con
// una esquina levantada). Los renglones de texto dicen cómo se dobla la hoja:
//   1. en franjas verticales se buscan los centros de los renglones;
//   2. se unen de franja en franja y a cada renglón se le ajusta una curva;
//   3. con eso se arma un desplazamiento vertical suave y cada columna de
//      píxeles se corre para que los renglones queden rectos.
// Seguro: si no hay renglones claros, o ya están rectos, la página no se toca.

import { aplicarFiltro } from './filtros.js';

const ANCHO = 800;      // se mide a este ancho
const FRANJAS = 24;     // franjas verticales
const TINTA = 160;      // en el gris parejo, lo más oscuro que esto es tinta

/** Gris parejo (papel blanco) a ANCHO px, promediando por áreas */
function grisChico(img) {
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
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < w * h; j++) {
    const n = cuenta[j] || 1;
    rgba[j * 4] = suma[j * 3] / n; rgba[j * 4 + 1] = suma[j * 3 + 1] / n; rgba[j * 4 + 2] = suma[j * 3 + 2] / n; rgba[j * 4 + 3] = 255;
  }
  const g = aplicarFiltro({ data: rgba, width: w, height: h }, 'gris').data;
  const gris = new Uint8Array(w * h);
  for (let j = 0; j < gris.length; j++) gris[j] = g[j * 4];
  return { gris, w, h, k };
}

/** Promedio móvil de radio r sobre un arreglo (con los bordes repetidos) */
function suavizar(v, r) {
  if (r < 1) return v;
  const n = v.length, out = new Float32Array(n);
  let s = 0;
  for (let i = -r; i <= r; i++) s += v[Math.min(n - 1, Math.max(0, i))];
  for (let i = 0; i < n; i++) {
    out[i] = s / (2 * r + 1);
    s += v[Math.min(n - 1, i + r + 1)] - v[Math.max(0, i - r)];
  }
  return out;
}

/** Distancia entre renglones (px), por la autocorrelación del perfil de tinta en el centro */
function interlineado(tinta, w, h) {
  const perfil = new Float32Array(h);
  for (let y = 0; y < h; y++) for (let x = Math.round(w * 0.3); x < w * 0.7; x++) perfil[y] += tinta[y * w + x];
  let media = 0;
  for (const v of perfil) media += v;
  media /= h;
  for (let y = 0; y < h; y++) perfil[y] -= media;
  const R = t => { let s = 0; for (let y = 0; y + t < h; y++) s += perfil[y] * perfil[y + t]; return s / (h - t); };
  const r0 = R(0);
  if (r0 <= 0) return null;
  let mejor = null, anterior = R(5), actual = R(6);
  for (let t = 6; t < Math.min(120, h / 4); t++) {
    const siguiente = R(t + 1);
    if (actual > anterior && actual >= siguiente && actual > 0.25 * r0 && (!mejor || actual > mejor.v)) mejor = { t, v: actual };
    if (mejor && t > mejor.t * 1.6) break; // el primer pico fuerte es el renglón; los que siguen son múltiplos
    anterior = actual; actual = siguiente;
  }
  return mejor?.t ?? null;
}

/** Centros de renglón en una franja: picos del perfil de tinta (ya corrida a lo ancho) */
function picosDeFranja(perfil, P) {
  const m = Math.max(2, Math.round(0.35 * P)), picos = [];
  for (let y = m; y < perfil.length - m; y++) {
    const v = perfil[y];
    if (v < 0.1) continue;
    let esPico = true, minimo = v;
    for (let d = -m; d <= m && esPico; d++) if (d && perfil[y + d] > v) esPico = false;
    if (!esPico) continue;
    const a = Math.round(P / 2);
    for (let d = -a; d <= a; d++) minimo = Math.min(minimo, perfil[Math.min(perfil.length - 1, Math.max(0, y + d))]);
    if (v - minimo < 0.06) continue;
    // Ajuste fino con una parábola por los tres puntos
    const i = perfil[y - 1], s = perfil[y + 1], den = i - 2 * v + s;
    picos.push({ y: y + (den < 0 ? 0.5 * (i - s) / den : 0), usado: false });
    y += m;
  }
  return picos;
}

/** Polinomio de grado g por mínimos cuadrados (eliminación de Gauss); devuelve los coeficientes */
function ajustar(us, ys, g) {
  const n = g + 1, A = Array.from({ length: n }, () => new Float64Array(n + 1));
  for (let i = 0; i < us.length; i++) {
    const pot = [1];
    for (let j = 1; j <= 2 * g; j++) pot.push(pot[j - 1] * us[i]);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) A[r][c] += pot[r + c];
      A[r][n] += pot[r] * ys[i];
    }
  }
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((fila, r) => fila[n] / fila[r]);
}
const evaluar = (co, u) => co.reduce((s, c, i) => s + c * u ** i, 0);

/**
 * Busca los renglones y arma el desplazamiento.
 * @returns null si la página no tiene renglones claros o ya está plana; si
 *          no, { campo(x, y) → desplazamiento en px de la imagen chica, k, P, renglones }
 */
export function medirCurvatura(img) {
  const { gris, w, h, k } = grisChico(img);
  const tinta = new Uint8Array(w * h);
  for (let i = 0; i < tinta.length; i++) tinta[i] = gris[i] < TINTA ? 1 : 0;
  const P = interlineado(tinta, w, h);
  if (!P || P < 6) return null;

  // Tinta corrida a lo ancho (las letras de un renglón se juntan en una franja) y perfil por franja
  const ancho = w / FRANJAS, radio = Math.max(1, Math.round(P / 5));
  const franjas = [];
  for (let s = 0; s < FRANJAS; s++) {
    const x0 = Math.round(s * ancho), x1 = Math.round((s + 1) * ancho), perfil = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let c = 0;
      for (let x = x0; x < x1; x++) c += tinta[y * w + x];
      perfil[y] = c / (x1 - x0);
    }
    franjas.push({ x: (x0 + x1) / 2, picos: picosDeFranja(suavizar(suavizar(perfil, radio), radio), P) });
  }

  // Renglones: se empieza en la franja central con más picos y se sigue hacia los dos lados
  let semilla = FRANJAS >> 1;
  for (let s = FRANJAS / 4; s < FRANJAS * 3 / 4; s++) if (franjas[s].picos.length > franjas[semilla].picos.length) semilla = s;
  const tolerancia = 0.3 * P, renglones = [];
  for (const inicio of franjas[semilla].picos) {
    const puntos = [{ s: semilla, y: inicio.y }];
    inicio.usado = true;
    for (const paso of [1, -1]) {
      let ultimo = { s: semilla, y: inicio.y }, pendiente = 0, huecos = 0;
      for (let s = semilla + paso; s >= 0 && s < FRANJAS; s += paso) {
        const esperado = ultimo.y + pendiente * (s - ultimo.s);
        let mejor = null;
        for (const p of franjas[s].picos) if (!p.usado && Math.abs(p.y - esperado) < tolerancia && (!mejor || Math.abs(p.y - esperado) < Math.abs(mejor.y - esperado))) mejor = p;
        if (!mejor) { if (++huecos > 3) break; continue; }
        mejor.usado = true; huecos = 0;
        const nuevo = { s, y: mejor.y };
        pendiente = 0.5 * pendiente + 0.5 * (nuevo.y - ultimo.y) / (nuevo.s - ultimo.s);
        puntos.push(nuevo); ultimo = nuevo;
      }
    }
    if (puntos.length < Math.max(6, FRANJAS * 0.35)) continue;
    // Curva del renglón (grado 3), sin los puntos que se salen
    let us = puntos.map(p => franjas[p.s].x / w - 0.5), ys = puntos.map(p => p.y);
    let co = ajustar(us, ys, 3);
    if (!co) continue;
    const buenos = us.map((u, i) => Math.abs(evaluar(co, u) - ys[i]) < 0.25 * P);
    if (buenos.filter(Boolean).length < 6) continue;
    us = us.filter((_, i) => buenos[i]); ys = ys.filter((_, i) => buenos[i]);
    co = ajustar(us, ys, 3);
    if (!co) continue;
    const umin = Math.min(...us), umax = Math.max(...us);
    const residuo = Math.sqrt(us.reduce((s, u, i) => s + (evaluar(co, u) - ys[i]) ** 2, 0) / us.length);
    // El renglón debe quedar a la altura que tiene en el centro de la página (o lo más cerca que llegue)
    const destino = evaluar(co, Math.min(umax, Math.max(umin, 0)));
    renglones.push({ co, umin, umax, destino, residuo });
  }
  renglones.sort((a, b) => a.destino - b.destino);
  // Dos renglones casi a la misma altura: uno sobra
  const limpios = renglones.filter((r, i) => i === 0 || r.destino - renglones[i - 1].destino > 0.5 * P);
  if (limpios.length < 5) return null;
  const residuos = limpios.map(r => r.residuo).sort((a, b) => a - b);
  if (residuos[residuos.length >> 1] > 0.2 * P) return null; // renglones poco claros

  // Muestras del desplazamiento: en cada franja, a la altura final de cada renglón
  const columnas = franjas.map(f => ({ x: f.x, muestras: [] }));
  let maximo = 0;
  for (const r of limpios) {
    for (let s = 0; s < FRANJAS; s++) {
      const u = columnas[s].x / w - 0.5;
      if (u < r.umin - 0.5 / FRANJAS || u > r.umax + 0.5 / FRANJAS) continue;
      const d = Math.max(-3 * P, Math.min(3 * P, evaluar(r.co, u) - r.destino));
      columnas[s].muestras.push({ y: r.destino, d });
      maximo = Math.max(maximo, Math.abs(d));
    }
  }
  if (maximo < 0.2 * P) return null; // ya está plana: no se toca

  // Campo en una grilla (franjas × filas), relleno donde no hay renglones y suavizado
  const grilla = columnas.map(c => {
    const col = new Float32Array(h);
    const m = c.muestras;
    if (!m.length) return null;
    for (let y = 0, j = 0; y < h; y++) {
      while (j < m.length - 1 && m[j + 1].y <= y) j++;
      if (y <= m[0].y) col[y] = m[0].d;
      else if (j >= m.length - 1) col[y] = m[m.length - 1].d;
      else col[y] = m[j].d + (m[j + 1].d - m[j].d) * (y - m[j].y) / (m[j + 1].y - m[j].y);
    }
    return col;
  });
  for (let s = 0; s < FRANJAS; s++) if (!grilla[s]) {
    let a = s, b = s;
    while (a >= 0 && !grilla[a]) a--;
    while (b < FRANJAS && !grilla[b]) b++;
    grilla[s] = grilla[a >= 0 && (b >= FRANJAS || s - a <= b - s) ? a : b];
  }
  const suave = grilla.map((col, s) => {
    const mezcla = new Float32Array(h);
    const vecinos = [grilla[Math.max(0, s - 1)], col, grilla[Math.min(FRANJAS - 1, s + 1)]];
    for (let y = 0; y < h; y++) mezcla[y] = (vecinos[0][y] + 2 * vecinos[1][y] + vecinos[2][y]) / 4;
    return suavizar(mezcla, Math.round(P / 2));
  });
  const campo = (x, y) => {
    const fs = Math.min(FRANJAS - 1, Math.max(0, x / ancho - 0.5)), s0 = Math.floor(fs), s1 = Math.min(FRANJAS - 1, s0 + 1), a = fs - s0;
    const fy = Math.min(h - 1, Math.max(0, y)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), b = fy - y0;
    const c0 = suave[s0][y0] + (suave[s0][y1] - suave[s0][y0]) * b;
    const c1 = suave[s1][y0] + (suave[s1][y1] - suave[s1][y0]) * b;
    return c0 + (c1 - c0) * a;
  };
  return { campo, k, P, renglones: limpios.length, maximo };
}

/**
 * La página con los renglones rectos.
 * @returns { imagen, aplanada } — si no hacía falta (o no se pudo), la misma imagen y aplanada: false
 */
export function aplanarPagina(img) {
  const m = medirCurvatura(img);
  if (!m) return { imagen: img, aplanada: false };
  const { data: src, width: W, height: H } = img, { campo, k } = m;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const i = (Y * W + X) * 4;
    let sy = Y + campo(X * k, Y * k) / k;
    // Lo que viene de afuera de la foto queda como papel blanco (repetir el borde deja rayas)
    if (sy < -0.5 || sy > H - 0.5) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 255; continue; }
    sy = Math.min(H - 1, Math.max(0, sy));
    const y0 = Math.floor(sy), y1 = Math.min(H - 1, y0 + 1), b = sy - y0;
    const i0 = (y0 * W + X) * 4, i1 = (y1 * W + X) * 4;
    out[i] = src[i0] + (src[i1] - src[i0]) * b;
    out[i + 1] = src[i0 + 1] + (src[i1 + 1] - src[i0 + 1]) * b;
    out[i + 2] = src[i0 + 2] + (src[i1 + 2] - src[i0 + 2]) * b;
    out[i + 3] = 255;
  }
  return { imagen: { data: out, width: W, height: H }, aplanada: true };
}
