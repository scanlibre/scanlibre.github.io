# jsQR dentro de ScanLibre

Para leer códigos QR en los teléfonos que no traen su propio lector
(`BarcodeDetector`, que Chrome tiene en Android) se usa
[jsQR](https://github.com/cozmo/jsQR) 1.4.0, licencia Apache 2.0 (ver `LICENSE`).

`jsQR.min.js` es `dist/jsQR.js` del paquete de npm, achicado con terser. Va
dentro de la app: funciona sin internet y las imágenes no salen del teléfono.
