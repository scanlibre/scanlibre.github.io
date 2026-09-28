// ScanLibre · nube.js
// Respaldo cifrado en la nube (Supabase). Todo se cifra en el teléfono con
// llaves que salen del código de respaldo (ver llaves.js): en la nube quedan
// bytes cifrados con nombres al azar. Cada foto se sube una sola vez (su
// nombre sale de su huella), así que respaldar otra vez solo sube lo nuevo.
// Las fotos originales van reducidas a 3000 px para ocupar menos.

import { llavesDe, huella, nombreEnLaNube, cifrar, descifrar, cerrarJSON, abrirJSON } from './llaves.js';
import { contenidoDelRespaldo, restaurarContenido } from './respaldo.js';
import { ultimoCambio } from './db.js';
import { ajustes, cambiarAjuste } from './ajustes.js';
import { abrirFoto, canvasABlob } from './fotos.js';
import { nuevoId, aviso } from './util.js';

export const SERVIDOR = 'https://kprqbrtxakiatmbqavmy.supabase.co/functions/v1/respaldo';
const LADO_ORIGINAL = 3000;
const POR_TANDA = 8;

export class ErrorNube extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}

/** Avisa cómo va el respaldo: eventos 'avance' ({ etapa, hechos, total }) y 'fin' ({ error? }) */
export const eventosNube = new EventTarget();
const avisar = (tipo, detalle) => eventosNube.dispatchEvent(new CustomEvent(tipo, { detail: detalle }));

export const configNube = () => ajustes().nube || null;
const guardarConfig = cambios => cambiarAjuste('nube', { ...(ajustes().nube || {}), ...cambios });

function dispositivo() {
  if (!ajustes().dispositivo) cambiarAjuste('dispositivo', nuevoId());
  return ajustes().dispositivo;
}

async function pedir(llaves, accion, datos = {}) {
  let r;
  try {
    // text/plain: así el navegador no hace la consulta previa de CORS
    r = await fetch(SERVIDOR, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ accion, id: llaves.id, llave: llaves.llave, ...datos }) });
  } catch (e) {
    throw new ErrorNube('sin-conexion', 'No hay conexión con la nube. Revisa tu internet.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorNube(j.codigo || 'servidor', j.error || 'La nube no respondió bien. Prueba más tarde.');
  return j;
}

async function subirBytes(url, bytes) {
  let r;
  try { r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes }); }
  catch (e) { throw new ErrorNube('sin-conexion', 'Se cortó la conexión mientras se subía el respaldo.'); }
  if (!r.ok) throw new ErrorNube('servidor', `La nube no aceptó un archivo (${r.status}).`);
}

async function bajarBytes(url) {
  let r;
  try { r = await fetch(url); }
  catch (e) { throw new ErrorNube('sin-conexion', 'Se cortó la conexión mientras se bajaba el respaldo.'); }
  if (!r.ok) throw new ErrorNube('servidor', `No se pudo bajar un archivo de la nube (${r.status}).`);
  return new Uint8Array(await r.arrayBuffer());
}

async function bajarJSON(llaves, nombre) {
  const { urls } = await pedir(llaves, 'bajar', { nombres: [nombre] });
  if (!urls[nombre]) throw new ErrorNube('no-existe', 'No encontré el respaldo en la nube.');
  return abrirJSON(llaves, await bajarBytes(urls[nombre]), nombre);
}

const extension = blob => blob.type === 'image/png' ? 'png' : 'jpg';
const medidaReducida = (ancho, alto) => {
  const f = LADO_ORIGINAL / Math.max(ancho, alto);
  return f < 1 ? { ancho: Math.max(1, Math.round(ancho * f)), alto: Math.max(1, Math.round(alto * f)) } : null;
};

/** La foto original, reducida a 3000 px (JPEG); si ya es chica, tal cual */
async function originalReducida(blob, medida) {
  const bmp = await abrirFoto(blob);
  const c = document.createElement('canvas');
  c.width = medida.ancho; c.height = medida.alto;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const r = await canvasABlob(c, 'image/jpeg', 0.85);
  c.width = c.height = 0;
  return r;
}

let enCurso = null;
export const respaldando = () => !!enCurso;

/**
 * Sube lo que haya cambiado. Si otro teléfono respaldó con el mismo código
 * después de este, no sube nada (ErrorNube 'otro-telefono') salvo con `forzar`.
 * @returns { documentos, paginas, bytes, subidos }
 */
