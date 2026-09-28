// ScanLibre · vistas/traduccion.js
// Traducir el texto al inglés o al español, siempre dentro del teléfono: la
// app no manda el texto a internet. Si el teléfono no trae traductor, se puede
// pasar el texto a otra app (la que la persona elija).

import { el, icono, hoja, aviso, menu } from '../util.js';
import { LENGUAS, traductorDelTelefono, traducir } from '../traducir.js';
import { puedeHablar, crearLector } from '../voz.js';

/**
 * @param texto   lo que se traduce
 * @param ingles  si el texto está en inglés (así "al español" va primero)
 * @param nombre  para el Word de la traducción
 */
export async function traducirTexto(texto, { ingles = false, nombre = 'Traducción' } = {}) {
  if (!texto.trim()) return;
  const opciones = [{ valor: 'en', texto: 'Al inglés', icono: 'traducir' }, { valor: 'es', texto: 'Al español', icono: 'traducir' }];
  const a = await menu(ingles ? opciones.reverse() : opciones, 'Traducir');
  if (!a) return;
  const de = a === 'en' ? 'es' : 'en';
  const disponible = await traductorDelTelefono(de, a);
  return disponible ? enElTelefono(texto, de, a, disponible, nombre) : sinTraductor(texto, a);
}

/** Con el traductor del navegador: se ve el avance y después la traducción, para copiar, escuchar o llevar a Word */
function enElTelefono(texto, de, a, disponible, nombre) {
  let lector = null;
  const abierta = hoja(() => {
    const estado = el('p', { class: 'hoja-detalle', 'aria-live': 'polite', text: disponible === 'available' ? 'Traduciendo…' : `Preparando el traductor (la primera vez baja el ${LENGUAS[a]})…` });
    const barra = el('span');
    const progreso = el('div', { class: 'progreso' }, barra);
    const area = el('textarea', { class: 'campo texto-leido texto-traducido', rows: 12, 'aria-label': 'Traducción', hidden: true, spellcheck: 'false' });
    const botones = [];
    const etiqueta = el('span', { text: 'Escuchar' });
    const escuchar = puedeHablar() && el('button', { class: 'boton boton-secundario', onclick: () => {
      if (lector.activo) lector.pausar();
      else if (lector.pausado) lector.seguir();
      else lector.empezar(area.value, { enIngles: a === 'en' });
    } }, icono('voz'), etiqueta);
    if (escuchar) lector = crearLector({ alCambiar: ({ activo, fin }) => {
      etiqueta.textContent = activo ? 'Pausa' : lector.pausado ? 'Seguir' : 'Escuchar';
      if (fin) etiqueta.textContent = 'Escuchar';
    } });
    const word = el('button', { class: 'boton boton-secundario', onclick: async () => {
      const { aWord } = await import('./texto.js');
      aWord(`${nombre} (${LENGUAS[a]})`, [{ n: 1, texto: area.value }]);
    } }, icono('word'), 'Word');
    const copiar = el('button', { class: 'boton boton-primario', onclick: async () => {
      const { copiar: copiarTexto } = await import('./texto.js');
      copiarTexto(area.value, area);
    } }, icono('copiar'), 'Copiar');
    botones.push(escuchar, word, copiar);
    for (const b of botones) if (b) b.disabled = true;
    traducir(texto, de, a, {
      alAvanzar: ({ etapa, progreso: x }) => {
        barra.style.width = `${Math.round(100 * x)}%`;
        estado.textContent = etapa === 'bajando' ? `Bajando el ${LENGUAS[a]} para traducir sin internet… ${Math.round(x * 100)} %` : `Traduciendo… ${Math.round(x * 100)} %`;
      }
    }).then(traducido => {
      progreso.hidden = true;
      area.value = traducido;
      area.hidden = false;
      for (const b of botones) if (b) b.disabled = false;
      estado.textContent = 'Traducido dentro del teléfono: el texto no salió a internet. Revísalo, una traducción automática puede tener errores.';
    }).catch(e => {
      console.error(e);
      progreso.hidden = true;
      estado.textContent = 'No se pudo traducir: ' + (e.message || e);
    });
    return [
      el('h2', { class: 'hoja-titulo', text: `Traducción al ${LENGUAS[a]}` }),
      estado, progreso, area,
      el('div', { class: 'hoja-botones' }, escuchar, word, copiar)
    ];
  });
  abierta.finally(() => lector?.detener());
  return abierta;
}

/** Sin traductor en el teléfono: el texto no sale de la app, salvo que la persona lo pase a otra */
function sinTraductor(texto, a) {
  const pasar = navigator.share
    ? el('button', { class: 'boton boton-primario', onclick: async () => {
      try { await navigator.share({ text: texto }); } catch (e) { if (e.name !== 'AbortError') aviso('No se pudo compartir.', 'error'); }
    } }, icono('compartir'), 'Compartir el texto')
    : el('button', { class: 'boton boton-primario', onclick: async () => {
      try { await navigator.clipboard.writeText(texto); aviso('Se copió el texto: pégalo en tu traductor.', 'exito', 5000); } catch (e) { aviso('No se pudo copiar.', 'error'); }
    } }, icono('copiar'), 'Copiar el texto');
  return hoja(cerrar => [
    el('h2', { class: 'hoja-titulo', text: `Traducir al ${LENGUAS[a]}` }),
    el('p', { class: 'hoja-detalle', text: 'Este teléfono no trae un traductor que la app pueda usar, y ScanLibre no manda tu texto a internet.' }),
    el('p', { class: 'hoja-detalle', text: 'Puedes pasarlo a la app de traductor que uses. Por ejemplo, Google Traductor traduce sin internet si bajas el idioma en esa app.' }),
    el('div', { class: 'hoja-botones' },
      el('button', { class: 'boton boton-secundario', onclick: () => cerrar() }, 'Cerrar'),
      pasar)
  ]);
}
