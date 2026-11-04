-- ============================================================
-- QB DASHBOARD — Revisión con criterio
-- La decisión del revisor sobre cada punto de la Revisión:
-- OK, Sacar, Cambiar, Ya lo sé o Aplicado (cambio ya hecho por el skill).
-- · revision_nota: motivo, cambio pedido o criterio.
-- · revision_memoria_id: la propuesta de memoria que creó «Ya lo sé».
-- Solo agrega: no cambia nada de lo que ya existe.
-- ============================================================

alter table chermisqui.qb_aud_hallazgos
  add column if not exists revision_estado text,
  add column if not exists revision_nota text,
  add column if not exists revision_por text,
  add column if not exists revision_at timestamptz,
  add column if not exists revision_memoria_id bigint;
