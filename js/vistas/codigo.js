// ScanLibre · vistas/codigo.js
// Lo que dice un código QR: un enlace (se ve a qué sitio lleva antes de
// abrirlo), una red Wi-Fi (con su contraseña para copiar), un correo, un
// teléfono, un contacto o texto.

import { el, icono, hoja, aviso } from '../util.js';
import { interpretar } from '../codigos.js';

async function copiar(texto, que = 'Copiado.') {
  try { await navigator.clipboard.writeText(texto); aviso(que, 'exito'); }
  catch (e) { aviso('No se pudo copiar.', 'error'); }
}

const TITULOS = { enlace: 'Enlace', wifi: 'Red Wi-Fi', correo: 'Correo', telefono: 'Teléfono', contacto: 'Contacto', texto: 'Texto del código' };

/** Muestra lo que dice el código; se resuelve al cerrarse la hoja */
export function mostrarCodigo(texto) {
  const c = interpretar(texto);
  return hoja(cerrar => {
    const dato = (etiqueta, valor) => valor && el('div', { class: 'codigo-dato' }, el('small', { text: etiqueta }), el('strong', { text: valor }));
    const partes = [el('h2', { class: 'hoja-titulo', text: TITULOS[c.tipo] })];
    const botones = [];
    const compartir = navigator.share && el('button', { class: 'boton boton-secundario', onclick: async () => {
      try { await navigator.share(c.tipo === 'enlace' ? { url: c.url } : { text: c.texto }); } catch (e) {}
    } }, icono('compartir'), 'Compartir');
    if (c.tipo === 'enlace') {
      partes.push(
        dato('Lleva a', c.sitio),
        el('p', { class: 'codigo-texto', text: c.url }),
        el('p', { class: 'hoja-detalle', text: c.seguro
          ? 'Ábrelo solo si confías en quien te dio el código: un QR puede llevar a una página falsa.'
          : 'Ojo: no es una conexión segura (https). Ábrelo solo si confías en quien te dio el código.' }));
      botones.push(el('button', { class: 'boton boton-secundario', onclick: () => copiar(c.url, 'Enlace copiado.') }, icono('copiar'), 'Copiar'),
        el('button', { class: 'boton boton-primario', onclick: () => { window.open(c.url, '_blank', 'noopener'); cerrar(); } }, 'Abrir'));
    } else if (c.tipo === 'wifi') {
      partes.push(dato('Nombre de la red', c.red), dato('Contraseña', c.clave || '(sin contraseña)'),
        el('p', { class: 'hoja-detalle', text: 'Copia la contraseña y pégala al conectarte a la red en los ajustes del teléfono.' }));
      if (c.clave) botones.push(el('button', { class: 'boton boton-primario', onclick: () => copiar(c.clave, 'Contraseña copiada.') }, icono('copiar'), 'Copiar contraseña'));
    } else if (c.tipo === 'correo' || c.tipo === 'telefono') {
      partes.push(dato(c.tipo === 'correo' ? 'Correo' : 'Número', c.correo || c.telefono));
      botones.push(el('button', { class: 'boton boton-secundario', onclick: () => copiar(c.correo || c.telefono) }, icono('copiar'), 'Copiar'),
        el('button', { class: 'boton boton-primario', onclick: () => { location.href = c.url; cerrar(); } }, c.tipo === 'correo' ? 'Escribir' : 'Llamar'));
    } else if (c.tipo === 'contacto') {
      partes.push(dato('Nombre', c.nombre), dato('Teléfono', c.telefono), dato('Correo', c.correo));
      botones.push(el('button', { class: 'boton boton-primario', onclick: () => copiar([c.nombre, c.telefono, c.correo].filter(Boolean).join('\n')) }, icono('copiar'), 'Copiar'));
    } else {
      partes.push(el('p', { class: 'codigo-texto', text: c.texto }));
      botones.push(el('button', { class: 'boton boton-primario', onclick: () => copiar(c.texto) }, icono('copiar'), 'Copiar'));
    }
    return [...partes, el('div', { class: 'hoja-botones' }, compartir, ...botones)];
  });
}
