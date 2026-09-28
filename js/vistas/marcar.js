// ScanLibre · vistas/marcar.js
// Marcar la página: resaltador, lápiz, notas y firma. Con un dedo se marca;
// con dos se acerca y se mueve la página (en la computadora, con la rueda).
// Las notas y las firmas se arrastran, se agrandan desde la esquina y se
// quitan con la ×. Todo se puede deshacer, y nada cambia hasta tocar "Listo".

import { $, el, icono, aviso, confirmar, hoja } from '../util.js';
import { obtenerDocumento, obtenerPagina } from '../db.js';
import { ir, volver } from '../rutas.js';
import { abrirFoto, aCanvas, soltarCanvas } from '../fotos.js';
import { guardarMarcas } from '../paginas.js';
import { ajustes, cambiarAjuste } from '../ajustes.js';
import {
  RESALTADORES, LAPICES, GROSOR, TAM_NOTA, dibujarMarcas, caja, marcaEn, enderezarTrazo, mapaDeGris, normalizarFirma
} from '../marcas.js';

const area = $('#marcar-area');
const lienzo = $('#marcar-lienzo');
const MARGEN = 16, MANIJA = 15, ZOOM_MAX = 8;
const NOMBRES = { amarillo: 'Amarillo', verde: 'Verde', rosado: 'Rosado', celeste: 'Celeste', azul: 'Azul', rojo: 'Rojo', negro: 'Negro' };
const PISTAS = {
  resaltador: 'Pasa el dedo sobre el texto. Con dos dedos acercas la página.',
  lapiz: 'Escribe o subraya con el dedo. Con dos dedos acercas la página.',
  borrador: 'Toca o pasa el dedo por lo que quieras quitar.'
};

let doc = null, pagina = null, n = 1;
let fondo = null, mapa = null, W = 1, H = 1;
let marcas = [], historial = [], cambios = false;
let herramienta = 'resaltador';
const color = { resaltador: 'amarillo', lapiz: 'azul' };
let vista = null;      // { z, ox, oy }: en pantalla = o + (px de la página) × z
let elegida = -1;      // la nota o firma elegida (se ve con sus manijas)
let gesto = null;      // lo que está haciendo el dedo
let guardando = false, pendiente = false;
const punteros = new Map();

const rutaPagina = () => ['doc', encodeURIComponent(doc.id), 'pagina', n].join('/');

export async function mostrar(params) {
  doc = await obtenerDocumento(params.doc);
  if (!doc || !doc.paginas.length) return ir('', { reemplazar: true });
  n = Math.min(params.n, doc.paginas.length);
  pagina = await obtenerPagina(doc.paginas[n - 1]);
  const bmp = await abrirFoto(pagina.procesada);
  soltarFondo();
  fondo = aCanvas(bmp, 2400);
  bmp.close?.();
  mapa = mapaDeGris(fondo);
  W = pagina.procAncho || fondo.width; H = pagina.procAlto || fondo.height;
  marcas = JSON.parse(JSON.stringify(pagina.marcas || []));
  historial = []; cambios = false; elegida = -1; gesto = null; guardando = false;
  punteros.clear();
  vista = null;
  // Se sigue con el resaltador o el lápiz de la vez pasada, pero nunca con el borrador
  if (herramienta === 'borrador') herramienta = 'resaltador';
  pintarHerramientas();
  pista(PISTAS[herramienta]);
  dibujar();
  area.dataset.listo = '';
}

export function ocultar() {
  delete area.dataset.listo;
  soltarFondo();
  mapa = null; pagina = null; gesto = null;
  punteros.clear();
}

function soltarFondo() {
  soltarCanvas(fondo);
  fondo = null;
}

// ── Vista: encaje, zoom y movimiento ────────────────────────────────
function encajar() {
  const cw = area.clientWidth, ch = area.clientHeight;
  const z = Math.min((cw - 2 * MARGEN) / W, (ch - 2 * MARGEN) / H);
  return { z, ox: (cw - W * z) / 2, oy: (ch - H * z) / 2 };
}

