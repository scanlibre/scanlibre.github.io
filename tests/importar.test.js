import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { renglonesDeTexto } from '../js/importar.js';
import { crearPDFConContrasena } from '../js/pdf.js';
import { JPEG_COLOR_16x8 } from './jpegs.js';
import { crearEntorno, carpeta, fotoDePrueba, importarFoto, leerBase } from './ayuda.js';

describe('Importar PDF: el texto', () => {
  it('arma los renglones y las palabras con su lugar', () => {
    const { texto, lineas } = renglonesDeTexto([
      { str: 'mundo', x: 160, y: 100, h: 20, w: 60 },
      { str: 'Hola ', x: 100, y: 101, h: 20, w: 55 },
      { str: 'Segundo renglón', x: 100, y: 125, h: 20, w: 180 },
      { str: 'Otro párrafo', x: 100, y: 200, h: 20, w: 140 },
      { str: '   ', x: 0, y: 0, h: 20, w: 10 }
    ]);
    assert.equal(texto, 'Hola mundo\nSegundo renglón\n\nOtro párrafo');
    assert.equal(lineas.length, 3);
    assert.deepEqual(lineas[0].palabras.map(p => p.t), ['Hola', 'mundo']);
    const hola = lineas[0].palabras[0];
    assert.ok(hola.x0 === 100 && hola.x1 === 144 && hola.y0 < 101 && hola.y1 > 101, JSON.stringify(hola));
  });

  it('una palabra cortada en dos pedazos queda entera', () => {
    const { texto, lineas } = renglonesDeTexto([
      { str: 'Mate', x: 100, y: 50, h: 12, w: 28 },
      { str: 'mática básica', x: 128, y: 50, h: 12, w: 78 }
    ]);
    assert.equal(texto, 'Matemática básica');
    assert.equal(lineas[0].palabras[0].t, 'Matemática');
  });
});

describe('Importar PDF en la app', () => {
  let env, conTexto, conClave;
  before(async () => {
    env = await crearEntorno();
    // Un PDF con texto de verdad, de dos páginas (como el de una tarea hecha en Word)
    const nav = await chromium.launch();
    const p = await nav.newPage();
    await p.setContent(`<body style="font:22px Arial;margin:60px">
      <h1>Tarea de Matemática</h1><p>Resolver los ejercicios del capítulo tres.</p>
      <div style="page-break-before:always"></div><h2>Segunda página</h2><p>Entregar el viernes.</p></body>`);
    conTexto = join(carpeta, 'Tarea_de_mate.pdf');
    writeFileSync(conTexto, await p.pdf({ format: 'Letter' }));
    await nav.close();
    // Uno con contraseña hecho por la propia app (así también se prueba que el cifrado lo abre otro lector)
    const texto = { ancho: 16, alto: 8, lineas: [{ y0: 1, y1: 7, base: [1, 6, 15, 6], palabras: [{ t: 'Secreto', x0: 1, y0: 1, x1: 15, y1: 7 }] }] };
    conClave = join(carpeta, 'secreto.pdf');
    writeFileSync(conClave, Buffer.from(await crearPDFConContrasena([{ tipo: 'jpeg', bytes: JPEG_COLOR_16x8, texto }], { tamano: 'foto', titulo: 'Secreto' }, 'clave123')));
  });
  after(async () => { await env.cerrar(); });

  async function importar(page, ...rutas) {
    const [selector] = await Promise.all([page.waitForEvent('filechooser'), page.click('#inicio-importar')]);
    await selector.setFiles(rutas);
  }

  it('cada página del PDF queda como una página, con su texto (sin leerlo con el OCR)', async () => {
    const page = await env.pagina();
    await importar(page, conTexto);
    await page.waitForFunction(() => document.querySelectorAll('#doc-paginas .miniatura img').length === 2, null, { timeout: 60000 });
    assert.equal(await page.textContent('#doc-nombre'), 'Tarea de mate', 'el documento se llama como el archivo');
    const { documentos, paginas } = await leerBase(page);
    const enOrden = documentos[0].paginas.map(id => paginas.find(p => p.id === id));
    assert.ok(enOrden.every(p => p.modo === 'pdf' && p.filtro === 'original' && p.aplanar === false));
    assert.equal(enOrden[0].ocr.idioma, 'pdf');
    assert.match(enOrden[0].ocr.texto, /Tarea de Matemática\nResolver los ejercicios del capítulo tres\./);
    assert.match(enOrden[1].ocr.texto, /Segunda página/);
    const palabra = enOrden[0].ocr.lineas[0].palabras[0];
    assert.equal(palabra.t, 'Tarea');
    assert.ok(palabra.x0 > 0 && palabra.x1 > palabra.x0 && palabra.x1 < enOrden[0].procAncho / 2, JSON.stringify(palabra));
    // La hoja carta se ve como carta
    assert.ok(Math.abs(enOrden[0].procAncho / enOrden[0].procAlto - 8.5 / 11) < 0.01);
    // El texto está al tiro, sin preparar el lector
    await page.click('#doc-paginas li:nth-child(1) .miniatura');
    await page.click('#pagina-texto');
    await page.waitForFunction(() => /Tarea de Matemática/.test(document.querySelector('dialog textarea')?.value || ''), null, { timeout: 5000 });
    await page.keyboard.press('Escape');
    // Cambiar el filtro no hace perder el texto del PDF
    await page.click('[data-filtro="gris"]');
    await page.waitForFunction(() => document.querySelector('[data-filtro="gris"]').getAttribute('aria-pressed') === 'true', null, { timeout: 30000 });
    await page.waitForSelector('#pagina-procesando', { state: 'hidden' });
    const p1 = (await leerBase(page)).paginas.find(p => p.id === enOrden[0].id);
    assert.equal(p1.ocr?.idioma, 'pdf');
    // Y se encuentra buscando desde el inicio
    await page.click('#pagina-atras');
    await page.click('#doc-atras');
    await page.click('#inicio-buscar');
    await page.fill('#inicio-consulta', 'viernes');
    await page.waitForSelector('#inicio-lista mark', { timeout: 10000 });
    assert.deepEqual(page.errores, []);
  });

  it('un PDF con contraseña la pide (y avisa si está mal)', async () => {
    const page = await env.pagina();
    await importar(page, conClave);
    await page.waitForSelector('dialog input[type="password"]', { timeout: 30000 });
    assert.equal(await page.textContent('dialog .hoja-titulo'), 'Este PDF tiene contraseña');
    await page.fill('dialog input', 'otra');
    await page.click('dialog .boton-primario');
    await page.waitForFunction(() => document.querySelector('dialog .hoja-titulo')?.textContent === 'Contraseña incorrecta', null, { timeout: 30000 });
    await page.fill('dialog input', 'clave123');
    await page.click('dialog .boton-primario');
    await page.waitForFunction(() => document.querySelectorAll('#doc-paginas .miniatura img').length === 1, null, { timeout: 60000 });
    const [p] = (await leerBase(page)).paginas;
    assert.equal(p.ocr?.texto, 'Secreto', 'hasta el texto invisible del PDF cifrado se lee');
    assert.deepEqual(page.errores, []);
  });

  it('se pueden mezclar fotos y un PDF en el mismo documento', async () => {
    const page = await env.pagina();
    await importar(page, fotoDePrueba(1).ruta, conTexto);
    await page.waitForFunction(() => document.querySelectorAll('#doc-paginas .miniatura img').length === 3, null, { timeout: 60000 });
    const { documentos, paginas } = await leerBase(page);
    const modos = documentos[0].paginas.map(id => paginas.find(p => p.id === id).modo || 'foto');
    assert.deepEqual(modos, ['foto', 'pdf', 'pdf']);
  });
});

