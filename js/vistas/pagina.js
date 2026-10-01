// ScanLibre · vistas/pagina.js
// Una página: filtros, brillo, girar, recortar de nuevo, marcarla, moverla, guardarla o borrarla.

import { $, el, aviso, confirmar, nombreArchivo, menu, pedirTexto, hoyCorto } from '../util.js';
import { dibujarMarcaDeAgua } from '../marcas.js';
import { obtenerDocumento, guardarDocumento, obtenerPagina, moverPaginas, paginasAPapelera, recuperarPagina, DIAS_PAPELERA } from '../db.js';
import { ir, volver } from '../rutas.js';
import { reprocesar, esBorrosa, separarLibro, baseParaLuz, conLuz, lienzoConMarcas, nuevoDocumento, noEsRepetida } from '../paginas.js';
import { nuevaSesion } from './camara.js';
import { abrirFoto, canvasABlob, soltarCanvas } from '../fotos.js';
import { FILTROS } from '../imagen/filtros.js';
import { ajustes, cambiarAjuste } from '../ajustes.js';
import { abrirRecorte } from './recorte.js';
import { crearZoom } from '../visorZoom.js';
import { mostrarTexto } from './texto.js';
import { editarPortada } from './portada.js';
import { mostrarCodigo } from './codigo.js';
import { puedeCompartir, compartir, descargar } from '../exportar.js';

let doc = null, pagina = null, n = 1, url = null, trabajando = false, turnoImagen = 0;
let luz = null; // mientras se ajusta el brillo: { base, brillo, contraste, ocupado, otra }
let zoom = null; // acercar la página (pellizcar, doble toque, arrastrar)
const ruta = (...partes) => ['doc', encodeURIComponent(doc.id), ...partes].join('/');

export async function mostrar(params) {
  doc = await obtenerDocumento(params.doc);
  if (!doc || doc.papelera) return ir('', { reemplazar: true });
  if (!doc.paginas.length) return ir(ruta(), { reemplazar: true });
  n = Math.min(params.n, doc.paginas.length);
  pagina = await obtenerPagina(doc.paginas[n - 1]);
  cerrarLuz();
  pintar();
}

export function ocultar() {
  cerrarLuz();
  turnoImagen++;
  if (url) URL.revokeObjectURL(url);
  url = null;
}

function pintar() {
  const total = doc.paginas.length;
  $('#pagina-titulo').textContent = `Página ${n} de ${total}`;
  zoom?.reset();
  const imagen = ponerImagen();
  for (const b of $('#pagina-filtros').children) b.setAttribute('aria-pressed', String(b.dataset.filtro === pagina.filtro));
  $('#pagina-anterior').disabled = n <= 1;
  $('#pagina-siguiente').disabled = n >= total;
  $('#pagina-borrosa').hidden = !esBorrosa(pagina);
  // Solo se muestra si hubo que enderezarla (o si se deshizo): en una hoja plana no dice nada
  // (las páginas de un PDF o de una cédula ya vienen listas: no se enderezan ni se buscan dedos)
  const yaLista = pagina.modo === 'pdf' || pagina.modo === 'cedula' || pagina.modo === 'portada';
  const sinAplanar = pagina.aplanar === false;
  $('#pagina-curva').hidden = yaLista || (!pagina.aplanada && !sinAplanar);
  $('#pagina-curva-texto').textContent = sinAplanar ? 'Página sin enderezar.' : 'Se enderezaron los renglones curvos.';
  $('#pagina-curva-boton').textContent = sinAplanar ? 'Enderezar' : 'Deshacer';
  // Igual con los dedos tapados
  const conDedos = pagina.dedos === false;
  $('#pagina-dedos').hidden = yaLista || (!pagina.sinDedos && !conDedos);
  $('#pagina-portada').hidden = pagina.modo !== 'portada';
  const igualA = pagina.repetida && doc.paginas.includes(pagina.repetida) ? doc.paginas.indexOf(pagina.repetida) + 1 : 0;
  $('#pagina-repetida').hidden = !igualA;
  if (igualA) $('#pagina-repetida-texto').textContent = `Parece igual a la página ${igualA}.`;
  $('#pagina-dedos-texto').textContent = conDedos ? 'Dedos sin tapar.' : 'Se taparon los dedos de los bordes.';
  $('#pagina-dedos-boton').textContent = conDedos ? 'Tapar' : 'Deshacer';
  return imagen;
}

