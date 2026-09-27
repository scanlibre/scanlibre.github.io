import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { crearPDF, infoJPEG, aBits, cadenaPDF } from '../js/pdf.js';
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

  it('un documento sin páginas no se puede exportar', () => {
    assert.throws(() => crearPDF([]), /no tiene páginas/);
  });
});
