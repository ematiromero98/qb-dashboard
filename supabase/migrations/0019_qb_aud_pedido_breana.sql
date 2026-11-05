-- ============================================================
-- QB DASHBOARD — Pendiente del cliente
-- Por punto: si ya se le pidió a Breana que lo reclame al cliente,
-- quién y cuándo. Se guarda por punto para que un pedido agregado
-- después no quede como ya pedido.
-- Solo agrega: columnas nuevas y columnas al final de la vista.
-- ============================================================

alter table chermisqui.qb_aud_hallazgos
  add column if not exists pedido_breana_at timestamptz,
  add column if not exists pedido_breana_por text;

create or replace view chermisqui.qb_aud_avance
with (security_invoker = true) as
select r.id as run_id,
       r.cliente_id,
       coalesce(h.puntos, 0)          as puntos,
       coalesce(h.puntos_abiertos, 0) as puntos_abiertos,
       coalesce(h.puntos_dennis, 0)   as puntos_dennis,
       coalesce(c.filas, 0)           as filas,
       coalesce(c.filas_pendientes, 0) as filas_pendientes,
       c.ultimo_tilde,
       coalesce(p.puntos_cliente, 0)         as puntos_cliente,
       coalesce(p.puntos_cliente_pedidos, 0) as puntos_cliente_pedidos,
       p.pedido_breana_at,
       p.pedido_breana_por
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
) c on c.run_id = r.id
left join (
  -- Misma regla que pideCliente en auditoria.js y esPedidoCliente en qb-api.
  select run_id,
         count(*)                                                    as puntos_cliente,
         count(*) filter (where pedido_breana_at is not null)        as puntos_cliente_pedidos,
         min(pedido_breana_at)                                       as pedido_breana_at,
         string_agg(distinct pedido_breana_por, ', ')                as pedido_breana_por
  from chermisqui.qb_aud_hallazgos
  where ref is not null and estado in ('Abierto', 'Repetido')
    and (destino = 'CLIENTE' or (coalesce(codigo, '') <> 'A01' and btrim(coalesce(mail_texto, '')) <> ''))
  group by run_id
) p on p.run_id = r.id;

revoke all on chermisqui.qb_aud_avance from anon, authenticated;
grant select on chermisqui.qb_aud_avance to service_role;
