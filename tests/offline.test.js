import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearEntorno } from './ayuda.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

function archivos(dir) {
  return readdirSync(dir).flatMap(n => {
    const r = join(dir, n);
    return statSync(r).isDirectory() ? archivos(r) : [relative(RAIZ, r)];
  });
}

describe('Sin internet', () => {
  let env;
  before(async () => { env = await crearEntorno(); });
  after(async () => { await env.cerrar(); });

  it('el service worker guarda todos los archivos de la app', () => {
    const sw = readFileSync(join(RAIZ, 'sw.js'), 'utf8');
    const lista = JSON.parse(sw.match(/const ARCHIVOS = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
    const necesarios = [
      'index.html', 'manifest.json',
      ...archivos(join(RAIZ, 'js')), ...archivos(join(RAIZ, 'css')),
      ...archivos(join(RAIZ, 'icons')).filter(f => /\.(png|svg)$/.test(f) && !f.includes('maskable.svg'))
    ];
    for (const f of necesarios) assert.ok(lista.includes(f), `falta ${f} en sw.js`);
    for (const f of lista.filter(f => f !== './')) assert.ok(necesarios.includes(f) || f.endsWith('.svg') || (f.startsWith('vendor/') && existsSync(join(RAIZ, f))), `${f} no existe`);
  });

  it('después de abrirla una vez, abre sin conexión', async () => {
    const page = await env.pagina();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    });
    await page.context().setOffline(true);
    await page.reload();
    await page.waitForSelector('#vista-inicio:not([hidden])');
    assert.equal(await page.isVisible('#inicio-escanear'), true);
    assert.deepEqual(page.errores, []);
  });
});
