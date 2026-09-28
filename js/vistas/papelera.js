// ScanLibre · vistas/papelera.js
// Lo que se borró queda aquí 30 días: se puede recuperar (vuelve a su lugar)
// o borrar para siempre. Pasado ese tiempo se borra solo.

import { el, icono, hoja, aviso, confirmar, paginasTexto } from '../util.js';
import { listarPapelera, recuperarDocumento, recuperarPagina, borrarDocumento, borrarPaginaDePapelera, vaciarPapelera, obtenerPagina, DIAS_PAPELERA } from '../db.js';

const quedan = cuando => Math.max(0, Math.ceil((cuando + DIAS_PAPELERA * 86400000 - Date.now()) / 86400000));
const cuantoQueda = cuando => { const d = quedan(cuando); return d <= 1 ? 'se borra mañana' : `se borra en ${d} días`; };

/** Cuántas cosas hay en la papelera */
export async function enPapelera() {
  const { documentos, paginas } = await listarPapelera();
  return documentos.length + paginas.length;
}

/** @param alCambiar se llama cuando algo se recupera o se borra (para volver a pintar el inicio) */
export function mostrarPapelera(alCambiar) {
  let urls = [];
  const soltar = () => { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; };
  const abierta = hoja(() => {
    const lista = el('div', { class: 'papelera' });
    const vaciar = el('button', { class: 'boton boton-secundario peligro-texto', hidden: true, onclick: async () => {
      if (!await confirmar('¿Vaciar la papelera?', { detalle: 'Todo lo que hay en ella se borra de este teléfono. No se puede deshacer.', aceptar: 'Vaciar', peligro: true })) return;
      await vaciarPapelera({ todo: true });
      aviso('La papelera quedó vacía.');
      alCambiar?.();
      pintar();
    } }, icono('basura'), 'Vaciar papelera');

    const fila = ({ miniatura, titulo, detalle, recuperar, borrar, etiqueta }) => {
      let img = el('span', { class: 'doc-miniatura' });
      if (miniatura) { const u = URL.createObjectURL(miniatura); urls.push(u); img = el('img', { class: 'doc-miniatura', src: u, alt: '' }); }
      return el('div', { class: 'papelera-fila' }, img,
        el('div', { class: 'doc-texto' }, el('div', { class: 'doc-nombre', text: titulo }), el('div', { class: 'doc-detalle', text: detalle })),
        el('button', { class: 'boton-icono papelera-recuperar', 'aria-label': `Recuperar ${etiqueta}`, title: 'Recuperar', onclick: async () => { await recuperar(); alCambiar?.(); pintar(); } }, icono('restaurar')),
        el('button', { class: 'boton-icono papelera-borrar', 'aria-label': `Borrar para siempre ${etiqueta}`, title: 'Borrar para siempre', onclick: async () => {
          if (!await confirmar('¿Borrar para siempre?', { detalle: 'Se borra de este teléfono. No se puede deshacer.', aceptar: 'Borrar', peligro: true })) return;
          await borrar();
          alCambiar?.();
          pintar();
        } }, icono('basura')));
    };

    async function pintar() {
      soltar();
      const { documentos, paginas } = await listarPapelera();
      const filas = [];
      for (const d of documentos) {
        const primera = d.paginas.length ? await obtenerPagina(d.paginas[0]) : null;
        filas.push(fila({
          miniatura: primera?.miniatura, titulo: d.nombre, etiqueta: `el documento ${d.nombre}`,
          detalle: `Documento · ${paginasTexto(d.paginas.length)} · ${cuantoQueda(d.papelera)}`,
          recuperar: async () => { await recuperarDocumento(d.id); aviso(`Se recuperó «${d.nombre}».`, 'exito'); },
          borrar: () => borrarDocumento(d.id)
        }));
      }
      for (const p of paginas) {
        filas.push(fila({
          miniatura: p.miniatura, titulo: `Página de «${p.documento.nombre}»`, etiqueta: `la página de ${p.documento.nombre}`,
          detalle: `Era la página ${p.papelera.lugar + 1} · ${cuantoQueda(p.papelera.cuando)}`,
          recuperar: async () => { await recuperarPagina(p.id); aviso(`La página volvió a «${p.documento.nombre}».`, 'exito'); },
          borrar: () => borrarPaginaDePapelera(p.id)
        }));
      }
      lista.replaceChildren(...(filas.length ? filas : [el('p', { class: 'carpeta-vacia', text: `La papelera está vacía. Lo que elimines queda aquí ${DIAS_PAPELERA} días, por si te arrepientes.` })]));
      vaciar.hidden = !filas.length;
    }
    pintar();
    return [
      el('h2', { class: 'hoja-titulo', text: 'Papelera' }),
      el('p', { class: 'hoja-detalle', text: `Lo que eliminas queda aquí ${DIAS_PAPELERA} días y después se borra solo.` }),
      lista,
      el('div', { class: 'hoja-botones' }, vaciar)
    ];
  });
  abierta.finally(soltar);
  return abierta;
}
