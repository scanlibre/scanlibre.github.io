// ScanLibre · bloqueo.js
// Bloqueo opcional de la app con un PIN (y, si el teléfono puede, con la
// huella, la cara o su propio bloqueo, usando WebAuthn). Protege de quien
// agarra el teléfono desbloqueado. Del PIN solo se guarda una huella
// PBKDF2-SHA-256 con sal: nunca el número.

import { ajustes, cambiarAjuste } from './ajustes.js';

const ITERACIONES = 310000;
const INTENTOS = 'scanlibre_intentos';

export const ESPERAS = [
  { ms: 0, texto: 'Enseguida al salir' },
  { ms: 60e3, texto: 'Después de 1 minuto' },
  { ms: 5 * 60e3, texto: 'Después de 5 minutos' }
];

/** El bloqueo guardado: { sal, hash, iter, espera, huella: { id } | null }, o null si no hay */
export const bloqueo = () => ajustes().bloqueo || null;
export const pinValido = pin => /^\d{4,12}$/.test(pin);

const aB64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const deB64 = texto => Uint8Array.from(atob(texto), c => c.charCodeAt(0));
const alAzar = n => crypto.getRandomValues(new Uint8Array(n));

async function derivar(pin, sal, iter) {
  const llave = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iter }, llave, 256));
}

/** Lo que se guarda de un PIN: la sal y su huella (no el PIN) */
export async function protegerPin(pin, iter = ITERACIONES) {
  const sal = alAzar(16);
  return { sal: aB64(sal), hash: aB64(await derivar(pin, sal, iter)), iter };
}

/** ¿El PIN coincide con lo guardado? (comparación en tiempo constante) */
export async function pinCorrecto(pin, guardado) {
  const h = await derivar(pin, deB64(guardado.sal), guardado.iter), g = deB64(guardado.hash);
  let dif = h.length ^ g.length;
  for (let i = 0; i < h.length; i++) dif |= h[i] ^ g[i];
  return dif === 0;
}

// ── Intentos fallidos ───────────────────────────────────────────────
/** Después de 5 fallos hay que esperar 30 s, y el doble con cada fallo más (hasta 15 min) */
export const esperaPorFallos = fallos => fallos < 5 ? 0 : Math.min(30e3 * 2 ** (fallos - 5), 15 * 60e3);

function intentos() {
  try { return { fallos: 0, hasta: 0, ...JSON.parse(localStorage.getItem(INTENTOS) || '{}') }; } catch (e) { return { fallos: 0, hasta: 0 }; }
}
function guardarIntentos(i) { try { localStorage.setItem(INTENTOS, JSON.stringify(i)); } catch (e) {} }

/** Cuántos ms faltan para poder probar otra vez (0 si ya se puede) */
export const faltaParaIntentar = (ahora = Date.now()) => Math.max(0, intentos().hasta - ahora);

/** Prueba el PIN del bloqueo. @returns { ok } o { ok: false, espera } (ms que hay que esperar) */
export async function probarPin(pin) {
  const espera = faltaParaIntentar();
  if (espera) return { ok: false, espera };
  const b = bloqueo();
  if (b && await pinCorrecto(pin, b)) { guardarIntentos({ fallos: 0, hasta: 0 }); return { ok: true }; }
  const fallos = intentos().fallos + 1;
  guardarIntentos({ fallos, hasta: Date.now() + esperaPorFallos(fallos) });
  return { ok: false, espera: esperaPorFallos(fallos) };
}

// ── Guardar y quitar ────────────────────────────────────────────────
export async function ponerPin(pin) {
  const antes = bloqueo() || { espera: 60e3, huella: null };
  cambiarAjuste('bloqueo', { ...antes, ...(await protegerPin(pin)) });
  guardarIntentos({ fallos: 0, hasta: 0 });
}
export const cambiarEspera = ms => cambiarAjuste('bloqueo', { ...bloqueo(), espera: ms });
export const quitarHuella = () => cambiarAjuste('bloqueo', { ...bloqueo(), huella: null });
export function quitarBloqueo() {
  cambiarAjuste('bloqueo', null);
  guardarIntentos({ fallos: 0, hasta: 0 });
}

// ── Huella (WebAuthn, sin servidor) ─────────────────────────────────
// El teléfono guarda una llave para este sitio y la usa solo si la persona
// se verifica (huella, cara o el bloqueo del teléfono). No hay servidor que
// revise la firma: basta con que el teléfono diga que verificó a la persona.

export async function huellaDisponible() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
  catch (e) { return false; }
}

export async function registrarHuella() {
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: 'ScanLibre' },
    user: { id: alAzar(16), name: 'ScanLibre', displayName: 'Desbloquear ScanLibre' },
    challenge: alAzar(32),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    attestation: 'none',
    timeout: 60000
  } });
  cambiarAjuste('bloqueo', { ...bloqueo(), huella: { id: aB64(cred.rawId) } });
}

const aB64url = bytes => aB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** @returns true si el teléfono verificó a la persona */
export async function probarHuella() {
  const h = bloqueo()?.huella;
  if (!h) return false;
  const reto = alAzar(32);
  const r = await navigator.credentials.get({ publicKey: {
    challenge: reto, allowCredentials: [{ type: 'public-key', id: deB64(h.id) }], userVerification: 'required', timeout: 60000
  } });
  const datos = JSON.parse(new TextDecoder().decode(r.response.clientDataJSON));
  const flags = new Uint8Array(r.response.authenticatorData)[32];
  // La respuesta es a este pedido, y el teléfono verificó a la persona (marca UV)
  return datos.type === 'webauthn.get' && datos.challenge === aB64url(reto) && !!(flags & 0x04);
}
