-- ============================================================
-- QB DASHBOARD (Chermisqui) — esquema completo
-- Proyecto Supabase: EMPLOYEE-PRO (ffczbimnuodzcbgsdxbx)
-- Tablas prefijadas qb_. RLS ON sin políticas => acceso solo
-- por la Edge Function qb-api (service_role) validando el PIN.
-- ============================================================

create table if not exists public.qb_periodos (
  id        bigint generated always as identity primary key,
  etiqueta  text not null unique,             -- '2026-07'
  fecha     date not null,                    -- primer día del mes
  activo    boolean not null default true,
  creado_at timestamptz not null default now()
);

create table if not exists public.qb_clientes (
  id                 bigint generated always as identity primary key,
  nombre             text not null unique,
  bookkeeper_default text,
  activo             boolean not null default true,
  creado_at          timestamptz not null default now()
);

create table if not exists public.qb_cuentas (
  id         bigint generated always as identity primary key,
  cliente_id bigint not null references public.qb_clientes(id) on delete cascade,
  nombre     text not null,
  tipo       text not null default 'Bank',     -- 'Bank' | 'Credit Card'
  activo     boolean not null default true,
  orden      int not null default 0,
  creado_at  timestamptz not null default now()
);
create index if not exists qb_cuentas_cliente_idx on public.qb_cuentas(cliente_id);

create table if not exists public.qb_conciliaciones (
  id               bigint generated always as identity primary key,
  periodo_id       bigint not null references public.qb_periodos(id) on delete cascade,
  cuenta_id        bigint not null references public.qb_cuentas(id) on delete cascade,
  estado           text not null default 'Pendiente de Hacer',
  fecha_completado date,
  bookkeeper       text,
  doc_payroll      boolean not null default false,
  junior_input     boolean not null default false,
  auto_review      boolean not null default false,
  claude_review    boolean not null default false,
  senior_review    boolean not null default false,
  memos_checks     boolean not null default false,
  analisis_payroll boolean not null default false,
  analisis_pl      boolean not null default false,
  analisis_balance boolean not null default false,
  analisis_ventas  boolean not null default false,
  notas            text,
  actualizado_at   timestamptz not null default now(),
  unique(periodo_id, cuenta_id)
);
create index if not exists qb_conc_periodo_idx on public.qb_conciliaciones(periodo_id);
create index if not exists qb_conc_cuenta_idx  on public.qb_conciliaciones(cuenta_id);

create or replace function public.qb_touch_updated() returns trigger as $$
begin new.actualizado_at = now(); return new; end;
$$ language plpgsql;
drop trigger if exists qb_conc_touch on public.qb_conciliaciones;
create trigger qb_conc_touch before update on public.qb_conciliaciones
  for each row execute function public.qb_touch_updated();

-- PIN de acceso (una sola fila). CAMBIAR el valor inicial.
create table if not exists public.qb_config (
  id int primary key default 1,
  pin text not null,
  updated_at timestamptz not null default now(),
  constraint qb_config_singleton check (id = 1)
);
insert into public.qb_config(id, pin) values (1, 'CHERMI-2026') on conflict (id) do nothing;

-- Vista aplanada que consume la Edge Function
create or replace view public.qb_vista as
select co.id as conc_id, co.periodo_id,
  cl.id as cliente_id, cl.nombre as cliente, cl.bookkeeper_default,
  cu.id as cuenta_id, cu.nombre as cuenta, cu.tipo, cu.activo as cuenta_activo, cu.orden,
  co.estado, co.fecha_completado, co.bookkeeper,
  co.doc_payroll, co.junior_input, co.auto_review, co.claude_review,
  co.senior_review, co.memos_checks,
  co.analisis_payroll, co.analisis_pl, co.analisis_balance, co.analisis_ventas,
  co.notas, co.actualizado_at
from public.qb_conciliaciones co
join public.qb_cuentas  cu on cu.id = co.cuenta_id
join public.qb_clientes cl on cl.id = cu.cliente_id;

-- RLS ON, sin políticas (bloqueado para anon/authenticated)
alter table public.qb_periodos       enable row level security;
alter table public.qb_clientes       enable row level security;
alter table public.qb_cuentas        enable row level security;
alter table public.qb_conciliaciones enable row level security;
alter table public.qb_config         enable row level security;
