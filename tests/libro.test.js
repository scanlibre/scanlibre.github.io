import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { libroAbierto, paginaDeTexto } from './escenas.js';
import { buscarLomo, dividirEsquinas } from '../js/imagen/libro.js';
import { crearEntorno, importarFoto, leerBase, guardarPNG, videoDeImagen } from './ayuda.js';

describe('Modo libro: el lomo', () => {
  it('encuentra el lomo del libro abierto, aunque no esté justo al medio', () => {
    for (const lomo of [0.45, 0.5, 0.56]) {
      const s = buscarLomo(libroAbierto({ lomo }));
      assert.ok(s !== null && Math.abs(s - lomo) < 0.015, `lomo en ${lomo}: ${s}`);
    }
  });

  it('una sola página no se parte', () => {
    assert.equal(buscarLomo(paginaDeTexto(800, 1100)), null);
    assert.equal(buscarLomo({ data: new Uint8ClampedArray(600 * 400 * 4).fill(240), width: 600, height: 400 }), null, 'sin texto');
  });

  it('parte las esquinas siguiendo la perspectiva de la foto', () => {
    const [izq, der] = dividirEsquinas([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], 0.5);
    assert.deepEqual(izq.map(p => [p.x, p.y]), [[0, 0], [0.5, 0], [0.5, 1], [0, 1]]);
    assert.deepEqual(der.map(p => [p.x, p.y]), [[0.5, 0], [1, 0], [1, 1], [0.5, 1]]);
    // En perspectiva: el lomo cae sobre los bordes de arriba y de abajo, y no en la mitad de la foto
    const libro = [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.1 }, { x: 0.95, y: 0.8 }, { x: 0.05, y: 0.9 }];
    const [a, b] = dividirEsquinas(libro, 0.5);
    const enRecta = (p, q, r) => Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) < 1e-9;
    assert.ok(enRecta(libro[0], libro[1], a[1]) && enRecta(libro[3], libro[2], a[2]));
    assert.deepEqual(a[1], b[0]); assert.deepEqual(a[2], b[3]);
  });
});

describe('Modo libro en la app', () => {
  let env;
  before(async () => { env = await crearEntorno(); });
  after(async () => { await env.cerrar(); });

  it('"Separar" deja la página de la izquierda en su lugar y la de la derecha después', async () => {
    const page = await env.pagina();
    await importarFoto(page, guardarPNG(libroAbierto(), 'libro.png'));
    await page.click('#doc-paginas .miniatura');
    await page.click('#pagina-separar');
    await page.waitForSelector('.aviso-exito:has-text("quedaron las páginas 1 y 2")', { timeout: 30000 });
    assert.equal(await page.textContent('#pagina-titulo'), 'Página 1 de 2');
    const { documentos, paginas } = await leerBase(page);
    const [p1, p2] = documentos[0].paginas.map(id => paginas.find(p => p.id === id));
    // Cada una es más o menos la mitad del libro (el lomo está al 52 %)
    const prop = p => p.procAncho / p.procAlto;
    assert.ok(Math.abs(prop(p1) - 0.52 * 1.4) < 0.08, `izquierda ${prop(p1)}`);
    assert.ok(Math.abs(prop(p2) - 0.48 * 1.4) < 0.08, `derecha ${prop(p2)}`);
    assert.ok(p1.esquinas[1].x < 0.6 && p2.esquinas[0].x > 0.45);
    assert.deepEqual(page.errores, []);
  });

  it('"Separar" en una página que no es un libro avisa y no cambia nada', async () => {
    const page = await env.pagina();
    await importarFoto(page, guardarPNG(paginaDeTexto(800, 1100), 'hoja.png'));
    await page.click('#doc-paginas .miniatura');
    await page.click('#pagina-separar');
    await page.waitForSelector('.aviso-error:has-text("No encontré el lomo")');
    assert.equal((await leerBase(page)).paginas.length, 1);
  });
});

describe('Modo libro con la cámara', () => {
  let env;
  before(async () => {
    // El libro abierto sobre una mesa oscura, en un video de 720×960
    const W = 720, H = 960, libro = libroAbierto({ ancho: 660, alto: 470 });
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { data[i * 4] = 45; data[i * 4 + 1] = 42; data[i * 4 + 2] = 40; data[i * 4 + 3] = 255; }
    for (let y = 0; y < libro.height; y++) data.set(libro.data.subarray(y * libro.width * 4, (y + 1) * libro.width * 4), ((y + 245) * W + 30) * 4);
    env = await crearEntorno({ video: videoDeImagen({ data, width: W, height: H }, 'camara-libro.y4m') });
  });
  after(async () => { await env.cerrar(); });

  it('con "Libro" cada foto deja las dos páginas', async () => {
    const page = await env.pagina();
    await page.click('#inicio-escanear');
    await page.waitForSelector('#camara-disparar:not([disabled])', { timeout: 20000 });
    await page.click('#camara-libro');
    await page.waitForFunction(() => document.querySelector('#camara-pista').textContent === 'Hoja encontrada', null, { timeout: 20000 });
    await page.click('#camara-disparar');
    await page.waitForSelector('#vista-recorte:not([hidden])', { timeout: 20000 });
    assert.equal(await page.textContent('#titulo-recorte'), 'Esquinas del libro abierto');
    await page.click('#recorte-listo');
    await page.waitForFunction(() => document.querySelector('#camara-cuenta').textContent === '2', null, { timeout: 30000 });
    const { paginas } = await leerBase(page);
    assert.equal(paginas.length, 2);
    assert.deepEqual(page.errores, []);
  });
});
