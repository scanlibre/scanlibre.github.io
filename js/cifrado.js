// ScanLibre · cifrado.js
// PDF con contraseña: el cifrado estándar de PDF, revisión 6 (AES-256, ISO
// 32000-2), el que abren Adobe, Chrome, Firefox y los visores de Android e
// iPhone. Las cuentas las hace el navegador (WebCrypto): la contraseña nunca
// sale del teléfono.
//  · Una clave de archivo al azar (32 bytes) cifra cada imagen, cada página y
//    cada texto del PDF con AES-256 (CBC, con un IV al azar por cada uno).
//  · La clave de archivo se guarda cifrada con la contraseña (UE y OE), y U y O
//    sirven para comprobar la contraseña. Para llegar de la contraseña a la
//    clave se usa el "algoritmo 2.B": muchas vueltas de SHA-256/384/512 y AES,
//    así adivinar contraseñas es lento.

const sutil = () => globalThis.crypto.subtle;
const azar = n => globalThis.crypto.getRandomValues(new Uint8Array(n));

function unir(...partes) {
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}

export const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();

async function sha(bits, datos) {
  return new Uint8Array(await sutil().digest('SHA-' + bits, datos));
}

/**
 * AES en modo CBC. WebCrypto siempre agrega el relleno PKCS#7 (el que pide el
 * PDF para imágenes y textos); cuando el dato ya viene en bloques justos y no
 * se quiere relleno, se quita el bloque de más: los anteriores no cambian.
 */
async function aes(clave, iv, datos, relleno = true) {
  const k = await sutil().importKey('raw', clave, { name: 'AES-CBC' }, false, ['encrypt']);
  const c = new Uint8Array(await sutil().encrypt({ name: 'AES-CBC', iv }, k, datos));
  return relleno ? c : c.subarray(0, datos.length);
}

/** Algoritmo 2.B (ISO 32000-2, 7.6.4.3.4): de la contraseña y una sal a 32 bytes */
export async function hash2B(clave, sal, u = new Uint8Array(0)) {
  let k = await sha(256, unir(clave, sal, u));
  let e = new Uint8Array(1);
  for (let i = 0; i < 64 || e[e.length - 1] > i - 32; i++) {
    const bloque = unir(clave, k, u), k1 = new Uint8Array(bloque.length * 64);
    for (let j = 0; j < 64; j++) k1.set(bloque, j * bloque.length);
    e = await aes(k.subarray(0, 16), k.subarray(16, 32), k1, false);
    let suma = 0;
    for (let j = 0; j < 16; j++) suma += e[j];
    k = await sha([256, 384, 512][suma % 3], e);
  }
  return k.subarray(0, 32);
}

/** La contraseña como la pide el PDF: Unicode normalizado, en UTF-8, hasta 127 bytes */
export const bytesDeContrasena = c => new TextEncoder().encode(String(c).normalize('NFKC')).subarray(0, 127);

/**
 * Prepara el cifrado de un PDF.
 * @returns { diccionario (el /Encrypt), id (para el /ID del trailer), cifrar(bytes) → bytes }
 */
export async function prepararCifrado(contrasena) {
  const clave = bytesDeContrasena(contrasena);
  const archivo = azar(32), ceros = new Uint8Array(16);
  // Contraseña de usuario (la que se pide al abrir): algoritmo 8
  const salU = azar(16); // 8 bytes para comprobarla y 8 para la clave
  const U = unir(await hash2B(clave, salU.subarray(0, 8)), salU);
  const UE = await aes(await hash2B(clave, salU.subarray(8)), ceros, archivo, false);
  // Contraseña de dueño: la misma (algoritmo 9); con ella no hay nada más que desbloquear
  const salO = azar(16);
  const O = unir(await hash2B(clave, salO.subarray(0, 8), U), salO);
  const OE = await aes(await hash2B(clave, salO.subarray(8), U), ceros, archivo, false);
  // Permisos (algoritmo 10): se permite todo (imprimir, copiar…); cifrados para que no se puedan cambiar
  const P = -4;
  const permisos = new Uint8Array(16);
  new DataView(permisos.buffer).setInt32(0, P, true);
  permisos.fill(0xff, 4, 8);
  permisos.set([0x54, 0x61, 0x64, 0x62], 8); // "T" (también los datos del documento van cifrados) + "adb"
  permisos.set(azar(4), 12);
  const Perms = await aes(archivo, ceros, permisos, false); // un solo bloque: igual que ECB
  return {
    diccionario: `<< /Filter /Standard /V 5 /R 6 /Length 256 /CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV3 /Length 32 >> >> /StmF /StdCF /StrF /StdCF /O <${hex(O)}> /U <${hex(U)}> /OE <${hex(OE)}> /UE <${hex(UE)}> /Perms <${hex(Perms)}> /P ${P} /EncryptMetadata true >>`,
    id: hex(azar(16)),
    cifrar: async datos => { const iv = azar(16); return unir(iv, await aes(archivo, iv, datos)); }
  };
}
