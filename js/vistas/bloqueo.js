// ScanLibre · vistas/bloqueo.js
// La pantalla de bloqueo (PIN o huella) y las opciones del bloqueo en el menú.
// Mientras está bloqueada, lo de abajo queda oculto e inerte.

import { el, icono, hoja, aviso, menu, confirmar } from '../util.js';
import { bloqueo, pinValido, probarPin, faltaParaIntentar, ponerPin, quitarBloqueo, cambiarEspera, ESPERAS,
  huellaDisponible, registrarHuella, probarHuella, quitarHuella } from '../bloqueo.js';
import { borrarBaseDeDatos } from '../db.js';

let capa = null;        // la pantalla de bloqueo, si está puesta
let oculta = null;      // cuándo se fue la app a segundo plano
let enPrompt = false;   // el teléfono está pidiendo la huella: eso no cuenta como salir de la app
let reloj = null;       // la cuenta regresiva después de muchos intentos
let alVolver = null;    // pedir la huella otra vez cuando la app vuelve a verse

const segundos = ms => { const s = Math.ceil(ms / 1000); return s < 60 ? `${s} s` : `${Math.ceil(s / 60)} min`; };

/** Al arrancar: si hay bloqueo, empieza bloqueada; y se vuelve a bloquear al salir un rato */
export function vigilarBloqueo() {
  if (bloqueo()) bloquear();
  document.addEventListener('visibilitychange', () => {
    const b = bloqueo();
    if (!b || enPrompt) return;
    if (document.visibilityState === 'hidden') {
      oculta = Date.now();
      if (b.espera === 0) bloquear();
      return;
    }
    if (oculta !== null && Date.now() - oculta >= b.espera) bloquear();
    oculta = null;
    alVolver?.();
  });
}

