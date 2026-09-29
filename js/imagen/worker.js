// ScanLibre · imagen/worker.js
// Hace las cuentas pesadas fuera de la página para que la app no se trabe.
// Si el navegador tiene OffscreenCanvas, aquí también se abre, se achica y se
// guarda la foto: la página solo recibe los archivos listos y una vista chica.

import { detectarHoja, procesarPagina, nitidezDeHoja, medirNitidez, prepararParaLeer, dividirLibro, aplicarFiltro } from './procesar.js';
import { dibujarMarcas, dibujarMarcaDeAgua } from '../marcas.js';
import { aBits } from '../pdf.js';

const TODA_LA_FOTO = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

// ¿Se puede dibujar aquí? (Chrome, Firefox y Safari 16.4 o más nuevos)
const hayLienzo = (() => {
  try { return typeof createImageBitmap === 'function' && !!new OffscreenCanvas(1, 1).getContext('2d') && 'convertToBlob' in OffscreenCanvas.prototype; }
  catch (e) { return false; }
})();

// ¿Se pueden escribir letras? (las notas y la marca de agua; algunos Safari no dibujan texto aquí)
const hayLetras = hayLienzo && (() => {
  try {
    const c = new OffscreenCanvas(40, 20), ctx = c.getContext('2d');
    ctx.font = '16px sans-serif';
    ctx.fillText('Hola', 2, 16);
    const d = ctx.getImageData(0, 0, 40, 20).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
    return false;
  } catch (e) { return false; }
})();

function lienzo(w, h) {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}
const soltar = c => { c.width = 0; c.height = 0; };
const medida = (w, h, maxLado) => {
  const k = Math.min(1, maxLado / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
};

/** Los píxeles de una imagen o un lienzo, sin pasar de `maxLado` */
function pixeles(fuente, maxLado = Infinity) {
  const [w, h] = medida(fuente.width, fuente.height, maxLado);
  const [c, ctx] = lienzo(w, h);
  ctx.drawImage(fuente, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  soltar(c);
  return img;
}

const abrir = blob => createImageBitmap(blob, { imageOrientation: 'from-image' });

/**
 * Una foto recién tomada (o de la galería): orientada, sin pasar de `maxLado`
 * y en JPEG, con una vista chica para mostrarla. Con `hoja` se buscan sus
 * esquinas y con `nitidez`, si salió borrosa. Puede llegar como archivo
 * (`blob`) o como el cuadro del video ya abierto (`bitmap`, en el iPhone).
 */
async function foto({ blob, bitmap, maxLado = 4000, vista = 2000, hoja = true, nitidez = false }) {
  const inicio = performance.now();
  const bmp = bitmap || await abrir(blob);
  const anchoOriginal = bmp.width, altoOriginal = bmp.height;
  const [w, h] = medida(bmp.width, bmp.height, maxLado);
  const [c, ctx] = lienzo(w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const salida = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  const [vw, vh] = medida(w, h, vista);
  const [cv, ctxv] = lienzo(vw, vh);
  ctxv.drawImage(c, 0, 0, vw, vh);
  const chica = cv.transferToImageBitmap();
  let esquinas = null, borrosa = false;
  if (hoja) {
    const r = detectarHoja(pixeles(c, 480));
    if (r && r.confianza >= 0.5) esquinas = r.esquinas;
  }
  if (nitidez) {
    try { borrosa = nitidezDeHoja(pixeles(c, 2400), esquinas || TODA_LA_FOTO).borrosa; } catch (e) { borrosa = false; }
  }
  soltar(c);
  return {
    resultado: { blob: salida, ancho: w, alto: h, anchoOriginal, altoOriginal, vista: chica, esquinas, borrosa, ms: Math.round(performance.now() - inicio) },
    transferir: [chica]
  };
}

/** La página armada desde el archivo de la foto: enderezada, filtrada, guardada y con su miniatura */
async function pagina({ blob, opciones, png = false }) {
  const bmp = await abrir(blob);
  const img = pixeles(bmp);
  bmp.close();
  const r = procesarPagina(img, opciones);
  const [c, ctx] = lienzo(r.width, r.height);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.length), r.width, r.height), 0, 0);
  // El blanco y negro se guarda en PNG: sin pérdida y liviano
  const procesada = await c.convertToBlob(png ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.9 });
  const [mw, mh] = medida(r.width, r.height, 360);
  const [cm, ctxm] = lienzo(mw, mh);
  ctxm.drawImage(c, 0, 0, mw, mh);
  soltar(c);
  const miniatura = await cm.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  soltar(cm);
  return { procesada, miniatura, procAncho: r.width, procAlto: r.height, nitidez: r.nitidez, aplanada: r.aplanada, sinDedos: r.sinDedos };
}

