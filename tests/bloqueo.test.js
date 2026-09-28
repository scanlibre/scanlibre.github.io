import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { protegerPin, pinCorrecto, pinValido, esperaPorFallos } from '../js/bloqueo.js';
import { crearEntorno, importarFoto, fotoConTexto } from './ayuda.js';

describe('Bloqueo con PIN: las cuentas', () => {
  it('del PIN se guarda solo una huella con sal, y se reconoce', async () => {
    const g = await protegerPin('2468', 1000);
    assert.ok(!JSON.stringify(g).includes('2468'));
    assert.equal(await pinCorrecto('2468', g), true);
    assert.equal(await pinCorrecto('2469', g), false);
    assert.notEqual((await protegerPin('2468', 1000)).hash, g.hash, 'otra sal, otra huella');
  });

  it('el PIN es de 4 a 12 números, y los fallos obligan a esperar cada vez más', () => {
    for (const bueno of ['1234', '000000', '123456789012']) assert.ok(pinValido(bueno), bueno);
    for (const malo of ['123', '12a4', '1234567890123', '']) assert.ok(!pinValido(malo), malo);
    assert.deepEqual([4, 5, 6, 7, 20].map(esperaPorFallos), [0, 30e3, 60e3, 120e3, 15 * 60e3]);
  });
});

describe('Bloqueo con PIN en la app', () => {
  let env, foto;
  before(async () => {
    env = await crearEntorno();
    foto = await fotoConTexto('bloqueo.png', ['Copia de la cédula']);
  });
  after(async () => { await env.cerrar(); });

  const alInicio = async (page, url = env.url) => {
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#bloqueo') || !document.querySelector('#vista-inicio').hidden);
  };

  async function ponerPin(page, pin) {
    await page.click('#inicio-menu');
    await page.click('.menu-opcion:has-text("Bloqueo con PIN")');
    await page.click('dialog[open] .boton:has-text("Poner un PIN")');
    await page.waitForSelector('dialog[open] .hoja-titulo:has-text("Escribe un PIN nuevo")');
    await page.fill('#pin-entrada', pin);
    await page.click('#pin-listo');
    await page.waitForSelector('dialog[open] .hoja-titulo:has-text("Escríbelo otra vez")');
    await page.fill('#pin-entrada', pin);
    await page.click('#pin-listo');
    await page.waitForSelector('.aviso:has-text("protegido con tu PIN")');
  }
  const escribir = async (page, pin) => { await page.fill('#bloqueo-pin', pin); await page.click('#bloqueo-abrir'); };
  const visibilidad = (page, estado) => page.evaluate(estado => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => estado });
    document.dispatchEvent(new Event('visibilitychange'));
  }, estado);

  it('con PIN, la app arranca bloqueada, sin mostrar los documentos, y el PIN no queda guardado', async () => {
    const page = await env.pagina();
    await importarFoto(page, foto);
    await alInicio(page);
    await ponerPin(page, '2468');
    assert.ok(!JSON.stringify(await page.evaluate(() => ({ ...localStorage }))).includes('2468'), 'el PIN no está en el teléfono');
    await alInicio(page);
    await page.waitForSelector('#bloqueo');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#vista-inicio')).visibility), 'hidden');
    assert.equal(await page.evaluate(() => !!document.querySelector('#vista-inicio').closest('[inert]')), true, 'y no se puede tocar');
    await escribir(page, '1111');
    await page.waitForSelector('#bloqueo-mensaje:has-text("PIN incorrecto")');
    await escribir(page, '2468');
    await page.waitForSelector('#bloqueo', { state: 'detached' });
    assert.equal(await page.locator('#inicio-lista li').count(), 1);
    assert.deepEqual(page.errores, []);
  });

  it('se vuelve a bloquear al salir de la app (un rato, o enseguida si se elige)', async () => {
    const page = await env.pagina();
    await ponerPin(page, '1357');
    await visibilidad(page, 'hidden');
    await visibilidad(page, 'visible');
    assert.equal(await page.locator('#bloqueo').count(), 0, 'volver en seguida no bloquea (espera de 1 minuto)');
    await page.click('#inicio-menu');
    await page.click('.menu-opcion:has-text("Bloqueo con PIN (activado)")');
    await page.click('.menu-opcion:has-text("Se bloquea")');
    await page.click('.menu-opcion:has-text("Enseguida al salir")');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('scanlibre_ajustes')).bloqueo.espera === 0);
    await visibilidad(page, 'hidden');
    await page.waitForSelector('#bloqueo', { state: 'attached' });
    await visibilidad(page, 'visible');
    await escribir(page, '1357');
    await page.waitForSelector('#bloqueo', { state: 'detached' });
  });

  it('después de 5 intentos fallidos hay que esperar, aunque se vuelva a abrir', async () => {
    const page = await env.pagina();
    await ponerPin(page, '9753');
    await alInicio(page);
    for (let i = 1; i <= 5; i++) {
      await escribir(page, '0000');
      await page.waitForFunction(n => JSON.parse(localStorage.getItem('scanlibre_intentos') || '{}').fallos === n, i);
    }
    await page.waitForSelector('#bloqueo-mensaje:has-text("Demasiados intentos")');
    assert.equal(await page.isDisabled('#bloqueo-pin'), true);
    await alInicio(page);
    await page.waitForSelector('#bloqueo-mensaje:has-text("Demasiados intentos")');
  });

  it('si se olvida el PIN, se puede borrar todo y empezar de nuevo', async () => {
    const page = await env.pagina();
    await importarFoto(page, foto);
    await alInicio(page);
    await ponerPin(page, '8642');
    await alInicio(page);
    await page.click('#bloqueo-olvide');
    assert.equal(await page.isDisabled('#bloqueo-borrar'), true, 'hay que escribir BORRAR');
    await page.fill('#bloqueo-confirmar', 'borrar');
    await Promise.all([page.waitForEvent('load'), page.click('#bloqueo-borrar')]);
    await page.waitForSelector('#vista-inicio:not([hidden])');
    assert.equal(await page.locator('#bloqueo').count(), 0);
    await page.waitForSelector('#inicio-vacio:not([hidden])');
    assert.equal(await page.locator('#inicio-lista li').count(), 0);
  });

  it('quitar el bloqueo pide el PIN de ahora', async () => {
    const page = await env.pagina();
    await ponerPin(page, '1470');
    const quitar = async pin => {
      await page.click('#inicio-menu');
      await page.click('.menu-opcion:has-text("Bloqueo con PIN (activado)")');
      await page.click('.menu-opcion:has-text("Quitar el bloqueo")');
      await page.fill('#pin-entrada', pin);
      await page.click('#pin-listo');
    };
    await quitar('0741');
    await page.waitForSelector('.aviso:has-text("PIN incorrecto")');
    await quitar('1470');
    await page.waitForSelector('.aviso:has-text("ya no pide PIN")');
    await alInicio(page);
    assert.equal(await page.locator('#bloqueo').count(), 0);
  });

  it('con la huella (o el bloqueo del teléfono), se abre sin escribir el PIN', async () => {
    const page = await env.pagina();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true
    } });
    const url = env.url.replace('127.0.0.1', 'localhost'); // WebAuthn necesita un nombre, no una IP
    await alInicio(page, url);
    await ponerPin(page, '2580');
    await page.click('dialog[open] .boton:has-text("Usar la huella")');
    await page.waitForSelector('.aviso:has-text("con la huella")');
    assert.equal((await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials.length, 1);
    await alInicio(page, url);
    await page.waitForSelector('#bloqueo', { state: 'detached' });
    assert.deepEqual(page.errores, []);
  });
});
