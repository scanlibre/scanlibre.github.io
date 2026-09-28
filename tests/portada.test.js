import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearEntorno, fotoDePrueba, importarFoto, leerBase } from './ayuda.js';
import { fechaLarga } from '../js/portada.js';

describe('Portada automática', () => {
  let env;
  const foto = fotoDePrueba(1).ruta;
  before(async () => { env = await crearEntorno(); });
  after(async () => { await env.cerrar(); });

  const campo = (page, c) => page.locator(`dialog [data-campo="${c}"]`);
  const enOrden = async page => { const { documentos, paginas } = await leerBase(page); return documentos.map(d => ({ ...d, paginas: d.paginas.map(id => paginas.find(p => p.id === id)) })); };

  async function documentoEnCarpeta(page, carpeta) {
    await page.click('#inicio-carpetas .carpeta-nueva');
    await page.fill('dialog .campo', carpeta);
    await page.click('dialog .boton-primario');
    await page.waitForFunction(n => [...document.querySelectorAll('#inicio-carpetas [aria-pressed="true"]')].some(b => b.textContent.includes(n)), carpeta);
    await importarFoto(page, foto);
  }

  it('llena la portada, queda como página 1 con su texto, y los datos se recuerdan', async () => {
    const page = await env.pagina();
    await documentoEnCarpeta(page, 'Cálculo');
    assert.equal(fechaLarga(new Date(2026, 8, 28)), '28 de septiembre de 2026');
    await page.click('#doc-menu');
    await page.click('.menu-opcion:has-text("Portada del trabajo")');
    assert.equal(await campo(page, 'asignatura').inputValue(), 'Cálculo', 'la asignatura sale de la carpeta');
    assert.equal(await campo(page, 'tema').inputValue(), '', 'el nombre automático no es un tema');
    assert.equal(await campo(page, 'fecha').inputValue(), fechaLarga());
    await campo(page, 'universidad').fill('Universidad Nacional Autónoma de Honduras');
    await campo(page, 'facultad').fill('Facultad de Ingeniería');
    await campo(page, 'seccion').fill('0800');
    await campo(page, 'catedratico').fill('Lic. Ana Martínez');
    await campo(page, 'tema').fill('Tarea 1: Límites y continuidad');
    await campo(page, 'integrantes').fill('María López · 20211000123\nJosé Pérez · 20211000456');
    await campo(page, 'lugar').fill('Ciudad Universitaria, Tegucigalpa');
    await page.click('dialog [data-estilo="moderna"]');
    await page.click('dialog .boton-primario');
    await page.waitForSelector('.aviso-exito:has-text("la portada es la página 1")', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('#doc-paginas .miniatura img').length === 2);
    const [doc] = await enOrden(page);
    const portada = doc.paginas[0];
    assert.equal(portada.modo, 'portada');
    assert.equal(portada.portada.estilo, 'moderna');
    assert.equal(portada.ocr.idioma, 'pdf');
    for (const t of ['Universidad Nacional Autónoma de Honduras', 'Asignatura: Cálculo', 'Sección: 0800', 'Catedrático(a): Lic. Ana Martínez', 'Tarea 1: Límites y continuidad', 'Integrantes:', 'José Pérez · 20211000456', `Ciudad Universitaria, Tegucigalpa, ${fechaLarga()}`]) {
      assert.ok(portada.ocr.texto.includes(t), `falta «${t}» en:\n${portada.ocr.texto}`);
    }
    assert.ok(Math.abs(portada.procAncho / portada.procAlto - 8.5 / 11) < 0.005, 'hoja carta');
    // El texto de la portada va en el PDF con texto buscable
    await page.click('#doc-pdf');
    await page.click('dialog .opcion:has-text("Texto buscable")');
    await page.click('dialog .hoja-botones .boton-primario');
    await page.waitForSelector('.resultado-pdf', { timeout: 120000 });
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('dialog .hoja-botones .boton-secundario')]);
    const pdf = readFileSync(await descarga.path()).toString('latin1');
    await page.keyboard.press('Escape');
    assert.match(pdf, /\(Tarea \) Tj/);

    // Otro trabajo de la misma clase: ya viene casi todo lleno
    await page.click('#doc-atras');
    await importarFoto(page, foto);
    await page.click('#doc-renombrar');
    await page.fill('dialog .campo', 'Tarea 2: Derivadas');
    await page.click('dialog .boton-primario');
    await page.click('#doc-menu');
    await page.click('.menu-opcion:has-text("Portada del trabajo")');
    assert.equal(await campo(page, 'universidad').inputValue(), 'Universidad Nacional Autónoma de Honduras');
    assert.equal(await campo(page, 'catedratico').inputValue(), 'Lic. Ana Martínez', 'lo de la clase se recuerda');
    assert.equal(await campo(page, 'integrantes').inputValue(), 'María López · 20211000123\nJosé Pérez · 20211000456');
    assert.equal(await campo(page, 'tema').inputValue(), 'Tarea 2: Derivadas', 'el tema sale del nombre del documento');
    assert.equal(await page.getAttribute('dialog [data-estilo="moderna"]', 'aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    // (el lector de texto escribe sus propios avisos en la consola al leer la foto de prueba)
    assert.deepEqual(page.errores.filter(e => !/too small to scale|cannot be recognized|Empty page/i.test(e)), []);
  });

  it('desde la página se cambia (queda en su lugar) y se puede quitar', async () => {
    const page = await env.pagina();
    await importarFoto(page, foto);
    await page.click('#doc-menu');
    await page.click('.menu-opcion:has-text("Portada del trabajo")');
    await campo(page, 'tema').fill('Informe de laboratorio');
    await page.click('dialog .boton-primario');
    await page.waitForFunction(() => document.querySelectorAll('#doc-paginas .miniatura img').length === 2, null, { timeout: 30000 });
    const id = (await enOrden(page))[0].paginas[0].id;
    await page.click('#doc-paginas li:nth-child(1) .miniatura');
    await page.waitForSelector('#pagina-portada:not([hidden])');
    assert.equal(await page.isVisible('#pagina-curva'), false);
    await page.click('#pagina-portada-boton');
    assert.equal(await page.textContent('dialog .hoja-titulo'), 'Cambiar la portada');
    assert.equal(await campo(page, 'tema').inputValue(), 'Informe de laboratorio');
    await campo(page, 'tema').fill('Informe de laboratorio 2');
    await page.click('dialog .boton-primario');
    await page.waitForSelector('.aviso-exito:has-text("se cambió la portada")', { timeout: 30000 });
    let [doc] = await enOrden(page);
    assert.equal(doc.paginas[0].id, id, 'misma página, mismo lugar');
    assert.match(doc.paginas[0].ocr.texto, /Informe de laboratorio 2/);
    await page.click('#pagina-portada-boton');
    await page.click('dialog .peligro-texto');
    await page.click('dialog .boton-peligro');
    await page.waitForSelector('#vista-documento:not([hidden])');
    [doc] = await enOrden(page);
    assert.equal(doc.paginas.length, 1);
    assert.notEqual(doc.paginas[0].modo, 'portada');
    assert.deepEqual(page.errores, []);
  });
});
