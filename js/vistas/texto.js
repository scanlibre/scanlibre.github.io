// ScanLibre · vistas/texto.js
// Hoja con el texto leído de una o varias páginas: elegir el idioma, revisar,
// copiar y compartir. Lo leído se guarda con cada página.

import { el, icono, hoja, aviso } from '../util.js';
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

/** @param paginas las páginas a leer, en orden */
export function mostrarTexto(paginas, { titulo }) {
  return hoja(() => {
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
      botonCopiar.disabled = true;
      if (botonCompartir) botonCompartir.disabled = true;
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
        botonCopiar.disabled = false;
        if (botonCompartir) botonCompartir.disabled = false;
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
      el('div', { class: 'hoja-botones' }, botonCompartir, botonCopiar)
    ];
  });
}
