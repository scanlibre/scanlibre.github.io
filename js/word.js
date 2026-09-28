// ScanLibre · word.js
// El texto leído en un documento de Word (.docx), para seguir trabajándolo en
// Word, Google Docs o LibreOffice. Un .docx es un .zip con unos XML adentro:
// se arma aquí mismo, sin librerías.
// En el libro los renglones se cortan por el ancho de la hoja; en Word no hace
// falta, así que los renglones de cada párrafo se juntan. Las listas ("1)",
// "a)", "•") siguen empezando aparte.

import { crearZip } from './respaldo.js';

// Lo que XML no admite (caracteres de control) se quita; & < > se escapan
const escapar = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const LISTA = /^(\(?\d{1,3}[.)°º-]|\(?[a-zñ][.)]|[•·▪◦\-–—])\s/i;

/** Los párrafos de un texto leído: los renglones juntados y las listas aparte */
export function parrafos(texto) {
  const out = [];
  for (const bloque of String(texto).split(/\n\s*\n/)) {
    let actual = '';
    for (const renglon of bloque.split('\n').map(r => r.trim()).filter(Boolean)) {
      if (actual && LISTA.test(renglon)) { out.push(actual); actual = renglon; }
      else if (/\p{L}[-‐]$/u.test(actual) && /^\p{Ll}/u.test(renglon)) actual = actual.slice(0, -1) + renglon; // "su-" + "jetos"
      else actual = actual ? `${actual} ${renglon}` : renglon;
    }
    if (actual) out.push(actual);
  }
  return out;
}

const trozo = (texto, { negrita = false, tam = 0 } = {}) =>
  `<w:r><w:rPr>${negrita ? '<w:b/>' : ''}${tam ? `<w:sz w:val="${tam}"/>` : ''}<w:lang w:val="es-HN"/></w:rPr><w:t xml:space="preserve">${escapar(texto)}</w:t></w:r>`;
const parrafo = (contenido, despues = 160) => `<w:p><w:pPr><w:spacing w:after="${despues}"/></w:pPr>${contenido}</w:p>`;

/**
 * @param titulo  el nombre del documento
 * @param paginas [{ n, texto }]
 * @returns Blob del .docx
 */
export async function crearWord(titulo, paginas) {
  const cuerpo = [parrafo(trozo(titulo, { negrita: true, tam: 36 }), 280)];
  const varias = paginas.length > 1;
  for (const p of paginas) {
    if (varias) cuerpo.push(parrafo(trozo(`Página ${p.n}`, { negrita: true, tam: 26 }), 120));
    const ps = parrafos(p.texto || '');
    if (!ps.length) cuerpo.push(parrafo(trozo('(Sin texto)')));
    for (const t of ps) cuerpo.push(parrafo(trozo(t)));
  }
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  // Hoja carta con márgenes de 2,5 cm (en veinteavos de punto)
  const documento = `${xml}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${cuerpo.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const tipos = `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const relaciones = `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const datos = `${xml}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapar(titulo)}</dc:title><dc:creator>ScanLibre</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`;
  const bytes = s => new TextEncoder().encode(s);
  const zip = await crearZip([
    { nombre: '[Content_Types].xml', datos: bytes(tipos) },
    { nombre: '_rels/.rels', datos: bytes(relaciones) },
    { nombre: 'word/document.xml', datos: bytes(documento) },
    { nombre: 'docProps/core.xml', datos: bytes(datos) }
  ]);
  return new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