describe('Unir y dividir documentos', () => {
  let env;
  const fotos = [fotoDePrueba(1), fotoDePrueba(2), fotoDePrueba(3)].map(f => f.ruta);
  before(async () => { env = await crearEntorno(); });
  after(async () => { await env.cerrar(); });

  it('unir: las páginas del otro pasan al final y el otro se borra', async () => {
    const page = await env.pagina();
    await importarFoto(page, fotos[0], fotos[1]);
    await page.click('#doc-renombrar');
    await page.fill('dialog .campo', 'Parte uno');
    await page.click('dialog .boton-primario');
    await page.click('#doc-atras');
    await importarFoto(page, fotos[2]);
    await page.click('#doc-renombrar');
    await page.fill('dialog .campo', 'Parte dos');
    await page.click('dialog .boton-primario');
    const antes = await leerBase(page);
    const uno = antes.documentos.find(d => d.nombre === 'Parte uno'), dos = antes.documentos.find(d => d.nombre === 'Parte dos');
    await page.click('#doc-menu');
    await page.click('.menu-opcion:has-text("Unir con otro documento")');
    await page.click('.menu-opcion:has-text("Parte uno")');
    await page.click('dialog .boton-primario');
    await page.waitForSelector('.aviso-exito:has-text("Ahora son 3 páginas")');
    const { documentos } = await leerBase(page);
    assert.equal(documentos.length, 1);
    assert.deepEqual(documentos[0].paginas, [...dos.paginas, ...uno.paginas]);
    assert.equal(await page.locator('#doc-paginas li[data-id]').count(), 3);
    assert.deepEqual(page.errores, []);
  });

  it('dividir: de esta página en adelante, un documento nuevo', async () => {
    const page = await env.pagina();
    await importarFoto(page, ...fotos);
    const nombre = await page.textContent('#doc-nombre');
    const [p1, p2, p3] = (await leerBase(page)).documentos[0].paginas;
    await page.click('#doc-paginas li:nth-child(2) .miniatura');
    await page.click('#pagina-mas');
    await page.click('.menu-opcion:has-text("Dividir aquí")');
    assert.equal(await page.inputValue('dialog .campo'), `${nombre} (2–3)`);
    await page.click('dialog .boton-primario');
    await page.waitForSelector('#vista-documento:not([hidden])');
    await page.waitForFunction(n => document.querySelector('#doc-nombre').textContent === n, `${nombre} (2–3)`);
    const { documentos } = await leerBase(page);
    assert.deepEqual(documentos.find(d => d.nombre === nombre).paginas, [p1]);
    assert.deepEqual(documentos.find(d => d.nombre === `${nombre} (2–3)`).paginas, [p2, p3]);
    assert.deepEqual(page.errores, []);
  });
});
