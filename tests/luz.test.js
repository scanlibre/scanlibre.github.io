import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarFiltro, curvaDeLuz } from '../js/imagen/filtros.js';
import { procesarPagina } from '../js/imagen/procesar.js';
import { paginaDeTexto } from './escenas.js';
import { crearEntorno, importarFoto, leerBase, guardarPNG } from './ayuda.js';

const TODA = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const promedio = img => { let s = 0; for (let i = 0; i < img.data.length; i += 4) s += img.data[i]; return s / (img.data.length / 4); };
const negros = img => { let n = 0; for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 128) n++; return n; };

describe('Brillo y contraste', () => {
  it('la curva: sin cambios no toca nada; el brillo mueve los tonos medios y deja el blanco y el negro', () => {
    const igual = curvaDeLuz(0, 0);
    for (let v = 0; v < 256; v++) assert.equal(igual[v], v);
    const oscuro = curvaDeLuz(-40, 0), claro = curvaDeLuz(40, 0);
    assert.equal(oscuro[255], 255); assert.equal(oscuro[0], 0);
    assert.equal(claro[255], 255); assert.equal(claro[0], 0);
    assert.ok(oscuro[180] < 150, `lápiz suave más oscuro: ${oscuro[180]}`);
    assert.ok(claro[120] > 150, `más claro: ${claro[120]}`);
    // Contraste: la tinta más negra, lo gris claro más blanco, y el papel sigue blanco
    const fuerte = curvaDeLuz(0, 40);
    assert.ok(fuerte[60] < 40 && fuerte[200] > 225 && fuerte[255] === 255);
    const suave = curvaDeLuz(0, -40);
    assert.ok(suave[20] > 50 && suave[235] < 220);
  });

  it('con menos brillo, en "Mejorada" el texto sale más oscuro y el papel sigue blanco', () => {
    const hoja = paginaDeTexto(400, 550);
    const normal = aplicarFiltro(hoja, 'mejorada');
    const oscura = aplicarFiltro(hoja, 'mejorada', { brillo: -40 });
    assert.ok(promedio(oscura) < promedio(normal) - 3, `${promedio(oscura).toFixed(1)} < ${promedio(normal).toFixed(1)}`);
    // El papel (un margen sin texto) queda igual de blanco
    const margen = img => { let s = 0, n = 0; for (let y = 5; y < 20; y++) for (let x = 5; x < 395; x++) { s += img.data[(y * 400 + x) * 4]; n++; } return s / n; };
    assert.ok(margen(oscura) > 245, `papel ${margen(oscura).toFixed(0)}`);
    // Sin cambios, el mismo resultado de siempre
    assert.deepEqual(aplicarFiltro(hoja, 'mejorada', { brillo: 0, contraste: 0 }).data, normal.data);
  });

  it('en B/N el brillo cambia el grosor de las letras', () => {
    const hoja = paginaDeTexto(400, 550);
    const normal = negros(aplicarFiltro(hoja, 'bn'));
    const gruesas = negros(aplicarFiltro(hoja, 'bn', { brillo: -40 }));
    const finas = negros(aplicarFiltro(hoja, 'bn', { brillo: 40 }));
    assert.ok(gruesas > normal * 1.05 && finas < normal * 0.95, `${finas} < ${normal} < ${gruesas}`);
  });

  it('la página se arma con el brillo y el contraste que se eligieron', () => {
    const hoja = paginaDeTexto(400, 550);
    const a = procesarPagina(hoja, { esquinas: TODA, filtro: 'gris' });
    const b = procesarPagina(hoja, { esquinas: TODA, filtro: 'gris', brillo: -30, contraste: 20 });
    assert.equal(a.width, b.width);
    assert.ok(promedio(b) < promedio(a));
  });
});

