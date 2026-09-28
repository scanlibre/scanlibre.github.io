// ScanLibre · vistas/nube.js
// El respaldo cifrado en la nube: activarlo (con un código que la persona
// guarda), ver cómo va, respaldar ahora, recuperar en otro teléfono y borrarlo.

import { el, icono, hoja, aviso, menu, confirmar, pedirTexto, fechaCorta, paginasTexto } from '../util.js';
import { nuevoCodigo, leerCodigo } from '../llaves.js';
import {
  configNube, activarNube, respaldarEnLaNube, buscarEnLaNube, recuperarDeLaNube,
  borrarDeLaNube, dejarDeRespaldar, eventosNube
} from '../nube.js';
import { descargar } from '../exportar.js';

const documentosTexto = n => n === 1 ? '1 documento' : `${n} documentos`;
// En megas "de verdad" (1 MB = 1.000.000 bytes), como el cupo de 200 MB
const mb = (b = 0) => b < 1e6 ? `${Math.max(1, Math.round(b / 1e3))} KB` : `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0).replace('.', ',').replace(/,0$/, '')} MB`;

/** Abre la hoja del respaldo en la nube. `alCambiar` se llama si se recuperaron documentos */
export async function abrirNube({ alCambiar } = {}) {
  for (;;) {
    const siguiente = configNube()?.codigo ? await hojaActiva() : await hojaInactiva();
    if (!siguiente) return;
    if (siguiente === 'activar') { if (await elegirCodigo()) await verRespaldo(); }
    else if (siguiente === 'respaldar') await verRespaldo();
    else if (siguiente === 'reemplazar') await verRespaldo({ forzar: true });
    else if (siguiente === 'juntar') { if (await traer(configNube().codigo, { alCambiar })) await verRespaldo({ forzar: true }); }
    else if (siguiente === 'recuperar') await recuperar({ alCambiar });
    else if (siguiente === 'codigo') await verCodigo(configNube().codigo, { nuevo: false });
    else if (siguiente === 'dejar') {
      if (await confirmar('¿Dejar de respaldar en este teléfono?', { detalle: 'Lo que ya está en la nube queda ahí y lo puedes recuperar con tu código.', aceptar: 'Dejar de respaldar' })) {
        dejarDeRespaldar();
        aviso('Este teléfono ya no respalda en la nube.');
      }
    } else if (siguiente === 'borrar') {
      if (await confirmar('¿Borrar tu respaldo de la nube?', { detalle: 'Se borra todo lo que hay en la nube con este código. Los documentos de este teléfono no se tocan.', aceptar: 'Borrar de la nube', peligro: true })) {
        try { await borrarDeLaNube(); aviso('Se borró tu respaldo de la nube.', 'exito'); }
        catch (e) { aviso(e.message, 'error', 5000); }
      }
    }
  }
}

function hojaInactiva() {
  return hoja(cerrar => [
    el('h2', { class: 'hoja-titulo', text: 'Respaldo en la nube' }),
    el('p', { class: 'hoja-detalle', text: 'Tus documentos se guardan en la nube y los recuperas en otro teléfono con tu código de respaldo.' }),
    el('ul', { class: 'nube-lista' },
      el('li', {}, icono('candado'), el('span', { text: 'Se cifran aquí, en tu teléfono, antes de subir: nadie más puede verlos, ni ScanLibre.' })),
      el('li', {}, icono('llave'), el('span', { text: 'Sin cuenta ni correo: solo un código que tú guardas. Si lo pierdes, nadie puede recuperar tus documentos.' })),
      el('li', {}, icono('nube'), el('span', { text: 'Se respalda solo cuando hay cambios y tienes internet. Espacio: hasta 200 MB (las fotos originales van en tamaño reducido).' }))),
    el('div', { class: 'hoja-botones' },
      el('button', { class: 'boton boton-secundario', onclick: () => cerrar('recuperar') }, 'Ya tengo un código'),
      el('button', { class: 'boton boton-primario', id: 'nube-activar', onclick: () => cerrar('activar') }, 'Activar'))
  ]);
}

