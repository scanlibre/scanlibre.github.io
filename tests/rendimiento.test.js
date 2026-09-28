import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno, importarFoto, leerBase, guardarPNG, videoDeImagen } from './ayuda.js';
import { crearEscena, ESCENAS } from './escenas.js';

// Una foto de 12 MP (3000 × 4000), como la de muchos teléfonos
const e = ESCENAS[1], f = 3000 / 480;
const grande = () => crearEscena({ ...e, ancho: 3000, alto: 4000, esquinas: e.esquinas.map(p => ({ x: p.x * f, y: p.y * f })), ruido: 0, semilla: 3 });

/** Anota en la página cada lectura de píxeles del hilo principal y lo que se le pide a la cámara */
function espiar() {
  window.__lecturas = [];
  const leer = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h, ...resto) { window.__lecturas.push(w * h); return leer.call(this, x, y, w, h, ...resto); };
  if (window.ImageCapture) {
    // Como una cámara de 48 MP (8000 × 6000): la foto se anota y se toma a la medida de la cámara de prueba
    const capacidades = ImageCapture.prototype.getPhotoCapabilities;
    ImageCapture.prototype.getPhotoCapabilities = async function () {
      return { ...(await capacidades.call(this)), imageWidth: { min: 640, max: 6000, step: 16 }, imageHeight: { min: 480, max: 8000, step: 16 } };
    };
    const tomar = ImageCapture.prototype.takePhoto;
    ImageCapture.prototype.takePhoto = function (pedido) { window.__pedido = pedido || {}; return tomar.call(this, {}); };
  }
}
// Lo mismo, como en un teléfono de gama baja (las funciones pasan a la página solas: sin variables de afuera)
function espiarLiviano() {
  localStorage.setItem('scanlibre_ajustes', JSON.stringify({ ...JSON.parse(localStorage.getItem('scanlibre_ajustes') || '{}'), liviano: true }));
  window.__lecturas = [];
  const leer = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h, ...resto) { window.__lecturas.push(w * h); return leer.call(this, x, y, w, h, ...resto); };
  if (window.ImageCapture) {
    // Como una cámara de 48 MP (8000 × 6000): la foto se anota y se toma a la medida de la cámara de prueba
    const capacidades = ImageCapture.prototype.getPhotoCapabilities;
    ImageCapture.prototype.getPhotoCapabilities = async function () {
      return { ...(await capacidades.call(this)), imageWidth: { min: 640, max: 6000, step: 16 }, imageHeight: { min: 480, max: 8000, step: 16 } };
    };
    const tomar = ImageCapture.prototype.takePhoto;
    ImageCapture.prototype.takePhoto = function (pedido) { window.__pedido = pedido || {}; return tomar.call(this, {}); };
  }
}

const lado = (a, b) => Math.max(a, b);

describe('Rendimiento: la foto se arma en el worker y más chica en gama baja', () => {
  let env, foto;
  before(async () => { env = await crearEntorno(); foto = guardarPNG(grande(), 'grande-12mp.png'); });
  after(async () => { await env.cerrar(); });

  it('una foto de 12 MP se guarda completa y la página a 3000 px, sin leer píxeles grandes en la página', async () => {
    const page = await env.pagina({ antes: espiar });
    await importarFoto(page, foto);
    const [p] = (await leerBase(page)).paginas;
    assert.deepEqual([p.ancho, p.alto], [3000, 4000]);
    assert.ok(lado(p.procAncho, p.procAlto) <= 3000 && lado(p.procAncho, p.procAlto) > 2400, `${p.procAncho} × ${p.procAlto}`);
    const mayor = Math.max(0, ...await page.evaluate(() => window.__lecturas));
    assert.ok(mayor <= 1e6, `el hilo principal leyó ${mayor} píxeles de una vez`);
    assert.deepEqual(page.errores, []);
  });

  it('en gama baja la foto queda a 3000 px y la página a 2400', async () => {
    const page = await env.pagina({ antes: espiarLiviano });
    await importarFoto(page, foto);
    const [p] = (await leerBase(page)).paginas;
    assert.deepEqual([p.ancho, p.alto], [2250, 3000]);
    assert.ok(lado(p.procAncho, p.procAlto) <= 2400, `${p.procAncho} × ${p.procAlto}`);
    assert.deepEqual(page.errores, []);
  });

  it('sin OffscreenCanvas en el worker, se hace en la página y sale igual', async () => {
    const page = await env.pagina({ antes: () => localStorage.setItem('scanlibre_fotos_en_pagina', '1') });
    await importarFoto(page, foto);
    const [p] = (await leerBase(page)).paginas;
    assert.deepEqual([p.ancho, p.alto], [3000, 4000]);
    assert.ok(lado(p.procAncho, p.procAlto) <= 3000 && p.procesada > 1000 && p.miniatura > 0);
    assert.deepEqual(page.errores, []);
  });
});

describe('Rendimiento: la cámara', () => {
  let env;
  before(async () => { env = await crearEntorno({ video: videoDeImagen(grande(), 'camara-12mp.y4m') }); });
  after(async () => { await env.cerrar(); });

  const tomarYGuardar = async page => {
    await page.click('#inicio-escanear');
    await page.waitForSelector('#camara-disparar:not([disabled])', { timeout: 30000 });
    await page.click('#camara-disparar');
    await page.waitForSelector('#vista-recorte:not([hidden])', { timeout: 60000 });
    await page.click('#recorte-listo');
    await page.waitForSelector('#vista-camara:not([hidden])', { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('#camara-cuenta').textContent === '1', null, { timeout: 30000 });
  };

  it('pide la foto a la medida que se guarda y no lee píxeles grandes en la página', async () => {
    const page = await env.pagina({ antes: espiar });
    await tomarYGuardar(page);
    const { pedido, mayor, diag } = await page.evaluate(() => ({ pedido: window.__pedido, mayor: Math.max(0, ...window.__lecturas), diag: JSON.parse(localStorage.getItem('scanlibre_camara')) }));
    const pedida = lado(pedido.imageWidth, pedido.imageHeight);
    assert.ok(pedida <= 4000 && pedida > 3900, 'de un sensor de 48 MP se pide la foto a 4000 px: ' + JSON.stringify(pedido));
    assert.ok(mayor <= 1e6, `el hilo principal leyó ${mayor} píxeles de una vez`);
    assert.equal(diag.origen, 'foto completa');
    assert.equal(typeof diag.preparar, 'number');
    assert.deepEqual(page.errores, []);
  });

  it('en gama baja pide la foto más chica (3000 px)', async () => {
    const page = await env.pagina({ antes: espiarLiviano });
    await tomarYGuardar(page);
    const pedido = await page.evaluate(() => window.__pedido);
    const pedida = lado(pedido.imageWidth, pedido.imageHeight);
    assert.ok(pedida <= 3000 && pedida > 2900, JSON.stringify(pedido));
    const [p] = (await leerBase(page)).paginas;
    assert.ok(lado(p.ancho, p.alto) <= 3000 && lado(p.procAncho, p.procAlto) <= 2400, JSON.stringify([p.ancho, p.alto, p.procAncho, p.procAlto]));
    assert.deepEqual(page.errores, []);
  });
});