export function respaldarEnLaNube({ forzar = false } = {}) {
  if (enCurso) return enCurso;
  enCurso = respaldar(forzar)
    .then(r => { avisar('fin', r); return r; })
    .catch(e => {
      // Sin internet (o si se cerró la app a medio respaldo) no es un error que mostrar: se reintenta pronto
      const red = e.codigo === 'sin-conexion';
      guardarConfig({ error: red || e.codigo === 'otro-telefono' ? null : e.message, intento: Date.now(), espera: red ? 15000 : 60000 });
      avisar('fin', { error: e });
      throw e;
    })
    .finally(() => { enCurso = null; });
  return enCurso;
}

async function respaldar(forzar) {
  const conf = configNube();
  if (!conf?.codigo) throw new ErrorNube('sin-codigo', 'El respaldo en la nube no está activado.');
  const inicio = Date.now();
  const yo = dispositivo();
  avisar('avance', { etapa: 'revisando' });
  const llaves = await llavesDe(conf.codigo);
  const estado = await pedir(llaves, 'estado');

  // ¿Otro teléfono respaldó con este código después que este?
  if (estado.objetos.marca && !forzar) {
    const marca = await bajarJSON(llaves, 'marca');
    if (marca.dispositivo !== yo && marca.creado > (conf.ultimo || 0)) {
      guardarConfig({ conflicto: { creado: marca.creado } });
      throw new ErrorNube('otro-telefono', 'Otro teléfono respaldó con este código.');
    }
  }

  const { manifiesto, archivos } = await contenidoDelRespaldo();
  const datosDe = new Map(archivos.map(a => [a.nombre, a.datos]));
  const pendientes = [], usados = new Set(['indice', 'marca']);
  let paginas = 0;
  for (const d of manifiesto.documentos) {
    for (const p of d.paginas) {
      paginas++;
      const original = datosDe.get(p.original), procesada = datosDe.get(p.procesada);
      const reducida = medidaReducida(p.ancho, p.alto);
      const nombreO = await nombreEnLaNube(llaves, `${reducida ? 'original-3000' : 'original'}:${await huella(original)}`);
      const nombreP = await nombreEnLaNube(llaves, `pagina:${await huella(procesada)}`);
      if (reducida) Object.assign(p, reducida);
      p.original = `${nombreO}.${reducida ? 'jpg' : extension(original)}`;
      p.procesada = `${nombreP}.${extension(procesada)}`;
      for (const [nombre, datos, medida] of [[nombreO, original, reducida], [nombreP, procesada, null]]) {
        if (usados.has(nombre)) continue;
        usados.add(nombre);
        if (!(nombre in estado.objetos)) pendientes.push({ nombre, datos, medida });
      }
    }
  }

  // Lo que falta, en tandas: se prepara, se cifra y se sube directo al depósito
  let hechos = 0;
  for (let i = 0; i < pendientes.length; i += POR_TANDA) {
    const tanda = pendientes.slice(i, i + POR_TANDA);
    avisar('avance', { etapa: 'subiendo', hechos, total: pendientes.length });
    for (const x of tanda) {
      const datos = x.medida ? await originalReducida(x.datos, x.medida) : x.datos;
      x.cifrado = await cifrar(llaves, datos, x.nombre);
      x.bytes = x.cifrado.length;
    }
    const { urls } = await pedir(llaves, 'subir', { archivos: tanda.map(x => ({ nombre: x.nombre, bytes: x.cifrado.length })) });
    for (const x of tanda) {
      await subirBytes(urls[x.nombre], x.cifrado);
      x.cifrado = null;
      avisar('avance', { etapa: 'subiendo', hechos: ++hechos, total: pendientes.length });
    }
  }

  // El índice (qué hay y dónde) y la marca de este teléfono, solo si algo cambió
  delete manifiesto.creado;
  const huellaIndice = await huella(new TextEncoder().encode(JSON.stringify(manifiesto)));
  const tamanos = { ...estado.objetos };
  for (const x of pendientes) tamanos[x.nombre] = x.bytes;
  if (pendientes.length || huellaIndice !== conf.huella || !estado.objetos.indice || forzar) {
    avisar('avance', { etapa: 'terminando' });
    const indice = await cerrarJSON(llaves, { ...manifiesto, creado: inicio, nube: { dispositivo: yo, creado: inicio } }, 'indice');
    const marca = await cerrarJSON(llaves, { dispositivo: yo, creado: inicio }, 'marca');
    const { urls } = await pedir(llaves, 'subir', { archivos: [{ nombre: 'indice', bytes: indice.length }, { nombre: 'marca', bytes: marca.length }] });
    await subirBytes(urls.indice, indice);
    await subirBytes(urls.marca, marca);
    tamanos.indice = indice.length;
    tamanos.marca = marca.length;
    // Lo que ya no está en el teléfono se borra de la nube
    const sobran = Object.keys(estado.objetos).filter(n => !usados.has(n));
    for (let i = 0; i < sobran.length; i += 1000) await pedir(llaves, 'borrar', { nombres: sobran.slice(i, i + 1000) });
  }

  const bytes = [...usados].reduce((s, n) => s + (tamanos[n] || 0), 0);
  const resultado = { documentos: manifiesto.documentos.length, paginas, subidos: pendientes.length, bytes, cupo: estado.cupo };
  guardarConfig({ ultimo: inicio, huella: huellaIndice, conflicto: null, error: null, avisado: null, ...resultado });
  return resultado;
}

