// ScanLibre · motor.js
// Puente entre la página y el worker de imagen. Si el navegador no puede
// abrir un worker de módulo, las mismas funciones corren aquí mismo.

let worker = null, listo = null, siguiente = 1, directo = null;
const pendientes = new Map();

/** Abre el worker y espera su saludo; si no contesta, se trabaja sin él */
function abrirWorker() {
  if (listo) return listo;
  listo = new Promise(resolver => {
    try {
      worker = new Worker(new URL('./imagen/worker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      worker = null;
      return resolver(false);
    }
    const reloj = setTimeout(() => { worker.terminate(); worker = null; resolver(false); }, 8000);
    worker.onerror = e => { e.preventDefault?.(); clearTimeout(reloj); worker = null; resolver(false); };
    worker.onmessage = e => {
      if (e.data.hola) { clearTimeout(reloj); resolver(true); return; }
      const p = pendientes.get(e.data.id);
      if (!p) return;
      pendientes.delete(e.data.id);
      if (e.data.error) p.rechazar(new Error(e.data.error)); else p.resolver(e.data.resultado);
    };
    worker.postMessage({ tipo: 'hola' });
  });
  return listo;
}

async function pedir(mensaje, transferir) {
  if (!(await abrirWorker()) || !worker) {
    directo = directo || await import('./imagen/procesar.js');
    if (mensaje.tipo === 'detectar') return directo.detectarHoja(mensaje.imagen);
    if (mensaje.tipo === 'nitidez') return mensaje.opciones?.esquinas ? directo.nitidezDeHoja(mensaje.imagen, mensaje.opciones.esquinas) : directo.medirNitidez(mensaje.imagen);
    if (mensaje.tipo === 'lectura') return directo.prepararParaLeer(mensaje.imagen);
    if (mensaje.tipo === 'luz') return directo.aplicarFiltro(mensaje.imagen, mensaje.opciones.filtro, mensaje.opciones);
    if (mensaje.tipo === 'libro') return directo.dividirLibro(mensaje.imagen, mensaje.opciones.esquinas);
    return directo.procesarPagina(mensaje.imagen, mensaje.opciones);
  }
  const id = siguiente++;
  return new Promise((resolver, rechazar) => {
    pendientes.set(id, { resolver, rechazar });
    worker.postMessage({ id, ...mensaje }, transferir);
  });
}

/** Busca la hoja en una imagen chica (ImageData). Devuelve {esquinas, confianza} o null */
export function detectar(imagen) {
  return pedir({ tipo: 'detectar', imagen: { data: imagen.data, width: imagen.width, height: imagen.height } });
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
  return pedir({ tipo: 'nitidez', imagen: { data: imagen.data, width: imagen.width, height: imagen.height }, opciones: esquinas ? { esquinas } : null });
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
