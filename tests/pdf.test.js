import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { createHash, createDecipheriv, createCipheriv } from 'node:crypto';
import { crearPDF, crearPDFConContrasena, infoJPEG, aBits, cadenaPDF } from '../js/pdf.js';
import { JPEG_COLOR_16x8, JPEG_GRIS_10x20, JPEG_PROGRESIVO_12x6 } from './jpegs.js';

const texto = b => Buffer.from(b).toString('latin1');

/** Revisa que la tabla xref apunte exactamente al inicio de cada objeto */
function revisarEstructura(pdf) {
  const s = texto(pdf);
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const inicio = Number(s.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(s.slice(inicio, inicio + 4), 'xref');
  const [, total] = s.slice(inicio).match(/xref\n0 (\d+)\n/).map(Number);
  const filas = s.slice(inicio).split('\n').slice(2, 2 + total);
  filas.slice(1).forEach((f, i) => {
    const off = Number(f.slice(0, 10));
    assert.equal(s.slice(off, off + String(i + 1).length + 6), `${i + 1} 0 obj`, `objeto ${i + 1}`);
  });
  return s;
}

describe('PDF', () => {
  it('lee ancho, alto y canales del JPEG', () => {
    assert.deepEqual(infoJPEG(JPEG_COLOR_16x8), { ancho: 16, alto: 8, canales: 3 });
    assert.deepEqual(infoJPEG(JPEG_GRIS_10x20), { ancho: 10, alto: 20, canales: 1 });
    assert.deepEqual(infoJPEG(JPEG_PROGRESIVO_12x6), { ancho: 12, alto: 6, canales: 3 });
  });

  it('arma un PDF válido con páginas a color, en gris y en blanco y negro', () => {
    const bn = { data: new Uint8ClampedArray(9 * 4 * 4).fill(255), width: 9, height: 4 };
    bn.data.set([0, 0, 0, 255], 0); // primer píxel negro
    const pdf = crearPDF([
      { tipo: 'jpeg', bytes: JPEG_COLOR_16x8 },
      { tipo: 'jpeg', bytes: JPEG_GRIS_10x20 },
      { tipo: 'bits', bytes: deflateSync(aBits(bn)), ancho: 9, alto: 4 }
    ], { titulo: 'Cálculo – apuntes ñ' });
    const s = revisarEstructura(pdf);
    assert.match(s, /\/Count 3/);
    assert.match(s, /\/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode/);
    assert.match(s, /\/ColorSpace \/DeviceGray \/BitsPerComponent 8 \/Filter \/DCTDecode/);
    assert.match(s, /\/ColorSpace \/DeviceGray \/BitsPerComponent 1 \/Filter \/FlateDecode/);
    // Título con tildes en UTF-16: "Cá" = 0043 00E1
    assert.match(s, /\/Title <FEFF004300E1/);
  });

  it('la hoja carta se acuesta si la imagen es más ancha que alta', () => {
    const s = texto(crearPDF([{ tipo: 'jpeg', bytes: JPEG_COLOR_16x8 }, { tipo: 'jpeg', bytes: JPEG_GRIS_10x20 }], { tamano: 'carta' }));
    const cajas = [...s.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => [Number(m[1]), Number(m[2])]);
    assert.deepEqual(cajas, [[792, 612], [612, 792]]);
  });

  it('"Como la foto" usa la forma de la imagen', () => {
    const s = texto(crearPDF([{ tipo: 'jpeg', bytes: JPEG_GRIS_10x20 }], { tamano: 'foto' }));
    const [, w, h] = s.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/).map(Number);
    assert.equal(w / h, 0.5);
  });

  it('empaqueta el blanco y negro a 1 bit por píxel (1 = blanco)', () => {
    const w = 10, h = 2, data = new Uint8ClampedArray(w * h * 4).fill(255);
    data.set([0, 0, 0, 255], 0);           // (0,0) negro
    data.set([0, 0, 0, 255], (1 * w + 9) * 4); // (9,1) negro
    const bits = aBits({ data, width: w, height: h });
    // Cada fila ocupa 2 bytes; los bits de relleno del final quedan en 0 (el PDF los ignora)
    assert.deepEqual([...bits], [0b01111111, 0b11000000, 0b11111111, 0b10000000]);
    assert.deepEqual(inflateSync(deflateSync(bits)), Buffer.from(bits));
  });

  it('las cadenas de texto van en WinAnsi: tildes, ñ, ¿ y paréntesis', () => {
    assert.equal(cadenaPDF('Cálculo'), '(C\\341lculo)');
    assert.equal(cadenaPDF('¿Año (ñ)?'), '(\\277A\\361o \\(\\361\\)?)');
    assert.equal(cadenaPDF('“x” – €'), '(\\223x\\224 \\226 \\200)');
    assert.equal(cadenaPDF('日本'), '(??)', 'lo que no existe en WinAnsi queda como ?');
  });

  it('con el texto leído, cada palabra va invisible en su lugar', () => {
    // Imagen de 16×8 px con dos palabras en el renglón de arriba
    const texto = { ancho: 16, alto: 8, lineas: [{ y0: 1, y1: 3, base: [0, 3, 16, 3], palabras: [{ t: 'Hola', x0: 1, y0: 1, x1: 7, y1: 3 }, { t: 'mamá', x0: 9, y0: 1, x1: 15, y1: 3 }] }] };
    const s = texto && Buffer.from(crearPDF([{ tipo: 'jpeg', bytes: JPEG_COLOR_16x8, texto }], { tamano: 'foto' })).toString('latin1');
    revisarEstructura(Buffer.from(s, 'latin1'));
    assert.match(s, /\/BaseFont \/Courier \/Encoding \/WinAnsiEncoding/);
    assert.match(s, /\/Font << \/F1 4 0 R >>/);
    assert.match(s, /BT 3 Tr/, 'modo 3: texto invisible');
    assert.match(s, /\(Hola \) Tj/, 'entre palabras va un espacio');
    assert.match(s, /\(mam\\341\) Tj/);
    // La hoja "foto" mide 792×396 pt: 1 px = 49,5 pt. "mamá" empieza en x = 9 px y su base está a 3 px de arriba
    const [, x, y] = s.match(/1 0 0 1 ([\d.]+) ([\d.]+) Tm \(mam/).map(Number);
    assert.equal(x, 9 * 49.5);
    assert.equal(y, (8 - 3) * 49.5);
  });

  it('sin texto leído no agrega la letra ni la capa de texto', () => {
    const s = Buffer.from(crearPDF([{ tipo: 'jpeg', bytes: JPEG_COLOR_16x8 }])).toString('latin1');
    assert.doesNotMatch(s, /BT 3 Tr/);
    assert.doesNotMatch(s, /\/Font << \/F1/);
  });

  it('dos páginas paradas por hoja: la hoja se acuesta y van de lado a lado', () => {
    const gris = { tipo: 'jpeg', bytes: JPEG_GRIS_10x20 };
    const s = revisarEstructura(crearPDF([gris, gris, gris], { tamano: 'carta', porHoja: 2 }));
    assert.equal((s.match(/\/Type \/Page /g) || []).length, 2, 'tres páginas en dos hojas');
    assert.equal((s.match(/\/Subtype \/Image/g) || []).length, 3);
    assert.match(s, /\/MediaBox \[0 0 792 612\]/);
    const [a, b] = [...s.matchAll(/q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im(\d) Do Q/g)].map(m => m.slice(1, 6).map(Number));
    assert.equal(a[4], 0); assert.equal(b[4], 1);
    assert.ok(a[2] + a[0] <= 396 && b[2] >= 396, 'una a cada lado del medio');
    assert.match(s, /re S Q/, 'con raya alrededor para recortar');
  });

  it('cuatro por hoja van en 2 × 2, de izquierda a derecha y de arriba abajo', () => {
    const gris = { tipo: 'jpeg', bytes: JPEG_GRIS_10x20 };
    const s = revisarEstructura(crearPDF([gris, gris, gris, gris, gris], { tamano: 'a4', porHoja: 4 }));
    assert.equal((s.match(/\/Type \/Page /g) || []).length, 2);
    assert.match(s, /\/MediaBox \[0 0 595.28 841.89\]/);
    const casillas = [...s.matchAll(/q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im(\d) Do Q/g)].slice(0, 4).map(m => ({ x: +m[3], y: +m[4], k: +m[5] }));
    assert.deepEqual(casillas.map(c => c.k), [0, 1, 2, 3]);
    assert.ok(casillas[0].x < casillas[1].x && casillas[0].y === casillas[1].y);
    assert.ok(casillas[2].y < casillas[0].y && casillas[2].x === casillas[0].x);
  });

  it('dos acostadas por hoja van una arriba de la otra, cada una con su texto', () => {
    const conTexto = { tipo: 'jpeg', bytes: JPEG_COLOR_16x8, texto: { ancho: 16, alto: 8, lineas: [{ y0: 1, y1: 7, base: null, palabras: [{ t: 'Hola', x0: 1, y0: 1, x1: 15, y1: 7 }] }] } };
    const s = revisarEstructura(crearPDF([conTexto, conTexto], { tamano: 'carta', porHoja: 2 }));
    assert.match(s, /\/MediaBox \[0 0 612 792\]/);
    const [a, b] = [...s.matchAll(/cm \/Im\d Do Q/g)].map(m => m.index);
    assert.ok(a < b);
    const ys = [...s.matchAll(/q [\d.]+ 0 0 [\d.]+ ([\d.]+) ([\d.]+) cm/g)].map(m => +m[2]);
    assert.ok(ys[0] > ys[1], 'la primera arriba');
    assert.equal((s.match(/BT 3 Tr/g) || []).length, 2, 'el texto de las dos');
  });

  it('un documento sin páginas no se puede exportar', () => {
    assert.throws(() => crearPDF([]), /no tiene páginas/);
  });
});

// ── PDF con contraseña: se comprueba con otra implementación (node:crypto) ──

/** Algoritmo 2.B de ISO 32000-2, escrito aparte con node:crypto */
function hash2B(clave, sal, u = Buffer.alloc(0)) {
  let k = createHash('sha256').update(Buffer.concat([clave, sal, u])).digest();
  let e = Buffer.alloc(1);
  for (let i = 0; i < 64 || e[e.length - 1] > i - 32; i++) {
    const k1 = Buffer.concat(Array(64).fill(Buffer.concat([clave, k, u])));
    const c = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32)).setAutoPadding(false);
    e = Buffer.concat([c.update(k1), c.final()]);
    const suma = [...e.subarray(0, 16)].reduce((s, b) => s + b, 0);
    k = createHash(['sha256', 'sha384', 'sha512'][suma % 3]).update(e).digest();
  }
  return k.subarray(0, 32);
}
const descifrar = (clave, datos) => {
  const d = createDecipheriv('aes-256-cbc', clave, datos.subarray(0, 16));
  return Buffer.concat([d.update(datos.subarray(16)), d.final()]);
};

