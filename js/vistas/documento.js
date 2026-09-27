// ScanLibre · vistas/documento.js
// Las páginas de un documento, agregar más, renombrar y crear el PDF.

import { $, el, icono, aviso, confirmar, pedirTexto, menu, hoja, paginasTexto, fechaCorta, tamanoLegible, nombreArchivo } from '../util.js';
import { obtenerDocumento, guardarDocumento, paginasDe, borrarDocumento } from '../db.js';
import { ir, volver } from '../rutas.js';
import { eventosPaginas, pendientesEnCola, importarArchivos } from '../paginas.js';
import { nuevaSesion } from './camara.js';
import { elegirArchivos } from '../archivos.js';
import { ajustes, cambiarAjuste } from '../ajustes.js';
import { CALIDADES, TAMANOS_HOJA, generarPDF, puedeCompartir, compartir, descargar } from '../exportar.js';

let docId = null;
let urls = [];
const soltarUrls = () => { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; };
const ruta = (...partes) => ['doc', encodeURIComponent(docId), ...partes].join('/');

export async function mostrar({ doc }) {
  docId = doc;
  eventosPaginas.addEventListener('cambio', alCambiar);
  await pintar();
}

export function ocultar() {
  eventosPaginas.removeEventListener('cambio', alCambiar);
  soltarUrls();
}

function alCambiar(e) {
  if (e.detail.docId === docId) pintar();
}

async function pintar() {
  const doc = await obtenerDocumento(docId);
  if (!doc) {
    aviso('Ese documento ya no existe.');
    return ir('', { reemplazar: true });
  }
  const paginas = await paginasDe(doc);
  const pendientes = pendientesEnCola(docId);
  soltarUrls();
  $('#doc-nombre').textContent = doc.nombre;
  document.title = doc.nombre + ' · ScanLibre';
  const items = paginas.map((p, i) => {
    const u = URL.createObjectURL(p.miniatura);
    urls.push(u);
    return el('li', {},
      el('button', { class: 'miniatura', 'aria-label': `Página ${i + 1}`, onclick: () => ir(ruta('pagina', i + 1)) },
        el('img', { src: u, alt: '' }),
        el('span', { class: 'miniatura-numero', text: String(i + 1) })));
  });
  for (let i = 0; i < pendientes; i++) {
    items.push(el('li', {}, el('div', { class: 'miniatura miniatura-pendiente', role: 'img', 'aria-label': 'Procesando foto' }, el('span', { class: 'giro' }))));
  }
  items.push(el('li', {},
    el('button', { class: 'miniatura miniatura-agregar', onclick: agregar }, icono('mas'), 'Agregar página')));
  $('#doc-paginas').replaceChildren(...items);
  let estado = `${paginasTexto(paginas.length)} · ${fechaCorta(doc.modificado)}`;
  if (pendientes) estado += ` · procesando ${pendientes === 1 ? '1 foto' : pendientes + ' fotos'}…`;
  $('#doc-estado').textContent = estado;
  $('#doc-pdf').disabled = paginas.length === 0 || pendientes > 0;
}

async function agregar() {
  const opcion = await menu([
    { valor: 'camara', texto: 'Con la cámara', icono: 'camara' },
    { valor: 'galeria', texto: 'Fotos de la galería', icono: 'galeria' }
  ], 'Agregar páginas');
  if (opcion === 'camara') {
    nuevaSesion(docId, 'doc');
    ir('camara?doc=' + encodeURIComponent(docId));
  } else if (opcion === 'galeria') {
    const archivos = await elegirArchivos('entrada-fotos');
    if (archivos.length) importarArchivos(docId, archivos);
  }
}

async function renombrar() {
  const doc = await obtenerDocumento(docId);
  const nombre = await pedirTexto('Nombre del documento', doc.nombre);
  if (!nombre || nombre === doc.nombre) return;
  doc.nombre = nombre;
  doc.modificado = Date.now();
  await guardarDocumento(doc);
  pintar();
}

