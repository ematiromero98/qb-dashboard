-- ============================================================
-- QB DASHBOARD — Pendientes de corregir
-- Avance de la Revisión por auditoría: cuántos puntos y filas
-- quedan sin corregir y cuántos esperan la definición de Dennis.
-- Lo usa el botón «Pendientes de corregir» de Expedientes.
-- Solo agrega una vista: no cambia nada de lo que ya existe.
-- ============================================================

create or replace view chermisqui.qb_aud_avance
with (security_invoker = true) as
select r.id as run_id,
       r.cliente_id,
       coalesce(h.puntos, 0)          as puntos,
       coalesce(h.puntos_abiertos, 0) as puntos_abiertos,
       coalesce(h.puntos_dennis, 0)   as puntos_dennis,
       coalesce(c.filas, 0)           as filas,
       coalesce(c.filas_pendientes, 0) as filas_pendientes,
       c.ultimo_tilde
from chermisqui.qb_aud_runs r
left join (
  select run_id,
         count(*) filter (where ref is not null)                                                  as puntos,
         count(*) filter (where ref is not null and estado in ('Abierto', 'Repetido'))            as puntos_abiertos,
         count(*) filter (where ref is not null and estado in ('Abierto', 'Repetido') and destino = 'DEFINIR') as puntos_dennis
  from chermisqui.qb_aud_hallazgos group by run_id
) h on h.run_id = r.id
left join (
  select run_id,
         count(*)                                     as filas,
         count(*) filter (where estado = 'Pendiente') as filas_pendientes,
         max(hecho_at)                                as ultimo_tilde
  from chermisqui.qb_aud_correcciones group by run_id
) c on c.run_id = r.id;

revoke all on chermisqui.qb_aud_avance from anon, authenticated;
grant select on chermisqui.qb_aud_avance to service_role;
