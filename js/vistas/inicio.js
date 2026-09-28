// ScanLibre · vistas/inicio.js
// La lista de documentos, el botón de escanear y el menú de respaldo.

import { $, el, icono, fechaCorta, paginasTexto, aviso, menu, hoja, confirmar, pedirTexto, tamanoLegible, nuevoId, pedirClaveDePDF } from '../util.js';
import { listarDocumentos, obtenerPagina, listarCarpetas, guardarCarpeta, borrarCarpeta, listarPaginas, guardarDocumento } from '../db.js';
import { esPDF, nombreDelPDF } from '../importar.js';
import { terminos, buscarEn, fragmento } from '../buscar.js';
import { ajustes, cambiarAjuste } from '../ajustes.js';
import { ir } from '../rutas.js';
import { nuevaSesion, diagnosticoCamara } from './camara.js';
import { VERSION } from '../version.js';
import { nuevoDocumento, importarArchivos, textoLeido, textoDePagina } from '../paginas.js';
import { elegirArchivos } from '../archivos.js';
import { crearRespaldo, restaurarRespaldo } from '../respaldo.js';
import { puedeCompartir, compartir, descargar } from '../exportar.js';
import { mostrarPapelera, enPapelera } from './papelera.js';

let urls = [];
const soltarUrls = () => { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; };

export async function mostrar() {
  if (buscando) return buscar();
  const [docs, carpetas] = await Promise.all([listarDocumentos(), listarCarpetas()]);
  // La carpeta elegida (si se borró en otra pestaña, se vuelve a "Todos")
  const elegida = carpetas.find(c => c.id === ajustes().carpeta) || null;
  if (!elegida && ajustes().carpeta) cambiarAjuste('carpeta', null);
  pintarCarpetas(carpetas, elegida);
  const nombreDe = new Map(carpetas.map(c => [c.id, c.nombre]));
  const visibles = elegida ? docs.filter(d => d.carpetaId === elegida.id) : docs;
  soltarUrls();
  const lista = $('#inicio-lista');
  const items = await Promise.all(visibles.map(async doc => {
    const primera = doc.paginas.length ? await obtenerPagina(doc.paginas[0]) : null;
    let img;
    if (primera?.miniatura) {
      const u = URL.createObjectURL(primera.miniatura);
      urls.push(u);
      img = el('img', { class: 'doc-miniatura', src: u, alt: '' });
    } else {
      img = el('span', { class: 'doc-miniatura' });
    }
    return el('li', {},
      el('button', { class: 'doc', onclick: () => ir('doc/' + encodeURIComponent(doc.id)) },
        img,
        el('span', { class: 'doc-texto' },
          el('div', { class: 'doc-nombre', text: doc.nombre }),
          el('div', { class: 'doc-detalle', text: [!elegida && nombreDe.get(doc.carpetaId), paginasTexto(doc.paginas.length), fechaCorta(doc.modificado)].filter(Boolean).join(' · ') }))));
  }));
  lista.replaceChildren(...items);
  $('#inicio-vacio').hidden = docs.length > 0 || !!elegida;
  const vacia = $('#inicio-carpeta-vacia');
  vacia.hidden = !elegida || visibles.length > 0;
  if (elegida) vacia.textContent = `Todavía no hay documentos en «${elegida.nombre}». Lo que escanees ahora se guarda aquí.`;
}

// ── Carpetas ────────────────────────────────────────────────────────
function pintarCarpetas(carpetas, elegida) {
  const chip = (contenido, activa, onclick, etiqueta) =>
    el('button', { class: 'carpeta-chip', 'aria-pressed': String(activa), 'aria-label': etiqueta, onclick }, ...[contenido].flat());
  $('#inicio-carpetas').replaceChildren(
    chip('Todos', !elegida, () => elegir(null)),
    ...carpetas.map(c => c === elegida
      // La carpeta elegida: tocarla otra vez abre sus opciones
      ? chip([c.nombre, icono('menu')], true, () => opcionesDe(c), `${c.nombre}: opciones de la carpeta`)
      : chip(c.nombre, false, () => elegir(c.id))),
    el('button', { class: 'carpeta-chip carpeta-nueva', onclick: nuevaCarpeta }, icono('mas'), 'Carpeta'));
  // La fila se desliza solo lo necesario para que se vea entera la carpeta elegida
  const fila = $('#inicio-carpetas'), sel = fila.querySelector('[aria-pressed="true"]');
  const derecha = sel.getBoundingClientRect().right - fila.getBoundingClientRect().left + fila.scrollLeft;
  fila.scrollLeft = Math.max(0, derecha + 16 - fila.clientWidth);
}

