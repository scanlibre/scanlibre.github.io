// ScanLibre · rutas.js
// Navegación entre pantallas con el #hash, para que el botón "atrás" del
// teléfono funcione como se espera.
//   #/                     inicio
//   #/camara?doc=ID        cámara (agregando a un documento, si viene doc)
//   #/recorte              ajustar esquinas (solo tiene sentido viniendo de otra pantalla)
//   #/doc/ID               documento
//   #/doc/ID/pagina/N      página N del documento

import { aviso } from './util.js';

const vistas = {};
let actual = null;
let indice = 0; // cuántas pantallas avanzamos dentro de la app (para saber si "atrás" sale de ella)

export function registrarVistas(v) { Object.assign(vistas, v); }

function leerRuta() {
  const [camino, consulta] = location.hash.replace(/^#\/?/, '').split('?');
  const p = camino.split('/').filter(Boolean).map(decodeURIComponent);
  const params = Object.fromEntries(new URLSearchParams(consulta || ''));
  if (p[0] === 'camara') return ['camara', params];
  if (p[0] === 'recorte') return ['recorte', params];
  if (p[0] === 'doc' && p[1] && p[2] === 'pagina') return ['pagina', { doc: p[1], n: Math.max(1, parseInt(p[3], 10) || 1) }];
  if (p[0] === 'doc' && p[1]) return ['documento', { doc: p[1] }];
  return ['inicio', {}];
}

async function mostrar() {
  const [nombre, params] = leerRuta();
  const vista = vistas[nombre];
  if (actual && actual !== vista) actual.ocultar?.();
  for (const n of Object.keys(vistas)) document.getElementById('vista-' + n).hidden = n !== nombre;
  actual = vista;
  try {
    await vista.mostrar(params);
  } catch (e) {
    console.error(e);
    aviso('Algo salió mal: ' + e.message, 'error');
  }
}

export function ir(ruta, { reemplazar = false } = {}) {
  const hash = '#/' + ruta.replace(/^[#/]+/, '');
  if (reemplazar) history.replaceState({ i: indice }, '', hash);
  else history.pushState({ i: ++indice }, '', hash);
  mostrar();
}

/** Atrás dentro de la app (`pasos` pantallas); si se entró directo a esta pantalla, va a `respaldo` */
export function volver(respaldo = '', pasos = 1) {
  if (indice >= pasos) history.go(-pasos);
  else ir(respaldo, { reemplazar: true });
}

export function iniciarRutas() {
  indice = history.state?.i ?? 0;
  history.replaceState({ i: indice }, '', location.hash || '#/');
  window.addEventListener('popstate', e => { indice = e.state?.i ?? 0; mostrar(); });
  mostrar();
}
