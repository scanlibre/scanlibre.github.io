import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearEntorno, fotoDePrueba, importarFoto, leerBase } from './ayuda.js';

describe('Ordenar arrastrando y elegir varias páginas', () => {
  let env;
  const fotos = [fotoDePrueba(1), fotoDePrueba(2), fotoDePrueba(3)].map(f => f.ruta);
  before(async () => { env = await crearEntorno(); });
  after(async () => { await env.cerrar(); });

  const centro = async (page, n) => {
    const b = await page.locator(`#doc-paginas li:nth-child(${n}) .miniatura`).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const orden = async page => (await leerBase(page)).documentos[0].paginas;

  /** Mantener presionada una miniatura con el dedo (y quizás moverlo) */
  async function dedo(page, n, { ms = 550, hasta = null, cancelar = false } = {}) {
    const a = await centro(page, n), b = hasta ? await centro(page, hasta) : null;
    await page.evaluate(async ({ n, a, b, ms, cancelar }) => {
      const boton = document.querySelector(`#doc-paginas li:nth-child(${n}) .miniatura`);
      const ev = (tipo, p, blanco = boton) => blanco.dispatchEvent(new PointerEvent(tipo, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true }));
      ev('pointerdown', a);
      if (cancelar) { ev('pointermove', { x: a.x, y: a.y - 30 }); ev('pointercancel', { x: a.x, y: a.y - 30 }); return; }
      await new Promise(r => setTimeout(r, ms));
      if (b) for (let i = 1; i <= 12; i++) { ev('pointermove', { x: a.x + (b.x - a.x) * i / 12, y: a.y + (b.y - a.y) * i / 12 }); await new Promise(r => requestAnimationFrame(r)); }
      ev('pointerup', b || a);
    }, { n, a, b, ms, cancelar });
  }

  it('con el mouse se arrastra una página a otro lugar', async () => {
    const page = await env.pagina();
    await importarFoto(page, ...fotos);
    const [p1, p2, p3] = await orden(page);
    const a = await centro(page, 1), b = await centro(page, 3);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 15; i++) await page.mouse.move(a.x + (b.x - a.x) * i / 15, a.y + (b.y - a.y) * i / 15);
    assert.equal(await page.locator('.miniatura-fantasma').count(), 1, 'la página sigue al puntero');
    await page.mouse.up();
    await page.waitForSelector('.aviso:has-text("quedó en el lugar 3")');
    assert.deepEqual(await orden(page), [p2, p3, p1]);
    assert.equal(await page.locator('.miniatura-fantasma').count(), 0);
    assert.deepEqual(await page.$$eval('#doc-paginas .miniatura-numero', s => s.map(x => x.textContent)), ['1', '2', '3']);
    assert.equal(await page.isVisible('#vista-documento'), true, 'soltar no abre la página');
    assert.deepEqual(page.errores, []);
  });

  it('con el dedo: mantener presionada y arrastrar la mueve; deslizar la lista no hace nada', async () => {
    const page = await env.pagina();
    await importarFoto(page, ...fotos);
    const [p1, p2, p3] = await orden(page);
    await dedo(page, 3, { hasta: 1 });
    await page.waitForSelector('.aviso:has-text("quedó en el lugar 1")');
    assert.deepEqual(await orden(page), [p3, p1, p2]);
    await dedo(page, 2, { cancelar: true });
    assert.equal(await page.isVisible('#doc-barra-seleccion'), false, 'deslizar no empieza a elegir');
    assert.deepEqual(await orden(page), [p3, p1, p2]);
    assert.equal(await page.isVisible('#doc-consejo'), true, 'se explica cómo se hace');
  });

  it('mantener presionada sin moverla empieza a elegir: girar y eliminar varias', async () => {
    const page = await env.pagina();
    await importarFoto(page, ...fotos);
    const [p1, p2, p3] = await orden(page);
    await dedo(page, 2);
    await page.waitForSelector('#doc-barra-seleccion:not([hidden])');
    assert.equal(await page.textContent('#doc-seleccion-cuenta'), '1 página');
    assert.equal(await page.isVisible('#doc-acciones-seleccion'), true);
    assert.equal(await page.isVisible('#doc-acciones'), false);
    // Tocar otra la agrega; tocarla otra vez la saca
    await page.click('#doc-paginas li:nth-child(3) .miniatura');
    await page.click('#doc-paginas li:nth-child(1) .miniatura');
    await page.click('#doc-paginas li:nth-child(1) .miniatura');
    assert.equal(await page.textContent('#doc-seleccion-cuenta'), '2 páginas');
    assert.equal(await page.getAttribute('#doc-paginas li:nth-child(2) .miniatura', 'aria-pressed'), 'true');
    assert.equal(await page.isVisible('#vista-documento'), true, 'elegir no abre la página');
    await page.click('#doc-sel-girar');
    await page.waitForSelector('.aviso-exito:has-text("2 páginas")', { timeout: 60000 });
    const { paginas } = await leerBase(page);
    const rot = id => paginas.find(p => p.id === id).rotacion;
    assert.deepEqual([rot(p1), rot(p2), rot(p3)], [0, 1, 1]);
    assert.equal(await page.textContent('#doc-seleccion-cuenta'), '2 páginas', 'siguen elegidas');
    await page.click('#doc-sel-borrar');
    await page.click('dialog .boton-peligro');
    await page.waitForSelector('#doc-barra-seleccion', { state: 'hidden' });
    assert.deepEqual(await orden(page), [p1]);
    assert.equal((await leerBase(page)).paginas.length, 1);
    assert.deepEqual(page.errores, []);
  });

  it('pasar las elegidas a un documento nuevo', async () => {
    const page = await env.pagina();
    await importarFoto(page, ...fotos);
    const [p1, p2, p3] = await orden(page);
    const nombre = await page.textContent('#doc-nombre');
    await page.click('#doc-menu');
    await page.click('.menu-opcion:has-text("Elegir páginas")');
    await page.click('#doc-paginas li:nth-child(2) .miniatura');
    await page.click('#doc-paginas li:nth-child(3) .miniatura');
    await page.click('#doc-sel-mover');
    await page.click('.menu-opcion:has-text("A un documento nuevo")');
    assert.equal(await page.inputValue('dialog .campo'), `${nombre} (págs. 2–3)`);
    await page.fill('dialog .campo', 'Segunda parte');
    await page.click('dialog .boton-primario');
    await page.waitForSelector('.aviso-exito:has-text("2 páginas pasaron a «Segunda parte»")');
    const { documentos, paginas } = await leerBase(page);
    const viejo = documentos.find(d => d.nombre === nombre), nuevo = documentos.find(d => d.nombre === 'Segunda parte');
    assert.deepEqual(viejo.paginas, [p1]);
    assert.deepEqual(nuevo.paginas, [p2, p3]);
    assert.ok([p2, p3].every(id => paginas.find(p => p.id === id).docId === nuevo.id));
    assert.equal(await page.locator('#doc-paginas li[data-id]').count(), 1);
    assert.deepEqual(page.errores, []);
  });

  it('el PDF de solo las páginas elegidas', async () => {
    const page = await env.pagina();
    await importarFoto(page, ...fotos);
    const nombre = await page.textContent('#doc-nombre');
    await dedo(page, 1);
    await page.click('#doc-paginas li:nth-child(3) .miniatura');
    await page.click('#doc-sel-pdf');
    assert.match(await page.textContent('dialog .hoja-detalle'), /2 páginas/);
    await page.click('dialog .hoja-botones .boton-primario');
    await page.waitForSelector('.resultado-pdf', { timeout: 30000 });
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('dialog .hoja-botones .boton-secundario')]);
    assert.equal(descarga.suggestedFilename(), `${nombre} (págs. 1, 3).pdf`);
    const texto = readFileSync(await descarga.path()).toString('latin1');
    assert.equal((texto.match(/\/Type \/Page /g) || []).length, 2);
    assert.deepEqual(page.errores, []);
  });
});
