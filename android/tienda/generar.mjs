// ScanLibre · android/tienda/generar.mjs
// Las capturas de la app para la ficha de Google Play (1080 × 1920) y el
// gráfico destacado (1024 × 500). Se toman de la app de verdad, con hojas de
// ejemplo fotografiadas "sobre una mesa". Correr con:  node android/tienda/generar.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { servir } from '../../tests/servidor.js';
import { carpeta } from '../../tests/ayuda.js';
import { escribirY4M } from '../../tests/video-falso.js';

const AQUI = fileURLToPath(new URL('.', import.meta.url));
const SALIDA = join(AQUI, 'capturas');
mkdirSync(SALIDA, { recursive: true });

const HOJAS = {
  celula: ['La célula', 'La célula es la unidad básica de la vida. Todos los seres vivos están formados por células, y cada una viene de otra célula.', 'Partes principales: membrana, citoplasma y núcleo. La membrana controla lo que entra y lo que sale.'],
  derivadas: ['Derivadas', 'La derivada mide qué tan rápido cambia una función en cada punto: es la pendiente de la recta tangente.', 'Para calcularla se usan reglas: la de la suma, la del producto, la del cociente y la de la cadena.'],
  limites: ['Límites', 'El límite de f(x) cuando x tiende a a es el valor al que se acerca f(x). Ejemplo: el límite de (x² − 1)/(x − 1) cuando x → 1 es 2.', 'Si el límite por la izquierda y por la derecha no coinciden, el límite no existe.'],
  historia: ['Independencia de Centroamérica', 'El 15 de septiembre de 1821 se firmó en Guatemala el Acta de Independencia de Centroamérica.', 'Honduras formó parte después de la República Federal de Centro América, hasta 1838.']
};

