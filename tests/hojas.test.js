import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearEntorno, fotoDePrueba, importarFoto, guardarPNG } from './ayuda.js';

/** Crea el PDF con las opciones que se toquen y devuelve sus bytes (latin1) y lo que dice el resultado */
async function crear(page, tocar) {
  await page.click('#doc-pdf');
  for (const t of tocar) await page.click(t);
  await page.click('dialog .hoja-botones .boton-primario');
  await page.waitForSelector('.resultado-pdf', { timeout: 120000 });
  const detalle = await page.textContent('.resultado-pdf small');
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('dialog .hoja-botones .boton-secundario')]);
  const bytes = readFileSync(await descarga.path());
  await page.keyboard.press('Escape');
  return { texto: bytes.toString('latin1'), tamano: bytes.length, detalle };
}

/** Una "foto" que pesa mucho en JPEG: puro ruido de colores */
function ruido(w, h, semilla) {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = semilla;
  for (let i = 0; i < data.length; i += 4) {
    s = (s * 1103515245 + 12345) >>> 0; data[i] = s >>> 24;
    s = (s * 1103515245 + 12345) >>> 0; data[i + 1] = s >>> 24;
    s = (s * 1103515245 + 12345) >>> 0; data[i + 2] = s >>> 24; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe('Crear PDF: páginas por hoja y tamaño máximo', () => {
  let env;
  before(async () => { env = await crearEntorno(); });
  after(async () => { await env.cerrar(); });

  it('dos páginas por hoja: la mitad de hojas, y se recuerda', async () => {
    const page = await env.pagina();
    await importarFoto(page, ...[1, 2, 3, 4].map(k => fotoDePrueba(k).ruta));
    const pdf = await crear(page, ['dialog .opcion[data-valor="2"]']);
    assert.equal((pdf.texto.match(/\/Type \/Page /g) || []).length, 2, '4 páginas en 2 hojas');
    assert.match(pdf.texto, /\/MediaBox \[0 0 792 612\]/, 'hoja carta acostada');
    assert.equal((pdf.texto.match(/\/Subtype \/Image/g) || []).length, 4);
    assert.match(pdf.detalle, /2 por hoja/);
    await page.click('#doc-pdf');
    assert.equal(await page.getAttribute('dialog .opcion[data-valor="2"]', 'aria-pressed'), 'true', 'la próxima vez ya está elegido');
    await page.keyboard.press('Escape');
    assert.deepEqual(page.errores, []);
  });

  it('"Que pese menos de 1 MB" baja la calidad hasta que cabe', async () => {
    const page = await env.pagina();
    await importarFoto(page, guardarPNG(ruido(1500, 2000, 7), 'ruido1.png'), guardarPNG(ruido(1500, 2000, 9), 'ruido2.png'));
    const normal = await crear(page, ['dialog .opcion[data-valor="normal"]']);
    assert.ok(normal.tamano > 1e6, `en Normal pesa más de 1 MB: ${normal.tamano}`);
    await page.click('#doc-pdf');
    assert.equal(await page.isVisible('dialog .megas'), false, 'los megas solo con "Que pese menos de…"');
    await page.click('dialog .opcion[data-valor="limite"]');
    assert.equal(await page.isVisible('dialog .megas'), true);
    await page.click('dialog .megas [data-mb="1"]');
    await page.click('dialog .hoja-botones .boton-primario');
    await page.waitForSelector('.resultado-pdf', { timeout: 120000 });
    const detalle = await page.textContent('.resultado-pdf small');
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('dialog .hoja-botones .boton-secundario')]);
    const bytes = readFileSync(await descarga.path());
    assert.ok(bytes.length <= 1e6, `pesa ${bytes.length}`);
    assert.ok(bytes.length > 0.3e6, `y no se pasó de liviano: ${bytes.length}`);
    assert.match(detalle, /menos de 1 MB/);
    assert.equal((bytes.toString('latin1').match(/\/Type \/Page /g) || []).length, 2);
    assert.deepEqual(page.errores, []);
  });
});
