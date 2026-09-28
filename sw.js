// ScanLibre · sw.js
// Guarda la app en el teléfono para que funcione sin internet. Al publicar
// cambios se sube VERSION (y el número de js/version.js): el navegador baja la
// versión nueva y borra la vieja.

const VERSION = 'scanlibre-v30';
// El lector de texto (unos 6 MB) no se baja al instalar: se guarda la primera vez
// que se usa, en su propio caché, que no se borra al publicar versiones de la app
const LECTOR = 'scanlibre-lector-v1';
// Lo mismo con el lector de PDF (pdf.js, unos 2 MB): se guarda al importar el primer PDF
const PDFJS = 'scanlibre-pdfjs-v1';
// En cambio, el lector de QR (jsQR, 130 KB) es chico y va con la app desde el principio
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
  'js/buscar.js',
  'js/codigos.js',
  'js/cedula.js',
  'js/cifrado.js',
  'js/db.js',
  'js/exportar.js',
  'js/fotos.js',
  'js/importar.js',
  'js/marcas.js',
  'js/motor.js',
  'js/paginas.js',
  'js/portada.js',
  'js/pdf.js',
  'js/rendimiento.js',
  'js/respaldo.js',
  'js/traducir.js',
  'js/llaves.js',
  'js/nube.js',
  'js/rutas.js',
  'js/ocr.js',
  'js/util.js',
  'js/version.js',
  'js/voz.js',
  'js/word.js',
  'js/imagen/aplanar.js',
  'js/imagen/dedos.js',
  'js/imagen/deteccion.js',
  'js/imagen/filtros.js',
  'js/imagen/geometria.js',
  'js/imagen/lectura.js',
  'js/imagen/libro.js',
  'js/imagen/movimiento.js',
  'js/imagen/nitidez.js',
  'js/imagen/perspectiva.js',
  'js/imagen/procesar.js',
  'js/imagen/repetidas.js',
  'js/imagen/worker.js',
  'js/vistas/camara.js',
  'js/vistas/codigo.js',
  'js/vistas/documento.js',
  'js/vistas/inicio.js',
  'js/vistas/marcar.js',
  'js/vistas/nube.js',
  'js/vistas/pagina.js',
  'js/vistas/papelera.js',
  'js/vistas/portada.js',
  'js/vistas/recorte.js',
  'js/vistas/texto.js',
  'js/vistas/traduccion.js',
  'vendor/jsqr/jsQR.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k !== VERSION && k !== LECTOR && k !== PDFJS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const pedido = e.request;
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== location.origin) return;
  const camino = new URL(pedido.url).pathname;
  const aparte = camino.includes('/vendor/tesseract/') ? LECTOR : camino.includes('/vendor/pdfjs/') ? PDFJS : null;
  if (aparte) {
    e.respondWith(caches.open(aparte).then(async c => {
      const guardada = await c.match(pedido);
      if (guardada) return guardada;
      const r = await fetch(pedido);
      if (r.ok) c.put(pedido, r.clone());
      return r;
    }));
    return;
  }
  if (pedido.mode === 'navigate') {
    // Cualquier pantalla de la app es index.html (las rutas van en el #); otras
    // páginas del sitio (como privacidad.html) se piden a la red
    if (camino.endsWith('/') || camino.endsWith('/index.html')) e.respondWith(caches.match('index.html').then(r => r || fetch(pedido)));
    else e.respondWith(fetch(pedido).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(pedido, { ignoreSearch: true }).then(r => r || fetch(pedido)));
});
