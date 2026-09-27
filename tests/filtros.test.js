import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarFiltro } from '../js/imagen/filtros.js';
import { enderezar, rotar90 } from '../js/imagen/perspectiva.js';
import { procesarPagina } from '../js/imagen/procesar.js';
import { crearEscena, ESCENAS } from './escenas.js';

/** Hoja con sombra fuerte de izquierda a derecha y renglones de texto */
function hojaConSombra(w = 300, h = 400) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const luz = 0.45 + 0.55 * (x / w);
    const texto = y % 20 < 4 && x > 20 && x < w - 20 && (x >> 3) % 4 !== 0;
    const v = (texto ? 40 : 235) * luz;
    const i = (y * w + x) * 4;
    data[i] = v; data[i + 1] = v * 0.98; data[i + 2] = v * 0.9; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

const papel = (img, test) => {
  const vals = [];
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (test(x, y)) vals.push(img.data[(y * img.width + x) * 4]);
  const media = vals.reduce((s, v) => s + v, 0) / vals.length;
  return { media, min: Math.min(...vals) };
};
const esPapel = (x, y) => y % 20 >= 8 && y % 20 < 18;
const esTinta = (x, y, w) => y % 20 >= 1 && y % 20 < 3 && x > 30 && x < w - 30 && (x >> 3) % 4 === 1;

describe('Filtros', () => {
  it('"Mejorada" quita la sombra: el papel queda blanco parejo y el texto oscuro', () => {
    const out = aplicarFiltro(hojaConSombra(), 'mejorada');
    const p = papel(out, esPapel);
    assert.ok(p.media > 245 && p.min > 225, `papel ${p.media.toFixed(0)} (mín ${p.min})`);
    const t = papel(out, (x, y) => esTinta(x, y, out.width));
    assert.ok(t.media < 110, `tinta ${t.media.toFixed(0)}`);
  });

  it('"Mejorada" no satura los colores', () => {
    const w = 100, h = 100, data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w, y = (i / w) | 0;
      const azul = x > 30 && x < 70 && y > 30 && y < 70;
      data.set(azul ? [110, 140, 200, 255] : [236, 234, 228, 255], i * 4);
    }
    const out = aplicarFiltro({ data, width: w, height: h }, 'mejorada');
    const i = (50 * w + 50) * 4;
    const antes = 200 - 110, despues = out.data[i + 2] - out.data[i];
    assert.ok(despues <= antes * 1.15, `diferencia de color: antes ${antes}, después ${despues}`);
  });

  it('"B/N" deja solo blanco y negro, y la tinta queda negra', () => {
    const out = aplicarFiltro(hojaConSombra(), 'bn');
    for (let i = 0; i < out.data.length; i += 4) assert.ok(out.data[i] === 0 || out.data[i] === 255);
    assert.equal(papel(out, esPapel).media, 255);
    assert.ok(papel(out, (x, y) => esTinta(x, y, out.width)).media < 30);
  });

  it('girar 4 veces deja la imagen igual, y girar 1 vez cambia ancho por alto', () => {
    const img = hojaConSombra(30, 20);
    const una = rotar90(img, 1);
    assert.equal(una.width, 20); assert.equal(una.height, 30);
    let r = img;
    for (let i = 0; i < 4; i++) r = rotar90(r, 1);
    assert.deepEqual(r.data, img.data);
  });

  it('enderezar deja el papel ocupando toda la página (sin bordes de la mesa)', () => {
    const e = ESCENAS[1];
    const foto = crearEscena({ ...e, sombra: 0 });
    const plana = enderezar(foto, e.esquinas, 300, 400);
    // Los bordes de la página enderezada son papel claro, no la mesa oscura
    for (const [x, y] of [[4, 4], [295, 4], [295, 395], [4, 395], [150, 3], [3, 200]]) {
      const i = (y * 300 + x) * 4;
      assert.ok(plana.data[i] > 180, `(${x}, ${y}) = ${plana.data[i]}`);
    }
  });

  it('procesarPagina respeta el tamaño máximo', () => {
    const e = ESCENAS[0];
    const foto = crearEscena(e);
    const esquinas = e.esquinas.map(p => ({ x: p.x / 480, y: p.y / 640 }));
    const r = procesarPagina(foto, { esquinas, filtro: 'gris', rotacion: 1, maxLado: 200 });
    assert.ok(Math.max(r.width, r.height) <= 200);
    assert.ok(r.width > r.height, 'girada, la hoja queda acostada');
  });
});
