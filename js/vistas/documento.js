// ScanLibre · vistas/documento.js
// Las páginas de un documento: agregar más, ordenarlas arrastrando, elegir
// varias (girar, filtro, pasarlas a otro documento, PDF o eliminar),
// renombrar y crear el PDF.

import { $, el, icono, aviso, confirmar, pedirTexto, menu, hoja, paginasTexto, fechaCorta, tamanoLegible, nombreArchivo, nuevoId, pedirClaveDePDF } from '../util.js';
import { obtenerDocumento, guardarDocumento, paginasDe, borrarDocumento, listarCarpetas, guardarCarpeta, listarDocumentos, borrarPaginas, moverPaginas } from '../db.js';
import { ir, volver } from '../rutas.js';
import { eventosPaginas, pendientesEnCola, importarArchivos, textoDePagina, esBorrosa, reprocesar, nuevoDocumento } from '../paginas.js';
import { FILTROS } from '../imagen/filtros.js';
import { mostrarTexto } from './texto.js';
import { nuevaSesion } from './camara.js';
import { elegirArchivos } from '../archivos.js';
import { ajustes, cambiarAjuste } from '../ajustes.js';
import { CALIDADES, TAMANOS_HOJA, generarPDF, puedeCompartir, compartir, descargar } from '../exportar.js';

let docId = null;
let urls = [];
let seleccion = null;   // Set con los id de las páginas elegidas, o null si no se está eligiendo
let agarre = null;      // la página que se mantiene presionada o se arrastra
let repintar = false;   // llegó un cambio mientras se arrastraba: se pinta al soltar
let ignorarClic = null; // { id, hasta }: el clic que llega justo al soltar una página arrastrada o presionada
let trabajando = false;
const soltarUrls = () => { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; };
const ruta = (...partes) => ['doc', encodeURIComponent(docId), ...partes].join('/');

export async function mostrar({ doc }) {
  docId = doc;
  eventosPaginas.addEventListener('cambio', alCambiar);
  await pintar();
}

export function ocultar() {
  eventosPaginas.removeEventListener('cambio', alCambiar);
  cancelarAgarre();
  seleccion = null;
  pintarSeleccion();
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
  if (agarre?.arrastrando) { repintar = true; return; }
  const doc = await obtenerDocumento(docId);
  if (!doc) {
    aviso('Ese documento ya no existe.');
    return ir('', { reemplazar: true });
  }
  const paginas = await paginasDe(doc);
  const pendientes = pendientesEnCola(docId);
  if (agarre?.arrastrando) { repintar = true; return; }
  soltarUrls();
  $('#doc-nombre').textContent = doc.nombre;
  document.title = doc.nombre + ' · ScanLibre';
  const items = paginas.map((p, i) => {
    const u = URL.createObjectURL(p.miniatura);
    urls.push(u);
    return el('li', { 'data-id': p.id },
      el('button', { class: 'miniatura', 'data-id': p.id, 'aria-label': `Página ${i + 1}${esBorrosa(p) ? ' (borrosa)' : ''}`, onclick: () => tocarPagina(p.id) },
        el('img', { src: u, alt: '', draggable: 'false' }),
        esBorrosa(p) && el('span', { class: 'miniatura-borrosa', text: 'Borrosa' }),
        el('span', { class: 'miniatura-marca', 'aria-hidden': 'true' }, icono('listo')),
        el('span', { class: 'miniatura-numero', text: String(i + 1) })));
  });
  for (let i = 0; i < pendientes; i++) {
    items.push(el('li', {}, el('div', { class: 'miniatura miniatura-pendiente', role: 'img', 'aria-label': 'Procesando foto' }, el('span', { class: 'giro' }))));
  }
  items.push(el('li', {},
    el('button', { class: 'miniatura miniatura-agregar', onclick: agregar }, icono('mas'), 'Agregar página')));
  $('#doc-paginas').replaceChildren(...items);
  // Las elegidas que ya no están (se borraron o se movieron) se sueltan
  if (seleccion) for (const id of [...seleccion]) if (!doc.paginas.includes(id)) seleccion.delete(id);
  pintarSeleccion();
  $('#doc-consejo').hidden = paginas.length < 2 || !!seleccion;
  const carpeta = doc.carpetaId && (await listarCarpetas()).find(c => c.id === doc.carpetaId);
  let estado = [carpeta?.nombre, paginasTexto(paginas.length), fechaCorta(doc.modificado)].filter(Boolean).join(' · ');
  if (pendientes) estado += ` · procesando ${pendientes === 1 ? '1 foto' : pendientes + ' fotos'}…`;
  if (!trabajando) $('#doc-estado').textContent = estado;
  $('#doc-pdf').disabled = paginas.length === 0 || pendientes > 0;
}

