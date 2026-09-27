import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crearEscena, desenfocar } from './escenas.js';
import { prepararParaLeer } from '../js/imagen/lectura.js';

// Una hoja de frente, con "texto", como la página ya enderezada
const hoja = () => crearEscena({ ancho: 400, alto: 520, esquinas: [{ x: -2, y: -2 }, { x: 402, y: -2 }, { x: 402, y: 522 }, { x: -2, y: 522 }], sombra: 0.3, semilla: 5 });

/** Cambio más fuerte de brillo entre vecinos en una fila con letras */
function bordeMax({ data, width }, y) {
  let m = 0;
  for (let x = 1; x < width; x++) m = Math.max(m, Math.abs(data[(y * width + x) * 4] - data[(y * width + x - 1) * 4]));
  return m;
}

describe('Página lista para el lector de texto', () => {
  it('queda en gris, del mismo tamaño, con el papel blanco aunque tenga sombra', () => {
    const r = prepararParaLeer(hoja());
    assert.equal(r.width, 400); assert.equal(r.height, 520);
    for (let i = 0; i < r.data.length; i += 4 * 101) {
      assert.equal(r.data[i], r.data[i + 1]); assert.equal(r.data[i], r.data[i + 2]);
    }
    // La esquina con sombra (arriba a la izquierda) y la otra quedan igual de blancas
    const px = (x, y) => r.data[(y * 400 + x) * 4];
    assert.ok(px(8, 8) > 240 && px(392, 512) > 240, `${px(8, 8)} ${px(392, 512)}`);
  });

  it('a las letras suaves les devuelve el borde firme', () => {
    const suave = desenfocar(hoja(), 1);
    const y = Math.round(520 * (4.5 / 40)); // un renglón con letras
    const antes = bordeMax(suave, y), despues = bordeMax(prepararParaLeer(desenfocar(hoja(), 1)), y);
    assert.ok(despues > antes * 1.5, `borde ${antes} → ${despues}`);
  });
});

describe('Texto que devuelve el lector', () => {
  // El lector usa el navegador solo al leer: resultado() se prueba aquí
  const palabra = (text, confidence = 95) => ({ text, confidence, bbox: { x0: 0, y0: 0, x1: 10, y1: 8 } });
  const linea = (words, confidence = 90) => ({ bbox: { y0: 0, y1: 8 }, baseline: null, confidence, words });
  const leer = async parrafos => (await import('../js/ocr.js')).resultado({ blocks: [{ paragraphs: parrafos.map(lines => ({ lines })) }] }, 'spa');

  it('quita las rayas y bordes que "lee" como texto, y respeta renglones y párrafos', async () => {
    const r = await leer([
      [linea([palabra('Hola'), palabra('|'), palabra('mundo')]), linea([palabra('—'), palabra('==')])],
      [linea([palabra('1821.')])]
    ]);
    assert.equal(r.texto, 'Hola mundo\n\n1821.');
    assert.equal(r.lineas.length, 2, 'el renglón de puras rayas no queda');
    assert.deepEqual(r.lineas[0].palabras.map(p => p.t), ['Hola', 'mundo']);
  });

  it('quita la basura de poca confianza: renglones enteros y pedacitos en las puntas', async () => {
    const r = await leer([[
      linea([palabra('Etapas'), palabra('del'), palabra('procedimiento'), palabra('E', 20), palabra('|', 60)]),
      linea([palabra('L-', 0), palabra('aa', 34), palabra('do', 64)], 21),        // renglón basura
      linea([palabra('Rano', 14), palabra('competente'), palabra('tributarios', 19), palabra('Ses', 20)])
    ]]);
    assert.equal(r.texto, 'Etapas del procedimiento\ncompetente tributarios');
  });

  it('une la palabra cortada con guion al final del renglón', async () => {
    const r = await leer([[linea([palabra('las'), palabra('instalacio-')]), linea([palabra('nes'), palabra('o'), palabra('domicilio;')]), linea([palabra('Ad-')]), linea([palabra('Aduanera')])]]);
    assert.equal(r.texto, 'las instalaciones o domicilio;\nAd-\nAduanera');
    assert.equal(r.lineas.length, 4, 'en el PDF cada palabra sigue en su lugar');
  });
});
