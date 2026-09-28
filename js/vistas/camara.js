// ScanLibre · vistas/camara.js
// Cámara con la hoja marcada en vivo. Modos:
//  · normal: después de cada foto se revisan las esquinas;
//  · ráfaga: foto tras foto sin parar (las esquinas se ponen solas);
//  · auto: la foto se toma sola cuando la hoja se queda quieta. Con ráfaga
//    sirve para escanear un cuaderno entero pasando las páginas.
// La foto se toma con el teléfono quieto (giroscopio y video): así no sale movida.

import { $, aviso, menu } from '../util.js';
import { ir, volver } from '../rutas.js';
import { ajustes, cambiarAjuste, modoCamara } from '../ajustes.js';
import { detectar, nitidez } from '../motor.js';
import { aCanvas, aImageData, canvasABlob, soltarCanvas, abrirFoto } from '../fotos.js';
import { gamaBaja, ladoFoto, pausaDeteccion, videoIdeal } from '../rendimiento.js';
import { caraDeCedula } from '../cedula.js';
import { leerCodigos } from '../codigos.js';
import { mostrarCodigo } from './codigo.js';
import { crearPagina, crearPaginasDeLibro, crearPaginaDeCedula, encolar, agregarPaginaRevisada, eventosPaginas, importarArchivos, nuevoDocumento, pendientesEnCola, esBorrosa, prepararFoto, soltarVista } from '../paginas.js';
import { agregarPagina, reemplazarPagina } from '../db.js';
import { elegirArchivos } from '../archivos.js';
import { abrirRecorte } from './recorte.js';
import { configurarBloqueo } from './bloqueo.js';
import { bloqueo } from '../bloqueo.js';
import { miniGris, diferenciaMedia, MOV_QUIETO } from '../imagen/movimiento.js';

const vista = $('#vista-camara');
const video = $('#camara-video');
const marco = $('#camara-marco');
const pista = $('#camara-pista');

let sesion = null;      // { docId, origen: 'inicio' | 'doc', cantidad, ultima (url) }
let flujo = null, capturador = null, fotoCompletaFalla = false, motivoFalla = '', pedidoFoto = null;
let enfoques = [], midiendo = false, intentosEnfoque = 0;
let activa = false, capturando = false, detectando = false, ultimaDeteccion = 0;
let vivas = null, perdidas = 0, hojaDesde = 0, quietoDesde = 0, reintentos = 0;
// Quietud: giro del teléfono (grados por segundo) y movimiento de la imagen entre cuadros
const GIRO_QUIETO = 5, UMBRAL_VIDEO = 0.22;
let giroPico = 0, giro = 0, hayGiro = false, movImagen = Infinity, miniAnterior = null, tMini = 0;
// Captura automática: después de una foto hay que pasar a otra hoja antes de la siguiente
let lista = true, firmaUltima = null, pausaHasta = 0;

/** Empieza una sesión de fotos nueva (para un documento nuevo o para uno que ya existe) */
/** Datos de la última foto, para "Acerca de ScanLibre" (ayuda a saber qué tan nítida sale en cada teléfono) */
function guardarDiagnostico(datos) {
  try { localStorage.setItem('scanlibre_camara', JSON.stringify({ ...datos, fecha: Date.now() })); } catch (e) {}
}

export function diagnosticoCamara() {
  try { return JSON.parse(localStorage.getItem('scanlibre_camara')); } catch (e) { return null; }
}

/**
 * @param origen 'inicio' | 'doc' | 'pagina' (a dónde volver al terminar)
 * @param reemplazar { id, n } para volver a tomar esa página en su mismo lugar
 */
export function nuevaSesion(docId, origen, reemplazar = null) {
  if (sesion?.ultima) URL.revokeObjectURL(sesion.ultima);
  sesion = { docId, origen, cantidad: 0, ultima: null, reemplazar };
  lista = true; firmaUltima = null; pausaHasta = 0;
}

export async function mostrar(params) {
  if (!sesion) nuevaSesion(params.doc || null, params.doc ? 'doc' : 'inicio');
  activa = true;
  pintarBotones();
  await encender();
}

export function ocultar() {
  activa = false;
  apagar();
}

// ── Cámara ──────────────────────────────────────────────────────────
function motivo(e) {
  if (!window.isSecureContext) return 'La cámara solo funciona si la página se abre con https.';
  if (e?.name === 'NotAllowedError') return 'No hay permiso para usar la cámara. Actívalo en la configuración del navegador, o usa la cámara del teléfono.';
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'No se encontró una cámara en este dispositivo.';
  if (e?.name === 'NotReadableError') return 'Otra app está usando la cámara. Ciérrala e intenta de nuevo.';
  return 'Este navegador no deja usar la cámara aquí.';
}

let intento = 0; // cada encendido o apagado cambia el número: un arranque viejo que termina tarde no hace nada