/** La imagen de la página; si tiene marcas, con ellas encima */
async function ponerImagen() {
  const turno = ++turnoImagen, p = pagina;
  let blob = p.procesada;
  if (p.marcas?.length) {
    try {
      const c = await lienzoConMarcas(p, 2400);
      blob = await canvasABlob(c, 'image/jpeg', 0.9);
      soltarCanvas(c);
    } catch (e) { console.error(e); }
  }
  if (turno !== turnoImagen) return;
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(blob);
  const img = $('#pagina-imagen');
  img.src = url;
  img.alt = `Página ${n} de ${doc.nombre}` + (p.marcas?.length ? ' (con marcas)' : '');
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

const cambiar = cambios => conEspera(async () => { pagina = await reprocesar(pagina, cambios); await pintar(); });

// ── Brillo y contraste ──────────────────────────────────────────────
// Mientras se mueven las barras se ve cómo queda, con la página más chica;
// con "Listo" se arma la página de verdad.
async function abrirLuz() {
  if (!pagina || luz || trabajando) return;
  const esta = pagina;
  let base = null;
  await conEspera(async () => { base = await baseParaLuz(esta); });
  if (!base || pagina !== esta || luz) return;
  // La vista previa se arma aparte: "Listo" se puede tocar aunque todavía no esté
  luz = { base, brillo: esta.brillo || 0, contraste: esta.contraste || 0, ocupado: false, otra: false };
  $('#pagina-brillo').value = luz.brillo;
  $('#pagina-contraste').value = luz.contraste;
  const bn = esta.filtro === 'bn';
  $('#pagina-contraste-fila').hidden = bn;
  $('#pagina-luz-bn').hidden = !bn;
  $('#pagina-filtros').hidden = $('#pagina-herramientas').hidden = true;
  $('#pagina-anterior').disabled = $('#pagina-siguiente').disabled = true;
  zoom?.reset();
  $('#pagina-luz').hidden = false;
  verLuz();
}

function numeros() {
  const txt = v => (v > 0 ? '+' : '') + v;
  $('#pagina-brillo-valor').textContent = txt(luz.brillo);
  $('#pagina-contraste-valor').textContent = txt(luz.contraste);
}

/** Pinta la vista previa; si llegan cambios mientras se arma, al terminar se arma la última */
async function verLuz() {
  if (!luz) return;
  numeros();
  if (luz.ocupado) { luz.otra = true; return; }
  luz.ocupado = true;
  const actual = luz;
  try {
    const img = await conLuz(actual.base, pagina.filtro, actual.brillo, pagina.filtro === 'bn' ? 0 : actual.contraste);
    if (luz !== actual) return;
    const c = $('#pagina-previa');
    if (c.width !== img.width || c.height !== img.height) { c.width = img.width; c.height = img.height; }
    c.getContext('2d').putImageData(img, 0, 0);
    c.hidden = false;
    $('#pagina-imagen').hidden = true;
  } catch (e) {
    console.error(e);
  } finally {
    actual.ocupado = false;
    if (actual.otra && luz === actual) { actual.otra = false; verLuz(); }
  }
}

/** Cierra las barras. Con `dejarVista`, la vista previa queda hasta que esté la página nueva */
function cerrarLuz({ dejarVista = false } = {}) {
  if (!luz && $('#pagina-luz').hidden) return;
  luz = null;
  $('#pagina-luz').hidden = true;
  $('#pagina-filtros').hidden = $('#pagina-herramientas').hidden = false;
  if (!dejarVista) quitarVista();
  if (doc && pagina) {
    $('#pagina-anterior').disabled = n <= 1;
    $('#pagina-siguiente').disabled = n >= doc.paginas.length;
  }
}

function quitarVista() {
  const c = $('#pagina-previa');
  c.hidden = true;
  c.width = c.height = 0;
  $('#pagina-imagen').hidden = false;
}

async function listoLuz() {
  if (!luz) return;
  const brillo = luz.brillo, contraste = pagina.filtro === 'bn' ? (pagina.contraste || 0) : luz.contraste;
  if (brillo === (pagina.brillo || 0) && contraste === (pagina.contraste || 0)) return cerrarLuz();
  cerrarLuz({ dejarVista: true });
  await cambiar({ brillo, contraste });
  await $('#pagina-imagen').decode?.().catch(() => {});
  quitarVista();
}

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

async function guardarImagen({ conMarcaDeAgua = false } = {}) {
  let marca = '';
  if (conMarcaDeAgua) {
    const texto = await pedirTexto('Marca de agua', ajustes().marcaDeAgua || '', {
      aceptar: 'Guardar imagen', ejemplo: 'Por ejemplo: Solo para trámite en el banco',
      detalle: `Va cruzada sobre toda la página, con la fecha de hoy (${hoyCorto()}).`
    });
    if (!texto) return;
    cambiarAjuste('marcaDeAgua', texto);
    marca = `${texto} · ${hoyCorto()}`;
  }
  let blob = pagina.procesada;
  // Con las marcas (y la marca de agua): la página entera con ellas encima
  if (pagina.marcas?.length || marca) {
    const c = await lienzoConMarcas(pagina);
    if (marca) dibujarMarcaDeAgua(c.getContext('2d'), marca, c.width, c.height);
    blob = await canvasABlob(c, 'image/jpeg', 0.92);
    soltarCanvas(c);
  }
  const nombre = nombreArchivo(`${doc.nombre} - página ${n}`, blob.type === 'image/png' ? 'png' : 'jpg');
  if (puedeCompartir(blob, nombre)) {
    try { await compartir(blob, nombre); } catch (e) { descargar(blob, nombre); }
  } else {
    descargar(blob, nombre);
  }
}

async function borrar() {
  const si = await confirmar(`¿Eliminar la página ${n}?`, { detalle: `Las demás páginas quedan como están. Esta queda ${DIAS_PAPELERA} días en la papelera.`, aceptar: 'Eliminar', peligro: true });
  if (!si) return;
  const { id: docId } = doc, { id } = pagina, numero = n;
  await paginasAPapelera(docId, [id]);
  const quedan = doc.paginas.length - 1;
  aviso('Página eliminada.', 'info', 6000, { accion: { texto: 'Deshacer', alTocar: async () => {
    await recuperarPagina(id);
    aviso('Listo: la página volvió a su lugar.', 'exito');
    ir(`doc/${encodeURIComponent(docId)}/pagina/${numero}`, { reemplazar: true });
  } } });
  if (!quedan) volver(ruta());
  else ir(ruta('pagina', Math.min(n, quedan)), { reemplazar: true });
}

/** Los códigos QR que hay en la página (una factura, una guía, un afiche) */
async function codigosDeLaPagina() {
  let codigos = null;
  await conEspera(async () => {
    const { leerCodigos } = await import('../codigos.js');
    const bmp = await abrirFoto(pagina.procesada);
    try { codigos = await leerCodigos(bmp, { varios: true }); } finally { bmp.close?.(); }
  });
  // La hoja con lo que dice el código se abre ya sin el "Procesando…"
  if (!codigos) return;
  if (!codigos.length) return aviso('No encontré códigos QR en esta página.');
  let elegido = codigos[0];
  if (codigos.length > 1) {
    const i = await menu(codigos.map((c, k) => ({ valor: k, texto: c.texto.length > 60 ? c.texto.slice(0, 57) + '…' : c.texto, icono: 'qr' })), `${codigos.length} códigos en la página`);
    if (i === undefined) return;
    elegido = codigos[i];
  }
  await mostrarCodigo(elegido.texto);
}

/** Desde esta página hasta el final pasa a un documento nuevo */
async function dividir() {
  const total = doc.paginas.length;
  const nombre = await pedirTexto('Nombre del documento nuevo', `${doc.nombre} (${n}–${total})`.replace(`(${total}–${total})`, `(${total})`), { aceptar: 'Dividir' });
  if (!nombre) return;
  const nuevo = await nuevoDocumento(doc.carpetaId || null);
  nuevo.nombre = nombre;
  await guardarDocumento(nuevo);
  await moverPaginas(doc.id, nuevo.id, doc.paginas.slice(n - 1));
  aviso(`Listo: «${doc.nombre}» quedó con ${n - 1 === 1 ? '1 página' : `${n - 1} páginas`} y el resto está en «${nombre}».`, 'exito', 5000);
  ir('doc/' + encodeURIComponent(nuevo.id), { reemplazar: true });
}

/** Lo que se usa menos va en "Más" */
async function masOpciones() {
  if (!pagina) return;
  const total = doc.paginas.length;
  const opcion = await menu([
    n > 1 && { valor: 'antes', texto: 'Mover una página antes', icono: 'antes' },
    n < total && { valor: 'despues', texto: 'Mover una página después', icono: 'despues' },
    { valor: 'separar', texto: 'Libro abierto: separar en dos páginas', icono: 'libro' },
    n > 1 && { valor: 'dividir', texto: `Dividir aquí: de la página ${n} en adelante, un documento nuevo`, icono: 'pdf' },
    { valor: 'imagen', texto: 'Guardar como imagen', icono: 'descargar' },
    { valor: 'imagen-marca', texto: 'Guardar como imagen con marca de agua', icono: 'descargar' },
    { valor: 'codigos', texto: 'Leer códigos QR de la página', icono: 'qr' }
  ].filter(Boolean), `Página ${n}`);
  if (opcion === 'antes') mover(-1);
  else if (opcion === 'despues') mover(1);
  else if (opcion === 'separar') separar();
  else if (opcion === 'dividir') dividir();
  else if (opcion === 'imagen') guardarImagen();
  else if (opcion === 'imagen-marca') guardarImagen({ conMarcaDeAgua: true });
  else if (opcion === 'codigos') codigosDeLaPagina();
}

// Libro abierto en una sola página: se separa en dos (la derecha queda después)
const separar = async () => {
  if (!pagina || trabajando) return;
  if (pagina.marcas?.length && !await confirmar('¿Separar la página?', { detalle: 'Las marcas de esta página (resaltador, notas y firma) se quitan al separarla.', aceptar: 'Separar' })) return;
  return separarYa();
};
const separarYa = () => conEspera(async () => {
  if (!pagina) return;
  const r = await separarLibro(pagina);
  if (!r) return aviso('No encontré el lomo del libro. Si es un libro abierto, toca Recortar y deja adentro las dos páginas.', 'error', 6000);
  doc = await obtenerDocumento(doc.id);
  pagina = r[0];
  pintar();
  aviso(`Listo: quedaron las páginas ${n} y ${n + 1}.`, 'exito');
});

export function iniciar() {
  zoom = crearZoom($('.pagina-hoja'), $('#pagina-imagen'));
  $('#pagina-filtros').replaceChildren(...Object.entries(FILTROS).map(([valor, texto]) =>
    el('button', { class: 'filtro', 'data-filtro': valor, 'aria-pressed': 'false', onclick: () => {
      if (!pagina || pagina.filtro === valor) return;
      cambiarAjuste('filtro', valor); // las páginas nuevas salen con el último filtro elegido
      cambiar({ filtro: valor });
    } }, texto)));
  $('#pagina-atras').addEventListener('click', () => volver(ruta()));
  $('#pagina-retomar').addEventListener('click', () => {
    nuevaSesion(doc.id, 'pagina', { id: pagina.id, n });
    ir('camara?doc=' + encodeURIComponent(doc.id));
  });
  $('#pagina-anterior').addEventListener('click', () => ir(ruta('pagina', n - 1), { reemplazar: true }));
  $('#pagina-siguiente').addEventListener('click', () => ir(ruta('pagina', n + 1), { reemplazar: true }));
  $('#pagina-girar-izq').addEventListener('click', () => cambiar({ rotacion: (pagina.rotacion + 3) % 4 }));
  $('#pagina-girar-der').addEventListener('click', () => cambiar({ rotacion: (pagina.rotacion + 1) % 4 }));
  $('#pagina-recortar').addEventListener('click', recortar);
  $('#pagina-curva-boton').addEventListener('click', () => { if (pagina) cambiar({ aplanar: pagina.aplanar === false }); });
  $('#pagina-dedos-boton').addEventListener('click', () => { if (pagina) cambiar({ dedos: pagina.dedos === false }); });
  $('#pagina-luz-abrir').addEventListener('click', abrirLuz);
  for (const [id, clave] of [['#pagina-brillo', 'brillo'], ['#pagina-contraste', 'contraste']]) {
    $(id).addEventListener('input', e => { if (luz) { luz[clave] = Number(e.target.value); verLuz(); } });
  }
  $('#pagina-luz-restablecer').addEventListener('click', () => {
    if (!luz) return;
    luz.brillo = luz.contraste = 0;
    $('#pagina-brillo').value = $('#pagina-contraste').value = 0;
    verLuz();
  });
  $('#pagina-luz-cancelar').addEventListener('click', () => cerrarLuz());
  $('#pagina-luz-listo').addEventListener('click', listoLuz);
  $('#pagina-mas').addEventListener('click', masOpciones);
  $('#pagina-repetida-quitar').addEventListener('click', borrar);
  $('#pagina-repetida-no').addEventListener('click', async () => {
    if (!pagina) return;
    await noEsRepetida(pagina.id);
    pagina = await obtenerPagina(pagina.id);
    pintar();
  });
  $('#pagina-portada-boton').addEventListener('click', async () => {
    if (!pagina || trabajando) return;
    const id = doc.id;
    if (!await editarPortada(id)) return;
    const d = await obtenerDocumento(id);
    // Si se quitó, se vuelve al documento
    if (d.paginas.includes(pagina.id)) mostrar({ doc: id, n }); else ir(`doc/${encodeURIComponent(id)}`, { reemplazar: true });
  });
  $('#pagina-marcar').addEventListener('click', () => { if (pagina && !trabajando) ir(ruta('pagina', n, 'marcar')); });
  $('#pagina-texto').addEventListener('click', () => { if (pagina) mostrarTexto([pagina], { titulo: `Texto de la página ${n}`, nombre: `${doc.nombre} – página ${n}` }); });
  $('#pagina-borrar').addEventListener('click', borrar);
}
