import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearEntorno, fotoDePrueba, importarFoto, leerBase } from './ayuda.js';

describe('Papelera', () => {
  let env;
  const fotos = [fotoDePrueba(1), fotoDePrueba(2), fotoDePrueba(3)].map(f => f.ruta);
  before(async () => { env = await crearEntorno(); });
  after(async () => { await env.cerrar(); });

  const abrirPapelera = async page => {
    await page.click('#inicio-menu');
    await page.click('.menu-opcion:has-text("Papelera")');
    await page.waitForSelector('dialog .papelera');
  };

  it('un documento borrado se recupera desde la papelera (o con Deshacer)', async () => {
    const page = await env.pagina();
    await importarFoto(page, fotos[0], fotos[1]);
    await page.click('#doc-renombrar');
    await page.fill('dialog .campo', 'Apuntes de Química');
    await page.click('dialog .boton-primario');
    await page.click('#doc-menu');
    await page.click('.menu-opcion.peligro');
    await page.click('dialog .boton-peligro');
    await page.waitForSelector('#vista-inicio:not([hidden])');
    // Deshacer en el aviso
    await page.click('.aviso-accion:has-text("Deshacer")');
    await page.waitForSelector('#vista-documento:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#doc-nombre').textContent === 'Apuntes de Química');
    assert.equal((await leerBase(page)).documentos[0].papelera, undefined);
    // Otra vez, y ahora desde la papelera
    await page.click('#doc-menu');
    await page.click('.menu-opcion.peligro');
    await page.click('dialog .boton-peligro');
    await page.waitForSelector('#vista-inicio:not([hidden])');
    await page.click('#inicio-menu');
    assert.match(await page.textContent('.menu-opcion:has-text("Papelera")'), /Papelera \(1\)/);
    await page.click('.menu-opcion:has-text("Papelera")');
    await page.waitForSelector('dialog .papelera-fila');
    assert.match(await page.textContent('dialog .papelera-fila'), /Apuntes de Química.*2 páginas.*se borra en 30 días/);
    await page.click('dialog .papelera-fila .papelera-recuperar');
    await page.waitForSelector('dialog .papelera .carpeta-vacia');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => /Apuntes de Química/.test(document.querySelector('#inicio-lista').textContent));
    assert.deepEqual(page.errores, []);
  });

  it('las páginas borradas vuelven a su lugar; se puede borrar para siempre y vaciar', async () => {
    const page = await env.pagina();
    await importarFoto(page, ...fotos);
    const [p1, p2, p3] = (await leerBase(page)).documentos[0].paginas;
    // Borrar la 2 desde la página
    await page.click('#doc-paginas li:nth-child(2) .miniatura');
    await page.click('#pagina-borrar');
    await page.click('dialog .boton-peligro');
    await page.waitForFunction(() => document.querySelector('#pagina-titulo').textContent === 'Página 2 de 2');
    assert.deepEqual((await leerBase(page)).documentos[0].paginas, [p1, p3]);
    await page.click('.aviso-accion:has-text("Deshacer")');
    await page.waitForFunction(() => document.querySelector('#pagina-titulo').textContent === 'Página 2 de 3');
    assert.deepEqual((await leerBase(page)).documentos[0].paginas, [p1, p2, p3], 'volvió a su lugar');
    // Borrar la 1 y la 3 eligiéndolas, y recuperarlas desde la papelera
    await page.click('#pagina-atras');
    await page.click('#doc-menu');
    await page.click('.menu-opcion:has-text("Elegir páginas")');
    await page.click('#doc-paginas li:nth-child(1) .miniatura');
    await page.click('#doc-paginas li:nth-child(3) .miniatura');
    await page.click('#doc-sel-borrar');
    await page.click('dialog .boton-peligro');
    await page.waitForFunction(() => document.querySelectorAll('#doc-paginas li[data-id]').length === 1);
    await page.click('#doc-atras');
    await abrirPapelera(page);
    assert.equal(await page.locator('dialog .papelera-fila').count(), 2);
    assert.match(await page.textContent('dialog .papelera'), /Era la página 3/);
    // La que era la 3 se borra para siempre; la 1 se recupera
    const fila3 = page.locator('dialog .papelera-fila', { hasText: 'Era la página 3' });
    await fila3.locator('.papelera-borrar').click();
    await page.click('dialog[open] >> nth=-1 >> .boton-peligro');
    await page.waitForFunction(() => document.querySelectorAll('dialog .papelera-fila').length === 1);
    await page.click('dialog .papelera-fila .papelera-recuperar');
    await page.waitForSelector('dialog .papelera .carpeta-vacia');
    const { documentos, paginas } = await leerBase(page);
    assert.deepEqual(documentos[0].paginas, [p1, p2]);
    assert.equal(paginas.length, 2, 'la 3 se borró de verdad');
    assert.deepEqual(page.errores, []);
  });

  it('lo que lleva más de 30 días se borra solo', async () => {
    // Un documento que se borró hace 31 días
    const page = await env.pagina({ antes: () => { window.__hace31 = Date.now() - 31 * 86400000; } });
    await importarFoto(page, fotos[0]);
    await page.evaluate(async () => {
      const db = await new Promise(r => { const q = indexedDB.open('scanlibre'); q.onsuccess = () => r(q.result); });
      const tx = db.transaction('documentos', 'readwrite'), st = tx.objectStore('documentos');
      await new Promise(r => { st.getAll().onsuccess = e => { for (const d of e.target.result) st.put({ ...d, papelera: window.__hace31 }); tx.oncomplete = r; }; });
      db.close();
    });
    await page.reload();
    // Unos segundos después de abrir la app se vacía lo viejo
    let base;
    for (let i = 0; i < 30; i++) {
      base = await leerBase(page);
      if (!base.documentos.length) break;
      await page.waitForTimeout(500);
    }
    assert.equal(base.documentos.length, 0);
    assert.equal(base.paginas.length, 0);
  });
});

