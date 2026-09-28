import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { traducir, traductorDelTelefono } from '../js/traducir.js';
import { crearEntorno, importarFoto, fotoConTexto } from './ayuda.js';

describe('Traducir: las cuentas', () => {
  it('traduce párrafo por párrafo y deja los encabezados de página y los renglones en blanco', async () => {
    const pedidos = [];
    globalThis.Translator = {
      availability: async () => 'available',
      create: async ({ targetLanguage }) => ({ translate: async t => { pedidos.push(t); return `[${targetLanguage}] ${t}`; }, destroy() {} })
    };
    const avances = [];
    const r = await traducir('— Página 1 —\nHola mundo.\nSegundo renglón.\n\n— Página 2 —\nAdiós.', 'es', 'en', { alAvanzar: a => avances.push(a.progreso) });
    assert.equal(r, '— Página 1 —\n[en] Hola mundo.\nSegundo renglón.\n\n— Página 2 —\n[en] Adiós.');
    assert.deepEqual(pedidos, ['Hola mundo.\nSegundo renglón.', 'Adiós.']);
    assert.deepEqual(avances, [0.5, 1]);
    assert.equal(await traductorDelTelefono('es', 'en'), 'available');
    globalThis.Translator = { availability: async () => 'unavailable', create: async () => null };
    assert.equal(await traductorDelTelefono('es', 'en'), null);
    delete globalThis.Translator;
    assert.equal(await traductorDelTelefono('es', 'en'), null, 'sin traductor en el navegador');
  });
});

describe('Traducir en la app', () => {
  let env, hoja;
  before(async () => {
    env = await crearEntorno();
    hoja = await fotoConTexto('traducir.png', ['La célula es la unidad básica de la vida.']);
  });
  after(async () => { await env.cerrar(); });

  const abrirTexto = async page => {
    await importarFoto(page, hoja);
    await page.click('#doc-paginas .miniatura');
    await page.click('#pagina-texto');
    await page.waitForFunction(() => /célula/.test(document.querySelector('.texto-leido')?.value || ''), null, { timeout: 90000 });
  };

  it('con el traductor del teléfono, traduce ahí mismo (sin internet)', async () => {
    const page = await env.pagina({ antes: () => {
      window.Translator = {
        availability: async () => 'downloadable',
        create: async ({ sourceLanguage, targetLanguage, monitor }) => {
          const m = new EventTarget(); monitor?.(m);
          const e = new Event('downloadprogress'); e.loaded = 1; m.dispatchEvent(e);
          window.pedido = { sourceLanguage, targetLanguage };
          return { translate: async t => t.replace('La célula es la unidad básica de la vida.', 'The cell is the basic unit of life.'), destroy() {} };
        }
      };
    } });
    await abrirTexto(page);
    await page.click('dialog .boton:has-text("Traducir")');
    await page.click('.menu-opcion:has-text("Al inglés")');
    await page.waitForFunction(() => /The cell is the basic unit of life/.test(document.querySelector('.texto-traducido')?.value || ''), null, { timeout: 15000 });
    assert.deepEqual(await page.evaluate(() => window.pedido), { sourceLanguage: 'es', targetLanguage: 'en' });
    assert.equal(await page.textContent('dialog[open] >> nth=-1 >> .hoja-titulo'), 'Traducción al inglés');
    assert.match(await page.textContent('dialog[open] >> nth=-1 >> .hoja-detalle'), /no salió a internet/);
    assert.deepEqual(page.errores.filter(e => !/too small to scale|cannot be recognized|Empty page/i.test(e)), []);
  });

  it('sin traductor en el teléfono, el texto no sale a internet: se puede pasar a otra app', async () => {
    const page = await env.pagina({ antes: () => {
      delete window.Translator;
      window.open = url => { window.abierto = url; };
      Object.defineProperty(navigator, 'share', { configurable: true, value: async datos => { window.compartido = datos; } });
    } });
    await abrirTexto(page);
    await page.click('dialog .boton:has-text("Traducir")');
    await page.click('.menu-opcion:has-text("Al inglés")');
    await page.waitForSelector('dialog .boton:has-text("Compartir el texto")');
    assert.match(await page.textContent('dialog[open] >> nth=-1'), /no manda tu texto a internet/);
    await page.click('dialog[open] >> nth=-1 >> .boton:has-text("Compartir el texto")');
    await page.waitForFunction(() => window.compartido);
    assert.match((await page.evaluate(() => window.compartido)).text, /célula/);
    assert.equal(await page.evaluate(() => window.abierto), undefined, 'no abre ningún sitio');
  });
});
