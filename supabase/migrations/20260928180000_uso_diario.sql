-- ScanLibre · cuánto se usa la nube, día por día (para notar a tiempo un abuso
-- o que el plan se está llenando). Solo números: nada de los respaldos.
create extension if not exists pg_cron;

create table public.uso_diario (
  dia date primary key,
  respaldos integer not null,   -- respaldos que existen
  bytes bigint not null,        -- lo que ocupan todos juntos
  nuevos integer not null       -- los creados en las últimas 24 horas
);
alter table public.uso_diario enable row level security;
revoke all on public.uso_diario from anon, authenticated;

-- Todos los días a las 00:05 de Honduras (06:05 UTC)
select cron.schedule('scanlibre-uso-diario', '5 6 * * *', $$
  insert into public.uso_diario (dia, respaldos, bytes, nuevos)
  select current_date, (select count(*) from public.respaldos), public.respaldos_total(),
         (select count(*) from public.respaldos where creado > now() - interval '1 day')
  on conflict (dia) do update set respaldos = excluded.respaldos, bytes = excluded.bytes, nuevos = excluded.nuevos
$$);
