import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paginaDeTexto, curvar } from './escenas.js';
import { aplanarPagina, medirCurvatura } from '../js/imagen/aplanar.js';
import { procesarPagina } from '../js/imagen/procesar.js';

/** Cuánta tinta hay (píxeles oscuros) */
function tinta({ data }) {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] < 120) n++;
  return n;
}

describe('Enderezar páginas curvas', () => {
  const plana = paginaDeTexto();
  const curva = curvar(plana, 45);

  it('una hoja plana no se toca', () => {
    const r = aplanarPagina(plana);
    assert.equal(r.aplanada, false);
    assert.equal(r.imagen, plana);
  });

  it('una hoja sin texto no se toca', () => {
    const blanca = { data: new Uint8ClampedArray(600 * 800 * 4).fill(235), width: 600, height: 800 };
    assert.equal(aplanarPagina(blanca).aplanada, false);
  });

  it('una hoja con la esquina levantada queda con los renglones rectos', () => {
    const m = medirCurvatura(curva);
    assert.ok(m && m.renglones >= 10, `renglones: ${m?.renglones}`);
    const r = aplanarPagina(curva);
    assert.equal(r.aplanada, true);
    assert.equal(r.imagen.width, curva.width); assert.equal(r.imagen.height, curva.height);
    // Después ya no se mide curva (menos de un quinto de renglón), y el texto sigue ahí
    const otra = medirCurvatura(r.imagen);
    assert.ok(!otra || otra.maximo < m.maximo * 0.3, `curva: ${m.maximo.toFixed(1)} px → ${otra?.maximo.toFixed(1)} px`);
    const t0 = tinta(curva), t1 = tinta(r.imagen);
    assert.ok(Math.abs(t1 - t0) < t0 * 0.1, `tinta ${t0} → ${t1}`);
  });

  it('se puede apagar por página', () => {
    const esquinas = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const con = procesarPagina(curva, { esquinas, filtro: 'original' });
    const sin = procesarPagina(curva, { esquinas, filtro: 'original', aplanar: false });
    assert.equal(con.aplanada, true);
    assert.equal(sin.aplanada, false);
  });
});
