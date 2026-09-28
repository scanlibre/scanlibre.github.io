// ScanLibre · revisar las librerías copiadas en vendor/
// Dependabot no las ve (no están en package.json): esto pregunta a npm si hay
// una versión nueva o un aviso de seguridad para la versión incluida. Si hay
// algo, abre un issue (una sola vez) para revisarlo a mano. Un aviso de
// seguridad además deja la corrida en rojo.

import { readFileSync, appendFileSync } from 'node:fs';

const versiones = JSON.parse(readFileSync(new URL('../../vendor/versiones.json', import.meta.url), 'utf8'));
const REGISTRO = 'https://registry.npmjs.org';

/** ¿La versión `a` es más nueva que `b`? (x.y.z) */
export const masNueva = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

const nuevas = [], filas = [];
for (const [paquete, version] of Object.entries(versiones)) {
  const r = await fetch(`${REGISTRO}/${paquete}/latest`);
  if (!r.ok) throw new Error(`${paquete}: npm respondió ${r.status}`);
  const ultima = (await r.json()).version;
  const hay = masNueva(ultima, version);
  if (hay) nuevas.push(`${paquete}: incluida ${version}, hay ${ultima}`);
  filas.push(`| ${paquete} | ${version} | ${ultima} | ${hay ? 'Revisar' : 'Al día'} |`);
}

// La misma consulta que usa npm audit, con las versiones incluidas
const r = await fetch(`${REGISTRO}/-/npm/v1/security/advisories/bulk`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(Object.fromEntries(Object.entries(versiones).map(([p, v]) => [p, [v]])))
});
if (!r.ok) throw new Error(`Avisos de seguridad: npm respondió ${r.status}`);
const avisos = Object.entries(await r.json()).flatMap(([p, lista]) => lista.map(a => `${p}: ${a.title} (${a.severity}) ${a.url}`));

const informe = [
  '## Librerías de vendor/', '',
  '| Paquete | Incluida | Última | Estado |', '|---|---|---|---|', ...filas, '',
  avisos.length ? `**Avisos de seguridad (${avisos.length}):**\n${avisos.map(a => `- ${a}`).join('\n')}` : 'Sin avisos de seguridad para las versiones incluidas.', ''
].join('\n');
console.log(informe);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, informe);

// Abrir un issue (si no hay uno abierto) solo en las corridas programadas o a mano
const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_EVENT_NAME: evento } = process.env;
if ((nuevas.length || avisos.length) && token && repo && ['schedule', 'workflow_dispatch'].includes(evento)) {
  const api = (ruta, opciones = {}) => fetch(`https://api.github.com/repos/${repo}${ruta}`, {
    ...opciones, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' }
  });
  const titulo = avisos.length ? 'Aviso de seguridad en una librería de vendor/' : 'Hay versiones nuevas de las librerías de vendor/';
  const abiertos = await (await api('/issues?state=open&per_page=100')).json();
  if (!abiertos.some(i => i.title === titulo && !i.pull_request)) {
    const cuerpo = `${informe}\n${nuevas.map(n => `- ${n}`).join('\n')}\n\nCómo actualizar: ver el LEEME.md de cada carpeta de vendor/ y después vendor/versiones.json. Ver también SECURITY.md.`;
    const creado = await api('/issues', { method: 'POST', body: JSON.stringify({ title: titulo, body: cuerpo }) });
    console.log(creado.ok ? `Issue abierto: ${titulo}` : `No se pudo abrir el issue: ${creado.status}`);
  }
}
if (avisos.length) process.exitCode = 1;
