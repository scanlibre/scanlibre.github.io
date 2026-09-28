import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { frases } from '../js/voz.js';

describe('Leer en voz alta', () => {
  const texto = '— Página 1 —\nArtículo 122.- Etapas del procedimiento de determinación de oficio.\n1) El procedimiento de determinación de los tributos sujetos a la declaración, liquidación o autoliquidación por los obligados tributarios, se inicia con actuaciones de comprobación o de fiscalización; 2) El procedimiento se debe iniciar de oficio por el órgano competente quien debe notificar a los obligados tributarios indicando la naturaleza y alcance del procedimiento e informando sobre sus derechos y obligaciones en el curso de las actuaciones.';
  const fs = frases(texto);

  it('corta en frases de a lo más 220 letras, sin perder texto', () => {
    assert.ok(fs.length >= 4, `${fs.length} frases`);
    for (const f of fs) assert.ok(f.texto.length <= 220, f.texto);
    const juntas = fs.map(f => f.texto).join(' ').replace(/\s+/g, '');
    assert.equal(juntas, texto.replace(/[—–]/g, '').replace(/\s+/g, ''));
  });

  it('junta lo muy corto con lo que sigue y sabe dónde está cada frase en el texto', () => {
    assert.match(fs[0].texto, /^Página 1 Artículo 122\./, 'el encabezado y "Artículo 122." no van solos');
    for (const f of fs) assert.equal(texto.slice(f.inicio, f.fin).replace(/[—–]/g, ' ').replace(/\s+/g, ' ').trim(), f.texto);
  });

  it('un texto vacío no tiene frases', () => {
    assert.deepEqual(frases(''), []);
    assert.deepEqual(frases(' \n\n '), []);
  });
});
