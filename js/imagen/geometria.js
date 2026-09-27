// ScanLibre · imagen/geometria.js
// Cuentas de geometría para encontrar y enderezar la hoja. No tocan el DOM:
// se usan igual en el worker, en la página y en las pruebas con Node.
// Los puntos son {x, y} con y hacia abajo (como en la imagen).

/** Resuelve A·x = b con eliminación de Gauss y pivoteo parcial */
function resolver(A, b) {
  const n = b.length;
  const M = A.map((fila, i) => [...fila, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let f = c + 1; f < n; f++) if (Math.abs(M[f][c]) > Math.abs(M[piv][c])) piv = f;
    if (Math.abs(M[piv][c]) < 1e-12) throw new Error('Puntos alineados: no hay homografía');
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let f = c + 1; f < n; f++) {
      const k = M[f][c] / M[c][c];
      for (let j = c; j <= n; j++) M[f][j] -= k * M[c][j];
    }
  }
  const x = new Array(n);
  for (let f = n - 1; f >= 0; f--) {
    let s = M[f][n];
    for (let j = f + 1; j < n; j++) s -= M[f][j] * x[j];
    x[f] = s / M[f][f];
  }
  return x;
}

/** Homografía (arreglo de 9, por filas) que lleva los 4 puntos `de` a los 4 puntos `a` */
export function homografia(de, a) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = de[i], { x: u, y: v } = a[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...resolver(A, b), 1];
}

export function aplicar(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

export const distancia = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

const cruz = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Área de un polígono (fórmula del cordón de zapato) */
export function area(pol) {
  let s = 0;
  for (let i = 0; i < pol.length; i++) {
    const p = pol[i], q = pol[(i + 1) % pol.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

/** Envolvente convexa (cadena monótona de Andrew) */
export function envolventeConvexa(puntos) {
  const p = [...puntos].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const abajo = [], arriba = [];
  for (const q of p) {
    while (abajo.length >= 2 && cruz(abajo[abajo.length - 2], abajo[abajo.length - 1], q) <= 0) abajo.pop();
    abajo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (arriba.length >= 2 && cruz(arriba[arriba.length - 2], arriba[arriba.length - 1], q) <= 0) arriba.pop();
    arriba.push(q);
  }
  abajo.pop(); arriba.pop();
  return abajo.concat(arriba);
}

/** Deja un polígono convexo en 4 vértices quitando cada vez el que menos área aporta */
export function reducirACuatro(pol) {
  const v = [...pol];
  while (v.length > 4) {
    let menor = Infinity, iMenor = 0;
    for (let i = 0; i < v.length; i++) {
      const a = v[(i - 1 + v.length) % v.length], b = v[i], c = v[(i + 1) % v.length];
      const aporte = Math.abs(cruz(a, b, c));
      if (aporte < menor) { menor = aporte; iMenor = i; }
    }
    v.splice(iMenor, 1);
  }
  return v;
}

/** Ordena 4 esquinas como [arriba-izq, arriba-der, abajo-der, abajo-izq] */
export function ordenarEsquinas(q) {
  const cx = q.reduce((s, p) => s + p.x, 0) / q.length;
  const cy = q.reduce((s, p) => s + p.y, 0) / q.length;
  const r = [...q].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let inicio = 0;
  for (let i = 1; i < 4; i++) if (r[i].x + r[i].y < r[inicio].x + r[inicio].y) inicio = i;
  return [0, 1, 2, 3].map(i => r[(inicio + i) % 4]);
}

/** true si las 4 esquinas (ya ordenadas) forman un cuadrilátero convexo sin cruzarse */
export function esConvexo(q) {
  let signo = 0;
  for (let i = 0; i < 4; i++) {
    const c = cruz(q[i], q[(i + 1) % 4], q[(i + 2) % 4]);
    if (Math.abs(c) < 1e-9) return false;
    const s = Math.sign(c);
    if (signo === 0) signo = s;
    else if (s !== signo) return false;
  }
  return true;
}

/** Ángulo interior (en grados) en cada esquina */
export function angulos(q) {
  return q.map((p, i) => {
    const a = q[(i + 3) % 4], b = q[(i + 1) % 4];
    const v1 = { x: a.x - p.x, y: a.y - p.y }, v2 = { x: b.x - p.x, y: b.y - p.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
    return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
  });
}

/** Recta que mejor pasa por los puntos (mínimos cuadrados totales): {px, py, dx, dy} */
export function ajustarRecta(puntos) {
  const n = puntos.length;
  let mx = 0, my = 0;
  for (const p of puntos) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of puntos) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(ang), dy: Math.sin(ang) };
}

/** Punto donde se cortan dos rectas {px, py, dx, dy}; null si son paralelas */
export function interseccion(r1, r2) {
  const det = r1.dx * r2.dy - r1.dy * r2.dx;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((r2.px - r1.px) * r2.dy - (r2.py - r1.py) * r2.dx) / det;
  return { x: r1.px + t * r1.dx, y: r1.py + t * r1.dy };
}

/**
 * Tamaño (en píxeles) de la hoja ya enderezada. La proporción real se calcula
 * con el método de Zhang y He: la perspectiva deja estimar la distancia focal
 * y, con ella, cuánto mide de verdad cada lado. Si dos lados opuestos se ven
 * paralelos no se puede estimar la focal y se usa la típica de un teléfono.
 * `esquinas` ordenadas; `ancho`/`alto` son los de la foto (su centro es el eje óptico).
 */
export function tamanoEnderezado(esquinas, ancho, alto) {
  const [tl, tr, br, bl] = esquinas;
  const anchoVisto = Math.max(distancia(tl, tr), distancia(bl, br));
  const altoVisto = Math.max(distancia(tl, bl), distancia(tr, br));
  const proporcionVista = anchoVisto / altoVisto;

  const u0 = ancho / 2, v0 = alto / 2;
  const h = p => [p.x - u0, p.y - v0, 1];
  const m1 = h(tl), m2 = h(tr), m3 = h(bl), m4 = h(br);
  const x = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const pt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k2 = pt(x(m1, m4), m3) / pt(x(m2, m4), m3);
  const k3 = pt(x(m1, m4), m2) / pt(x(m3, m4), m2);
  const n2 = m2.map((c, i) => k2 * c - m1[i]);
  const n3 = m3.map((c, i) => k3 * c - m1[i]);

  const escala = Math.max(ancho, alto);
  // Punto de fuga muy lejos (lados casi paralelos): la focal no se puede estimar
  const fugaLejos = n => Math.abs(n[2]) * 50 * escala < Math.hypot(n[0], n[1]);
  let f2 = NaN;
  if (!fugaLejos(n2) && !fugaLejos(n3)) f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  if (!(f2 > (0.3 * escala) ** 2 && f2 < (5 * escala) ** 2)) f2 = (0.62 * Math.hypot(ancho, alto)) ** 2;
  let proporcion = Math.sqrt((n2[0] ** 2 / f2 + n2[1] ** 2 / f2 + n2[2] ** 2) / (n3[0] ** 2 / f2 + n3[1] ** 2 / f2 + n3[2] ** 2));
  if (!isFinite(proporcion) || proporcion < proporcionVista / 2 || proporcion > proporcionVista * 2) proporcion = proporcionVista;

  const w = Math.max(anchoVisto, altoVisto * proporcion);
  return { ancho: Math.max(1, Math.round(w)), alto: Math.max(1, Math.round(w / proporcion)) };
}
