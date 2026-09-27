// ScanLibre · vistas/camara.js
// Cámara con la hoja marcada en vivo. Modos:
//  · normal: después de cada foto se revisan las esquinas;
//  · ráfaga: foto tras foto sin parar (las esquinas se ponen solas);
//  · auto: la foto se toma sola cuando la hoja se queda quieta. Con ráfaga
//    sirve para escanear un cuaderno entero pasando las páginas.

import { $, aviso } from '../util.js';
import { ir, volver } from '../rutas.js';
import { ajustes, cambiarAjuste } from '../ajustes.js';
import { detectar, nitidez } from '../motor.js';
import { aCanvas, aImageData, canvasABlob, normalizarFoto, soltarCanvas } from '../fotos.js';
import { buscarHoja, crearPagina, encolar, importarArchivos, nuevoDocumento, pendientesEnCola, fotoBorrosa, esBorrosa, TODA_LA_FOTO } from '../paginas.js';
import { agregarPagina, reemplazarPagina } from '../db.js';
import { elegirArchivos } from '../archivos.js';
import { abrirRecorte } from './recorte.js';

const video = $('#camara-video');
const marco = $('#camara-marco');
const pista = $('#camara-pista');

let sesion = null;      // { docId, origen: 'inicio' | 'doc', cantidad, ultima (url) }
let flujo = null, capturador = null, fotoCompletaFalla = false, motivoFalla = '';
let enfoques = [], midiendo = false, intentosEnfoque = 0;
let activa = false, capturando = false, detectando = false, ultimaDeteccion = 0;
let vivas = null, perdidas = 0, quietaDesde = 0;
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
  if (!navigator.mediaDevices?.getUserMedia) return sinCamara(motivo());
  const este = ++intento;
  const conFotoCompleta = 'ImageCapture' in window;
  let nuevo;
  try {
    nuevo = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        // Video en 4K si la cámara lo permite: si la foto completa falla, el cuadro del video sale nítido
        width: { ideal: 3840 },
        height: { ideal: 2160 }
      }
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
  vivas = null; perdidas = 0;
  requestAnimationFrame(cuadro);
}

