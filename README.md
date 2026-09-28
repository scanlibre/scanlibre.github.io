# ScanLibre

**Escáner de documentos gratis para estudiantes.** Sin marca de agua, sin anuncios y sin cuenta. Todo se procesa en el teléfono: las fotos nunca salen de él.

Es una app web instalable (PWA): funciona en Android, iPhone y en la computadora, y sin internet después de abrirla una vez. Se publica en GitHub Pages y, más adelante, en Google Play como TWA (igual que Mi Pisto HN).

## Qué hace

- **Cámara con la hoja marcada en vivo.** Encuentra la hoja sola, también con sombras, sobre mesas de color o con poco contraste.
- **Foto sin movimiento:** la foto se toma cuando el teléfono está quieto (giroscopio y video). Al tocar el botón espera a que la mano se asiente, y avisa «Tomando la foto… no te muevas» hasta que la foto llega.
- **Captura automática** cuando la hoja se queda quieta y la imagen está nítida (si sale borrosa, la repite sola), y **ráfaga** para escanear un cuaderno entero pasando las páginas, sin tocar la pantalla. Nunca se queda trabada: si la mano tiembla, después de unos segundos toma la foto en el momento más quieto.
- **Toca para enfocar** en la parte de la hoja que quieras (si el teléfono lo permite).
- **Aviso de foto borrosa:** ningún filtro arregla una foto movida o desenfocada, así que la app lo dice al momento y ofrece **Repetir foto**. Las páginas borrosas se marcan en el documento y se pueden **volver a tomar** sin perder su lugar.
- **Enderezado real:** corrige la perspectiva y calcula la proporción verdadera de la hoja aunque la foto se haya tomado en ángulo.
- **Modo de la cámara** (botón "Modo"): Hoja, Libro abierto, Pizarra o Cédula.
- **Modo cédula:** el frente y el reverso de la cédula, un carné o una tarjeta en una sola hoja carta o A4, **a tamaño real** (85,6 × 54 mm), como la fotocopia que piden en los trámites. Al imprimir el PDF al 100 %, mide lo mismo que la de verdad. Si solo tomas el frente, queda solo el frente.
- **Modo pizarra:** pizarra blanca de marcador o verde/negra de tiza, siempre con fondo blanco y el escrito oscuro y nítido para leerla e imprimirla. En la blanca se van la sombra, el gris y el brillo de las lámparas; en la de tiza, la tiza pasa a trazo oscuro y la de color queda de su color. También es un filtro más en cada página.
- **Modo libro:** una foto del libro abierto se vuelve dos páginas: la app busca el lomo (la franja sin letras y la sombra del doblez) y parte la hoja siguiendo la perspectiva. También con "Separar" en una página ya tomada.
- **Quitar dedos:** los dedos que sostienen la hoja en los bordes se tapan con el color del papel (de piel clara a morena, también en sombra). Una hoja amarillenta o un dibujo en medio de la página no se tocan, y en cada página se puede deshacer.
- **Páginas curvas de libros:** si la hoja no queda plana (cerca del lomo o con una esquina levantada), sigue los renglones de texto y los endereza. En una hoja plana no toca nada, y en cada página se puede deshacer.
- **Esquinas a mano** con lupa; se ven sobre papel blanco y sobre fondos oscuros.
- **Brillo y contraste a mano** en cada página, viendo cómo queda mientras se mueven las barras. El brillo aclara u oscurece los tonos medios sin ensuciar el papel blanco (sirve para el lápiz suave); en B/N cambia el grosor de las letras.
- **Marcar la página:** resaltador de 4 colores que se endereza solo y se ajusta al renglón y a las palabras que tocas, lápiz para escribir o subrayar, notas adhesivas y **firma** (se dibuja una vez con el dedo y queda guardada). Las marcas se ven en la página, en la miniatura y en el PDF; se pueden deshacer, borrar o mover, y el texto se sigue leyendo sin ellas. Con dos dedos se acerca la página.
- **Lo resaltado, para estudiar:** junta en un solo texto lo que resaltaste en todo el documento, página por página y con el color de cada parte (si la página no se había leído, se lee sola). Se copia, se escucha o se lleva a Word, donde cada parte queda resaltada con su mismo color.
- **Filtros:** Original, Mejorada (papel blanco sin sombras y sin saturar los colores), Dibujo (para lápiz y bocetos: se ven hasta los trazos más suaves), Gris, B/N (umbral local tipo Sauvola: no se come el texto suave ni deja manchas negras con la sombra del lomo de un libro) y Pizarra.
- **Texto (OCR), gratis y sin internet:** copiar o compartir el texto de una página o de todo el documento, en español, inglés o los dos. Y **PDF con texto buscable**: se ve igual, pero se pueden buscar y copiar las palabras. Antes de leer, la página se prepara (papel parejo, más contraste y nitidez): así lee también la letra chica de un libro.
- **El texto a Word (.docx)** para seguir trabajándolo, con los renglones de cada párrafo juntados y las listas aparte.
- **Escuchar el texto** con la voz del teléfono, frase por frase, con pausa. Mientras lee se ve el texto con **la frase resaltada** (y la palabra, en los teléfonos que avisan por dónde van); tocar una frase lee desde ahí, y la velocidad va de 0,8× a 1,5×.
- **Fotos a resolución completa** (hasta 4000 px, 12 MP): la letra chica conserva el detalle.
- **Buscar en todos los documentos:** en los nombres y en el texto de cada página, sin importar tildes ni mayúsculas. Muestra la página y el pedazo donde está la palabra; las páginas que faltan se leen con un toque.
- **Carpetas por clase:** lo que escaneas dentro de una carpeta se guarda ahí y se nombra solo («Cálculo – 27 sept»). Los documentos se pueden mover de carpeta; borrar una carpeta no borra sus documentos.
- **Documentos de varias páginas:** reordenar **arrastrando** las miniaturas (con el dedo: mantener presionada y mover), girar, recortar de nuevo y borrar páginas, todo gratis.
- **Importar un PDF** (desde "Importar" o "Agregar"): cada página queda como una página más, que se puede marcar, firmar, filtrar o juntar con páginas escaneadas. Si el PDF trae texto, se guarda con cada página en su lugar: se puede buscar, copiar y escuchar sin leerlo con el OCR. Si tiene contraseña, la pide.
- **Unir y dividir documentos:** unir otro documento al final de este, dividir desde una página (de ahí en adelante, un documento nuevo) o pasar las páginas elegidas a otro documento.
- **Elegir varias páginas** (mantener presionada una sin moverla): girarlas, cambiarles el filtro, pasarlas a un documento nuevo o a otro que ya existe, hacer el PDF solo de esas o eliminarlas de una vez.
- **Portada automática** del trabajo: universidad, carrera, asignatura, sección, catedrático, tema, integrantes con su número de cuenta, lugar y fecha, centrados como se entrega en la U, en letra clásica o moderna y con logo si quieres. Queda como la página 1 (se puede cambiar, mover o firmar) y su texto se puede buscar. Tus datos y los de cada clase se recuerdan para la próxima.
- **PDF** en tamaño carta, A4 o con la forma de la foto, y en tres calidades. La calidad *Liviana* sirve para subir a plataformas con límite de tamaño, y con **"Que pese menos de…"** (1, 2, 5 o 10 MB) la app busca sola la mejor calidad que quepa.
- **2 o 4 páginas por hoja** para imprimir más barato: las páginas paradas van de lado a lado en una hoja acostada (2) o en 2 × 2 (4), con una raya fina para recortarlas y con el texto buscable de cada una. Las páginas en B/N van a 1 bit por píxel: nítidas y livianas (unos 50 KB por página).
- **Marca de agua** en el PDF o en la imagen de una página: un texto cruzado y repetido («Solo para trámite en el banco · 28/09/2026») para que una copia, como la de tu cédula, solo sirva para lo que tú digas. Va dentro de la imagen: no se puede quitar del PDF.
- **Aviso de páginas repetidas:** en ráfaga es fácil tomar la misma página dos veces. Cada página nueva se compara con las anteriores por el dibujo que forman sus palabras (dos páginas del mismo libro no se confunden) y, si repite una, se marca *Repetida* con **Quitar** o **No es repetida**. También se puede buscar en todo el documento.
- **Papelera:** lo que eliminas (documentos o páginas) queda 30 días y se recupera en su mismo lugar; al borrar, el aviso trae **Deshacer**. Después de 30 días se borra solo.
- **PDF con contraseña, gratis:** cifrado AES-256 estándar (el que abren Adobe, Chrome y los visores de Android e iPhone). La contraseña no se guarda en ningún lado.
- **Compartir** directo a WhatsApp, Drive o Classroom, o descargar el PDF.
- **Respaldo gratis:** todos los documentos en un `.zip` para guardar donde quieras y restaurarlos en otro teléfono.
- **Tema claro u oscuro** según el teléfono. Las páginas escaneadas nunca se invierten.

