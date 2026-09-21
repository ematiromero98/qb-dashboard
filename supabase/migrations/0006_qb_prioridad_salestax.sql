-- ============================================================
-- QB DASHBOARD — 4º valor de prioridad: 'Sales Tax' (violeta)
-- En el tablero de Trello, el violeta reemplaza al color de
-- prioridad, así que 'Sales Tax' es un valor más del selector.
-- ============================================================

alter table public.qb_clientes drop constraint if exists qb_clientes_prioridad_chk;
alter table public.qb_clientes
  add constraint qb_clientes_prioridad_chk
  check (prioridad in ('Alta','Media','Baja','Sales Tax'));