function hojaActiva() {
  const c = configNube();
  return hoja(cerrar => {
    const partes = [el('h2', { class: 'hoja-titulo', text: 'Respaldo en la nube' })];
    partes.push(el('p', { class: 'hoja-detalle', id: 'nube-estado', text: c.ultimo
      ? `Último respaldo: ${fechaCorta(c.ultimo)} · ${documentosTexto(c.documentos || 0)} · ${mb(c.bytes)} de ${mb(c.cupo || 200e6)}`
      : 'Todavía no se ha respaldado nada.' }));
    if (c.conflicto) {
      partes.push(el('div', { class: 'nube-aviso', id: 'nube-conflicto' },
        el('p', { text: `Otro teléfono respaldó con este mismo código (${fechaCorta(c.conflicto.creado)}). Para no perder nada, este teléfono no respalda hasta que elijas:` }),
        el('div', { class: 'hoja-botones' },
          el('button', { class: 'boton boton-secundario', onclick: () => cerrar('reemplazar') }, 'Dejar lo de aquí'),
          el('button', { class: 'boton boton-primario', onclick: () => cerrar('juntar') }, 'Juntar los dos'))));
    } else if (c.error) {
      partes.push(el('p', { class: 'nube-error', text: 'La última vez no se pudo respaldar: ' + c.error }));
    }
    partes.push(
      el('p', { class: 'hoja-detalle nube-nota', text: 'Se respalda solo cuando hay cambios y tienes internet. Todo va cifrado con tu código.' }),
      el('div', { class: 'hoja-botones' },
        el('button', { class: 'boton boton-secundario', onclick: () => cerrar('codigo') }, icono('llave'), 'Mi código'),
        el('button', { class: 'boton boton-primario', id: 'nube-respaldar', disabled: !!c.conflicto, onclick: () => cerrar('respaldar') }, icono('nube'), 'Respaldar ahora')),
      el('button', { class: 'boton boton-fantasma nube-mas', onclick: async () => {
        const opcion = await menu([
          { valor: 'recuperar', texto: 'Recuperar con un código', icono: 'restaurar' },
          { valor: 'dejar', texto: 'Dejar de respaldar en este teléfono', icono: 'cerrar' },
          { valor: 'borrar', texto: 'Borrar mi respaldo de la nube', icono: 'basura' }
        ], 'Respaldo en la nube');
        if (opcion) cerrar(opcion);
      } }, 'Más opciones'));
    return partes;
  });
}

/** Muestra el código (uno nuevo al activar). @returns true si la persona confirmó que lo guardó */
async function elegirCodigo() {
  const codigo = await nuevoCodigo();
  if (!(await verCodigo(codigo, { nuevo: true }))) return false;
  activarNube(codigo);
  return true;
}

function verCodigo(codigo, { nuevo }) {
  return hoja(cerrar => {
    const listo = el('button', { class: 'boton boton-primario', id: 'nube-guardado', disabled: nuevo, onclick: () => cerrar(true) }, nuevo ? 'Ya lo guardé' : 'Cerrar');
    const casilla = el('input', { type: 'checkbox', id: 'nube-casilla', onchange: () => { listo.disabled = !casilla.checked; } });
    const texto = `Mi código de respaldo de ScanLibre: ${codigo}\n\nCon él se recuperan mis documentos en https://scanlibre.github.io (Menú → Respaldo en la nube → Ya tengo un código). No lo compartas: quien lo tenga puede ver tus documentos.`;
    const marcar = () => { if (nuevo) { casilla.checked = true; listo.disabled = false; } };
    return [
      el('h2', { class: 'hoja-titulo', text: 'Tu código de respaldo' }),
      el('p', { class: 'hoja-detalle', text: nuevo
        ? 'Es la única forma de recuperar tus documentos en otro teléfono. Guárdalo donde no se pierda: en tu correo, en Drive o anotado en papel.'
        : 'Con este código recuperas tus documentos en otro teléfono. No lo compartas: quien lo tenga puede verlos.' }),
      el('div', { class: 'codigo-respaldo', id: 'nube-codigo', 'aria-label': 'Código de respaldo' }, ...codigo.split('-').map(g => el('span', { text: g }))),
      el('div', { class: 'hoja-botones' },
        el('button', { class: 'boton boton-secundario', onclick: async () => {
          try { await navigator.clipboard.writeText(codigo); aviso('Código copiado. Pégalo en tu correo o en tus notas.', 'exito'); marcar(); }
          catch (e) { aviso('No se pudo copiar: anótalo a mano.', 'error'); }
        } }, icono('copiar'), 'Copiar'),
        el('button', { class: 'boton boton-secundario', onclick: () => {
          descargar(new Blob([texto], { type: 'text/plain' }), 'ScanLibre-codigo-de-respaldo.txt');
          marcar();
        } }, icono('descargar'), 'Guardar')),
      nuevo && el('label', { class: 'nube-casilla' }, casilla, el('span', { text: 'Ya guardé mi código donde no se pierde' })),
      el('div', { class: 'hoja-botones' },
        nuevo && el('button', { class: 'boton boton-secundario', onclick: () => cerrar(false) }, 'Cancelar'),
        listo)
    ];
  }).then(v => v === true);
}

