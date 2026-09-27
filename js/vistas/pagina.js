// ScanLibre · vistas/pagina.js
// Una página: filtros, girar, recortar de nuevo, moverla, guardarla o borrarla.

import { $, el, aviso, confirmar, nombreArchivo } from '../util.js';
import { obtenerDocumento, guardarDocumento, obtenerPagina, borrarPagina } from '../db.js';
import { ir, volver } from '../rutas.js';
import { reprocesar } from '../paginas.js';
import { abrirFoto } from '../fotos.js';
import { FILTROS } from '../imagen/filtros.js';
import { cambiarAjuste } from '../ajustes.js';
import { abrirRecorte } from './recorte.js';
import { mostrarTexto } from './texto.js';
import { puedeCompartir, compartir, descargar } from '../exportar.js';

let doc = null, pagina = null, n = 1, url = null, trabajando = false;
const ruta = (...partes) => ['doc', encodeURIComponent(doc.id), ...partes].join('/');

export async function mostrar(params) {
  doc = await obtenerDocumento(params.doc);
  if (!doc) return ir('', { reemplazar: true });
  if (!doc.paginas.length) return ir(ruta(), { reemplazar: true });
  n = Math.min(params.n, doc.paginas.length);
  pagina = await obtenerPagina(doc.paginas[n - 1]);
  pintar();
}

export function ocultar() {
  if (url) URL.revokeObjectURL(url);
  url = null;
}

function pintar() {
  const total = doc.paginas.length;
  $('#pagina-titulo').textContent = `Página ${n} de ${total}`;
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(pagina.procesada);
  const img = $('#pagina-imagen');
  img.src = url;
  img.alt = `Página ${n} de ${doc.nombre}`;
  for (const b of $('#pagina-filtros').children) b.setAttribute('aria-pressed', String(b.dataset.filtro === pagina.filtro));
  $('#pagina-anterior').disabled = n <= 1;
  $('#pagina-siguiente').disabled = n >= total;
  $('#pagina-mover-antes').disabled = n <= 1;
  $('#pagina-mover-despues').disabled = n >= total;
}

/** Corre un cambio con el aviso de "Procesando…" encima de la página */
async function conEspera(trabajo) {
  if (trabajando) return;
  trabajando = true;
  $('#pagina-procesando').hidden = false;
  try {
    await trabajo();
  } catch (e) {
    console.error(e);
    aviso('No se pudo cambiar la página: ' + e.message, 'error');
  } finally {
    trabajando = false;
    $('#pagina-procesando').hidden = true;
  }
}

const cambiar = cambios => conEspera(async () => { pagina = await reprocesar(pagina, cambios); pintar(); });

async function mover(paso) {
  const destino = n - 1 + paso;
  if (destino < 0 || destino >= doc.paginas.length) return;
  const orden = [...doc.paginas];
  [orden[n - 1], orden[destino]] = [orden[destino], orden[n - 1]];
  doc.paginas = orden;
  doc.modificado = Date.now();
  await guardarDocumento(doc);
  ir(ruta('pagina', destino + 1), { reemplazar: true });
  aviso(`Ahora es la página ${destino + 1}.`);
}

async function recortar() {
  const bitmap = await abrirFoto(pagina.original);
  const actual = pagina;
  abrirRecorte({
    fuente: bitmap,
    esquinas: actual.esquinas,
    alListo: async esquinas => {
      await reprocesar(actual, { esquinas });
      volver(ruta('pagina', n));
    },
    alCancelar: () => volver(ruta('pagina', n))
  });
}

async function guardarImagen() {
  const nombre = nombreArchivo(`${doc.nombre} - página ${n}`, pagina.procesada.type === 'image/png' ? 'png' : 'jpg');
  if (puedeCompartir(pagina.procesada, nombre)) {
    try { await compartir(pagina.procesada, nombre); } catch (e) { descargar(pagina.procesada, nombre); }
  } else {
    descargar(pagina.procesada, nombre);
  }
}

async function borrar() {
  const si = await confirmar(`¿Eliminar la página ${n}?`, { detalle: 'Las demás páginas quedan como están.', aceptar: 'Eliminar', peligro: true });
  if (!si) return;
  await borrarPagina(doc.id, pagina.id);
  const quedan = doc.paginas.length - 1;
  aviso('Página eliminada.');
  if (!quedan) volver(ruta());
  else ir(ruta('pagina', Math.min(n, quedan)), { reemplazar: true });
}

export function iniciar() {
  $('#pagina-filtros').replaceChildren(...Object.entries(FILTROS).map(([valor, texto]) =>
    el('button', { class: 'filtro', 'data-filtro': valor, 'aria-pressed': 'false', onclick: () => {
      if (!pagina || pagina.filtro === valor) return;
      cambiarAjuste('filtro', valor); // las páginas nuevas salen con el último filtro elegido
      cambiar({ filtro: valor });
    } }, texto)));
  $('#pagina-atras').addEventListener('click', () => volver(ruta()));
  $('#pagina-anterior').addEventListener('click', () => ir(ruta('pagina', n - 1), { reemplazar: true }));
  $('#pagina-siguiente').addEventListener('click', () => ir(ruta('pagina', n + 1), { reemplazar: true }));
  $('#pagina-girar-izq').addEventListener('click', () => cambiar({ rotacion: (pagina.rotacion + 3) % 4 }));
  $('#pagina-girar-der').addEventListener('click', () => cambiar({ rotacion: (pagina.rotacion + 1) % 4 }));
  $('#pagina-recortar').addEventListener('click', recortar);
  $('#pagina-mover-antes').addEventListener('click', () => mover(-1));
  $('#pagina-mover-despues').addEventListener('click', () => mover(1));
  $('#pagina-texto').addEventListener('click', () => { if (pagina) mostrarTexto([pagina], { titulo: `Texto de la página ${n}` }); });
  $('#pagina-guardar').addEventListener('click', guardarImagen);
  $('#pagina-borrar').addEventListener('click', borrar);
}
