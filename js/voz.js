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
 * @param alCambiar ({ activo, i, total, frase, fin, error }) para pintar los botones y en qué frase va
 */
export function crearLector({ alCambiar } = {}) {
  let lista = [], i = 0, activo = false, enPausa = false, turno = 0, ingles = false;
  const sintesis = () => window.speechSynthesis;
  const avisar = x => alCambiar?.({ activo, i, total: lista.length, ...x });

  function decir() {
    const este = turno;
    if (!activo) return;
    if (i >= lista.length) { activo = false; enPausa = false; i = 0; return avisar({ fin: true }); }
    const u = new SpeechSynthesisUtterance(lista[i].texto);
    u.lang = ingles ? 'en-US' : 'es-419';
    const voz = elegirVoz(ingles);
    if (voz) try { u.voice = voz; } catch (e) {}
    u.onend = () => { if (este === turno) { i++; decir(); } };
    u.onerror = e => {
      if (este !== turno || e.error === 'interrupted' || e.error === 'canceled') return;
      activo = false;
      avisar({ error: e.error || 'error' });
    };
    avisar({ frase: lista[i] });
    sintesis().speak(u);
  }

  return {
    empezar(texto, { enIngles = false } = {}) {
      turno++; sintesis().cancel();
      lista = frases(texto); i = 0; activo = true; enPausa = false; ingles = enIngles;
      decir();
    },
    // Pausa: se corta y se recuerda la frase; "seguir" la empieza de nuevo
    pausar() { turno++; activo = false; enPausa = true; sintesis().cancel(); avisar({ pausado: true }); },
    seguir() { turno++; activo = true; enPausa = false; decir(); },
    detener() { turno++; activo = false; enPausa = false; i = 0; sintesis().cancel(); },
    get activo() { return activo; },
    get pausado() { return enPausa; }
  };
}
