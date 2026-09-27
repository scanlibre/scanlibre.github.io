// ScanLibre · imagen/procesar.js
// De la foto a la página lista: enderezar, filtrar y girar. Lo usa el worker
// (y la página misma si el navegador no tiene workers de módulo).

import { detectarHoja } from './deteccion.js';
import { enderezar, rotar90 } from './perspectiva.js';
import { aplicarFiltro } from './filtros.js';
import { tamanoEnderezado } from './geometria.js';
import { medirNitidez } from './nitidez.js';
import { prepararParaLeer } from './lectura.js';
import { aplanarPagina } from './aplanar.js';

export { detectarHoja, medirNitidez, prepararParaLeer };

/**
 * @param imagen   foto completa {data, width, height}
 * @param esquinas [tl, tr, br, bl] en fracciones (0..1) de la foto
 * @param maxLado  la página final no pasa de este tamaño (px)
 * @param aplanar  enderezar los renglones si la hoja está curva (libros)
 * @returns { data, width, height, nitidez, aplanada } (aplanada: si de verdad hizo falta enderezarla)
 */
export function procesarPagina(imagen, { esquinas, filtro = 'mejorada', rotacion = 0, maxLado = 3000, aplanar = true }) {
  const px = esquinas.map(p => ({ x: p.x * imagen.width, y: p.y * imagen.height }));
  const t = tamanoEnderezado(px, imagen.width, imagen.height);
  const k = Math.min(1, maxLado / Math.max(t.ancho, t.alto));
  const plana = enderezar(imagen, px, Math.max(1, Math.round(t.ancho * k)), Math.max(1, Math.round(t.alto * k)));
  // Se aplana ya girada: los renglones tienen que quedar acostados
  const girada = rotar90(plana, rotacion);
  const { imagen: lista, aplanada } = aplanar ? aplanarPagina(girada) : { imagen: girada, aplanada: false };
  const r = aplicarFiltro(lista, filtro);
  // La nitidez se mide en la hoja enderezada sin filtro: el B/N o un dibujo no la engañan
  return { data: r.data, width: r.width, height: r.height, nitidez: medirNitidez(plana).valor, aplanada };
}

/** Nitidez de la hoja (enderezada a poca resolución): para avisar si la foto salió borrosa */
export function nitidezDeHoja(imagen, esquinas) {
  const px = esquinas.map(p => ({ x: p.x * imagen.width, y: p.y * imagen.height }));
  const t = tamanoEnderezado(px, imagen.width, imagen.height);
  // A 800 px de ancho, como mide medirNitidez la página guardada
  const k = Math.min(1, 800 / t.ancho, 2400 / t.alto);
  return medirNitidez(enderezar(imagen, px, Math.max(8, Math.round(t.ancho * k)), Math.max(8, Math.round(t.alto * k))));
}
