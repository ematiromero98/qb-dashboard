-- ============================================================
-- QB DASHBOARD — prioridad por CLIENTE (Alta / Media / Baja)
-- Sirve para ordenar y destacar clientes clave. Es a nivel
-- cliente (persiste mes a mes). Default 'Media'.
-- ============================================================

alter table public.qb_clientes
  add column if not exists prioridad text not null default 'Media';

-- Solo valores de la escala. Se agrega si no existe todavía.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'qb_clientes_prioridad_chk'
  ) then
    alter table public.qb_clientes
      add constraint qb_clientes_prioridad_chk
      check (prioridad in ('Alta','Media','Baja'));
  end if;
end $$;

-- Recrear la vista aplanada para exponer `prioridad`.
-- (drop + create porque se inserta una columna en el medio; create or replace
--  no permite reordenar columnas de una vista existente.)
drop view if exists public.qb_vista;
create view public.qb_vista as
select co.id as conc_id, co.periodo_id,
  cl.id as cliente_id, cl.nombre as cliente, cl.bookkeeper_default, cl.prioridad,
  cu.id as cuenta_id, cu.nombre as cuenta, cu.tipo, cu.manual, cu.activo as cuenta_activo, cu.orden,
  co.estado, co.fecha_completado, co.bookkeeper,
  co.conciliado, co.revisado, co.memos_checks,
  co.doc_payroll, co.junior_input, co.auto_review, co.claude_review, co.senior_review,
  co.analisis_payroll, co.analisis_pl, co.analisis_balance, co.analisis_ventas,
  co.notas, co.actualizado_at
from public.qb_conciliaciones co
join public.qb_cuentas  cu on cu.id = co.cuenta_id
join public.qb_clientes cl on cl.id = cu.cliente_id;