async function encender() {
  $('#camara-sin-camara').hidden = true;
  if (flujo) return;
  pista.hidden = true; // hasta que haya imagen: no queda el texto de la vez anterior
  if (!navigator.mediaDevices?.getUserMedia) return sinCamara(motivo());
  const este = ++intento;
  const conFotoCompleta = 'ImageCapture' in window;
  let nuevo;
  try {
    // Con la foto completa aparte, el video es solo para mirar: 1080p (720p en
    // gama baja). Si la foto es un cuadro del video (iPhone), se pide 4K.
    const { width, height } = videoIdeal(conFotoCompleta && !fotoCompletaFalla);
    nuevo = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: width }, height: { ideal: height } }
    });
  } catch (e) {
    if (activa && este === intento) sinCamara(motivo(e));
    return;
  }
  // Se salió de la pantalla (o se apagó) mientras pedía permiso
  if (!activa || este !== intento) { nuevo.getTracks().forEach(t => t.stop()); return; }
  flujo = nuevo;
  video.srcObject = nuevo;
  try { await video.play(); } catch (e) {}
  if (flujo !== nuevo) return;
  // El disparador se habilita recién con imagen: una foto antes saldría vacía
  if (!video.videoWidth) await new Promise(r => video.addEventListener('loadeddata', r, { once: true }));
  if (flujo !== nuevo) return;
  $('#camara-disparar').disabled = false;
  ponerPista(modoActual() === 'qr' ? 'Apunta al código QR' : 'Apunta a la hoja', false);
  const pistaVideo = nuevo.getVideoTracks()[0];
  capturador = conFotoCompleta ? new ImageCapture(pistaVideo) : null;
  let capacidades = {};
  try { capacidades = pistaVideo.getCapabilities?.() || {}; } catch (e) {}
  enfoques = capacidades.focusMode || [];
  if (capacidades.focusMode?.includes('continuous')) {
    pistaVideo.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  }
  const linterna = $('#camara-linterna');
  linterna.hidden = !capacidades.torch;
  linterna.setAttribute('aria-pressed', 'false');
  vivas = null; perdidas = 0; hojaDesde = 0; quietoDesde = 0; miniAnterior = null; ultimoCuadro = null;
  window.addEventListener('devicemotion', alGirar);
  requestAnimationFrame(cuadro);
}

function apagar() {
  intento++;
  window.removeEventListener('devicemotion', alGirar);
  $('#camara-disparar').disabled = true;
  if (flujo) flujo.getTracks().forEach(t => t.stop());
  flujo = null; capturador = null; pedidoFoto = null;
  video.srcObject = null;
  vivas = null;
  limpiarMarco();
}

function sinCamara(texto) {
  $('#camara-sin-camara-motivo').textContent = texto;
  $('#camara-sin-camara').hidden = false;
  pista.hidden = true;
}

document.addEventListener('visibilitychange', () => {
  if (!activa) return;
  if (document.hidden) apagar(); else encender();
});

// ── Detección en vivo ───────────────────────────────────────────────
const conLimite = (promesa, ms) => Promise.race([promesa, new Promise((_, no) => setTimeout(() => no(new Error('tiempo')), ms))]);

/**
 * El cuadro actual del video, chico (para buscar la hoja y medir si se mueve).
 * Siempre en el mismo lienzo y sin "willReadFrequently": así el video se
 * achica en la tarjeta de video y solo se leen los píxeles chicos. Leer un
 * cuadro grande con la CPU es lo que más traba a los teléfonos sencillos.
 */
let lienzoVideo = null, ultimoCuadro = null;
function cuadroChico(maxLado = 400) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const k = Math.min(1, maxLado / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * k)), h = Math.max(1, Math.round(vh * k));
  if (!lienzoVideo) lienzoVideo = document.createElement('canvas');
  if (lienzoVideo.width !== w || lienzoVideo.height !== h) { lienzoVideo.width = w; lienzoVideo.height = h; }
  const ctx = lienzoVideo.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  return (ultimoCuadro = ctx.getImageData(0, 0, w, h));
}

function cuadro(t) {
  if (!activa || !flujo) return;
  requestAnimationFrame(cuadro);
  if (modoActual() === 'qr') return buscarCodigo(t);
  dibujarMarco();
  if (detectando || capturando || t - ultimaDeteccion < pausaDeteccion() || video.readyState < 2 || !video.videoWidth) return;
  detectando = true;
  ultimaDeteccion = t;
  const img = cuadroChico();
  medirMovimiento(img);
  // Con límite de tiempo: si una detección se traba, la cámara no se queda "pegada"
  conLimite(detectar(img), 2500)
    .then(r => { if (activa) alDetectar(r, img); })
    .catch(() => {})
    .finally(() => { detectando = false; });
}

// ── Modo QR: se lee el código en vivo, sin tomar foto ───────────────
const modoActual = () => (sesion?.reemplazar ? 'hoja' : modoCamara());
let leyendoCodigo = false, mostrandoCodigo = false, ultimaLectura = 0, ultimoCodigo = { texto: '', cuando: 0 };

