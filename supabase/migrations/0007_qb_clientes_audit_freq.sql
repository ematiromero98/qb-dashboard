-- ============================================================
-- QB DASHBOARD — frecuencia de auditoría contable por cliente
-- Cada cuánto se debería auditar la contabilidad del cliente.
-- ============================================================

alter table public.qb_clientes
  add column if not exists audit_freq text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='qb_clientes_audit_freq_chk') then
    alter table public.qb_clientes
      add constraint qb_clientes_audit_freq_chk
      check (audit_freq is null or audit_freq in ('Mensual','Trimestral','Semestral','Anual','Ninguna'));
  end if;
end $$;