/** Respalda mostrando cómo va (se puede cerrar la hoja: sigue en segundo plano) */
function verRespaldo({ forzar = false } = {}) {
  const trabajo = respaldarEnLaNube({ forzar });
  trabajo.catch(() => {});
  return hoja(cerrar => {
    const titulo = el('h2', { class: 'hoja-titulo', text: 'Respaldando en la nube' });
    const estado = el('p', { class: 'hoja-detalle', id: 'nube-avance', 'aria-live': 'polite', text: 'Revisando qué hay que subir…' });
    const barra = el('span');
    const progreso = el('div', { class: 'progreso' }, barra);
    const boton = el('button', { class: 'boton boton-secundario', onclick: () => cerrar() }, 'Seguir en segundo plano');
    const avance = e => {
      const { etapa, hechos = 0, total = 0 } = e.detail;
      if (etapa === 'subiendo' && total) {
        barra.style.width = `${Math.round(100 * hechos / total)}%`;
        estado.textContent = `Subiendo ${hechos} de ${total} fotos (cifradas)…`;
      } else if (etapa === 'terminando') {
        barra.style.width = '100%';
        estado.textContent = 'Guardando el índice…';
      }
    };
    eventosNube.addEventListener('avance', avance);
    trabajo.then(r => {
      titulo.textContent = 'Respaldo listo';
      progreso.hidden = true;
      estado.textContent = `${documentosTexto(r.documentos)} (${paginasTexto(r.paginas)}) en la nube · ${mb(r.bytes)} de ${mb(r.cupo)}.` +
        (r.subidos ? '' : ' No había nada nuevo que subir.');
    }, e => {
      titulo.textContent = e.codigo === 'otro-telefono' ? 'Otro teléfono respaldó con este código' : 'No se pudo respaldar';
      progreso.hidden = true;
      estado.textContent = e.codigo === 'otro-telefono'
        ? 'Para no perder nada, elige si juntar lo de los dos teléfonos o dejar solo lo de este.'
        : e.message;
    }).finally(() => {
      eventosNube.removeEventListener('avance', avance);
      boton.textContent = 'Cerrar';
      boton.className = 'boton boton-primario';
    });
    return [titulo, estado, progreso, el('div', { class: 'hoja-botones' }, boton)];
  });
}

async function pedirCodigo() {
  let detalle = 'Escríbelo como lo guardaste, con o sin guiones.';
  for (;;) {
    const escrito = await pedirTexto('Tu código de respaldo', '', { aceptar: 'Buscar', ejemplo: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', detalle });
    if (!escrito) return null;
    const { codigo, error } = await leerCodigo(escrito);
    if (codigo) return codigo;
    detalle = error === 'largo' ? 'El código tiene 24 letras y números (sin contar los guiones). Revísalo.'
      : error === 'letras' ? 'El código solo lleva números y letras mayúsculas. Revísalo.'
      : 'Hay un error en el código: revísalo letra por letra.';
  }
}

async function recuperar({ alCambiar }) {
  const codigo = await pedirCodigo();
  if (!codigo) return;
  const actual = configNube()?.codigo;
  if (actual && actual !== codigo && !(await confirmar('¿Cambiar de código?', {
    detalle: 'Este teléfono respalda con otro código. Si recuperas este, desde ahora se respalda con el nuevo (lo del otro código queda en la nube).', aceptar: 'Seguir'
  }))) return;
  await traer(codigo, { alCambiar });
}

/** Busca el respaldo de un código y lo trae al teléfono, juntándolo con lo que hay */
async function traer(codigo, { alCambiar }) {
  aviso('Buscando tu respaldo…');
  let encontrado;
  try { encontrado = await buscarEnLaNube(codigo); }
  catch (e) { aviso(e.message, 'error', 6000); return false; }
  const cuando = encontrado.indice.nube?.creado || encontrado.indice.creado;
  if (!(await confirmar('Encontré tu respaldo', {
    detalle: `${documentosTexto(encontrado.documentos)} (${paginasTexto(encontrado.paginas)}, ${mb(encontrado.bytes)}), respaldado ${fechaCorta(cuando).toLowerCase()}. Se juntan con lo que ya tienes en este teléfono.`,
    aceptar: 'Recuperar'
  }))) return false;
  let resultado = null;
  await hoja(cerrar => {
    const titulo = el('h2', { class: 'hoja-titulo', text: 'Recuperando tus documentos' });
    const estado = el('p', { class: 'hoja-detalle', id: 'nube-avance', 'aria-live': 'polite', text: 'Bajando y descifrando…' });
    const barra = el('span');
    const progreso = el('div', { class: 'progreso' }, barra);
    const boton = el('button', { class: 'boton boton-secundario', disabled: true, onclick: () => cerrar() }, 'Espera…');
    recuperarDeLaNube(encontrado, {
      alAvanzar: ({ hechas, total }) => {
        barra.style.width = `${Math.round(100 * hechas / total)}%`;
        estado.textContent = `Página ${hechas} de ${total}…`;
      }
    }).then(n => {
      resultado = n;
      titulo.textContent = 'Listo';
      estado.textContent = n === 1 ? 'Se recuperó 1 documento. Desde ahora este teléfono respalda con ese código.' : `Se recuperaron ${n} documentos. Desde ahora este teléfono respalda con ese código.`;
      alCambiar?.();
    }, e => {
      console.error(e);
      titulo.textContent = 'No se pudo recuperar';
      estado.textContent = e.message;
    }).finally(() => {
      progreso.hidden = true;
      boton.disabled = false;
      boton.textContent = 'Cerrar';
      boton.className = 'boton boton-primario';
    });
    return [titulo, estado, progreso, el('div', { class: 'hoja-botones' }, boton)];
  });
  return resultado !== null;
}