async function masOpciones() {
  const opcion = await menu([
    { valor: 'renombrar', texto: 'Cambiar el nombre', icono: 'editar' },
    { valor: 'borrar', texto: 'Eliminar el documento', icono: 'basura', peligro: true }
  ]);
  if (opcion === 'renombrar') return renombrar();
  if (opcion === 'borrar') {
    const doc = await obtenerDocumento(docId);
    const si = await confirmar('¿Eliminar este documento?', { detalle: `"${doc.nombre}" y sus ${paginasTexto(doc.paginas.length)} se borran de este teléfono. No se puede deshacer.`, aceptar: 'Eliminar', peligro: true });
    if (!si) return;
    await borrarDocumento(docId);
    aviso('Documento eliminado.');
    volver('');
  }
}

/** Hoja para elegir tamaño y calidad, crear el PDF y compartirlo */
async function crearPDF() {
  const doc = await obtenerDocumento(docId);
  const paginas = await paginasDe(doc);
  if (!paginas.length) return;
  const eleccion = { tamano: ajustes().pdfTamano, calidad: ajustes().pdfCalidad };

  await hoja(cerrar => {
    const grupo = (titulo, clave, valores, fila) => {
      const botones = Object.entries(valores).map(([valor, v]) => {
        const b = el('button', { class: 'opcion', 'aria-pressed': String(eleccion[clave] === valor), onclick: () => {
          eleccion[clave] = valor;
          botones.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        } },
          el('strong', { text: typeof v === 'string' ? v : v.texto }),
          typeof v !== 'string' && el('small', { text: v.detalle }));
        return b;
      });
      return el('div', { class: 'grupo' }, el('h3', { class: 'grupo-titulo', text: titulo }), el('div', { class: 'opciones' + (fila ? ' opciones-fila' : '') }, botones));
    };
    const barra = el('span');
    const progreso = el('div', { class: 'progreso', hidden: true }, barra);
    const resultado = el('div');
    const crear = el('button', { class: 'boton boton-primario', onclick: async () => {
      crear.disabled = true;
      progreso.hidden = false;
      cambiarAjuste('pdfTamano', eleccion.tamano);
      cambiarAjuste('pdfCalidad', eleccion.calidad);
      try {
        const blob = await generarPDF(doc, paginas, eleccion, (hechas, total) => { barra.style.width = `${Math.round(100 * hechas / total)}%`; });
        const nombre = nombreArchivo(doc.nombre, 'pdf');
        progreso.hidden = true;
        crear.hidden = true;
        opciones.hidden = true;
        resultado.replaceChildren(
          el('div', { class: 'resultado-pdf' }, icono('pdf'),
            el('div', {}, el('strong', { text: nombre }), el('small', { text: `${paginasTexto(paginas.length)} · ${tamanoLegible(blob.size)}` }))),
          el('div', { class: 'hoja-botones' },
            el('button', { class: 'boton boton-secundario', onclick: () => { descargar(blob, nombre); aviso('PDF descargado.', 'exito'); } }, icono('descargar'), 'Descargar'),
            puedeCompartir(blob, nombre) && el('button', { class: 'boton boton-primario', onclick: async () => {
              try { if (await compartir(blob, nombre)) cerrar(); } catch (e) { aviso('No se pudo compartir: ' + e.message, 'error'); }
            } }, icono('compartir'), 'Compartir')));
      } catch (e) {
        console.error(e);
        aviso('No se pudo crear el PDF: ' + e.message, 'error');
        crear.disabled = false;
        progreso.hidden = true;
      }
    } }, icono('pdf'), 'Crear PDF');
    const opciones = el('div', {},
      grupo('Tamaño de hoja', 'tamano', TAMANOS_HOJA, true),
      grupo('Calidad', 'calidad', CALIDADES, false));
    return [
      el('h2', { class: 'hoja-titulo', text: 'Crear PDF' }),
      el('p', { class: 'hoja-detalle', text: `${doc.nombre} · ${paginasTexto(paginas.length)}` }),
      opciones, progreso, resultado,
      el('div', { class: 'hoja-botones' }, crear)
    ];
  });
}

export function iniciar() {
  $('#doc-atras').addEventListener('click', () => volver(''));
  $('#doc-renombrar').addEventListener('click', renombrar);
  $('#doc-menu').addEventListener('click', masOpciones);
  $('#doc-agregar').addEventListener('click', agregar);
  $('#doc-pdf').addEventListener('click', crearPDF);
}
