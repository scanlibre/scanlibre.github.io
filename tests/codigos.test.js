import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import { interpretar } from '../js/codigos.js';
import { crearEntorno, importarFoto, guardarPNG, videoDeImagen } from './ayuda.js';

/** Una hoja blanca de w × h con el QR de `texto` en (x, y), de `escala` px por cuadrito */
function hojaConQR(textos, { w = 800, h = 1000, escala = 8 } = {}) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  textos.forEach(([texto, x0, y0]) => {
    const { modules } = QRCode.create(texto, { errorCorrectionLevel: 'M' });
    for (let r = 0; r < modules.size; r++) for (let c = 0; c < modules.size; c++) {
      if (!modules.get(r, c)) continue;
      for (let y = 0; y < escala; y++) for (let x = 0; x < escala; x++) {
        const i = ((y0 + r * escala + y) * w + x0 + c * escala + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 20;
      }
    }
  });
  // Un poco de "texto" alrededor, como en una factura
  for (let y = 700; y < 900; y += 24) for (let x = 60; x < 740; x++) if ((x >> 4) % 3) for (let k = 0; k < 8; k++) { const i = ((y + k) * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 40; }
  return { data, width: w, height: h };
}

/** La hoja sobre una mesa oscura, como en una foto (así se encuentra la hoja y no un QR) */
function sobreLaMesa(hoja, m = 60) {
  const W = hoja.width + 2 * m, H = hoja.height + 2 * m, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 70; data[i * 4 + 1] = 55; data[i * 4 + 2] = 45; data[i * 4 + 3] = 255; }
  for (let y = 0; y < hoja.height; y++) data.set(hoja.data.subarray(y * hoja.width * 4, (y + 1) * hoja.width * 4), ((y + m) * W + m) * 4);
  return { data, width: W, height: H };
}

describe('Códigos QR: qué dicen', () => {
  it('un enlace dice a qué sitio lleva y si es seguro', () => {
    assert.deepEqual(interpretar('https://www.unah.edu.hn/matricula?x=1'), { tipo: 'enlace', texto: 'https://www.unah.edu.hn/matricula?x=1', url: 'https://www.unah.edu.hn/matricula?x=1', sitio: 'unah.edu.hn', seguro: true });
    assert.equal(interpretar('http://ejemplo.com').seguro, false);
    assert.equal(interpretar('www.ejemplo.com').url, 'https://www.ejemplo.com');
  });
  it('una red Wi-Fi, con un ; escapado en la contraseña', () => {
    const w = interpretar('WIFI:T:WPA;S:Biblioteca UNAH;P:clave\\;segura;;');
    assert.equal(w.tipo, 'wifi');
    assert.equal(w.red, 'Biblioteca UNAH');
    assert.equal(w.clave, 'clave;segura');
    assert.equal(w.seguridad, 'WPA');
  });
  it('correo, teléfono, contacto y texto', () => {
    assert.equal(interpretar('mailto:tareas@ejemplo.com?subject=Hola').correo, 'tareas@ejemplo.com');
    assert.equal(interpretar('tel:+50422223333').telefono, '+50422223333');
    const c = interpretar('BEGIN:VCARD\nVERSION:3.0\nFN:Ana Martínez\nTEL:+50499998888\nEND:VCARD');
    assert.deepEqual([c.tipo, c.nombre, c.telefono], ['contacto', 'Ana Martínez', '+50499998888']);
    assert.deepEqual(interpretar('  Aula 204, edificio B2 '), { tipo: 'texto', texto: 'Aula 204, edificio B2' });
  });
});

describe('Códigos QR en la app', () => {
  let env;
  before(async () => {
    const pagina = sobreLaMesa(hojaConQR([['https://www.unah.edu.hn/calendario', 80, 80]]));
    // La cámara de prueba apunta a un QR de Wi-Fi
    const W = 720, H = 960, qr = hojaConQR([['WIFI:T:WPA;S:Aula 204;P:estudiar2026;;', 200, 280]], { w: W, h: H, escala: 10 });
    env = await crearEntorno({ video: videoDeImagen(qr, 'camara-qr.y4m') });
    env.pagina1 = guardarPNG(pagina, 'pagina-qr.png');
    env.dos = guardarPNG(sobreLaMesa(hojaConQR([['Primero', 60, 60], ['https://ejemplo.com/segundo', 460, 360]])), 'dos-qr.png');
  });
  after(async () => { await env.cerrar(); });

  it('lee el QR de una página: dice a qué sitio lleva antes de abrirlo', async () => {
    const page = await env.pagina({ conCamara: false, antes: () => { window.open = (url, destino, opciones) => { window.abierto = { url, destino, opciones }; }; } });
    await importarFoto(page, env.pagina1);
    await page.click('#doc-paginas .miniatura');
    await page.click('#pagina-mas');
    await page.click('.menu-opcion:has-text("Leer códigos QR")');
    await page.waitForSelector('dialog .codigo-dato', { timeout: 20000 });
    assert.equal(await page.textContent('dialog .hoja-titulo'), 'Enlace');
    assert.match(await page.textContent('dialog .codigo-dato'), /Lleva a\s*unah\.edu\.hn/);
    assert.equal(await page.textContent('dialog .codigo-texto'), 'https://www.unah.edu.hn/calendario');
    // Abrir: en otra pestaña, sin que la página pueda tocar la app
    await page.click('dialog .boton-primario:has-text("Abrir")');
    assert.deepEqual(await page.evaluate(() => window.abierto), { url: 'https://www.unah.edu.hn/calendario', destino: '_blank', opciones: 'noopener' });
    assert.deepEqual(page.errores, []);
  });

  it('con varios códigos en la página, deja elegir', async () => {
    const page = await env.pagina({ conCamara: false });
    await importarFoto(page, env.dos);
    await page.click('#doc-paginas .miniatura');
    await page.click('#pagina-mas');
    await page.click('.menu-opcion:has-text("Leer códigos QR")');
    await page.waitForSelector('dialog .hoja-titulo:has-text("2 códigos")', { timeout: 20000 });
    await page.click('.menu-opcion:has-text("segundo")');
    await page.waitForSelector('dialog .codigo-dato:has-text("ejemplo.com")');
  });

  it('en el modo QR la cámara lee el código sola (sin tomar foto)', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    await page.waitForSelector('#camara-disparar:not([disabled])', { timeout: 20000 });
    await page.click('#camara-modo');
    await page.click('.menu-opcion:has-text("Código QR")');
    await page.waitForFunction(() => document.querySelector('#camara-modo-texto').textContent === 'QR');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#camara-disparar')).visibility), 'hidden', 'no hay botón de foto');
    await page.waitForSelector('dialog .hoja-titulo:has-text("Red Wi-Fi")', { timeout: 20000 });
    assert.match(await page.textContent('dialog'), /Aula 204[^]*estudiar2026/);
    await page.keyboard.press('Escape');
    // Al volver al modo Hoja, vuelve el botón de foto
    await page.click('#camara-modo');
    await page.click('.menu-opcion:has-text("Hoja")');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#camara-disparar')).visibility === 'visible');
    assert.deepEqual(page.errores, []);
  });
});
