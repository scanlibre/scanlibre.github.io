// ScanLibre · ajustes.js
// Preferencias de este teléfono (se guardan en localStorage; si no se puede, valen los de fábrica).

const CLAVE = 'scanlibre_ajustes';
const FABRICA = {
  autoCaptura: false,     // tomar la foto sola cuando la hoja está quieta
  rafaga: false,          // varias fotos seguidas sin parar a revisar el recorte
  libro: false,           // (de antes) libro abierto: ahora es el modo 'libro'
  modo: null,             // modo de la cámara: 'hoja', 'libro' (se separa en dos páginas), 'pizarra' o 'cedula'
  filtro: 'mejorada',     // filtro de las páginas nuevas
  pdfTamano: 'carta',
  pdfCalidad: 'normal',
  pdfTexto: false,        // PDF con el texto leído (se puede buscar y copiar)
  pdfPorHoja: 1,          // páginas en cada hoja del PDF (1, 2 o 4)
  pdfLimite: 2,           // con la calidad "Que pese menos de…": los MB
  marcaDeAgua: '',        // el último texto de marca de agua que se usó
  marcaConFecha: true,    // la marca de agua lleva la fecha de hoy
  ocrIdioma: 'spa',
  carpeta: null           // carpeta elegida en el inicio: lo que se escanea se guarda ahí
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

/** El modo de la cámara (los que usaban "Libro" antes de que hubiera modos siguen en libro) */
export const modoCamara = () => ajustes().modo || (ajustes().libro ? 'libro' : 'hoja');