function tocarPagina(id) {
  if (ignorarClic?.id === id && Date.now() < ignorarClic.hasta) { ignorarClic = null; return; }
  if (seleccion) return alternar(id);
  obtenerDocumento(docId).then(doc => {
    const i = doc?.paginas.indexOf(id);
    if (i >= 0) ir(ruta('pagina', i + 1));
  });
}

// ── Elegir varias páginas ───────────────────────────────────────────
function entrarSeleccion(id) {
  seleccion = new Set(id ? [id] : []);
  pintarSeleccion();
}

function salirSeleccion() {
  seleccion = null;
  pintarSeleccion();
}

function alternar(id) {
  if (seleccion.has(id)) seleccion.delete(id); else seleccion.add(id);
  pintarSeleccion();
}

function pintarSeleccion() {
  const activa = !!seleccion, k = seleccion?.size || 0;
  $('#vista-documento').classList.toggle('seleccionando', activa);
  $('#doc-barra').hidden = activa;
  $('#doc-barra-seleccion').hidden = !activa;
  $('#doc-acciones').hidden = activa;
  $('#doc-acciones-seleccion').hidden = !activa;
  $('#doc-consejo').hidden = activa || $('#doc-paginas').querySelectorAll('li[data-id]').length < 2;
  const botones = [...$('#doc-paginas').querySelectorAll('.miniatura[data-id]')];
  for (const b of botones) {
    if (activa) b.setAttribute('aria-pressed', String(seleccion.has(b.dataset.id)));
    else b.removeAttribute('aria-pressed');
  }
  if (!activa) return;
  $('#doc-seleccion-cuenta').textContent = k ? (k === 1 ? '1 página' : `${k} páginas`) : 'Elige páginas';
  $('#doc-seleccion-todas').textContent = k && k === botones.length ? 'Ninguna' : 'Todas';
  for (const b of $('#doc-acciones-seleccion').querySelectorAll('button')) b.disabled = !k || trabajando;
}

/** Los números de las páginas elegidas, cortos: "2–4, 7" */
function rangos(numeros) {
  const out = [];
  for (let i = 0; i < numeros.length; i++) {
    let j = i;
    while (j + 1 < numeros.length && numeros[j + 1] === numeros[j] + 1) j++;
    out.push(j > i ? `${numeros[i]}–${numeros[j]}` : String(numeros[i]));
    i = j;
  }
  return out.join(', ');
}

/** Las elegidas en el orden del documento: { doc, ids, numeros } */
async function elegidas() {
  const doc = await obtenerDocumento(docId);
  const ids = doc.paginas.filter(id => seleccion?.has(id));
  return { doc, ids, numeros: ids.map(id => doc.paginas.indexOf(id) + 1) };
}

/** Cambia cada página elegida, de a una, contando cuántas van */
async function cambiarElegidas(verbo, cambio) {
  if (trabajando) return;
  const { ids } = await elegidas();
  if (!ids.length) return;
  trabajando = true;
  pintarSeleccion();
  try {
    for (let i = 0; i < ids.length; i++) {
      $('#doc-estado').textContent = `${verbo} ${i + 1} de ${ids.length}…`;
      const p = (await paginasDe({ paginas: [ids[i]] }))[0];
      if (p) await reprocesar(p, cambio(p));
    }
    aviso(ids.length === 1 ? 'Listo: 1 página.' : `Listo: ${ids.length} páginas.`, 'exito');
  } catch (e) {
    console.error(e);
    aviso('No se pudieron cambiar todas las páginas: ' + e.message, 'error');
  } finally {
    trabajando = false;
    await pintar();
  }
}

async function filtroDeElegidas() {
  const opcion = await menu(Object.entries(FILTROS).map(([valor, texto]) => ({ valor, texto })), 'Filtro para las páginas elegidas');
  if (opcion) cambiarElegidas('Cambiando el filtro:', () => ({ filtro: opcion }));
}

