-- ============================================================
-- QB DASHBOARD — registro de auditorías hechas (por cliente y mes)
-- La frecuencia vive en qb_clientes.audit_freq; acá se marca lo
-- efectivamente hecho, mes a mes ('YYYY-MM'). El vencimiento se
-- calcula en el front: última auditoría + frecuencia.
-- ============================================================

create table if not exists public.qb_auditorias (
  id         bigint generated always as identity primary key,
  cliente_id bigint not null references public.qb_clientes(id) on delete cascade,
  mes        text not null,                 -- 'YYYY-MM'
  hecho      boolean not null default true,
  fecha      date,                           -- cuándo se marcó hecha
  nota       text,
  creado_at  timestamptz not null default now(),
  unique(cliente_id, mes)
);
create index if not exists qb_audit_cliente_idx on public.qb_auditorias(cliente_id);
create index if not exists qb_audit_mes_idx on public.qb_auditorias(mes);

-- RLS ON sin políticas => solo la Edge Function (service_role) accede.
alter table public.qb_auditorias enable row level security;