describe('Brillo y contraste en la app', () => {
  let env;
  before(async () => { env = await crearEntorno(); });
  after(async () => { await env.cerrar(); });

  it('las barras muestran cómo queda y "Listo" guarda la página con ese brillo', async () => {
    const page = await env.pagina();
    await importarFoto(page, guardarPNG(paginaDeTexto(800, 1100), 'luz.png'));
    await page.click('#doc-paginas .miniatura');
    const antes = (await leerBase(page)).paginas[0];
    await page.click('#pagina-luz-abrir');
    await page.waitForSelector('#pagina-luz:not([hidden])');
    assert.equal(await page.isVisible('#pagina-herramientas'), false, 'las barras van en lugar de las herramientas');
    assert.equal(await page.isVisible('#pagina-filtros'), false);
    assert.equal(await page.isVisible('#pagina-contraste-fila'), true);
    await page.waitForSelector('#pagina-previa:not([hidden])');
    // La vista previa se ve más oscura al bajar el brillo
    const brilloPrevia = () => page.evaluate(() => {
      const c = document.querySelector('#pagina-previa');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i];
      return s / (d.length / 4);
    });
    const inicial = await brilloPrevia();
    await page.locator('#pagina-brillo').fill('-40');
    await page.locator('#pagina-contraste').fill('25');
    assert.equal(await page.textContent('#pagina-brillo-valor'), '-40');
    assert.equal(await page.textContent('#pagina-contraste-valor'), '+25');
    await page.waitForFunction(async ini => {
      const c = document.querySelector('#pagina-previa');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i];
      return s / (d.length / 4) < ini - 2;
    }, inicial, { timeout: 15000 });
    await page.click('#pagina-luz-listo');
    await page.waitForFunction(() => !document.querySelector('#pagina-herramientas').hidden && document.querySelector('#pagina-previa').hidden && !document.querySelector('#pagina-imagen').hidden, null, { timeout: 30000 });
    const despues = (await leerBase(page)).paginas[0];
    assert.equal(despues.brillo, -40);
    assert.equal(despues.contraste, 25);
    assert.notEqual(despues.procesada, antes.procesada, 'la página se volvió a armar');
    // Al volver a abrir las barras quedan donde se dejaron
    await page.click('#pagina-luz-abrir');
    await page.waitForSelector('#pagina-luz:not([hidden])');
    assert.equal(await page.inputValue('#pagina-brillo'), '-40');
    // Restablecer y cancelar: no cambia nada
    await page.click('#pagina-luz-restablecer');
    assert.equal(await page.inputValue('#pagina-brillo'), '0');
    await page.click('#pagina-luz-cancelar');
    assert.equal(await page.isVisible('#pagina-luz'), false);
    assert.equal((await leerBase(page)).paginas[0].brillo, -40);
    assert.deepEqual(page.errores, []);
  });

  it('en B/N solo hay brillo (cambia el grosor de las letras)', async () => {
    const page = await env.pagina();
    await importarFoto(page, guardarPNG(paginaDeTexto(800, 1100), 'luz-bn.png'));
    await page.click('#doc-paginas .miniatura');
    await page.click('[data-filtro="bn"]');
    await page.waitForFunction(() => document.querySelector('[data-filtro="bn"]').getAttribute('aria-pressed') === 'true', null, { timeout: 30000 });
    await page.click('#pagina-luz-abrir');
    await page.waitForSelector('#pagina-luz:not([hidden])');
    assert.equal(await page.isVisible('#pagina-contraste-fila'), false);
    assert.equal(await page.isVisible('#pagina-luz-bn'), true);
    await page.locator('#pagina-brillo').fill('20');
    await page.click('#pagina-luz-listo');
    await page.waitForFunction(() => document.querySelector('#pagina-previa').hidden && document.querySelector('#pagina-procesando').hidden, null, { timeout: 30000 });
    const p = (await leerBase(page)).paginas[0];
    assert.equal(p.brillo, 20);
    assert.equal(p.tipo, 'image/png', 'sigue en blanco y negro');
    assert.deepEqual(page.errores, []);
  });
});