async function pasarElegidas() {
  const { doc, ids, numeros } = await elegidas();
  if (!ids.length) return;
  const otros = (await listarDocumentos()).filter(d => d.id !== docId).slice(0, 8);
  const opcion = await menu([
    { valor: 'nuevo', texto: 'A un documento nuevo', icono: 'mas' },
    ...otros.map(d => ({ valor: d.id, texto: d.nombre, icono: 'pdf' }))
  ], ids.length === 1 ? 'Pasar la página a…' : `Pasar ${ids.length} páginas a…`);
  if (!opcion) return;
  let destino = otros.find(d => d.id === opcion);
  if (opcion === 'nuevo') {
    const nombre = await pedirTexto('Nombre del documento nuevo', `${doc.nombre} (págs. ${rangos(numeros)})`, { aceptar: 'Crear' });
    if (!nombre) return;
    destino = await nuevoDocumento(doc.carpetaId || null);
    destino.nombre = nombre;
    await guardarDocumento(destino);
  }
  await moverPaginas(docId, destino.id, ids);
  salirSeleccion();
  aviso(`${ids.length === 1 ? 'La página pasó' : `${ids.length} páginas pasaron`} a «${destino.nombre}».`, 'exito', 4500);
  pintar();
}

async function borrarElegidas() {
  const { ids } = await elegidas();
  if (!ids.length) return;
  const si = await confirmar(ids.length === 1 ? '¿Eliminar la página elegida?' : `¿Eliminar ${ids.length} páginas?`, { detalle: 'Las demás páginas quedan como están. No se puede deshacer.', aceptar: 'Eliminar', peligro: true });
  if (!si) return;
  await borrarPaginas(docId, ids);
  salirSeleccion();
  aviso(ids.length === 1 ? 'Página eliminada.' : `${ids.length} páginas eliminadas.`);
  pintar();
}

async function pdfDeElegidas() {
  const { doc, ids, numeros } = await elegidas();
  if (ids.length) crearPDF({ soloIds: ids, nombre: `${doc.nombre} (págs. ${rangos(numeros)})` });
}

// ── Arrastrar para ordenar ──────────────────────────────────────────
// Con el dedo: mantener presionada (así se distingue de deslizar la lista).
// Si se suelta sin moverla, se empieza a elegir varias. Con el mouse basta arrastrar.
const ESPERA = 400, TOLERANCIA = 9;
const rejilla = () => $('#doc-paginas');
const contenedor = () => $('#doc-contenido');

function alPresionar(ev) {
  const boton = ev.target.closest('.miniatura[data-id]');
  if (!boton || ev.button > 0 || trabajando || agarre) return;
  agarre = {
    id: boton.dataset.id, boton, li: boton.parentElement, pointerId: ev.pointerId,
    x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY,
    raton: ev.pointerType === 'mouse', activo: false, arrastrando: false
  };
  agarre.reloj = setTimeout(activar, ESPERA);
}

function activar() {
  if (!agarre || agarre.activo) return;
  agarre.activo = true;
  agarre.boton.classList.add('levantada');
  try { navigator.vibrate?.(12); } catch (e) {}
}

function alMover(ev) {
  if (!agarre || ev.pointerId !== agarre.pointerId) return;
  agarre.x = ev.clientX; agarre.y = ev.clientY;
  const d = Math.hypot(ev.clientX - agarre.x0, ev.clientY - agarre.y0);
  if (!agarre.activo) {
    if (d <= TOLERANCIA) return;
    // Con el dedo, moverse antes de tiempo es deslizar la lista; con el mouse es arrastrar
    if (!agarre.raton) return cancelarAgarre();
    activar();
  }
  if (!agarre.arrastrando) {
    if (d <= TOLERANCIA) return;
    empezarArrastre();
  }
  ev.preventDefault();
  moverFantasma();
  reubicar();
}

function empezarArrastre() {
  const r = agarre.boton.getBoundingClientRect();
  const f = agarre.boton.cloneNode(true);
  f.classList.remove('levantada');
  f.classList.add('miniatura-fantasma');
  f.removeAttribute('aria-pressed');
  f.setAttribute('aria-hidden', 'true');
  f.style.width = r.width + 'px';
  f.style.height = r.height + 'px';
  document.body.append(f);
  Object.assign(agarre, { arrastrando: true, fantasma: f, dx: agarre.x0 - r.left, dy: agarre.y0 - r.top, orden: ordenActual() });
  agarre.li.classList.add('miniatura-hueco');
  agarre.boton.classList.remove('levantada');
  desplazar();
}

function moverFantasma() {
  agarre.fantasma.style.left = (agarre.x - agarre.dx) + 'px';
  agarre.fantasma.style.top = (agarre.y - agarre.dy) + 'px';
}

const ordenActual = () => [...rejilla().querySelectorAll('li[data-id]')].map(li => li.dataset.id);

