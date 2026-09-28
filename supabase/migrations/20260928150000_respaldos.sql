-- ScanLibre · respaldo cifrado en la nube
-- El teléfono cifra todo antes de subirlo: aquí solo hay bytes cifrados con
-- nombres al azar. La función "respaldo" es la única que usa esta tabla y el
-- depósito (con la clave secreta); nadie más tiene permiso.

create table public.respaldos (
  id text primary key check (id ~ '^[0-9a-f]{32}$'),
  -- SHA-256 de la llave que manda el teléfono (la llave sale del código de respaldo)
  llave text not null check (llave ~ '^[0-9a-f]{64}$'),
  -- SHA-256 de la IP con una sal: solo para limitar cuántos respaldos nuevos se crean por día
  origen text,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index respaldos_origen on public.respaldos (origen, creado);

alter table public.respaldos enable row level security;
revoke all on public.respaldos from anon, authenticated;

-- Depósito privado: hasta 15 MB por archivo (una página a resolución completa)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('respaldos', 'respaldos', false, 15728640, array['application/octet-stream']);

-- Los archivos de un respaldo y cuánto pesan
create function public.respaldo_objetos(p_id text)
returns table (nombre text, bytes bigint)
language sql stable security definer set search_path = ''
as $$
  select substr(o.name, 34), coalesce((o.metadata->>'size')::bigint, 0)
  from storage.objects o
  where o.bucket_id = 'respaldos' and o.name like p_id || '/%';
$$;

-- Lo que ocupan todos los respaldos juntos (para no pasarse del plan)
create function public.respaldos_total()
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from storage.objects o where o.bucket_id = 'respaldos';
$$;

revoke execute on function public.respaldo_objetos(text) from public, anon, authenticated;
revoke execute on function public.respaldos_total() from public, anon, authenticated;
grant execute on function public.respaldo_objetos(text) to service_role;
grant execute on function public.respaldos_total() to service_role;
