// ScanLibre · util.js
// Ayudas de la interfaz: avisos, diálogos, fechas y tamaños.

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

/** Crea un elemento: el('button', { class: 'boton', onclick }, 'Texto', otroNodo) */
export function el(tag, props = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const h of hijos.flat()) if (h !== null && h !== undefined && h !== false) e.append(h);
  return e;
}

/** Ícono del sprite de index.html */
export function icono(nombre) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icono');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '#i-' + nombre);
  svg.append(use);
  return svg;
}

export function nuevoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

const fmtFecha = new Intl.DateTimeFormat('es-HN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtHora = new Intl.DateTimeFormat('es-HN', { hour: 'numeric', minute: '2-digit' });

export function fechaCorta(ms) {
  const d = new Date(ms), hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) return 'Hoy, ' + fmtHora.format(d);
  return fmtFecha.format(d);
}

/** "Escaneo 27 sep 2026 10.42" */
export function nombrePorDefecto(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  const mes = new Intl.DateTimeFormat('es-HN', { month: 'short' }).format(d).replace('.', '');
  return `Escaneo ${d.getDate()} ${mes} ${d.getFullYear()} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

/** "28/09/2026": para la marca de agua */
export function hoyCorto(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "27 sept": para el nombre de los documentos de una carpeta */
export function fechaDeClase(d = new Date()) {
  return `${d.getDate()} ${new Intl.DateTimeFormat('es-HN', { month: 'short' }).format(d).replace('.', '')}`;
}

export function tamanoLegible(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
}

/** Nombre de archivo seguro a partir del nombre del documento */
export function nombreArchivo(nombre, extension) {
  const limpio = String(nombre).normalize('NFC').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Escaneo';
  return `${limpio}.${extension}`;
}

export function paginasTexto(n) {
  return n === 1 ? '1 página' : `${n} páginas`;
}

// ── Avisos cortos abajo de la pantalla ──────────────────────────────
/** @param accion { texto, alTocar } un botón en el aviso (por ejemplo, "Deshacer") */
export function aviso(mensaje, tipo = 'info', ms = 3200, { accion } = {}) {
  const caja = $('#avisos');
  const quitar = () => { a.classList.remove('visible'); setTimeout(() => a.remove(), 300); };
  const a = el('div', { class: `aviso aviso-${tipo}`, role: tipo === 'error' ? 'alert' : 'status' }, el('span', { text: mensaje }),
    accion && el('button', { class: 'aviso-accion', onclick: () => { quitar(); accion.alTocar(); } }, accion.texto));
  caja.append(a);
  requestAnimationFrame(() => a.classList.add('visible'));
  setTimeout(quitar, accion ? Math.max(ms, 6000) : ms);
}

// ── Diálogos ────────────────────────────────────────────────────────
/** Abre un <dialog> armado al vuelo y lo cierra solo. `construir(cerrar)` devuelve el contenido */
export function hoja(construir, { clase = '' } = {}) {
  return new Promise(resolver => {
    const d = el('dialog', { class: 'hoja ' + clase });
    let valor;
    const cerrar = v => { valor = v; d.close(); };
    d.append(...[construir(cerrar)].flat());
    d.addEventListener('close', () => { d.remove(); resolver(valor); });
    // Toque fuera de la hoja (en el fondo oscuro) para cerrarla
    d.addEventListener('click', e => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) cerrar(undefined);
    });
    document.body.append(d);
    d.showModal();
  });
}

export function confirmar(titulo, { detalle = '', aceptar = 'Aceptar', peligro = false } = {}) {
  return hoja(cerrar => [
    el('h2', { class: 'hoja-titulo', text: titulo }),
    detalle && el('p', { class: 'hoja-detalle', text: detalle }),
    el('div', { class: 'hoja-botones' },
      el('button', { class: 'boton boton-secundario', onclick: () => cerrar(false) }, 'Cancelar'),
      el('button', { class: 'boton ' + (peligro ? 'boton-peligro' : 'boton-primario'), onclick: () => cerrar(true) }, aceptar))
  ]).then(v => v === true);
}

export function pedirTexto(titulo, valor = '', { aceptar = 'Guardar', ejemplo, tipo = 'text', detalle } = {}) {
  return hoja(cerrar => {
    const entrada = el('input', { class: 'campo', type: tipo, value: valor, maxlength: 120, 'aria-label': titulo, placeholder: ejemplo, enterkeyhint: 'done', autocomplete: tipo === 'password' ? 'off' : null });
    const listo = () => { const v = entrada.value.trim(); if (v) cerrar(v); };
    entrada.addEventListener('keydown', e => { if (e.key === 'Enter') listo(); });
    setTimeout(() => { entrada.focus(); entrada.select(); }, 50);
    return [
      el('h2', { class: 'hoja-titulo', text: titulo }),
      detalle && el('p', { class: 'hoja-detalle', text: detalle }),
      entrada,
      el('div', { class: 'hoja-botones' },
        el('button', { class: 'boton boton-secundario', onclick: () => cerrar(undefined) }, 'Cancelar'),
        el('button', { class: 'boton boton-primario', onclick: listo }, aceptar))
    ];
  });
}

/** Pide la contraseña de un PDF que se importa (no se guarda en ningún lado) */
export const pedirClaveDePDF = incorrecta => pedirTexto(incorrecta ? 'Contraseña incorrecta' : 'Este PDF tiene contraseña', '', {
  aceptar: 'Abrir', tipo: 'password', ejemplo: 'Contraseña',
  detalle: incorrecta ? 'Prueba otra vez.' : 'Escríbela para importar sus páginas.'
});

/** Menú de opciones [{ valor, texto, icono, peligro }] en una hoja desde abajo */
export function menu(opciones, titulo) {
  return hoja(cerrar => [
    titulo && el('h2', { class: 'hoja-titulo', text: titulo }),
    el('div', { class: 'menu-lista' }, opciones.map(o =>
      el('button', { class: 'menu-opcion' + (o.peligro ? ' peligro' : ''), onclick: () => cerrar(o.valor) },
        o.icono && icono(o.icono), el('span', { text: o.texto }))))
  ]);
}

/** Espera a que el navegador pinte (para que se vea un "Procesando..." antes de trabajar) */
export const pintar = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
