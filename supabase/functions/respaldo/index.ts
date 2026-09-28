// ScanLibre · función "respaldo" (Supabase Edge Function)
// El teléfono cifra todo antes de subirlo. Esta función no ve el contenido ni
// el código de respaldo: solo recibe el número del respaldo (id), una llave
// que sale del código y los nombres (al azar) de los archivos. Da permisos
// para subir y bajar directo al depósito, que es privado.
//
// Pedidos (POST, cuerpo JSON; puede ir como text/plain para ahorrar la consulta CORS):
//   { accion: 'estado', id, llave }                 → { existe, cupo, objetos: { nombre: bytes } }
//   { accion: 'subir',  id, llave, archivos: [{ nombre, bytes }] } → { urls: { nombre: url } }
//   { accion: 'bajar',  id, llave, nombres: [...] } → { urls: { nombre: url } }
//   { accion: 'borrar', id, llave, nombres?: [...] } → { borrados }   (sin nombres: todo el respaldo)

const BASE = Deno.env.get('SUPABASE_URL')!;
const SECRETA: string | undefined = (() => {
  try { return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default; } catch { return undefined; }
})();
const LEGADA = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const LLAVE_SERVIDOR = SECRETA ?? LEGADA ?? '';
const CABECERAS: Record<string, string> = SECRETA ? { apikey: SECRETA } : { apikey: LEGADA!, Authorization: `Bearer ${LEGADA}` };

const DEPOSITO = 'respaldos';
const CUPO = 200e6;          // lo que puede ocupar cada respaldo
const TOPE = 900e6;          // todos los respaldos juntos (el plan gratis de Supabase trae 1 GB)
const MAX_ARCHIVO = 15728640;
const POR_PEDIDO = 25;
const NUEVOS_POR_DIA = 50;   // respaldos nuevos por conexión (IP) en 24 horas (en la U muchos comparten la misma)

