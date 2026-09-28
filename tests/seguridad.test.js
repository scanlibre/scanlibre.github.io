import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, leerZip } from '../js/respaldo.js';
import { interpretar } from '../js/codigos.js';
import { crearEntorno } from './ayuda.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const leer = f => readFileSync(join(RAIZ, f), 'utf8');

/** Un .zip de una sola entrada con deflate, diciendo que pesa `declarado` */
function zipCon(contenido, declarado = contenido.length) {
  const comprimido = deflateRawSync(contenido), nombre = Buffer.from('paginas/x-pagina.jpg');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(contenido), 14); local.writeUInt32LE(comprimido.length, 18); local.writeUInt32LE(declarado, 22);
  local.writeUInt16LE(nombre.length, 26);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(crc32(contenido), 16); cen.writeUInt32LE(comprimido.length, 20); cen.writeUInt32LE(declarado, 24);
  cen.writeUInt16LE(nombre.length, 28);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(1, 8); fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(46 + nombre.length, 12); fin.writeUInt32LE(30 + nombre.length + comprimido.length, 16);
  return new Blob([local, nombre, comprimido, cen, nombre, fin]);
}

describe('Seguridad: lo que llega de afuera', () => {
  it('un respaldo .zip no se puede inflar más de lo que dice (bomba zip)', async () => {
    const ceros = Buffer.alloc(20e6);
    assert.equal((await (await leerZip(zipCon(ceros))).get('paginas/x-pagina.jpg')).size, 20e6, 'uno honesto se lee');
    await assert.rejects(async () => { const z = await leerZip(zipCon(ceros, 1000)); await z.get('paginas/x-pagina.jpg').arrayBuffer(); }, /demasiado grande/);
    await assert.rejects(leerZip(zipCon(Buffer.from('hola'), 400e6)), /demasiado grande/, 'ni dice pesar más de 300 MB');
  });

  it('un código QR nunca abre javascript: ni otro esquema raro', () => {
    for (const malo of ['javascript:alert(1)', 'JAVASCRIPT:fetch(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd']) {
      assert.equal(interpretar(malo).tipo, 'texto', malo);
    }
    assert.equal(interpretar('https://unah.edu.hn').tipo, 'enlace');
  });
});

describe('Seguridad: configuración', () => {
  it('la política de contenido no deja correr código de afuera ni eval', () => {
    const csp = leer('index.html').match(/Content-Security-Policy" content="([^"]+)"/)[1];
    assert.match(csp, /script-src 'self';/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'self'/);
    assert.match(csp, /connect-src 'self';/, 'la app no se conecta a ningún servidor de afuera: todo queda en el teléfono');
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
    assert.match(leer('index.html'), /<meta name="referrer" content="no-referrer">/);
    assert.doesNotMatch(leer('index.html'), /<script(?![^>]*\bsrc=)[^>]*>/, 'sin scripts escritos dentro de la página');
  });

  it('las acciones de GitHub van fijadas por commit y con permiso de solo lectura', () => {
    for (const f of readdirSync(join(RAIZ, '.github/workflows'))) {
      const w = leer('.github/workflows/' + f);
      for (const [, accion] of w.matchAll(/uses:\s*(\S+)/g)) assert.match(accion, /@[0-9a-f]{40}$/, `${f}: ${accion}`);
      assert.match(w, /permissions:\s*\n\s*contents: read/, f);
    }
  });

  it('pdf.js no compila código de los PDF; hay a quién reportar una falla', () => {
    assert.match(leer('js/importar.js'), /isEvalSupported: false/);
    assert.match(leer('SECURITY.md'), /Report a vulnerability/);
    assert.match(leer('.gitignore'), /\*\.jks/);
  });
});

describe('Seguridad: en el navegador', () => {
  let env;
  before(async () => { env = await crearEntorno(); });
  after(async () => { await env.cerrar(); });

  it('no se deja meter dentro de otra página (clickjacking)', async () => {
    const page = await env.pagina();
    await page.setContent(`<iframe src="${env.url}" style="width:400px;height:600px"></iframe>`);
    const marco = page.frames().find(f => f !== page.mainFrame());
    await marco.waitForSelector('a:has-text("Abrir ScanLibre")');
    assert.equal(await marco.locator('#vista-inicio').count(), 0, 'la app no se muestra adentro');
  });

  it('el código del respaldo en la nube (hasta la versión 31) se borra del teléfono', async () => {
    const page = await env.pagina({ antes: () => {
      localStorage.setItem('scanlibre_ajustes', JSON.stringify({ filtro: 'color', nube: { codigo: 'ABCD-EFGH' }, dispositivo: 'x1' }));
      localStorage.setItem('scanlibre_cambio', '123');
    } });
    const [guardado, cambio] = await page.evaluate(() => [JSON.parse(localStorage.getItem('scanlibre_ajustes')), localStorage.getItem('scanlibre_cambio')]);
    assert.equal(guardado.filtro, 'color', 'lo demás se queda');
    assert.ok(!('nube' in guardado) && !('dispositivo' in guardado));
    assert.equal(cambio, null);
  });
});
