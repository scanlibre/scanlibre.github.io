// Una nube de mentira para las pruebas: hace lo mismo que la función "respaldo"
// de Supabase (supabase/functions/respaldo) y el depósito, pero en memoria.
// Se engancha con context.route() a la dirección de verdad.
import { createHash, randomBytes } from 'node:crypto';

const BASE = 'https://kprqbrtxakiatmbqavmy.supabase.co';
const sha256 = t => createHash('sha256').update(t).digest('hex');

export function nubeFalsa({ cupo = 200e6 } = {}) {
  const respaldos = new Map();   // id → { llave, objetos: Map(nombre → Buffer) }
  const permisos = new Map();    // token → { id, nombre, tipo }
  const pedidos = [];            // cada acción que llegó (para revisar qué se subió)
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS' };
  const json = (route, datos, status = 200) => route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
  const firmar = (id, nombre, tipo) => {
    const token = randomBytes(12).toString('hex');
    permisos.set(token, { id, nombre, tipo });
    return `${BASE}/storage/v1/object/${tipo === 'subir' ? 'upload/sign' : 'sign'}/respaldos/${id}/${nombre}?token=${token}`;
  };

  function autorizar(p, crear = false) {
    const r = respaldos.get(p.id);
    if (r) { if (r.llave !== sha256(p.llave)) throw [403, 'otro-codigo', 'Ese código no corresponde a este respaldo.']; return r; }
    if (!crear) return null;
    const nuevo = { llave: sha256(p.llave), objetos: new Map() };
    respaldos.set(p.id, nuevo);
    return nuevo;
  }

  function funcion(p) {
    if (!/^[0-9a-f]{32}$/.test(p.id) || !/^[A-Za-z0-9_-]{43}$/.test(p.llave)) throw [400, 'pedido', 'Pedido inválido.'];
    if (p.accion === 'estado') {
      const r = autorizar(p);
      return { existe: !!r, cupo, objetos: r ? Object.fromEntries([...r.objetos].map(([n, b]) => [n, b.length])) : {} };
    }
    if (p.accion === 'subir') {
      if (p.archivos.length > 25) throw [400, 'pedido', 'Pedido inválido.'];
      const r = autorizar(p, true);
      const usado = [...r.objetos.values()].reduce((s, b) => s + b.length, 0);
      const nuevos = p.archivos.reduce((s, a) => s + Math.max(0, a.bytes - (r.objetos.get(a.nombre)?.length || 0)), 0);
      if (usado + nuevos > cupo) throw [413, 'lleno', `Tu respaldo en la nube está lleno (hasta ${Math.round(cupo / 1e6)} MB).`];
      return { urls: Object.fromEntries(p.archivos.map(a => [a.nombre, firmar(p.id, a.nombre, 'subir')])) };
    }
    if (p.accion === 'bajar') {
      const r = autorizar(p);
      if (!r) throw [404, 'no-existe', 'No hay un respaldo con ese código.'];
      return { urls: Object.fromEntries(p.nombres.filter(n => r.objetos.has(n)).map(n => [n, firmar(p.id, n, 'bajar')])) };
    }
    if (p.accion === 'borrar') {
      const r = autorizar(p);
      if (!r) return { borrados: 0 };
      if (!p.nombres) { respaldos.delete(p.id); return { borrados: r.objetos.size }; }
      for (const n of p.nombres) r.objetos.delete(n);
      return { borrados: p.nombres.length };
    }
    throw [400, 'pedido', 'Pedido inválido.'];
  }

  async function atender(route) {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/functions/v1/respaldo') {
      const p = JSON.parse(req.postData());
      pedidos.push({ accion: p.accion, archivos: p.archivos?.map(a => a.nombre), nombres: p.nombres });
      try { return json(route, funcion(p)); }
      catch (e) { if (Array.isArray(e)) return json(route, { error: e[2], codigo: e[1] }, e[0]); throw e; }
    }
    const permiso = permisos.get(url.searchParams.get('token'));
    if (!permiso) return route.fulfill({ status: 400, headers: cors, body: 'token' });
    const r = respaldos.get(permiso.id);
    if (permiso.tipo === 'subir' && req.method() === 'PUT') {
      r.objetos.set(permiso.nombre, req.postDataBuffer());
      return json(route, { Key: `respaldos/${permiso.id}/${permiso.nombre}` });
    }
    if (permiso.tipo === 'bajar' && req.method() === 'GET') {
      const b = r?.objetos.get(permiso.nombre);
      if (!b) return route.fulfill({ status: 404, headers: cors, body: '' });
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/octet-stream' }, body: b });
    }
    return route.fulfill({ status: 405, headers: cors, body: '' });
  }

  return {
    respaldos, pedidos,
    /** Engancha la nube a una página (a todo su contexto) */
    enganchar: page => page.context().route(`${BASE}/**`, atender),
    /** Todos los bytes guardados en la nube, juntos */
    todo: () => Buffer.concat([...respaldos.values()].flatMap(r => [...r.objetos.values()])),
    objetos: () => [...respaldos.values()].reduce((s, r) => s + r.objetos.size, 0)
  };
}