function buscarCodigo(t) {
  if (leyendoCodigo || mostrandoCodigo || t - ultimaLectura < 250 || video.readyState < 2 || !video.videoWidth) return;
  leyendoCodigo = true;
  ultimaLectura = t;
  conLimite(leerCodigos(video, { lado: gamaBaja() ? 900 : 1400 }), 2500)
    .then(codigos => {
      const c = codigos[0];
      if (!c || !activa || modoActual() !== 'qr') return;
      // El mismo código recién cerrado no se vuelve a abrir al tiro
      if (c.texto === ultimoCodigo.texto && performance.now() - ultimoCodigo.cuando < 3000) return;
      mostrarLeido(c.texto);
    })
    .catch(() => {})
    .finally(() => { leyendoCodigo = false; });
}

async function mostrarLeido(texto) {
  mostrandoCodigo = true;
  try { navigator.vibrate?.(30); } catch (e) {}
  ponerPista('Código leído', true);
  try { await mostrarCodigo(texto); } finally {
    mostrandoCodigo = false;
    ultimoCodigo = { texto, cuando: performance.now() };
    if (activa) ponerPista('Apunta al código QR', false);
  }
}

/** Modo QR con una foto de la galería (por ejemplo, una captura de pantalla con un QR) */
async function codigosDeGaleria(archivos) {
  for (const archivo of archivos) {
    const bmp = await abrirFoto(archivo);
    let codigos = [];
    try { codigos = await leerCodigos(bmp, { varios: true }); } finally { bmp.close?.(); }
    if (!codigos.length) { aviso('No encontré códigos en esa imagen.'); continue; }
    for (const c of codigos) await mostrarCodigo(c.texto);
  }
}

/** Huella chiquita de la imagen: sirve para notar que ya se pasó a otra página */
function firma({ data, width, height }) {
  const f = new Float32Array(48);
  for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) {
    const i = (y * width + x) * 4;
    f[Math.floor(y * 8 / height) * 6 + Math.floor(x * 6 / width)] += data[i] + data[i + 1] + data[i + 2];
  }
  const total = f.reduce((s, v) => s + v, 0) || 1;
  return f.map(v => v / total);
}
const diferencia = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
const moverMax = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
const pausa = ms => new Promise(r => setTimeout(r, ms));

// ── Quietud ─────────────────────────────────────────────────────────
// Una foto sale movida si el teléfono se mueve mientras se toma (con poca luz
// la cámara tarda más en tomarla). Se mira el giroscopio, si hay, y cuánto
// cambia la imagen entre cuadros (eso también nota si se mueve la hoja).

function alGirar(e) {
  const r = e.rotationRate;
  if (!r || r.alpha === null || r.alpha === undefined) return;
  hayGiro = true;
  giroPico = Math.max(giroPico, Math.hypot(r.alpha, r.beta || 0, r.gamma || 0));
}

/** Movimiento desde la medida anterior (la imagen, normalizada a cada 130 ms, y el giro más fuerte) */
function medirMovimiento(img) {
  const ahora = performance.now(), mini = miniGris(img);
  movImagen = miniAnterior && ahora - tMini < 1000
    ? diferenciaMedia(mini, miniAnterior) * 130 / Math.max(60, ahora - tMini)
    : Infinity;
  miniAnterior = mini; tMini = ahora;
  giro = giroPico; giroPico = 0;
}

/** `tolerancia` > 1 afloja la exigencia (para que la captura automática no se trabe nunca) */
const estaQuieto = (tolerancia = 1) => movImagen < MOV_QUIETO * tolerancia && (!hayGiro || giro < GIRO_QUIETO * tolerancia);

/** Al tocar el botón el teléfono se mueve: se espera a que se asiente (hasta 1,5 s) */
async function esperarQuietud(max = 1500) {
  const inicio = performance.now();
  let desde = 0;
  await pausa(150);
  while (activa && flujo && video.videoWidth && performance.now() - inicio < max) {
    medirMovimiento(cuadroChico());
    const ahora = performance.now();
    if (!estaQuieto(1 + (ahora - inicio) / max)) desde = 0;
    else if (!desde) desde = ahora;
    else if (ahora - desde >= 200) return;
    await pausa(70);
  }
}

