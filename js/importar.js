// ScanLibre · importar.js
// Importar un PDF: cada página se dibuja como imagen con pdf.js (de Mozilla,
// incluido en vendor/pdfjs) y queda como una página más, que se puede marcar,
// firmar, filtrar o juntar con páginas escaneadas. Si el PDF trae el texto, se
// guarda con cada página y en su lugar: se puede buscar, copiar, escuchar y
// sale en el PDF con texto buscable, sin tener que leerlo con el lector (OCR).

const BASE = new URL('../vendor/pdfjs/', import.meta.url).href;
let libreria = null;

function cargar() {
  if (!libreria) {
    libreria = import(BASE + 'pdf.min.mjs')
      .then(m => { m.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.mjs'; return m; })
      .catch(e => {
        libreria = null;
        console.error(e);
        throw new Error('No se pudo cargar el lector de PDF. Revisa tu conexión la primera vez.');
      });
  }
  return libreria;
}

export const esPDF = archivo => archivo.type === 'application/pdf' || /\.pdf$/i.test(archivo.name || '');

/** El nombre del archivo sin ".pdf" (para el nombre del documento) */
export const nombreDelPDF = archivo => String(archivo.name || '').replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();

/**
 * Los renglones de una página a partir de los pedazos de texto del PDF.
 * @param trozos [{ str, x, y (la línea base), h (alto de la letra), w (ancho) }] en px de la imagen
 * @returns { texto, lineas } como las del lector de texto (ocr.js)
 */
export function renglonesDeTexto(trozos) {
  const lista = trozos.filter(p => p.str && p.str.trim() && p.h > 0 && p.w > 0).sort((a, b) => a.y - b.y || a.x - b.x);
  const grupos = [];
  for (const p of lista) {
    // En el mismo renglón: la línea base casi igual
    const g = grupos.find(g => Math.abs(g.y - p.y) < 0.45 * Math.min(g.h, p.h));
    if (g) { g.trozos.push(p); g.h = Math.max(g.h, p.h); } else grupos.push({ y: p.y, h: p.h, trozos: [p] });
  }
  grupos.sort((a, b) => a.y - b.y);
  const lineas = [];
  for (const g of grupos) {
    g.trozos.sort((a, b) => a.x - b.x);
    const palabras = [];
    let anterior = null;
    for (const p of g.trozos) {
      const ancho = p.w / p.str.length;
      for (const m of p.str.matchAll(/\S+/g)) {
        const x0 = p.x + m.index * ancho, x1 = x0 + m[0].length * ancho;
        const ultima = palabras[palabras.length - 1];
        // Un PDF corta a veces una palabra en dos pedazos: si van pegados, es una sola
        const pegada = ultima && m.index === 0 && !/\s$/.test(anterior?.str || ' ') && x0 - ultima.x1 < p.h * 0.2;
        if (pegada) { ultima.t += m[0]; ultima.x1 = x1; ultima.y0 = Math.min(ultima.y0, p.y - p.h * 0.8); }
        else palabras.push({ t: m[0], x0, y0: p.y - p.h * 0.8, x1, y1: p.y + p.h * 0.2 });
      }
      anterior = p;
    }
    if (!palabras.length) continue;
    lineas.push({
      y0: Math.min(...palabras.map(w => w.y0)), y1: Math.max(...palabras.map(w => w.y1)),
      base: [palabras[0].x0, g.y, palabras[palabras.length - 1].x1, g.y],
      palabras: palabras.map(w => ({ ...w, x0: Math.round(w.x0), y0: Math.round(w.y0), x1: Math.round(w.x1), y1: Math.round(w.y1) })),
      alto: g.h, y: g.y
    });
  }
  // Un espacio grande entre renglones es otro párrafo
  let texto = '';
  lineas.forEach((l, i) => {
    const t = l.palabras.map(w => w.t).join(' ');
    if (!i) texto = t;
    else texto += (l.y - lineas[i - 1].y > 1.7 * Math.max(l.alto, lineas[i - 1].alto) ? '\n\n' : '\n') + t;
  });
  return { texto, lineas: lineas.map(({ alto, y, ...l }) => l) };
}

/**
 * Abre el PDF.
 * @param pedirClave (incorrecta) => la contraseña, o null para no abrirlo
 * @returns { paginas, pagina(n) → { canvas, texto }, cerrar() }
 */
export async function abrirPDF(archivo, { pedirClave } = {}) {
  const pdfjs = await cargar();
  const tarea = pdfjs.getDocument({
    data: new Uint8Array(await archivo.arrayBuffer()),
    wasmUrl: BASE + 'wasm/',
    standardFontDataUrl: BASE + 'standard_fonts/',
    iccUrl: BASE + 'iccs/',
    enableXfa: false
  });
  let cancelado = false;
  tarea.onPassword = async (dar, motivo) => {
    const clave = await pedirClave?.(motivo === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    if (clave) dar(clave);
    else { cancelado = true; tarea.destroy(); }
  };
  let doc;
  try {
    doc = await tarea.promise;
  } catch (e) {
    if (cancelado) return null;
    if (e?.name === 'InvalidPDFException') throw new Error('El archivo no es un PDF válido o está dañado.');
    throw e;
  }
  return {
    paginas: doc.numPages,
    /** La página n dibujada (lado mayor de hasta `maxLado` px) y su texto */
    async pagina(n, maxLado = 2200) {
      const p = await doc.getPage(n);
      const uno = p.getViewport({ scale: 1 });
      const vista = p.getViewport({ scale: Math.min(5, maxLado / Math.max(uno.width, uno.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vista.width);
      canvas.height = Math.round(vista.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await p.render({ canvasContext: ctx, viewport: vista, background: '#ffffff' }).promise;
      const trozos = [];
      try {
        const { items } = await p.getTextContent();
        for (const it of items) {
          if (!it.str) continue;
          const t = pdfjs.Util.transform(vista.transform, it.transform);
          const h = Math.hypot(t[2], t[3]);
          if (Math.abs(t[1]) > 0.05 * h || Math.abs(t[2]) > 0.05 * h) continue; // texto girado: no
          trozos.push({ str: it.str, x: t[4], y: t[5], h, w: it.width * vista.scale });
        }
      } catch (e) { console.warn('Sin texto en la página', n, e); }
      p.cleanup();
      return { canvas, texto: renglonesDeTexto(trozos) };
    },
    cerrar: () => { try { tarea.destroy(); } catch (e) {} }
  };
}
