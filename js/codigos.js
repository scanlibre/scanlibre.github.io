// ScanLibre · codigos.js
// Leer códigos QR (y de barras, si el teléfono sabe). Primero con el lector
// que trae el teléfono (BarcodeDetector: Chrome en Android, que también lee
// códigos de barras); si no hay, con jsQR (incluido en vendor/jsqr, licencia
// Apache 2.0), que lee QR. Todo en el teléfono, sin internet.

import { aImageData } from './fotos.js';

const BASE = new URL('../vendor/jsqr/', import.meta.url).href;
let nativo, cargando = null;

async function lectorNativo() {
  if (nativo !== undefined) return nativo;
  nativo = null;
  try {
    if ('BarcodeDetector' in window) {
      const formatos = await window.BarcodeDetector.getSupportedFormats();
      if (formatos.includes('qr_code')) nativo = new window.BarcodeDetector({ formats: formatos });
    }
  } catch (e) { nativo = null; }
  return nativo;
}

function cargarJsQR() {
  if (window.jsQR) return Promise.resolve();
  if (!cargando) {
    cargando = new Promise((resolver, rechazar) => {
      const s = document.createElement('script');
      s.src = BASE + 'jsQR.min.js';
      s.onload = resolver;
      s.onerror = () => { cargando = null; s.remove(); rechazar(new Error('No se pudo cargar el lector de códigos. Revisa tu conexión la primera vez.')); };
      document.head.append(s);
    });
  }
  return cargando;
}

/**
 * Los códigos que hay en una imagen (canvas, bitmap, imagen o video).
 * @param varios buscar más de uno (en una página puede haber varios)
 * @param lado   a qué tamaño mirar la imagen con jsQR (más chico: más rápido)
 * @returns [{ texto, formato }]
 */
export async function leerCodigos(fuente, { varios = false, lado = 1400 } = {}) {
  const d = await lectorNativo();
  if (d) {
    try {
      const r = await d.detect(fuente);
      return r.filter(c => c.rawValue).map(c => ({ texto: c.rawValue, formato: c.format }));
    } catch (e) { /* si falla el del teléfono, se prueba con jsQR */ }
  }
  await cargarJsQR();
  const img = aImageData(fuente, lado);
  const leer = (x, y, w, h) => {
    const recorte = x || y || w !== img.width || h !== img.height ? recortar(img, x, y, w, h) : img;
    const r = window.jsQR(recorte.data, recorte.width, recorte.height, { inversionAttempts: 'attemptBoth' });
    return r?.data ? r.data : null;
  };
  const vistos = new Set();
  const uno = leer(0, 0, img.width, img.height);
  if (uno) vistos.add(uno);
  if (varios || !uno) {
    // jsQR lee uno por vez: se busca también en cada cuarto (y en el centro) de la imagen
    const w = Math.round(img.width * 0.6), h = Math.round(img.height * 0.6);
    for (const [x, y] of [[0, 0], [img.width - w, 0], [0, img.height - h], [img.width - w, img.height - h], [(img.width - w) >> 1, (img.height - h) >> 1]]) {
      const t = leer(x, y, w, h);
      if (t) vistos.add(t);
      if (!varios && vistos.size) break;
    }
  }
  return [...vistos].map(texto => ({ texto, formato: 'qr_code' }));
}

function recortar({ data, width }, x, y, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let fila = 0; fila < h; fila++) out.set(data.subarray(((y + fila) * width + x) * 4, ((y + fila) * width + x + w) * 4), fila * w * 4);
  return { data: out, width: w, height: h };
}

/** En los campos de Wi-Fi y de contacto, "\;" es un punto y coma de verdad */
const desescapar = s => s.replace(/\\([\\;,:"])/g, '$1');
function campos(texto, separador) {
  const out = {};
  for (const parte of texto.split(new RegExp(`(?<!\\\\)${separador}`))) {
    const k = parte.indexOf(':');
    if (k > 0) out[parte.slice(0, k).toUpperCase()] = desescapar(parte.slice(k + 1));
  }
  return out;
}

/**
 * Qué es lo que dice el código.
 * @returns { tipo: 'enlace' | 'wifi' | 'correo' | 'telefono' | 'contacto' | 'texto', texto, url?, sitio?, red?, clave?, seguridad?, nombre?, telefono? }
 */
export function interpretar(texto) {
  const t = String(texto || '').trim();
  if (/^https?:\/\//i.test(t) || /^www\.\S+\.\S+$/i.test(t)) {
    const url = /^www\./i.test(t) ? `https://${t}` : t;
    let sitio = '';
    try { sitio = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return { tipo: 'texto', texto: t }; }
    return { tipo: 'enlace', texto: t, url, sitio, seguro: url.toLowerCase().startsWith('https:') };
  }
  if (/^WIFI:/i.test(t)) {
    const c = campos(t.slice(5).replace(/;;$/, ''), ';');
    return { tipo: 'wifi', texto: t, red: c.S || '', clave: c.P || '', seguridad: (c.T || '').toUpperCase() || 'nopass', oculta: c.H === 'true' };
  }
  if (/^mailto:/i.test(t)) return { tipo: 'correo', texto: t, url: t, correo: decodeURIComponent(t.slice(7).split('?')[0]) };
  if (/^MATMSG:/i.test(t)) { const c = campos(t.slice(7), ';'); return { tipo: 'correo', texto: t, url: `mailto:${c.TO || ''}`, correo: c.TO || '' }; }
  if (/^tel:/i.test(t)) return { tipo: 'telefono', texto: t, url: t, telefono: t.slice(4) };
  if (/^BEGIN:VCARD/i.test(t)) {
    const linea = k => (t.split(/\r?\n/).find(l => l.toUpperCase().startsWith(k)) || '').replace(/^[^:]*:/, '').trim();
    return { tipo: 'contacto', texto: t, nombre: desescapar(linea('FN') || linea('N').split(';').reverse().join(' ').trim()), telefono: linea('TEL'), correo: linea('EMAIL') };
  }
  if (/^MECARD:/i.test(t)) { const c = campos(t.slice(7), ';'); return { tipo: 'contacto', texto: t, nombre: (c.N || '').split(',').reverse().join(' ').trim(), telefono: c.TEL || '', correo: c.EMAIL || '' }; }
  return { tipo: 'texto', texto: t };
}
