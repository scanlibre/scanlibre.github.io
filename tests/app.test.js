import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearEntorno, fotoDePrueba, importarFoto, leerBase, descargarPDF, distanciaMax } from './ayuda.js';

describe('La app', () => {
  let env;
  const foto1 = fotoDePrueba(1), foto2 = fotoDePrueba(2), foto3 = fotoDePrueba(0);
  before(async () => { env = await crearEntorno(); });
  after(async () => { await env.cerrar(); });

  it('arranca sin errores y sin documentos muestra cómo empezar', async () => {
    const page = await env.pagina();
    assert.equal(await page.isVisible('#inicio-vacio'), true);
    assert.equal(await page.locator('#inicio-lista li').count(), 0);
    assert.deepEqual(page.errores, []);
  });

  it('al importar una foto encuentra la hoja sola y guarda la página', async () => {
    const page = await env.pagina();
    await importarFoto(page, foto1.ruta);
    const { documentos, paginas } = await leerBase(page);
    assert.equal(documentos.length, 1);
    assert.equal(paginas.length, 1);
    assert.ok(distanciaMax(paginas[0].esquinas, foto1.esquinas) < 0.02, 'las esquinas detectadas están donde está la hoja');
    assert.equal(paginas[0].filtro, 'mejorada');
    assert.equal(paginas[0].tipo, 'image/jpeg');
    assert.match(await page.textContent('#doc-estado'), /1 página/);
    assert.deepEqual(page.errores, []);
  });

  it('los documentos siguen ahí al volver a abrir la app', async () => {
    const page = await env.pagina();
    await importarFoto(page, foto1.ruta);
    await page.goto(env.url);
    await page.waitForSelector('#inicio-lista li');
    assert.equal(await page.locator('#inicio-lista li').count(), 1);
    assert.match(await page.textContent('#inicio-lista'), /1 página/);
  });

  it('crea el PDF y se descarga con el nombre del documento', async () => {
    const page = await env.pagina();
    await importarFoto(page, foto1.ruta, foto2.ruta);
    const nombre = await page.textContent('#doc-nombre');
    const pdf = await descargarPDF(page);
    assert.ok(pdf.texto.startsWith('%PDF-1.4'));
    assert.match(pdf.texto, /\/Count 2/);
    assert.match(pdf.texto, /\/MediaBox \[0 0 612 792\]/, 'tamaño carta');
    assert.equal(pdf.nombre, nombre + '.pdf');
  });

  it('en blanco y negro la página se guarda en PNG y va a 1 bit en el PDF', async () => {
    const page = await env.pagina();
    await importarFoto(page, foto1.ruta);
    await page.click('#doc-paginas .miniatura');
    await page.click('[data-filtro="bn"]');
    await page.waitForFunction(() => document.querySelector('[data-filtro="bn"]').getAttribute('aria-pressed') === 'true', null, { timeout: 30000 });
    const { paginas } = await leerBase(page);
    assert.equal(paginas[0].filtro, 'bn');
    assert.equal(paginas[0].tipo, 'image/png');
    await page.click('#pagina-atras');
    const pdf = await descargarPDF(page);
    assert.match(pdf.texto, /\/BitsPerComponent 1 \/Filter \/FlateDecode/);
  });

  it('las páginas nuevas salen con el último filtro que se eligió', async () => {
    const page = await env.pagina();
    await importarFoto(page, foto1.ruta);
    await page.click('#doc-paginas .miniatura');
    await page.click('[data-filtro="gris"]');
    await page.waitForFunction(() => document.querySelector('[data-filtro="gris"]').getAttribute('aria-pressed') === 'true', null, { timeout: 30000 });
    await page.click('#pagina-atras');
    const [selector] = await Promise.all([page.waitForEvent('filechooser'), page.click('#doc-agregar').then(() => page.click('.menu-opcion:nth-child(2)'))]);
    await selector.setFiles(foto2.ruta);
    await page.waitForFunction(() => document.querySelectorAll('#doc-paginas .miniatura img').length === 2, null, { timeout: 30000 });
    const { paginas } = await leerBase(page);
    assert.deepEqual(paginas.map(p => p.filtro).sort(), ['gris', 'gris']);
  });

  it('mover una página cambia el orden, y borrar una no toca a las demás', async () => {
    const page = await env.pagina();
    await importarFoto(page, foto1.ruta, foto2.ruta, foto3.ruta);
    const antes = (await leerBase(page)).documentos[0].paginas;
    await page.click('#doc-paginas li:nth-child(1) .miniatura');
    await page.click('#pagina-mover-despues');
    await page.waitForFunction(() => document.querySelector('#pagina-titulo').textContent === 'Página 2 de 3');
    const movido = (await leerBase(page)).documentos[0].paginas;
    assert.deepEqual(movido, [antes[1], antes[0], antes[2]]);
    // Borrar la página 2 (la que era la 1)
    await page.click('#pagina-borrar');
    await page.click('dialog .boton-peligro');
    await page.waitForFunction(() => document.querySelector('#pagina-titulo').textContent === 'Página 2 de 2');
    const { documentos, paginas } = await leerBase(page);
    assert.deepEqual(documentos[0].paginas, [antes[1], antes[2]]);
    assert.deepEqual(paginas.map(p => p.id).sort(), [antes[1], antes[2]].sort(), 'solo se borró esa página');
    assert.ok(paginas.every(p => p.procesada > 1000 && p.original > 1000), 'las demás conservan sus imágenes');
  });

  it('se puede cambiar el nombre del documento', async () => {
    const page = await env.pagina();
    await importarFoto(page, foto1.ruta);
    await page.click('#doc-renombrar');
    await page.fill('dialog .campo', 'Tarea de Cálculo');
    await page.click('dialog .boton-primario');
    await page.waitForFunction(() => document.querySelector('#doc-nombre').textContent === 'Tarea de Cálculo');
    assert.equal((await leerBase(page)).documentos[0].nombre, 'Tarea de Cálculo');
  });

  it('eliminar un documento pide confirmación y lo borra con sus páginas', async () => {
    const page = await env.pagina();
    await importarFoto(page, foto1.ruta, foto2.ruta);
    await page.click('#doc-menu');
    await page.click('.menu-opcion.peligro');
    await page.click('dialog .boton-peligro');
    await page.waitForSelector('#vista-inicio:not([hidden])');
    const { documentos, paginas } = await leerBase(page);
    assert.equal(documentos.length, 0);
    assert.equal(paginas.length, 0);
  });

  it('el respaldo se puede restaurar (por ejemplo, en otro teléfono)', async () => {
    const page = await env.pagina();
    await importarFoto(page, foto1.ruta, foto2.ruta);
    await page.click('#doc-renombrar');
    await page.fill('dialog .campo', 'Apuntes de Física');
    await page.click('dialog .boton-primario');
    await page.click('#doc-atras');
    await page.click('#inicio-menu');
    await page.click('.menu-opcion:nth-child(1)');
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('dialog .boton-secundario')]);
    const zip = await descarga.path();
    assert.equal(readFileSync(zip).readUInt32LE(0), 0x04034b50, 'es un zip');

    // Otro "teléfono": un navegador limpio
    const otro = await env.pagina();
    await otro.click('#inicio-menu');
    const [selector] = await Promise.all([otro.waitForEvent('filechooser'), otro.click('.menu-opcion:nth-child(2)')]);
    await selector.setFiles(zip);
    await otro.waitForSelector('#inicio-lista li', { timeout: 30000 });
    assert.match(await otro.textContent('#inicio-lista'), /Apuntes de Física/);
    const { documentos, paginas } = await leerBase(otro);
    assert.equal(documentos[0].paginas.length, 2);
    assert.equal(paginas.length, 2);
    assert.ok(paginas.every(p => p.miniatura > 0 && p.procesada > 1000));
  });

  it('un archivo que no es respaldo da un aviso claro', async () => {
    const page = await env.pagina();
    await page.click('#inicio-menu');
    const [selector] = await Promise.all([page.waitForEvent('filechooser'), page.click('.menu-opcion:nth-child(2)')]);
    await selector.setFiles(foto1.ruta);
    await page.waitForSelector('.aviso-error');
    assert.match(await page.textContent('.aviso-error'), /no es un respaldo/);
  });

  it('en tema oscuro la hoja escaneada no se invierte', async () => {
    const page = await env.pagina({ oscuro: true });
    await importarFoto(page, foto1.ruta);
    const fondoApp = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(fondoApp, 'rgb(11, 18, 16)');
    const filtro = await page.evaluate(() => getComputedStyle(document.querySelector('#doc-paginas img')).filter);
    assert.equal(filtro, 'none');
  });
});
