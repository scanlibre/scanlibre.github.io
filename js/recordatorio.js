// ScanLibre · recordatorio.js
// Cuándo recordar que se haga un respaldo en archivo. Los documentos solo
// están en el teléfono: si se pierde o se daña sin un respaldo, se pierden.

const DIA = 864e5;
export const PRIMER_AVISO = 7 * DIA;   // sin ningún respaldo: a la semana del primer documento
export const CADA = 30 * DIA;          // con un respaldo: cada 30 días, si hubo cambios después
export const POSPONER = 7 * DIA;       // "Ahora no": una semana sin volver a decirlo

/**
 * @param docs      los documentos (fuera de la papelera), con creado y modificado
 * @param ultimo    cuándo se hizo el último respaldo (o null si nunca)
 * @param pospuesto cuándo se tocó "Ahora no" (o null)
 * @returns null si no hace falta recordar, o { nunca, dias }: si nunca hubo
 *          respaldo, y cuántos días lleva (desde el primer documento o desde el último respaldo)
 */
export function recordarRespaldo(docs, { ultimo = null, pospuesto = null, ahora = Date.now() } = {}) {
  if (!docs.length) return null;
  if (pospuesto && ahora - pospuesto < POSPONER) return null;
  if (ultimo) {
    const cambio = Math.max(...docs.map(d => d.modificado || d.creado || 0));
    if (cambio <= ultimo || ahora - ultimo < CADA) return null;
    return { nunca: false, dias: Math.floor((ahora - ultimo) / DIA) };
  }
  const primero = Math.min(...docs.map(d => d.creado || d.modificado || ahora));
  return ahora - primero >= PRIMER_AVISO ? { nunca: true, dias: Math.floor((ahora - primero) / DIA) } : null;
}
