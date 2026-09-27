// ScanLibre · pdf.js
// Escritor de PDF propio, sin librerías: cada página es una imagen.
//  · Fotos a color o en gris: el JPEG va tal cual dentro del PDF (DCTDecode).
//  · Blanco y negro: 1 bit por píxel comprimido (FlateDecode). El texto queda
//    nítido y el archivo pesa mucho menos que con JPEG.
//  · Con el texto leído (OCR), encima de la imagen va el texto invisible en su
//    lugar: el PDF se puede buscar y copiar, y se sigue viendo igual.

const texto = new TextEncoder();

/** Tamaños de hoja en puntos (1/72 de pulgada) */
export const TAMANOS = {
  carta: [612, 792],
  a4: [595.28, 841.89]
};

/** Ancho, alto y número de canales leídos del encabezado SOF del JPEG */
export function infoJPEG(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('No es un JPEG');
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const largo = (b[i + 2] << 8) | b[i + 3];
    // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { alto: (b[i + 5] << 8) | b[i + 6], ancho: (b[i + 7] << 8) | b[i + 8], canales: b[i + 9] };
    }
    i += 2 + largo;
  }
  throw new Error('JPEG sin encabezado de tamaño');
}

/** Pasa una imagen RGBA de blanco y negro a 1 bit por píxel (1 = blanco), filas completas en bytes */
export function aBits({ data, width, height }) {
  const porFila = Math.ceil(width / 8);
  const out = new Uint8Array(porFila * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29 >= 128 * 256) out[y * porFila + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

function fechaPDF(d) {
  const p = n => String(n).padStart(2, '0');
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Texto para el diccionario Info: UTF-16BE con su marca (admite tildes y ñ) */
function utf16(s) {
  const unidades = [0xfeff];
  for (const c of String(s)) {
    const cp = c.codePointAt(0);
    if (cp > 0xffff) unidades.push(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff));
    else unidades.push(cp);
  }
  const b = new Uint8Array(unidades.length * 2);
  unidades.forEach((u, i) => { b[2 * i] = u >> 8; b[2 * i + 1] = u & 255; });
  return b;
}

const hexDe = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();

const num = n => (Math.round(n * 100) / 100).toString();

// Letras de Windows-1252 (WinAnsiEncoding) fuera de Latin-1
const WIN_ANSI = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f
};

/** Texto como cadena PDF en WinAnsi (tildes y ñ incluidas); lo que no existe ahí queda como "?" */
export function cadenaPDF(s) {
  let out = '(';
  for (const c of s) {
    let code = c.codePointAt(0);
    if (code >= 0x80 && !(code >= 0xa0 && code <= 0xff)) code = WIN_ANSI[c] ?? 0x3f;
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += '\\' + String.fromCharCode(code);
    else if (code < 0x20 || code > 0x7e) out += '\\' + code.toString(8).padStart(3, '0');
    else out += String.fromCharCode(code);
  }
  return out + ')';
}

/**
 * Texto invisible (modo 3) sobre la imagen. Cada palabra va en su lugar con
 * Courier (todas las letras miden 0,6 em) estirada a lo ancho de la palabra,
 * así al buscar o seleccionar se marca justo la palabra de la foto.
 * `texto` = { ancho, alto, lineas } en píxeles de la imagen de la página.
 */
function capaDeTexto({ ancho, alto, lineas }, dx, dy, dw, dh) {
  const kx = dw / ancho, ky = dh / alto;
  let s = 'BT 3 Tr\n';
  for (const l of lineas) {
    const tam = Math.max(1, (l.y1 - l.y0) * ky);
    l.palabras.forEach((p, i) => {
      // Línea base: la recta que da el lector, o el borde de abajo de la palabra
      let base = p.y1;
      if (l.base) {
        const [bx0, by0, bx1, by1] = l.base, cx = (p.x0 + p.x1) / 2;
        base = bx1 !== bx0 ? by0 + (by1 - by0) * (cx - bx0) / (bx1 - bx0) : by0;
      }
      const escala = Math.max(1, 100 * (p.x1 - p.x0) * kx / (0.6 * tam * [...p.t].length));
      const texto = i < l.palabras.length - 1 ? p.t + ' ' : p.t;
      s += `/F1 ${num(tam)} Tf ${num(escala)} Tz 1 0 0 1 ${num(dx + p.x0 * kx)} ${num(dy + (alto - base) * ky)} Tm ${cadenaPDF(texto)} Tj\n`;
    });
  }
  return s + 'ET';
}

/**
 * Los objetos del PDF, todavía sin escribir: así se pueden cifrar antes.
 * Un objeto es { n, cuerpo } o, si lleva datos, { n, dicc, flujo } (el /Length se pone al escribir).
 */
function armar(paginas, { tamano = 'carta', titulo = 'Escaneo', fecha = new Date() } = {}) {
  if (!paginas.length) throw new Error('El documento no tiene páginas');
  const PRIMERA = 5; // 1 catálogo, 2 páginas, 3 datos, 4 letra del texto invisible
  const objetos = [];
  const kids = paginas.map((_, i) => `${PRIMERA + i * 3} 0 R`).join(' ');
  objetos.push({ n: 2, cuerpo: `<< /Type /Pages /Kids [${kids}] /Count ${paginas.length} >>` });
  objetos.push({ n: 4, cuerpo: '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>' });

  paginas.forEach((pag, i) => {
    const nPag = PRIMERA + i * 3, nCont = nPag + 1, nImg = nPag + 2;
    let ancho, alto, dicc;
    if (pag.tipo === 'jpeg') {
      const inf = infoJPEG(pag.bytes);
      ({ ancho, alto } = inf);
      const color = inf.canales === 1 ? '/DeviceGray' : inf.canales === 4 ? '/DeviceCMYK' : '/DeviceRGB';
      dicc = `/ColorSpace ${color} /BitsPerComponent 8 /Filter /DCTDecode`;
    } else {
      ({ ancho, alto } = pag);
      dicc = '/ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode';
    }
    // Hoja: vertical u horizontal según la imagen; la imagen se centra ocupando lo más posible
    let pw, ph;
    if (tamano === 'foto' || !TAMANOS[tamano]) {
      const k = 792 / Math.max(ancho, alto);
      pw = ancho * k; ph = alto * k;
    } else {
      [pw, ph] = TAMANOS[tamano];
      if (ancho > alto) [pw, ph] = [ph, pw];
    }
    const k = Math.min(pw / ancho, ph / alto);
    const dw = ancho * k, dh = alto * k, dx = (pw - dw) / 2, dy = (ph - dh) / 2;
    const conTexto = pag.texto?.lineas?.length > 0;
    let dibujo = `q ${num(dw)} 0 0 ${num(dh)} ${num(dx)} ${num(dy)} cm /Im0 Do Q`;
    if (conTexto) dibujo += '\n' + capaDeTexto(pag.texto, dx, dy, dw, dh);
    const letra = conTexto ? ' /Font << /F1 4 0 R >>' : '';
    objetos.push({ n: nPag, cuerpo: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pw)} ${num(ph)}] /Resources << /XObject << /Im0 ${nImg} 0 R >>${letra} /ProcSet [/PDF /Text /ImageB /ImageC] >> /Contents ${nCont} 0 R >>` });
    objetos.push({ n: nCont, dicc: '<<', flujo: texto.encode(dibujo) });
    objetos.push({ n: nImg, dicc: `<< /Type /XObject /Subtype /Image /Width ${ancho} /Height ${alto} ${dicc}`, flujo: pag.bytes });
  });
  // Los datos del documento: textos sueltos (se cifran aparte si hay contraseña)
  const info = { Title: utf16(titulo), Producer: texto.encode('ScanLibre'), Creator: texto.encode('ScanLibre'), CreationDate: texto.encode(fechaPDF(fecha)) };
  return { objetos, info, total: PRIMERA + paginas.length * 3 };
}

/** Escribe el archivo: encabezado, objetos, tabla xref y trailer */
function escribir({ objetos, info, total }, { cifrado = null } = {}) {
  const partes = [];
  let largo = 0;
  const offsets = [];
  const poner = p => { const b = typeof p === 'string' ? texto.encode(p) : p; partes.push(b); largo += b.length; };
  const objeto = o => {
    offsets[o.n] = largo;
    if (!o.flujo) { poner(`${o.n} 0 obj\n${o.cuerpo}\nendobj\n`); return; }
    poner(`${o.n} 0 obj\n${o.dicc} /Length ${o.flujo.length} >>\nstream\n`);
    poner(o.flujo);
    poner('\nendstream\nendobj\n');
  };
  // AES-256 es de PDF 2.0; como "1.7 con la extensión 8 de Adobe" lo abren también los lectores de antes
  poner(cifrado ? '%PDF-1.7\n' : '%PDF-1.4\n');
  poner(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // marca de archivo binario
  const extension = cifrado ? ' /Extensions << /ADBE << /BaseVersion /1.7 /ExtensionLevel 8 >> >>' : '';
  objeto({ n: 1, cuerpo: `<< /Type /Catalog /Pages 2 0 R${extension} >>` });
  objeto({ n: 3, cuerpo: '<< ' + Object.entries(info).map(([k, v]) => `/${k} <${hexDe(v)}>`).join(' ') + ' >>' });
  for (const o of objetos) objeto(o);
  let n = total;
  if (cifrado) objeto({ n: n++, cuerpo: cifrado.diccionario });
  const inicioXref = largo;
  let xref = `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 1; i < n; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  poner(xref);
  const extra = cifrado ? ` /Encrypt ${n - 1} 0 R /ID [<${cifrado.id}> <${cifrado.id}>]` : '';
  poner(`trailer\n<< /Size ${n} /Root 1 0 R /Info 3 0 R${extra} >>\nstartxref\n${inicioXref}\n%%EOF\n`);

  const out = new Uint8Array(largo);
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * Arma el PDF.
 * @param paginas [{ tipo: 'jpeg', bytes } | { tipo: 'bits', bytes (zlib), ancho, alto }],
 *                cada una puede traer `texto` ({ ancho, alto, lineas }, del lector de texto)
 * @param opciones.tamano 'carta' | 'a4' | 'foto' (la hoja toma la forma de la imagen)
 * @returns Uint8Array con el archivo
 */
export function crearPDF(paginas, opciones) {
  return escribir(armar(paginas, opciones));
}

/**
 * El mismo PDF, pero se abre solo con la contraseña (AES-256). Se cifran las
 * imágenes, el texto de cada página y los datos del documento (el título).
 */
export async function crearPDFConContrasena(paginas, opciones, contrasena) {
  if (!contrasena) throw new Error('Falta la contraseña');
  const { prepararCifrado } = await import('./cifrado.js');
  const armado = armar(paginas, opciones);
  const cifrado = await prepararCifrado(contrasena);
  for (const o of armado.objetos) if (o.flujo) o.flujo = await cifrado.cifrar(o.flujo);
  for (const k of Object.keys(armado.info)) armado.info[k] = await cifrado.cifrar(armado.info[k]);
  return escribir(armado, { cifrado });
}
