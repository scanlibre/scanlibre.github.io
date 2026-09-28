import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parrafos, crearWord } from '../js/word.js';
import { leerZip } from '../js/respaldo.js';

describe('Texto a Word (.docx)', () => {
  const texto = 'Artículo 122.- Etapas del procedimiento de determinación de\noficio.\n\n1) El procedimiento de determinación de los tributos su-\njetos a la declaración;\n2) El procedimiento se debe iniciar de oficio\na) Un cinco por ciento (5%)';

  it('junta los renglones de cada párrafo, une las palabras cortadas y deja las listas aparte', () => {
    assert.deepEqual(parrafos(texto), [
      'Artículo 122.- Etapas del procedimiento de determinación de oficio.',
      '1) El procedimiento de determinación de los tributos sujetos a la declaración;',
      '2) El procedimiento se debe iniciar de oficio',
      'a) Un cinco por ciento (5%)'
    ]);
    assert.deepEqual(parrafos(''), []);
  });

  it('arma un .docx con título, páginas y el texto escapado', async () => {
    const blob = await crearWord('Tarea <1> & más', [{ n: 1, texto }, { n: 2, texto: 'a < b & c' }]);
    assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const zip = await leerZip(blob);
    assert.deepEqual([...zip.keys()].sort(), ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/document.xml']);
    const doc = await zip.get('word/document.xml').text();
    assert.match(doc, /<w:t xml:space="preserve">Tarea &lt;1&gt; &amp; más<\/w:t>/);
    assert.match(doc, />Página 2</);
    assert.match(doc, />a &lt; b &amp; c</);
    assert.equal((doc.match(/<w:p>/g) || []).length, 1 + 2 + 4 + 1);
    assert.match(await zip.get('docProps/core.xml').text(), /<dc:title>Tarea &lt;1&gt; &amp; más<\/dc:title>/);
  });
});
