// ScanLibre · respaldo.js
// Respaldo gratis: todos los documentos en un solo archivo .zip que se guarda
// donde uno quiera (Drive, correo, la PC) y se restaura en otro teléfono.
// Adentro: scanlibre-respaldo.json con los datos (carpetas, documentos y
// páginas) y las fotos de cada página.

import { listarDocumentos, obtenerDocumento, paginasDe, reemplazarDocumento, listarCarpetas, guardarCarpeta } from './db.js';
import { abrirFoto, aCanvas, canvasABlob } from './fotos.js';
import { dibujarMarcas } from './marcas.js';

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

// Un respaldo de verdad nunca trae un archivo de más de esto (una foto de 12 MP pesa unos 5 MB)
const MAX_ARCHIVO_ZIP = 300e6;

/** Corta la lectura si un archivo comprimido se infla más de `tope` bytes (una "bomba zip") */
function conTope(tope) {
  let n = 0;
  return new TransformStream({
    transform(trozo, control) {
      n += trozo.byteLength;
      if (n > tope) control.error(new Error('Respaldo dañado: un archivo es demasiado grande'));
      else control.enqueue(trozo);
    }
  });
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
    const tamComprimido = cen.getUint32(p + 20, true), tamReal = cen.getUint32(p + 24, true);
    if (tamComprimido > MAX_ARCHIVO_ZIP || tamReal > MAX_ARCHIVO_ZIP) throw new Error('Respaldo dañado: un archivo es demasiado grande');
    const largoNombre = cen.getUint16(p + 28, true), largoExtra = cen.getUint16(p + 30, true), largoComentario = cen.getUint16(p + 32, true);
    const offLocal = cen.getUint32(p + 42, true);
    const nombre = decodificar.decode(new Uint8Array(cen.buffer, p + 46, largoNombre));
    p += 46 + largoNombre + largoExtra + largoComentario;
    const local = new DataView(await blob.slice(offLocal, offLocal + 30).arrayBuffer());
    const inicio = offLocal + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    let datos = blob.slice(inicio, inicio + tamComprimido);
    if (metodo === 8) datos = await new Response(datos.stream().pipeThrough(new DecompressionStream('deflate-raw')).pipeThrough(conTope(tamReal))).blob();
    else if (metodo !== 0) throw new Error('Respaldo con un formato que no se puede leer');
    res.set(nombre, datos);
  }
  return res;
}

// ── Respaldo de ScanLibre ───────────────────────────────────────────
const extension = blob => blob.type === 'image/png' ? 'png' : 'jpg';

/**
 * Todo lo que va en un respaldo: el manifiesto (carpetas, documentos y los
 * datos de cada página) y los archivos de las fotos, que el manifiesto nombra.
 * Lo usan el respaldo en archivo y el de la nube.
 * @returns { manifiesto, archivos: [{ nombre, datos: Blob }] }
 */
export async function contenidoDelRespaldo() {
  const docs = await listarDocumentos();
  const archivos = [];
  const manifiesto = { app: 'ScanLibre', version: 1, creado: Date.now(), carpetas: await listarCarpetas(), documentos: [] };
  for (const doc of docs) {
    const paginas = await paginasDe(doc);
    manifiesto.documentos.push({
      id: doc.id, nombre: doc.nombre, creado: doc.creado, modificado: doc.modificado, carpetaId: doc.carpetaId || null,
      paginas: paginas.map(p => {
        const original = `paginas/${p.id}-original.${extension(p.original)}`;
        const procesada = `paginas/${p.id}-pagina.${extension(p.procesada)}`;
        archivos.push({ nombre: original, datos: p.original }, { nombre: procesada, datos: p.procesada });
        return {
          id: p.id, ancho: p.ancho, alto: p.alto, esquinas: p.esquinas, filtro: p.filtro, rotacion: p.rotacion,
          procAncho: p.procAncho, procAlto: p.procAlto, creada: p.creada, ocr: p.ocr || null, nitidez: p.nitidez ?? null,
          aplanar: p.aplanar !== false, aplanada: !!p.aplanada, dedos: p.dedos !== false, sinDedos: !!p.sinDedos,
          brillo: p.brillo || 0, contraste: p.contraste || 0, marcas: p.marcas || [], modo: p.modo || null, portada: p.portada || null, original, procesada
        };
      })
    });
  }
  return { manifiesto, archivos };
}

