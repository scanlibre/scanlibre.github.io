// ScanLibre · sw.js
// Guarda la app en el teléfono para que funcione sin internet. Al publicar
// cambios se sube VERSION: el navegador baja la versión nueva y borra la vieja.

const VERSION = 'scanlibre-v3';
const ARCHIVOS = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'icons/icono.svg',
  'icons/icono-192.png',
  'icons/icono-512.png',
  'icons/icono-maskable-512.png',
  'icons/apple-touch-icon.png',
  'js/app.js',
  'js/ajustes.js',
  'js/archivos.js',
  'js/db.js',
  'js/exportar.js',
  'js/fotos.js',
  'js/motor.js',
  'js/paginas.js',
  'js/pdf.js',
  'js/respaldo.js',
  'js/rutas.js',
  'js/util.js',
  'js/imagen/deteccion.js',
  'js/imagen/filtros.js',
  'js/imagen/geometria.js',
  'js/imagen/perspectiva.js',
  'js/imagen/procesar.js',
  'js/imagen/worker.js',
  'js/vistas/camara.js',
  'js/vistas/documento.js',
  'js/vistas/inicio.js',
  'js/vistas/pagina.js',
  'js/vistas/recorte.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const pedido = e.request;
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== location.origin) return;
  if (pedido.mode === 'navigate') {
    // Cualquier pantalla de la app es index.html (las rutas van en el #)
    e.respondWith(caches.match('index.html').then(r => r || fetch(pedido)));
    return;
  }
  e.respondWith(caches.match(pedido, { ignoreSearch: true }).then(r => r || fetch(pedido)));
});
