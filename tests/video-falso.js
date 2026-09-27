// Video de cámara falso (formato Y4M) para probar la cámara en Chromium sin cámara real
import { writeFileSync } from 'node:fs';

/** Escribe `cuadros` imágenes RGBA ({data, width, height}) como un video Y4M */
export function escribirY4M(ruta, cuadros) {
  const { width: w, height: h } = cuadros[0];
  const partes = [Buffer.from(`YUV4MPEG2 W${w} H${h} F15:1 Ip A1:1 C420jpeg\n`)];
  for (const { data } of cuadros) {
    const Y = Buffer.alloc(w * h), U = Buffer.alloc((w / 2) * (h / 2)), V = Buffer.alloc((w / 2) * (h / 2));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      Y[y * w + x] = Math.max(0, Math.min(255, 0.299 * r + 0.587 * g + 0.114 * b));
      if (!(x & 1) && !(y & 1)) {
        const j = (y / 2) * (w / 2) + x / 2;
        U[j] = Math.max(0, Math.min(255, 128 - 0.168736 * r - 0.331264 * g + 0.5 * b));
        V[j] = Math.max(0, Math.min(255, 128 + 0.5 * r - 0.418688 * g - 0.081312 * b));
      }
    }
    partes.push(Buffer.from('FRAME\n'), Y, U, V);
  }
  writeFileSync(ruta, Buffer.concat(partes));
}
