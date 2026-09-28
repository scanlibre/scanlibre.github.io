// ScanLibre · vistas/texto.js
// Hoja con el texto leído de una o varias páginas: elegir el idioma, revisar,
// copiar, compartir, escucharlo o llevarlo a Word. Lo leído se guarda con cada página.

import { el, icono, hoja, aviso, menu, nombreArchivo } from '../util.js';
import { puedeHablar, crearLector } from '../voz.js';
import { puedeCompartir, compartir, descargar } from '../exportar.js';
import { textoDePagina } from '../paginas.js';
import { IDIOMAS, PRIMERA_DESCARGA } from '../ocr.js';
import { ajustes, cambiarAjuste } from '../ajustes.js';

async function copiar(texto, area) {
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

async function aWord(nombre, paginas) {
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

/**
 * @param paginas las páginas a leer, en orden
 * @param nombre  cómo se llama el documento (para el Word)
 */
export function mostrarTexto(paginas, { titulo, nombre = titulo }) {
  let lector = null;
  const abierta = hoja(() => {
    let idioma = ajustes().ocrIdioma;
    let turno = 0; // si se cambia el idioma a mitad de la lectura, la lectura vieja no pinta nada
    const varias = paginas.length > 1;
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
    const botonEscuchar = puedeHablar() && el('button', { class: 'boton boton-secundario', disabled: true, onclick: () => {
      if (lector.activo) lector.pausar();
      else if (lector.pausado) lector.seguir();
      else lector.empezar(area.value, { enIngles: idioma === 'eng' });
    } }, icono('voz'), etiqueta);
    if (botonEscuchar) lector = crearLector({ alCambiar: ({ activo, i, total, frase, fin, error }) => {
      etiqueta.textContent = activo ? 'Pausa' : lector.pausado ? 'Seguir' : 'Escuchar';
      botonEscuchar.setAttribute('aria-pressed', String(activo));
      // Que se vea por dónde va: se desliza el texto hasta la frase
      if (frase) area.scrollTop = Math.max(0, frase.inicio / Math.max(1, area.value.length) * area.scrollHeight - area.clientHeight / 3);
      if (activo) estado.textContent = `Leyendo en voz alta: frase ${i + 1} de ${total}.`;
      else if (fin) estado.textContent = 'Listo: se leyó todo el texto.';
      else if (error) estado.textContent = 'Este teléfono no pudo leer en voz alta. Revisa que tenga instalada una voz en español (Ajustes → Texto a voz).';
    } });
    const botonWord = el('button', { class: 'boton boton-secundario', disabled: true, onclick: () => aWord(nombre, paginasDelTexto(area.value, varias)) }, icono('word'), 'Word');
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
      for (const b of [botonCopiar, botonCompartir, botonEscuchar, botonWord]) if (b) b.disabled = true;
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
          partes.push({ n: i + 1, texto: ocr.texto });
        }
        progreso.hidden = true;
        if (!partes.some(p => p.texto)) {
          estado.textContent = varias ? 'No encontré texto en estas páginas.' : 'No encontré texto en esta página.';
          return;
        }
        area.value = varias ? partes.map(p => `— Página ${p.n} —\n${p.texto}`).join('\n\n') : partes[0].texto;
        area.hidden = false;
        for (const b of [botonCopiar, botonCompartir, botonEscuchar, botonWord]) if (b) b.disabled = false;
        estado.textContent = 'Revisa el texto antes de usarlo: la letra a mano y las fotos borrosas pueden leerse con errores.';
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
      estado, progreso, area,
      el('div', { class: 'hoja-botones' }, botonEscuchar, botonWord),
      el('div', { class: 'hoja-botones' }, botonCompartir, botonCopiar)
    ];
  });
  // Al cerrar la hoja se deja de leer en voz alta
  abierta.finally(() => lector?.detener());
  return abierta;
}
