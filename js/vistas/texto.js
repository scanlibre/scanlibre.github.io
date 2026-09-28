// ScanLibre · vistas/texto.js
// Hoja con el texto leído de una o varias páginas: elegir el idioma, revisar,
// copiar, compartir, escucharlo o llevarlo a Word. Lo leído se guarda con cada página.

import { el, icono, hoja, aviso, menu, nombreArchivo } from '../util.js';
import { puedeHablar, crearLector } from '../voz.js';
import { traducirTexto } from './traduccion.js';
import { puedeCompartir, compartir, descargar } from '../exportar.js';
import { textoDePagina } from '../paginas.js';
import { IDIOMAS, PRIMERA_DESCARGA } from '../ocr.js';
import { ajustes, cambiarAjuste } from '../ajustes.js';

export async function copiar(texto, area) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch (e) {
    area.select();
    document.execCommand('copy');
  }
  aviso('Texto copiado.', 'exito');
}

/** El texto de la hoja (quizás corregido a mano) separado otra vez por página */
function paginasDelTexto(texto, varias) {
  if (!varias) return [{ n: 1, texto }];
  const partes = texto.split(/^— Página (\d+) —$/m);
  const out = [];
  for (let i = 1; i < partes.length; i += 2) out.push({ n: Number(partes[i]), texto: partes[i + 1].trim() });
  return out.length ? out : [{ n: 1, texto }];
}

export async function aWord(nombre, paginas) {
  const { crearWord } = await import('../word.js');
  const blob = await crearWord(nombre, paginas);
  const archivo = nombreArchivo(nombre, 'docx');
  const opcion = puedeCompartir(blob, archivo)
    ? await menu([{ valor: 'compartir', texto: 'Abrir en Word, Drive o WhatsApp…', icono: 'compartir' }, { valor: 'descargar', texto: 'Descargar', icono: 'descargar' }], 'Documento de Word listo')
    : 'descargar';
  try {
    if (opcion === 'compartir') await compartir(blob, archivo);
    else if (opcion === 'descargar') { descargar(blob, archivo); aviso('Documento de Word descargado.', 'exito'); }
  } catch (e) {
    aviso('No se pudo compartir: ' + e.message, 'error');
  }
}

/** Lo que se dice de cada frase: sin las viñetas ni el color de lo resaltado */
const paraVoz = t => t.replace(/•\s*(\([a-z]+\)\s*)?/g, '').trim();
const VELOCIDADES = [[0.8, '0,8×'], [1, '1×'], [1.25, '1,25×'], [1.5, '1,5×']];

/**
 * @param paginas las páginas a leer, en orden
 * @param nombre  cómo se llama el documento (para el Word)
 * @param numeros el número de cada página en el documento (si no son todas)
 * @param extraer (pagina, ocr) → [{ texto, color }]: en vez de todo el texto, solo esas partes (lo resaltado)
 */
