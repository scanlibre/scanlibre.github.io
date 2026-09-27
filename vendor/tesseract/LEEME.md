# Tesseract.js dentro de ScanLibre

El lector de texto (OCR) va dentro de la app para que funcione sin internet y
para que las fotos nunca salgan del teléfono. No se usa ninguna CDN.

| Archivo | De dónde sale |
|---|---|
| `tesseract.min.js`, `worker.min.js` | [tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 (`dist/`) |
| `core/tesseract-core-*-lstm.wasm.js` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core) 7.0.0. Tesseract.js elige uno según lo que permita el teléfono (relaxed SIMD, SIMD o ninguno) |
| `idiomas/spa.traineddata.gz`, `idiomas/eng.traineddata.gz` | Modelos `4.0.0_best_int` de [@tesseract.js-data](https://github.com/naptha/tessdata) (entrenados por el proyecto [Tesseract](https://github.com/tesseract-ocr/tessdata)) |

Licencia: Apache 2.0 (ver `LICENSE`). A los `.min.js` se les quitó solo la
línea del mapa de fuente (`sourceMappingURL`), que no se publica.

Cada teléfono descarga solo lo que usa: el lector (unos 110 KB), uno de los
núcleos (unos 3,9 MB) y el idioma elegido (español 2,1 MB, inglés 3 MB). El
service worker lo guarda la primera vez para usarlo sin conexión.

Para actualizar: `npm install tesseract.js@X tesseract.js-core@X @tesseract.js-data/spa @tesseract.js-data/eng`
en una carpeta aparte y copiar los mismos archivos.
