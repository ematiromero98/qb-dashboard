-- ============================================================
-- QB DASHBOARD — marca de cuenta MANUAL
-- Una cuenta "manual" es la que se concilia a mano, sin importar
-- de QuickBooks. Sirve para saber cuántas hay en el resumen.
-- ============================================================

alter table public.qb_cuentas
  add column if not exists manual boolean not null default false;

-- Recrear la vista aplanada para exponer el flag `manual`.
create or replace view public.qb_vista as
select co.id as conc_id, co.periodo_id,
  cl.id as cliente_id, cl.nombre as cliente, cl.bookkeeper_default,
  cu.id as cuenta_id, cu.nombre as cuenta, cu.tipo, cu.manual, cu.activo as cuenta_activo, cu.orden,
  co.estado, co.fecha_completado, co.bookkeeper,
  co.conciliado, co.revisado, co.memos_checks,
  co.doc_payroll, co.junior_input, co.auto_review, co.claude_review, co.senior_review,
  co.analisis_payroll, co.analisis_pl, co.analisis_balance, co.analisis_ventas,
  co.notas, co.actualizado_at
from public.qb_conciliaciones co
join public.qb_cuentas  cu on cu.id = co.cuenta_id
join public.qb_clientes cl on cl.id = cu.cliente_id;
