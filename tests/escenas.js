// Fotos de prueba generadas: una hoja con "texto", vista en perspectiva sobre
// una mesa, con sombra, desenfoque y ruido de cámara. Se sabe dónde están las
// esquinas reales, así se mide qué tan bien las encuentra la detección.

import { deflateSync } from 'node:zlib';
import { homografia, aplicar } from '../js/imagen/geometria.js';

function azar(semilla) {
  let s = semilla >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; };
}

const FONDOS = {
  madera: (x, y, r) => { const v = 0.5 + 0.5 * Math.sin(x * 0.05 + Math.sin(y * 0.02) * 3); return [120 + 40 * v + r * 10, 80 + 25 * v + r * 8, 45 + 15 * v]; },
  oscuro: (x, y, r) => { const v = 50 + r * 25; return [v, v, v + 5]; },
  claro: (x, y, r) => { const v = 188 + r * 14 + 6 * Math.sin(x * 0.3); return [v, v - 2, v - 6]; },
  azul: (x, y, r) => [40 + r * 20, 90 + r * 20, 160 + r * 20],
  revuelto: (x, y, r) => { const c = ((x >> 4) + (y >> 4)) & 1; const v = c ? 70 : 150; return [v + r * 30, v - 10 + r * 30, v + 20]; },
  // El borde de la mesa se ve arriba: una recta larga y fuerte que no es la hoja
  mesaBorde: (x, y, r) => y < 120 + x * 0.1 ? [210 + r * 10, 205 + r * 10, 195] : [95 + r * 15, 60 + r * 10, 40]
};

/** Letras de una página: renglones de palabras hechas de letras separadas */
function tinta(u, v, contenido) {
  if (contenido === 'cuaderno') {
    // Renglones azules de lado a lado y el margen rojo
    if (Math.abs((v * 30) % 1 - 0.5) < 0.04 && v > 0.1) return [120, 160, 220];
    if (Math.abs(u - 0.12) < 0.0025) return [220, 90, 90];
    const renglon = Math.floor(v * 30), enRenglon = (v * 30) % 1;
    if (renglon % 3 === 1 && u > 0.14 && u < 0.85 && enRenglon > 0.15 && enRenglon < 0.45 && Math.sin(u * 230 + renglon) > 0.2) return [40, 45, 90];
    return null;
  }
  const renglon = Math.floor(v * 40), enRenglon = (v * 40) % 1;
  if (u < 0.1 || u > 0.9 || v < 0.08 || v > 0.92 || renglon % 6 === 5 || enRenglon < 0.35 || enRenglon > 0.7) return null;
  const palabra = Math.floor(u * 16 + renglon * 0.37) % 4 !== 0;
  const letra = (u * 90) % 1 < 0.7;
  return palabra && letra ? [40, 40, 60] : null;
}

/**
 * @param o.esquinas  [tl, tr, br, bl] en píxeles
 * @param o.fondo     nombre en FONDOS
 */
export function crearEscena({ ancho = 480, alto = 640, esquinas, fondo = 'madera', contenido = 'texto', papel = [238, 236, 230], sombra = 0.35, ruido = 6, semilla = 1 }) {
  const r = azar(semilla);
  const H = homografia(esquinas, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
  const data = new Uint8ClampedArray(ancho * alto * 4);
  const f = FONDOS[fondo];
  const sub = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    let acc = [0, 0, 0];
    const rf = r() - 0.5;
    for (const [sx, sy] of sub) {
      const { x: u, y: v } = aplicar(H, x + sx, y + sy);
      let c;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
        const luz = 1 - sombra * Math.max(0, 1 - (u + v) * 0.9); // sombra en la esquina de arriba a la izquierda
        c = (tinta(u, v, contenido) || papel).map(p => p * luz);
      } else {
        // El fondo se dibuja en coordenadas de una foto de 480×640: la escena es la misma a cualquier tamaño
        c = f((x + sx) * 480 / ancho, (y + sy) * 640 / alto, rf);
      }
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    }
    const i = (y * ancho + x) * 4;
    data[i] = acc[0] / 4; data[i + 1] = acc[1] / 4; data[i + 2] = acc[2] / 4; data[i + 3] = 255;
  }
  // Desenfoque leve (lente) y ruido del sensor
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    for (let c = 0; c < 3; c++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = Math.min(alto - 1, Math.max(0, y + dy)), xx = Math.min(ancho - 1, Math.max(0, x + dx));
        const peso = dx || dy ? 1 : 4;
        s += data[(yy * ancho + xx) * 4 + c] * peso; n += peso;
      }
      out[(y * ancho + x) * 4 + c] = s / n + (r() + r() + r() - 1.5) * ruido;
    }
    out[(y * ancho + x) * 4 + 3] = 255;
  }
  return { data: out, width: ancho, height: alto };
}

/** PNG sin pérdida a partir de RGBA (para fotos de prueba y para revisar resultados) */
export function aPNG({ data, width, height }) {
  const crc = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return buf => { let c = -1; for (const b of buf) c = t[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  })();
  const bloque = (tipo, contenido) => {
    const b = Buffer.alloc(12 + contenido.length);
    b.writeUInt32BE(contenido.length, 0);
    b.write(tipo, 4, 'ascii');
    contenido.copy(b, 8);
    b.writeUInt32BE(crc(b.subarray(4, 8 + contenido.length)), 8 + contenido.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const crudo = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    crudo[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(crudo, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloque('IHDR', ihdr), bloque('IDAT', deflateSync(crudo)), bloque('IEND', Buffer.alloc(0))
  ]);
}

/** Escenas variadas con sus esquinas reales */
export const ESCENAS = [
  { nombre: 'de frente sobre madera', fondo: 'madera', esquinas: [{ x: 70, y: 60 }, { x: 410, y: 70 }, { x: 405, y: 580 }, { x: 75, y: 570 }] },
  { nombre: 'en ángulo sobre mesa oscura', fondo: 'oscuro', esquinas: [{ x: 120, y: 90 }, { x: 380, y: 110 }, { x: 450, y: 600 }, { x: 30, y: 560 }] },
  { nombre: 'girada sobre fondo azul', fondo: 'azul', esquinas: [{ x: 180, y: 40 }, { x: 440, y: 200 }, { x: 290, y: 610 }, { x: 25, y: 430 }] },
  { nombre: 'poco contraste (mesa clara)', fondo: 'claro', sombra: 0.15, esquinas: [{ x: 60, y: 80 }, { x: 420, y: 60 }, { x: 440, y: 590 }, { x: 50, y: 600 }] },
  { nombre: 'fondo revuelto', fondo: 'revuelto', esquinas: [{ x: 90, y: 70 }, { x: 400, y: 95 }, { x: 420, y: 560 }, { x: 60, y: 580 }] },
  { nombre: 'hoja chica y lejos', fondo: 'madera', esquinas: [{ x: 150, y: 200 }, { x: 330, y: 190 }, { x: 345, y: 440 }, { x: 140, y: 450 }] },
  { nombre: 'cuaderno con renglones', fondo: 'oscuro', contenido: 'cuaderno', esquinas: [{ x: 80, y: 60 }, { x: 420, y: 85 }, { x: 400, y: 600 }, { x: 55, y: 575 }] },
  { nombre: 'con el borde de la mesa', fondo: 'mesaBorde', esquinas: [{ x: 110, y: 190 }, { x: 390, y: 200 }, { x: 430, y: 610 }, { x: 70, y: 600 }] }
];
