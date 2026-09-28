# pdf.js dentro de ScanLibre

Para importar un PDF (cada página queda como una página más, con su texto si
lo trae) se usa [pdf.js](https://github.com/mozilla/pdf.js) de Mozilla. Va
dentro de la app para que funcione sin internet y para que los archivos nunca
salgan del teléfono. No se usa ninguna CDN.

| Archivo | De dónde sale |
|---|---|
| `pdf.min.mjs`, `pdf.worker.min.mjs` | `pdfjs-dist` 6.3.289, versión `legacy/build/` (anda también en teléfonos con navegadores de hace unos años) |
| `standard_fonts/` | Las letras estándar de PDF que muchos archivos no traen adentro (Foxit y Liberation, con sus licencias) |
| `wasm/openjpeg.wasm`, `wasm/jbig2.wasm`, `wasm/qcms_bg.wasm` | Para imágenes JPEG 2000 y JBIG2 (comunes en PDF escaneados) y perfiles de color |
| `iccs/` | Perfil de color para PDF en CMYK |

Licencia: Apache 2.0 (ver `LICENSE`; las de las letras y los wasm van junto a
ellos). A los `.min.mjs` se les quitó solo la línea del mapa de fuente, que no
se publica. No se incluyen los `cmaps` (letras chinas, japonesas y coreanas).

Se baja la primera vez que se importa un PDF (unos 2 MB) y el service worker
lo guarda para usarlo sin conexión.

Para actualizar: `npm pack pdfjs-dist@X` en una carpeta aparte y copiar los
mismos archivos.
