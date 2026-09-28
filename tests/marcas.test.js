import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enderezarTrazo, renglonBajo, girarMarcas, normalizarFirma, marcaEn, GROSOR } from '../js/marcas.js';
import { paginaDeTexto } from './escenas.js';
import { crearEntorno, importarFoto, leerBase, guardarPNG, descargarPDF } from './ayuda.js';

// En paginaDeTexto el renglón k va de (k + 0,35)/40 a (k + 0,7)/40 del alto,
// y en el renglón 10 las palabras van de 265 a 415 px y de 465 a 615 px (en 800 de ancho)
const centroRenglon = k => (k + 0.525) / 40;

function mapaDe(img) {
  const lum = new Uint8Array(img.width * img.height);
  for (let i = 0; i < lum.length; i++) lum[i] = (img.data[i * 4] * 77 + img.data[i * 4 + 1] * 150 + img.data[i * 4 + 2] * 29) >> 8;
  return { lum, w: img.width, h: img.height };
}

/** Un trazo a mano: de (u0, v) a (u1, v) con un temblor de `a` (fracción del alto) */
function aMano(u0, u1, v, a = 0.002, pasos = 30) {
  const p = [];
  for (let i = 0; i <= pasos; i++) p.push(u0 + (u1 - u0) * i / pasos, v + a * Math.sin(i * 1.3));
  return p;
}

describe('Marcas', () => {
  it('un trazo de resaltador casi derecho queda derecho; uno en curva o en zigzag no se toca', () => {
    const r = enderezarTrazo(aMano(0.2, 0.7, 0.5), GROSOR.resaltador, 800, 1100);
    assert.ok(r && r.recto && r.puntos.length === 4);
    assert.ok(Math.abs(r.puntos[1] - 0.5) < 0.003 && Math.abs(r.puntos[3] - 0.5) < 0.003);
    assert.ok(Math.abs(r.puntos[0] - 0.2) < 0.001 && Math.abs(r.puntos[2] - 0.7) < 0.001);
    const circulo = [];
    for (let i = 0; i <= 40; i++) circulo.push(0.5 + 0.1 * Math.cos(i / 6), 0.5 + 0.07 * Math.sin(i / 6));
    assert.equal(enderezarTrazo(circulo, GROSOR.resaltador, 800, 1100), null);
    assert.equal(enderezarTrazo(aMano(0.2, 0.7, 0.5, 0.03), GROSOR.resaltador, 800, 1100), null, 'zigzag');
    assert.equal(enderezarTrazo([0.5, 0.5, 0.505, 0.5], GROSOR.resaltador, 800, 1100), null, 'muy corto');
  });

  it('encuentra el renglón y las palabras que tapa el trazo', () => {
    const mapa = mapaDe(paginaDeTexto(800, 1100));
    const r = renglonBajo(mapa, 300, 500, centroRenglon(10) * 1100 + 3, GROSOR.resaltador * 800);
    assert.ok(r, 'hay renglón');
    assert.ok(Math.abs(r.y0 - 10.35 / 40 * 1100) < 3 && Math.abs(r.y1 - 10.7 / 40 * 1100) < 3, `alto ${r.y0}–${r.y1}`);
    assert.ok(Math.abs(r.x0 - 265) < 8 && Math.abs(r.x1 - 615) < 8, `palabras ${r.x0}–${r.x1}`);
    // Entre dos párrafos (el renglón 11 está vacío) no hay nada que ajustar
    assert.equal(renglonBajo(mapa, 300, 500, centroRenglon(11) * 1100, GROSOR.resaltador * 800), null);
  });

  it('con la página, el resaltador toma el alto del renglón y va de palabra a palabra', () => {
    const img = paginaDeTexto(800, 1100);
    const r = enderezarTrazo(aMano(0.38, 0.62, centroRenglon(10) + 0.004), GROSOR.resaltador, 800, 1100, mapaDe(img));
    const alto = 0.35 / 40 * 1100;
    assert.ok(Math.abs(r.grosor * 800 - alto * 1.25) < 3, `grosor ${r.grosor * 800} px`);
    assert.ok(Math.abs(r.puntos[1] * 1100 - centroRenglon(10) * 1100) < 2);
    assert.ok(r.puntos[0] * 800 < 265 && r.puntos[0] * 800 > 255, `desde ${r.puntos[0] * 800}`);
    assert.ok(r.puntos[2] * 800 > 615 && r.puntos[2] * 800 < 625, `hasta ${r.puntos[2] * 800}`);
  });

  it('al girar la página las marcas giran con ella, y las notas siguen derechas', () => {
    const marcas = [
      { tipo: 'lapiz', color: '#000', grosor: 0.01, puntos: [0.2, 0.3, 0.4, 0.3] },
      { tipo: 'nota', x: 0.25, y: 0.1, texto: 'hola', tam: 0.03 },
      { tipo: 'firma', x: 0.5, y: 0.9, ancho: 0.3, aspecto: 0.4, color: '#000', grosor: 0.02, trazos: [[0, 0, 1, 1]] }
    ];
    const [t, nota, firma] = girarMarcas(marcas, 1, 800, 1100);
    assert.deepEqual(t.puntos.map(v => +v.toFixed(3)), [0.7, 0.2, 0.7, 0.4]);
    assert.ok(Math.abs(t.grosor - 0.01 * 800 / 1100) < 1e-9, 'el trazo mide lo mismo en px');
    assert.deepEqual([nota.x, nota.y], [0.9, 0.25]);
    assert.ok(Math.abs(nota.tam - 0.03 * 800 / 1100) < 1e-9);
    assert.deepEqual(firma.trazos, marcas[2].trazos, 'la firma no se tuerce');
    assert.ok(Math.abs(firma.x - 0.1) < 1e-9 && firma.y === 0.5);
    // Cuatro cuartos de vuelta: igual que al principio
    const vuelta = girarMarcas(marcas, 4, 800, 1100);
    assert.deepEqual(vuelta[1], marcas[1]);
    assert.ok(vuelta[0].puntos.every((v, i) => Math.abs(v - marcas[0].puntos[i]) < 1e-9));
  });

  it('la firma se guarda recortada y en fracciones de su recuadro', () => {
    const f = normalizarFirma([[100, 50, 200, 80, 300, 60], [150, 90, 160, 95]], 4);
    assert.ok(f.trazos.flat().every(v => v >= 0 && v <= 1));
    assert.ok(Math.abs(f.aspecto - (95 - 50 + 8) / (300 - 100 + 8)) < 1e-9);
    assert.ok(Math.abs(f.grosor - 4 / 208) < 1e-9);
    assert.equal(normalizarFirma([], 4), null);
    assert.equal(normalizarFirma([[10, 10]], 4), null, 'un punto no es firma');
  });

  it('encuentra el trazo que se toca (para borrarlo)', () => {
    const marcas = [
      { tipo: 'lapiz', grosor: 0.005, puntos: [0.1, 0.1, 0.9, 0.1] },
      { tipo: 'resaltador', grosor: 0.02, puntos: [0.1, 0.5, 0.9, 0.5] }
    ];
    assert.equal(marcaEn(null, marcas, 400, 110, 800, 1100, 2), 0);
    assert.equal(marcaEn(null, marcas, 400, 555, 800, 1100, 2), 1);
    assert.equal(marcaEn(null, marcas, 400, 300, 800, 1100, 2), -1);
  });
});