function apagar() {
  intento++;
  $('#camara-disparar').disabled = true;
  if (flujo) flujo.getTracks().forEach(t => t.stop());
  flujo = null; capturador = null;
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

function cuadro(t) {
  if (!activa || !flujo) return;
  requestAnimationFrame(cuadro);
  dibujarMarco();
  if (detectando || capturando || t - ultimaDeteccion < 130 || video.readyState < 2 || !video.videoWidth) return;
  detectando = true;
  ultimaDeteccion = t;
  const img = aImageData(video, 400);
  // Con límite de tiempo: si una detección se traba, la cámara no se queda "pegada"
  conLimite(detectar(img), 2500)
    .then(r => { if (activa) alDetectar(r, img); })
    .catch(() => {})
    .finally(() => { detectando = false; });
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

function alDetectar(r, img) {
  const ahora = performance.now();
  if (!lista && ahora > pausaHasta && (!firmaUltima || diferencia(firma(img), firmaUltima) > 0.12)) lista = true;
  if (!r || r.confianza < 0.55) {
    if (++perdidas > 3) { vivas = null; if (ahora > pausaHasta) lista = true; }
    ponerPista('Apunta a la hoja', false);
    return;
  }
  perdidas = 0;
  const nuevas = r.esquinas;
  if (vivas && moverMax(vivas, nuevas) < 0.05) {
    if (moverMax(vivas, nuevas) > 0.012) quietaDesde = ahora;
    vivas = vivas.map((p, i) => ({ x: (p.x + nuevas[i].x) / 2, y: (p.y + nuevas[i].y) / 2 }));
  } else {
    vivas = nuevas;
    quietaDesde = ahora;
  }
  if (ajustes().autoCaptura && lista) {
    if (ahora - quietaDesde > 1200) capturarSiEstaNitida();
    else ponerPista('No te muevas…', true);
  } else if (ajustes().autoCaptura) {
    ponerPista('Pasa a la siguiente hoja', true);
  } else {
    ponerPista('Hoja encontrada', true);
  }
}

/**
 * Antes de la foto automática se mide la nitidez de la hoja en el video: si
 * está borrosa se pide enfocar y se espera (hasta 3 veces; después se toma igual
 * y el recorte avisa).
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
    borrosa = (await conLimite(nitidez(img, esquinas), 2500)).borrosa;
  } catch (e) {}
  midiendo = false;
  if (!activa || !lista || capturando) return;
  if (borrosa && intentosEnfoque < 3) {
    intentosEnfoque++;
    quietaDesde = performance.now() - 600; // se vuelve a medir en un momento
    ponerPista('Enfocando… no te muevas', true);
    enfocar();
    return;
  }
  intentosEnfoque = 0;
  disparar();
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

function limpiarMarco() {
  marco.getContext('2d').clearRect(0, 0, marco.width, marco.height);
}

function dibujarMarco() {
  const dpr = window.devicePixelRatio || 1;
  const cw = marco.clientWidth, ch = marco.clientHeight;
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
async function tomarFoto() {
  if (capturador && !fotoCompletaFalla) {
    try {
      const pedido = {};
      try {
        const cap = await capturador.getPhotoCapabilities();
        // Sin pedirla, algunos teléfonos (p. ej. Samsung) entregan la foto al tamaño del video
        if (cap.imageWidth?.max && cap.imageHeight?.max) { pedido.imageWidth = cap.imageWidth.max; pedido.imageHeight = cap.imageHeight.max; }
        // Sin flash: en papel deja un reflejo blanco (la luz de la linterna sí se respeta)
        if (cap.fillLightMode?.includes('off') && $('#camara-linterna').getAttribute('aria-pressed') !== 'true') pedido.fillLightMode = 'off';
      } catch (e) {}
      return { blob: await conLimite(capturador.takePhoto(pedido), 8000), origen: 'foto completa' };
    } catch (e) {
      fotoCompletaFalla = true; // en este teléfono no sirve: se usa el cuadro del video
      motivoFalla = e.message;
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

/** Recuerda cómo se veía la hoja fotografiada, para no repetirla en la captura automática */
function marcarTomada() {
  lista = false;
  pausaHasta = performance.now() + 1500;
  firmaUltima = flujo && video.videoWidth ? firma(aImageData(video, 400)) : null;
}

async function disparar() {
  if (capturando || !flujo || video.readyState < 2 || !video.videoWidth) return;
  capturando = true;
  destello();
  try {
    const { blob, origen } = await tomarFoto();
    marcarTomada();
    await usarFoto(blob, origen);
  } catch (e) {
    console.error(e);
    aviso('No se pudo tomar la foto. Intenta de nuevo.', 'error');
  } finally {
    capturando = false;
  }
}

/** Sigue con una foto (de la cámara en vivo o de la app de cámara del teléfono) */
async function usarFoto(blob, origen = 'cámara del teléfono') {
  const foto = await normalizarFoto(blob);
  guardarDiagnostico({
    video: video.videoWidth ? `${video.videoWidth} × ${video.videoHeight}` : 'sin video',
    foto: `${foto.anchoOriginal} × ${foto.altoOriginal}`,
    origen
  });
  if (ajustes().rafaga && !sesion.reemplazar) {
    // Sin parar: la hoja se busca sola y la página se arma en la cola
    const docId = await asegurarDocumento();
    contarPagina(await miniaturaDe(foto.canvas));
    const n = sesion.cantidad;
    encolar(docId, async () => {
      const pagina = await crearPagina(foto);
      if (esBorrosa(pagina)) aviso(`La foto ${n} salió borrosa: revísala en el documento.`, 'error', 5000);
      return pagina;
    });
    ponerPista(`Página ${sesion.cantidad} guardada`, true);
    return;
  }
  const esquinas = await buscarHoja(foto.canvas);
  let borrosa = false;
  try { borrosa = await fotoBorrosa(foto.canvas, esquinas || TODA_LA_FOTO); } catch (e) {}
  abrirRecorte({
    fuente: foto.canvas,
    esquinas,
    borrosa: borrosa && ajustes().filtro !== 'dibujo',
    textoCancelar: 'Repetir foto',
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
      const miniatura = await miniaturaDe(foto.canvas); // antes: crearPagina suelta el canvas
      try {
        await agregarPagina(docId, await crearPagina(foto, esq));
      } catch (e) {
        URL.revokeObjectURL(miniatura);
        throw e;
      }
      contarPagina(miniatura);
      volver('camara');
    },
    alCancelar: () => volver('camara')
  });
}

function terminar() {
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
  const docId = await asegurarDocumento();
  importarArchivos(docId, archivos);
  sesion.cantidad += archivos.length;
  terminar();
}

async function desdeCamaraDelTelefono() {
  const [archivo] = await elegirArchivos('entrada-camara');
  if (!archivo) return;
  try { await usarFoto(archivo); } catch (e) { aviso('No se pudo usar la foto.', 'error'); }
}

function pintarBotones() {
  if (!sesion) return;
  const a = ajustes();
  $('#camara-auto').setAttribute('aria-pressed', String(a.autoCaptura));
  $('#camara-rafaga').setAttribute('aria-pressed', String(a.rafaga));
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
