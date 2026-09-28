import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { recordarRespaldo } from '../js/recordatorio.js';
import { crearEntorno, importarFoto, fotoConTexto } from './ayuda.js';

const DIA = 864e5, AHORA = Date.UTC(2026, 8, 28);
const doc = (creadoHaceDias, modificadoHaceDias = creadoHaceDias) => ({ creado: AHORA - creadoHaceDias * DIA, modificado: AHORA - modificadoHaceDias * DIA });

describe('Recordatorio de respaldo: cuándo', () => {
  it('sin ningún respaldo, avisa a la semana del primer documento', () => {
    assert.equal(recordarRespaldo([], { ahora: AHORA }), null, 'sin documentos, nada');
    assert.equal(recordarRespaldo([doc(3)], { ahora: AHORA }), null);
    assert.deepEqual(recordarRespaldo([doc(3), doc(8)], { ahora: AHORA }), { nunca: true, dias: 8 });
  });

  it('con un respaldo, avisa cada 30 días y solo si hubo cambios después', () => {
    assert.equal(recordarRespaldo([doc(60, 45)], { ultimo: AHORA - 40 * DIA, ahora: AHORA }), null, 'nada cambió desde el respaldo');
    assert.equal(recordarRespaldo([doc(60, 2)], { ultimo: AHORA - 10 * DIA, ahora: AHORA }), null, 'todavía no pasan 30 días');
    assert.deepEqual(recordarRespaldo([doc(60, 2)], { ultimo: AHORA - 40 * DIA, ahora: AHORA }), { nunca: false, dias: 40 });
  });

  it('"Ahora no" lo calla una semana', () => {
    assert.equal(recordarRespaldo([doc(20)], { pospuesto: AHORA - 2 * DIA, ahora: AHORA }), null);
    assert.ok(recordarRespaldo([doc(20)], { pospuesto: AHORA - 8 * DIA, ahora: AHORA }));
  });
});

describe('Recordatorio de respaldo en la app', () => {
  let env, foto;
  before(async () => {
    env = await crearEntorno();
    foto = await fotoConTexto('recordatorio.png', ['Apuntes de la clase']);
  });
  after(async () => { await env.cerrar(); });

  /** Hace que los documentos parezcan de hace `dias` días */
  const envejecer = (page, dias) => page.evaluate(async dias => {
    const db = await new Promise((r, e) => { const q = indexedDB.open('scanlibre'); q.onsuccess = () => r(q.result); q.onerror = () => e(q.error); });
    const tx = db.transaction('documentos', 'readwrite'), tienda = tx.objectStore('documentos');
    const docs = await new Promise(r => { const q = tienda.getAll(); q.onsuccess = () => r(q.result); });
    const hace = Date.now() - dias * 864e5;
    for (const d of docs) tienda.put({ ...d, creado: hace, modificado: hace });
    await new Promise(r => { tx.oncomplete = r; });
    db.close();
  }, dias);

  const alInicio = async page => { await page.goto(env.url); await page.waitForSelector('#vista-inicio:not([hidden])'); };

  it('avisa si nunca se respaldó; al guardar el respaldo, se calla', async () => {
    const page = await env.pagina();
    await importarFoto(page, foto);
    await alInicio(page);
    assert.equal(await page.isHidden('#inicio-respaldo'), true, 'un documento nuevo todavía no pide respaldo');
    await envejecer(page, 10);
    await alInicio(page);
    await page.waitForSelector('#inicio-respaldo:not([hidden])');
    assert.match(await page.textContent('#inicio-respaldo-texto'), /solo están en este teléfono/);
    await page.click('#inicio-respaldo-hacer');
    await page.waitForSelector('dialog[open] .hoja-titulo:has-text("Respaldo listo")');
    assert.match(await page.textContent('dialog[open] .pasos-respaldo'), /Restaurar un respaldo/, 'con la guía para pasarlo a otro teléfono');
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('dialog[open] .boton:has-text("Descargar")')]);
    assert.match(descarga.suggestedFilename(), /^ScanLibre-respaldo-.*\.zip$/);
    await page.waitForSelector('#inicio-respaldo', { state: 'hidden' });
    await alInicio(page);
    assert.equal(await page.isHidden('#inicio-respaldo'), true, 'después de respaldar ya no avisa');
    assert.deepEqual(page.errores, []);
  });

  it('"Ahora no" lo esconde y queda así al volver a abrir', async () => {
    const page = await env.pagina();
    await importarFoto(page, foto);
    await envejecer(page, 10);
    await alInicio(page);
    await page.waitForSelector('#inicio-respaldo:not([hidden])');
    await page.click('#inicio-respaldo-despues');
    await page.waitForSelector('#inicio-respaldo', { state: 'hidden' });
    await alInicio(page);
    assert.equal(await page.isHidden('#inicio-respaldo'), true);
  });
});
