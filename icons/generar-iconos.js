// Genera los PNG de los íconos a partir de los SVG (se corre a mano: node icons/generar-iconos.js)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const salidas = [
  ['icono.svg', 'icono-192.png', 192],
  ['icono.svg', 'icono-512.png', 512],
  ['icono-maskable.svg', 'icono-maskable-512.png', 512],
  ['icono-maskable.svg', 'apple-touch-icon.png', 180]
];
const navegador = await chromium.launch();
const pagina = await navegador.newPage();
for (const [svg, png, lado] of salidas) {
  await pagina.setViewportSize({ width: lado, height: lado });
  const contenido = readFileSync(dir + svg, 'utf8').replace('<svg ', `<svg width="${lado}" height="${lado}" `);
  await pagina.setContent(`<html><body style="margin:0;background:transparent">${contenido}</body></html>`);
  await pagina.screenshot({ path: dir + png, omitBackground: true, clip: { x: 0, y: 0, width: lado, height: lado } });
  console.log('✓', png);
}
await navegador.close();