/**
 * Busca el respaldo de un código (ya leído con leerCodigo).
 * @returns { llaves, indice, documentos, paginas, bytes }
 */
export async function buscarEnLaNube(codigo) {
  const llaves = await llavesDe(codigo);
  const estado = await pedir(llaves, 'estado');
  if (!estado.existe || !estado.objetos.indice) throw new ErrorNube('no-existe', 'No encontré un respaldo con ese código. Revisa que esté bien escrito.');
  const indice = await bajarJSON(llaves, 'indice');
  return {
    codigo, llaves, indice,
    documentos: indice.documentos.length,
    paginas: indice.documentos.reduce((s, d) => s + d.paginas.length, 0),
    bytes: Object.values(estado.objetos).reduce((s, b) => s + b, 0)
  };
}

/**
 * Trae al teléfono lo que encontró buscarEnLaNube. Desde ahí, este teléfono
 * sigue respaldando con ese código.
 * @param juntar si ya hay un documento igual en el teléfono, queda el más nuevo
 */
export async function recuperarDeLaNube({ codigo, llaves, indice, documentos, paginas, bytes }, { alAvanzar, juntar = true } = {}) {
  const nombres = [...new Set(indice.documentos.flatMap(d => d.paginas.flatMap(p => [p.original, p.procesada])).map(n => n.split('.')[0]))];
  const urls = {};
  for (let i = 0; i < nombres.length; i += 200) Object.assign(urls, (await pedir(llaves, 'bajar', { nombres: nombres.slice(i, i + 200) })).urls);
  const abrir = async nombre => {
    const remoto = nombre.split('.')[0];
    if (!urls[remoto]) return undefined;
    return new Blob([await descifrar(llaves, await bajarBytes(urls[remoto]), remoto)]);
  };
  const n = await restaurarContenido(indice, abrir, { alAvanzar, juntar });
  // Lo juntado (lo de la nube y lo que ya había aquí) se vuelve a subir en el próximo respaldo
  cambiarAjuste('nube', { codigo, ultimo: indice.nube?.creado || indice.creado || 0, conflicto: null, error: null, huella: null, documentos, paginas, bytes, cupo: configNube()?.cupo });
  dispositivo();
  return n;
}

/** Borra todo el respaldo de la nube y deja de respaldar */
export async function borrarDeLaNube() {
  const conf = configNube();
  if (conf?.codigo) await pedir(await llavesDe(conf.codigo), 'borrar');
  cambiarAjuste('nube', null);
}

/** Deja de respaldar en este teléfono (lo de la nube queda) */
export const dejarDeRespaldar = () => cambiarAjuste('nube', null);

/** Activa el respaldo con un código nuevo (ya guardado por la persona) */
export function activarNube(codigo) {
  cambiarAjuste('nube', { codigo, ultimo: 0 });
  dispositivo();
}

/** Respalda solo si hay algo nuevo, hay internet y no hay nada pendiente de decidir */
export async function respaldarSiHaceFalta() {
  const c = configNube();
  if (!c?.codigo || c.conflicto || enCurso || navigator.onLine === false) return;
  if (ultimoCambio() <= (c.ultimo || 0)) return;
  if (Date.now() - (c.intento || 0) < (c.espera || 60000)) return;
  // Mientras se escanea, no: que la cámara no se trabe
  if (/^#\/(camara|recorte)/.test(location.hash)) return;
  try { await respaldarEnLaNube(); }
  catch (e) {
    // Lo que la persona tiene que resolver se avisa una vez (lo demás, como no tener internet, se reintenta solo)
    const avisar = { lleno: true, 'sin-espacio': true, 'otro-telefono': true, 'no-existe': true, grande: true };
    if (avisar[e.codigo] && c.avisado !== e.codigo) {
      guardarConfig({ avisado: e.codigo });
      aviso(`Respaldo en la nube: ${e.message} Míralo en Menú → Respaldo en la nube.`, 'error', 8000);
    }
  }
}

/** Respaldo automático: al abrir, al salir de la app, al volver internet y cada 5 minutos */
export function vigilarNube() {
  setTimeout(respaldarSiHaceFalta, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') respaldarSiHaceFalta(); });
  addEventListener('online', () => respaldarSiHaceFalta());
  setInterval(respaldarSiHaceFalta, 5 * 60000);
}