function alDetectar(r, img) {
  const ahora = performance.now();
  if (!lista && ahora > pausaHasta && (!firmaUltima || diferencia(firma(img), firmaUltima) > 0.12)) { lista = true; reintentos = 0; }
  if (!r || r.confianza < 0.55) {
    if (++perdidas > 3) {
      vivas = null; hojaDesde = 0; quietoDesde = 0;
      if (ahora > pausaHasta) { lista = true; reintentos = 0; }
    }
    ponerPista('Apunta a la hoja', false);
    return;
  }
  perdidas = 0;
  // Las esquinas se suavizan para dibujarlas; la foto espera a que el teléfono
  // esté quieto, no a que las esquinas dejen de temblar (en la mano siempre tiemblan)
  const nuevas = r.esquinas;
  if (vivas && moverMax(vivas, nuevas) < 0.05) vivas = vivas.map((p, i) => ({ x: (p.x + nuevas[i].x) / 2, y: (p.y + nuevas[i].y) / 2 }));
  else vivas = nuevas;
  if (!hojaDesde) hojaDesde = ahora;
  if (!ajustes().autoCaptura) return ponerPista('Hoja encontrada', true);
  if (!lista) return ponerPista('Pasa a la siguiente hoja', true);
  // Mientras más se espera, más tolerante: después de unos segundos se toma
  // en el momento más quieto que se pueda, en vez de esperar para siempre
  const espera = ahora - hojaDesde;
  const tolerancia = Math.min(2.5, 1 + Math.max(0, espera - 1200) / 2000);
  if (!estaQuieto(tolerancia)) quietoDesde = 0;
  else if (!quietoDesde) quietoDesde = ahora;
  if (espera > 800 && quietoDesde && ahora - quietoDesde > 600) capturarSiEstaNitida();
  else if (!midiendo) ponerPista('No te muevas…', true);
}

/**
 * Antes de la foto automática se mide la nitidez de la hoja en el video: si
 * está desenfocada se pide enfocar y se espera (hasta 2 veces; después se toma
 * igual y, si la foto sale borrosa, se repite sola).
 */
async function capturarSiEstaNitida() {
  if (midiendo || capturando || !vivas) return;
  midiendo = true;
  let borrosa = false;
  try {
    const vw = video.videoWidth, vh = video.videoHeight;
    const xs = vivas.map(p => p.x * vw), ys = vivas.map(p => p.y * vh);
    const x0 = Math.max(0, Math.min(...xs)), y0 = Math.max(0, Math.min(...ys));
    const bw = Math.min(vw, Math.max(...xs)) - x0, bh = Math.min(vh, Math.max(...ys)) - y0;
    const k = Math.min(1, 1000 / Math.max(bw, bh));
    const c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(bw * k)); c.height = Math.max(8, Math.round(bh * k));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, x0, y0, bw, bh, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    soltarCanvas(c);
    const esquinas = vivas.map(p => ({ x: (p.x * vw - x0) / bw, y: (p.y * vh - y0) / bh }));
    // El video sale más suave que la foto: aquí solo se busca un desenfoque claro
    const { valor } = await conLimite(nitidez(img, esquinas), 2500);
    borrosa = typeof valor === 'number' && valor < UMBRAL_VIDEO;
  } catch (e) {}
  midiendo = false;
  if (!activa || !lista || capturando) return;
  if (borrosa && intentosEnfoque < 2) {
    intentosEnfoque++;
    quietoDesde = performance.now() + 400; // se vuelve a medir cuando termine de enfocar
    ponerPista('Enfocando… no te muevas', true);
    enfocar();
    return;
  }
  intentosEnfoque = 0;
  disparar(true);
}

/** Pide al teléfono que enfoque (en el punto tocado, si se puede). No todos lo permiten */
function enfocar(x, y) {
  const pista = flujo?.getVideoTracks()[0];
  if (!pista || !enfoques.includes('single-shot')) return;
  const pedido = { focusMode: 'single-shot' };
  if (x !== undefined) pedido.pointsOfInterest = [{ x, y }];
  pista.applyConstraints({ advanced: [pedido] })
    .catch(() => pista.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] }))
    .catch(() => {})
    .finally(() => {
      // Después de enfocar, vuelve a enfocar solo mientras se mueve
      if (enfoques.includes('continuous')) setTimeout(() => pista.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}), 2000);
    });
}

function ponerPista(texto, encontrada) {
  pista.hidden = false;
  if (pista.textContent !== texto) pista.textContent = texto;
  pista.classList.toggle('encontrada', encontrada);
}

let marcoDibujado = '';
function limpiarMarco() {
  marco.getContext('2d').clearRect(0, 0, marco.width, marco.height);
  marcoDibujado = '';
}

function dibujarMarco() {
  const dpr = window.devicePixelRatio || 1;
  const cw = marco.clientWidth, ch = marco.clientHeight;
  // Se vuelve a dibujar solo si algo cambió (no en cada cuadro)
  const clave = vivas && video.videoWidth ? `${cw}x${ch}@${dpr}|${video.videoWidth}x${video.videoHeight}|${vivas.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ')}` : `${cw}x${ch}@${dpr}`;
  if (clave === marcoDibujado) return;
  marcoDibujado = clave;
  if (marco.width !== Math.round(cw * dpr) || marco.height !== Math.round(ch * dpr)) {
    marco.width = Math.round(cw * dpr); marco.height = Math.round(ch * dpr);
  }
  const ctx = marco.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!vivas || !video.videoWidth) return;
  // El video se ve completo (object-fit: contain), centrado en la pantalla
  const vw = video.videoWidth, vh = video.videoHeight;
  const k = Math.min(cw / vw, ch / vh);
  const dx = (cw - vw * k) / 2, dy = (ch - vh * k) / 2;
  const pts = vivas.map(p => [p.x * vw * k + dx, p.y * vh * k + dy]);
  ctx.beginPath();
  pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fillStyle = 'rgba(45, 212, 191, 0.18)';
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'; ctx.lineWidth = 5; ctx.stroke();
  ctx.strokeStyle = '#2dd4bf'; ctx.lineWidth = 3; ctx.stroke();
  for (const [x, y] of pts) {
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#0f766e'; ctx.stroke();
  }
}