const ORIGENES = [/^https:\/\/scanlibre\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const ES_ID = /^[0-9a-f]{32}$/, ES_LLAVE = /^[A-Za-z0-9_-]{43}$/, ES_NOMBRE = /^[A-Za-z0-9_-]{1,64}$/;

class Rechazo extends Error {
  constructor(public estado: number, public codigo: string, mensaje: string) { super(mensaje); }
}

function cors(origen: string | null): Record<string, string> {
  const permitido = origen && ORIGENES.some(r => r.test(origen)) ? origen : 'https://scanlibre.github.io';
  return {
    'Access-Control-Allow-Origin': permitido,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (t: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
async function hmac(t: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(LLAVE_SERVIDOR), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(t)));
}
function iguales(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function api(camino: string, { method = 'GET', body, headers = {} }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const r = await fetch(BASE + camino, {
    method,
    headers: { ...CABECERAS, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const texto = await r.text();
  if (!r.ok) throw Object.assign(new Error(`${method} ${camino.split('?')[0]}: ${r.status} ${texto.slice(0, 300)}`), { estado: r.status });
  try { return texto ? JSON.parse(texto) : null; } catch { return texto; }
}

const objetos = async (id: string): Promise<Record<string, number>> =>
  Object.fromEntries((await api('/rest/v1/rpc/respaldo_objetos', { method: 'POST', body: { p_id: id } })).map((o: { nombre: string; bytes: number }) => [o.nombre, Number(o.bytes)]));

/** ¿Existe el respaldo y la llave es la suya? Con `crear`, si no existe lo crea con esa llave */
async function autorizar(id: string, llave: string, { crear = false, ip = '' } = {}): Promise<boolean> {
  const huella = await sha256(llave);
  for (let intento = 0; intento < 2; intento++) {
    const [fila] = await api(`/rest/v1/respaldos?id=eq.${id}&select=llave`);
    if (fila) {
      if (!iguales(fila.llave, huella)) throw new Rechazo(403, 'otro-codigo', 'Ese código no corresponde a este respaldo.');
      return true;
    }
    if (!crear) return false;
    const origen = ip ? await hmac('origen:' + ip) : null;
    if (origen) {
      const desde = new Date(Date.now() - 864e5).toISOString();
      const hoy = await api(`/rest/v1/respaldos?origen=eq.${origen}&creado=gt.${desde}&select=id`);
      if (hoy.length >= NUEVOS_POR_DIA) throw new Rechazo(429, 'muchos', 'Se crearon demasiados respaldos desde esta conexión hoy. Prueba mañana.');
      // La IP (disfrazada) solo sirve 24 horas: después se olvida
      await api(`/rest/v1/respaldos?origen=not.is.null&creado=lt.${desde}`, { method: 'PATCH', body: { origen: null }, headers: { Prefer: 'return=minimal' } });
    }
    try {
      await api('/rest/v1/respaldos', { method: 'POST', body: { id, llave: huella, origen }, headers: { Prefer: 'return=minimal' } });
      return true;
    } catch (e) {
      // Otro pedido lo creó al mismo tiempo: se vuelve a revisar la llave
      if ((e as { estado?: number }).estado !== 409) throw e;
    }
  }
  throw new Rechazo(409, 'ocupado', 'No se pudo crear el respaldo. Prueba otra vez.');
}

const tocar = (id: string) => api(`/rest/v1/respaldos?id=eq.${id}`, { method: 'PATCH', body: { actualizado: new Date().toISOString() }, headers: { Prefer: 'return=minimal' } });

function nombres(lista: unknown, max = POR_PEDIDO): string[] {
  if (!Array.isArray(lista) || !lista.length || lista.length > max || !lista.every(n => typeof n === 'string' && ES_NOMBRE.test(n))) throw new Rechazo(400, 'pedido', 'Pedido inválido.');
  return [...new Set(lista as string[])];
}

async function atender(p: Record<string, unknown>, ip: string) {
  const { accion, id, llave } = p as { accion: string; id: string; llave: string };
  if (typeof id !== 'string' || !ES_ID.test(id) || typeof llave !== 'string' || !ES_LLAVE.test(llave)) throw new Rechazo(400, 'pedido', 'Pedido inválido.');

  if (accion === 'estado') {
    if (!(await autorizar(id, llave))) return { existe: false, cupo: CUPO, objetos: {} };
    return { existe: true, cupo: CUPO, objetos: await objetos(id) };
  }

  if (accion === 'subir') {
    const archivos = p.archivos as { nombre: string; bytes: number }[];
    const lista = nombres(Array.isArray(archivos) ? archivos.map(a => a?.nombre) : null);
    if (!archivos.every(a => Number.isInteger(a.bytes) && a.bytes > 0 && a.bytes <= MAX_ARCHIVO)) throw new Rechazo(413, 'grande', 'Un archivo es demasiado grande para la nube.');
    await autorizar(id, llave, { crear: true, ip });
    const hay = await objetos(id);
    const usado = Object.values(hay).reduce((s, b) => s + b, 0);
    const nuevos = archivos.reduce((s, a) => s + Math.max(0, a.bytes - (hay[a.nombre] ?? 0)), 0);
    if (usado + nuevos > CUPO) throw new Rechazo(413, 'lleno', `Tu respaldo en la nube está lleno (hasta ${Math.round(CUPO / 1e6)} MB).`);
    if (Number(await api('/rest/v1/rpc/respaldos_total', { method: 'POST', body: {} })) + nuevos > TOPE) {
      throw new Rechazo(507, 'sin-espacio', 'La nube de ScanLibre está llena por ahora. Usa el respaldo en archivo.');
    }
    const urls: Record<string, string> = {};
    await Promise.all(lista.map(async nombre => {
      const r = await api(`/storage/v1/object/upload/sign/${DEPOSITO}/${id}/${nombre}`, { method: 'POST', body: {}, headers: { 'x-upsert': 'true' } });
      urls[nombre] = `${BASE}/storage/v1${r.url}`;
    }));
    await tocar(id);
    return { urls };
  }

  if (accion === 'bajar') {
    const lista = nombres(p.nombres, 200);
    if (!(await autorizar(id, llave))) throw new Rechazo(404, 'no-existe', 'No hay un respaldo con ese código.');
    const firmadas = await api(`/storage/v1/object/sign/${DEPOSITO}`, { method: 'POST', body: { expiresIn: 3600, paths: lista.map(n => `${id}/${n}`) } });
    const urls: Record<string, string> = {};
    for (const f of firmadas) if (f.signedURL) urls[String(f.path).slice(33)] = `${BASE}/storage/v1${f.signedURL}`;
    return { urls };
  }

  if (accion === 'borrar') {
    if (!(await autorizar(id, llave))) return { borrados: 0 };
    const todo = p.nombres === undefined;
    const lista = todo ? Object.keys(await objetos(id)) : nombres(p.nombres, 1000);
    for (let i = 0; i < lista.length; i += 100) {
      await api(`/storage/v1/object/${DEPOSITO}`, { method: 'DELETE', body: { prefixes: lista.slice(i, i + 100).map(n => `${id}/${n}`) } });
    }
    if (todo) await api(`/rest/v1/respaldos?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    else await tocar(id);
    return { borrados: lista.length };
  }

  throw new Rechazo(400, 'pedido', 'Pedido inválido.');
}

Deno.serve(async req => {
  const encabezados = { ...cors(req.headers.get('origin')), 'Content-Type': 'application/json; charset=utf-8' };
  const responder = (datos: unknown, estado = 200) => new Response(JSON.stringify(datos), { status: estado, headers: encabezados });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: encabezados });
  if (req.method === 'GET') return responder({ servicio: 'ScanLibre · respaldo', cupo: CUPO });
  if (req.method !== 'POST') return responder({ error: 'Método no permitido', codigo: 'metodo' }, 405);
  try {
    const texto = await req.text();
    if (texto.length > 65536) throw new Rechazo(413, 'pedido', 'Pedido demasiado grande.');
    let pedido: Record<string, unknown>;
    try { pedido = JSON.parse(texto); } catch { throw new Rechazo(400, 'pedido', 'Pedido inválido.'); }
    const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '';
    return responder(await atender(pedido, ip));
  } catch (e) {
    if (e instanceof Rechazo) return responder({ error: e.message, codigo: e.codigo }, e.estado);
    console.error(e);
    return responder({ error: 'La nube no respondió bien. Prueba más tarde.', codigo: 'servidor' }, 502);
  }
});