## Cómo funciona por dentro

La detección, los filtros, el PDF y el respaldo están escritos para esta app, sin librerías (unos 380 KB de código). Para leer el texto se usa [Tesseract.js](https://github.com/naptha/tesseract.js), incluido en `vendor/tesseract/`, y para importar PDF, [pdf.js](https://github.com/mozilla/pdf.js) de Mozilla, en `vendor/pdfjs/` (los dos con licencia Apache 2.0): no dependen de ninguna CDN, se bajan la primera vez que se usan y después funcionan sin conexión.

| Parte | Archivo | Qué hace |
|---|---|---|
| Detección | `js/imagen/deteccion.js` | Bordes (Canny) sobre brillo y saturación; los candidatos salen de grupos de bordes, zonas claras u oscuras (Otsu) y rectas largas (Hough, con el sentido del contraste). Cada lado se afina ajustando una recta y se califica por borde real y por contraste entre adentro y afuera. |
| Dedos | `js/imagen/dedos.js` | Manchas con color de piel pegadas a un borde y con forma de dedo, más su sombra maciza; se tapan con el color del papel de alrededor. |
| Marcas | `js/marcas.js` | Resaltador, lápiz, notas y firma en fracciones de la página: se dibujan a cualquier tamaño (el resaltador "multiplica", así las letras de abajo siguen negras). El trazo casi derecho se endereza por mínimos cuadrados y se ajusta al renglón buscando las filas con tinta y las palabras bajo él. Al girar la página, giran con ella. |
| Cédula | `js/cedula.js` | Cada cara se endereza y se lleva a la medida ID-1 de las tarjetas (85,6 × 54 mm); las dos van centradas en una hoja carta o A4 a 300 ppp, con una raya fina para recortarlas. |
| Repetidas | `js/imagen/repetidas.js` | Huella de 72 × 96 en gris sin lo que es parejo a lo largo del renglón (queda el dibujo de las palabras), sin el borde y con lo muy fuerte recortado; correlación corriendo ±3 píxeles. En 18 páginas reales: la misma página da 0,67 a 0,96 y páginas distintas, hasta 0,26. |
| Libro | `js/imagen/libro.js` | Busca el lomo en el libro abierto enderezado y parte sus esquinas en dos hojas con la homografía. |
| Páginas curvas | `js/imagen/aplanar.js` | Busca los renglones en franjas verticales, les ajusta una curva y corre cada columna para dejarlos rectos. |
| Proporción | `js/imagen/geometria.js` | Homografía y proporción real de la hoja (método de Zhang y He). |
| Enderezado | `js/imagen/perspectiva.js` | Transformación de perspectiva con interpolación bilineal. |
| Filtros | `js/imagen/filtros.js` | Estima el brillo del papel por zonas y divide por él (quita sombras sin blanquear los recuadros de color), balance de blancos, y umbral de Sauvola para B/N. Brillo (curva gamma: no mueve el blanco ni el negro) y contraste alrededor del gris medio. |
| Quietud | `js/imagen/movimiento.js` | Compara cada cuadro del video con el anterior (sin contar los cambios de exposición) y, si hay, lee el giroscopio. |
| Nitidez | `js/imagen/nitidez.js` | Mide qué tan filosos son los bordes de las letras (gradiente entre contraste local, en el centro de cada borde). No depende de la luz ni del tamaño de la foto. |
| Worker | `js/imagen/worker.js` | Las cuentas pesadas corren aparte para que la app no se trabe. |
| PDF | `js/pdf.js` | Escritor de PDF propio: JPEG tal cual (DCTDecode) y B/N a 1 bit (FlateDecode). Con OCR, cada palabra va invisible (modo 3) en su lugar, en Courier estirada al ancho de la palabra. |
| Lectura | `js/imagen/lectura.js` | Prepara la página para el OCR: papel parejo, contraste como el filtro Gris y máscara de enfoque. |
| OCR | `js/ocr.js` | Tesseract.js 7 (modelos `best_int` de español e inglés). Se carga la primera vez que se usa (unos 6 MB en español) y el service worker lo guarda para usarlo sin conexión. |
| Contraseña | `js/cifrado.js` | Cifrado estándar de PDF, revisión 6 (AES-256) con WebCrypto: el "algoritmo 2.B" para la clave y AES-CBC para cada imagen, página y texto. |
| Respaldo | `js/respaldo.js` | ZIP propio para el respaldo. |
| Guardado | `js/db.js` | IndexedDB, solo en el teléfono. |

Probada con 12 fotos reales de documentos (cartas, formularios, cuadernos con renglones, apuntes a mano, recibos): encontró la hoja en las 12.

## Probar en la computadora

```bash
npx serve .          # o: python3 -m http.server 8080
# abre http://localhost:3000 (la cámara funciona en localhost o con https)
```

Pruebas automáticas (lógica en Node y la app completa en Chromium, con una cámara simulada):

```bash
npm install
npx playwright install chromium
npm test
```

## Estructura

```
index.html          pantallas y los íconos (sprite SVG)
css/app.css         estilos (claro y oscuro)
js/app.js           arranque
js/rutas.js         navegación con #hash (el botón atrás del teléfono funciona)
js/vistas/          inicio, cámara, recorte, documento y página
js/imagen/          detección, geometría, enderezado, filtros y nitidez (sin DOM)
js/paginas.js       de la foto a la página guardada, con cola para las ráfagas
js/exportar.js      PDF y compartir
js/respaldo.js      respaldo .zip
js/ocr.js           lector de texto (Tesseract.js)
vendor/tesseract/   Tesseract.js, sus núcleos y los idiomas (ver LEEME.md)
sw.js               modo sin conexión (subir VERSION al publicar cambios)
tests/              pruebas (node:test + Playwright)
```

## Hoja de ruta

Lo que sigue sale de lo que la gente les pide y les reclama a CamScanner, Genius Scan y compañía.

**Fase 2** (en curso)
- ✅ OCR con Tesseract.js 7 (español e inglés): copiar el texto y PDF con texto buscable.
- ✅ Aviso de foto borrosa, volver a tomar una página y tocar para enfocar.
- ✅ Carpetas por clase y nombre automático («Cálculo – 27 sept»).
- ✅ PDF con contraseña, gratis (AES-256).
- ✅ Brillo y contraste a mano.
- ✅ Buscar texto dentro de todos los documentos.

**Fase 3**
- ✅ Corrección de páginas curvas (libros).
- ✅ Modo libro (las dos páginas de una foto).
- ✅ Modo pizarra.
- ✅ Modo cédula (las dos caras en una hoja, a tamaño real).
- Respaldo cifrado opcional en la nube (Supabase, como las fotos de Mi Pisto HN).
- Publicación en Google Play (TWA con PWABuilder).

**Nunca:** anuncios, marca de agua, cuentas obligatorias ni funciones gratis que después se cobran.

## Privacidad

ScanLibre no tiene servidor. Las fotos, los documentos y los PDF se quedan en el navegador del teléfono. No hay cuentas, analítica ni rastreo.
