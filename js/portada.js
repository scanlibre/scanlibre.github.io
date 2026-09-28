// ScanLibre · portada.js
// La portada de un trabajo: universidad, facultad o carrera, logo (si se
// pone uno), asignatura, sección, catedrático, tema, quién lo presenta, lugar
// y fecha, todo centrado como se entrega en la U. Se dibuja a 300 ppp en una
// hoja carta o A4 y guarda dónde quedó cada palabra: así el texto se puede
// buscar y copiar en el PDF, sin leerlo con el OCR.

import { HOJAS, PPP } from './cedula.js';

export const ESTILOS = {
  clasica: { texto: 'Clásica', detalle: 'Con serifa, como Times', fuente: '"Times New Roman", Times, "Liberation Serif", "Noto Serif", Georgia, serif' },
  moderna: { texto: 'Moderna', detalle: 'Sin serifa, como Arial', fuente: 'Arial, Helvetica, "Liberation Sans", Roboto, "Noto Sans", sans-serif' }
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** "28 de septiembre de 2026" */
export const fechaLarga = (d = new Date()) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;

const PT = 300 / 72; // px por punto, a 300 ppp

/** Parte un texto en renglones que caben en `ancho` px */
function partir(ctx, texto, ancho) {
  const out = [];
  for (const parrafo of String(texto).split('\n')) {
    let linea = '';
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      const prueba = linea ? `${linea} ${palabra}` : palabra;
      if (!linea || ctx.measureText(prueba).width <= ancho) linea = prueba;
      else { out.push(linea); linea = palabra; }
    }
    if (linea) out.push(linea);
  }
  return out;
}

/**
 * Lo que va en la portada, de arriba abajo: [{ trozos: [{ t, negrita }], tam (pt), antes (pt de espacio) }]
 * (el lugar y la fecha van aparte, abajo de todo).
 */
function contenido(c) {
  const b = [];
  const linea = (trozos, tam, antes = 0) => b.push({ trozos, tam, antes });
  if (c.universidad) linea([{ t: c.universidad, negrita: true }], 20);
  if (c.facultad) linea([{ t: c.facultad }], 15, 6);
  if (c.logo) b.push({ logo: true, antes: 22 });
  const datos = [['Asignatura', c.asignatura], ['Sección', c.seccion], ['Catedrático(a)', c.catedratico]].filter(([, v]) => v);
  datos.forEach(([k, v], i) => linea([{ t: `${k}: `, negrita: true }, { t: v }], 14, i ? 6 : 46));
  if (c.tema) {
    const [primera, ...resto] = String(c.tema).split('\n');
    linea([{ t: primera, negrita: true }], 22, 52);
    if (resto.length) linea([{ t: resto.join('\n') }], 15, 8);
  }
  const personas = String(c.integrantes || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (personas.length) {
    linea([{ t: personas.length > 1 ? 'Integrantes:' : 'Presentado por:', negrita: true }], 14, 52);
    personas.forEach(p => linea([{ t: p }], 14, 4));
  }
  return b;
}

/**
 * Dibuja la portada.
 * @param c { universidad, facultad, asignatura, seccion, catedratico, tema, integrantes, lugar, fecha, estilo, logo (imagen ya abierta o null) }
 * @returns { canvas, texto: { texto, lineas } }
 */
export function dibujarPortada(c, tamano = 'carta') {
  const [mw, mh] = HOJAS[tamano] || HOJAS.carta;
  const W = Math.round(mw * PPP), H = Math.round(mh * PPP);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#111';
  ctx.textBaseline = 'alphabetic';
  const fuente = (ESTILOS[c.estilo] || ESTILOS.clasica).fuente;
  const letra = (tam, negrita) => `${negrita ? 'bold ' : ''}${Math.round(tam * PT)}px ${fuente}`;
  const margen = 300, ancho = W - 2 * margen; // una pulgada a cada lado
  const pie = c.lugar || c.fecha ? [c.lugar, c.fecha].filter(Boolean).join(', ') : '';
  const bloques = contenido(c);

  // Se arma todo con una escala; si no cabe (muchos integrantes), se achica
  const armar = k => {
    const filas = [];
    let y = 330;
    for (const bl of bloques) {
      y += bl.antes * PT * k;
      if (bl.logo) {
        const lado = Math.min(1, (1.7 * 300 * k) / c.logo.height, (3 * 300 * k) / c.logo.width);
        filas.push({ logo: true, w: c.logo.width * lado, h: c.logo.height * lado, y });
        y += c.logo.height * lado;
        continue;
      }
      const tam = bl.tam * k;
      // Etiqueta y valor en el mismo renglón; si el valor es largo, sigue abajo
      ctx.font = letra(tam, true);
      const etiqueta = bl.trozos.length > 1 ? bl.trozos[0].t : '';
      const anchoEtiqueta = etiqueta ? ctx.measureText(etiqueta).width : 0;
      const principal = bl.trozos[bl.trozos.length - 1];
      ctx.font = letra(tam, principal.negrita);
      const renglones = partir(ctx, principal.t, ancho - anchoEtiqueta);
      renglones.forEach((r, i) => {
        y += tam * PT * (i ? 1.25 : 1);
        filas.push({ y, tam, trozos: i === 0 && etiqueta ? [{ t: etiqueta, negrita: true }, { t: r, negrita: principal.negrita }] : [{ t: r, negrita: principal.negrita }] });
      });
      y += tam * PT * 0.25;
    }
    return { filas, fin: y };
  };
  let k = 1, plan = armar(k);
  const limite = H - 300 - 60 * PT; // lo que queda arriba del lugar y la fecha
  while (plan.fin > limite && k > 0.55) { k -= 0.05; plan = armar(k); }

  const lineas = [], textos = [];
  const escribir = (trozos, tam, y) => {
    let total = 0;
    const medidas = trozos.map(tr => { ctx.font = letra(tam, tr.negrita); const w = ctx.measureText(tr.t).width; total += w; return w; });
    let x = (W - total) / 2;
    const palabras = [];
    trozos.forEach((tr, i) => {
      ctx.font = letra(tam, tr.negrita);
      ctx.fillText(tr.t, x, y);
      // Dónde quedó cada palabra (para el texto buscable)
      for (const m of tr.t.matchAll(/\S+/g)) {
        const x0 = x + ctx.measureText(tr.t.slice(0, m.index)).width;
        palabras.push({ t: m[0], x0: Math.round(x0), y0: Math.round(y - tam * PT * 0.8), x1: Math.round(x0 + ctx.measureText(m[0]).width), y1: Math.round(y + tam * PT * 0.22) });
      }
      x += medidas[i];
    });
    if (palabras.length) {
      lineas.push({ y0: Math.min(...palabras.map(p => p.y0)), y1: Math.max(...palabras.map(p => p.y1)), base: [palabras[0].x0, Math.round(y), palabras[palabras.length - 1].x1, Math.round(y)], palabras });
      textos.push(trozos.map(t => t.t).join(''));
    }
  };
  for (const f of plan.filas) {
    if (f.logo) { ctx.drawImage(c.logo, (W - f.w) / 2, f.y, f.w, f.h); continue; }
    escribir(f.trozos, f.tam, f.y);
  }
  if (pie) {
    ctx.font = letra(14 * k, false);
    const renglones = partir(ctx, pie, ancho);
    renglones.forEach((r, i) => escribir([{ t: r }], 14 * k, H - 300 - (renglones.length - 1 - i) * 14 * k * PT * 1.25));
  }
  return { canvas, texto: { texto: textos.join('\n'), lineas } };
}
