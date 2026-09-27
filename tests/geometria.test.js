import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { homografia, aplicar, ordenarEsquinas, esConvexo, envolventeConvexa, reducirACuatro, tamanoEnderezado } from '../js/imagen/geometria.js';

const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

/** Proyecta una hoja carta (8.5 × 11) girada frente a una cámara de focal 520 px, foto 480×640 */
function fotoDeHoja(ax, ay, az, dist = 30) {
  const [cx, sx] = [Math.cos(ax), Math.sin(ax)], [cy, sy] = [Math.cos(ay), Math.sin(ay)], [cz, sz] = [Math.cos(az), Math.sin(az)];
  return [[-4.25, -5.5], [4.25, -5.5], [4.25, 5.5], [-4.25, 5.5]].map(([X, Y]) => {
    let x = X, y = Y, z = 0;
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    z += dist;
    return { x: 240 + 520 * x / z, y: 320 + 520 * y / z };
  });
}

describe('Geometría', () => {
  it('la homografía lleva cada esquina a su lugar', () => {
    const de = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 150 }, { x: 0, y: 150 }];
    const a = [{ x: 12, y: 30 }, { x: 210, y: 18 }, { x: 250, y: 330 }, { x: 5, y: 300 }];
    const H = homografia(de, a);
    de.forEach((p, i) => {
      const q = aplicar(H, p.x, p.y);
      cerca(q.x, a[i].x, 1e-6, 'x'); cerca(q.y, a[i].y, 1e-6, 'y');
    });
  });

  it('ordena las esquinas: arriba-izq, arriba-der, abajo-der, abajo-izq', () => {
    const q = ordenarEsquinas([{ x: 90, y: 95 }, { x: 10, y: 8 }, { x: 5, y: 100 }, { x: 100, y: 3 }]);
    assert.deepEqual(q, [{ x: 10, y: 8 }, { x: 100, y: 3 }, { x: 90, y: 95 }, { x: 5, y: 100 }]);
  });

  it('reconoce cuando las esquinas se cruzan', () => {
    assert.equal(esConvexo([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), true);
    assert.equal(esConvexo([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }]), false);
  });

  it('de una envolvente con esquinas redondeadas saca 4 esquinas', () => {
    const pts = [];
    for (let a = 0; a < Math.PI * 2; a += 0.05) pts.push({ x: 100 + 80 * Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** 0.2, y: 100 + 50 * Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** 0.2 });
    const q = ordenarEsquinas(reducirACuatro(envolventeConvexa(pts)));
    assert.equal(q.length, 4);
    cerca(q[0].x, 20, 12, 'arriba-izq x'); cerca(q[2].y, 150, 12, 'abajo-der y');
  });

  it('recupera la proporción real de una hoja carta fotografiada en ángulo', () => {
    for (const giro of [[0, 0, 0], [0.5, 0, 0], [0.6, 0.3, 0.1], [0.35, -0.4, 0.3], [0.8, 0.1, -0.2]]) {
      const { ancho, alto } = tamanoEnderezado(fotoDeHoja(...giro), 480, 640);
      cerca(ancho / alto, 8.5 / 11, 0.02, `giro ${giro}`);
    }
  });
});
