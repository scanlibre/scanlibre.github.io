import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nuevoCodigo, leerCodigo, llavesDe, cifrar, descifrar, cerrarJSON, abrirJSON, nombreEnLaNube } from '../js/llaves.js';
import { crearEntorno, fotoDePrueba, importarFoto, leerBase, guardarPNG } from './ayuda.js';
import { nubeFalsa } from './nube-falsa.js';

describe('Respaldo en la nube: el código y el cifrado', () => {
  it('el código tiene 6 grupos de 4 y se lee aunque se escriba distinto', async () => {
    const c = await nuevoCodigo();
    assert.match(c, /^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.notEqual(c, await nuevoCodigo(), 'cada código es distinto');
    assert.equal((await leerCodigo(c.toLowerCase().replace(/-/g, ' '))).codigo, c, 'en minúsculas y con espacios');
    // Una O en lugar de un 0 (o una I en lugar de un 1) se entiende
    const conO = c.replace(/0/g, 'O').replace(/1/g, 'I');
    assert.equal((await leerCodigo(conO)).codigo, c);
    assert.equal((await leerCodigo(c.slice(0, -2))).error, 'largo');
    assert.equal((await leerCodigo(c.slice(0, -1) + (c.endsWith('Z') ? 'Y' : 'Z'))).error, 'control', 'una letra mal copiada se nota');
  });

  it('de un código salen siempre las mismas llaves, y de otro, otras', async () => {
    const c = await nuevoCodigo();
    const a = await llavesDe(c), b = await llavesDe(c), otra = await llavesDe(await nuevoCodigo());
    assert.match(a.id, /^[0-9a-f]{32}$/);
    assert.match(a.llave, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(a.id, b.id);
    assert.equal(a.llave, b.llave);
    assert.notEqual(a.id, otra.id);
    assert.equal(await nombreEnLaNube(a, 'pagina:abc'), await nombreEnLaNube(b, 'pagina:abc'));
    assert.notEqual(await nombreEnLaNube(a, 'pagina:abc'), await nombreEnLaNube(otra, 'pagina:abc'));
    assert.ok(!a.id.includes(a.llave.slice(0, 8)), 'el número no deja ver la llave');
  });

  it('cifra y descifra; con otro código, otro nombre o un byte cambiado, no abre', async () => {
    const llaves = await llavesDe(await nuevoCodigo());
    const datos = new TextEncoder().encode('Apuntes de Cálculo');
    const c1 = await cifrar(llaves, datos, 'n1'), c2 = await cifrar(llaves, datos, 'n1');
    assert.notDeepEqual(c1, c2, 'cada vez con un nonce distinto');
    assert.equal(new TextDecoder().decode(await descifrar(llaves, c1, 'n1')), 'Apuntes de Cálculo');
    await assert.rejects(descifrar(llaves, c1, 'n2'), /dañado o es de otro código/);
    await assert.rejects(descifrar(await llavesDe(await nuevoCodigo()), c1, 'n1'), /dañado o es de otro código/);
    const tocado = c1.slice(); tocado[20] ^= 1;
    await assert.rejects(descifrar(llaves, tocado, 'n1'));
    const indice = { app: 'ScanLibre', documentos: [{ nombre: 'Química', paginas: [] }], texto: 'la '.repeat(2000) };
    const cerrado = await cerrarJSON(llaves, indice, 'indice');
    assert.ok(cerrado.length < 400, 'va comprimido');
    assert.deepEqual(await abrirJSON(llaves, cerrado, 'indice'), indice);
  });
});

describe('Respaldo en la nube en la app', () => {
  let env, nube, codigo;
  const fotos = [fotoDePrueba(1), fotoDePrueba(2), fotoDePrueba(3)].map(f => f.ruta);
  before(async () => { env = await crearEntorno(); nube = nubeFalsa(); });
  after(async () => { await env.cerrar(); });

  const abrirNube = async page => {
    await page.click('#inicio-menu');
    await page.click('.menu-opcion:has-text("Respaldo en la nube")');
    await page.waitForSelector('dialog[open] .hoja-titulo:text-is("Respaldo en la nube")');
  };
  const volverAlInicio = async page => { await page.goto(env.url); await page.waitForSelector('#vista-inicio:not([hidden])'); };
  /** Cierra las hojas abiertas (al cerrar una, la de la nube se vuelve a abrir con su estado) */
  const cerrarTodo = async page => { for (let i = 0; i < 4 && await page.locator('dialog[open]').count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); } };
  const respaldarAhora = async page => {
    await abrirNube(page);
    await page.click('#nube-respaldar');
    await page.waitForSelector('dialog .hoja-titulo:text-matches("Respaldo listo|No se pudo|Otro teléfono")', { timeout: 30000 });
    return page.textContent('#nube-avance');
  };
  const subidos = () => nube.pedidos.filter(p => p.accion === 'subir').flatMap(p => p.archivos).filter(n => n !== 'indice' && n !== 'marca');

  let telefonoA;
  it('se activa con un código que hay que guardar, y sube todo cifrado', async () => {
    const page = telefonoA = await env.pagina();
    await nube.enganchar(page);
    await importarFoto(page, fotos[0], fotos[1]);
    await page.goBack();
    await importarFoto(page, fotos[2]);
    await volverAlInicio(page);
    await abrirNube(page);
    assert.match(await page.textContent('dialog'), /nadie más puede verlos/);
    await page.click('#nube-activar');
    await page.waitForSelector('#nube-codigo span');
    codigo = (await page.$$eval('#nube-codigo span', s => s.map(x => x.textContent))).join('-');
    assert.equal((await leerCodigo(codigo)).codigo, codigo);
    assert.equal(await page.isDisabled('#nube-guardado'), true, 'primero hay que guardarlo');
    await page.check('#nube-casilla');
    await page.click('#nube-guardado');
    await page.waitForSelector('dialog .hoja-titulo:has-text("Respaldo listo")', { timeout: 30000 });
    assert.match(await page.textContent('#nube-avance'), /^2 documentos \(3 páginas\) en la nube/);
    // 3 páginas × (original + página) + el índice + la marca del teléfono
    assert.equal(nube.objetos(), 8);
    const todo = nube.todo();
    assert.equal(todo.indexOf(Buffer.from([0xff, 0xd8, 0xff])), -1, 'no hay ningún JPEG a la vista');
    assert.equal(todo.indexOf(Buffer.from('Escaneo')), -1, 'ni los nombres de los documentos');
    assert.equal(todo.indexOf(Buffer.from('ScanLibre')), -1);
    await page.click('dialog .boton:has-text("Cerrar")');
    assert.match(await page.textContent('#nube-estado'), /Último respaldo: Hoy.*2 documentos/);
    assert.deepEqual(page.errores, []);
  });

  it('respaldar otra vez sube solo lo nuevo, y lo borrado se borra de la nube', async () => {
    const page = telefonoA;
    await cerrarTodo(page);
    const antes = subidos().length;
    assert.match(await respaldarAhora(page), /No había nada nuevo/);
    assert.equal(subidos().length, antes, 'nada que subir');
    await cerrarTodo(page);
    // Una página más en el primer documento: solo sus dos fotos
    await page.click('#inicio-lista li:last-child .doc');
    const [selector] = await Promise.all([page.waitForEvent('filechooser'), page.click('#doc-agregar').then(() => page.click('.menu-opcion:has-text("Fotos o un PDF")'))]);
    await selector.setFiles(fotoDePrueba(4).ruta);
    await page.waitForFunction(() => document.querySelectorAll('#doc-paginas .miniatura img').length === 3, null, { timeout: 30000 });
    await volverAlInicio(page);
    await respaldarAhora(page);
    assert.equal(subidos().length, antes + 2);
    assert.equal(nube.objetos(), 10);
    await cerrarTodo(page);
    // Borrar el documento de una página: sus fotos se van de la nube
    const { documentos } = await leerBase(page);
    const chico = documentos.find(d => d.paginas.length === 1);
    await page.evaluate(async id => (await import('./js/db.js')).documentoAPapelera(id), chico.id);
    await respaldarAhora(page);
    assert.equal(nube.objetos(), 8);
    await cerrarTodo(page);
    assert.deepEqual(page.errores, []);
  });

  it('en otro teléfono se recupera todo con el código (aunque se escriba en minúsculas)', async () => {
    const page = await env.pagina();
    await nube.enganchar(page);
    await abrirNube(page);
    await page.click('dialog .boton:has-text("Ya tengo un código")');
    await page.fill('dialog .campo', 'ABCD-EFGH');
    await page.click('dialog .boton-primario');
    await page.waitForSelector('dialog[open] .hoja-detalle:has-text("24 letras y números")');
    await page.fill('dialog .campo', codigo.toLowerCase().replace(/-/g, ' '));
    await page.click('dialog .boton-primario');
    await page.waitForSelector('dialog .hoja-titulo:has-text("Encontré tu respaldo")', { timeout: 20000 });
    assert.match(await page.textContent('dialog[open] .hoja-detalle'), /1 documento \(3 páginas/);
    await page.click('dialog .boton-primario:has-text("Recuperar")');
    await page.waitForSelector('dialog .hoja-titulo:has-text("Listo")', { timeout: 30000 });
    assert.match(await page.textContent('#nube-avance'), /Se recuperó 1 documento/);
    const aqui = await leerBase(page), alla = await leerBase(telefonoA);
    const conDatos = b => b.documentos.filter(d => !d.papelera).map(d => ({ nombre: d.nombre, paginas: d.paginas.length }));
    assert.deepEqual(conDatos(aqui), conDatos(alla));
    const tam = b => b.paginas.filter(p => b.documentos.some(d => !d.papelera && d.paginas.includes(p.id))).map(p => [p.id, p.original, p.procesada]).sort();
    assert.deepEqual(tam(aqui), tam(alla), 'las mismas fotos, byte por byte');
    await page.click('dialog .boton:has-text("Cerrar")');
    // Este teléfono ya respalda con ese código
    assert.match(await page.textContent('#nube-estado'), /Último respaldo: .*1 documento/);
    await cerrarTodo(page);
    assert.equal(await page.locator('#inicio-lista .doc').count(), 1);
    assert.deepEqual(page.errores, []);
    env.telefonoB = page;
  });

  it('un código que no existe o está mal copiado se explica', async () => {
    const page = await env.pagina();
    await nube.enganchar(page);
    await abrirNube(page);
    await page.click('dialog .boton:has-text("Ya tengo un código")');
    const malo = codigo.slice(0, -1) + (codigo.endsWith('Z') ? 'Y' : 'Z');
    await page.fill('dialog .campo', malo);
    await page.click('dialog .boton-primario');
    await page.waitForSelector('dialog[open] .hoja-detalle:has-text("Hay un error en el código")');
    await page.fill('dialog .campo', await nuevoCodigo());
    await page.click('dialog .boton-primario');
    await page.waitForSelector('.aviso:has-text("No encontré un respaldo con ese código")');
    assert.deepEqual(page.errores, []);
  });

  it('si otro teléfono respaldó después, pregunta antes de pisar: juntar los dos', async () => {
    // El teléfono B agrega un documento y respalda
    const b = env.telefonoB;
    await importarFoto(b, fotos[1]);
    await volverAlInicio(b);
    await respaldarAhora(b);
    await cerrarTodo(b);
    // El teléfono A no sabe de eso: al respaldar, se detiene y pregunta
    const a = telefonoA;
    await volverAlInicio(a);
    assert.match(await respaldarAhora(a), /elige si juntar/);
    await a.click('dialog .boton:has-text("Cerrar")');
    await a.waitForSelector('#nube-conflicto');
    assert.equal(await a.isDisabled('#nube-respaldar'), true);
    await a.click('#nube-conflicto .boton:has-text("Juntar los dos")');
    await a.click('dialog .boton-primario:has-text("Recuperar")');
    await a.waitForSelector('dialog .hoja-titulo:has-text("Listo")', { timeout: 30000 });
    await a.click('dialog .boton:has-text("Cerrar")');
    await a.waitForSelector('dialog .hoja-titulo:has-text("Respaldo listo")', { timeout: 30000 });
    const nombres = async p => (await leerBase(p)).documentos.filter(d => !d.papelera).map(d => d.nombre).sort();
    assert.equal((await nombres(a)).length, 2, 'A tiene lo suyo y lo de B');
    await a.click('dialog .boton:has-text("Cerrar")');
    assert.equal(await a.locator('#nube-conflicto').count(), 0);
    assert.deepEqual(a.errores, []);
  });

  it('se respalda solo al salir de la app si hubo cambios', async () => {
    const page = await env.pagina();
    const propia = nubeFalsa();
    await propia.enganchar(page);
    await abrirNube(page);
    await page.click('#nube-activar');
    await page.waitForSelector('#nube-codigo span');
    await page.check('#nube-casilla');
    await page.click('#nube-guardado');
    await page.waitForSelector('dialog .hoja-titulo:has-text("Respaldo listo")', { timeout: 30000 });
    await cerrarTodo(page);
    assert.equal(propia.objetos(), 2, 'sin documentos: el índice y la marca');
    await importarFoto(page, fotos[0]);
    await page.click('#doc-atras');
    await page.waitForSelector('#vista-inicio:not([hidden])');
    // Como cuando se cambia a otra app
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const inicio = Date.now();
    while (propia.objetos() < 4 && Date.now() - inicio < 20000) await new Promise(r => setTimeout(r, 200));
    assert.equal(propia.objetos(), 4, 'se subieron las dos fotos de la página nueva');
    assert.deepEqual(page.errores, []);
  });

  it('las fotos originales grandes van a 3000 px; borrar el respaldo lo quita todo de la nube', async () => {
    const page = await env.pagina();
    const propia = nubeFalsa();
    await propia.enganchar(page);
    const W = 3200, H = 2400, data = new Uint8ClampedArray(W * H * 4);
    let semilla = 7;
    // Como una foto de verdad: con grano (no se comprime casi nada)
    for (let i = 0; i < W * H; i++) { semilla = (semilla * 1103515245 + 12345) >>> 0; const v = 70 + (semilla >>> 24) % 140; data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v - 20; data[i * 4 + 3] = 255; }
    await importarFoto(page, guardarPNG({ data, width: W, height: H }, 'grande.png'));
    const [antes] = (await leerBase(page)).paginas;
    assert.equal(antes.ancho, 3200);
    await volverAlInicio(page);
    await abrirNube(page);
    await page.click('#nube-activar');
    await page.waitForSelector('#nube-codigo span');
    const suCodigo = (await page.$$eval('#nube-codigo span', s => s.map(x => x.textContent))).join('-');
    await page.check('#nube-casilla');
    await page.click('#nube-guardado');
    await page.waitForSelector('dialog .hoja-titulo:has-text("Respaldo listo")', { timeout: 60000 });
    // Se recupera en otro teléfono: la original llega a 3000 × 2250 y la página, igual
    const otro = await env.pagina();
    await propia.enganchar(otro);
    await abrirNube(otro);
    await otro.click('dialog .boton:has-text("Ya tengo un código")');
    await otro.fill('dialog .campo', suCodigo);
    await otro.click('dialog .boton-primario');
    await otro.click('dialog .boton-primario:has-text("Recuperar")');
    await otro.waitForSelector('dialog .hoja-titulo:has-text("Listo")', { timeout: 60000 });
    const [despues] = (await leerBase(otro)).paginas;
    assert.deepEqual([despues.ancho, despues.alto], [3000, 2250]);
    assert.ok(despues.original < antes.original, 'la original ocupa menos');
    assert.equal(despues.procesada, antes.procesada, 'la página se ve igual');
    const medida = await otro.evaluate(async () => {
      const db = await new Promise(r => { const q = indexedDB.open('scanlibre'); q.onsuccess = () => r(q.result); });
      const [p] = await new Promise(r => { const q = db.transaction('paginas').objectStore('paginas').getAll(); q.onsuccess = () => r(q.result); });
      const b = await createImageBitmap(p.original);
      return [b.width, b.height];
    });
    assert.deepEqual(medida, [3000, 2250]);
    // Borrar el respaldo de la nube desde el primer teléfono
    await page.click('dialog .boton:has-text("Cerrar")');
    await page.click('.nube-mas');
    await page.click('.menu-opcion:has-text("Borrar mi respaldo")');
    await page.click('dialog .boton-peligro');
    await page.waitForSelector('.aviso:has-text("Se borró tu respaldo de la nube")');
    assert.equal(propia.objetos(), 0);
    assert.equal(propia.respaldos.size, 0);
    await page.waitForSelector('#nube-activar');
    assert.deepEqual([...page.errores, ...otro.errores], []);
  });
});
