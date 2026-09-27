// ScanLibre · fotos.js
// Pasar fotos entre Blob, bitmap, canvas e ImageData.

/** Abre una foto respetando su orientación (EXIF) */
export async function abrirFoto(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (e) {
    // Navegadores viejos: por medio de <img>
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const anchoDe = f => f.naturalWidth || f.videoWidth || f.width;
const altoDe = f => f.naturalHeight || f.videoHeight || f.height;

/** Dibuja la fuente (bitmap, <img>, <video>, canvas) en un canvas de lado máximo `maxLado` */
export function aCanvas(fuente, maxLado = Infinity) {
  const w = anchoDe(fuente), h = altoDe(fuente);
  const k = Math.min(1, maxLado / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fuente, 0, 0, c.width, c.height);
  return c;
}

/** Soltar la memoria de un canvas ya (Safari en iPhone tiene un tope bajo de memoria para canvas) */
export function soltarCanvas(c) {
  if (c && 'width' in c) { c.width = 0; c.height = 0; }
}

export function aImageData(fuente, maxLado = Infinity) {
  const c = aCanvas(fuente, maxLado);
  const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  soltarCanvas(c);
  return img;
}

export function canvasABlob(c, tipo = 'image/jpeg', calidad = 0.9) {
  return new Promise((resolver, rechazar) => c.toBlob(b => b ? resolver(b) : rechazar(new Error('No se pudo guardar la imagen')), tipo, calidad));
}

export async function imageDataABlob(imagen, tipo, calidad) {
  const c = document.createElement('canvas');
  c.width = imagen.width; c.height = imagen.height;
  c.getContext('2d').putImageData(imagen, 0, 0);
  try { return await canvasABlob(c, tipo, calidad); } finally { soltarCanvas(c); }
}

/**
 * Foto lista para guardar: orientada, sin pasar de `maxLado` y en JPEG.
 * Devuelve { blob, ancho, alto, canvas, anchoOriginal, altoOriginal }
 * (el canvas sirve para seguir trabajando sin volver a abrirla).
 */
export async function normalizarFoto(archivo, maxLado = 2800) {
  const bitmap = await abrirFoto(archivo);
  const anchoOriginal = anchoDe(bitmap), altoOriginal = altoDe(bitmap);
  const c = aCanvas(bitmap, maxLado);
  bitmap.close?.();
  const blob = await canvasABlob(c, 'image/jpeg', 0.92);
  return { blob, ancho: c.width, alto: c.height, canvas: c, anchoOriginal, altoOriginal };
}
