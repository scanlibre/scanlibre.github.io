// ScanLibre · buscar.js
// Buscar palabras en los nombres y en el texto leído de las páginas. No
// importan las tildes ni las mayúsculas ("calculo" encuentra "Cálculo"), y con
// varias palabras tienen que estar todas.

/**
 * Texto sin tildes y en minúsculas, y de qué letra del original sale cada una
 * (para mostrar el pedazo del texto original donde se encontró).
 */
export function normalizar(texto) {
  let norm = '';
  const origen = [];
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const _ of c) origen.push(i);
    norm += c;
  }
  return { norm, origen };
}

/** Las palabras que se buscan (sin tildes, en minúsculas) */
export const terminos = consulta => normalizar(consulta.trim()).norm.split(/\s+/).filter(Boolean);

/**
 * ¿Están todas las palabras? Devuelve dónde aparece la primera en el texto
 * original ({ inicio, fin }) o null.
 */
export function buscarEn(texto, palabras) {
  if (!texto || !palabras.length) return null;
  const { norm, origen } = normalizar(texto);
  let primera = null;
  for (const p of palabras) {
    const i = norm.indexOf(p);
    if (i < 0) return null;
    if (!primera) primera = { inicio: origen[i], fin: origen[i + p.length - 1] + 1 };
  }
  return primera;
}

/**
 * Un pedazo del texto alrededor de lo encontrado, en un solo renglón:
 * { antes, marca, despues } (con "…" si se corta).
 */
export function fragmento(texto, { inicio, fin }, alrededor = 45) {
  const plano = s => s.replace(/\s+/g, ' ');
  let a = Math.max(0, inicio - alrededor), b = Math.min(texto.length, fin + alrededor);
  // Que no corte palabras a la mitad
  while (a > 0 && /\S/.test(texto[a - 1]) && inicio - a < alrededor + 15) a--;
  while (b < texto.length && /\S/.test(texto[b]) && b - fin < alrededor + 15) b++;
  return {
    antes: (a > 0 ? '…' : '') + plano(texto.slice(a, inicio)).trimStart(),
    marca: plano(texto.slice(inicio, fin)),
    despues: plano(texto.slice(fin, b)).trimEnd() + (b < texto.length ? '…' : '')
  };
}
