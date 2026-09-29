// ScanLibre · motor.js
// Puente entre la página y los workers de imagen. Hay dos: uno para lo que
// va en vivo con la cámara (buscar la hoja, medir si está nítida), que tiene
// que contestar rápido, y otro para lo pesado (armar páginas). Así, mientras
// se arma una página, la cámara sigue marcando la hoja. Si el navegador no
// puede abrir un worker de módulo, las mismas funciones corren aquí mismo.

const workers = {};   // 'vivo' | 'pesado' → { worker, listo: Promise<{ lienzo, letras } | false> }
let siguiente = 1, directo = null;
const pendientes = new Map();

/** Abre el worker y espera su saludo; si no contesta, se trabaja sin él */
function abrirWorker(cual) {
  if (workers[cual]) return workers[cual].listo;
  const w = workers[cual] = { worker: null, listo: null };
  w.listo = new Promise(resolver => {
    try {
      w.worker = new Worker(new URL('./imagen/worker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      w.worker = null;
      return resolver(false);
    }
    const reloj = setTimeout(() => { w.worker.terminate(); w.worker = null; resolver(false); }, 8000);
    let saludo = false;
    w.worker.onerror = e => {
      e.preventDefault?.();
      clearTimeout(reloj);
      w.worker = null;
      if (!saludo) return resolver(false);
      // Se cayó trabajando (en un teléfono sin memoria puede pasar): lo pendiente no se
      // queda esperando para siempre, y el próximo pedido abre uno nuevo
      caido(cual, new Error('El trabajo de imagen se detuvo (¿poca memoria?)'));
    };
    w.worker.onmessage = e => {
      if (e.data.hola) { saludo = true; clearTimeout(reloj); resolver({ lienzo: !!e.data.lienzo, letras: !!e.data.letras }); return; }
      const p = pendientes.get(e.data.id);
      if (!p) return;
      pendientes.delete(e.data.id);
      if (e.data.error) p.rechazar(new Error(e.data.error)); else p.resolver(e.data.resultado);
    };
    w.worker.postMessage({ tipo: 'hola' });
  });
  return w.listo;
}

/** Rechaza lo que esperaba a un worker que se cayó y lo olvida (el próximo pedido abre otro) */
function caido(cual, error) {
  for (const [id, p] of pendientes) if (p.cual === cual) { pendientes.delete(id); clearTimeout(p.reloj); p.rechazar(error); }
  const w = workers[cual];
  delete workers[cual];
  try { w?.worker?.terminate(); } catch (e) {}
}

/**
 * ¿El worker puede abrir, achicar y guardar fotos él solo? (si no, se hace en la página).
 * `localStorage.scanlibre_fotos_en_pagina = '1'` obliga a hacerlo en la página (para probar ese camino).
 */
export async function fotosEnWorker() {
  try { if (localStorage.getItem('scanlibre_fotos_en_pagina') === '1') return false; } catch (e) {}
  const r = await abrirWorker('pesado');
  return !!(r && r.lienzo && workers.pesado.worker);
}

/** ¿El worker además puede escribir letras? (las notas y la marca de agua del PDF) */
export async function letrasEnWorker() {
  const r = (await fotosEnWorker()) && await abrirWorker('pesado');
  return !!(r && r.letras);
}

/** @param limite ms: si el worker no contesta en ese tiempo, se da por caído */
async function pedir(mensaje, transferir, cual = 'pesado', limite = 0) {
  if (!(await abrirWorker(cual)) || !workers[cual].worker) {
    directo = directo || await import('./imagen/procesar.js');
    if (mensaje.tipo === 'detectar') return directo.detectarHoja(mensaje.imagen);
    if (mensaje.tipo === 'nitidez') return mensaje.opciones?.esquinas ? directo.nitidezDeHoja(mensaje.imagen, mensaje.opciones.esquinas) : directo.medirNitidez(mensaje.imagen);
    if (mensaje.tipo === 'lectura') return directo.prepararParaLeer(mensaje.imagen);
    if (mensaje.tipo === 'luz') return directo.aplicarFiltro(mensaje.imagen, mensaje.opciones.filtro, mensaje.opciones);
    if (mensaje.tipo === 'libro') return directo.dividirLibro(mensaje.imagen, mensaje.opciones.esquinas);
    if (['foto', 'pagina', 'paginaPDF', 'paraLeer'].includes(mensaje.tipo)) throw new Error('Sin worker para fotos');
    return directo.procesarPagina(mensaje.imagen, mensaje.opciones);
  }
  const id = siguiente++;
  return new Promise((resolver, rechazar) => {
    const reloj = limite ? setTimeout(() => caido(cual, new Error('El trabajo de imagen tardó demasiado')), limite) : 0;
    pendientes.set(id, { resolver: r => { clearTimeout(reloj); resolver(r); }, rechazar: e => { clearTimeout(reloj); rechazar(e); }, cual, reloj });
    workers[cual].worker.postMessage({ id, ...mensaje }, transferir);
  });
}

/**
 * La foto lista en el worker (ver fotosEnWorker): orientada, sin pasar de
 * `maxLado`, en JPEG y con una vista chica (ImageBitmap) para mostrarla.
 * @param fuente el archivo (Blob) o el cuadro del video (ImageBitmap: se entrega al worker)
 * @returns { blob, ancho, alto, anchoOriginal, altoOriginal, vista, esquinas, borrosa, ms }
 */
export function fotoEnWorker(fuente, { maxLado, vista, hoja = true, nitidez = false } = {}) {
  const cuadro = typeof ImageBitmap !== 'undefined' && fuente instanceof ImageBitmap;
  return pedir({ tipo: 'foto', [cuadro ? 'bitmap' : 'blob']: fuente, maxLado, vista, hoja, nitidez }, cuadro ? [fuente] : undefined, 'pesado', 60000);
}

/**
 * Una página del PDF armada en el worker: achicada, con marcas y en JPEG
 * (o en blanco y negro de 1 bit comprimido).
 * @returns { tipo: 'jpeg', bytes } | { tipo: 'bits', bytes, ancho, alto }
 */
export const paginaPDFEnWorker = (blob, { maxLado, jpeg, bn = false, marcas = [], marcaDeAgua = '', portada = false }) =>
  pedir({ tipo: 'paginaPDF', blob, maxLado, jpeg, bn, marcas, marcaDeAgua, portada }, undefined, 'pesado', 60000);

/** La página lista para el lector de texto, armada en el worker desde su archivo (PNG) */
export const paraLeerEnWorker = blob => pedir({ tipo: 'paraLeer', blob }, undefined, 'pesado', 90000);

/**
 * La página armada en el worker desde el archivo de la foto.
 * @returns { procesada, miniatura, procAncho, procAlto, nitidez, aplanada, sinDedos }
 */
export const paginaEnWorker = (blob, opciones, { png = false } = {}) => pedir({ tipo: 'pagina', blob, opciones, png }, undefined, 'pesado', 90000);

/** Busca la hoja en una imagen chica (ImageData). Devuelve {esquinas, confianza} o null */
export function detectar(imagen) {
  return pedir({ tipo: 'detectar', imagen: { data: imagen.data, width: imagen.width, height: imagen.height } }, undefined, 'vivo');
}

/**
 * Endereza, filtra y gira. `imagen` (ImageData) se entrega al worker: no se puede volver a usar.
 * Devuelve { imagen: ImageData, nitidez, aplanada } (nitidez null si no se pudo medir;
 * aplanada: si se enderezaron renglones curvos).
 */
export async function procesar(imagen, opciones) {
  const r = await pedir(
    { tipo: 'procesar', imagen: { data: imagen.data, width: imagen.width, height: imagen.height }, opciones },
    [imagen.data.buffer]
  );
  return { imagen: new ImageData(new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.length), r.width, r.height), nitidez: r.nitidez, aplanada: r.aplanada, sinDedos: r.sinDedos };
}

/**
 * Nitidez de una imagen (ImageData). Con `esquinas`, de la hoja enderezada.
 * Devuelve { valor, borrosa }.
 */
export function nitidez(imagen, esquinas) {
  return pedir({ tipo: 'nitidez', imagen: { data: imagen.data, width: imagen.width, height: imagen.height }, opciones: esquinas ? { esquinas } : null }, undefined, 'vivo');
}

/**
 * La página lista para el lector de texto: en gris, pareja y con nitidez.
 * `imagen` (ImageData) se entrega al worker: no se puede volver a usar.
 */
export async function paraLeer(imagen) {
  const r = await pedir(
    { tipo: 'lectura', imagen: { data: imagen.data, width: imagen.width, height: imagen.height } },
    [imagen.data.buffer]
  );
  return new ImageData(new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.length), r.width, r.height);
}

/**
 * El filtro con el brillo y el contraste, para ver cómo queda mientras se
 * mueven las barras. `imagen` (ImageData) se entrega al worker.
 */
export async function luz(imagen, { filtro, brillo = 0, contraste = 0 }) {
  const r = await pedir(
    { tipo: 'luz', imagen: { data: imagen.data, width: imagen.width, height: imagen.height }, opciones: { filtro, brillo, contraste } },
    [imagen.data.buffer]
  );
  return new ImageData(new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.length), r.width, r.height);
}

/** Libro abierto: [esquinas de la izquierda, de la derecha] o null si no se encuentra el lomo */
export function dividirLibro(imagen, esquinas) {
  return pedir({ tipo: 'libro', imagen: { data: imagen.data, width: imagen.width, height: imagen.height }, opciones: { esquinas } }, [imagen.data.buffer]);
}
