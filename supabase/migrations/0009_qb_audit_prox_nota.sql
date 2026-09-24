-- ============================================================
-- QB DASHBOARD — agenda de auditorías (calendario hacia adelante)
-- audit_prox = mes de arranque de la agenda ('YYYY-MM'); la serie
-- se genera en el front: arranque, arranque+frecuencia, +2*frec...
-- audit_nota = comentario de auditoría por cliente (ej: "info pedida").
-- ============================================================

alter table public.qb_clientes
  add column if not exists audit_prox text,
  add column if not exists audit_nota text;

-- Arranque por frecuencia (definido con Matias 2026-09-24):
-- Mensuales en Octubre, Trimestrales en Noviembre, Semestral en Diciembre.
update public.qb_clientes set audit_prox='2026-10' where activo and audit_freq='Mensual';
update public.qb_clientes set audit_prox='2026-11' where activo and audit_freq='Trimestral';
update public.qb_clientes set audit_prox='2026-12' where activo and audit_freq='Semestral';
update public.qb_clientes set audit_prox=null    where audit_freq is null or audit_freq='Ninguna';
