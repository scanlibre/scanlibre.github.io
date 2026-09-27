import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno, videoDePrueba, leerBase } from './ayuda.js';

describe('La cámara', () => {
  let env;
  before(async () => { env = await crearEntorno({ video: videoDePrueba(1) }); });
  after(async () => { await env.cerrar(); });

  const esperarHoja = page => page.waitForFunction(() => document.querySelector('#camara-pista').textContent === 'Hoja encontrada', null, { timeout: 20000 });

  it('marca la hoja en vivo, toma la foto y guarda la página', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    await esperarHoja(page);
    await page.click('#camara-disparar');
    await page.waitForSelector('#vista-recorte:not([hidden])', { timeout: 20000 });
    await page.click('#recorte-listo');
    await page.waitForFunction(() => document.querySelector('#camara-cuenta').textContent === '1', null, { timeout: 20000 });
    await page.click('#camara-listo');
    await page.waitForSelector('#doc-paginas .miniatura img', { timeout: 20000 });
    const { paginas } = await leerBase(page);
    assert.equal(paginas.length, 1);
    // En el video la hoja no llena la foto: las esquinas no pueden ser las de la foto completa
    assert.ok(paginas[0].esquinas[0].x > 0.1 && paginas[0].esquinas[0].y > 0.05, JSON.stringify(paginas[0].esquinas[0]));
    assert.deepEqual(page.errores, []);
  });

  it('en ráfaga toma varias fotos seguidas sin parar', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    await esperarHoja(page);
    await page.click('#camara-rafaga');
    for (let i = 1; i <= 3; i++) {
      await page.click('#camara-disparar');
      await page.waitForFunction(n => document.querySelector('#camara-cuenta').textContent === String(n), i, { timeout: 20000 });
    }
    await page.click('#camara-listo');
    await page.waitForFunction(() => document.querySelectorAll('#doc-paginas .miniatura img').length === 3, null, { timeout: 40000 });
    assert.equal((await leerBase(page)).paginas.length, 3);
  });

  it('la captura automática toma la foto sola y no repite la misma hoja', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    await esperarHoja(page);
    await page.click('#camara-rafaga');
    await page.click('#camara-auto');
    await page.waitForFunction(() => document.querySelector('#camara-cuenta').textContent === '1', null, { timeout: 20000 });
    await page.waitForTimeout(4000); // la misma hoja sigue quieta frente a la cámara
    assert.equal(await page.textContent('#camara-cuenta'), '1');
  });

  it('volver atrás desde la cámara apaga la cámara', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    await esperarHoja(page);
    await page.goBack();
    await page.waitForSelector('#vista-inicio:not([hidden])');
    assert.equal(await page.evaluate(() => document.querySelector('#camara-video').srcObject), null);
  });
});

describe('Sin cámara', () => {
  let env;
  before(async () => { env = await crearEntorno(); });
  after(async () => { await env.cerrar(); });

  it('explica el motivo y ofrece la cámara del teléfono o la galería', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    await page.waitForSelector('#camara-sin-camara:not([hidden])', { timeout: 20000 });
    assert.equal(await page.isVisible('#camara-nativa'), true);
    assert.equal(await page.isVisible('#camara-galeria-alt'), true);
  });
});
