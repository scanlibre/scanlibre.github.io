// ScanLibre · vistas/inicio.js
// La lista de documentos, el botón de escanear y el menú de respaldo.

import { $, el, fechaCorta, paginasTexto, aviso, menu, hoja, tamanoLegible } from '../util.js';
import { listarDocumentos, obtenerPagina } from '../db.js';
import { ir } from '../rutas.js';
import { nuevaSesion } from './camara.js';
import { nuevoDocumento, importarArchivos } from '../paginas.js';
import { elegirArchivos } from '../archivos.js';
import { crearRespaldo, restaurarRespaldo } from '../respaldo.js';
import { puedeCompartir, compartir, descargar } from '../exportar.js';

let urls = [];
const soltarUrls = () => { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; };

export async function mostrar() {
  const docs = await listarDocumentos();
  soltarUrls();
  const lista = $('#inicio-lista');
  const items = await Promise.all(docs.map(async doc => {
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
          el('div', { class: 'doc-detalle', text: `${paginasTexto(doc.paginas.length)} · ${fechaCorta(doc.modificado)}` }))));
  }));
  lista.replaceChildren(...items);
  $('#inicio-vacio').hidden = docs.length > 0;
}

export function ocultar() { soltarUrls(); }

async function importar() {
  const archivos = await elegirArchivos('entrada-fotos');
  if (!archivos.length) return;
  const doc = await nuevoDocumento();
  importarArchivos(doc.id, archivos);
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
  return hoja(cerrar => [
    el('h2', { class: 'hoja-titulo', text: 'ScanLibre' }),
    el('div', { class: 'acerca' },
      el('p', { text: 'Escáner de documentos gratis para estudiantes. Sin marca de agua, sin anuncios y sin cuenta.' }),
      el('ul', {},
        el('li', { text: 'Tus fotos se procesan aquí, en tu teléfono: nada se sube a internet.' }),
        el('li', { text: 'Tus documentos se guardan solo en este navegador. Haz un respaldo de vez en cuando.' }),
        el('li', { text: 'Funciona sin conexión después de abrirla una vez.' })),
      el('p', { text: 'El código está en github.com/scanlibre/scanlibre.github.io' })),
    el('div', { class: 'hoja-botones' }, el('button', { class: 'boton boton-primario', onclick: () => cerrar() }, 'Cerrar'))
  ]);
}

export function iniciar() {
  $('#inicio-escanear').addEventListener('click', () => { nuevaSesion(null, 'inicio'); ir('camara'); });
  $('#inicio-importar').addEventListener('click', importar);
  $('#inicio-menu').addEventListener('click', async () => {
    const opcion = await menu([
      { valor: 'respaldar', texto: 'Respaldar todo en un archivo', icono: 'respaldo' },
      { valor: 'restaurar', texto: 'Restaurar un respaldo', icono: 'restaurar' },
      { valor: 'acerca', texto: 'Acerca de ScanLibre', icono: 'info' }
    ]);
    try {
      if (opcion === 'respaldar') await respaldar();
      else if (opcion === 'restaurar') await restaurar();
      else if (opcion === 'acerca') await acercaDe();
    } catch (e) {
      aviso('Algo salió mal: ' + e.message, 'error');
    }
  });
}
