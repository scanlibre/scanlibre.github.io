// ScanLibre · vistas/portada.js
// Hoja para llenar la portada del trabajo. Lo tuyo (universidad, carrera,
// nombre y cuenta, lugar, letra y logo) y lo de cada clase (asignatura,
// sección y catedrático, por carpeta) se recuerda para la próxima portada.

import { el, icono, hoja, aviso, confirmar } from '../util.js';
import { obtenerDocumento, paginasDe, listarCarpetas, guardarPagina, insertarPaginaEn, borrarPagina } from '../db.js';
import { paginaDePortada } from '../paginas.js';
import { ESTILOS, fechaLarga } from '../portada.js';
import { ajustes, cambiarAjuste } from '../ajustes.js';
import { elegirArchivos } from '../archivos.js';
import { abrirFoto, aCanvas, soltarCanvas } from '../fotos.js';

const CAMPOS = [
  ['universidad', 'Universidad', 'Universidad Nacional Autónoma de Honduras'],
  ['facultad', 'Facultad o carrera', 'Facultad de Ingeniería'],
  ['asignatura', 'Asignatura', 'Matemática I'],
  ['seccion', 'Sección', '0800'],
  ['catedratico', 'Catedrático(a)', 'Lic. Ana Martínez'],
  ['tema', 'Tema del trabajo', 'Tarea 1: Límites y continuidad', 2],
  ['integrantes', 'Presentado por (uno por renglón, con su número de cuenta)', 'María López · 20211000123', 3],
  ['lugar', 'Lugar', 'Ciudad Universitaria, Tegucigalpa'],
  ['fecha', 'Fecha', '']
];
const DE_LA_CLASE = ['asignatura', 'seccion', 'catedratico'];
const MIOS = ['universidad', 'facultad', 'integrantes', 'lugar', 'estilo', 'logo'];

/** El nombre del documento sirve de tema, salvo si es el que se pone solo */
function temaDe(doc, carpeta) {
  if (/^Escaneo \d/.test(doc.nombre)) return '';
  if (carpeta && doc.nombre.startsWith(`${carpeta.nombre} – `)) return '';
  return doc.nombre;
}

/** El logo elegido, achicado (máximo 600 px) y en PNG para guardarlo con la portada */
async function leerLogo() {
  const [archivo] = await elegirArchivos('entrada-logo');
  if (!archivo) return null;
  const bmp = await abrirFoto(archivo);
  const c = aCanvas(bmp, 600);
  bmp.close?.();
  try { return c.toDataURL('image/png'); } finally { soltarCanvas(c); }
}