// ── Fotos ───────────────────────────────────────────────────────────
/**
 * La foto a la resolución máxima del sensor (si el navegador lo permite) o,
 * si no, el cuadro actual del video. Devuelve { blob, origen }.
 */
/** Un valor dentro del rango de la cámara ({ min, max, step }), sin pasarse */
const enRango = (v, r) => {
  const min = r.min || 1, paso = r.step || 1;
  return Math.max(min, Math.min(r.max, min + Math.floor((v - min) / paso) * paso));
};

/**
 * Lo que se le pide a la cámara para la foto. Se arma una vez (preguntarle a
 * la cámara qué puede hacer tarda en algunos teléfonos).
 */
async function armarPedidoFoto() {
  const pedido = { tamano: null, sinFlash: false };
  try {
    const cap = await capturador.getPhotoCapabilities();
    const W = cap.imageWidth?.max, H = cap.imageHeight?.max;
    if (W && H) {
      // Sin pedirla, algunos teléfonos (p. ej. Samsung) entregan la foto al tamaño del video. Pero la
      // más grande de un sensor de 48 o 50 MP es enorme (8000 px) y traba al teléfono: se pide la más
      // cercana a lo que se va a guardar (la cámara da la que tenga más parecida)
      const k = Math.min(1, ladoFoto() / Math.max(W, H));
      pedido.tamano = { imageWidth: enRango(Math.round(W * k), cap.imageWidth), imageHeight: enRango(Math.round(H * k), cap.imageHeight) };
    }
    pedido.sinFlash = !!cap.fillLightMode?.includes('off');
  } catch (e) {}
  return pedido;
}

async function tomarFoto() {
  if (capturador && !fotoCompletaFalla) {
    try {
      pedidoFoto = pedidoFoto || await armarPedidoFoto();
      const pedido = { ...(pedidoFoto.tamano || {}) };
      // Sin flash: en papel deja un reflejo blanco (la luz de la linterna sí se respeta)
      if (pedidoFoto.sinFlash && $('#camara-linterna').getAttribute('aria-pressed') !== 'true') pedido.fillLightMode = 'off';
      return { blob: await conLimite(capturador.takePhoto(pedido), 8000), origen: 'foto completa' };
    } catch (e) {
      fotoCompletaFalla = true; // en este teléfono no sirve: se usa el cuadro del video
      motivoFalla = e.message;
      // Desde ahora la foto es el cuadro del video: que sea lo más grande posible
      const { width, height } = videoIdeal(false);
      flujo?.getVideoTracks()[0]?.applyConstraints({ width: { ideal: width }, height: { ideal: height } }).catch(() => {});
    }
  }
  if (!video.videoWidth) throw new Error('La cámara todavía no está lista');
  return { blob: await canvasABlob(aCanvas(video), 'image/jpeg', 0.95), origen: 'cuadro del video' + (motivoFalla ? ` (la foto completa falló: ${motivoFalla})` : '') };
}

async function asegurarDocumento() {
  if (!sesion.docId) sesion.docId = (await nuevoDocumento()).id;
  return sesion.docId;
}

/** Miniatura de una foto para el botón junto al disparador */
async function miniaturaDe(fuente) {
  const chico = aCanvas(fuente, 160);
  const blob = await canvasABlob(chico, 'image/jpeg', 0.7);
  soltarCanvas(chico);
  return URL.createObjectURL(blob);
}

/** Cuenta una página más y muestra su miniatura */
function contarPagina(url) {
  if (sesion.ultima) URL.revokeObjectURL(sesion.ultima);
  sesion.ultima = url;
  sesion.cantidad++;
  pintarBotones();
}

function destello() {
  const d = $('#camara-destello');
  d.classList.remove('activo');
  void d.offsetWidth;
  d.classList.add('activo');
  navigator.vibrate?.(30);
}

/**
 * Recuerda cómo se veía la hoja fotografiada, para no repetirla en la captura
 * automática. Con el último cuadro que se miró (justo antes de la foto): leer
 * uno nuevo justo después traba, porque la cámara se está reacomodando.
 */
function marcarTomada() {
  lista = false;
  pausaHasta = performance.now() + 1500;
  firmaUltima = ultimoCuadro ? firma(ultimoCuadro) : null;
}

