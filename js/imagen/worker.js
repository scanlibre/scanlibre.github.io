// ScanLibre · imagen/worker.js
// Hace las cuentas pesadas fuera de la página para que la app no se trabe.

import { detectarHoja, procesarPagina, nitidezDeHoja, medirNitidez } from './procesar.js';

self.onmessage = e => {
  const { id, tipo, imagen, opciones } = e.data;
  if (tipo === 'hola') return self.postMessage({ hola: true });
  try {
    if (tipo === 'detectar') {
      self.postMessage({ id, resultado: detectarHoja(imagen) });
    } else if (tipo === 'procesar') {
      const r = procesarPagina(imagen, opciones);
      self.postMessage({ id, resultado: r }, [r.data.buffer]);
    } else if (tipo === 'nitidez') {
      self.postMessage({ id, resultado: opciones?.esquinas ? nitidezDeHoja(imagen, opciones.esquinas) : medirNitidez(imagen) });
    }
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
