import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crearEscena, ESCENAS, desenfocar } from './escenas.js';
import { medirNitidez, UMBRAL_BORROSA } from '../js/imagen/nitidez.js';
import { nitidezDeHoja } from '../js/imagen/procesar.js';

describe('Nitidez', () => {
  const e = ESCENAS[1];
  const esquinas = e.esquinas.map(p => ({ x: p.x * 2, y: p.y * 2 }));
  const foto = crearEscena({ ...e, ancho: 960, alto: 1280, esquinas, semilla: 2 });
  const norm = esquinas.map(p => ({ x: p.x / 960, y: p.y / 1280 }));

  it('una foto nítida no se marca como borrosa', () => {
    const r = nitidezDeHoja(foto, norm);
    assert.ok(r.valor > UMBRAL_BORROSA + 0.03, `nitidez ${r.valor}`);
    assert.equal(r.borrosa, false);
  });

  it('la misma foto desenfocada sí se marca como borrosa', () => {
    const r = nitidezDeHoja(desenfocar(foto, 2), norm);
    assert.equal(r.borrosa, true, `nitidez ${r.valor}`);
  });

  it('no depende del brillo ni del contraste de la foto', () => {
    const oscura = { ...foto, data: foto.data.map((v, i) => (i % 4 === 3 ? v : v * 0.55)) };
    const a = nitidezDeHoja(foto, norm).valor, b = nitidezDeHoja(oscura, norm).valor;
    assert.ok(Math.abs(a - b) < 0.03, `${a} vs ${b}`);
  });

  it('en una hoja en blanco no se puede saber y no avisa', () => {
    const blanca = { data: new Uint8ClampedArray(600 * 800 * 4).fill(240), width: 600, height: 800 };
    assert.deepEqual(medirNitidez(blanca), { valor: null, borrosa: false });
  });
});
