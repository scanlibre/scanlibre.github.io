# ScanLibre en Google Play

La app de Android es una **Trusted Web Activity** (TWA): abre `https://scanlibre.github.io` a pantalla completa con el motor de Chrome, sin barra de direcciones. No hay que mantener dos apps: cada vez que se publica la web, la app de Android ya la tiene. Solo hay que volver a subir el `.aab` si cambia algo de esta carpeta (el nombre, el ícono o la versión).

El proyecto se generó con [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) (de Google), a partir de `manifest.json`. La configuración está en `twa-manifest.json`.

| Dato | Valor |
|---|---|
| Nombre del paquete | `io.github.scanlibre` (no se puede cambiar después de publicar) |
| Versión | `1.0.0` (código 1) |
| Firma | llave de subida `scanlibre`, RSA 4096 |
| Huella SHA-256 de la llave de subida | `8F:42:5E:4B:80:5A:DD:0F:F7:F6:0B:51:55:5B:D5:07:99:BB:B7:00:15:47:71:E0:4A:A7:68:9A:13:99:33:B5` |

## 1. Armar la app (GitHub Actions)

La llave de firma **nunca** va al repositorio. GitHub la usa desde dos secretos:

1. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**.
2. `ANDROID_LLAVE`: el contenido de `ANDROID_LLAVE.txt` (la llave `.jks` en base64).
3. `ANDROID_LLAVE_CLAVE`: el contenido de `ANDROID_LLAVE_CLAVE.txt` (su contraseña).
4. En **Actions → Android → Run workflow**. Al terminar, en el resumen de la corrida queda **ScanLibre-android** para bajar, con:
   - `app-release.aab`: el que se sube a Google Play.
   - `app-release.apk`: para instalarlo a mano en un teléfono y probarlo antes.

Guarda el archivo `scanlibre-llave-subida.jks` y su contraseña en un lugar seguro (por ejemplo, un gestor de contraseñas). Si se pierde, Google Play permite pedir una llave de subida nueva, pero es un trámite.

## 2. Publicar

1. Crear la cuenta de desarrollador en [play.google.com/console](https://play.google.com/console): se paga una sola vez (US$ 25) y Google pide verificar la identidad. Usa un correo tuyo, no el del trabajo: queda como contacto público de la app.
2. **Crear app**: nombre «ScanLibre: escáner gratis», idioma español, app, gratis.
3. **Ficha de Play Store**: los textos están en [`tienda/ficha.md`](tienda/ficha.md) y las imágenes en `tienda/`:
   - Ícono: `tienda/icono-512.png`
   - Gráfico destacado: `tienda/grafico-destacado.png` (1024 × 500)
   - Capturas del teléfono: `tienda/capturas/` (1080 × 1920)
4. **Política de privacidad**: `https://scanlibre.github.io/privacidad.html`
5. **Seguridad de los datos**: ver abajo.
6. **Clasificación del contenido**: el cuestionario (herramienta, sin violencia, sin contenido de usuarios compartido con otros). **Público objetivo**: 16 años o más (así no aplican las reglas de apps para niños).
7. Subir `app-release.aab` a una prueba.
   - Las cuentas personales nuevas deben hacer primero una **prueba cerrada con al menos 12 personas durante 14 días** antes de poder publicar para todos. Eso dice Google en la Play Console al crear la cuenta; revisa ahí el número vigente. Sirven compañeros de la U: se les manda el enlace de la prueba.
8. Después de la prueba, **Producción → Crear versión** con el mismo `.aab` (o uno nuevo con la versión subida).

## 3. Después de la primera subida: la huella de Google

Google Play vuelve a firmar la app con su propia llave (*firma de apps de Play*). Para que la app abra a pantalla completa (sin la barra de Chrome arriba), el sitio tiene que decir que confía en esa llave también:

1. En la Play Console: **Probar y publicar → Configuración → Integridad de la app → Firma de apps**.
2. Copiar el **SHA-256** del *certificado de la clave de firma de apps*.
3. Agregarlo a [`/.well-known/assetlinks.json`](../.well-known/assetlinks.json), junto al que ya está (el de la llave de subida, que sirve para el `.apk` instalado a mano).

Se puede revisar con la [herramienta de Google](https://developers.google.com/digital-asset-links/tools/generator): sitio `scanlibre.github.io`, paquete `io.github.scanlibre` y la huella.

## Seguridad de los datos (respuestas sugeridas)

La app de Android no pide permisos propios: la cámara la pide Chrome, como en la web. Quien responde el formulario es quien publica. Esto es lo que hace la app:

- **¿Recopila o comparte datos?** Solo si la persona activa el **respaldo en la nube**. En ese caso se suben sus documentos **cifrados de extremo a extremo** (nadie más que ella puede leerlos). Para ir a lo seguro, declarar:
  - *Fotos y videos → Fotos* y *Archivos y documentos*: **recopilados**, opcional (el usuario decide), para **funcionalidad de la app** (respaldo), no se comparten con terceros.
- **¿Se cifran en tránsito?** Sí (HTTPS, y además van cifrados desde el teléfono).
- **¿Se pueden borrar?** Sí, desde la app: *Menú → Respaldo en la nube → Más opciones → Borrar mi respaldo de la nube*.
- Sin anuncios, sin analítica, sin cuenta, sin ubicación, sin contactos.
- Traducir con Google Traductor: se abre en el navegador solo si la persona lo elige y la app avisa antes. Es un enlace a otra app, no algo que ScanLibre recopile.

## Cambiar algo de la app de Android

1. Editar `twa-manifest.json` (y subir `appVersionCode` y `appVersionName`).
2. Regenerar con Bubblewrap (`npx @bubblewrap/cli update`) o editar a mano `app/build.gradle`.
3. Correr el workflow **Android** otra vez y subir el `.aab` nuevo a la Play Console.