function elegir(id) {
  cambiarAjuste('carpeta', id);
  mostrar();
}

async function nuevaCarpeta() {
  const nombre = await pedirTexto('Nueva carpeta', '', { aceptar: 'Crear', ejemplo: 'Por ejemplo: Cálculo' });
  if (!nombre) return;
  const existente = (await listarCarpetas()).find(c => c.nombre.localeCompare(nombre, 'es', { sensitivity: 'base' }) === 0);
  const carpeta = existente || await guardarCarpeta({ id: nuevoId(), nombre, creada: Date.now() });
  if (!existente) aviso(`Lo que escanees ahora se guarda en «${nombre}».`, 'exito');
  elegir(carpeta.id);
}

async function opcionesDe(carpeta) {
  const opcion = await menu([
    { valor: 'renombrar', texto: 'Cambiar el nombre', icono: 'editar' },
    { valor: 'borrar', texto: 'Eliminar la carpeta', icono: 'basura', peligro: true }
  ], carpeta.nombre);
  if (opcion === 'renombrar') {
    const nombre = await pedirTexto('Nombre de la carpeta', carpeta.nombre);
    if (!nombre || nombre === carpeta.nombre) return;
    await guardarCarpeta({ ...carpeta, nombre });
    mostrar();
  } else if (opcion === 'borrar') {
    const si = await confirmar(`¿Eliminar la carpeta «${carpeta.nombre}»?`, { detalle: 'Sus documentos no se borran: quedan en "Todos".', aceptar: 'Eliminar', peligro: true });
    if (!si) return;
    await borrarCarpeta(carpeta.id);
    aviso('Carpeta eliminada. Sus documentos siguen en "Todos".');
    elegir(null);
  }
}

export function ocultar() { soltarUrls(); leyendo = false; }

// ── Buscar en todos los documentos ──────────────────────────────────
// Se busca en el nombre de cada documento y en el texto leído de sus
// páginas. Las páginas que todavía no se han leído no aparecen: se ofrece
// leerlas (con el mismo lector de texto, sin internet).
let buscando = false, leyendo = false, reloj = null;

function abrirBusqueda() {
  buscando = true;
  $('#inicio-busqueda').hidden = false;
  $('#inicio-carpetas').hidden = true;
  $('#inicio-buscar').hidden = true;
  $('#inicio-consulta').focus();
  buscar();
}

function cerrarBusqueda() {
  buscando = false; leyendo = false;
  $('#inicio-busqueda').hidden = true;
  $('#inicio-sin-leer').hidden = true;
  $('#inicio-sin-resultados').hidden = true;
  $('#inicio-carpetas').hidden = false;
  $('#inicio-buscar').hidden = false;
  $('#inicio-consulta').value = '';
  mostrar();
}

/** Documentos con sus páginas en orden y el texto leído de cada una */
async function indice() {
  const [docs, carpetas, paginas] = await Promise.all([listarDocumentos(), listarCarpetas(), listarPaginas()]);
  const porId = new Map(paginas.map(p => [p.id, p]));
  const nombreDe = new Map(carpetas.map(c => [c.id, c.nombre]));
  return docs.map(doc => ({
    doc, carpeta: nombreDe.get(doc.carpetaId),
    paginas: doc.paginas.map((id, i) => ({ n: i + 1, pagina: porId.get(id) })).filter(p => p.pagina).map(p => ({ ...p, texto: textoLeido(p.pagina) }))
  }));
}

/** Un texto con lo encontrado marcado */
function conMarca(texto, lugar) {
  const f = fragmento(texto, lugar);
  return [f.antes, el('mark', { text: f.marca }), f.despues];
}

