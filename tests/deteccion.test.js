import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crearEscena, ESCENAS } from './escenas.js';
import { detectarHoja } from '../js/imagen/deteccion.js';

function error(e, escala, semilla) {
  const W = Math.round(480 * escala), H = Math.round(640 * escala);
  const esquinas = e.esquinas.map(p => ({ x: p.x * escala, y: p.y * escala }));
  const r = detectarHoja(crearEscena({ ...e, ancho: W, alto: H, esquinas, semilla }));
  if (!r) return Infinity;
  const px = r.esquinas.map(p => ({ x: p.x * W, y: p.y * H }));
  return Math.max(...px.map((p, i) => Math.hypot(p.x - esquinas[i].x, p.y - esquinas[i].y))) / Math.hypot(W, H);
}

describe('Detección de la hoja', () => {
  for (const [k, e] of ESCENAS.entries()) {
    if (e.fondo === 'revuelto') continue;
    it(`encuentra la hoja: ${e.nombre}`, () => {
      // Foto al tamaño de la captura (480 px) y al de la vista en vivo (400 px)
      for (const escala of [1, 0.625]) {
        const err = error(e, escala, k + 1);
        assert.ok(err < 0.015, `a ${Math.round(640 * escala)} px el error fue ${(err * 100).toFixed(1)}% de la diagonal`);
      }
    });
  }

  it('con un fondo muy revuelto al menos se acerca (caso difícil)', () => {
    const e = ESCENAS.find(x => x.fondo === 'revuelto');
    assert.ok(error(e, 0.625, 5) < 0.02);
  });

  it('sin hoja en la foto no inventa una', () => {
    for (const fondo of ['madera', 'oscuro', 'claro', 'azul', 'mesaBorde']) {
      const img = crearEscena({ fondo, esquinas: [{ x: -50, y: -50 }, { x: -40, y: -50 }, { x: -40, y: -40 }, { x: -50, y: -40 }] });
      assert.equal(detectarHoja(img), null, fondo);
    }
  });

  it('es rápida en la vista en vivo', () => {
    const img = crearEscena({ ...ESCENAS[1], ancho: 300, alto: 400, esquinas: ESCENAS[1].esquinas.map(p => ({ x: p.x * 0.625, y: p.y * 0.625 })) });
    detectarHoja(img);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) detectarHoja(img);
    const ms = (performance.now() - t0) / 5;
    assert.ok(ms < 150, `${ms.toFixed(0)} ms por cuadro`);
  });
});