export async function crearRespaldo() {
  const { manifiesto, archivos } = await contenidoDelRespaldo();
  archivos.unshift({ nombre: MANIFIESTO, datos: new TextEncoder().encode(JSON.stringify(manifiesto)) });
  return { blob: await crearZip(archivos), documentos: manifiesto.documentos.length };
}

/** Restaura un respaldo. Los documentos que ya estaban quedan como en el respaldo. */
export async function restaurarRespaldo(archivo) {
  const zip = await leerZip(archivo);
  const m = zip.get(MANIFIESTO);
  if (!m) throw new Error('El archivo no es un respaldo de ScanLibre');
  return restaurarContenido(JSON.parse(await m.text()), async nombre => zip.get(nombre));
}

/**
 * Guarda en el teléfono lo que dice un manifiesto de respaldo.
 * @param abrir (nombre) → Promise<Blob | undefined>: la foto que el manifiesto nombra
 * @param alAvanzar ({ hechas, total }) por cada página
 * @param juntar si ya hay un documento igual en el teléfono, queda el más nuevo de los dos
 * @returns cuántos documentos se restauraron
 */
export async function restaurarContenido(manifiesto, abrir, { alAvanzar, juntar = false } = {}) {
  if (manifiesto?.app !== 'ScanLibre' || !Array.isArray(manifiesto.documentos)) throw new Error('El archivo no es un respaldo de ScanLibre');
  const tipoDe = nombre => nombre.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const conTipo = (blob, nombre) => blob.slice(0, blob.size, tipoDe(nombre));
  const total = manifiesto.documentos.reduce((s, d) => s + (d.paginas?.length || 0), 0);
  let restaurados = 0, hechas = 0;
  // Respaldos de antes de las carpetas no traen "carpetas"
  for (const c of manifiesto.carpetas || []) if (c?.id && c.nombre) await guardarCarpeta({ id: c.id, nombre: c.nombre, creada: c.creada || Date.now() });
  const hayCarpeta = new Set((manifiesto.carpetas || []).map(c => c?.id));
  for (const d of manifiesto.documentos) {
    if (juntar) {
      const aqui = await obtenerDocumento(d.id);
      if (aqui && !aqui.papelera && (aqui.modificado || 0) >= (d.modificado || 0)) { hechas += d.paginas.length; continue; }
    }
    const paginas = [];
    for (const p of d.paginas) {
      const original = await abrir(p.original), procesada = await abrir(p.procesada);
      alAvanzar?.({ hechas: ++hechas, total });
      if (!original || !procesada) continue;
      const bmp = await abrirFoto(conTipo(procesada, p.procesada));
      const chico = aCanvas(bmp, 360);
      bmp.close?.();
      const marcas = Array.isArray(p.marcas) ? p.marcas : [];
      if (marcas.length) dibujarMarcas(chico.getContext('2d'), marcas, chico.width, chico.height);
      const miniatura = await canvasABlob(chico, 'image/jpeg', 0.8);
      paginas.push({
        id: p.id, ancho: p.ancho, alto: p.alto, esquinas: p.esquinas, filtro: p.filtro, rotacion: p.rotacion || 0,
        procAncho: p.procAncho, procAlto: p.procAlto, creada: p.creada, ocr: p.ocr || null, nitidez: p.nitidez ?? null,
        aplanar: p.aplanar !== false, aplanada: !!p.aplanada, dedos: p.dedos !== false, sinDedos: !!p.sinDedos,
        brillo: p.brillo || 0, contraste: p.contraste || 0, marcas, modo: p.modo || null, portada: p.portada || null,
        original: conTipo(original, p.original), procesada: conTipo(procesada, p.procesada), miniatura
      });
    }
    await reemplazarDocumento({ id: d.id, nombre: d.nombre, creado: d.creado, modificado: d.modificado, carpetaId: hayCarpeta.has(d.carpetaId) ? d.carpetaId : null }, paginas);
    restaurados++;
  }
  return restaurados;
}