function formulario(inicial, { editando }) {
  const valores = { ...inicial };
  return hoja(cerrar => {
    const entradas = {};
    const filas = CAMPOS.map(([clave, texto, ejemplo, renglones]) => {
      const e = renglones
        ? el('textarea', { class: 'campo campo-portada', rows: renglones, placeholder: ejemplo, 'data-campo': clave })
        : el('input', { class: 'campo', type: 'text', placeholder: ejemplo, 'data-campo': clave, enterkeyhint: 'next' });
      e.value = valores[clave] || '';
      entradas[clave] = e;
      return el('label', { class: 'etiqueta' }, el('span', { text: texto }), e);
    });
    const estilos = Object.entries(ESTILOS).map(([clave, v]) => {
      const b = el('button', { class: 'opcion', 'aria-pressed': String((valores.estilo || 'clasica') === clave), 'data-estilo': clave, onclick: () => {
        valores.estilo = clave;
        estilos.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      } }, el('strong', { text: v.texto }), el('small', { text: v.detalle }));
      return b;
    });
    const muestra = el('img', { class: 'logo-muestra', alt: 'Logo', hidden: !valores.logo });
    if (valores.logo) muestra.src = valores.logo;
    const quitarLogo = el('button', { class: 'boton boton-fantasma', hidden: !valores.logo, onclick: () => {
      valores.logo = null; muestra.hidden = true; quitarLogo.hidden = true;
    } }, 'Quitar');
    const ponerLogo = el('button', { class: 'boton boton-secundario', onclick: async () => {
      try {
        const logo = await leerLogo();
        if (!logo) return;
        valores.logo = logo; muestra.src = logo; muestra.hidden = false; quitarLogo.hidden = false;
      } catch (e) { aviso('No se pudo abrir esa imagen.', 'error'); }
    } }, icono('galeria'), 'Logo');
    const listo = () => {
      for (const [clave] of CAMPOS) valores[clave] = entradas[clave].value.trim();
      if (!valores.tema && !valores.asignatura && !valores.integrantes) { aviso('Escribe al menos el tema, la asignatura o quién lo presenta.', 'error'); return; }
      cerrar(valores);
    };
    return [
      el('h2', { class: 'hoja-titulo', text: editando ? 'Cambiar la portada' : 'Portada del trabajo' }),
      el('p', { class: 'hoja-detalle', text: 'Queda como la página 1. Tus datos y los de esta clase se recuerdan para la próxima.' }),
      ...filas,
      el('div', { class: 'grupo' }, el('h3', { class: 'grupo-titulo', text: 'Letra' }), el('div', { class: 'opciones opciones-dos' }, estilos)),
      el('div', { class: 'grupo' }, el('h3', { class: 'grupo-titulo', text: 'Logo (opcional)' }),
        el('div', { class: 'fila-logo' }, muestra, ponerLogo, quitarLogo)),
      el('div', { class: 'hoja-botones' },
        editando
          ? el('button', { class: 'boton boton-secundario peligro-texto', onclick: () => cerrar({ quitar: true }) }, icono('basura'), 'Quitar')
          : el('button', { class: 'boton boton-secundario', onclick: () => cerrar(undefined) }, 'Cancelar'),
        el('button', { class: 'boton boton-primario', onclick: listo }, icono('listo'), editando ? 'Guardar' : 'Poner portada'))
    ];
  });
}

/** Pone o cambia la portada del documento. Devuelve true si cambió algo */
export async function editarPortada(docId) {
  const doc = await obtenerDocumento(docId);
  const actual = (await paginasDe(doc)).find(p => p.modo === 'portada');
  const carpeta = doc.carpetaId ? (await listarCarpetas()).find(c => c.id === doc.carpetaId) : null;
  const perfil = ajustes().perfil || {};
  const clase = (ajustes().portadas || {})[doc.carpetaId || '_'] || {};
  const inicial = actual?.portada || {
    universidad: perfil.universidad || '', facultad: perfil.facultad || '', integrantes: perfil.integrantes || '',
    lugar: perfil.lugar || '', estilo: perfil.estilo || 'clasica', logo: perfil.logo || null,
    asignatura: clase.asignatura || carpeta?.nombre || '', seccion: clase.seccion || '', catedratico: clase.catedratico || '',
    tema: temaDe(doc, carpeta), fecha: fechaLarga()
  };
  const campos = await formulario(inicial, { editando: !!actual });
  if (!campos) return false;
  if (campos.quitar) {
    if (!await confirmar('¿Quitar la portada?', { detalle: 'Las demás páginas quedan como están.', aceptar: 'Quitar', peligro: true })) return false;
    await borrarPagina(docId, actual.id);
    aviso('Se quitó la portada.');
    return true;
  }
  // Para la próxima portada
  cambiarAjuste('perfil', Object.fromEntries(MIOS.map(k => [k, campos[k] || (k === 'logo' ? null : '')])));
  cambiarAjuste('portadas', { ...(ajustes().portadas || {}), [doc.carpetaId || '_']: Object.fromEntries(DE_LA_CLASE.map(k => [k, campos[k] || ''])) });
  aviso('Armando la portada…');
  if (actual) {
    await guardarPagina(await paginaDePortada(campos, { anterior: actual }));
    aviso('Listo: se cambió la portada.', 'exito');
  } else {
    await insertarPaginaEn(docId, await paginaDePortada(campos), 0);
    aviso('Listo: la portada es la página 1.', 'exito');
  }
  return true;
}
