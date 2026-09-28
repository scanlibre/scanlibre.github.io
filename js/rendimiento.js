// ScanLibre · rendimiento.js
// Qué tan grande trabajar según el teléfono. En uno de gama baja (poca
// memoria, o que ya se vio lento) la foto y la página se arman un poco más
// chicas: la letra se sigue leyendo bien, pesa casi la mitad y la cámara no
// se traba.

import { ajustes, cambiarAjuste } from './ajustes.js';

// Chrome dice la memoria redondeada hacia abajo (0,5 · 1 · 2 · 4 · 8 GB); los demás no la dicen
const memoria = typeof navigator !== 'undefined' ? navigator.deviceMemory || 0 : 0;

/** ¿Trabajar en liviano? `ajustes().liviano` manda si se fijó (true o false) */
export const gamaBaja = () => ajustes().liviano ?? (memoria > 0 && memoria <= 2);

/** Lado máximo de la foto que se guarda (la original, para volver a recortar) */
export const ladoFoto = () => gamaBaja() ? 3000 : 4000;
/** Lado máximo de la página enderezada */
export const ladoPagina = () => gamaBaja() ? 2400 : 3000;
/** Lado de la vista de la foto en el recorte (con la lupa se ve bien) */
export const ladoVista = () => gamaBaja() ? 1600 : 2000;
/** Cada cuánto se busca la hoja en el video (ms) */
export const pausaDeteccion = () => gamaBaja() ? 220 : 130;

/**
 * El video de la cámara. Si el teléfono entrega la foto completa aparte
 * (ImageCapture), el video es solo para mirar y buscar la hoja: basta 1080p.
 * Si no (iPhone), la foto es un cuadro del video: se pide 4K.
 */
export function videoIdeal(conFotoCompleta) {
  if (conFotoCompleta) return gamaBaja() ? { width: 1280, height: 720 } : { width: 1920, height: 1080 };
  return gamaBaja() ? { width: 1920, height: 1080 } : { width: 3840, height: 2160 };
}

/** Si preparar una foto tardó mucho, desde ahí este teléfono trabaja en liviano */
export function anotarDemora(ms) {
  if (ms > 3500 && ajustes().liviano == null) cambiarAjuste('liviano', true);
}
