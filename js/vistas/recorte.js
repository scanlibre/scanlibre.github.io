// ScanLibre · vistas/recorte.js
// Ajustar a mano las 4 esquinas de la hoja. Las esquinas llevan borde blanco
// y oscuro para que se vean sobre cualquier fondo (también sobre papel
// blanco), y al arrastrar aparece una lupa para ponerlas con precisión.

import { $, aviso } from '../util.js';
import { ir, volver } from '../rutas.js';
import { esConvexo } from '../imagen/geometria.js';
import { buscarHoja, TODA_LA_FOTO } from '../paginas.js';
import { soltarCanvas } from '../fotos.js';

const area = $('#recorte-area');
const lienzo = $('#recorte-lienzo');
const MARGEN = 28, RADIO_TOQUE = 44, LUPA = 62, AUMENTO = 2.5;

let estado = null;   // { fuente, esquinas, alListo, alCancelar }
let arrastre = null; // { indice, id }
let trabajando = false;

/**
 * Abre la pantalla de recorte.
 * @param op.fuente    canvas, bitmap o imagen con la foto
 * @param op.esquinas  esquinas iniciales (fracciones 0..1) o null para toda la foto
 * @param op.alListo   async (esquinas) => ...; es quien decide a dónde ir después
 * @param op.alCancelar () => ...
 * @param op.borrosa   true para avisar que la foto salió borrosa (con un botón para repetirla)
 */
export function abrirRecorte(op) {
  estado = { ...op, esquinas: (op.esquinas || TODA_LA_FOTO).map(p => ({ ...p })) };
  ir('recorte');
}

export function mostrar() {
  if (!estado) return volver(''); // se recargó la página en esta pantalla: no hay foto
  $('#recorte-cancelar').setAttribute('aria-label', estado.textoCancelar || 'Cancelar');
  $('#titulo-recorte').textContent = estado.titulo || 'Ajusta las esquinas';
  $('#recorte-borrosa').hidden = !estado.borrosa;
  trabajando = false;
  $('#recorte-listo').disabled = false;
  dibujar();
}

export function ocultar() {
  // La foto ya no se va a usar: se suelta su memoria (bitmap o canvas)
  const f = estado?.fuente;
  if (f?.close) f.close();
  else soltarCanvas(f);
  estado = null;
  arrastre = null;
}

const anchoFuente = () => estado.fuente.naturalWidth || estado.fuente.width;
const altoFuente = () => estado.fuente.naturalHeight || estado.fuente.height;

/** Dónde queda la foto dentro del lienzo (en px de pantalla) */
function encaje() {
  const cw = area.clientWidth, ch = area.clientHeight;
  const W = anchoFuente(), H = altoFuente();
  const k = Math.min((cw - 2 * MARGEN) / W, (ch - 2 * MARGEN) / H);
  return { k, ox: (cw - W * k) / 2, oy: (ch - H * k) / 2, W, H, cw, ch };
}

const aPantalla = (p, e) => ({ x: e.ox + p.x * e.W * e.k, y: e.oy + p.y * e.H * e.k });

function valido(e) {
  return esConvexo(estado.esquinas.map(p => ({ x: p.x * e.W, y: p.y * e.H })));
}

function dibujar() {
  if (!estado) return;
  const e = encaje();
  const dpr = window.devicePixelRatio || 1;
  if (lienzo.width !== Math.round(e.cw * dpr) || lienzo.height !== Math.round(e.ch * dpr)) {
    lienzo.width = Math.round(e.cw * dpr); lienzo.height = Math.round(e.ch * dpr);
  }
  const ctx = lienzo.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, e.cw, e.ch);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(estado.fuente, e.ox, e.oy, e.W * e.k, e.H * e.k);

  const pts = estado.esquinas.map(p => aPantalla(p, e));
  const ok = valido(e);
  // Oscurece lo que queda fuera de la hoja
  ctx.beginPath();
  ctx.rect(e.ox, e.oy, e.W * e.k, e.H * e.k);
  pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fill('evenodd');
  // Borde doble: oscuro por fuera y de color por dentro, se ve sobre blanco y sobre negro
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'; ctx.lineWidth = 5; ctx.stroke();
  ctx.strokeStyle = ok ? '#2dd4bf' : '#f97066'; ctx.lineWidth = 2.5; ctx.stroke();
  pts.forEach((p, i) => {
    const activa = arrastre?.indice === i;
    ctx.beginPath(); ctx.arc(p.x, p.y, activa ? 15 : 12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'; ctx.fill();
    ctx.lineWidth = 3.5; ctx.strokeStyle = '#0b1210'; ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, activa ? 5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = ok ? '#0f766e' : '#b42318'; ctx.fill();
  });
  if (arrastre) dibujarLupa(ctx, e, pts[arrastre.indice], pts);
  $('#recorte-error').hidden = ok;
  $('#recorte-listo').disabled = !ok || trabajando;
}