/** La página arrastrada toma el lugar de la que está bajo el dedo */
function reubicar() {
  const lista = [...rejilla().querySelectorAll('li[data-id]')];
  const yo = lista.indexOf(agarre.li);
  for (let i = 0; i < lista.length; i++) {
    if (i === yo) continue;
    const r = lista[i].getBoundingClientRect();
    if (agarre.x < r.left || agarre.x > r.right || agarre.y < r.top || agarre.y > r.bottom) continue;
    rejilla().insertBefore(agarre.li, i > yo ? lista[i].nextSibling : lista[i]);
    // Los números siguen el orden nuevo mientras se arrastra
    rejilla().querySelectorAll('li[data-id] .miniatura-numero').forEach((s, k) => { s.textContent = String(k + 1); });
    break;
  }
}

/** Cerca del borde de arriba o de abajo, la lista se desliza sola */
function desplazar() {
  if (!agarre?.arrastrando) return;
  const c = contenedor(), r = c.getBoundingClientRect(), borde = 70;
  let v = 0;
  if (agarre.y < r.top + borde) v = -Math.ceil((r.top + borde - agarre.y) / 6);
  else if (agarre.y > r.bottom - borde) v = Math.ceil((agarre.y - (r.bottom - borde)) / 6);
  if (v) { const antes = c.scrollTop; c.scrollTop += v; if (c.scrollTop !== antes) reubicar(); }
  agarre.animacion = requestAnimationFrame(desplazar);
}

async function alSoltar(ev) {
  if (!agarre || ev.pointerId !== agarre.pointerId) return;
  const a = agarre;
  if (a.arrastrando) {
    // El clic que sigue a soltar no abre la página
    ignorarClic = { id: a.id, hasta: Date.now() + 400 };
    const orden = ordenActual();
    terminarArrastre();
    if (ev.type !== 'pointercancel' && orden.join() !== a.orden.join()) await guardarOrden(orden, a.id);
    else pintar();
  } else if (a.activo && ev.type !== 'pointercancel') {
    // Mantener presionada sin mover: se empieza a elegir (o se agrega a lo elegido)
    ignorarClic = { id: a.id, hasta: Date.now() + 400 };
    cancelarAgarre();
    if (seleccion) { if (!seleccion.has(a.id)) alternar(a.id); } else entrarSeleccion(a.id);
  } else {
    cancelarAgarre();
  }
}

function terminarArrastre() {
  if (!agarre) return;
  cancelAnimationFrame(agarre.animacion);
  agarre.fantasma?.remove();
  agarre.li.classList.remove('miniatura-hueco');
  agarre = null;
}

function cancelarAgarre() {
  if (!agarre) return;
  clearTimeout(agarre.reloj);
  agarre.boton.classList.remove('levantada');
  if (agarre.arrastrando) terminarArrastre();
  agarre = null;
  if (repintar) { repintar = false; pintar(); }
}

async function guardarOrden(orden, id) {
  const doc = await obtenerDocumento(docId);
  // Por si mientras tanto llegó una página nueva: las que no estaban en la lista quedan al final
  const resto = doc.paginas.filter(p => !orden.includes(p));
  doc.paginas = [...orden.filter(p => doc.paginas.includes(p)), ...resto];
  doc.modificado = Date.now();
  await guardarDocumento(doc);
  repintar = false;
  await pintar();
  aviso(`La página quedó en el lugar ${doc.paginas.indexOf(id) + 1}.`);
}