async function buscar() {
  const consulta = $('#inicio-consulta').value;
  const palabras = terminos(consulta);
  const docs = await indice();
  if (!buscando || consulta !== $('#inicio-consulta').value) return; // se escribió algo más mientras tanto
  soltarUrls();
  const sinLeer = docs.flatMap(d => d.paginas).filter(p => !p.texto);
  $('#inicio-sin-leer').hidden = !sinLeer.length || !docs.length;
  if (!leyendo) {
    $('#inicio-sin-leer-texto').textContent = sinLeer.length === 1
      ? '1 página todavía no se ha leído: sus palabras no aparecen al buscar.'
      : `${sinLeer.length} páginas todavía no se han leído: sus palabras no aparecen al buscar.`;
    $('#inicio-leer-todo').disabled = false;
  }
  $('#inicio-vacio').hidden = true;
  $('#inicio-carpeta-vacia').hidden = true;
  const vacio = $('#inicio-sin-resultados');
  if (!palabras.length) {
    $('#inicio-lista').replaceChildren();
    vacio.hidden = false;
    vacio.textContent = docs.length ? 'Escribe una palabra: se busca en los nombres y en el texto de todas las páginas.' : 'Todavía no tienes documentos.';
    return;
  }
  const resultados = [];
  for (const d of docs) {
    const enNombre = buscarEn(d.doc.nombre, palabras);
    const enPaginas = d.paginas.map(p => ({ ...p, lugar: buscarEn(p.texto, palabras) })).filter(p => p.lugar);
    if (enNombre || enPaginas.length) resultados.push({ ...d, enNombre, enPaginas });
  }
  const items = resultados.map(r => {
    const primera = r.enPaginas[0];
    const miniatura = (primera || r.paginas[0])?.pagina.miniatura;
    let img = el('span', { class: 'doc-miniatura' });
    if (miniatura) {
      const u = URL.createObjectURL(miniatura);
      urls.push(u);
      img = el('img', { class: 'doc-miniatura', src: u, alt: '' });
    }
    const nombre = r.enNombre ? conMarca(r.doc.nombre, r.enNombre) : [r.doc.nombre];
    const detalle = primera
      ? [`Página ${primera.n}${r.enPaginas.length > 1 ? ` (y ${r.enPaginas.length - 1} más)` : ''}: `, ...conMarca(primera.texto, primera.lugar)]
      : [[r.carpeta, paginasTexto(r.doc.paginas.length), fechaCorta(r.doc.modificado)].filter(Boolean).join(' · ')];
    const destino = 'doc/' + encodeURIComponent(r.doc.id) + (primera ? `/pagina/${primera.n}` : '');
    return el('li', {},
      el('button', { class: 'doc', onclick: () => ir(destino) }, img,
        el('span', { class: 'doc-texto' },
          el('div', { class: 'doc-nombre' }, ...nombre),
          el('div', { class: 'doc-detalle doc-fragmento' }, ...detalle))));
  });
  $('#inicio-lista').replaceChildren(...items);
  vacio.hidden = items.length > 0;
  vacio.textContent = `No se encontró «${consulta.trim()}».` + (sinLeer.length ? ' Puede estar en las páginas que falta leer.' : '');
}

/** Lee, una por una, las páginas que faltan; los resultados se van actualizando */
async function leerPendientes() {
  if (leyendo) return;
  leyendo = true;
  $('#inicio-leer-todo').disabled = true;
  const texto = $('#inicio-sin-leer-texto');
  const faltan = (await indice()).flatMap(d => d.paginas).filter(p => !p.texto).map(p => p.pagina);
  try {
    for (let i = 0; i < faltan.length && leyendo; i++) {
      texto.textContent = `Leyendo el texto: página ${i + 1} de ${faltan.length}…`;
      await textoDePagina(faltan[i], {
        idioma: ajustes().ocrIdioma,
        alAvanzar: ({ etapa }) => { if (etapa === 'preparando' && i === 0) texto.textContent = 'Preparando el lector de texto…'; }
      });
      if (buscando) await buscar();
    }
    if (leyendo) aviso('Listo: ya se puede buscar en todas las páginas.', 'exito');
  } catch (e) {
    console.error(e);
    aviso('No se pudo leer el texto: ' + e.message, 'error');
  } finally {
    leyendo = false;
    if (buscando) buscar();
  }
}

async function importar() {
  const archivos = await elegirArchivos('entrada-fotos');
  if (!archivos.length) return;
  const doc = await nuevoDocumento();
  // Un PDF solo: el documento se llama como el archivo
  if (archivos.length === 1 && esPDF(archivos[0]) && nombreDelPDF(archivos[0])) {
    doc.nombre = nombreDelPDF(archivos[0]);
    await guardarDocumento(doc);
  }
  importarArchivos(doc.id, archivos, { pedirClave: pedirClaveDePDF });
  ir('doc/' + encodeURIComponent(doc.id));
}

