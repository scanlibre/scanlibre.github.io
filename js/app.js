// ScanLibre · app.js
// Arranque: pantallas, navegación, avisos de la cola de fotos y modo sin conexión.

import { registrarVistas, iniciarRutas } from './rutas.js';
import { aviso } from './util.js';
import { eventosPaginas, colaVacia } from './paginas.js';
import * as inicio from './vistas/inicio.js';
import * as camara from './vistas/camara.js';
import * as recorte from './vistas/recorte.js';
import * as documento from './vistas/documento.js';
import * as pagina from './vistas/pagina.js';

const vistas = { inicio, camara, recorte, documento, pagina };
for (const v of Object.values(vistas)) v.iniciar();
registrarVistas(vistas);

eventosPaginas.addEventListener('error', () => aviso('No se pudo procesar una de las fotos.', 'error'));

iniciarRutas();

// Modo sin conexión (el navegador solo lo permite en https o en la propia computadora)
const seguro = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && seguro) {
  // Cuando llega una versión nueva: en el inicio se recarga sola; si se está
  // en otra pantalla (la cámara, un recorte, un PDF armándose), se espera a
  // entrar al inicio o a un documento, con todas las fotos ya guardadas
  const habiaVersion = !!navigator.serviceWorker.controller;
  const enInicio = () => !location.hash || location.hash === '#/';
  let nueva = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!habiaVersion) return; // primera vez que se instala
    if (enInicio()) return location.reload();
    nueva = true;
    aviso('Hay una versión nueva de ScanLibre: se pondrá sola en cuanto termines.');
  });
  document.addEventListener('pantalla', e => {
    if (nueva && (e.detail === 'inicio' || e.detail === 'documento') && colaVacia()) location.reload();
  });
  navigator.serviceWorker.register('sw.js').then(registro => {
    // Una app instalada puede quedar abierta días: al volver a ella se busca si hay versión nueva
    document.addEventListener('visibilitychange', () => { if (!document.hidden) registro.update().catch(() => {}); });
  }).catch(e => console.warn('Sin modo sin conexión:', e));
}
