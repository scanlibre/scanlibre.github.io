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
- **Bloqueo opcional con PIN o huella** (Menú → Bloqueo con PIN), para quien usa el teléfono desbloqueado. Del PIN solo se guarda una huella PBKDF2-SHA-256 con sal; después de 5 intentos fallidos hay que esperar, cada vez más. La huella usa WebAuthn: el teléfono verifica a la persona. Se sugiere al guardar una cédula. Ver `js/bloqueo.js`.
- **Política de contenido estricta** (CSP): solo corre el código de este mismo sitio; nada de scripts de otros lados ni `eval`. La página no se deja meter dentro de otra (clickjacking).
- **Archivos que llegan de afuera** (PDF, respaldos .zip, fotos, códigos QR): pdf.js sin `eval`, un .zip no puede inflarse sin límite, un enlace de QR muestra a qué sitio lleva antes de abrirse y nunca se abre un `javascript:`.
- **Publicación**: las acciones de GitHub están fijadas por commit y los workflows solo tienen permiso de lectura. La llave de firma de Android vive en los secretos de GitHub, nunca en el repositorio.

## Librerías incluidas

Van dentro de `vendor/` para que la app funcione sin internet. Dependabot no las ve (no están en `package.json`), así que:

- Sus versiones están en [`vendor/versiones.json`](vendor/versiones.json). Una prueba revisa que coincidan con los archivos.
- El workflow **Librerías de vendor** pregunta a npm, el día 1 de cada mes, si hay versión nueva o aviso de seguridad. Si hay algo, abre un issue. Un aviso de seguridad además deja la corrida en rojo.
- Para actualizar una, se sigue el `LEEME.md` de su carpeta y después se cambia `vendor/versiones.json`.

| Librería | Versión | Para qué | Licencia |
|---|---|---|---|
| [Tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 (núcleo tesseract.js-core 7.0.0) | Leer el texto (OCR) | Apache 2.0 |
| [pdf.js](https://github.com/mozilla/pdf.js) | 6.3.289 | Importar PDF | Apache 2.0 |
| [jsQR](https://github.com/cozmo/jsQR) | 1.4.0 | Leer códigos QR | Apache 2.0 |

Última revisión manual: 28 de septiembre de 2026. Las cuatro estaban en su última versión y npm no tenía avisos de seguridad para ninguna.

## Si pasa un incidente

Una falla que se está aprovechando, una cuenta comprometida o código ajeno publicado en el sitio:

1. **Contener (en menos de 24 horas).** Si es código publicado, revertir el commit en `main`: el sitio y la app de Android se actualizan solos. Si es una cuenta, cambiar la contraseña, cerrar las sesiones abiertas y revisar el segundo factor y quién es miembro. Si es la llave de Android, pedir a Google Play una llave de subida nueva.
2. **Evaluar.** Qué pasó, desde cuándo y a quién afecta. ScanLibre no tiene servidor, así que los documentos no se filtran de nuestro lado. Lo que hay que revisar es si el código publicado pudo leerlos en los teléfonos, y durante cuánto tiempo estuvo publicado.
3. **Corregir.** Publicar la versión arreglada con una prueba que evite que vuelva a pasar.
4. **Avisar.** A quien reportó, en las notas de la versión y en el README. Si hubo código malicioso publicado, avisar también dentro de la app.
5. **Aprender.** Anotar qué pasó y por qué en el registro de riesgos, y revisar el control que falló.

## Política de seguridad

**Principios**

- **Todo en el teléfono.** La app no tiene servidor ni sube datos. Una función que necesite sacar datos del teléfono se decide antes, como un riesgo, y se actualiza la política de privacidad.
- **Cambios con pruebas.** Nada llega a `main`, que es lo que se publica, sin que pasen las pruebas. Ver las reglas de `main` más abajo.
- **Mínimo privilegio.** Los workflows tienen solo los permisos que necesitan, y las acciones van fijadas por commit.
- **Secretos fuera del repositorio.** La llave de Android vive en los secretos de GitHub y en un gestor de contraseñas.
- **Cuentas con segundo factor.** La organización de GitHub y la Google Play Console.

**Roles.** En un proyecto de una persona, los dos roles son la misma persona.

| Rol | Qué hace |
|---|---|
| Dueño del proyecto (dueño del riesgo) | Decide qué riesgos se aceptan, administra las cuentas (GitHub y Google Play) y dirige la respuesta a un incidente. Es quien administra la organización `scanlibre` en GitHub. |
| Responsable técnico | Revisa y publica los cambios, y mantiene las pruebas y las librerías. Es quien tiene permiso de escritura en el repositorio. |

**Calendario**

| Cuándo | Qué se revisa |
|---|---|
| En cada cambio | Las pruebas automáticas, incluidas las de seguridad (`tests/seguridad.test.js`, `tests/bloqueo.test.js`) |
| Cada mes | Las librerías de `vendor/` (automático) y las actualizaciones que propone Dependabot |
| Cada 3 meses | El registro de riesgos, quién tiene acceso a las cuentas y con qué segundo factor, y dónde está la llave de Android |
| Cada año | Los requisitos externos (tabla de abajo) y una evaluación de seguridad completa |

## Reglas de la rama `main`

[`.github/reglas/main.json`](.github/reglas/main.json) deja `main` protegida: los cambios entran solo por pull request, con **Pruebas** en verde, y la rama no se puede borrar ni reescribir. Así nada se publica sin pasar las pruebas. Para activarlas, quien administra el repositorio:

1. Baja el archivo `.github/reglas/main.json`.
2. En GitHub: **Settings → Rules → Rulesets → New ruleset → Import a ruleset** y elige el archivo.
3. Revisa que diga **Active** y guarda con **Create**.

Desde entonces, cada cambio se hace en una rama y entra con un pull request cuando **Pruebas** pasa. Dependabot ya trabaja así.

## Requisitos externos

| Requisito | Qué pide | Cómo se cumple | Revisado |
|---|---|---|---|
| Google Play: política de privacidad | Una página pública, enlazada desde la app y desde la ficha | [privacidad.html](https://scanlibre.github.io/privacidad.html) | 28/09/2026 |
| Google Play: seguridad de los datos | Declarar qué datos se recopilan y se comparten | Ninguno: ver `android/LEEME.md` | 28/09/2026 |
| Google Play: público y contenido | Público objetivo y cuestionario de clasificación | 16 años o más, sin contenido de usuarios compartido (`android/LEEME.md`) | 28/09/2026 |
| Google Play: cuentas personales nuevas | Una prueba cerrada antes de publicar para todos | `android/LEEME.md` (paso 7) | 28/09/2026 |
| Licencias de las librerías | Apache 2.0: incluir la licencia al redistribuirlas | `LICENSE` en cada carpeta de `vendor/` | 28/09/2026 |
| Honduras: datos personales | No se identificó una ley general de protección de datos vigente; la Constitución reconoce el hábeas data | La app no recopila datos personales. Conviene revisar cada año si se aprueba una ley | 28/09/2026 |

La evaluación completa de seguridad (bajo COBIT 2019) se hizo el 28 de septiembre de 2026 y se actualizó con las versiones 32 y 33.