describe('PDF con contraseña (AES-256)', () => {
  const contrasena = 'Mi clave ñ 2026';
  const textoLeido = { ancho: 16, alto: 8, lineas: [{ y0: 1, y1: 3, base: null, palabras: [{ t: 'Hola', x0: 1, y0: 1, x1: 7, y1: 3 }] }] };
  let pdf, s, dicc;
  it('lleva el cifrado estándar revisión 6 y no deja nada a la vista', async () => {
    pdf = Buffer.from(await crearPDFConContrasena([{ tipo: 'jpeg', bytes: JPEG_COLOR_16x8, texto: textoLeido }], { tamano: 'foto', titulo: 'Tarea secreta' }, contrasena));
    s = pdf.toString('latin1');
    assert.ok(s.startsWith('%PDF-1.7'));
    dicc = s.match(/<< \/Filter \/Standard [^]*?\/EncryptMetadata true >>/)[0];
    assert.match(dicc, /\/V 5 \/R 6 \/Length 256/);
    assert.match(dicc, /\/CFM \/AESV3/);
    assert.match(s, /\/Encrypt \d+ 0 R \/ID \[<[0-9A-F]{32}> <[0-9A-F]{32}>\]/);
    assert.doesNotMatch(s, /Im0 Do|Hola|BT 3 Tr/, 'la página va cifrada');
    assert.ok(!pdf.includes(Buffer.from(JPEG_COLOR_16x8)), 'la imagen va cifrada');
    assert.doesNotMatch(s, /FEFF0054/, 'el título va cifrado');
  });

  it('con la contraseña se descifra: la comprueba y abre la página, la imagen y el título', () => {
    const campo = nombre => Buffer.from(dicc.match(new RegExp(`/${nombre} <([0-9A-F]+)>`))[1], 'hex');
    const clave = Buffer.from(contrasena.normalize('NFKC'), 'utf8');
    const U = campo('U'), UE = campo('UE');
    assert.equal(U.length, 48);
    assert.deepEqual(hash2B(clave, U.subarray(32, 40)), U.subarray(0, 32), 'la contraseña se comprueba');
    assert.notDeepEqual(hash2B(Buffer.from('otra'), U.subarray(32, 40)), U.subarray(0, 32), 'otra contraseña no');
    const d = createDecipheriv('aes-256-cbc', hash2B(clave, U.subarray(40, 48)), Buffer.alloc(16)).setAutoPadding(false);
    const archivo = Buffer.concat([d.update(UE), d.final()]);
    // Permisos: descifrados dicen "adb" en su lugar
    const pe = createDecipheriv('aes-256-ecb', archivo, null).setAutoPadding(false);
    const permisos = Buffer.concat([pe.update(campo('Perms')), pe.final()]);
    assert.equal(permisos.subarray(9, 12).toString(), 'adb');
    // Cada stream: IV + AES-256-CBC
    const flujos = [...s.matchAll(/\/Length (\d+) >>\nstream\n/g)].map(m => pdf.subarray(m.index + m[0].length, m.index + m[0].length + Number(m[1])));
    const claros = flujos.map(f => descifrar(archivo, f));
    assert.ok(claros.some(c => /\/Im0 Do/.test(c.toString('latin1')) && /\(Hola\) Tj/.test(c.toString('latin1'))), 'el contenido de la página');
    assert.ok(claros.some(c => c.equals(Buffer.from(JPEG_COLOR_16x8))), 'la imagen, igualita');
    const titulo = descifrar(archivo, Buffer.from(s.match(/\/Title <([0-9A-F]+)>/)[1], 'hex'));
    assert.equal(titulo.subarray(2).swap16().toString('utf16le'), 'Tarea secreta');
  });

  it('sin contraseña no se arma', async () => {
    await assert.rejects(crearPDFConContrasena([{ tipo: 'jpeg', bytes: JPEG_COLOR_16x8 }], {}, ''), /Falta la contraseña/);
  });
});
