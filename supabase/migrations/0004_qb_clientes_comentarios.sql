-- ============================================================
-- QB DASHBOARD — comentarios por cliente/empresa
-- Nota a nivel CLIENTE (no por período): se mantiene mes a mes.
-- Editable desde la vista "Por Empresa / Cuenta".
-- ============================================================

alter table public.qb_clientes
  add column if not exists comentarios text;
