// ScanLibre · traducir.js
// Traducir el texto leído entre español e inglés. Si el navegador trae su
// propio traductor (Chrome: el idioma se baja una vez y después traduce sin
// internet, dentro del teléfono), se usa ese. Si no, queda la opción de abrir
// Google Traductor, que sí manda el texto a internet (se avisa antes).

export const LENGUAS = { es: 'español', en: 'inglés' };

/**
 * ¿Se puede traducir dentro del teléfono de `de` a `a`?
 * @returns 'available' | 'downloadable' | 'downloading' (hay que bajar el idioma una vez) o null si no se puede
 */
export async function traductorDelTelefono(de, a) {
  const T = globalThis.Translator;
  if (!T?.availability || !T.create) return null;
  try {
    const d = await T.availability({ sourceLanguage: de, targetLanguage: a });
    return d && d !== 'unavailable' && d !== 'no' ? d : null;
  } catch (e) {
    return null;
  }
}

// Los encabezados "— Página 2 —" que separan las páginas no se traducen
const ENCABEZADO = /^— Página \d+ —$/;

/**
 * Traduce con el traductor del teléfono, párrafo por párrafo (así se ve el
 * avance y se conservan los renglones en blanco y los encabezados).
 * @param alAvanzar ({ etapa: 'bajando' | 'traduciendo', progreso: 0..1 })
 */
export async function traducir(texto, de, a, { alAvanzar } = {}) {
  const traductor = await globalThis.Translator.create({
    sourceLanguage: de, targetLanguage: a,
    monitor(m) { m.addEventListener?.('downloadprogress', e => alAvanzar?.({ etapa: 'bajando', progreso: e.loaded ?? 0 })); }
  });
  try {
    const partes = String(texto).split(/(\n[ \t]*\n+)/);
    const total = partes.filter(p => p.trim()).length || 1;
    let hechos = 0;
    const out = [];
    for (const p of partes) {
      if (!p.trim()) { out.push(p); continue; }
      // Dentro del párrafo, los encabezados de página se dejan como están
      const renglones = p.split('\n');
      const grupos = [];
      for (const r of renglones) {
        if (ENCABEZADO.test(r.trim())) grupos.push({ fijo: r });
        else if (grupos.length && !grupos[grupos.length - 1].fijo) grupos[grupos.length - 1].texto += '\n' + r;
        else grupos.push({ texto: r });
      }
      const hechas = [];
      for (const g of grupos) hechas.push(g.fijo ?? (g.texto.trim() ? await traductor.translate(g.texto) : g.texto));
      out.push(hechas.join('\n'));
      alAvanzar?.({ etapa: 'traduciendo', progreso: ++hechos / total });
    }
    return out.join('');
  } finally {
    traductor.destroy?.();
  }
}

/** Google Traductor con el texto (hasta unos 4800 caracteres caben en la dirección) */
export const MAX_ENLACE = 4800;
export function enlaceDeGoogle(texto, de, a) {
  const base = `https://translate.google.com/?sl=${de}&tl=${a}&op=translate`;
  return texto && texto.length <= MAX_ENLACE ? `${base}&text=${encodeURIComponent(texto)}` : base;
}
