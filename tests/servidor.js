// Servidor estático mínimo para abrir la app en las pruebas
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.pdf': 'application/pdf'
};

export function servir() {
  return new Promise(resolver => {
    const servidor = createServer(async (req, res) => {
      const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const archivo = normalize(join(RAIZ, ruta.endsWith('/') ? ruta + 'index.html' : ruta));
      if (!archivo.startsWith(RAIZ)) { res.writeHead(403).end(); return; }
      try {
        const datos = await readFile(archivo);
        res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(datos);
      } catch (e) {
        res.writeHead(404).end('No encontrado');
      }
    });
    servidor.listen(0, '127.0.0.1', () => resolver({ url: `http://127.0.0.1:${servidor.address().port}/`, cerrar: () => new Promise(r => servidor.close(r)) }));
  });
}