/** La página no se escapa de la pantalla, y más chica que el encaje no se puede */
function limitar(v) {
  const cw = area.clientWidth, ch = area.clientHeight, base = encajar();
  const z = Math.min(base.z * ZOOM_MAX, Math.max(base.z, v.z));
  const eje = (o, lado, pantalla) => lado + 2 * MARGEN <= pantalla
    ? (pantalla - lado) / 2
    : Math.min(MARGEN, Math.max(pantalla - lado - MARGEN, o));
  return { z, ox: eje(v.ox, W * z, cw), oy: eje(v.oy, H * z, ch) };
}

const aPagina = p => ({ x: (p.x - vista.ox) / vista.z, y: (p.y - vista.oy) / vista.z });
const aPantalla = (x, y) => ({ x: vista.ox + x * vista.z, y: vista.oy + y * vista.z });

function puntoDe(ev) {
  const r = lienzo.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

// ── Dibujo ──────────────────────────────────────────────────────────
let cuadro = 0;
const redibujar = () => { if (!cuadro) cuadro = requestAnimationFrame(() => { cuadro = 0; dibujar(); }); };

function dibujar() {
  if (!fondo) return;
  const cw = area.clientWidth, ch = area.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!vista) vista = encajar();
  if (lienzo.width !== Math.round(cw * dpr) || lienzo.height !== Math.round(ch * dpr)) {
    lienzo.width = Math.round(cw * dpr); lienzo.height = Math.round(ch * dpr);
    vista = limitar(vista);
  }
  const ctx = lienzo.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.save();
  ctx.translate(vista.ox, vista.oy);
  ctx.scale(vista.z, vista.z);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fondo, 0, 0, W, H);
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  dibujarMarcas(ctx, marcas, W, H);
  if (gesto?.tipo === 'trazo') dibujarMarcas(ctx, [gesto.trazo], W, H);
  ctx.restore();
  if (elegida >= 0 && marcas[elegida]) dibujarManijas(ctx, cajaEnPantalla(ctx, marcas[elegida]));
}

function cajaEnPantalla(ctx, m) {
  const b = caja(ctx, m, W, H), a = aPantalla(b.x, b.y);
  return { x: a.x - 6, y: a.y - 6, w: b.w * vista.z + 12, h: b.h * vista.z + 12 };
}

const manijas = b => ({ quitar: { x: b.x + b.w, y: b.y }, tamano: { x: b.x + b.w, y: b.y + b.h } });

