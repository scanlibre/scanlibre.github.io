// ScanLibre · visorZoom.js
// Acercar la página para revisar el detalle: pellizcar con dos dedos, doble
// toque para acercar/alejar, y arrastrar con un dedo cuando está acercada.
// Trabaja moviendo y escalando el elemento (transform), sin tocar la imagen.

const MAX = 5, DOBLE = 2.5;

/**
 * @param contenedor el marco donde va la imagen (su tamaño limita el encuadre)
 * @param objetivo   el elemento que se acerca (la imagen de la página)
 * @returns { reset, acercada }
 */
export function crearZoom(contenedor, objetivo) {
  let escala = 1, x = 0, y = 0;
  const punteros = new Map();
  let gesto = null;              // { s0, x0, y0, d0, px, py } mientras se pellizca o arrastra
  let ultimoToque = 0, toquePos = null;

  const centro = () => { const r = contenedor.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
  const topes = () => {
    // Tamaño real de la imagen en pantalla (va "contain": entra entera, con bordes)
    const bw = objetivo.clientWidth, bh = objetivo.clientHeight;
    const nw = objetivo.naturalWidth || bw, nh = objetivo.naturalHeight || bh;
    const k = Math.min(bw / nw, bh / nh) || 1;
    const w = nw * k * escala, h = nh * k * escala;
    // Cuánto se puede correr sin que la imagen se despegue del borde
    return { mx: Math.max(0, (w - contenedor.clientWidth) / 2 + 8), my: Math.max(0, (h - contenedor.clientHeight) / 2 + 8) };
  };
  function aplicar() {
    if (escala <= 1.001) { escala = 1; x = y = 0; }
    const { mx, my } = topes();
    x = Math.max(-mx, Math.min(mx, x));
    y = Math.max(-my, Math.min(my, y));
    objetivo.style.transform = escala === 1 ? '' : `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${escala.toFixed(3)})`;
    contenedor.classList.toggle('acercada', escala > 1);
  }
  function reset() { escala = 1; x = 0; y = 0; gesto = null; punteros.clear(); aplicar(); }

  // Pone bajo (px, py) el mismo punto del contenido que estaba antes ahí, a la escala nueva
  function haciaPunto(nuevaEscala, px, py, desde) {
    nuevaEscala = Math.max(1, Math.min(MAX, nuevaEscala));
    const cx = (px - desde.x0) / desde.s0, cy = (py - desde.y0) / desde.s0;
    escala = nuevaEscala; x = px - cx * escala; y = py - cy * escala;
    aplicar();
  }

  const relativo = e => { const { cx, cy } = centro(); return { px: e.clientX - cx, py: e.clientY - cy }; };

  contenedor.addEventListener('pointerdown', e => {
    punteros.set(e.pointerId, e);
    try { contenedor.setPointerCapture(e.pointerId); } catch (err) {}
    if (punteros.size === 2) {
      const [a, b] = [...punteros.values()], { cx, cy } = centro();
      gesto = { s0: escala, x0: x, y0: y, d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
        px: (a.clientX + b.clientX) / 2 - cx, py: (a.clientY + b.clientY) / 2 - cy };
    } else if (punteros.size === 1 && escala > 1) {
      const { px, py } = relativo(e);
      gesto = { s0: escala, x0: x, y0: y, arrastre: true, ix: px - x, iy: py - y };
    }
  });

  contenedor.addEventListener('pointermove', e => {
    if (!punteros.has(e.pointerId)) return;
    punteros.set(e.pointerId, e);
    if (punteros.size >= 2 && gesto && !gesto.arrastre) {
      const [a, b] = [...punteros.values()], { cx, cy } = centro();
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
      const px = (a.clientX + b.clientX) / 2 - cx, py = (a.clientY + b.clientY) / 2 - cy;
      haciaPunto(gesto.s0 * (d / gesto.d0), px, py, gesto);
      e.preventDefault();
    } else if (gesto?.arrastre && punteros.size === 1) {
      const { px, py } = relativo(e);
      x = px - gesto.ix; y = py - gesto.iy; aplicar();
      e.preventDefault();
    }
  });

  function soltar(e) {
    const movido = gesto && !gesto.arrastre; // venía de un pellizco
    punteros.delete(e.pointerId);
    try { contenedor.releasePointerCapture(e.pointerId); } catch (err) {}
    if (punteros.size < 2) gesto = punteros.size === 1 && escala > 1
      ? (() => { const { px, py } = relativo([...punteros.values()][0]); return { s0: escala, x0: x, y0: y, arrastre: true, ix: px - x, iy: py - y }; })()
      : null;
    // Doble toque: acercar donde se tocó, o volver a 1×
    if (!movido && e.pointerType !== 'mouse2' && punteros.size === 0) {
      const ahora = Date.now(), { px, py } = relativo(e);
      const cerca = toquePos && Math.hypot(px - toquePos.px, py - toquePos.py) < 40;
      if (ahora - ultimoToque < 350 && cerca) {
        if (escala > 1) reset();
        else haciaPunto(DOBLE, px, py, { s0: 1, x0: 0, y0: 0 });
        ultimoToque = 0;
      } else { ultimoToque = ahora; toquePos = { px, py }; }
    }
  }
  contenedor.addEventListener('pointerup', soltar);
  contenedor.addEventListener('pointercancel', e => { punteros.delete(e.pointerId); gesto = null; });

  return { reset, acercada: () => escala > 1 };
}
