// Ayudas para las pruebas que abren la app en Chromium
import { chromium } from 'playwright';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { servir } from './servidor.js';
import { crearEscena, aPNG, ESCENAS, desenfocar } from './escenas.js';
import { escribirY4M } from './video-falso.js';

export const carpeta = mkdtempSync(join(tmpdir(), 'scanlibre-'));

/** Guarda una foto de prueba (escena k al doble de tamaño) y devuelve su ruta y las esquinas reales (0..1) */
export function fotoDePrueba(k = 1, nombre = `foto${k}.png`, { borrosa = false } = {}) {
  const e = ESCENAS[k];
  const esquinas = e.esquinas.map(p => ({ x: p.x * 2, y: p.y * 2 }));
  const ruta = join(carpeta, nombre);
  const escena = crearEscena({ ...e, ancho: 960, alto: 1280, esquinas, semilla: k + 1 });
  writeFileSync(ruta, aPNG(borrosa ? desenfocar(escena, 2) : escena));
  return { ruta, esquinas: esquinas.map(p => ({ x: p.x / 960, y: p.y / 1280 })) };
}

/**
 * Video de cámara falso con la escena k.
 * @param borrosa  como si la cámara no enfocara
 * @param temblor  píxeles que se mueve la imagen, como en una mano que tiembla (3 s que se repiten)
 */
export function videoDePrueba(k = 1, { borrosa = false, temblor = 0 } = {}) {
  const e = ESCENAS[k], f = 1.5, W = 720, H = 960;
  const ruta = join(carpeta, `camara${k}${borrosa ? '-borrosa' : ''}${temblor ? '-temblor' + temblor : ''}.y4m`);
  const m = Math.ceil(2 * temblor); // margen para mover la ventana
  let escena = crearEscena({ ...e, ancho: W + 2 * m, alto: H + 2 * m, esquinas: e.esquinas.map(p => ({ x: p.x * f + m, y: p.y * f + m })), semilla: k + 1 });
  if (borrosa) escena = desenfocar(escena, 2);
  escribirY4M(ruta, temblor ? cuadrosConTemblor(escena, W, H, m, temblor) : [escena]);
  return ruta;
}

/** 45 cuadros (3 s a 15 por segundo) de una ventana que tiembla a 4 y 6⅓ vueltas por segundo */
function cuadrosConTemblor(escena, W, H, m, a) {
  const cuadros = [];
  for (let n = 0; n < 45; n++) {
    const t = n / 15;
    const ox = Math.round(m + a * (Math.sin(2 * Math.PI * 4 * t) + 0.6 * Math.sin(2 * Math.PI * 19 / 3 * t + 1)) / 1.6);
    const oy = Math.round(m + a * (Math.cos(2 * Math.PI * 4 * t + 2) + 0.6 * Math.sin(2 * Math.PI * 19 / 3 * t)) / 1.6);
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) data.set(escena.data.subarray(((y + oy) * escena.width + ox) * 4, ((y + oy) * escena.width + ox + W) * 4), y * W * 4);
    cuadros.push({ data, width: W, height: H });
  }
  return cuadros;
}

export async function crearEntorno({ video } = {}) {
  const srv = await servir();
  const args = video ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] : [];
  // Con UTF-8: sin eso, Chromium en Linux descarga "Cálculo.pdf" como "download"
  const navegador = await chromium.launch({ args, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  return {
    url: srv.url,
    /** @param antes código que corre en la página antes que la app (por ejemplo, para simular algo del teléfono) */
    async pagina({ oscuro = false, conCamara = !!video, antes = null } = {}) {
      const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, colorScheme: oscuro ? 'dark' : 'light', acceptDownloads: true });
      if (antes) await ctx.addInitScript(antes);
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

/** Foto de una hoja con texto impreso (captura de una página HTML) */
export async function fotoConTexto(nombre, lineas) {
  const nav = await chromium.launch();
  const p = await nav.newPage({ viewport: { width: 1000, height: 700 } });
  await p.setContent(`<body style="margin:60px;font:40px Georgia;background:#fff;color:#111">${lineas.map(l => `<p>${l}</p>`).join('')}</body>`);
  const ruta = join(carpeta, nombre);
  await p.screenshot({ path: ruta });
  await nav.close();
  return ruta;
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
    const carpetas = db.objectStoreNames.contains('carpetas') ? await todo('carpetas') : [];
    db.close();
    return { documentos, paginas, carpetas };
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
