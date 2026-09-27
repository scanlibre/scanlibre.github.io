// Ayudas para las pruebas que abren la app en Chromium
import { chromium } from 'playwright';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { servir } from './servidor.js';
import { crearEscena, aPNG, ESCENAS } from './escenas.js';
import { escribirY4M } from './video-falso.js';

export const carpeta = mkdtempSync(join(tmpdir(), 'scanlibre-'));

/** Guarda una foto de prueba (escena k al doble de tamaño) y devuelve su ruta y las esquinas reales (0..1) */
export function fotoDePrueba(k = 1, nombre = `foto${k}.png`) {
  const e = ESCENAS[k];
  const esquinas = e.esquinas.map(p => ({ x: p.x * 2, y: p.y * 2 }));
  const ruta = join(carpeta, nombre);
  writeFileSync(ruta, aPNG(crearEscena({ ...e, ancho: 960, alto: 1280, esquinas, semilla: k + 1 })));
  return { ruta, esquinas: esquinas.map(p => ({ x: p.x / 960, y: p.y / 1280 })) };
}

/** Video de cámara falso con la escena k */
export function videoDePrueba(k = 1) {
  const e = ESCENAS[k], f = 1.5;
  const ruta = join(carpeta, `camara${k}.y4m`);
  escribirY4M(ruta, [crearEscena({ ...e, ancho: 720, alto: 960, esquinas: e.esquinas.map(p => ({ x: p.x * f, y: p.y * f })), semilla: k + 1 })]);
  return ruta;
}

export async function crearEntorno({ video } = {}) {
  const srv = await servir();
  const args = video ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] : [];
  const navegador = await chromium.launch({ args });
  return {
    url: srv.url,
    async pagina({ oscuro = false, conCamara = !!video } = {}) {
      const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, colorScheme: oscuro ? 'dark' : 'light', acceptDownloads: true });
      if (conCamara) await ctx.grantPermissions(['camera'], { origin: srv.url.replace(/\/$/, '') });
      const page = await ctx.newPage();
      page.errores = [];
      page.on('pageerror', e => page.errores.push(e.message));
      page.on('console', m => { if (m.type() === 'error') page.errores.push(m.text()); });
      await page.goto(srv.url);
      await page.waitForSelector('#vista-inicio:not([hidden])');
      return page;
    },
    async cerrar() { await navegador.close(); await srv.cerrar(); }
  };
}

export async function importarFoto(page, ...rutas) {
  const [selector] = await Promise.all([page.waitForEvent('filechooser'), page.click('#inicio-importar')]);
  await selector.setFiles(rutas);
  await page.waitForFunction(n => document.querySelectorAll('#doc-paginas .miniatura img').length === n, rutas.length, { timeout: 30000 });
}

/** Lo que hay guardado en IndexedDB (sin las imágenes, solo sus tamaños) */
export function leerBase(page) {
  return page.evaluate(async () => {
    const db = await new Promise((r, x) => { const q = indexedDB.open('scanlibre'); q.onsuccess = () => r(q.result); q.onerror = x; });
    const todo = nombre => new Promise(r => { const q = db.transaction(nombre).objectStore(nombre).getAll(); q.onsuccess = () => r(q.result); });
    const documentos = await todo('documentos');
    const paginas = (await todo('paginas')).map(p => ({ ...p, original: p.original.size, procesada: p.procesada.size, tipo: p.procesada.type, miniatura: p.miniatura.size }));
    db.close();
    return { documentos, paginas };
  });
}

/** Crea el PDF desde la pantalla del documento y devuelve sus bytes como texto latin1 */
export async function descargarPDF(page) {
  await page.click('#doc-pdf');
  await page.click('dialog .hoja-botones .boton-primario');
  await page.waitForSelector('.resultado-pdf', { timeout: 30000 });
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('dialog .hoja-botones .boton-secundario')]);
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(await descarga.path());
  await page.keyboard.press('Escape');
  return { texto: bytes.toString('latin1'), nombre: descarga.suggestedFilename() };
}

export const distanciaMax = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
