-- ============================================================
-- QB DASHBOARD — Estado por cliente
-- Dos vistas para la pestaña «Estado por cliente» de Expedientes:
-- · qb_aud_estado_runs: por auditoría, avance de la Revisión, quién
--   trabajó, filas «No corresponde», pedidos que no se hacen al cliente
--   y cuánta memoria tiene el cliente.
-- · qb_aud_estado_abiertos: los puntos abiertos con sus filas pendientes.
-- Solo agrega vistas: no cambia nada de lo que ya existe.
-- ============================================================

create or replace view chermisqui.qb_aud_estado_runs
with (security_invoker = true) as
select r.id as run_id,
       r.cliente_id,
       count(h.id)                                         as puntos,
       count(*) filter (where h.estado = 'Resuelto')       as resueltos,
       count(*) filter (where h.estado = 'Descartado')     as descartados,
       -- Punto al cliente resuelto sin respuesta = no se le pregunta (Matías, 5-nov-2026).
       count(*) filter (where h.estado = 'Resuelto'
         and (h.destino = 'CLIENTE' or (coalesce(h.codigo, '') <> 'A01' and btrim(coalesce(h.mail_texto, '')) <> ''))) as no_pregunta,
       coalesce(max(c.filas), 0)   as filas,
       coalesce(max(c.hechas), 0)  as hechas,
       coalesce(max(c.no_corr), 0) as no_corr,
       max(c.quien)                as quien,
       max(c.ult)                  as ultimo_tilde,
       coalesce(max(m.mem_vigente), 0)   as mem_vigente,
       coalesce(max(m.mem_propuesta), 0) as mem_propuesta
from chermisqui.qb_aud_runs r
join chermisqui.qb_aud_hallazgos h on h.run_id = r.id and h.ref is not null
left join (
  select run_id,
         count(*) as filas,
         count(*) filter (where estado in ('Corregido', 'Hecho distinto', 'No corresponde', 'Ya no aparece')) as hechas,
         count(*) filter (where estado = 'No corresponde') as no_corr,
         string_agg(distinct hecho_por, ', ') as quien,
         max(hecho_at) as ult
  from chermisqui.qb_aud_correcciones group by run_id
) c on c.run_id = r.id
left join (
  select cliente_id,
         count(*) filter (where estado = 'Vigente')   as mem_vigente,
         count(*) filter (where estado = 'Propuesta') as mem_propuesta
  from chermisqui.qb_aud_memoria group by cliente_id
) m on m.cliente_id = r.cliente_id
group by r.id, r.cliente_id;

create or replace view chermisqui.qb_aud_estado_abiertos
with (security_invoker = true) as
select h.id, h.run_id, h.cliente_id, h.ref, h.orden, h.titulo, h.monto, h.destino, h.codigo, h.mail_texto, h.pedido_breana_at,
       coalesce(c.filas, 0) as filas,
       coalesce(c.pendientes, 0) as pendientes
from chermisqui.qb_aud_hallazgos h
left join (
  select hallazgo_id, count(*) as filas, count(*) filter (where estado = 'Pendiente') as pendientes
  from chermisqui.qb_aud_correcciones group by hallazgo_id
) c on c.hallazgo_id = h.id
where h.ref is not null and h.estado in ('Abierto', 'Repetido');

revoke all on chermisqui.qb_aud_estado_runs, chermisqui.qb_aud_estado_abiertos from anon, authenticated;
grant select on chermisqui.qb_aud_estado_runs, chermisqui.qb_aud_estado_abiertos to service_role;
