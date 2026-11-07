-- ============================================================
-- 0021 · qb_aud_estado_runs: columna «integral» y auditorías sin puntos
-- · integral = la auditoría procesó Profit and Loss, Balance Sheet y
--   Transaction Detail (inputs subidos al expediente). Las revisiones que
--   mandó Dennis en Word no los tienen: quedan «por auditar» (Matías, 7-nov-2026).
-- · left join a los hallazgos: una auditoría sin ningún punto también sale.
-- Solo cambia la vista (mismas columnas + una al final).
-- ============================================================

create or replace view chermisqui.qb_aud_estado_runs
with (security_invoker = true) as
select r.id as run_id,
       r.cliente_id,
       count(h.id)                                         as puntos,
       count(h.id) filter (where h.estado = 'Resuelto')    as resueltos,
       count(h.id) filter (where h.estado = 'Descartado')  as descartados,
       count(h.id) filter (where h.estado = 'Resuelto'
         and (h.destino = 'CLIENTE' or (coalesce(h.codigo, '') <> 'A01' and btrim(coalesce(h.mail_texto, '')) <> ''))) as no_pregunta,
       coalesce(max(c.filas), 0)   as filas,
       coalesce(max(c.hechas), 0)  as hechas,
       coalesce(max(c.no_corr), 0) as no_corr,
       max(c.quien)                as quien,
       max(c.ult)                  as ultimo_tilde,
       coalesce(max(m.mem_vigente), 0)   as mem_vigente,
       coalesce(max(m.mem_propuesta), 0) as mem_propuesta,
       coalesce(bool_and(a.integral), false) as integral
from chermisqui.qb_aud_runs r
left join chermisqui.qb_aud_hallazgos h on h.run_id = r.id and h.ref is not null
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
left join (
  select run_id,
         bool_or(tipo = 'Profit and Loss') and bool_or(tipo = 'Balance Sheet') and bool_or(tipo = 'Transaction Detail') as integral
  from chermisqui.qb_aud_archivos where rol = 'input' group by run_id
) a on a.run_id = r.id
group by r.id, r.cliente_id;

revoke all on chermisqui.qb_aud_estado_runs from anon, authenticated;
grant select on chermisqui.qb_aud_estado_runs to service_role;
