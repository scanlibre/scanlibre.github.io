import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { huella, parecido, esRepetida, PARECIDO } from '../js/imagen/repetidas.js';
import { crearEntorno, importarFoto, leerBase, fotoConTexto } from './ayuda.js';

/** Una página de libro: renglones fijos y palabras de largo al azar (según la semilla), tomada con otra luz y corrida */
function pagina(semilla, { w = 360, h = 480, dx = 0, dy = 0, escala = 1, luz = 1, ruido = 0 } = {}) {
  let s = semilla * 7919 + 13;
  const azar = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  const cajas = [];
  for (let r = 0; r < 26; r++) {
    const y = 40 + r * 15;
    let x = 30;
    while (x < 330) { const l = 12 + azar() * 45; if (x + l > 330) break; cajas.push([x, y, l]); x += l + 6 + azar() * 4; }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  let t = semilla * 31 + 7;
  const rnd = () => { t = (t * 1664525 + 1013904223) >>> 0; return t / 4294967296 - 0.5; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x - dx) / escala, v = (y - dy) / escala;
    let tinta = false;
    for (const [bx, by, l] of cajas) if (u >= bx && u < bx + l && v >= by && v < by + 8) { tinta = true; break; }
    const c = (tinta ? 40 : 235) * luz + rnd() * ruido;
    const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = c; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}
const blanca = () => ({ data: new Uint8ClampedArray(360 * 480 * 4).fill(240), width: 360, height: 480 });

describe('Páginas repetidas: la huella', () => {
  const a = huella(pagina(1));
  it('la misma página en otra foto (corrida, con otra luz y ruido) es la misma', () => {
    for (const o of [{ dx: 6, dy: 4, escala: 1.02, luz: 0.88, ruido: 20 }, { dx: -10, dy: 8, luz: 1.05, ruido: 30 }]) {
      const p = parecido(a, huella(pagina(1, o)));
      assert.ok(p >= PARECIDO + 0.1, `parecido ${p.toFixed(2)}`);
    }
  });
  it('otra página del mismo libro (los renglones en el mismo lugar) no', () => {
    for (let k = 2; k <= 8; k++) {
      const p = parecido(a, huella(pagina(k)));
      assert.ok(p < PARECIDO - 0.2, `página ${k}: ${p.toFixed(2)}`);
    }
  });
  it('dos páginas en blanco o de otra forma no se comparan', () => {
    assert.equal(esRepetida(huella(blanca()), huella(blanca())), false);
    assert.equal(parecido(a, huella(pagina(1, { w: 480, h: 360 }))), 0, 'una acostada y otra parada');
  });
});

describe('Páginas repetidas en la app', () => {
  let env, hojaA, hojaB;
  before(async () => {
    env = await crearEntorno();
    hojaA = await fotoConTexto('rep-a.png', ['Capítulo 3: la fotosíntesis.', 'Las plantas usan la luz del sol', 'para fabricar su alimento.']);
    hojaB = await fotoConTexto('rep-b.png', ['Capítulo 4: la respiración.', 'Los seres vivos toman oxígeno', 'y liberan dióxido de carbono.']);
  });
  after(async () => { await env.cerrar(); });

  it('marca la página que repite a otra; se quita o se dice que no es', async () => {
    const page = await env.pagina();
    await importarFoto(page, hojaA, hojaB, hojaA);
    await page.waitForSelector('#doc-repetidas:not([hidden])', { timeout: 20000 });
    assert.equal(await page.textContent('#doc-repetidas-texto'), 'La página 3 parece igual a la 1.');
    assert.equal(await page.locator('.miniatura-repetida').count(), 1);
    assert.match(await page.getAttribute('#doc-paginas li:nth-child(3) .miniatura', 'aria-label'), /parece igual a la 1/);
    const [p1, p2, p3] = (await leerBase(page)).documentos[0].paginas;
    // En la página también se dice
    await page.click('#doc-paginas li:nth-child(3) .miniatura');
    await page.waitForSelector('#pagina-repetida:not([hidden])');
    assert.equal(await page.textContent('#pagina-repetida-texto'), 'Parece igual a la página 1.');
    await page.click('#pagina-atras');
    // Quitarla (a la papelera, con Deshacer)
    await page.click('#doc-repetidas-quitar');
    await page.waitForFunction(() => document.querySelectorAll('#doc-paginas li[data-id]').length === 2);
    assert.deepEqual((await leerBase(page)).documentos[0].paginas, [p1, p2]);
    assert.equal(await page.isVisible('#doc-repetidas'), false);
    await page.click('.aviso-accion:has-text("Deshacer")');
    await page.waitForFunction(() => document.querySelectorAll('#doc-paginas li[data-id]').length === 3);
    // "No es repetida": se quita el aviso y no vuelve a salir al buscar
    await page.click('#doc-repetidas-no');
    await page.waitForSelector('#doc-repetidas', { state: 'hidden' });
    await page.click('#doc-menu');
    await page.click('.menu-opcion:has-text("Buscar páginas repetidas")');
    await page.waitForSelector('.aviso:has-text("No hay páginas repetidas")');
    assert.deepEqual((await leerBase(page)).documentos[0].paginas, [p1, p2, p3]);
    assert.deepEqual(page.errores, []);
  });

  it('dos páginas distintas no se marcan', async () => {
    const page = await env.pagina();
    await importarFoto(page, hojaA, hojaB);
    await page.click('#doc-menu');
    await page.click('.menu-opcion:has-text("Buscar páginas repetidas")');
    await page.waitForSelector('.aviso:has-text("No hay páginas repetidas")');
    assert.equal(await page.isVisible('#doc-repetidas'), false);
  });
});
