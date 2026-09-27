// ScanLibre · imagen/perspectiva.js
// Endereza la hoja: cada píxel de la hoja plana se busca en la foto con la
// homografía y se interpola entre sus 4 vecinos (bilineal).
// Las imágenes son {data: Uint8ClampedArray RGBA, width, height}.

import { homografia } from './geometria.js';

/** Recorta y endereza el cuadrilátero `esquinas` (en píxeles, ordenadas) a ancho×alto */
export function enderezar(img, esquinas, ancho, alto) {
  const { data: src, width: sw, height: sh } = img;
  const out = new Uint8ClampedArray(ancho * alto * 4);
  const H = homografia(
    [{ x: 0, y: 0 }, { x: ancho, y: 0 }, { x: ancho, y: alto }, { x: 0, y: alto }],
    esquinas
  );
  const maxX = sw - 1, maxY = sh - 1;
  let o = 0;
  for (let y = 0; y < alto; y++) {
    const yc = y + 0.5;
    // Numeradores y denominador son lineales en x: se avanzan sumando
    let nx = H[0] * 0.5 + H[1] * yc + H[2];
    let ny = H[3] * 0.5 + H[4] * yc + H[5];
    let d = H[6] * 0.5 + H[7] * yc + H[8];
    for (let x = 0; x < ancho; x++) {
      let fx = nx / d - 0.5, fy = ny / d - 0.5;
      if (fx < 0) fx = 0; else if (fx > maxX) fx = maxX;
      if (fy < 0) fy = 0; else if (fy > maxY) fy = maxY;
      const x0 = fx | 0, y0 = fy | 0;
      const x1 = x0 < maxX ? x0 + 1 : x0, y1 = y0 < maxY ? y0 + 1 : y0;
      const ax = fx - x0, ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
      out[o] = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
      out[o + 1] = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
      out[o + 2] = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
      out[o + 3] = 255;
      o += 4;
      nx += H[0]; ny += H[3]; d += H[6];
    }
  }
  return { data: out, width: ancho, height: alto };
}

/** Gira la imagen `veces` × 90° en sentido del reloj */
export function rotar90(img, veces) {
  const v = ((veces % 4) + 4) % 4;
  if (v === 0) return img;
  const { data: src, width: w, height: h } = img;
  const nw = v % 2 ? h : w, nh = v % 2 ? w : h;
  const out = new Uint8ClampedArray(nw * nh * 4);
  const s32 = new Uint32Array(src.buffer, src.byteOffset, w * h);
  const o32 = new Uint32Array(out.buffer);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx, ny;
      if (v === 1) { nx = h - 1 - y; ny = x; }
      else if (v === 2) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      o32[ny * nw + nx] = s32[y * w + x];
    }
  }
  return { data: out, width: nw, height: nh };
}
