import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno, videoDePrueba, leerBase, fotoDePrueba, importarFoto } from './ayuda.js';

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
    assert.equal(await page.isVisible('#recorte-borrosa'), false, 'la foto es nítida: no avisa');
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

  it('"Acerca de" muestra con qué resolución salió la última foto', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    await esperarHoja(page);
    await page.click('#camara-rafaga');
    await page.click('#camara-disparar');
    await page.waitForFunction(() => document.querySelector('#camara-cuenta').textContent === '1', null, { timeout: 20000 });
    await page.click('#camara-listo');
    await page.click('#doc-atras');
    await page.click('#inicio-menu');
    await page.click('.menu-opcion:nth-child(3)');
    const texto = await page.textContent('.diagnostico');
    assert.match(texto, /última foto: \d+ × \d+ \((foto completa|cuadro del video)/);
    assert.match(texto, /video: 720 × 960/);
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

  it('una página borrosa se vuelve a tomar y queda en su mismo lugar', async () => {
    const page = await env.pagina();
    await importarFoto(page, fotoDePrueba(2).ruta, fotoDePrueba(1, 'borrosa.png', { borrosa: true }).ruta);
    const antes = await leerBase(page);
    await page.click('#doc-paginas li:nth-child(2) .miniatura');
    await page.click('#pagina-retomar');
    await esperarHoja(page);
    await page.click('#camara-disparar');
    await page.waitForSelector('#vista-recorte:not([hidden])', { timeout: 20000 });
    await page.click('#recorte-listo');
    await page.waitForSelector('#vista-pagina:not([hidden])', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('#pagina-titulo').textContent === 'Página 2 de 2');
    assert.equal(await page.isVisible('#pagina-borrosa'), false, 'ya no está borrosa');
    const despues = await leerBase(page);
    assert.deepEqual(despues.documentos[0].paginas, antes.documentos[0].paginas, 'mismas páginas, mismo orden');
    const p2 = despues.paginas.find(p => p.id === antes.documentos[0].paginas[1]);
    assert.ok(p2.nitidez > 0.25, `nitidez nueva ${p2.nitidez}`);
    // Atrás vuelve al documento, no a la cámara
    await page.click('#pagina-atras');
    await page.waitForSelector('#vista-documento:not([hidden])');
  });

  it('el disparador no toma fotos antes de que la cámara tenga imagen', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    assert.equal(await page.isDisabled('#camara-disparar'), true);
    await page.waitForSelector('#camara-disparar:not([disabled])', { timeout: 20000 });
    assert.ok(await page.evaluate(() => document.querySelector('#camara-video').videoWidth > 0));
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

describe('Cámara que no enfoca', () => {
  let env;
  before(async () => { env = await crearEntorno({ video: videoDePrueba(1, { borrosa: true }) }); });
  after(async () => { await env.cerrar(); });

  it('si la foto sale borrosa, el recorte avisa y ofrece repetirla', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    await page.waitForSelector('#camara-disparar:not([disabled])', { timeout: 20000 });
    await page.click('#camara-disparar');
    await page.waitForSelector('#vista-recorte:not([hidden])', { timeout: 20000 });
    await page.waitForSelector('#recorte-borrosa:not([hidden])');
    await page.click('#recorte-repetir');
    await page.waitForSelector('#vista-camara:not([hidden])');
    assert.equal(await page.textContent('#camara-cuenta'), '0', 'no se guardó la foto borrosa');
  });

  it('la captura automática repite sola la foto borrosa y, si sigue igual, avisa', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    await page.waitForSelector('#camara-disparar:not([disabled])', { timeout: 20000 });
    // Anota cada texto de la pista
    await page.evaluate(() => {
      window.pistas = [];
      const p = document.querySelector('#camara-pista');
      new MutationObserver(() => window.pistas.push(p.textContent)).observe(p, { childList: true, characterData: true, subtree: true });
    });
    await page.click('#camara-auto');
    await page.waitForSelector('#vista-recorte:not([hidden])', { timeout: 60000 });
    await page.waitForSelector('#recorte-borrosa:not([hidden])');
    const pistas = await page.evaluate(() => window.pistas);
    assert.equal(pistas.filter(t => t.startsWith('Salió borrosa')).length, 2, pistas.join(' | '));
    assert.ok(pistas.includes('Tomando la foto… no te muevas'), 'avisa mientras toma la foto');
    assert.deepEqual(page.errores, []);
  });
});

describe('Cámara en una mano que tiembla', () => {
  let env;
  // Como en el video del Samsung: con la mano "quieta" la imagen igual se mueve un poco
  before(async () => { env = await crearEntorno({ video: videoDePrueba(1, { temblor: 3 }) }); });
  after(async () => { await env.cerrar(); });

  it('la captura automática no se traba: toma la foto en unos segundos', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    await page.waitForSelector('#camara-disparar:not([disabled])', { timeout: 20000 });
    await page.click('#camara-rafaga');
    const inicio = Date.now();
    await page.click('#camara-auto');
    await page.waitForFunction(() => document.querySelector('#camara-cuenta').textContent === '1', null, { timeout: 15000 });
    const segundos = (Date.now() - inicio) / 1000;
    assert.ok(segundos < 8, `tardó ${segundos} s`);
    assert.deepEqual(page.errores, []);
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