function dibujarManijas(ctx, b) {
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#0f766e';
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  const { quitar, tamano } = manijas(b);
  for (const [p, fondoManija] of [[quitar, '#b42318'], [tamano, '#0f766e']]) {
    ctx.beginPath(); ctx.arc(p.x, p.y, MANIJA, 0, Math.PI * 2);
    ctx.fillStyle = fondoManija; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(quitar.x - 5, quitar.y - 5); ctx.lineTo(quitar.x + 5, quitar.y + 5);
  ctx.moveTo(quitar.x + 5, quitar.y - 5); ctx.lineTo(quitar.x - 5, quitar.y + 5);
  // Flecha doble de agrandar
  ctx.moveTo(tamano.x - 6, tamano.y - 6); ctx.lineTo(tamano.x + 6, tamano.y + 6);
  ctx.moveTo(tamano.x + 6, tamano.y + 1); ctx.lineTo(tamano.x + 6, tamano.y + 6); ctx.lineTo(tamano.x + 1, tamano.y + 6);
  ctx.moveTo(tamano.x - 6, tamano.y - 1); ctx.lineTo(tamano.x - 6, tamano.y - 6); ctx.lineTo(tamano.x - 1, tamano.y - 6);
  ctx.stroke();
  ctx.restore();
}

// ── Cambios y deshacer ──────────────────────────────────────────────
function anotar(antes = JSON.stringify(marcas)) {
  historial.push(antes);
  if (historial.length > 60) historial.shift();
  cambios = true;
  $('#marcar-deshacer').disabled = false;
}

function deshacer() {
  if (!historial.length) return;
  marcas = JSON.parse(historial.pop());
  elegida = -1;
  $('#marcar-deshacer').disabled = !historial.length;
  dibujar();
}

// ── Toques ──────────────────────────────────────────────────────────
const esObjeto = m => m.tipo === 'nota' || m.tipo === 'firma';

function empezar(p) {
  const ctx = lienzo.getContext('2d');
  const q = aPagina(p);
  // Las manijas de la nota o firma elegida
  if (elegida >= 0 && marcas[elegida]) {
    const b = cajaEnPantalla(ctx, marcas[elegida]), h = manijas(b);
    if (Math.hypot(p.x - h.quitar.x, p.y - h.quitar.y) <= MANIJA + 8) {
      anotar();
      marcas.splice(elegida, 1);
      elegida = -1;
      gesto = { tipo: 'nada' };
      return dibujar();
    }
    if (Math.hypot(p.x - h.tamano.x, p.y - h.tamano.y) <= MANIJA + 8) {
      const m = marcas[elegida], c = aPantalla(m.x * W, m.y * H);
      gesto = { tipo: 'tamano', k: elegida, antes: JSON.stringify(marcas), c, d0: Math.max(10, Math.hypot(p.x - c.x, p.y - c.y)), m0: { ...m } };
      return;
    }
  }
  const tolerancia = 10 / vista.z;
  if (herramienta === 'borrador') {
    gesto = { tipo: 'borrar', antes: JSON.stringify(marcas), borro: false };
    borrarEn(q, tolerancia);
    return;
  }
  // Una nota o una firma: se arrastra (y si ya estaba elegida y no se mueve, se edita)
  let k = marcas.length - 1;
  while (k >= 0 && !(esObjeto(marcas[k]) && marcaEn(ctx, [marcas[k]], q.x, q.y, W, H, tolerancia) === 0)) k--;
  if (k >= 0) {
    const m = marcas[k];
    gesto = { tipo: 'mover', k, antes: JSON.stringify(marcas), desde: q, x0: m.x, y0: m.y, movio: false, yaElegida: k === elegida, p0: p };
    elegida = k;
    return dibujar();
  }
  // Tocar afuera suelta la nota o firma elegida (sin dibujar un punto)
  if (elegida >= 0) { elegida = -1; gesto = { tipo: 'nada' }; return dibujar(); }
  const tipo = herramienta;
  gesto = {
    tipo: 'trazo',
    trazo: { tipo, color: (tipo === 'resaltador' ? RESALTADORES : LAPICES)[color[tipo]], grosor: GROSOR[tipo], puntos: [q.x / W, q.y / H] },
    ultimo: p
  };
  redibujar();
}

function seguir(p) {
  if (!gesto) return;
  const q = aPagina(p);
  if (gesto.tipo === 'trazo') {
    if (Math.hypot(p.x - gesto.ultimo.x, p.y - gesto.ultimo.y) < 2) return;
    gesto.ultimo = p;
    gesto.trazo.puntos.push(Math.max(0, Math.min(1, q.x / W)), Math.max(0, Math.min(1, q.y / H)));
    redibujar();
  } else if (gesto.tipo === 'mover') {
    if (Math.hypot(p.x - gesto.p0.x, p.y - gesto.p0.y) > 6) gesto.movio = true;
    if (!gesto.movio) return;
    const m = marcas[gesto.k];
    m.x = Math.max(0, Math.min(1, gesto.x0 + (q.x - gesto.desde.x) / W));
    m.y = Math.max(0, Math.min(1, gesto.y0 + (q.y - gesto.desde.y) / H));
    redibujar();
  } else if (gesto.tipo === 'tamano') {
    const s = Math.hypot(p.x - gesto.c.x, p.y - gesto.c.y) / gesto.d0;
    const m = marcas[gesto.k];
    if (m.tipo === 'firma') m.ancho = Math.max(0.05, Math.min(1, gesto.m0.ancho * s));
    else m.tam = Math.max(0.01, Math.min(0.1, gesto.m0.tam * s));
    gesto.cambio = true;
    redibujar();
  } else if (gesto.tipo === 'borrar') {
    borrarEn(q, 10 / vista.z);
  }
}

function borrarEn(q, tolerancia) {
  const k = marcaEn(lienzo.getContext('2d'), marcas, q.x, q.y, W, H, tolerancia);
  if (k < 0) return;
  if (!gesto.borro) { anotar(gesto.antes); gesto.borro = true; }
  marcas.splice(k, 1);
  elegida = -1;
  redibujar();
}

function terminar() {
  const g = gesto;
  gesto = null;
  if (!g) return;
  if (g.tipo === 'trazo') {
    let t = g.trazo;
    // Un toque con el resaltador no deja nada (tocar la pantalla no debería manchar)
    if (t.tipo === 'resaltador' && t.puntos.length < 4) return dibujar();
    if (t.tipo === 'resaltador') {
      const recto = enderezarTrazo(t.puntos, t.grosor, W, H, mapa);
      if (recto) t = { ...t, ...recto };
    }
    anotar();
    marcas.push(t);
    ocultarPista();
  } else if (g.tipo === 'mover') {
    if (g.movio) anotar(g.antes);
    else if (g.yaElegida && marcas[g.k]?.tipo === 'nota') editarNota(g.k);
  } else if (g.tipo === 'tamano' && g.cambio) {
    anotar(g.antes);
  }
  dibujar();
}

lienzo.addEventListener('pointerdown', ev => {
  if (!fondo) return;
  try { lienzo.setPointerCapture(ev.pointerId); } catch (e) {}
  punteros.set(ev.pointerId, puntoDe(ev));
  ev.preventDefault();
  if (punteros.size === 2) {
    // El segundo dedo: lo que hacía el primero se cancela y empieza el zoom
    if (gesto?.tipo === 'mover' && gesto.movio) { marcas = JSON.parse(gesto.antes); }
    if (gesto?.tipo === 'tamano' && gesto.cambio) { marcas = JSON.parse(gesto.antes); }
    const [a, b] = [...punteros.values()];
    gesto = { tipo: 'zoom', v0: { ...vista }, d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    redibujar();
  } else if (punteros.size === 1) {
    empezar(punteros.get(ev.pointerId));
  }
});

lienzo.addEventListener('pointermove', ev => {
  if (!punteros.has(ev.pointerId)) return;
  punteros.set(ev.pointerId, puntoDe(ev));
  if (gesto?.tipo === 'zoom') {
    if (punteros.size < 2) return;
    const [a, b] = [...punteros.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const { v0, d0, m0 } = gesto;
    const z = v0.z * d / d0;
    // El punto de la página que estaba entre los dedos sigue entre los dedos
    const px = (m0.x - v0.ox) / v0.z, py = (m0.y - v0.oy) / v0.z;
    vista = limitar({ z, ox: m.x - px * z, oy: m.y - py * z });
    redibujar();
  } else if (punteros.size === 1) {
    seguir(punteros.get(ev.pointerId));
  }
});

function soltar(ev) {
  if (!punteros.has(ev.pointerId)) return;
  punteros.delete(ev.pointerId);
  if (gesto?.tipo === 'zoom') {
    // Hasta levantar todos los dedos no se dibuja nada más
    if (!punteros.size) gesto = null;
    return;
  }
  if (ev.type === 'pointercancel' && gesto?.tipo === 'trazo') { gesto = null; return dibujar(); }
  if (!punteros.size) terminar();
}
lienzo.addEventListener('pointerup', soltar);
lienzo.addEventListener('pointercancel', soltar);

// La rueda del mouse (o el gesto del trackpad) acerca y aleja
lienzo.addEventListener('wheel', ev => {
  if (!fondo) return;
  ev.preventDefault();
  const p = puntoDe(ev), f = Math.exp(-ev.deltaY * 0.0015);
  const px = (p.x - vista.ox) / vista.z, py = (p.y - vista.oy) / vista.z, z = vista.z * f;
  vista = limitar({ z, ox: p.x - px * z, oy: p.y - py * z });
  redibujar();
}, { passive: false });

new ResizeObserver(() => { if (fondo) { vista = vista && limitar(vista); dibujar(); } }).observe(area);

// ── Herramientas ────────────────────────────────────────────────────
function pintarHerramientas() {
  for (const t of ['resaltador', 'lapiz', 'borrador']) $(`#marcar-${t}`).setAttribute('aria-pressed', String(herramienta === t));
  const fila = $('#marcar-colores');
  if (herramienta === 'borrador') {
    fila.replaceChildren(el('p', { class: 'marcar-ayuda', text: 'Las notas y la firma también se quitan con su ×.' }));
    return;
  }
  const colores = herramienta === 'resaltador' ? RESALTADORES : LAPICES;
  fila.replaceChildren(...Object.entries(colores).map(([nombre, valor]) => {
    const b = el('button', { class: 'color', 'aria-label': NOMBRES[nombre], 'aria-pressed': String(color[herramienta] === nombre), 'data-color': nombre, onclick: () => {
      color[herramienta] = nombre;
      pintarHerramientas();
    } });
    b.style.background = valor;
    return b;
  }));
}

function elegirHerramienta(t) {
  herramienta = t;
  elegida = -1;
  pintarHerramientas();
  pista(PISTAS[t]);
  dibujar();
}

let relojPista = 0;
function pista(texto, ms = 4500) {
  const p = $('#marcar-pista');
  p.textContent = texto;
  p.classList.remove('oculta');
  clearTimeout(relojPista);
  relojPista = setTimeout(ocultarPista, ms);
}
const ocultarPista = () => $('#marcar-pista').classList.add('oculta');

/** Un punto de lo que se ve de la página (px de la página): el centro, o más abajo con `alto` */
function centroVisible(alto = 0.5) {
  const c = aPagina({ x: area.clientWidth / 2, y: area.clientHeight * alto });
  return { x: Math.max(0.1 * W, Math.min(0.9 * W, c.x)), y: Math.max(0.1 * H, Math.min(0.9 * H, c.y)) };
}

// ── Notas ───────────────────────────────────────────────────────────
/** Hoja para escribir la nota. Devuelve { texto }, { quitar: true } o undefined */
function pedirNota(valor = '', { editando = false } = {}) {
  return hoja(cerrar => {
    const campo = el('textarea', { class: 'campo campo-nota', rows: 4, maxlength: 500, 'aria-label': 'Texto de la nota', placeholder: 'Por ejemplo: esto viene en el examen' });
    campo.value = valor;
    const listo = () => { const t = campo.value.trim(); if (t) cerrar({ texto: t }); else campo.focus(); };
    setTimeout(() => campo.focus(), 50);
    return [
      el('h2', { class: 'hoja-titulo', text: editando ? 'Cambiar la nota' : 'Nota' }),
      campo,
      el('div', { class: 'hoja-botones' },
        editando
          ? el('button', { class: 'boton boton-secundario peligro-texto', onclick: () => cerrar({ quitar: true }) }, icono('basura'), 'Quitar')
          : el('button', { class: 'boton boton-secundario', onclick: () => cerrar(undefined) }, 'Cancelar'),
        el('button', { class: 'boton boton-primario', onclick: listo }, icono('listo'), editando ? 'Guardar' : 'Poner'))
    ];
  });
}

async function nuevaNota() {
  const r = await pedirNota();
  if (!r?.texto || !fondo) return;
  const c = centroVisible();
  anotar();
  marcas.push({ tipo: 'nota', x: c.x / W, y: c.y / H, texto: r.texto, tam: TAM_NOTA });
  elegida = marcas.length - 1;
  pista('Arrastra la nota a su lugar. Tócala otra vez para cambiar el texto.', 6000);
  dibujar();
}

async function editarNota(k) {
  const r = await pedirNota(marcas[k].texto, { editando: true });
  if (!r || !marcas[k]) return;
  anotar();
  if (r.quitar) { marcas.splice(k, 1); elegida = -1; }
  else marcas[k] = { ...marcas[k], texto: r.texto };
  dibujar();
}

// ── Firma ───────────────────────────────────────────────────────────
/** Dibuja una firma guardada en un canvas chico, para elegirla */
function muestraDeFirma(f, ancho = 150) {
  const c = el('canvas', { class: 'firma-muestra', 'aria-hidden': 'true' });
  const alto = Math.round(Math.min(90, Math.max(30, ancho * f.aspecto)));
  const w = Math.min(ancho, alto / f.aspecto), dpr = window.devicePixelRatio || 1;
  c.width = Math.round(ancho * dpr); c.height = Math.round(alto * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  dibujarMarcas(ctx, [{ tipo: 'firma', ...f, x: 0.5, y: 0.5, ancho: w / ancho }], ancho, alto);
  return c;
}

/** Hoja para dibujar una firma nueva con el dedo. Devuelve la firma o undefined */
function dibujarFirma() {
  return hoja(cerrar => {
    const pad = el('canvas', { class: 'firma-pad', 'aria-label': 'Firma aquí con el dedo' });
    let trazos = [], actual = null, tinta = LAPICES.azul;
    const grosor = 3;
    const pintar = () => {
      const r = pad.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (pad.width !== Math.round(r.width * dpr)) { pad.width = Math.round(r.width * dpr); pad.height = Math.round(r.height * dpr); }
      const ctx = pad.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      // La raya donde se firma
      ctx.strokeStyle = '#c9d3d0'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(20, r.height * 0.72); ctx.lineTo(r.width - 20, r.height * 0.72); ctx.stroke();
      ctx.strokeStyle = tinta; ctx.lineWidth = grosor; ctx.lineCap = ctx.lineJoin = 'round';
      for (const t of trazos) {
        ctx.beginPath();
        ctx.moveTo(t[0], t[1]);
        if (t.length === 2) ctx.lineTo(t[0] + 0.01, t[1]);
        for (let i = 2; i < t.length; i += 2) ctx.lineTo(t[i], t[i + 1]);
        ctx.stroke();
      }
      usar.disabled = !trazos.length;
    };
    const punto = ev => { const r = pad.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    pad.addEventListener('pointerdown', ev => { ev.preventDefault(); pad.setPointerCapture(ev.pointerId); actual = punto(ev); trazos.push(actual); pintar(); });
    pad.addEventListener('pointermove', ev => { if (!actual) return; actual.push(...punto(ev)); pintar(); });
    const fin = () => { actual = null; };
    pad.addEventListener('pointerup', fin);
    pad.addEventListener('pointercancel', fin);
    const tintas = Object.entries({ azul: LAPICES.azul, negro: LAPICES.negro }).map(([nombre, valor]) => {
      const b = el('button', { class: 'color', 'aria-label': `Tinta ${NOMBRES[nombre].toLowerCase()}`, 'aria-pressed': String(valor === tinta), onclick: () => {
        tinta = valor;
        tintas.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        pintar();
      } });
      b.style.background = valor;
      return b;
    });
    const usar = el('button', { class: 'boton boton-primario', disabled: true, onclick: () => {
      const f = normalizarFirma(trazos, grosor);
      if (!f) return aviso('La firma está vacía.');
      cerrar({ ...f, color: tinta, id: Date.now().toString(36) });
    } }, icono('listo'), 'Usar firma');
    setTimeout(pintar, 30);
    return [
      el('h2', { class: 'hoja-titulo', text: 'Tu firma' }),
      el('p', { class: 'hoja-detalle', text: 'Fírmate con el dedo. Queda guardada en este teléfono para las próximas veces.' }),
      pad,
      el('div', { class: 'firma-opciones' }, el('div', { class: 'firma-tintas' }, tintas),
        el('button', { class: 'boton boton-fantasma', onclick: () => { trazos = []; pintar(); } }, 'Borrar')),
      el('div', { class: 'hoja-botones' },
        el('button', { class: 'boton boton-secundario', onclick: () => cerrar(undefined) }, 'Cancelar'),
        usar)
    ];
  });
}

/** Elegir una firma guardada o dibujar otra */
async function elegirFirma() {
  let guardadas = ajustes().firmas || [];
  if (!guardadas.length) return dibujarFirma();
  const opcion = await hoja(cerrar => {
    const lista = el('div', { class: 'firmas-guardadas' }, guardadas.map(f =>
      el('div', { class: 'firma-guardada' },
        el('button', { class: 'firma-elegir', 'aria-label': 'Usar esta firma', onclick: () => cerrar({ firma: f }) }, muestraDeFirma(f)),
        el('button', { class: 'boton-icono firma-quitar', 'aria-label': 'Borrar esta firma del teléfono', onclick: () => cerrar({ quitar: f.id }) }, icono('cerrar')))));
    return [
      el('h2', { class: 'hoja-titulo', text: 'Firma' }),
      el('p', { class: 'hoja-detalle', text: 'Toca la firma que quieres poner.' }),
      lista,
      el('div', { class: 'hoja-botones' },
        el('button', { class: 'boton boton-secundario', onclick: () => cerrar({ nueva: true }) }, icono('firma'), 'Firmar de nuevo'))
    ];
  });
  if (opcion?.firma) return opcion.firma;
  if (opcion?.nueva) return dibujarFirma();
  if (opcion?.quitar) {
    const si = await confirmar('¿Borrar esta firma del teléfono?', { detalle: 'Las páginas que ya firmaste no cambian.', aceptar: 'Borrar', peligro: true });
    if (si) cambiarAjuste('firmas', guardadas.filter(f => f.id !== opcion.quitar));
    return elegirFirma();
  }
  return undefined;
}

async function ponerFirma() {
  const f = await elegirFirma();
  if (!f || !fondo) return;
  // Las firmas nuevas quedan guardadas (las 3 últimas)
  const guardadas = (ajustes().firmas || []).filter(g => g.id !== f.id);
  cambiarAjuste('firmas', [f, ...guardadas].slice(0, 3));
  // Las firmas van casi siempre abajo
  const c = centroVisible(0.75);
  const ancho = Math.min(0.34, 0.5 * H / W / Math.max(0.2, f.aspecto));
  anotar();
  marcas.push({ tipo: 'firma', x: c.x / W, y: c.y / H, ancho, aspecto: f.aspecto, color: f.color, grosor: f.grosor, trazos: f.trazos });
  elegida = marcas.length - 1;
  pista('Arrastra la firma a su lugar y agrándala desde la esquina.', 6000);
  dibujar();
}

// ── Guardar o salir ─────────────────────────────────────────────────
async function listo() {
  if (guardando) return;
  if (!cambios) return volver(rutaPagina());
  guardando = true;
  const boton = $('#marcar-listo');
  boton.disabled = true;
  try {
    await guardarMarcas(pagina, marcas);
    cambios = false;
    aviso(marcas.length ? 'Marcas guardadas.' : 'Se quitaron las marcas.', 'exito');
    volver(rutaPagina());
  } catch (e) {
    console.error(e);
    aviso('No se pudieron guardar las marcas: ' + e.message, 'error');
  } finally {
    guardando = false;
    boton.disabled = false;
  }
}

async function cancelar() {
  if (cambios) {
    const si = await confirmar('¿Salir sin guardar?', { detalle: 'Lo que marcaste en esta página se pierde.', aceptar: 'Salir sin guardar', peligro: true });
    if (!si) return;
    cambios = false;
  }
  volver(rutaPagina());
}

export function iniciar() {
  $('#marcar-cancelar').addEventListener('click', cancelar);
  $('#marcar-listo').addEventListener('click', listo);
  $('#marcar-deshacer').addEventListener('click', deshacer);
  $('#marcar-resaltador').addEventListener('click', () => elegirHerramienta('resaltador'));
  $('#marcar-lapiz').addEventListener('click', () => elegirHerramienta('lapiz'));
  $('#marcar-borrador').addEventListener('click', () => elegirHerramienta('borrador'));
  $('#marcar-nota').addEventListener('click', nuevaNota);
  $('#marcar-firma').addEventListener('click', ponerFirma);
}
