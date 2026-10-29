-- ============================================================
-- QB DASHBOARD — PIN propio de los expedientes de auditoría
-- qb-api usa pin_aud para las acciones aud_*; si está vacío,
-- rige el PIN de jefes (pin_admin). El valor se carga aparte,
-- nunca en el repositorio.
-- ============================================================
alter table chermisqui.qb_config add column if not exists pin_aud text;