/** Lupa en la esquina de arriba contraria al dedo */
function dibujarLupa(ctx, e, p, pts) {
  const cx = p.x < e.cw / 2 ? e.cw - LUPA - 14 : LUPA + 14;
  const cy = LUPA + 14;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, LUPA, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#000'; ctx.fillRect(cx - LUPA, cy - LUPA, LUPA * 2, LUPA * 2);
  const k = e.k * AUMENTO;
  const fx = (p.x - e.ox) / e.k, fy = (p.y - e.oy) / e.k; // punto en la foto
  ctx.drawImage(estado.fuente, cx - fx * k, cy - fy * k, e.W * k, e.H * k);
  // Los lados de la hoja también dentro de la lupa
  ctx.beginPath();
  pts.forEach((q, i) => {
    const x = cx + (q.x - p.x) * AUMENTO, y = cy + (q.y - p.y) * AUMENTO;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'; ctx.lineWidth = 4; ctx.stroke();
  ctx.strokeStyle = '#2dd4bf'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12); ctx.stroke();
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, LUPA, 0, Math.PI * 2);
  ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
}

function puntoDelEvento(ev) {
  const r = lienzo.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

lienzo.addEventListener('pointerdown', ev => {
  if (!estado || trabajando) return;
  const e = encaje(), t = puntoDelEvento(ev);
  let mejor = -1, dist = RADIO_TOQUE;
  estado.esquinas.forEach((p, i) => {
    const s = aPantalla(p, e), d = Math.hypot(s.x - t.x, s.y - t.y);
    if (d < dist) { dist = d; mejor = i; }
  });
  if (mejor < 0) return;
  const s = aPantalla(estado.esquinas[mejor], e);
  // Se guarda la distancia del dedo a la esquina para que no "salte" al tocar
  arrastre = { indice: mejor, id: ev.pointerId, dx: s.x - t.x, dy: s.y - t.y };
  lienzo.setPointerCapture(ev.pointerId);
  ev.preventDefault();
  dibujar();
});

lienzo.addEventListener('pointermove', ev => {
  if (!arrastre || ev.pointerId !== arrastre.id) return;
  const e = encaje(), t = puntoDelEvento(ev);
  const x = (t.x + arrastre.dx - e.ox) / (e.W * e.k), y = (t.y + arrastre.dy - e.oy) / (e.H * e.k);
  estado.esquinas[arrastre.indice] = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  dibujar();
});

const soltar = ev => {
  if (!arrastre || ev.pointerId !== arrastre.id) return;
  arrastre = null;
  dibujar();
};
lienzo.addEventListener('pointerup', soltar);
lienzo.addEventListener('pointercancel', soltar);

new ResizeObserver(() => { if (estado) dibujar(); }).observe(area);

export function iniciar() {
  $('#recorte-cancelar').addEventListener('click', () => {
    const cancelar = estado?.alCancelar;
    if (cancelar) cancelar(); else volver('');
  });
  $('#recorte-repetir').addEventListener('click', () => {
    const cancelar = estado?.alCancelar;
    if (cancelar) cancelar(); else volver('');
  });
  $('#recorte-todo').addEventListener('click', () => {
    if (!estado) return;
    estado.esquinas = TODA_LA_FOTO.map(p => ({ ...p }));
    dibujar();
  });
  $('#recorte-detectar').addEventListener('click', async () => {
    if (!estado) return;
    const esq = await buscarHoja(estado.fuente);
    if (!estado) return;
    if (esq) { estado.esquinas = esq; dibujar(); }
    else aviso('No encontré la hoja: acomoda las esquinas con el dedo.');
  });
  $('#recorte-listo').addEventListener('click', async () => {
    if (!estado || trabajando) return;
    trabajando = true;
    const boton = $('#recorte-listo');
    boton.disabled = true;
    const texto = boton.lastChild.textContent;
    boton.lastChild.textContent = 'Guardando…';
    try {
      await estado.alListo(estado.esquinas.map(p => ({ ...p })));
    } catch (e) {
      console.error(e);
      aviso('No se pudo guardar la página: ' + e.message, 'error');
      trabajando = false;
      dibujar();
    } finally {
      boton.lastChild.textContent = texto;
    }
  });
}
