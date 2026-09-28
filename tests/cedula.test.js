import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { disposicion, ID1, PPP } from '../js/cedula.js';
import { crearEntorno, videoDePrueba, leerBase, descargarPDF } from './ayuda.js';

describe('Modo cédula: la hoja', () => {
  it('las dos caras a tamaño real (85,6 × 54 mm a 300 ppp), centradas y una debajo de la otra', () => {
    const { W, H, lugares } = disposicion('carta', [{ vertical: false }, { vertical: false }]);
    assert.deepEqual([W, H], [2550, 3300], 'carta a 300 ppp');
    const [a, b] = lugares;
    assert.equal(a.w, Math.round(ID1.ancho * PPP));
    assert.equal(a.w, 1011);
    assert.equal(a.h, 638);
    assert.ok(Math.abs(a.x + a.w / 2 - W / 2) <= 1, 'centrada');
    assert.equal(b.x, a.x);
    assert.ok(b.y > a.y + a.h, 'el reverso va debajo');
    const a4 = disposicion('a4', [{ vertical: true }]);
    assert.deepEqual([a4.W, a4.H], [2480, 3508]);
    assert.deepEqual([a4.lugares[0].w, a4.lugares[0].h], [638, 1011], 'una cédula vertical va parada');
  });
});

describe('Modo cédula con la cámara', () => {
  let env;
  before(async () => { env = await crearEntorno({ video: videoDePrueba(1) }); });
  after(async () => { await env.cerrar(); });

  async function tomar(page, titulo) {
    await page.waitForSelector('#camara-disparar:not([disabled])', { timeout: 20000 });
    await page.click('#camara-disparar');
    await page.waitForSelector('#vista-recorte:not([hidden])', { timeout: 20000 });
    assert.equal(await page.textContent('#titulo-recorte'), titulo);
    await page.click('#recorte-listo');
    await page.waitForSelector('#vista-camara:not([hidden])', { timeout: 30000 });
  }

  /** Dónde hay algo que no es blanco en la página guardada (fracciones del ancho y del alto) */
  const lleno = page => page.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('scanlibre'); q.onsuccess = () => r(q.result); });
    const [p] = await new Promise(r => { const q = db.transaction('paginas').objectStore('paginas').getAll(); q.onsuccess = () => r(q.result); });
    db.close();
    const bmp = await createImageBitmap(p.procesada);
    const c = new OffscreenCanvas(bmp.width, bmp.height), ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const { data, width: w, height: h } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const filas = [];
    let x0 = w, x1 = 0;
    for (let y = 0; y < h; y += 2) {
      let hay = false;
      for (let x = 0; x < w; x += 2) { const i = (y * w + x) * 4; if (data[i] + data[i + 1] + data[i + 2] < 700) { hay = true; x0 = Math.min(x0, x); x1 = Math.max(x1, x); } }
      filas.push(hay);
    }
    // Tramos de filas con algo
    const tramos = [];
    for (let i = 0; i < filas.length; i++) if (filas[i] && !filas[i - 1]) { let f = i; while (filas[f + 1]) f++; tramos.push([i * 2 / h, (f + 1) * 2 / h]); }
    return { ancho: (x1 - x0) / w, tramos, prop: w / h };
  });

  it('frente y reverso quedan en una hoja carta a tamaño real', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    await page.waitForSelector('#camara-disparar:not([disabled])', { timeout: 20000 });
    await page.click('#camara-modo');
    await page.click('.menu-opcion:has-text("Cédula")');
    await page.waitForFunction(() => document.querySelector('#camara-paso').textContent === 'Cédula: primero el frente' && !document.querySelector('#camara-paso').hidden);
    await tomar(page, 'Frente de la cédula');
    await page.waitForFunction(() => document.querySelector('#camara-paso').textContent === 'Cédula: ahora el reverso');
    assert.equal((await leerBase(page)).paginas.length, 0, 'con el frente todavía no hay página');
    await tomar(page, 'Reverso de la cédula');
    await page.waitForFunction(() => document.querySelector('#camara-cuenta').textContent === '1', null, { timeout: 30000 });
    const [p] = (await leerBase(page)).paginas;
    assert.equal(p.modo, 'cedula');
    assert.equal(p.aplanar, false);
    assert.equal(p.dedos, false);
    assert.equal(p.nitidez, null);
    const l = await lleno(page);
    assert.ok(Math.abs(l.prop - 215.9 / 279.4) < 0.005, `hoja carta: ${l.prop}`);
    // La "cédula" de la cámara de prueba es una hoja parada: va vertical (54 × 85,6 mm)
    assert.ok(Math.abs(l.ancho * 215.9 - 53.98) < 1.5, `la cédula mide 54 mm de ancho: ${(l.ancho * 215.9).toFixed(1)} mm`);
    assert.equal(l.tramos.length, 2, 'dos caras');
    for (const [a, b] of l.tramos) assert.ok(Math.abs((b - a) * 279.4 - 85.6) < 1.5, `alto ${((b - a) * 279.4).toFixed(1)} mm`);
    // En el PDF la imagen ocupa toda la hoja carta: al imprimir al 100 % queda a tamaño real
    await page.click('#camara-listo');
    await page.waitForSelector('#vista-documento:not([hidden])');
    const pdf = await descargarPDF(page);
    assert.match(pdf.texto, /\/MediaBox \[0 0 612 792\]/);
    assert.match(pdf.texto, /q 612 0 0 792 0 0 cm \/Im0 Do Q/);
    assert.deepEqual(page.errores, []);
  });

  it('si se cierra la cámara con solo el frente, queda la hoja con el frente', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    await page.waitForSelector('#camara-disparar:not([disabled])', { timeout: 20000 });
    await page.click('#camara-modo');
    await page.click('.menu-opcion:has-text("Cédula")');
    await page.waitForFunction(() => document.querySelector('#camara-modo-texto').textContent === 'Cédula');
    await tomar(page, 'Frente de la cédula');
    await page.click('#camara-cerrar');
    await page.waitForSelector('#vista-documento:not([hidden])');
    await page.waitForFunction(() => document.querySelectorAll('#doc-paginas .miniatura img').length === 1, null, { timeout: 30000 });
    const l = await lleno(page);
    assert.equal(l.tramos.length, 1);
    assert.deepEqual(page.errores, []);
  });
});
