// ScanLibre · llaves.js
// El código del respaldo en la nube y todo lo que sale de él. El código se
// crea al azar en el teléfono (115 bits) y nunca sale de ahí: de él salen,
// con HKDF, el número del respaldo, la llave que se le muestra al servidor,
// la llave de cifrado (AES-256-GCM) y la que pone los nombres de los archivos.
// El servidor solo ve el número, la llave y bytes cifrados.

// Base 32 de Crockford: sin I, L, O ni U, que se confunden al copiarlos a mano
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LARGO = 24;               // 23 al azar + 1 de control, en 6 grupos de 4
const SAL = new TextEncoder().encode('ScanLibre respaldo en la nube v1');
const texto = s => new TextEncoder().encode(s);

const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
function base64url(b) {
  let s = '';
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function control(cuerpo) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', texto('control:' + cuerpo)));
  return ALFABETO[h[0] & 31];
}

const agrupar = s => s.match(/.{4}/g).join('-');

/** Un código nuevo, como "7KQ2-M9XA-…" */
export async function nuevoCodigo() {
  // 256 es múltiplo de 32: cada letra sale pareja
  const cuerpo = [...crypto.getRandomValues(new Uint8Array(LARGO - 1))].map(x => ALFABETO[x & 31]).join('');
  return agrupar(cuerpo + await control(cuerpo));
}

/**
 * Lo que la persona escribió, limpio ("7kq2 m9xa…" → "7KQ2-M9XA-…").
 * @returns { codigo } si está bien; { error: 'largo' | 'letras' | 'control' } si no
 */
export async function leerCodigo(escrito) {
  const s = String(escrito || '').toUpperCase().replace(/[\s\-_.]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== LARGO) return { error: 'largo' };
  if ([...s].some(c => !ALFABETO.includes(c))) return { error: 'letras' };
  if (await control(s.slice(0, -1)) !== s.slice(-1)) return { error: 'control' };
  return { codigo: agrupar(s) };
}

/** Las llaves de un código (ya leído con leerCodigo) */
export async function llavesDe(codigo) {
  const base = await crypto.subtle.importKey('raw', texto(codigo.replace(/-/g, '')), 'HKDF', false, ['deriveBits']);
  const bits = (info, n) => crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: SAL, info: texto(info) }, base, n * 8);
  return {
    id: hex(await bits('id', 16)),
    llave: base64url(await bits('llave', 32)),
    cifrado: await crypto.subtle.importKey('raw', await bits('cifrado', 32), 'AES-GCM', false, ['encrypt', 'decrypt']),
    nombres: await crypto.subtle.importKey('raw', await bits('nombres', 32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  };
}

/** Huella (SHA-256) de un archivo o de bytes */
export async function huella(datos) {
  const bytes = datos instanceof Blob ? await datos.arrayBuffer() : datos;
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

/** El nombre con que se guarda en la nube: no dice nada del contenido a quien no tiene el código */
export async function nombreEnLaNube(llaves, que) {
  return base64url(await crypto.subtle.sign('HMAC', llaves.nombres, texto(que))).slice(0, 32);
}

const VERSION = 1;

/** Cifra (AES-256-GCM, nonce al azar). El nombre va atado al cifrado: no se puede cambiar un archivo por otro */
export async function cifrar(llaves, datos, nombre) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: texto('scanlibre:' + nombre) }, llaves.cifrado, datos instanceof Blob ? await datos.arrayBuffer() : datos));
  const out = new Uint8Array(13 + c.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(c, 13);
  return out;
}

export async function descifrar(llaves, bytes, nombre) {
  const b = new Uint8Array(bytes);
  if (b[0] !== VERSION || b.length < 29) throw new Error('El respaldo de la nube está dañado.');
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(1, 13), additionalData: texto('scanlibre:' + nombre) }, llaves.cifrado, b.subarray(13)));
  } catch (e) {
    throw new Error('No se pudo abrir el respaldo de la nube: está dañado o es de otro código.');
  }
}

/** JSON comprimido (gzip) y cifrado; al revés con abrirJSON */
export async function cerrarJSON(llaves, datos, nombre) {
  const gz = await new Response(new Blob([JSON.stringify(datos)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return cifrar(llaves, gz, nombre);
}

export async function abrirJSON(llaves, bytes, nombre) {
  const gz = await descifrar(llaves, bytes, nombre);
  return JSON.parse(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
