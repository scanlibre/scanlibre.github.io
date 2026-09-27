// ScanLibre · imagen/procesar.js
// De la foto a la página lista: enderezar, filtrar y girar. Lo usa el worker
// (y la página misma si el navegador no tiene workers de módulo).

import { detectarHoja } from './deteccion.js';
import { enderezar, rotar90 } from './perspectiva.js';
import { aplicarFiltro } from './filtros.js';
import { tamanoEnderezado } from './geometria.js';

export { detectarHoja };

/**
 * @param imagen   foto completa {data, width, height}
 * @param esquinas [tl, tr, br, bl] en fracciones (0..1) de la foto
 * @param maxLado  la página final no pasa de este tamaño (px)
 */
export function procesarPagina(imagen, { esquinas, filtro = 'mejorada', rotacion = 0, maxLado = 3000 }) {
  const px = esquinas.map(p => ({ x: p.x * imagen.width, y: p.y * imagen.height }));
  const t = tamanoEnderezado(px, imagen.width, imagen.height);
  const k = Math.min(1, maxLado / Math.max(t.ancho, t.alto));
  const plana = enderezar(imagen, px, Math.max(1, Math.round(t.ancho * k)), Math.max(1, Math.round(t.alto * k)));
  return rotar90(aplicarFiltro(plana, filtro), rotacion);
}
