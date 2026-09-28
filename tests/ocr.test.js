import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno, importarFoto, leerBase, descargarPDF, fotoConTexto } from './ayuda.js';

const esperarTexto = page => page.waitForFunction(() => {
  const a = document.querySelector('.texto-leido');
  return a && !a.hidden && a.value.length > 0;
}, null, { timeout: 90000 });

describe('Lector de texto (OCR)', () => {
  let env, hoja1, hoja2;
  before(async () => {
    env = await crearEntorno();
    hoja1 = await fotoConTexto('texto1.png', ['Tarea de Cálculo: límites y derivadas.', '¿Qué pasa cuando x tiende a cero?']);
    hoja2 = await fotoConTexto('texto2.png', ['Historia de Honduras', 'La independencia fue en 1821.']);
  });
  after(async () => { await env.cerrar(); });

  it('lee el texto de una página en español, se puede copiar y queda guardado', async () => {
    const page = await env.pagina();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: env.url.replace(/\/$/, '') });
    await importarFoto(page, hoja1);
    await page.click('#doc-paginas .miniatura');
    await page.click('#pagina-texto');
    await esperarTexto(page);
    const texto = await page.inputValue('.texto-leido');
    assert.match(texto, /Tarea de Cálculo: límites y derivadas\./);
    assert.match(texto, /¿Qué pasa cuando x tiende a cero\?/);
    await page.click('dialog .boton-primario'); // Copiar
    await page.waitForSelector('.aviso-exito');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), texto);
    const { paginas } = await leerBase(page);
    assert.equal(paginas[0].ocr.idioma, 'spa');
    assert.ok(paginas[0].ocr.lineas.length >= 2);
    assert.ok(paginas[0].ocr.lineas[0].palabras.some(p => p.t === 'Cálculo:'));
    assert.deepEqual(page.errores, []);

    // La segunda vez no se vuelve a leer: el texto sale al instante
    await page.keyboard.press('Escape');
    const t0 = Date.now();
    await page.click('#pagina-texto');
    await esperarTexto(page);
    assert.ok(Date.now() - t0 < 1500, `tardó ${Date.now() - t0} ms`);
  });

  it('si la página cambia (otro filtro), el texto leído se borra', async () => {
    const page = await env.pagina();
    await importarFoto(page, hoja1);
    await page.click('#doc-paginas .miniatura');
    await page.click('#pagina-texto');
    await esperarTexto(page);
    await page.keyboard.press('Escape');
    await page.click('[data-filtro="gris"]');
    await page.waitForFunction(() => document.querySelector('[data-filtro="gris"]').getAttribute('aria-pressed') === 'true', null, { timeout: 30000 });
    const { paginas } = await leerBase(page);
    assert.equal(paginas[0].ocr, null);
  });

  it('copia el texto de todo el documento, página por página', async () => {
    const page = await env.pagina();
    await importarFoto(page, hoja1, hoja2);
    await page.click('#doc-menu');
    await page.click('.menu-opcion:nth-child(1)');
    await esperarTexto(page);
    const texto = await page.inputValue('.texto-leido');
    assert.match(texto, /— Página 1 —\nTarea de Cálculo/);
    assert.match(texto, /— Página 2 —\nHistoria de Honduras/);
    assert.match(texto, /1821/);
  });

  it('el PDF con "Texto buscable" lleva el texto invisible sobre la imagen', async () => {
    const page = await env.pagina();
    await importarFoto(page, hoja2);
    await page.click('#doc-pdf');
    await page.click('dialog .opcion:has-text("Texto buscable")');
    await page.click('dialog .hoja-botones .boton-primario');
    await page.waitForSelector('.resultado-pdf', { timeout: 90000 });
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('dialog .hoja-botones .boton-secundario')]);
    const { readFileSync } = await import('node:fs');
    const pdf = readFileSync(await descarga.path()).toString('latin1');
    assert.match(pdf, /BT 3 Tr/);
    assert.match(pdf, /\(Historia \) Tj/);
    assert.match(pdf, /\(1821\.\) Tj/);
    // La opción queda elegida para la próxima vez
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('scanlibre_ajustes')).pdfTexto), true);
  });

  it('el texto se lleva a Word (.docx)', async () => {
    const page = await env.pagina();
    await importarFoto(page, hoja2);
    await page.click('#doc-paginas .miniatura');
    await page.click('#pagina-texto');
    await esperarTexto(page);
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('dialog .boton:has-text("Word")')]);
    assert.match(descarga.suggestedFilename(), /– página 1\.docx$/);
    const { leerZip } = await import('../js/respaldo.js');
    const { readFileSync } = await import('node:fs');
    const zip = await leerZip(new Blob([readFileSync(await descarga.path())]));
    const xml = await zip.get('word/document.xml').text();
    assert.match(xml, /Historia de Honduras/);
    assert.match(xml, /La independencia fue en 1821\./);
  });

  it('el texto se escucha en voz alta, con pausa, y se calla al cerrar', async () => {
    // Voz simulada: el navegador de las pruebas no habla
    const page = await env.pagina({ antes: () => {
      window.dichas = []; window.calladas = 0;
      const voz = { speak(u) { window.dichas.push({ texto: u.text, lang: u.lang }); setTimeout(() => u.onend?.(), 80); }, cancel() { window.calladas++; }, getVoices: () => [], pause() {}, resume() {} };
      Object.defineProperty(window, 'speechSynthesis', { value: voz, configurable: true });
    } });
    await importarFoto(page, hoja1, hoja2);
    await page.click('#doc-menu');
    await page.click('.menu-opcion:nth-child(1)');
    await esperarTexto(page);
    const escuchar = page.locator('dialog .boton:has-text("Escuchar")');
    await escuchar.click();
    await page.waitForFunction(() => window.dichas.length >= 1);
    assert.equal(await page.textContent('dialog .boton[aria-pressed="true"]'), 'Pausa');
    await page.click('dialog .boton:has-text("Pausa")');
    await page.waitForSelector('dialog .boton:has-text("Seguir")');
    await page.click('dialog .boton:has-text("Seguir")');
    await page.waitForSelector('dialog .hoja-detalle:has-text("se leyó todo el texto")', { timeout: 20000 });
    const dichas = await page.evaluate(() => window.dichas);
    const todo = dichas.map(d => d.texto).join(' ');
    assert.match(todo, /Tarea de Cálculo/);
    assert.match(todo, /1821/);
    assert.ok(dichas.every(d => d.lang.startsWith('es')), 'en español');
    const antes = await page.evaluate(() => window.calladas);
    await page.keyboard.press('Escape');
    await page.waitForFunction(n => window.calladas > n, antes);
  });

  it('mientras se escucha, se resalta la frase y la palabra; tocar una frase lee desde ahí; con velocidad', async () => {
    // Voz simulada que avisa cada palabra (como Chrome) y termina cuando se le dice
    const page = await env.pagina({ antes: () => {
      window.dichas = []; window.actual = null;
      const voz = {
        speak(u) { window.dichas.push({ texto: u.text, rate: u.rate }); window.actual = u; },
        cancel() { window.actual = null; }, getVoices: () => [], pause() {}, resume() {}
      };
      window.decirPalabra = n => { const u = window.actual; const m = [...u.text.matchAll(/\S+/g)][n]; u.onboundary?.({ name: 'word', charIndex: m.index, charLength: m[0].length }); };
      window.terminarFrase = () => { const u = window.actual; window.actual = null; u?.onend?.(); };
      Object.defineProperty(window, 'speechSynthesis', { value: voz, configurable: true });
    } });
    await importarFoto(page, hoja2);
    await page.click('#doc-paginas .miniatura');
    await page.click('#pagina-texto');
    await esperarTexto(page);
    await page.click('dialog .boton:has-text("Escuchar")');
    await page.waitForSelector('dialog .texto-escucha:not([hidden])');
    assert.equal(await page.isVisible('dialog .texto-leido'), false, 'mientras se escucha se ve el texto con lo que se dice');
    assert.match(await page.textContent('dialog .frase.actual'), /Historia de Honduras/);
    // La segunda palabra de la frase queda marcada
    await page.evaluate(() => window.decirPalabra(1));
    assert.equal(await page.textContent('dialog .frase.actual mark'), 'de');
    // Tocar la otra frase la lee desde ahí
    await page.click('dialog .frase:has-text("1821")');
    await page.waitForFunction(() => /1821/.test(window.actual?.text || ''));
    assert.match(await page.textContent('dialog .frase.actual'), /independencia/);
    // Más rápido: la frase vuelve a empezar a 1,5
    await page.click('dialog .velocidades [data-velocidad="1.5"]');
    await page.waitForFunction(() => window.actual?.rate === 1.5);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('scanlibre_ajustes')).vozVelocidad), 1.5);
    // Al terminar vuelve el texto para editar
    await page.evaluate(() => window.terminarFrase());
    await page.waitForSelector('dialog .texto-leido:not([hidden])');
    assert.equal(await page.isVisible('dialog .texto-escucha'), false);
    // Y Detener también lo devuelve
    await page.click('dialog .boton:has-text("Escuchar")');
    await page.waitForSelector('dialog .texto-escucha:not([hidden])');
    await page.click('dialog .boton:has-text("Detener")');
    await page.waitForSelector('dialog .texto-leido:not([hidden])');
    assert.deepEqual(page.errores, []);
  });

  it('el texto leído viaja en el respaldo', async () => {
    const page = await env.pagina();
    await importarFoto(page, hoja2);
    await page.click('#doc-paginas .miniatura');
    await page.click('#pagina-texto');
    await esperarTexto(page);
    await page.keyboard.press('Escape');
    await page.click('#pagina-atras');
    await page.click('#doc-atras');
    await page.click('#inicio-menu');
    await page.click('.menu-opcion:nth-child(1)');
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('dialog .boton-secundario')]);
    const otro = await env.pagina();
    await otro.click('#inicio-menu');
    const [selector] = await Promise.all([otro.waitForEvent('filechooser'), otro.click('.menu-opcion:nth-child(2)')]);
    await selector.setFiles(await descarga.path());
    await otro.waitForSelector('#inicio-lista li', { timeout: 30000 });
    const { paginas } = await leerBase(otro);
    assert.match(paginas[0].ocr.texto, /Historia de Honduras/);
  });
});