async function comprimir(bytes) {
  const flujo = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/**
 * Una página lista para el PDF: achicada a `maxLado`, con sus marcas y la
 * marca de agua, en JPEG, o en blanco y negro de 1 bit comprimido.
 */
async function paginaPDF({ blob, maxLado, jpeg, bn = false, marcas = [], marcaDeAgua = '', portada = false }) {
  const bmp = await abrir(blob);
  const [w, h] = medida(bmp.width, bmp.height, maxLado);
  const [c, ctx] = lienzo(w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  try {
    if (marcas.length) dibujarMarcas(ctx, marcas, w, h);
    if (marcaDeAgua) dibujarMarcaDeAgua(ctx, marcaDeAgua, w, h);
    if (bn && !marcas.length && !marcaDeAgua && typeof CompressionStream !== 'undefined') {
      const bytes = await comprimir(aBits(ctx.getImageData(0, 0, w, h)));
      return { resultado: { tipo: 'bits', bytes, ancho: w, alto: h }, transferir: [bytes.buffer] };
    }
    // Una portada es solo letras: siempre con buena calidad
    const archivo = await c.convertToBlob({ type: 'image/jpeg', quality: portada ? Math.max(jpeg, 0.9) : jpeg });
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    return { resultado: { tipo: 'jpeg', bytes }, transferir: [bytes.buffer] };
  } finally {
    soltar(c);
  }
}

/** La página lista para el lector de texto, desde su archivo: en gris, pareja y con nitidez, en PNG */
async function paraLeer({ blob }) {
  const bmp = await abrir(blob);
  const img = pixeles(bmp);
  bmp.close();
  const r = prepararParaLeer(img);
  const [c, ctx] = lienzo(r.width, r.height);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.length), r.width, r.height), 0, 0);
  try { return await c.convertToBlob({ type: 'image/png' }); } finally { soltar(c); }
}

self.onmessage = async e => {
  const { id, tipo, imagen, opciones } = e.data;
  if (tipo === 'hola') return self.postMessage({ hola: true, lienzo: hayLienzo, letras: hayLetras });
  try {
    if (tipo === 'foto') {
      const { resultado, transferir } = await foto(e.data);
      self.postMessage({ id, resultado }, transferir);
    } else if (tipo === 'pagina') {
      self.postMessage({ id, resultado: await pagina(e.data) });
    } else if (tipo === 'paginaPDF') {
      const { resultado, transferir } = await paginaPDF(e.data);
      self.postMessage({ id, resultado }, transferir);
    } else if (tipo === 'paraLeer') {
      self.postMessage({ id, resultado: await paraLeer(e.data) });
    } else if (tipo === 'detectar') {
      self.postMessage({ id, resultado: detectarHoja(imagen) });
    } else if (tipo === 'procesar') {
      const r = procesarPagina(imagen, opciones);
      self.postMessage({ id, resultado: r }, [r.data.buffer]);
    } else if (tipo === 'lectura') {
      const r = prepararParaLeer(imagen);
      self.postMessage({ id, resultado: r }, [r.data.buffer]);
    } else if (tipo === 'luz') {
      const r = aplicarFiltro(imagen, opciones.filtro, opciones);
      self.postMessage({ id, resultado: r }, [r.data.buffer]);
    } else if (tipo === 'libro') {
      self.postMessage({ id, resultado: dividirLibro(imagen, opciones.esquinas) });
    } else if (tipo === 'nitidez') {
      self.postMessage({ id, resultado: opciones?.esquinas ? nitidezDeHoja(imagen, opciones.esquinas) : medirNitidez(imagen) });
    }
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
