import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno, importarFoto, fotoDePrueba } from './ayuda.js';

describe('Acercar la página (zoom)', () => {
  let env, foto1, foto2;
  before(async () => {
    env = await crearEntorno();
    foto1 = fotoDePrueba(1, 'zoom1.png').ruta;
    foto2 = fotoDePrueba(2, 'zoom2.png').ruta;
  });
  after(async () => { await env.cerrar(); });

  // Abre el documento con dos páginas y entra a la primera
  async function enLaPagina(page) {
    await importarFoto(page, foto1, foto2);
    await page.click('#doc-paginas li:nth-child(1) .miniatura');
    await page.waitForSelector('#vista-pagina:not([hidden])');
    await page.waitForFunction(() => { const i = document.querySelector('#pagina-imagen'); return i && !i.hidden && i.naturalWidth > 0; }, null, { timeout: 30000 });
  }
  const escala = page => page.evaluate(() => {
    const t = getComputedStyle(document.querySelector('#pagina-imagen')).transform;
    if (!t || t === 'none') return 1;
    return new DOMMatrixReadOnly(t).a; // el factor de escala en x
  });
  // Lanza un gesto de pellizco (dos dedos separándose) sobre la hoja
  const pellizcar = (page, desde, hasta) => page.evaluate(({ desde, hasta }) => {
    const hoja = document.querySelector('.pagina-hoja'), r = hoja.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ev = (t, id, dx) => hoja.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: cx + dx, clientY: cy, bubbles: true, cancelable: true, pointerType: 'touch' }));
    ev('pointerdown', 1, -desde); ev('pointerdown', 2, desde);
    for (let k = 1; k <= 6; k++) { const d = desde + (hasta - desde) * k / 6; ev('pointermove', 1, -d); ev('pointermove', 2, d); }
    ev('pointerup', 1, -hasta); ev('pointerup', 2, hasta);
  }, { desde, hasta });
  // Un doble toque en el centro de la hoja
  const dobleToque = page => page.evaluate(() => {
    const hoja = document.querySelector('.pagina-hoja'), r = hoja.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const toque = id => { for (const t of ['pointerdown', 'pointerup']) hoja.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerType: 'touch' })); };
    toque(1); toque(2);
  });

  it('pellizcar con dos dedos acerca la página', async () => {
    const page = await env.pagina();
    await enLaPagina(page);
    assert.equal(await escala(page), 1, 'empieza sin acercar');
    await pellizcar(page, 40, 160);
    const s = await escala(page);
    assert.ok(s > 1.5, `debería acercar: escala ${s}`);
    assert.equal(await page.evaluate(() => document.querySelector('.pagina-hoja').classList.contains('acercada')), true);
    assert.deepEqual(page.errores, []);
  });

  it('doble toque acerca y, otra vez, vuelve al tamaño normal', async () => {
    const page = await env.pagina();
    await enLaPagina(page);
    await dobleToque(page);
    assert.ok(await escala(page) > 1.5, 'el primer doble toque acerca');
    await dobleToque(page);
    assert.equal(await escala(page), 1, 'el segundo vuelve a 1×');
  });

  it('al cambiar de página el zoom se reinicia', async () => {
    const page = await env.pagina();
    await enLaPagina(page);
    await pellizcar(page, 40, 160);
    assert.ok(await escala(page) > 1.5);
    await page.click('#pagina-siguiente');
    await page.waitForFunction(() => /Página 2/.test(document.querySelector('#pagina-titulo')?.textContent || ''));
    assert.equal(await escala(page), 1, 'la página nueva no queda acercada');
  });

  it('acercada, arrastrar con un dedo mueve la imagen; sin acercar no la mueve', async () => {
    const page = await env.pagina();
    await enLaPagina(page);
    const arrastrar = () => page.evaluate(() => {
      const hoja = document.querySelector('.pagina-hoja'), r = hoja.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const ev = (t, x) => hoja.dispatchEvent(new PointerEvent(t, { pointerId: 9, clientX: x, clientY: cy, bubbles: true, cancelable: true, pointerType: 'touch' }));
      ev('pointerdown', cx); for (let k = 1; k <= 5; k++) ev('pointermove', cx - k * 12); ev('pointerup', cx - 60);
    });
    await arrastrar();
    assert.equal(await page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#pagina-imagen')).transform === 'none' ? '' : getComputedStyle(document.querySelector('#pagina-imagen')).transform).e), 0, 'sin acercar no se mueve');
    await pellizcar(page, 40, 200);
    await arrastrar();
    const movidoX = await page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#pagina-imagen')).transform).e);
    assert.ok(movidoX < -5, `debería haberse corrido a la izquierda: ${movidoX}`);
  });
});