describe('Marca de agua', () => {
  let env;
  before(async () => { env = await crearEntorno(); });
  after(async () => { await env.cerrar(); });

  it('va cruzada en cada página del PDF, con la fecha, y se recuerda el texto', async () => {
    const page = await env.pagina();
    await importarFoto(page, fotoDePrueba(1).ruta);
    // Sin marca, en B/N la página va a 1 bit
    await page.click('#doc-paginas .miniatura');
    await page.click('[data-filtro="bn"]');
    await page.waitForFunction(() => document.querySelector('[data-filtro="bn"]').getAttribute('aria-pressed') === 'true', null, { timeout: 30000 });
    await page.waitForSelector('#pagina-procesando', { state: 'hidden' });
    await page.click('#pagina-atras');
    await page.click('#doc-pdf');
    await page.click('dialog .opcion:has-text("Marca de agua")');
    assert.equal(await page.isVisible('dialog .campo-marca'), true);
    await page.fill('dialog .campo-marca .campo', 'Solo para trámite en el banco');
    await page.click('dialog .hoja-botones .boton-primario');
    await page.waitForSelector('.resultado-pdf', { timeout: 60000 });
    assert.match(await page.textContent('.resultado-pdf small'), /con marca de agua/);
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('dialog .hoja-botones .boton-secundario')]);
    const pdf = readFileSync(await descarga.path()).toString('latin1');
    assert.match(pdf, /\/DCTDecode/, 'con marca, la página va en JPEG (la marca es gris)');
    assert.doesNotMatch(pdf, /\/BitsPerComponent 1/);
    await page.keyboard.press('Escape');
    const ajustes = await page.evaluate(() => JSON.parse(localStorage.getItem('scanlibre_ajustes')));
    assert.equal(ajustes.marcaDeAgua, 'Solo para trámite en el banco');
    // La próxima vez el texto ya está
    await page.click('#doc-pdf');
    await page.click('dialog .opcion:has-text("Marca de agua")');
    assert.equal(await page.inputValue('dialog .campo-marca .campo'), 'Solo para trámite en el banco');
    await page.keyboard.press('Escape');
    assert.deepEqual(page.errores, []);
  });

  it('la marca de agua se ve en la página (oscurece algo del papel en diagonal)', async () => {
    const page = await env.pagina();
    const { dibujarMarcaDeAgua } = await import('../js/marcas.js');
    assert.equal(typeof dibujarMarcaDeAgua, 'function');
    const r = await page.evaluate(async () => {
      const { dibujarMarcaDeAgua } = await import('./js/marcas.js');
      const c = document.createElement('canvas'); c.width = 600; c.height = 800;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 800);
      dibujarMarcaDeAgua(ctx, 'Solo para el banco · 28/09/2026', 600, 800);
      const d = ctx.getImageData(0, 0, 600, 800).data;
      let marcados = 0, min = 255;
      for (let i = 0; i < d.length; i += 4) { if (d[i] < 245) marcados++; min = Math.min(min, d[i]); }
      return { marcados: marcados / (600 * 800), min };
    });
    assert.ok(r.marcados > 0.03 && r.marcados < 0.4, `cubre ${Math.round(r.marcados * 100)} %`);
    assert.ok(r.min > 120, `y es transparente: lo más oscuro es ${r.min}`);
  });
});
