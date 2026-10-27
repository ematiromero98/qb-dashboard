-- ============================================================
-- QB DASHBOARD — "Información pedida" por cuenta
-- Tildar la columna = se le pidió algo al cliente (vía Breanna).
-- Destildar = respondido. Se guarda cuándo se pidió y cuándo se
-- respondió, más un detalle libre (qué se pidió / mail).
-- Los pedidos abiertos se arrastran al mes nuevo (qb-api new_periodo).
-- ============================================================

alter table chermisqui.qb_conciliaciones
  add column if not exists info_pedida           boolean not null default false,
  add column if not exists info_pedida_fecha     date,
  add column if not exists info_pedida_detalle   text,
  add column if not exists info_respondida_fecha date;

-- La vista agrega las columnas al final (create or replace solo permite sumar al final).
create or replace view chermisqui.qb_vista with (security_invoker = true) as
 select co.id as conc_id,
    co.periodo_id,
    cl.id as cliente_id,
    cl.nombre as cliente,
    cl.bookkeeper_default,
    cl.prioridad,
    cu.id as cuenta_id,
    cu.nombre as cuenta,
    cu.tipo,
    cu.manual,
    cu.activo as cuenta_activo,
    cu.orden,
    co.estado,
    co.fecha_completado,
    co.bookkeeper,
    co.conciliado,
    co.revisado,
    co.memos_checks,
    co.doc_payroll,
    co.junior_input,
    co.auto_review,
    co.claude_review,
    co.senior_review,
    co.analisis_payroll,
    co.analisis_pl,
    co.analisis_balance,
    co.analisis_ventas,
    co.notas,
    co.actualizado_at,
    co.info_pedida,
    co.info_pedida_fecha,
    co.info_pedida_detalle,
    co.info_respondida_fecha
   from chermisqui.qb_conciliaciones co
     join chermisqui.qb_cuentas cu on cu.id = co.cuenta_id
     join chermisqui.qb_clientes cl on cl.id = cu.cliente_id;