/** @param auto la tomó la captura automática (el teléfono ya estaba quieto) */
async function disparar(auto = false) {
  if (capturando || !flujo || video.readyState < 2 || !video.videoWidth) return;
  capturando = true;
  vista.classList.add('tomando');
  try {
    if (!auto) { ponerPista('Quieto…', true); await esperarQuietud(); }
    if (!activa || !flujo) return;
    // Algunos teléfonos tardan en tomar la foto completa: el aviso sigue hasta que llega
    ponerPista('Tomando la foto… no te muevas', true);
    const inicio = performance.now();
    const { blob, origen } = await tomarFoto();
    const ms = Math.round(performance.now() - inicio);
    vista.classList.remove('tomando');
    destello();
    ponerPista('Foto tomada', true);
    marcarTomada();
    await usarFoto(blob, origen, { auto, ms });
  } catch (e) {
    console.error(e);
    aviso('No se pudo tomar la foto. Intenta de nuevo.', 'error');
  } finally {
    capturando = false;
    vista.classList.remove('tomando');
  }
}

/**
 * Sigue con una foto (de la cámara en vivo o de la app de cámara del teléfono).
 * Si la tomó la captura automática y salió borrosa, se descarta y se repite
 * (hasta 2 veces); si no, el recorte avisa.
 */
async function usarFoto(blob, origen = 'cámara del teléfono', { auto = false, ms = null } = {}) {
  // Al volver a tomar una página es una sola hoja, con el filtro de siempre
  const modo = sesion.reemplazar ? 'hoja' : modoCamara();
  // La cédula siempre pasa por el recorte: hay que ver bien cada cara
  const rafaga = ajustes().rafaga && !sesion.reemplazar && modo !== 'cedula';
  const libro = modo === 'libro';
  const opciones = modo === 'pizarra' ? { filtro: 'pizarra' } : {};
  // Todo en el worker: abrirla, achicarla, guardarla, buscar la hoja y ver si salió borrosa
  const revisar = !rafaga || auto;
  const foto = await prepararFoto(blob, { hoja: true, nitidez: revisar && ajustes().filtro !== 'dibujo' });
  guardarDiagnostico({
    video: video.videoWidth ? `${video.videoWidth} × ${video.videoHeight}` : 'sin video',
    foto: `${foto.anchoOriginal} × ${foto.altoOriginal}`,
    origen,
    ms,
    preparar: foto.ms,
    liviano: gamaBaja()
  });
  const esquinas = foto.esquinas, borrosa = revisar && foto.borrosa;
  if (auto && borrosa && reintentos < 2) {
    reintentos++;
    soltarVista(foto);
    lista = true; firmaUltima = null; pausaHasta = 0;
    hojaDesde = performance.now(); quietoDesde = 0; // vuelve a exigir quietud completa
    ponerPista('Salió borrosa. Otra vez: no te muevas…', true);
    return;
  }
  reintentos = 0;
  if (modo === 'cedula') return caraDeLaCedula(foto, esquinas, borrosa);
  if (rafaga) {
    // Sin parar: la página se arma en la cola (en el worker)
    const docId = await asegurarDocumento();
    contarPagina(await miniaturaDe(foto.vista));
    // La vista solo hace falta para buscar el lomo del libro: si no, se suelta ya
    if (!libro) soltarVista(foto);
    const n = sesion.cantidad;
    encolar(docId, async () => {
      try {
        const paginas = libro ? await crearPaginasDeLibro(foto, esquinas || undefined) : [await crearPagina(foto, esquinas || undefined, opciones)];
        if (paginas.some(esBorrosa)) aviso(`La foto ${n} salió borrosa: revísala en el documento.`, 'error', 5000);
        return paginas;
      } finally {
        soltarVista(foto);
      }
    });
    ponerPista(`Página ${sesion.cantidad} guardada`, true);
    return;
  }
  abrirRecorte({
    fuente: foto.vista,
    esquinas,
    borrosa,
    textoCancelar: 'Repetir foto',
    titulo: libro ? 'Esquinas del libro abierto' : undefined,
    alListo: async esq => {
      if (sesion.reemplazar) {
        // Volver a tomar una página: queda en su mismo lugar
        const { id, n } = sesion.reemplazar, docId = sesion.docId;
        await reemplazarPagina(docId, id, await crearPagina(foto, esq));
        sesion = null;
        aviso(`Listo: se cambió la página ${n}.`, 'exito');
        volver(`doc/${encodeURIComponent(docId)}/pagina/${n}`, 2); // recorte → cámara → página
        return;
      }
      const docId = await asegurarDocumento();
      if (libro) {
        // Las dos páginas del libro (o una, si no se encuentra el lomo)
        const paginas = await crearPaginasDeLibro(foto, esq);
        for (const p of paginas) {
          await agregarPaginaRevisada(docId, p);
          contarPagina(URL.createObjectURL(p.miniatura));
        }
        if (paginas.length === 1) aviso('No encontré el lomo del libro: quedó como una sola página.', 'info', 5000);
        return volver('camara');
      }
      const miniatura = await miniaturaDe(foto.vista);
      try {
        await agregarPaginaRevisada(docId, await crearPagina(foto, esq, opciones));
      } catch (e) {
        URL.revokeObjectURL(miniatura);
        throw e;
      }
      contarPagina(miniatura);
      volver('camara');
    },
    alCancelar: () => {
      // "Repetir foto": la captura automática vuelve a tomar esta misma hoja
      lista = true; firmaUltima = null; reintentos = 0;
      volver('camara');
    }
  });
}

