// ScanLibre · vistas/documento.js
// Las páginas de un documento, agregar más, renombrar y crear el PDF.

import { $, el, icono, aviso, confirmar, pedirTexto, menu, hoja, paginasTexto, fechaCorta, tamanoLegible, nombreArchivo, nuevoId } from '../util.js';
import { obtenerDocumento, guardarDocumento, paginasDe, borrarDocumento, listarCarpetas, guardarCarpeta } from '../db.js';
import { ir, volver } from '../rutas.js';
import { eventosPaginas, pendientesEnCola, importarArchivos, textoDePagina, esBorrosa } from '../paginas.js';
import { mostrarTexto } from './texto.js';
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
  // Así, al abrir otro documento, no se alcanzan a ver las páginas de este
  $('#doc-paginas').replaceChildren();
  $('#doc-nombre').textContent = '';
  $('#doc-estado').textContent = '';
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
      el('button', { class: 'miniatura', 'aria-label': `Página ${i + 1}${esBorrosa(p) ? ' (borrosa)' : ''}`, onclick: () => ir(ruta('pagina', i + 1)) },
        el('img', { src: u, alt: '' }),
        esBorrosa(p) && el('span', { class: 'miniatura-borrosa', text: 'Borrosa' }),
        el('span', { class: 'miniatura-numero', text: String(i + 1) })));
  });
  for (let i = 0; i < pendientes; i++) {
    items.push(el('li', {}, el('div', { class: 'miniatura miniatura-pendiente', role: 'img', 'aria-label': 'Procesando foto' }, el('span', { class: 'giro' }))));
  }
  items.push(el('li', {},
    el('button', { class: 'miniatura miniatura-agregar', onclick: agregar }, icono('mas'), 'Agregar página')));
  $('#doc-paginas').replaceChildren(...items);
  const carpeta = doc.carpetaId && (await listarCarpetas()).find(c => c.id === doc.carpetaId);
  let estado = [carpeta?.nombre, paginasTexto(paginas.length), fechaCorta(doc.modificado)].filter(Boolean).join(' · ');
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