export function bloquear() {
  if (capa) return;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  for (const hijo of document.body.children) hijo.inert = true;
  capa = el('div', { class: 'bloqueo', id: 'bloqueo', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bloqueo-titulo' });
  document.body.classList.add('bloqueada');
  document.body.append(capa);
  pantallaPin();
}

function desbloquear() {
  clearInterval(reloj);
  alVolver = null;
  capa?.remove();
  capa = null;
  document.body.classList.remove('bloqueada');
  for (const hijo of document.body.children) hijo.inert = false;
}

function pantallaPin() {
  clearInterval(reloj);
  const b = bloqueo();
  const entrada = el('input', { class: 'campo bloqueo-pin', id: 'bloqueo-pin', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 12, 'aria-label': 'PIN', placeholder: 'PIN', enterkeyhint: 'done' });
  const mensaje = el('p', { class: 'bloqueo-mensaje', id: 'bloqueo-mensaje', 'aria-live': 'polite' });
  const abrir = el('button', { class: 'boton boton-primario boton-grande', id: 'bloqueo-abrir', onclick: () => probar() }, 'Abrir');
  const conHuella = b?.huella && el('button', { class: 'boton boton-secundario', id: 'bloqueo-huella', onclick: () => huella() }, icono('huella'), 'Usar la huella');

  const esperar = ms => {
    const fin = Date.now() + ms;
    entrada.disabled = abrir.disabled = true;
    const tic = () => {
      const falta = fin - Date.now();
      if (falta > 0) { mensaje.textContent = `Demasiados intentos. Prueba otra vez en ${segundos(falta)}.`; return; }
      clearInterval(reloj);
      entrada.disabled = abrir.disabled = false;
      mensaje.textContent = '';
      entrada.focus();
    };
    tic();
    reloj = setInterval(tic, 1000);
  };
  async function probar() {
    const pin = entrada.value.trim();
    if (!pin) return entrada.focus();
    abrir.disabled = true;
    const r = await probarPin(pin);
    abrir.disabled = false;
    entrada.value = '';
    if (r.ok) return desbloquear();
    if (r.espera) return esperar(r.espera);
    mensaje.textContent = 'PIN incorrecto. Prueba otra vez.';
    entrada.focus();
  }
  async function huella() {
    if (enPrompt) return;
    enPrompt = true;
    try {
      if (await probarHuella()) return desbloquear();
      mensaje.textContent = 'No se pudo verificar. Usa el PIN.';
    } catch (e) {
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') mensaje.textContent = 'No se pudo usar la huella. Usa el PIN.';
    } finally {
      enPrompt = false;
    }
  }
  entrada.addEventListener('keydown', e => { if (e.key === 'Enter') probar(); });

  capa.replaceChildren(el('div', { class: 'bloqueo-caja' },
    el('img', { src: 'icons/icono.svg', alt: '', width: 56, height: 56 }),
    el('h1', { class: 'bloqueo-titulo', id: 'bloqueo-titulo', text: 'ScanLibre está bloqueado' }),
    el('p', { class: 'bloqueo-detalle', text: conHuella ? 'Usa la huella o escribe tu PIN para ver tus documentos.' : 'Escribe tu PIN para ver tus documentos.' }),
    entrada, mensaje, abrir, conHuella,
    el('button', { class: 'boton boton-fantasma', id: 'bloqueo-olvide', onclick: pantallaOlvide }, '¿Olvidaste el PIN?')));

  const falta = faltaParaIntentar();
  if (falta) esperar(falta);
  else setTimeout(() => entrada.focus(), 50);
  alVolver = conHuella ? huella : null;
  if (conHuella && document.visibilityState === 'visible') huella();
}

/** Sin el PIN no hay forma de entrar: lo único que se puede es borrar todo y empezar de nuevo */
function pantallaOlvide() {
  clearInterval(reloj);
  alVolver = null;
  const entrada = el('input', { class: 'campo', id: 'bloqueo-confirmar', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Escribe BORRAR para confirmar', placeholder: 'BORRAR' });
  const borrar = el('button', { class: 'boton boton-peligro', id: 'bloqueo-borrar', disabled: true, onclick: async () => {
    borrar.disabled = true;
    await borrarBaseDeDatos();
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('scanlibre')) localStorage.removeItem(k); } catch (e) {}
    location.reload();
  } }, 'Borrar todo');
  entrada.addEventListener('input', () => { borrar.disabled = entrada.value.trim().toUpperCase() !== 'BORRAR'; });
  capa.replaceChildren(el('div', { class: 'bloqueo-caja' },
    el('h1', { class: 'bloqueo-titulo', id: 'bloqueo-titulo', text: 'Sin el PIN no se puede abrir' }),
    el('p', { class: 'bloqueo-detalle', text: 'Nadie puede recuperar tu PIN, ni nosotros: no se guarda en ningún lado. Lo único que se puede hacer es borrar todo lo de ScanLibre en este teléfono y empezar de nuevo. Si tienes un respaldo en archivo, después lo restauras.' }),
    el('p', { class: 'bloqueo-detalle', text: 'Para borrar todo, escribe BORRAR:' }),
    entrada,
    el('div', { class: 'hoja-botones' },
      el('button', { class: 'boton boton-secundario', id: 'bloqueo-volver', onclick: pantallaPin }, 'Volver'),
      borrar)));
  setTimeout(() => entrada.focus(), 50);
}

// ── Opciones del menú ───────────────────────────────────────────────
/** Una hoja para escribir un PIN (solo números, sin mostrarlos) */
function pedirPin(titulo, detalle) {
  return hoja(cerrar => {
    const entrada = el('input', { class: 'campo', id: 'pin-entrada', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 12, 'aria-label': titulo, enterkeyhint: 'done' });
    const error = el('p', { class: 'hoja-detalle pin-error', 'aria-live': 'polite' });
    const listo = () => {
      const v = entrada.value.trim();
      if (pinValido(v)) cerrar(v);
      else { error.textContent = 'El PIN tiene que ser de 4 a 12 números.'; entrada.focus(); }
    };
    entrada.addEventListener('keydown', e => { if (e.key === 'Enter') listo(); });
    setTimeout(() => entrada.focus(), 50);
    return [
      el('h2', { class: 'hoja-titulo', text: titulo }),
      detalle && el('p', { class: 'hoja-detalle', text: detalle }),
      entrada, error,
      el('div', { class: 'hoja-botones' },
        el('button', { class: 'boton boton-secundario', onclick: () => cerrar(undefined) }, 'Cancelar'),
        el('button', { class: 'boton boton-primario', id: 'pin-listo', onclick: listo }, 'Listo'))
    ];
  });
}

async function nuevoPin() {
  const pin = await pedirPin('Escribe un PIN nuevo', 'De 4 a 12 números. No lo anotes en el mismo teléfono.');
  if (!pin) return null;
  const otra = await pedirPin('Escríbelo otra vez', 'Para confirmar que es el que quieres.');
  if (!otra) return null;
  if (otra !== pin) { aviso('Los dos PIN no coinciden. Prueba otra vez.', 'error'); return null; }
  return pin;
}

/** Antes de cambiar o quitar el PIN, se pide el de ahora */
async function pinDeAhora() {
  const pin = await pedirPin('Escribe tu PIN de ahora');
  if (!pin) return false;
  const r = await probarPin(pin);
  if (!r.ok) aviso(r.espera ? `Demasiados intentos. Prueba otra vez en ${segundos(r.espera)}.` : 'PIN incorrecto.', 'error');
  return r.ok;
}

async function activarHuella() {
  enPrompt = true;
  try {
    await registrarHuella();
    aviso('Listo: puedes abrir ScanLibre con la huella.', 'exito');
  } catch (e) {
    if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') aviso('No se pudo activar la huella: ' + (e.message || e), 'error');
  } finally {
    enPrompt = false;
  }
}

/** Menú → Bloqueo con PIN */
export async function configurarBloqueo() {
  const b = bloqueo();
  if (!b) {
    const seguir = await confirmar('Bloquear ScanLibre con un PIN', {
      detalle: 'Si alguien usa tu teléfono desbloqueado, no podrá ver tus documentos sin el PIN. Sirve sobre todo si guardas copias de tu cédula. Si olvidas el PIN, la única salida es borrar todo lo de ScanLibre en este teléfono: ten un respaldo en archivo.',
      aceptar: 'Poner un PIN'
    });
    if (!seguir) return;
    const pin = await nuevoPin();
    if (!pin) return;
    await ponerPin(pin);
    aviso('Listo: ScanLibre queda protegido con tu PIN.', 'exito');
    if (await huellaDisponible() && await confirmar('¿Usar también la huella?', { detalle: 'Para abrir ScanLibre con la huella, la cara o el bloqueo del teléfono. El PIN sigue sirviendo.', aceptar: 'Usar la huella' })) await activarHuella();
    return;
  }
  const disponible = await huellaDisponible();
  const espera = ESPERAS.find(e => e.ms === b.espera) || ESPERAS[1];
  const opcion = await menu([
    { valor: 'espera', texto: `Se bloquea: ${espera.texto.toLowerCase()}`, icono: 'candado' },
    b.huella ? { valor: 'sin-huella', texto: 'Dejar de usar la huella', icono: 'huella' }
      : disponible && { valor: 'huella', texto: 'Usar también la huella', icono: 'huella' },
    { valor: 'cambiar', texto: 'Cambiar el PIN', icono: 'editar' },
    { valor: 'quitar', texto: 'Quitar el bloqueo', icono: 'basura', peligro: true }
  ].filter(Boolean), 'Bloqueo con PIN');
  if (opcion === 'espera') {
    const ms = await menu(ESPERAS.map(e => ({ valor: String(e.ms), texto: e.ms === b.espera ? `${e.texto} (ahora)` : e.texto })), 'Cuándo se bloquea');
    if (ms !== undefined) cambiarEspera(Number(ms));
  } else if (opcion === 'huella') await activarHuella();
  else if (opcion === 'sin-huella') { quitarHuella(); aviso('Listo: ahora se abre solo con el PIN.'); }
  else if (opcion === 'cambiar') {
    if (!await pinDeAhora()) return;
    const pin = await nuevoPin();
    if (pin) { await ponerPin(pin); aviso('Listo: cambiaste el PIN.', 'exito'); }
  } else if (opcion === 'quitar') {
    if (!await pinDeAhora()) return;
    quitarBloqueo();
    aviso('Listo: ScanLibre ya no pide PIN.');
  }
}