/** Cédula: primero el frente y después el reverso; con las dos se arma la hoja */
function caraDeLaCedula(foto, esquinas, borrosa) {
  const reverso = !!sesion.cedula;
  abrirRecorte({
    fuente: foto.vista,
    esquinas,
    borrosa,
    textoCancelar: 'Repetir foto',
    titulo: reverso ? 'Reverso de la cédula' : 'Frente de la cédula',
    alListo: async esq => {
      const cara = await caraDeCedula(foto.blob, esq);
      if (!reverso) {
        sesion.cedula = { frente: cara };
        pintarBotones();
        aviso('Listo el frente. Ahora voltea la cédula y toma el reverso.', 'info', 5000);
        return volver('camara');
      }
      const docId = await asegurarDocumento();
      const pagina = await crearPaginaDeCedula([sesion.cedula.frente, cara]);
      await agregarPagina(docId, pagina);
      sesion.cedula = null;
      contarPagina(URL.createObjectURL(pagina.miniatura));
      sugerirPin();
      volver('camara');
    },
    alCancelar: () => {
      lista = true; firmaUltima = null; reintentos = 0;
      volver('camara');
    }
  });
}

/** La cédula es un dato sensible: la primera vez, se ofrece proteger la app con un PIN */
function sugerirPin() {
  const listo = 'Listo: el frente y el reverso quedaron en una hoja, a tamaño real.';
  if (bloqueo() || ajustes().pinSugerido) return aviso(listo, 'exito', 4500);
  cambiarAjuste('pinSugerido', true);
  aviso(listo + ' Como es tu cédula, puedes proteger ScanLibre con un PIN.', 'exito', 8000, {
    accion: { texto: 'Poner PIN', alTocar: () => configurarBloqueo() }
  });
}

async function terminar() {
  // Si de la cédula solo se tomó el frente, queda sola en la hoja (no se pierde)
  if (sesion?.cedula) {
    const { frente } = sesion.cedula;
    sesion.cedula = null;
    try {
      const docId = await asegurarDocumento();
      encolar(docId, () => crearPaginaDeCedula([frente]));
      sesion.cantidad++;
      aviso('La cédula quedó solo con el frente.', 'info', 4500);
    } catch (e) { console.error(e); }
  }
  const s = sesion;
  sesion = null;
  if (s?.ultima) URL.revokeObjectURL(s.ultima);
  if (s?.origen === 'pagina') return volver(`doc/${encodeURIComponent(s.docId)}/pagina/${s.reemplazar?.n || 1}`);
  if (s?.docId && (s.cantidad > 0 || pendientesEnCola(s.docId) > 0)) {
    if (s.origen === 'doc') volver('doc/' + encodeURIComponent(s.docId));
    else ir('doc/' + encodeURIComponent(s.docId), { reemplazar: true });
  } else {
    volver(s?.origen === 'doc' ? 'doc/' + encodeURIComponent(s.docId) : '');
  }
}

async function desdeGaleria() {
  const archivos = await elegirArchivos('entrada-fotos');
  if (!archivos.length) return;
  if (modoActual() === 'qr') return codigosDeGaleria(archivos);
  const docId = await asegurarDocumento();
  importarArchivos(docId, archivos, modoCamara() === 'pizarra' ? { filtro: 'pizarra' } : {});
  sesion.cantidad += archivos.length;
  terminar();
}

async function desdeCamaraDelTelefono() {
  const [archivo] = await elegirArchivos('entrada-camara');
  if (!archivo) return;
  try { await usarFoto(archivo); } catch (e) { aviso('No se pudo usar la foto.', 'error'); }
}

/** Los modos de la cámara */
const MODOS = {
  hoja: { corto: 'Hoja', icono: 'imagen', texto: 'Hoja: una página por foto', aviso: 'Una hoja por foto.' },
  libro: { corto: 'Libro', icono: 'libro', texto: 'Libro abierto: las dos páginas en una foto', aviso: 'Libro: toma el libro abierto con las dos páginas; se separan solas.' },
  pizarra: { corto: 'Pizarra', icono: 'pizarra', texto: 'Pizarra: blanca, verde o negra', aviso: 'Pizarra: queda con fondo blanco y el escrito oscuro y nítido (también la de tiza).' },
  cedula: { corto: 'Cédula', icono: 'cedula', texto: 'Cédula o carné: las dos caras en una hoja, a tamaño real', aviso: 'Cédula: toma el frente y después el reverso; quedan juntos en una hoja, a tamaño real.' },
  qr: { corto: 'QR', icono: 'qr', texto: 'Código QR: leerlo (enlace, Wi-Fi, texto)', aviso: 'Apunta al código: se lee solo.' }
};

