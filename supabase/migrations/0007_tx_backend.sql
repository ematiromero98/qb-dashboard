-- Backend compartido para el dashboard de Taxes por Trimestre (/taxes/).
-- Guarda TODO el estado de la app como un documento JSON por clave (tx_kv),
-- igual que hacía en localStorage pero ahora compartido entre todas las PCs.
-- Acceso sólo por la Edge Function tx-api (valida PIN, usa service_role).

create table if not exists public.tx_kv (
  id         text primary key,           -- ej: 'quarters_v1'
  value      text not null,              -- JSON.stringify(state)
  rev        bigint not null default 1,  -- versión (para detectar cambios de otros)
  updated_at timestamptz not null default now()
);

create table if not exists public.tx_config (
  id  int primary key default 1,
  pin text not null
);

insert into public.tx_config (id, pin)
values (1, 'Chermisqui-2026')
on conflict (id) do nothing;

-- RLS ON sin políticas => la anon key NO lee ni escribe nada.
-- Todo el acceso pasa por la Edge Function tx-api (service_role).
alter table public.tx_kv     enable row level security;
alter table public.tx_config enable row level security;
