import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { paginaDeTexto, conDedo } from './escenas.js';
import { quitarDedos } from '../js/imagen/dedos.js';
import { crearEntorno, importarFoto, leerBase, guardarPNG } from './ayuda.js';

/** Diferencia media de color en un rectángulo (fracciones de la imagen) */
function diferencia(a, b, [x0, y0, x1, y1]) {
  let s = 0, n = 0;
  for (let y = Math.round(y0 * a.height); y < y1 * a.height; y++) for (let x = Math.round(x0 * a.width); x < x1 * a.width; x++) {
    const i = (y * a.width + x) * 4;
    s += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]); n += 3;
  }
  return s / n;
}

describe('Quitar dedos', () => {
  const hoja = paginaDeTexto(600, 820);

  it('el dedo en el borde se tapa con el papel, y el resto de la página no cambia', () => {
    const conMano = conDedo(hoja, { y: 0.8 });
    const r = quitarDedos(conMano);
    assert.equal(r.quitados, true);
    const zona = [0.9, 0.77, 1, 0.83];
    const antes = diferencia(conMano, hoja, zona), despues = diferencia(r.imagen, hoja, zona);
    assert.ok(despues < antes * 0.35, `el dedo: ${antes.toFixed(1)} → ${despues.toFixed(1)}`);
    assert.equal(diferencia(r.imagen, conMano, [0, 0, 0.8, 0.7]), 0, 'lejos del dedo no se toca nada');
  });

  it('también con piel morena y dedos en sombra', () => {
    for (const piel of [[150, 98, 72], [110, 72, 55], [78, 52, 42]]) {
      const conMano = conDedo(hoja, { y: 0.3, piel });
      const r = quitarDedos(conMano);
      assert.equal(r.quitados, true, `piel ${piel}`);
      const zona = [0.9, 0.27, 1, 0.33];
      assert.ok(diferencia(r.imagen, hoja, zona) < diferencia(conMano, hoja, zona) * 0.35, `piel ${piel}`);
    }
  });

  it('una hoja sin dedos no se toca', () => {
    const r = quitarDedos(hoja);
    assert.equal(r.quitados, false);
    assert.equal(r.imagen, hoja);
  });

  it('una hoja amarillenta (papel viejo) no se toma por un dedo', () => {
    const vieja = { ...hoja, data: hoja.data.map((v, i) => i % 4 === 0 ? v : i % 4 === 1 ? v * 0.93 : i % 4 === 2 ? v * 0.76 : v) };
    assert.equal(quitarDedos(vieja).quitados, false);
  });

  it('algo de color piel en medio de la página (un dibujo, letras rojas) no se toca', () => {
    const data = new Uint8ClampedArray(hoja.data);
    for (let y = 300; y < 420; y++) for (let x = 200; x < 400; x++) { const i = (y * 600 + x) * 4; data[i] = 200; data[i + 1] = 130; data[i + 2] = 100; }
    assert.equal(quitarDedos({ data, width: 600, height: 820 }).quitados, false);
  });
});

// ── En la app ───────────────────────────────────────────────────────
describe('Quitar dedos en la app', () => {
  let env;
  before(async () => { env = await crearEntorno(); });
  after(async () => { await env.cerrar(); });

  it('tapa el dedo de una página, lo dice, y se puede deshacer', async () => {
    const page = await env.pagina();
    await importarFoto(page, guardarPNG(paginaDeTexto(800, 1100), 'limpia.png'), guardarPNG(conDedo(paginaDeTexto(800, 1100), { y: 0.75 }), 'dedo.png'));
    const enOrden = async () => { const { documentos, paginas } = await leerBase(page); return documentos[0].paginas.map(id => paginas.find(p => p.id === id)); };
    assert.deepEqual((await enOrden()).map(p => p.sinDedos), [false, true], 'solo en la página con dedo');
    await page.click('#doc-paginas li:nth-child(2) .miniatura');
    await page.waitForSelector('#pagina-dedos:not([hidden])');
    assert.equal(await page.textContent('#pagina-dedos-texto'), 'Se taparon los dedos de los bordes.');
    await page.click('#pagina-dedos-boton');
    await page.waitForFunction(() => document.querySelector('#pagina-dedos-texto').textContent === 'Dedos sin tapar.', null, { timeout: 30000 });
    const p = (await enOrden())[1];
    assert.equal(p.dedos, false); assert.equal(p.sinDedos, false);
    await page.click('#pagina-anterior');
    await page.waitForFunction(() => document.querySelector('#pagina-titulo').textContent === 'Página 1 de 2');
    assert.equal(await page.isVisible('#pagina-dedos'), false, 'en la página sin dedos no dice nada');
    assert.deepEqual(page.errores, []);
  });
});
