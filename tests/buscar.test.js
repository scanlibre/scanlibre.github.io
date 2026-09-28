import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { normalizar, terminos, buscarEn, fragmento } from '../js/buscar.js';
import { crearEntorno, importarFoto, fotoConTexto } from './ayuda.js';

describe('Buscar', () => {
  it('no importan las tildes ni las mayúsculas', () => {
    assert.equal(normalizar('Cálculo AÑO Pingüino').norm, 'calculo ano pinguino');
    assert.deepEqual(terminos('  Límites   y  DERIVADAS '), ['limites', 'y', 'derivadas']);
    assert.ok(buscarEn('Tarea de Cálculo: límites', terminos('calculo')));
  });

  it('con varias palabras tienen que estar todas, en cualquier orden', () => {
    const t = 'El procedimiento de determinación de los tributos';
    assert.ok(buscarEn(t, terminos('tributos determinacion')));
    assert.equal(buscarEn(t, terminos('tributos aduana')), null);
    assert.equal(buscarEn('', terminos('x')), null);
    assert.equal(buscarEn(t, []), null);
  });

  it('dice dónde está en el texto original, aunque tenga tildes antes', () => {
    const t = 'Administración Tributaria o Aduanera';
    const r = buscarEn(t, terminos('tributaria'));
    assert.equal(t.slice(r.inicio, r.fin), 'Tributaria');
  });

  it('el fragmento no corta palabras y marca lo encontrado', () => {
    const t = 'Artículo 122.- Etapas del procedimiento de determinación de oficio.\n1) El procedimiento de determinación de los tributos sujetos a la declaración';
    const r = buscarEn(t, terminos('oficio'));
    const f = fragmento(t, r, 20);
    assert.equal(f.marca, 'oficio');
    assert.match(f.antes, /^….*determinación de $/);
    assert.match(f.despues, /^\. 1\) El procedimiento.*…$/, 'en un solo renglón');
    // Empieza y termina en palabras enteras: justo antes y justo después del corte hay un espacio
    const desde = t.indexOf(f.antes.slice(1)), hasta = t.indexOf(f.despues.slice(0, -1).replace(' 1)', '\n1)')) + f.despues.length - 1;
    assert.match(t[desde - 1], /\s/);
    assert.match(t[hasta], /\s/);
  });
});

// ── En la app ───────────────────────────────────────────────────────

describe('Buscar en todos los documentos', () => {
  let env, hoja1, hoja2;
  before(async () => {
    env = await crearEntorno();
    hoja1 = await fotoConTexto('buscar1.png', ['Tarea de Cálculo: límites y derivadas.', '¿Qué pasa cuando x tiende a cero?']);
    hoja2 = await fotoConTexto('buscar2.png', ['Historia de Honduras', 'La independencia fue en 1821.']);
  });
  after(async () => { await env.cerrar(); });

  const resultados = page => page.$$eval('#inicio-lista .doc', bs => bs.map(b => ({ nombre: b.querySelector('.doc-nombre').textContent, detalle: b.querySelector('.doc-detalle').textContent, marca: b.querySelector('mark')?.textContent })));
  const escribir = async (page, texto) => {
    await page.fill('#inicio-consulta', texto);
    await page.waitForTimeout(400);
  };

  it('ofrece leer las páginas que faltan y después encuentra las palabras, sin importar las tildes', async () => {
    const page = await env.pagina();
    await importarFoto(page, hoja1);
    await page.click('#doc-renombrar');
    await page.fill('dialog .campo', 'Matemática');
    await page.click('dialog .boton-primario');
    await page.click('#doc-atras');
    await importarFoto(page, hoja2);
    await page.click('#doc-atras');
    await page.click('#inicio-buscar');
    await escribir(page, 'independencia');
    assert.deepEqual(await resultados(page), [], 'todavía no se leyó el texto');
    assert.match(await page.textContent('#inicio-sin-leer-texto'), /2 páginas todavía no se han leído/);
    assert.match(await page.textContent('#inicio-sin-resultados'), /Puede estar en las páginas que falta leer/);
    await page.click('#inicio-leer-todo');
    await page.waitForSelector('.aviso-exito:has-text("ya se puede buscar")', { timeout: 120000 });
    await page.waitForSelector('#inicio-sin-leer', { state: 'hidden' });
    let r = await resultados(page);
    assert.equal(r.length, 1);
    assert.equal(r[0].marca, 'independencia');
    assert.match(r[0].detalle, /^Página 1: .*La independencia fue en 1821\./);
    // Sin tildes y con varias palabras
    await escribir(page, 'CALCULO derivadas');
    r = await resultados(page);
    assert.equal(r.length, 1);
    assert.equal(r[0].nombre, 'Matemática');
    assert.equal(r[0].marca, 'Cálculo');
    // También por el nombre del documento
    await escribir(page, 'matematica');
    assert.equal((await resultados(page))[0].marca, 'Matemática');
    await escribir(page, 'química');
    assert.deepEqual(await resultados(page), []);
    assert.match(await page.textContent('#inicio-sin-resultados'), /No se encontró «química»/);
    assert.deepEqual(page.errores, []);
  });

  it('tocar un resultado abre la página donde está, y al volver sigue la búsqueda', async () => {
    const page = await env.pagina();
    await importarFoto(page, hoja1, hoja2);
    await page.click('#doc-atras');
    await page.click('#inicio-buscar');
    await page.click('#inicio-leer-todo');
    await page.waitForSelector('.aviso-exito:has-text("ya se puede buscar")', { timeout: 120000 });
    await escribir(page, '1821');
    assert.match((await resultados(page))[0].detalle, /^Página 2:/);
    await page.click('#inicio-lista .doc');
    await page.waitForSelector('#vista-pagina:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#pagina-titulo').textContent === 'Página 2 de 2');
    await page.goBack();
    await page.waitForSelector('#vista-inicio:not([hidden])');
    assert.equal(await page.inputValue('#inicio-consulta'), '1821');
    await page.waitForFunction(() => document.querySelectorAll('#inicio-lista .doc').length === 1);
    // Cancelar vuelve a la lista de siempre
    await page.click('#inicio-cerrar-busqueda');
    await page.waitForSelector('#inicio-carpetas:not([hidden])');
    assert.equal(await page.isVisible('#inicio-busqueda'), false);
  });
});