describe('Marcar en la app', () => {
  let env, ruta;
  before(async () => { env = await crearEntorno(); ruta = guardarPNG(paginaDeTexto(800, 1100), 'marcar.png'); });
  after(async () => { await env.cerrar(); });

  /** Abre el editor de la primera página y devuelve cómo pasar de fracciones de la página a la pantalla */
  async function abrirEditor(page) {
    await page.click('#pagina-marcar');
    await page.waitForSelector('#marcar-area[data-listo]');
    const { paginas } = await leerBase(page);
    const W = paginas[0].procAncho, H = paginas[0].procAlto;
    const r = await page.evaluate(() => { const b = document.querySelector('#marcar-area').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    const z = Math.min((r.w - 32) / W, (r.h - 32) / H), ox = r.x + (r.w - W * z) / 2, oy = r.y + (r.h - H * z) / 2;
    return (u, v) => ({ x: ox + u * W * z, y: oy + v * H * z });
  }

  async function trazar(page, P, puntos) {
    const a = P(puntos[0], puntos[1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 2; i < puntos.length; i += 2) { const b = P(puntos[i], puntos[i + 1]); await page.mouse.move(b.x, b.y); }
    await page.mouse.up();
  }

  const marcasDe = async page => (await leerBase(page)).paginas[0].marcas || [];

  it('resaltar, escribir, poner una nota y firmar; se ve en la página, en la miniatura y en el PDF', async () => {
    const page = await env.pagina();
    await importarFoto(page, ruta);
    const miniaturaAntes = (await leerBase(page)).paginas[0].miniatura;
    await page.click('#doc-paginas .miniatura');
    const P = await abrirEditor(page);
    assert.equal(await page.getAttribute('#marcar-resaltador', 'aria-pressed'), 'true', 'empieza con el resaltador');
    await trazar(page, P, aMano(0.38, 0.62, centroRenglon(10) + 0.004));
    assert.equal(await page.isDisabled('#marcar-deshacer'), false);
    // Lápiz rojo
    await page.click('#marcar-lapiz');
    await page.click('#marcar-colores [data-color="rojo"]');
    await trazar(page, P, aMano(0.2, 0.5, 0.6, 0.02, 20));
    // Nota
    await page.click('#marcar-nota');
    await page.fill('dialog textarea', 'Esto viene en el examen');
    await page.click('dialog .boton-primario');
    // Firma: la primera vez se dibuja
    await page.click('#marcar-firma');
    await page.waitForSelector('dialog .firma-pad');
    const pad = await page.locator('dialog .firma-pad').boundingBox();
    await page.mouse.move(pad.x + 40, pad.y + 120);
    await page.mouse.down();
    for (let i = 1; i <= 25; i++) await page.mouse.move(pad.x + 40 + i * 9, pad.y + 120 - 40 * Math.sin(i / 3));
    await page.mouse.up();
    await page.click('dialog .boton-primario');
    await page.click('#marcar-listo');
    await page.waitForSelector('#vista-pagina:not([hidden])');
    await page.waitForSelector('.aviso-exito:has-text("Marcas guardadas")');

    const marcas = await marcasDe(page);
    assert.deepEqual(marcas.map(m => m.tipo), ['resaltador', 'lapiz', 'nota', 'firma']);
    const [resaltador, lapiz, nota, firma] = marcas;
    assert.equal(resaltador.recto, true, 'el resaltador quedó derecho');
    assert.ok(resaltador.grosor < GROSOR.resaltador * 0.8, `y ajustado al renglón: ${resaltador.grosor}`);
    assert.equal(lapiz.color, '#d7261e');
    assert.ok(lapiz.puntos.length > 20);
    assert.equal(nota.texto, 'Esto viene en el examen');
    assert.ok(firma.trazos.length === 1 && firma.y > nota.y, 'la firma va más abajo');
    const guardadas = await page.evaluate(() => JSON.parse(localStorage.getItem('scanlibre_ajustes')).firmas);
    assert.equal(guardadas.length, 1, 'la firma quedó guardada para la próxima');
    await page.waitForFunction(() => document.querySelector('#pagina-imagen').alt.includes('con marcas'));
    const { paginas } = await leerBase(page);
    assert.notEqual(paginas[0].miniatura, miniaturaAntes, 'la miniatura tiene las marcas');
    assert.equal(paginas[0].ocr ?? null, null);

    // En B/N con marcas, el PDF lleva la página a color (JPEG)
    await page.click('[data-filtro="bn"]');
    await page.waitForFunction(() => document.querySelector('[data-filtro="bn"]').getAttribute('aria-pressed') === 'true', null, { timeout: 30000 });
    assert.equal((await marcasDe(page)).length, 4, 'cambiar el filtro no borra las marcas');
    await page.click('#pagina-atras');
    const pdf = await descargarPDF(page);
    assert.match(pdf.texto, /\/Filter \/DCTDecode/);
    assert.doesNotMatch(pdf.texto, /\/BitsPerComponent 1/);
    assert.deepEqual(page.errores, []);
  });

  it('deshacer, borrar, cambiar la nota, girar y salir sin guardar', async () => {
    const page = await env.pagina();
    await importarFoto(page, ruta);
    await page.click('#doc-paginas .miniatura');
    let P = await abrirEditor(page);
    await page.click('#marcar-lapiz');
    await trazar(page, P, aMano(0.2, 0.5, 0.3, 0.02, 20));
    await page.click('#marcar-deshacer');
    assert.equal(await page.isDisabled('#marcar-deshacer'), true);
    await trazar(page, P, aMano(0.2, 0.5, 0.3, 0.02, 20));
    await trazar(page, P, aMano(0.2, 0.5, 0.8, 0.02, 20));
    // El borrador quita el trazo que toca
    await page.click('#marcar-borrador');
    await trazar(page, P, [0.35, 0.28, 0.35, 0.32]);
    await page.click('#marcar-nota');
    await page.fill('dialog textarea', 'primera');
    await page.click('dialog .boton-primario');
    await page.click('#marcar-listo');
    await page.waitForSelector('#vista-pagina:not([hidden])');
    let marcas = await marcasDe(page);
    assert.deepEqual(marcas.map(m => m.tipo), ['lapiz', 'nota'], 'el trazo de arriba se borró');
    assert.ok(marcas[0].puntos[1] > 0.7, 'quedó el de abajo');

    // Tocar la nota (elegida) la deja cambiar; tocarla de nuevo abre el texto
    P = await abrirEditor(page);
    const centro = P(marcas[1].x, marcas[1].y);
    await page.mouse.click(centro.x, centro.y);
    await page.mouse.click(centro.x, centro.y);
    await page.waitForSelector('dialog textarea');
    assert.equal(await page.inputValue('dialog textarea'), 'primera');
    await page.fill('dialog textarea', 'cambiada');
    await page.click('dialog .boton-primario');
    await page.click('#marcar-listo');
    await page.waitForSelector('#vista-pagina:not([hidden])');
    marcas = await marcasDe(page);
    assert.equal(marcas[1].texto, 'cambiada');

    // Al girar la página, las marcas giran con ella
    await page.click('#pagina-girar-der');
    for (let i = 0; i < 60 && (await leerBase(page)).paginas[0].rotacion !== 1; i++) await page.waitForTimeout(500);
    await page.waitForSelector('#pagina-procesando', { state: 'hidden' });
    const giradas = await marcasDe(page);
    assert.ok(Math.abs(giradas[1].x - (1 - marcas[1].y)) < 1e-9 && Math.abs(giradas[1].y - marcas[1].x) < 1e-9);

    // Salir sin guardar pide confirmación y no cambia nada
    P = await abrirEditor(page);
    await page.click('#marcar-resaltador');
    await trazar(page, P, aMano(0.3, 0.6, 0.5));
    await page.click('#marcar-cancelar');
    await page.click('dialog .boton-peligro');
    await page.waitForSelector('#vista-pagina:not([hidden])');
    assert.equal((await marcasDe(page)).length, 2);
    assert.deepEqual(page.errores, []);
  });

  it('con dos dedos se acerca la página y se marca con más detalle', async () => {
    const page = await env.pagina();
    await importarFoto(page, ruta);
    await page.click('#doc-paginas .miniatura');
    const P = await abrirEditor(page);
    await page.click('#marcar-lapiz');
    // Dos dedos que se separan desde el centro: el doble de cerca
    const c = P(0.5, 0.5);
    await page.evaluate(({ x, y }) => {
      const l = document.querySelector('#marcar-lienzo');
      const ev = (tipo, id, dx) => l.dispatchEvent(new PointerEvent(tipo, { pointerId: id, clientX: x + dx, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: id === 11 }));
      ev('pointerdown', 11, -40); ev('pointerdown', 12, 40);
      for (let i = 1; i <= 10; i++) { ev('pointermove', 11, -40 - 4 * i); ev('pointermove', 12, 40 + 4 * i); }
      ev('pointerup', 11, -80); ev('pointerup', 12, 80);
    }, c);
    // El mismo trazo en la pantalla ahora es la mitad de largo en la página
    const a = P(0.3, 0.5), b = P(0.6, 0.5);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + (b.x - a.x) * i / 10, a.y);
    await page.mouse.up();
    await page.click('#marcar-listo');
    await page.waitForSelector('#vista-pagina:not([hidden])');
    const [m] = await marcasDe(page);
    const xs = m.puntos.filter((_, i) => i % 2 === 0);
    const largo = Math.max(...xs) - Math.min(...xs);
    assert.ok(Math.abs(largo - 0.15) < 0.01, `largo ${largo.toFixed(3)} (sin zoom sería 0,3)`);
    assert.deepEqual(page.errores, []);
  });

  it('las marcas viajan en el respaldo', async () => {
    const page = await env.pagina();
    await importarFoto(page, ruta);
    await page.click('#doc-paginas .miniatura');
    const P = await abrirEditor(page);
    await trazar(page, P, aMano(0.38, 0.62, centroRenglon(10) + 0.004));
    await page.click('#marcar-listo');
    await page.waitForSelector('#vista-pagina:not([hidden])');
    await page.click('#pagina-atras');
    await page.click('#doc-atras');
    await page.click('#inicio-menu');
    await page.click('.menu-opcion:nth-child(1)');
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('dialog .boton-secundario')]);
    const zip = await descarga.path();
    assert.equal(readFileSync(zip).readUInt32LE(0), 0x04034b50);
    const otro = await env.pagina();
    await otro.click('#inicio-menu');
    const [selector] = await Promise.all([otro.waitForEvent('filechooser'), otro.click('.menu-opcion:nth-child(2)')]);
    await selector.setFiles(zip);
    await otro.waitForSelector('#inicio-lista li', { timeout: 30000 });
    const marcas = await marcasDe(otro);
    assert.equal(marcas.length, 1);
    assert.equal(marcas[0].tipo, 'resaltador');
  });
});
