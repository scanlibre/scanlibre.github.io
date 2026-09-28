# Seguridad de ScanLibre

## Reportar una falla

Si encuentras una falla de seguridad, **no la publiques en un issue**. Repórtala en privado:

1. En este repositorio: pestaña **Security → Report a vulnerability** (aviso privado de GitHub).
2. Si esa opción no aparece, abre un issue que diga solo «Tengo un reporte de seguridad» (sin detalles) y te contactamos.

Cuenta qué pasa, cómo repetirlo y qué podría hacer alguien con eso. Respondemos en un máximo de 7 días y avisamos cuando esté corregido. Agradecemos el reporte en las notas del cambio, si quieres.

Solo se corrige la versión publicada en <https://scanlibre.github.io> (la app de Android abre esa misma versión).

## Qué cubre

| Parte | Dónde |
|---|---|
| La app web (PWA) | `index.html`, `js/`, `css/`, `sw.js` |
| La app de Android (TWA) | `android/`, `.well-known/assetlinks.json` |
| La publicación | `.github/workflows/` |

Fuera de alcance: fallas de Chrome, Android o GitHub (repórtalas a ellos), y ataques que necesitan el teléfono desbloqueado en la mano.

## Cómo está protegida

- **Todo se queda en el teléfono.** ScanLibre no tiene servidor ni base de datos: no hay nada que robar de nuestro lado. La política de contenido solo deja conectarse al propio sitio (`connect-src 'self'`), así que la app no puede conectarse a ningún otro servidor. No hay cuentas, ni analítica, ni rastreo.
- **Política de contenido estricta** (CSP): solo corre el código de este mismo sitio; nada de scripts de otros lados ni `eval`. La página no se deja meter dentro de otra (clickjacking).
- **Archivos que llegan de afuera** (PDF, respaldos .zip, fotos, códigos QR): pdf.js sin `eval`, un .zip no puede inflarse sin límite, un enlace de QR muestra a qué sitio lleva antes de abrirse y nunca se abre un `javascript:`.
- **Publicación**: las acciones de GitHub están fijadas por commit y los workflows solo tienen permiso de lectura. La llave de firma de Android vive en los secretos de GitHub, nunca en el repositorio.

## Librerías incluidas

Van dentro de `vendor/` para que la app funcione sin internet. Dependabot no las ve: se revisan a mano cada 3 meses (novedades y avisos de seguridad de cada proyecto).

| Librería | Versión | Para qué |
|---|---|---|
| [Tesseract.js](https://github.com/naptha/tesseract.js) | 7 | Leer el texto (OCR) |
| [pdf.js](https://github.com/mozilla/pdf.js) | 6.3.289 | Importar PDF |
| [jsQR](https://github.com/cozmo/jsQR) | 1.4.0 | Leer códigos QR |

La evaluación completa de seguridad (bajo COBIT 2019) se hizo el 28 de septiembre de 2026.
