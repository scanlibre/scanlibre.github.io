import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { VERSION } from '../js/version.js';

const raiz = new URL('..', import.meta.url);
const sw = readFileSync(new URL('sw.js', raiz), 'utf8');

describe('Versión publicada', () => {
  it('sw.js y js/version.js dicen la misma versión', () => {
    assert.match(sw, new RegExp(`const VERSION = 'scanlibre-v${VERSION}';`));
  });

  it('el modo sin conexión guarda todos los archivos de la app', () => {
    const js = dir => readdirSync(new URL(dir, raiz)).filter(f => f.endsWith('.js')).map(f => dir + f);
    for (const archivo of [...js('js/'), ...js('js/imagen/'), ...js('js/vistas/')]) {
      assert.ok(sw.includes(`'${archivo}'`), `falta ${archivo} en sw.js`);
    }
  });
});