async function moverACarpeta() {
  const [doc, carpetas] = await Promise.all([obtenerDocumento(docId), listarCarpetas()]);
  const opcion = await menu([
    ...carpetas.map(c => ({ valor: c.id, texto: c.id === doc.carpetaId ? `${c.nombre} (está aquí)` : c.nombre, icono: 'carpeta' })),
    doc.carpetaId && { valor: 'ninguna', texto: 'Sacar de la carpeta', icono: 'cerrar' },
    { valor: 'nueva', texto: 'Nueva carpeta…', icono: 'mas' }
  ].filter(Boolean), 'Mover a una carpeta');
  if (!opcion) return;
  let destino = carpetas.find(c => c.id === opcion) || null;
  if (opcion === 'nueva') {
    const nombre = await pedirTexto('Nueva carpeta', '', { aceptar: 'Crear', ejemplo: 'Por ejemplo: Cálculo' });
    if (!nombre) return;
    destino = carpetas.find(c => c.nombre.localeCompare(nombre, 'es', { sensitivity: 'base' }) === 0)
      || await guardarCarpeta({ id: nuevoId(), nombre, creada: Date.now() });
  }
  if ((destino?.id || null) === (doc.carpetaId || null)) return;
  doc.carpetaId = destino?.id || null;
  await guardarDocumento(doc);
  aviso(destino ? `Movido a «${destino.nombre}».` : 'Quedó sin carpeta.', 'exito');
  pintar();
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
    { valor: 'texto', texto: 'Copiar el texto de todo el documento', icono: 'texto' },
    { valor: 'renombrar', texto: 'Cambiar el nombre', icono: 'editar' },
    { valor: 'mover', texto: 'Mover a una carpeta', icono: 'carpeta' },
    { valor: 'borrar', texto: 'Eliminar el documento', icono: 'basura', peligro: true }
  ]);
  if (opcion === 'mover') return moverACarpeta();
  if (opcion === 'texto') {
    const paginas = await paginasDe(await obtenerDocumento(docId));
    if (!paginas.length) return aviso('El documento todavía no tiene páginas.');
    return mostrarTexto(paginas, { titulo: 'Texto del documento' });
  }
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
  const eleccion = { tamano: ajustes().pdfTamano, calidad: ajustes().pdfCalidad, texto: ajustes().pdfTexto };

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
    const conTexto = el('button', { class: 'opcion', 'aria-pressed': String(eleccion.texto), onclick: () => {
      eleccion.texto = !eleccion.texto;
      conTexto.setAttribute('aria-pressed', String(eleccion.texto));
    } },
      el('strong', { text: 'Texto buscable' }),
      el('small', { text: 'Para buscar y copiar palabras dentro del PDF. Lee el texto de cada página, así que tarda un poco más.' }));
    // Contraseña: no se guarda en ningún lado (ni en el teléfono): se escribe cada vez
    const clave = el('input', { class: 'campo', type: 'password', autocomplete: 'new-password', 'aria-label': 'Contraseña del PDF', placeholder: 'Contraseña', enterkeyhint: 'done' });
    const ver = el('button', { class: 'boton boton-fantasma', type: 'button', onclick: () => {
      const mostrar = clave.type === 'password';
      clave.type = mostrar ? 'text' : 'password';
      ver.textContent = mostrar ? 'Ocultar' : 'Ver';
    } }, 'Ver');
    const campoClave = el('div', { class: 'campo-clave', hidden: true }, clave, ver);
    const conClave = el('button', { class: 'opcion', 'aria-pressed': 'false', onclick: () => {
      const si = conClave.getAttribute('aria-pressed') !== 'true';
      conClave.setAttribute('aria-pressed', String(si));
      campoClave.hidden = !si;
      if (si) clave.focus();
    } },
      el('strong', { text: 'Con contraseña' }),
      el('small', { text: 'Para abrirlo hay que escribirla (cifrado AES-256). Si la olvidas, no hay forma de recuperarla.' }));
    const barra = el('span');
    const progreso = el('div', { class: 'progreso', hidden: true }, barra);
    const estado = el('p', { class: 'hoja-detalle', hidden: true, 'aria-live': 'polite' });
    const resultado = el('div');
    const avance = x => { barra.style.width = `${Math.round(100 * x)}%`; };
    const crear = el('button', { class: 'boton boton-primario', onclick: async () => {
      const conContrasena = conClave.getAttribute('aria-pressed') === 'true';
      const contrasena = conContrasena ? clave.value : '';
      if (conContrasena && !contrasena) { aviso('Escribe la contraseña del PDF.', 'error'); clave.focus(); return; }
      crear.disabled = true;
      progreso.hidden = false;
      cambiarAjuste('pdfTamano', eleccion.tamano);
      cambiarAjuste('pdfCalidad', eleccion.calidad);
      cambiarAjuste('pdfTexto', eleccion.texto);
      try {
        // Con texto: primero se lee cada página (lo ya leído no se vuelve a leer)
        let conOcr = paginas;
        const parteOcr = eleccion.texto ? 0.7 : 0;
        if (eleccion.texto) {
          estado.hidden = false;
          conOcr = [];
          for (let i = 0; i < paginas.length; i++) {
            const ocr = await textoDePagina(paginas[i], {
              idioma: ajustes().ocrIdioma,
              alAvanzar: ({ etapa, progreso: x }) => {
                avance(parteOcr * (i + (etapa === 'leyendo' ? x : 0)) / paginas.length);
                estado.textContent = etapa === 'preparando' ? 'Preparando el lector de texto…' : `Leyendo el texto: página ${i + 1} de ${paginas.length}`;
              }
            });
            conOcr.push({ ...paginas[i], ocr });
          }
          estado.textContent = 'Armando el PDF…';
        }
        const blob = await generarPDF(doc, conOcr, { ...eleccion, conTexto: eleccion.texto, contrasena }, (hechas, total) => avance(parteOcr + (1 - parteOcr) * hechas / total));
        estado.hidden = true;
        const nombre = nombreArchivo(doc.nombre, 'pdf');
        progreso.hidden = true;
        crear.hidden = true;
        opciones.hidden = true;
        resultado.replaceChildren(
          el('div', { class: 'resultado-pdf' }, icono('pdf'),
            el('div', {}, el('strong', { text: nombre }), el('small', { text: [paginasTexto(paginas.length), tamanoLegible(blob.size), contrasena && 'con contraseña'].filter(Boolean).join(' · ') }))),
          el('div', { class: 'hoja-botones' },
            el('button', { class: 'boton boton-secundario', onclick: () => { descargar(blob, nombre); aviso('PDF descargado.', 'exito'); } }, icono('descargar'), 'Descargar'),
            puedeCompartir(blob, nombre) && el('button', { class: 'boton boton-primario', onclick: async () => {
              try { if (await compartir(blob, nombre)) cerrar(); } catch (e) { aviso('No se pudo compartir: ' + e.message, 'error'); }
            } }, icono('compartir'), 'Compartir')));
      } catch (e) {
        console.error(e);
        aviso('No se pudo crear el PDF: ' + (e.message || e), 'error');
        crear.disabled = false;
        progreso.hidden = true;
        estado.hidden = true;
      }
    } }, icono('pdf'), 'Crear PDF');
    const opciones = el('div', {},
      grupo('Tamaño de hoja', 'tamano', TAMANOS_HOJA, true),
      grupo('Calidad', 'calidad', CALIDADES, false),
      el('div', { class: 'grupo' }, el('h3', { class: 'grupo-titulo', text: 'Texto' }), el('div', { class: 'opciones' }, conTexto)),
      el('div', { class: 'grupo' }, el('h3', { class: 'grupo-titulo', text: 'Contraseña' }), el('div', { class: 'opciones' }, conClave), campoClave));
    return [
      el('h2', { class: 'hoja-titulo', text: 'Crear PDF' }),
      el('p', { class: 'hoja-detalle', text: `${doc.nombre} · ${paginasTexto(paginas.length)}` }),
      opciones, progreso, estado, resultado,
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
