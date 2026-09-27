import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno, fotoDePrueba, importarFoto, leerBase } from './ayuda.js';

describe('Carpetas por clase', () => {
  let env;
  const foto = fotoDePrueba(1);
  before(async () => { env = await crearEntorno(); });
  after(async () => { await env.cerrar(); });

  const chip = (page, texto) => page.locator('#inicio-carpetas .carpeta-chip', { hasText: texto });
  async function crearCarpeta(page, nombre) {
    await page.click('#inicio-carpetas .carpeta-nueva');
    await page.fill('dialog .campo', nombre);
    await page.click('dialog .boton-primario');
    await page.waitForFunction(n => [...document.querySelectorAll('#inicio-carpetas [aria-pressed="true"]')].some(b => b.textContent.includes(n)), nombre);
  }
  const volverAlInicio = async page => { await page.click('#doc-atras'); await page.waitForSelector('#vista-inicio:not([hidden])'); };

  it('lo que se escanea dentro de una carpeta se guarda ahí, con el nombre de la clase y la fecha', async () => {
    const page = await env.pagina();
    await crearCarpeta(page, 'Cálculo');
    assert.match(await page.textContent('#inicio-carpeta-vacia'), /Todavía no hay documentos en «Cálculo»/);
    await importarFoto(page, foto.ruta);
    const nombre = await page.textContent('#doc-nombre');
    assert.match(nombre, /^Cálculo – \d{1,2} \p{L}+$/u);
    assert.match(await page.textContent('#doc-estado'), /^Cálculo · 1 página/);
    await volverAlInicio(page);
    // Otro el mismo día: no se repite el nombre
    await importarFoto(page, foto.ruta);
    assert.equal(await page.textContent('#doc-nombre'), `${nombre} (2)`);
    await volverAlInicio(page);
    assert.equal(await page.locator('#inicio-lista li').count(), 2);
    const { documentos, carpetas } = await leerBase(page);
    assert.equal(carpetas.length, 1);
    assert.ok(documentos.every(d => d.carpetaId === carpetas[0].id));
    // En "Todos" se ve de qué carpeta es cada uno; fuera de la carpeta se escanea sin ella
    await chip(page, 'Todos').click();
    await page.waitForFunction(() => document.querySelector('#inicio-lista .doc-detalle')?.textContent.startsWith('Cálculo · '));
    await importarFoto(page, foto.ruta);
    assert.match(await page.textContent('#doc-nombre'), /^Escaneo /);
    assert.deepEqual(page.errores, []);
  });

  it('un documento se mueve a otra carpeta, y la carpeta se renombra y se borra sin borrar documentos', async () => {
    const page = await env.pagina();
    await crearCarpeta(page, 'Física');
    await chip(page, 'Todos').click();
    await importarFoto(page, foto.ruta);
    // Mover a una carpeta nueva desde el documento
    await page.click('#doc-menu');
    await page.click('.menu-opcion:has-text("Mover a una carpeta")');
    await page.click('.menu-opcion:has-text("Física")');
    await page.waitForFunction(() => document.querySelector('#doc-estado').textContent.startsWith('Física · '));
    await volverAlInicio(page);
    await chip(page, 'Física').click();
    await page.waitForFunction(() => document.querySelectorAll('#inicio-lista li').length === 1);
    // Renombrar: tocar la carpeta elegida abre sus opciones
    await chip(page, 'Física').click();
    await page.click('.menu-opcion:has-text("Cambiar el nombre")');
    await page.fill('dialog .campo', 'Física II');
    await page.click('dialog .boton-primario');
    await page.waitForFunction(() => document.querySelector('#inicio-carpetas [aria-pressed="true"]').textContent.includes('Física II'));
    // Borrar la carpeta: el documento queda en "Todos"
    await chip(page, 'Física II').click();
    await page.click('.menu-opcion.peligro');
    await page.click('dialog .boton-peligro');
    await page.waitForFunction(() => document.querySelector('#inicio-carpetas [aria-pressed="true"]').textContent === 'Todos');
    const { documentos, carpetas } = await leerBase(page);
    assert.equal(carpetas.length, 0);
    assert.equal(documentos.length, 1);
    assert.equal(documentos[0].carpetaId, null);
    assert.deepEqual(page.errores, []);
  });

  it('las carpetas viajan en el respaldo', async () => {
    const page = await env.pagina();
    await crearCarpeta(page, 'Historia');
    await importarFoto(page, foto.ruta);
    await volverAlInicio(page);
    await page.click('#inicio-menu');
    await page.click('.menu-opcion:nth-child(1)');
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('dialog .boton-secundario')]);
    const otro = await env.pagina();
    await otro.click('#inicio-menu');
    const [selector] = await Promise.all([otro.waitForEvent('filechooser'), otro.click('.menu-opcion:nth-child(2)')]);
    await selector.setFiles(await descarga.path());
    await otro.waitForSelector('#inicio-lista li', { timeout: 30000 });
    await chip(otro, 'Historia').click();
    await otro.waitForFunction(() => document.querySelectorAll('#inicio-lista li').length === 1);
    const { documentos, carpetas } = await leerBase(otro);
    assert.equal(carpetas[0].nombre, 'Historia');
    assert.equal(documentos[0].carpetaId, carpetas[0].id);
  });
});
