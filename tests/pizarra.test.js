import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarFiltro, FILTROS } from '../js/imagen/filtros.js';
import { crearEntorno, videoDePrueba, leerBase } from './ayuda.js';

/**
 * Una pizarra de prueba de 600×400: fondo con luz despareja, un reflejo de
 * lámpara y tres trazos (renglones gruesos) de colores.
 * @param oscura  pizarra verde de tiza (si no, blanca de marcador)
 */
function pizarra({ oscura = false } = {}) {
  const w = 600, h = 400, data = new Uint8ClampedArray(w * h * 4);
  const trazos = oscura
    ? [[60, [225, 228, 222]], [160, [235, 215, 80]], [260, [230, 140, 190]]] // tiza blanca, amarilla y rosada
    : [[60, [30, 32, 38]], [160, [40, 80, 200]], [260, [200, 40, 40]]];     // marcador negro, azul y rojo
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const luz = 0.75 + 0.25 * (x / w) * (1 - 0.4 * y / h);
    let c = oscura ? [40, 72, 52].map(v => v * (0.8 + 0.4 * luz)) : [205, 208, 212].map(v => v * luz);
    // Reflejo de la lámpara (solo en la blanca)
    const d = Math.hypot(x - 480, y - 330);
    if (!oscura && d < 50) c = c.map(v => v + (255 - v) * (1 - d / 50) * 0.9);
    for (const [y0, color] of trazos) if (y >= y0 && y < y0 + 10 && x > 50 && x < 550 && (x >> 4) % 3 !== 0) c = color.map(v => v * (oscura ? 1 : luz));
    const i = (y * w + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
/** Promedio de color en un rectángulo */
function media(img, x0, y0, x1, y1, que = () => true) {
  const s = [0, 0, 0]; let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { if (!que(x, y)) continue; const c = px(img, x, y); s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; n++; }
  return s.map(v => v / n);
}
const enTrazo = (x) => (x >> 4) % 3 !== 0;

describe('Modo pizarra', () => {
  it('está entre los filtros', () => {
    assert.equal(FILTROS.pizarra, 'Pizarra');
  });

  it('pizarra blanca: fondo blanco parejo (también donde brilla la lámpara) y trazos oscuros con su color', () => {
    const out = aplicarFiltro(pizarra(), 'pizarra');
    const fondo = media(out, 10, 100, 590, 150);
    assert.ok(lum(fondo) > 248, `fondo ${fondo.map(Math.round)}`);
    const reflejo = media(out, 460, 310, 500, 350);
    assert.ok(lum(reflejo) > 248, `reflejo ${reflejo.map(Math.round)}`);
    const negro = media(out, 60, 62, 540, 68, enTrazo), azul = media(out, 60, 162, 540, 168, enTrazo), rojo = media(out, 60, 262, 540, 268, enTrazo);
    assert.ok(lum(negro) < 50, `negro ${negro.map(Math.round)}`);
    assert.ok(azul[2] > azul[0] + 100 && lum(azul) < 120, `azul ${azul.map(Math.round)}`);
    assert.ok(rojo[0] > rojo[2] + 100 && lum(rojo) < 110, `rojo ${rojo.map(Math.round)}`);
  });

  it('pizarra verde: queda en blanco con la tiza oscura, y la tiza de color con su color', () => {
    const out = aplicarFiltro(pizarra({ oscura: true }), 'pizarra');
    const fondo = media(out, 10, 100, 590, 150);
    assert.ok(lum(fondo) > 245, `fondo ${fondo.map(Math.round)}`);
    const blanca = media(out, 60, 62, 540, 68, enTrazo), amarilla = media(out, 60, 162, 540, 168, enTrazo), rosada = media(out, 60, 262, 540, 268, enTrazo);
    assert.ok(lum(blanca) < 70 && Math.max(...blanca) - Math.min(...blanca) < 20, `tiza blanca ${blanca.map(Math.round)}`);
    assert.ok(amarilla[0] > amarilla[2] + 80 && amarilla[1] > amarilla[2] + 40 && lum(amarilla) < 170, `tiza amarilla ${amarilla.map(Math.round)}`);
    assert.ok(rosada[0] > rosada[1] + 60 && lum(rosada) < 170, `tiza rosada ${rosada.map(Math.round)}`);
  });
});

describe('Modo pizarra con la cámara', () => {
  let env;
  before(async () => { env = await crearEntorno({ video: videoDePrueba(1) }); });
  after(async () => { await env.cerrar(); });

  it('en el modo Pizarra las fotos salen con el filtro Pizarra, y el modo se recuerda', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    await page.waitForSelector('#camara-disparar:not([disabled])', { timeout: 20000 });
    assert.equal(await page.textContent('#camara-modo-texto'), 'Hoja');
    await page.click('#camara-modo');
    await page.click('.menu-opcion:has-text("Pizarra")');
    await page.waitForFunction(m => document.querySelector('#camara-modo-texto').textContent === m, 'Pizarra');
    await page.click('#camara-disparar');
    await page.waitForSelector('#vista-recorte:not([hidden])', { timeout: 20000 });
    await page.click('#recorte-listo');
    await page.waitForFunction(() => document.querySelector('#camara-cuenta').textContent === '1', null, { timeout: 30000 });
    const { paginas } = await leerBase(page);
    assert.equal(paginas[0].filtro, 'pizarra');
    // El filtro de las páginas de siempre no cambió
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('scanlibre_ajustes')).filtro ?? 'mejorada'), 'mejorada');
    await page.click('#camara-listo');
    await page.click('#doc-agregar');
    await page.click('.menu-opcion:has-text("Con la cámara")');
    await page.waitForSelector('#camara-disparar:not([disabled])', { timeout: 20000 });
    assert.equal(await page.textContent('#camara-modo-texto'), 'Pizarra', 'el modo se recuerda');
    assert.deepEqual(page.errores, []);
  });
});
