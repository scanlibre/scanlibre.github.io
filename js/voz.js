// ScanLibre · voz.js
// Leer el texto en voz alta con la voz del teléfono (en la mayoría funciona sin
// internet). Se lee de a frases: así "Pausa" y "Seguir" retoman en la misma
// frase (la pausa del navegador no anda bien en Android) y no se corta, como
// pasa en algunos navegadores con las lecturas largas.

export const puedeHablar = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

const MAX = 220, CORTA = 60;

/** Frases de hasta MAX letras, con dónde empieza y termina cada una en el texto */
export function frases(texto) {
  const trozos = [];
  const re = /[^.!?;:\n]+(?:[.!?;:]+|\n+|$)/g;
  for (let m; (m = re.exec(texto));) {
    if (!m[0]) { re.lastIndex++; continue; }
    if (!m[0].trim()) continue;
    let inicio = m.index;
    const fin = m.index + m[0].length;
    // Las frases muy largas se cortan en una coma o un espacio
    while (fin - inicio > MAX) {
      const pedazo = texto.slice(inicio, inicio + MAX);
      const corte = Math.max(pedazo.lastIndexOf(', '), pedazo.lastIndexOf(' '));
      const hasta = corte > MAX / 2 ? inicio + corte + 1 : inicio + MAX;
      trozos.push({ inicio, fin: hasta });
      inicio = hasta;
    }
    const ultima = trozos[trozos.length - 1];
    // Las muy cortas ("Artículo 122.") se juntan con la siguiente
    if (ultima && ultima.fin - ultima.inicio < CORTA && fin - ultima.inicio <= MAX) ultima.fin = fin;
    else trozos.push({ inicio, fin });
  }
  return trozos.map(t => ({ ...t, texto: texto.slice(t.inicio, t.fin).replace(/[—–]/g, ' ').replace(/\s+/g, ' ').trim() })).filter(t => t.texto);
}

/** La voz del teléfono que mejor calza con el idioma (si hay varias) */
function elegirVoz(ingles) {
  const voces = window.speechSynthesis.getVoices?.() || [];
  const preferidas = ingles ? ['en-US', 'en'] : ['es-HN', 'es-MX', 'es-US', 'es-419', 'es'];
  for (const p of preferidas) {
    const v = voces.find(v => (v.lang || '').replace('_', '-').startsWith(p));
    if (v) return v;
  }
  return null;
}

/**
 * Lector con pausa.
 * @param alCambiar ({ activo, i, total, frase, palabra, fin, error }) para pintar los botones y por dónde va:
 *   `frase` y `palabra` traen { inicio, fin } en el texto (la palabra, si el teléfono avisa por dónde va)
 */
export function crearLector({ alCambiar } = {}) {
  let lista = [], i = 0, activo = false, enPausa = false, turno = 0, ingles = false, velocidad = 1;
  let original = '', paraDecir = t => t;
  const sintesis = () => window.speechSynthesis;
  const avisar = x => alCambiar?.({ activo, i, total: lista.length, ...x });

  function decir() {
    const este = turno;
    if (!activo) return;
    if (i >= lista.length) { activo = false; enPausa = false; i = 0; return avisar({ fin: true }); }
    const frase = lista[i], dicho = paraDecir(frase.texto);
    const u = new SpeechSynthesisUtterance(dicho);
    u.lang = ingles ? 'en-US' : 'es-419';
    u.rate = velocidad;
    const voz = elegirVoz(ingles);
    if (voz) try { u.voice = voz; } catch (e) {}
    u.onend = () => { if (este === turno) { i++; decir(); } };
    u.onerror = e => {
      if (este !== turno || e.error === 'interrupted' || e.error === 'canceled') return;
      activo = false;
      avisar({ error: e.error || 'error' });
    };
    // La palabra que va diciendo: se busca en el texto, de adelante hacia atrás
    let desde = frase.inicio;
    u.onboundary = e => {
      if (este !== turno || (e.name && e.name !== 'word')) return;
      const palabra = (dicho.slice(e.charIndex).match(/^[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/u) || [])[0];
      if (!palabra) return;
      const k = original.indexOf(palabra, desde);
      if (k < 0 || k >= frase.fin) return;
      desde = k + palabra.length;
      avisar({ frase, palabra: { inicio: k, fin: k + palabra.length } });
    };
    avisar({ frase });
    sintesis().speak(u);
  }

  return {
    /**
     * @param decir   cómo se dice cada frase (por ejemplo, sin las viñetas); el resaltado sigue al texto original
     * @param desde   la frase por la que se empieza
     */
    empezar(texto, { enIngles = false, decir: arreglar = t => t, velocidad: v = velocidad, desde = 0 } = {}) {
      turno++; sintesis().cancel();
      original = texto; paraDecir = arreglar; velocidad = v;
      lista = frases(texto); i = Math.max(0, Math.min(desde, lista.length - 1)); activo = true; enPausa = false; ingles = enIngles;
      decir();
    },
    // Pausa: se corta y se recuerda la frase; "seguir" la empieza de nuevo
    pausar() { turno++; activo = false; enPausa = true; sintesis().cancel(); avisar({ pausado: true, frase: lista[i] }); },
    seguir() { turno++; activo = true; enPausa = false; decir(); },
    /** Salta a la frase k y la lee desde ahí */
    irA(k) {
      if (!lista.length) return;
      turno++; sintesis().cancel();
      i = Math.max(0, Math.min(k, lista.length - 1)); activo = true; enPausa = false;
      decir();
    },
    /** Otra velocidad (0,5 a 2): si está leyendo, sigue con la frase de nuevo a esa velocidad */
    cambiarVelocidad(v) {
      velocidad = v;
      if (activo) { turno++; sintesis().cancel(); decir(); }
    },
    detener() { turno++; activo = false; enPausa = false; i = 0; sintesis().cancel(); },
    get activo() { return activo; },
    get pausado() { return enPausa; },
    get frases() { return lista; },
    get velocidad() { return velocidad; }
  };
}