async function respaldar() {
  aviso('Preparando el respaldo…');
  const { blob, documentos } = await crearRespaldo();
  if (!documentos) return aviso('Todavía no tienes documentos para respaldar.');
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const nombre = `ScanLibre-respaldo-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.zip`;
  await hoja(cerrar => [
    el('h2', { class: 'hoja-titulo', text: 'Respaldo listo' }),
    el('p', { class: 'hoja-detalle', text: `${documentos === 1 ? '1 documento' : documentos + ' documentos'} en un solo archivo (${tamanoLegible(blob.size)}). Guárdalo en Drive, en tu correo o en la computadora. Para recuperarlo en otro teléfono, abre ScanLibre y elige "Restaurar un respaldo".` }),
    el('div', { class: 'hoja-botones' },
      el('button', { class: 'boton boton-secundario', onclick: () => { descargar(blob, nombre); cerrar(); } }, 'Descargar'),
      puedeCompartir(blob, nombre) && el('button', { class: 'boton boton-primario', onclick: async () => { try { await compartir(blob, nombre); cerrar(); } catch (e) { aviso('No se pudo compartir: ' + e.message, 'error'); } } }, 'Guardar en…'))
  ]);
}

async function restaurar() {
  const [archivo] = await elegirArchivos('entrada-respaldo');
  if (!archivo) return;
  aviso('Restaurando…');
  try {
    const n = await restaurarRespaldo(archivo);
    aviso(n === 1 ? 'Listo: se restauró 1 documento.' : `Listo: se restauraron ${n} documentos.`, 'exito');
    mostrar();
  } catch (e) {
    aviso(e.message, 'error', 5000);
  }
}

function acercaDe() {
  const cam = diagnosticoCamara();
  return hoja(cerrar => [
    el('h2', { class: 'hoja-titulo', text: 'ScanLibre' }),
    el('div', { class: 'acerca' },
      el('p', { text: 'Escáner de documentos gratis para estudiantes. Sin marca de agua, sin anuncios y sin cuenta.' }),
      el('ul', {},
        el('li', { text: 'Tus fotos y documentos se procesan y se guardan aquí, en tu teléfono: la app no sube nada a internet.' }),
        el('li', { text: 'Haz un respaldo en archivo de vez en cuando y guárdalo donde quieras: si borras los datos del navegador o pierdes el teléfono, es tu copia.' }),
        el('li', { text: 'Funciona sin conexión después de abrirla una vez.' })),
      el('p', { text: 'El código está en github.com/scanlibre/scanlibre.github.io' }),
      el('p', {}, el('a', { href: 'privacidad.html', target: '_blank', rel: 'noopener', id: 'acerca-privacidad' }, 'Política de privacidad')),
      el('p', { class: 'acerca-version', text: `Versión ${VERSION}` }),
      cam && el('p', { class: 'diagnostico', id: 'acerca-camara', text: `Cámara · última foto: ${cam.foto} (${cam.origen}) · video: ${cam.video}` +
        (cam.ms ? ` · tardó ${(cam.ms / 1000).toFixed(1).replace('.', ',')} s` : '') +
        (typeof cam.preparar === 'number' ? ` · armarla: ${(cam.preparar / 1000).toFixed(1).replace('.', ',')} s` : '') +
        (cam.liviano ? ' · modo liviano (gama baja)' : '') })),
    el('div', { class: 'hoja-botones' }, el('button', { class: 'boton boton-primario', onclick: () => cerrar() }, 'Cerrar'))
  ]);
}

export function iniciar() {
  $('#inicio-buscar').addEventListener('click', abrirBusqueda);
  $('#inicio-cerrar-busqueda').addEventListener('click', cerrarBusqueda);
  $('#inicio-consulta').addEventListener('input', () => { clearTimeout(reloj); reloj = setTimeout(buscar, 150); });
  $('#inicio-consulta').addEventListener('keydown', e => { if (e.key === 'Escape') cerrarBusqueda(); });
  $('#inicio-leer-todo').addEventListener('click', leerPendientes);
  $('#inicio-escanear').addEventListener('click', () => { nuevaSesion(null, 'inicio'); ir('camara'); });
  $('#inicio-importar').addEventListener('click', importar);
  $('#inicio-menu').addEventListener('click', async () => {
    const enLaPapelera = await enPapelera();
    const opcion = await menu([
      { valor: 'respaldar', texto: 'Respaldar todo en un archivo', icono: 'respaldo' },
      { valor: 'restaurar', texto: 'Restaurar un respaldo', icono: 'restaurar' },
      { valor: 'papelera', texto: enLaPapelera ? `Papelera (${enLaPapelera})` : 'Papelera', icono: 'basura' },
      { valor: 'acerca', texto: 'Acerca de ScanLibre', icono: 'info' }
    ]);
    try {
      if (opcion === 'papelera') await mostrarPapelera(() => mostrar());
      else if (opcion === 'respaldar') await respaldar();
      else if (opcion === 'restaurar') await restaurar();
      else if (opcion === 'acerca') await acercaDe();
    } catch (e) {
      aviso('Algo salió mal: ' + e.message, 'error');
    }
  });
}