function pintarBotones() {
  if (!sesion) return;
  const a = ajustes();
  $('#camara-auto').setAttribute('aria-pressed', String(a.autoCaptura));
  $('#camara-rafaga').setAttribute('aria-pressed', String(a.rafaga));
  const m = MODOS[modoCamara()] || MODOS.hoja;
  $('#camara-modo-texto').textContent = m.corto;
  $('#camara-modo-icono').setAttribute('href', '#i-' + m.icono);
  $('#camara-modo').setAttribute('aria-label', `Modo: ${m.corto}. Tocar para cambiarlo`);
  $('#camara-modo').classList.toggle('chip-activo', modoCamara() !== 'hoja');
  // En el modo QR no se toman fotos
  const qr = modoActual() === 'qr';
  $('#camara-disparar').style.visibility = qr ? 'hidden' : '';
  $('#camara-auto').hidden = $('#camara-rafaga').hidden = qr;
  if (qr) { limpiarMarco(); vivas = null; }
  if (flujo && pista.textContent === (qr ? 'Apunta a la hoja' : 'Apunta al código QR')) ponerPista(qr ? 'Apunta al código QR' : 'Apunta a la hoja', false);
  const paso = $('#camara-paso');
  paso.hidden = modoCamara() !== 'cedula' || !!sesion.reemplazar;
  paso.textContent = sesion.cedula ? 'Cédula: ahora el reverso' : 'Cédula: primero el frente';
  const hay = sesion.cantidad > 0;
  $('#camara-listo').hidden = !hay;
  $('#camara-hueco').hidden = hay;
  $('#camara-cuenta').textContent = sesion.cantidad;
  if (sesion.ultima) $('#camara-ultima').src = sesion.ultima;
}

export function iniciar() {
  // Tocar la imagen de la cámara: enfoca ahí (si el teléfono lo permite)
  $('.camara').addEventListener('click', e => {
    if (!flujo || !video.videoWidth || e.target.closest('button')) return;
    const r = video.getBoundingClientRect();
    const k = Math.min(r.width / video.videoWidth, r.height / video.videoHeight);
    const dw = video.videoWidth * k, dh = video.videoHeight * k;
    const x = (e.clientX - r.left - (r.width - dw) / 2) / dw, y = (e.clientY - r.top - (r.height - dh) / 2) / dh;
    if (x < 0 || y < 0 || x > 1 || y > 1) return;
    const anillo = $('#camara-enfoque');
    anillo.hidden = true;
    anillo.style.left = `${e.clientX - r.left}px`;
    anillo.style.top = `${e.clientY - r.top}px`;
    void anillo.offsetWidth;
    anillo.hidden = false;
    enfocar(x, y);
  });
  // En ráfaga es fácil tomar la misma página dos veces: se avisa al momento
  eventosPaginas.addEventListener('repetida', e => {
    if (activa && sesion?.docId === e.detail.docId) aviso(`La página ${e.detail.n} parece igual a la ${e.detail.igualA}: revísala al terminar.`, 'info', 4500);
  });
  $('#camara-disparar').addEventListener('click', () => disparar());
  $('#camara-cerrar').addEventListener('click', terminar);
  $('#camara-listo').addEventListener('click', terminar);
  $('#camara-galeria').addEventListener('click', desdeGaleria);
  $('#camara-galeria-alt').addEventListener('click', desdeGaleria);
  $('#camara-nativa').addEventListener('click', desdeCamaraDelTelefono);
  $('#camara-auto').addEventListener('click', () => {
    cambiarAjuste('autoCaptura', !ajustes().autoCaptura);
    if (ajustes().autoCaptura) aviso('La foto se toma sola cuando la hoja se queda quieta.');
    lista = true;
    pintarBotones();
  });
  $('#camara-rafaga').addEventListener('click', () => {
    cambiarAjuste('rafaga', !ajustes().rafaga);
    aviso(ajustes().rafaga ? 'Ráfaga: toma varias fotos seguidas; las esquinas se ponen solas.' : 'Después de cada foto podrás ajustar las esquinas.');
    pintarBotones();
  });
  $('#camara-modo').addEventListener('click', async () => {
    const opcion = await menu(Object.entries(MODOS).map(([valor, m]) => ({
      valor, icono: m.icono, texto: `${m.texto}${valor === modoCamara() ? ' ✓' : ''}`
    })), 'Qué vas a escanear');
    if (!opcion || !sesion) return;
    cambiarAjuste('modo', opcion);
    cambiarAjuste('libro', opcion === 'libro');
    aviso(MODOS[opcion].aviso, 'info', 4500);
    pintarBotones();
  });
  $('#camara-linterna').addEventListener('click', async e => {
    const boton = e.currentTarget;
    const encender = boton.getAttribute('aria-pressed') !== 'true';
    try {
      await flujo.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: encender }] });
      boton.setAttribute('aria-pressed', String(encender));
    } catch (err) {
      aviso('No se pudo encender la luz.', 'error');
    }
  });
}
