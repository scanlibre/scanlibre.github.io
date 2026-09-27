// ScanLibre · ajustes.js
// Preferencias de este teléfono (se guardan en localStorage; si no se puede, valen los de fábrica).

const CLAVE = 'scanlibre_ajustes';
const FABRICA = {
  autoCaptura: false,     // tomar la foto sola cuando la hoja está quieta
  rafaga: false,          // varias fotos seguidas sin parar a revisar el recorte
  filtro: 'mejorada',     // filtro de las páginas nuevas
  pdfTamano: 'carta',
  pdfCalidad: 'normal',
  pdfTexto: false,        // PDF con el texto leído (se puede buscar y copiar)
  ocrIdioma: 'spa'
};

let actuales = null;

export function ajustes() {
  if (!actuales) {
    try { actuales = { ...FABRICA, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') }; }
    catch (e) { actuales = { ...FABRICA }; }
  }
  return actuales;
}

export function cambiarAjuste(nombre, valor) {
  ajustes()[nombre] = valor;
  try { localStorage.setItem(CLAVE, JSON.stringify(actuales)); } catch (e) {}
}
