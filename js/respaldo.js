// ScanLibre · respaldo.js
// Respaldo gratis: todos los documentos en un solo archivo .zip que se guarda
// donde uno quiera (Drive, correo, la PC) y se restaura en otro teléfono.
// Adentro: scanlibre-respaldo.json con los datos y las fotos de cada página.

import { listarDocumentos, paginasDe, reemplazarDocumento } from './db.js';
import { abrirFoto, aCanvas, canvasABlob } from './fotos.js';

const MANIFIESTO = 'scanlibre-respaldo.json';

// ── ZIP mínimo (sin comprimir: las fotos ya vienen comprimidas) ─────
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function fechaDOS(d) {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    fecha: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

/** @param archivos [{ nombre, datos: Blob | Uint8Array }] */
export async function crearZip(archivos, fecha = new Date()) {
  const texto = new TextEncoder();
  const { hora, fecha: dia } = fechaDOS(fecha);
  const partes = [], central = [];
  let offset = 0;
  for (const a of archivos) {
    const bytes = a.datos instanceof Uint8Array ? a.datos : new Uint8Array(await a.datos.arrayBuffer());
    const nombre = texto.encode(a.nombre);
    const crc = crc32(bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true);      // sin comprimir
    local.setUint16(10, hora, true); local.setUint16(12, dia, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true); local.setUint32(22, bytes.length, true);
    local.setUint16(26, nombre.length, true); local.setUint16(28, 0, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
    cen.setUint16(12, hora, true); cen.setUint16(14, dia, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, bytes.length, true); cen.setUint32(24, bytes.length, true);
    cen.setUint16(28, nombre.length, true);
    cen.setUint32(42, offset, true);
    partes.push(local.buffer, nombre, a.datos instanceof Blob ? a.datos : bytes);
    central.push(cen.buffer, nombre);
    offset += 30 + nombre.length + bytes.length;
  }
  const tamCentral = central.reduce((s, p) => s + p.byteLength, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true);
  return new Blob([...partes, ...central, fin.buffer], { type: 'application/zip' });
}

/** Lee un .zip y devuelve Map(nombre → Blob). Entiende archivos sin comprimir y con deflate */
export async function leerZip(blob) {
  const colaLargo = Math.min(blob.size, 65557);
  const cola = new DataView(await blob.slice(blob.size - colaLargo).arrayBuffer());
  let fin = -1;
  for (let i = colaLargo - 22; i >= 0; i--) if (cola.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('El archivo no es un respaldo válido');
  const cuantos = cola.getUint16(fin + 10, true);
  const tamCentral = cola.getUint32(fin + 12, true), inicioCentral = cola.getUint32(fin + 16, true);
  const cen = new DataView(await blob.slice(inicioCentral, inicioCentral + tamCentral).arrayBuffer());
  const decodificar = new TextDecoder();
  const res = new Map();
  let p = 0;
  for (let n = 0; n < cuantos; n++) {
    if (cen.getUint32(p, true) !== 0x02014b50) throw new Error('Respaldo dañado');
    const metodo = cen.getUint16(p + 10, true);
    const tamComprimido = cen.getUint32(p + 20, true);
    const largoNombre = cen.getUint16(p + 28, true), largoExtra = cen.getUint16(p + 30, true), largoComentario = cen.getUint16(p + 32, true);
    const offLocal = cen.getUint32(p + 42, true);
    const nombre = decodificar.decode(new Uint8Array(cen.buffer, p + 46, largoNombre));
    p += 46 + largoNombre + largoExtra + largoComentario;
    const local = new DataView(await blob.slice(offLocal, offLocal + 30).arrayBuffer());
    const inicio = offLocal + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    let datos = blob.slice(inicio, inicio + tamComprimido);
    if (metodo === 8) datos = await new Response(datos.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    else if (metodo !== 0) throw new Error('Respaldo con un formato que no se puede leer');
    res.set(nombre, datos);
  }
  return res;
}

// ── Respaldo de ScanLibre ───────────────────────────────────────────
const extension = blob => blob.type === 'image/png' ? 'png' : 'jpg';

export async function crearRespaldo() {
  const docs = await listarDocumentos();
  const archivos = [];
  const manifiesto = { app: 'ScanLibre', version: 1, creado: Date.now(), documentos: [] };
  for (const doc of docs) {
    const paginas = await paginasDe(doc);
    manifiesto.documentos.push({
      id: doc.id, nombre: doc.nombre, creado: doc.creado, modificado: doc.modificado,
      paginas: paginas.map(p => {
        const original = `paginas/${p.id}-original.${extension(p.original)}`;
        const procesada = `paginas/${p.id}-pagina.${extension(p.procesada)}`;
        archivos.push({ nombre: original, datos: p.original }, { nombre: procesada, datos: p.procesada });
        return {
          id: p.id, ancho: p.ancho, alto: p.alto, esquinas: p.esquinas, filtro: p.filtro, rotacion: p.rotacion,
          procAncho: p.procAncho, procAlto: p.procAlto, creada: p.creada, ocr: p.ocr || null, nitidez: p.nitidez ?? null,
          aplanar: p.aplanar !== false, aplanada: !!p.aplanada, original, procesada
        };
      })
    });
  }
  archivos.unshift({ nombre: MANIFIESTO, datos: new TextEncoder().encode(JSON.stringify(manifiesto)) });
  return { blob: await crearZip(archivos), documentos: docs.length };
}

/** Restaura un respaldo. Los documentos que ya estaban quedan como en el respaldo. */
export async function restaurarRespaldo(archivo) {
  const zip = await leerZip(archivo);
  const m = zip.get(MANIFIESTO);
  if (!m) throw new Error('El archivo no es un respaldo de ScanLibre');
  const manifiesto = JSON.parse(await m.text());
  if (manifiesto.app !== 'ScanLibre' || !Array.isArray(manifiesto.documentos)) throw new Error('El archivo no es un respaldo de ScanLibre');
  const tipoDe = nombre => nombre.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const conTipo = (blob, nombre) => blob.slice(0, blob.size, tipoDe(nombre));
  let restaurados = 0;
  for (const d of manifiesto.documentos) {
    const paginas = [];
    for (const p of d.paginas) {
      const original = zip.get(p.original), procesada = zip.get(p.procesada);
      if (!original || !procesada) continue;
      const bmp = await abrirFoto(conTipo(procesada, p.procesada));
      const miniatura = await canvasABlob(aCanvas(bmp, 360), 'image/jpeg', 0.8);
      bmp.close?.();
      paginas.push({
        id: p.id, ancho: p.ancho, alto: p.alto, esquinas: p.esquinas, filtro: p.filtro, rotacion: p.rotacion || 0,
        procAncho: p.procAncho, procAlto: p.procAlto, creada: p.creada, ocr: p.ocr || null, nitidez: p.nitidez ?? null,
        aplanar: p.aplanar !== false, aplanada: !!p.aplanada,
        original: conTipo(original, p.original), procesada: conTipo(procesada, p.procesada), miniatura
      });
    }
    await reemplazarDocumento({ id: d.id, nombre: d.nombre, creado: d.creado, modificado: d.modificado }, paginas);
    restaurados++;
  }
  return restaurados;
}
