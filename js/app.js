// ScanLibre · app.js
// Arranque: pantallas, navegación, avisos de la cola de fotos y modo sin conexión.

import { registrarVistas, iniciarRutas } from './rutas.js';
import { aviso } from './util.js';
import { eventosPaginas } from './paginas.js';
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
  // Cuando llega una versión nueva: en el inicio se recarga sola; en otra pantalla se avisa, para no cortar lo que se está haciendo
  const habiaVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!habiaVersion) return; // primera vez que se instala
    if (!location.hash || location.hash === '#/') location.reload();
    else aviso('Hay una versión nueva de ScanLibre: se usará la próxima vez que la abras.');
  });
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('Sin modo sin conexión:', e));
}