export function mostrarTexto(paginas, { titulo, nombre = titulo, numeros = null, extraer = null }) {
  let lector = null;
  const abierta = hoja(() => {
    let idioma = ajustes().ocrIdioma;
    let turno = 0; // si se cambia el idioma a mitad de la lectura, la lectura vieja no pinta nada
    const varias = paginas.length > 1 || !!extraer;
    let original = '', conColores = null; // para el Word con los colores de lo resaltado
    const estado = el('p', { class: 'hoja-detalle', 'aria-live': 'polite' });
    const barra = el('span');
    const progreso = el('div', { class: 'progreso' }, barra);
    const area = el('textarea', { class: 'campo texto-leido', rows: 12, 'aria-label': 'Texto leído', hidden: true, spellcheck: 'false' });
    const botonCopiar = el('button', { class: 'boton boton-primario', disabled: true, onclick: () => copiar(area.value, area) }, icono('copiar'), 'Copiar');
    const botonCompartir = navigator.share && el('button', { class: 'boton boton-secundario', disabled: true, onclick: async () => {
      try { await navigator.share({ title: titulo, text: area.value }); } catch (e) { if (e.name !== 'AbortError') aviso('No se pudo compartir.', 'error'); }
    } }, icono('compartir'), 'Compartir');
    // Escuchar: Escuchar → Pausa → Seguir…
    const etiqueta = el('span', { text: 'Escuchar' });
    // Mientras se escucha: el texto con la frase que va (y la palabra, si el teléfono avisa) resaltada.
    // Tocar una frase la lee desde ahí.
    const lectura = el('div', { class: 'texto-escucha', hidden: true });
    let actual = null;
    const armarLectura = () => {
      const t = area.value, nodos = [];
      let pos = 0;
      lector.frases.forEach((f, k) => {
        if (f.inicio > pos) nodos.push(document.createTextNode(t.slice(pos, f.inicio)));
        nodos.push(el('span', { class: 'frase', 'data-i': k, onclick: () => lector.irA(k) }, t.slice(f.inicio, f.fin)));
        pos = f.fin;
      });
      if (pos < t.length) nodos.push(document.createTextNode(t.slice(pos)));
      lectura.replaceChildren(...nodos);
      actual = null;
    };
    const resaltar = (k, frase, palabra) => {
      const span = lectura.querySelector(`[data-i="${k}"]`);
      if (!span) return;
      if (actual && actual !== span) { actual.classList.remove('actual'); actual.textContent = actual.textContent; }
      actual = span;
      span.classList.add('actual');
      const t = area.value;
      if (palabra) span.replaceChildren(t.slice(frase.inicio, palabra.inicio), el('mark', { text: t.slice(palabra.inicio, palabra.fin) }), t.slice(palabra.fin, frase.fin));
      else span.textContent = t.slice(frase.inicio, frase.fin);
      // Que se vea por dónde va
      const arriba = span.offsetTop, abajo = arriba + span.offsetHeight;
      if (arriba < lectura.scrollTop || abajo > lectura.scrollTop + lectura.clientHeight) lectura.scrollTop = Math.max(0, arriba - lectura.clientHeight / 3);
    };
    const escuchando = si => {
      lectura.hidden = !si; area.hidden = si;
      velocidades.hidden = !si; botonDetener.hidden = !si;
    };
    const velocidades = el('div', { class: 'idiomas velocidades', role: 'group', 'aria-label': 'Velocidad de la voz', hidden: true },
      VELOCIDADES.map(([v, texto]) => el('button', { class: 'filtro', 'data-velocidad': v, 'aria-pressed': String(Number(v) === (ajustes().vozVelocidad || 1)), onclick: e => {
        cambiarAjuste('vozVelocidad', Number(v));
        for (const b of velocidades.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        lector.cambiarVelocidad(Number(v));
      } }, texto)));
    const botonEscuchar = puedeHablar() && el('button', { class: 'boton boton-secundario', disabled: true, onclick: () => {
      if (lector.activo) lector.pausar();
      else if (lector.pausado) lector.seguir();
      else {
        lector.empezar(area.value, { enIngles: idioma === 'eng', decir: paraVoz, velocidad: ajustes().vozVelocidad || 1 });
        armarLectura();
        escuchando(true);
        if (lector.frases.length) resaltar(0, lector.frases[0]);
      }
    } }, icono('voz'), etiqueta);
    const botonDetener = el('button', { class: 'boton boton-fantasma', hidden: true, onclick: () => {
      lector.detener();
      etiqueta.textContent = 'Escuchar';
      botonEscuchar.setAttribute('aria-pressed', 'false');
      estado.textContent = '';
      escuchando(false);
    } }, 'Detener');
    if (botonEscuchar) lector = crearLector({ alCambiar: ({ activo, i, total, frase, palabra, fin, error }) => {
      etiqueta.textContent = activo ? 'Pausa' : lector.pausado ? 'Seguir' : 'Escuchar';
      botonEscuchar.setAttribute('aria-pressed', String(activo));
      if (frase) resaltar(i, frase, palabra);
      if (activo) estado.textContent = `Leyendo en voz alta: frase ${i + 1} de ${total}. Toca una frase para leer desde ahí.`;
      else if (fin) { estado.textContent = 'Listo: se leyó todo el texto.'; escuchando(false); }
      else if (error) { estado.textContent = 'Este teléfono no pudo leer en voz alta. Revisa que tenga instalada una voz en español (Ajustes → Texto a voz).'; escuchando(false); }
    } });
    const botonTraducir = el('button', { class: 'boton boton-secundario', disabled: true, onclick: () => {
      if (lector?.activo) lector.pausar();
      traducirTexto(area.value, { ingles: idioma === 'eng', nombre });
    } }, icono('traducir'), 'Traducir');
    const botonWord = el('button', { class: 'boton boton-secundario', disabled: true, onclick: () =>
      aWord(nombre, conColores && area.value === original ? conColores : paginasDelTexto(area.value, varias)) }, icono('word'), 'Word');
    const chips = Object.entries(IDIOMAS).map(([valor, texto]) => el('button', {
      class: 'filtro', 'aria-pressed': String(valor === idioma), onclick: () => {
        if (valor === idioma) return;
        idioma = valor;
        cambiarAjuste('ocrIdioma', valor);
        chips.forEach(c => c.setAttribute('aria-pressed', String(c === chipDe(valor))));
        leer();
      }
    }, texto));
    const chipDe = valor => chips[Object.keys(IDIOMAS).indexOf(valor)];

    async function leer() {
      const este = ++turno;
      area.hidden = true;
      lector?.detener();
      if (lector) { escuchando(false); area.hidden = true; }
      for (const b of [botonCopiar, botonCompartir, botonEscuchar, botonWord, botonTraducir]) if (b) b.disabled = true;
      progreso.hidden = false;
      barra.style.width = '0%';
      estado.textContent = 'Preparando el lector de texto…';
      const partes = [];
      try {
        for (let i = 0; i < paginas.length; i++) {
          const ocr = await textoDePagina(paginas[i], {
            idioma,
            alAvanzar: ({ etapa, progreso: x }) => {
              if (este !== turno) return;
              barra.style.width = `${Math.round(100 * (i + (etapa === 'leyendo' ? x : 0)) / paginas.length)}%`;
              if (etapa === 'preparando') estado.textContent = `Preparando el lector de texto… (la primera vez baja unos ${PRIMERA_DESCARGA[idioma]} MB)`;
              else estado.textContent = (varias ? `Leyendo la página ${i + 1} de ${paginas.length}… ` : 'Leyendo… ') + `${Math.round(x * 100)} %`;
            }
          });
          if (este !== turno) return;
          const n = numeros ? numeros[i] : i + 1;
          if (extraer) { const r = extraer(paginas[i], ocr); if (r.length) partes.push({ n, resaltados: r }); }
          else partes.push({ n, texto: ocr.texto });
        }
        progreso.hidden = true;
        if (extraer) {
          // Una parte por renglón; si se usaron varios colores, cada una dice el suyo
          const colores = new Set(partes.flatMap(p => p.resaltados.map(r => r.color)));
          for (const p of partes) p.texto = p.resaltados.map(r => `• ${colores.size > 1 ? `(${r.color}) ` : ''}${r.texto}`).join('\n');
          conColores = partes.map(({ n, resaltados }) => ({ n, resaltados }));
        }
        if (!partes.some(p => p.texto)) {
          estado.textContent = extraer ? 'No encontré texto bajo lo resaltado (¿es letra a mano?).' : varias ? 'No encontré texto en estas páginas.' : 'No encontré texto en esta página.';
          return;
        }
        area.value = original = varias ? partes.map(p => `— Página ${p.n} —\n${p.texto}`).join('\n\n') : partes[0].texto;
        area.hidden = false;
        for (const b of [botonCopiar, botonCompartir, botonEscuchar, botonWord, botonTraducir]) if (b) b.disabled = false;
        estado.textContent = extraer
          ? `${partes.reduce((s, p) => s + p.resaltados.length, 0)} partes resaltadas. Revísalas: la letra a mano y las fotos borrosas pueden leerse con errores.`
          : 'Revisa el texto antes de usarlo: la letra a mano y las fotos borrosas pueden leerse con errores.';
      } catch (e) {
        if (este !== turno) return;
        console.error(e);
        progreso.hidden = true;
        estado.textContent = 'No se pudo leer el texto: ' + (e.message || e);
      }
    }
    setTimeout(leer, 0);

    return [
      el('h2', { class: 'hoja-titulo', text: titulo }),
      el('div', { class: 'idiomas', role: 'group', 'aria-label': 'Idioma del texto' }, chips),
      estado, progreso, area, lectura, velocidades,
      el('div', { class: 'hoja-botones' }, botonEscuchar, botonDetener, botonWord),
      el('div', { class: 'hoja-botones' }, botonCompartir, botonTraducir, botonCopiar)
    ];
  });
  // Al cerrar la hoja se deja de leer en voz alta
  abierta.finally(() => lector?.detener());
  return abierta;
}