/** Una hoja con texto, fotografiada torcida sobre una mesa de madera */
async function hojaSobreMesa(navegador, nombre, [titulo, ...parrafos], { ancho = 1200, alto = 1560, giro = -3 } = {}) {
  const p = await navegador.newPage({ viewport: { width: ancho, height: alto } });
  await p.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 30% 20%,#8a6a4f,#5a4230 70%);overflow:hidden">
    <div style="width:${ancho * 0.72}px;height:${alto * 0.8}px;background:#fbfaf6;transform:rotate(${giro}deg) perspective(1400px) rotateX(4deg);box-shadow:0 25px 60px rgba(0,0,0,.45);padding:70px 64px;box-sizing:border-box;font:34px/1.55 Georgia,serif;color:#1d1d1f">
      <h1 style="font-size:52px;margin:0 0 28px">${titulo}</h1>${parrafos.map(t => `<p style="margin:0 0 26px">${t}</p>`).join('')}
    </div></body>`);
  const ruta = join(carpeta, nombre);
  await p.screenshot({ path: ruta });
  await p.close();
  return ruta;
}

const srv = await servir();
const nav = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const hojas = {};
for (const [k, texto] of Object.entries(HOJAS)) hojas[k] = await hojaSobreMesa(nav, `tienda-${k}.png`, texto, { giro: k === 'historia' ? 2 : -3 });

const ctx = await nav.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, colorScheme: 'light', locale: 'es-HN' });
const page = await ctx.newPage();
await page.goto(srv.url);
await page.waitForSelector('#vista-inicio:not([hidden])');
const foto = n => page.screenshot({ path: join(SALIDA, n) });
const esperar = ms => page.waitForTimeout(ms);
const importar = async (...rutas) => {
  const [selector] = await Promise.all([page.waitForEvent('filechooser'), page.click('#inicio-importar')]);
  await selector.setFiles(rutas);
  await page.waitForFunction(n => document.querySelectorAll('#doc-paginas .miniatura img').length === n, rutas.length, { timeout: 60000 });
};
const nuevaCarpeta = async nombre => {
  await page.click('.carpeta-nueva');
  await page.fill('dialog .campo', nombre);
  await page.click('dialog .boton-primario');
  await esperar(300);
};
const alInicio = async () => { await page.click('#doc-atras'); await page.waitForSelector('#vista-inicio:not([hidden])'); };

await nuevaCarpeta('Biología');
await importar(hojas.celula);
await alInicio();
await nuevaCarpeta('Cálculo');
await importar(hojas.derivadas, hojas.limites);
await alInicio();
await page.click('.carpeta-chip:has-text("Todos")');
await importar(hojas.historia);
await page.click('#doc-renombrar');
await page.fill('dialog .campo', 'Historia – resumen');
await page.click('dialog .boton-primario');
await alInicio();
await esperar(500);
await foto('2-documentos.png');

// Un documento de dos páginas
await page.click('.doc:has-text("Cálculo")');
await page.waitForSelector('#vista-documento:not([hidden])');
await esperar(600);
await foto('3-documento.png');

// El texto de la página, leído en el teléfono
await page.click('#doc-paginas li:nth-child(1) .miniatura');
await page.waitForSelector('#vista-pagina:not([hidden])');
await page.click('#pagina-texto');
await page.waitForFunction(() => /derivada/i.test(document.querySelector('.texto-leido')?.value || ''), null, { timeout: 180000 });
await esperar(600);
await foto('4-texto.png');
await page.keyboard.press('Escape');

// Crear el PDF
await page.click('#pagina-atras');
await page.waitForSelector('#vista-documento:not([hidden])');
await page.click('#doc-pdf');
await esperar(600);
await foto('5-pdf.png');
await page.keyboard.press('Escape');

// El respaldo en la nube
await page.goto(srv.url);
await page.waitForSelector('#vista-inicio:not([hidden])');
await page.click('#inicio-menu');
await page.click('.menu-opcion:has-text("Respaldo en la nube")');
await esperar(600);
await foto('6-nube.png');
await ctx.close();

// La cámara con la hoja marcada en vivo (un video falso hecho con una de las fotos)
const cam = await nav.newPage({ viewport: { width: 720, height: 960 } });
const img = await cam.evaluate(async fuente => {
  const i = new Image();
  i.src = fuente;
  await i.decode();
  const c = document.createElement('canvas'); c.width = 720; c.height = 960;
  c.getContext('2d').drawImage(i, 0, 0, 720, 960);
  return Array.from(c.getContext('2d').getImageData(0, 0, 720, 960).data);
}, 'data:image/png;base64,' + readFileSync(hojas.celula).toString('base64'));
await cam.close();
const video = join(carpeta, 'tienda-camara.y4m');
escribirY4M(video, [{ data: Uint8ClampedArray.from(img), width: 720, height: 960 }]);
const navCam = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] });
const ctxCam = await navCam.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, colorScheme: 'light' });
await ctxCam.grantPermissions(['camera'], { origin: srv.url.replace(/\/$/, '') });
const pc = await ctxCam.newPage();
await pc.goto(srv.url);
await pc.waitForSelector('#vista-inicio:not([hidden])');
await pc.click('#inicio-escanear');
await pc.waitForSelector('#camara-disparar:not([disabled])', { timeout: 30000 });
await pc.waitForTimeout(2500);
await pc.screenshot({ path: join(SALIDA, '1-camara.png') });
await navCam.close();

// El gráfico destacado (1024 × 500)
const icono = readFileSync(join(AQUI, 'icono-512.png')).toString('base64');
const captura = readFileSync(join(SALIDA, '3-documento.png')).toString('base64');
const g = await nav.newPage({ viewport: { width: 1024, height: 500 } });
await g.setContent(`<body style="margin:0;width:1024px;height:500px;overflow:hidden;background:linear-gradient(135deg,#0f766e,#0b3f3a);font-family:system-ui,Roboto,sans-serif;color:#fff;display:flex;align-items:center">
  <div style="padding:0 0 0 64px;flex:1">
    <div style="display:flex;align-items:center;gap:18px"><img src="data:image/png;base64,${icono}" style="width:84px;height:84px;border-radius:20px"><span style="font-size:58px;font-weight:800;letter-spacing:-1px">ScanLibre</span></div>
    <p style="font-size:30px;line-height:1.3;margin:26px 0 0;font-weight:600">Escáner gratis para estudiantes</p>
    <p style="font-size:22px;line-height:1.45;margin:12px 0 0;opacity:.85">Sin marca de agua · sin anuncios · sin cuenta<br>Texto, PDF, Word y respaldo cifrado</p>
  </div>
  <div style="width:330px;height:500px;position:relative;margin-right:40px">
    <img src="data:image/png;base64,${captura}" style="position:absolute;top:44px;left:30px;width:270px;border-radius:26px;border:8px solid #111;box-shadow:0 30px 60px rgba(0,0,0,.45)">
  </div></body>`);
await g.screenshot({ path: join(AQUI, 'grafico-destacado.png') });
await nav.close();
await srv.cerrar();
console.log('Listo: capturas en', SALIDA);
process.exit(0);
