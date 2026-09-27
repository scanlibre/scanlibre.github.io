import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { crc32, crearZip, leerZip } from '../js/respaldo.js';

describe('Respaldo (.zip)', () => {
  it('calcula el CRC-32 estándar', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  });

  it('lo que se guarda en el zip se lee igual, con nombres con tildes', async () => {
    const foto = new Uint8Array(5000).map((_, i) => (i * 7) % 256);
    const zip = await crearZip([
      { nombre: 'scanlibre-respaldo.json', datos: new TextEncoder().encode('{"app":"ScanLibre"}') },
      { nombre: 'paginas/añadida-página.jpg', datos: new Blob([foto]) }
    ]);
    const leido = await leerZip(zip);
    assert.deepEqual([...leido.keys()], ['scanlibre-respaldo.json', 'paginas/añadida-página.jpg']);
    assert.equal(await leido.get('scanlibre-respaldo.json').text(), '{"app":"ScanLibre"}');
    assert.deepEqual(new Uint8Array(await leido.get('paginas/añadida-página.jpg').arrayBuffer()), foto);
  });

  it('también lee zips comprimidos (si alguien lo vuelve a comprimir en la PC)', async () => {
    const contenido = Buffer.from('hola '.repeat(200));
    const comprimido = deflateRawSync(contenido);
    const nombre = Buffer.from('a.txt');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(contenido), 14); local.writeUInt32LE(comprimido.length, 18); local.writeUInt32LE(contenido.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc32(contenido), 16); cen.writeUInt32LE(comprimido.length, 20); cen.writeUInt32LE(contenido.length, 24);
    cen.writeUInt16LE(nombre.length, 28); cen.writeUInt32LE(0, 42);
    const inicioCentral = 30 + nombre.length + comprimido.length;
    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(1, 8); fin.writeUInt16LE(1, 10);
    fin.writeUInt32LE(46 + nombre.length, 12); fin.writeUInt32LE(inicioCentral, 16);
    const zip = new Blob([local, nombre, comprimido, cen, nombre, fin]);
    const leido = await leerZip(zip);
    assert.equal(await leido.get('a.txt').text(), contenido.toString());
  });

  it('un archivo que no es zip da un error claro', async () => {
    await assert.rejects(leerZip(new Blob(['esto no es un zip'])), /no es un respaldo válido/);
  });
});
