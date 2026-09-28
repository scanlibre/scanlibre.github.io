import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textoResaltado, RESALTADORES } from '../js/marcas.js';
import { crearEntorno, importarFoto, leerBase, fotoConTexto } from './ayuda.js';

// Tres renglones leídos, en una página de 1000 × 700
const ocr = {
  ancho: 1000, alto: 700,
  lineas: [
    { y0: 100, y1: 140, palabras: [{ t: 'La', x0: 60, y0: 100, x1: 110, y1: 140 }, { t: 'célula', x0: 130, y0: 100, x1: 260, y1: 140 }, { t: 'es', x0: 280, y0: 100, x1: 320, y1: 140 }] },
    { y0: 200, y1: 240, palabras: [{ t: 'la', x0: 60, y0: 200, x1: 100, y1: 240 }, { t: 'unidad', x0: 120, y0: 200, x1: 250, y1: 240 }, { t: 'bási-', x0: 270, y0: 200, x1: 370, y1: 240 }] },
    { y0: 300, y1: 340, palabras: [{ t: 'ca', x0: 60, y0: 300, x1: 110, y1: 340 }, { t: 'de', x0: 130, y0: 300, x1: 170, y1: 340 }, { t: 'la', x0: 190, y0: 300, x1: 230, y1: 340 }, { t: 'vida.', x0: 250, y0: 300, x1: 350, y1: 340 }] }
  ]
};
const trazo = (x0, x1, y, color = RESALTADORES.amarillo) => ({ tipo: 'resaltador', color, grosor: 50 / 1000, puntos: [x0 / 1000, y / 700, x1 / 1000, y / 700], recto: true });

describe('Lo resaltado', () => {
  it('toma las palabras que quedan bajo el trazo, en orden, y junta la frase que sigue en el renglón de abajo', () => {
    const r = textoResaltado([trazo(120, 380, 220), trazo(50, 360, 320), trazo(120, 270, 120, RESALTADORES.verde)], ocr, 1000, 700);
    assert.deepEqual(r, [
      { color: 'verde', texto: 'célula' },
      { color: 'amarillo', texto: 'unidad básica de la vida.' }
    ]);
  });

  it('sin resaltador o sin texto leído no hay nada', () => {
    assert.deepEqual(textoResaltado([{ tipo: 'lapiz', color: '#000', grosor: 0.01, puntos: [0, 0, 1, 1] }], ocr, 1000, 700), []);
    assert.deepEqual(textoResaltado([trazo(120, 380, 220)], null, 1000, 700), []);
    assert.deepEqual(textoResaltado([trazo(500, 900, 600)], ocr, 1000, 700), [], 'donde no hay letras');
  });
});

describe('Lo resaltado en la app', () => {
  let env, hoja;
  before(async () => {
    env = await crearEntorno();
    hoja = await fotoConTexto('resaltar.png', ['El núcleo guarda el ADN.', 'La mitocondria produce energía.', 'La membrana protege la célula.']);
  });
  after(async () => { await env.cerrar(); });

  it('junta lo resaltado del documento; se copia, se escucha y va a Word resaltado', async () => {
    const page = await env.pagina();
    await importarFoto(page, hoja);
    await page.click('#doc-menu');
    await page.click('.menu-opcion:has-text("Lo resaltado")');
    await page.waitForSelector('.aviso:has-text("Todavía no hay nada resaltado")');
    // Se lee la página para saber dónde está el renglón del medio
    await page.click('#doc-paginas .miniatura');
    await page.click('#pagina-texto');
    await page.waitForFunction(() => /mitocondria/.test(document.querySelector('.texto-leido')?.value || ''), null, { timeout: 90000 });
    await page.keyboard.press('Escape');
    const [p] = (await leerBase(page)).paginas;
    const l = p.ocr.lineas.find(l => l.palabras.some(w => /mitocondria/.test(w.t)));
    // Resaltarlo en el editor
    await page.click('#pagina-marcar');
    await page.waitForSelector('#marcar-area[data-listo]');
    const r = await page.evaluate(() => { const b = document.querySelector('#marcar-area').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    const W = p.procAncho, H = p.procAlto, z = Math.min((r.w - 32) / W, (r.h - 32) / H), ox = r.x + (r.w - W * z) / 2, oy = r.y + (r.h - H * z) / 2;
    const k = W / p.ocr.ancho, y = oy + (l.y0 + l.y1) / 2 * k * z;
    const x0 = ox + l.palabras[0].x0 * k * z, x1 = ox + l.palabras[l.palabras.length - 1].x1 * k * z;
    await page.mouse.move(x0, y); await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(x0 + (x1 - x0) * i / 12, y + Math.sin(i) * 2);
    await page.mouse.up();
    await page.click('#marcar-listo');
    await page.waitForSelector('#vista-pagina:not([hidden])');
    await page.click('#pagina-atras');
    await page.click('#doc-menu');
    await page.click('.menu-opcion:has-text("Lo resaltado")');
    await page.waitForFunction(() => document.querySelector('.texto-leido') && !document.querySelector('.texto-leido').hidden, null, { timeout: 30000 });
    const texto = await page.inputValue('.texto-leido');
    assert.match(texto, /^— Página 1 —\n• La mitocondria produce energía\.$/);
    assert.doesNotMatch(texto, /núcleo|membrana/);
    assert.match(await page.textContent('dialog .hoja-detalle'), /1 partes? resaltada/);
    // Word: la frase resaltada en amarillo
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('dialog button:has-text("Word")').then(() => page.click('.menu-opcion:has-text("Descargar")').catch(() => {}))]);
    const zip = readFileSync(await descarga.path());
    // El .docx va sin comprimir: el XML se lee directo
    const xml = zip.toString('utf8');
    assert.match(xml, /<w:highlight w:val="yellow"\/>[^]*mitocondria produce energía/);
    assert.match(descarga.suggestedFilename(), /lo resaltado\.docx$/);
    assert.deepEqual(page.errores.filter(e => !/too small to scale|cannot be recognized|Empty page/i.test(e)), []);
  });
});
