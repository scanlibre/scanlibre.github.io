import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crearEscena, ESCENAS } from './escenas.js';
import { miniGris, diferenciaMedia, MOV_QUIETO } from '../js/imagen/movimiento.js';

// Cuadros como los de la detección en vivo (400 px de ancho)
const e = ESCENAS[0];
const cuadro = (corrimiento, semilla = 1) => miniGris(crearEscena({
  ...e, ancho: 400, alto: 533, semilla,
  esquinas: e.esquinas.map(p => ({ x: (p.x + corrimiento) * 400 / 480, y: p.y * 533 / 640 }))
}));

describe('Movimiento entre cuadros', () => {
  const base = cuadro(0);

  it('con el teléfono quieto solo queda el ruido del sensor', () => {
    assert.ok(diferenciaMedia(base, cuadro(0, 2)) < 1);
  });

  it('un cambio de exposición no cuenta como movimiento', () => {
    const oscuro = base.map(v => v * 0.8);
    assert.ok(diferenciaMedia(base, oscuro) < 0.2);
  });

  it('mover la hoja unos píxeles sí se nota', () => {
    const d5 = diferenciaMedia(base, cuadro(5, 3)), d20 = diferenciaMedia(base, cuadro(20, 3));
    assert.ok(d5 > MOV_QUIETO, `5 px: ${d5}`);
    assert.ok(d20 > d5 * 2, `20 px: ${d20}`);
  });

  it('cuadros de distinto tamaño no se comparan', () => {
    assert.equal(diferenciaMedia(base, new Float32Array(10)), Infinity);
    assert.equal(diferenciaMedia(null, base), Infinity);
  });
});