async function agregar() {
  const opcion = await menu([
    { valor: 'camara', texto: 'Con la cámara', icono: 'camara' },
    { valor: 'galeria', texto: 'Fotos o un PDF', icono: 'galeria' }
  ], 'Agregar páginas');
  if (opcion === 'camara') {
    nuevaSesion(docId, 'doc');
    ir('camara?doc=' + encodeURIComponent(docId));
  } else if (opcion === 'galeria') {
    const archivos = await elegirArchivos('entrada-fotos');
    if (archivos.length) importarArchivos(docId, archivos, { pedirClave: pedirClaveDePDF });
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

/** Las páginas de otro documento pasan al final de este, y el otro se borra */
async function unirCon() {
  const [doc, todos] = await Promise.all([obtenerDocumento(docId), listarDocumentos()]);
  const otros = todos.filter(d => d.id !== docId && d.paginas.length);
  if (!otros.length) return aviso('No hay otro documento con páginas para unir.');
  const opcion = await menu(otros.slice(0, 12).map(d => ({ valor: d.id, texto: `${d.nombre} (${paginasTexto(d.paginas.length)})`, icono: 'pdf' })), 'Unir con…');
  const otro = otros.find(d => d.id === opcion);
  if (!otro) return;
  const si = await confirmar(`¿Unir «${otro.nombre}» a este documento?`, {
    detalle: `Sus ${paginasTexto(otro.paginas.length)} pasan al final de «${doc.nombre}» y «${otro.nombre}» deja de estar en la lista.`,
    aceptar: 'Unir'
  });
  if (!si) return;
  await moverPaginas(otro.id, docId, otro.paginas);
  await borrarDocumento(otro.id);
  aviso(`Listo: se unieron. Ahora son ${paginasTexto(doc.paginas.length + otro.paginas.length)}.`, 'exito', 4500);
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
    { valor: 'texto', texto: 'Texto de todo el documento (copiar, escuchar, Word)', icono: 'texto' },
    { valor: 'elegir', texto: 'Elegir páginas (girar, pasar a otro documento…)', icono: 'listo' },
    { valor: 'unir', texto: 'Unir con otro documento', icono: 'mas' },
    { valor: 'renombrar', texto: 'Cambiar el nombre', icono: 'editar' },
    { valor: 'mover', texto: 'Mover a una carpeta', icono: 'carpeta' },
    { valor: 'borrar', texto: 'Eliminar el documento', icono: 'basura', peligro: true }
  ]);
  if (opcion === 'mover') return moverACarpeta();
  if (opcion === 'elegir') return entrarSeleccion();
  if (opcion === 'unir') return unirCon();
  if (opcion === 'texto') {
    const doc = await obtenerDocumento(docId);
    const paginas = await paginasDe(doc);
    if (!paginas.length) return aviso('El documento todavía no tiene páginas.');
    return mostrarTexto(paginas, { titulo: 'Texto del documento', nombre: doc.nombre });
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

/**
 * Hoja para elegir tamaño y calidad, crear el PDF y compartirlo.
 * Con `soloIds`, solo esas páginas (las elegidas) y con otro nombre.
 */
async function crearPDF({ soloIds = null, nombre: nombrePDF = null } = {}) {
  const doc = await obtenerDocumento(docId);
  const paginas = await paginasDe(soloIds ? { paginas: doc.paginas.filter(id => soloIds.includes(id)) } : doc);
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
        const blob = await generarPDF({ ...doc, nombre: nombrePDF || doc.nombre }, conOcr, { ...eleccion, conTexto: eleccion.texto, contrasena }, (hechas, total) => avance(parteOcr + (1 - parteOcr) * hechas / total));
        estado.hidden = true;
        const nombre = nombreArchivo(nombrePDF || doc.nombre, 'pdf');
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
      el('p', { class: 'hoja-detalle', text: `${nombrePDF || doc.nombre} · ${paginasTexto(paginas.length)}` }),
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
  $('#doc-pdf').addEventListener('click', () => crearPDF());
  // Elegir varias
  $('#doc-seleccion-cerrar').addEventListener('click', salirSeleccion);
  $('#doc-seleccion-todas').addEventListener('click', () => {
    const todas = [...$('#doc-paginas').querySelectorAll('.miniatura[data-id]')].map(b => b.dataset.id);
    seleccion = new Set(seleccion?.size === todas.length ? [] : todas);
    pintarSeleccion();
  });
  $('#doc-sel-girar').addEventListener('click', () => cambiarElegidas('Girando:', p => ({ rotacion: (p.rotacion + 1) % 4 })));
  $('#doc-sel-filtro').addEventListener('click', filtroDeElegidas);
  $('#doc-sel-mover').addEventListener('click', pasarElegidas);
  $('#doc-sel-pdf').addEventListener('click', pdfDeElegidas);
  $('#doc-sel-borrar').addEventListener('click', borrarElegidas);
  // Arrastrar para ordenar (el dedo que se mueve se sigue en toda la ventana)
  const lista = $('#doc-paginas');
  lista.addEventListener('pointerdown', alPresionar);
  window.addEventListener('pointermove', alMover, { passive: false });
  window.addEventListener('pointerup', alSoltar);
  window.addEventListener('pointercancel', alSoltar);
  // Mientras se arrastra con el dedo, la lista no se desliza
  document.addEventListener('touchmove', e => { if (agarre?.activo) e.preventDefault(); }, { passive: false });
  // Mantener presionada una miniatura no abre el menú de "guardar imagen"
  lista.addEventListener('contextmenu', e => { if (e.target.closest('.miniatura')) e.preventDefault(); });
}
