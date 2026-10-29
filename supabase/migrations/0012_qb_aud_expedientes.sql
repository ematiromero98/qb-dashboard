-- ============================================================
-- QB DASHBOARD — Expedientes de auditoría por cliente
-- Cada auditoría (qb_aud_runs) guarda qué se revisó, con qué
-- archivos (entrada) y qué salió (informe, conclusiones,
-- hallazgos). Por cliente se arma además una memoria (datos
-- firmes que la próxima auditoría tiene que saber) y notas
-- libres. La agenda/calendario sigue en qb_auditorias.
-- Los archivos van al bucket privado 'qb-auditorias':
--   {cliente_id}/{run_id}/{input|output}/{archivo}
-- RLS ON sin políticas => solo la Edge Function (service_role).
-- ============================================================

create table if not exists chermisqui.qb_aud_runs (
  id             bigint generated always as identity primary key,
  cliente_id     bigint not null references chermisqui.qb_clientes(id) on delete cascade,
  periodo_desde  date,
  periodo_hasta  date,
  fecha          date not null default current_date,      -- cuándo se hizo
  estado         text not null default 'Borrador' check (estado in ('Borrador','Final')),
  semaforo       text check (semaforo in ('verde','amarillo','rojo')),
  resumen        text,                                     -- 2-3 líneas
  conclusiones   text,                                     -- texto largo (markdown)
  metricas       jsonb not null default '{}'::jsonb,       -- cifras clave del output
  skill_version  text,                                     -- versión del skill que la hizo
  auditor        text,
  creado_at      timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);
create index if not exists qb_aud_runs_cliente_idx on chermisqui.qb_aud_runs(cliente_id, fecha desc);

create table if not exists chermisqui.qb_aud_archivos (
  id           bigint generated always as identity primary key,
  run_id       bigint not null references chermisqui.qb_aud_runs(id) on delete cascade,
  cliente_id   bigint not null references chermisqui.qb_clientes(id) on delete cascade,
  rol          text not null check (rol in ('input','output')),
  tipo         text not null,        -- Transaction Detail, Profit and Loss, Balance Sheet, Informe, Papel de trabajo, Otro
  nombre       text not null,        -- nombre original del archivo
  storage_path text not null unique, -- ruta dentro del bucket qb-auditorias
  bytes        bigint,
  mime         text,
  creado_at    timestamptz not null default now()
);
create index if not exists qb_aud_archivos_run_idx on chermisqui.qb_aud_archivos(run_id);

create table if not exists chermisqui.qb_aud_hallazgos (
  id               bigint generated always as identity primary key,
  run_id           bigint not null references chermisqui.qb_aud_runs(id) on delete cascade,
  cliente_id       bigint not null references chermisqui.qb_clientes(id) on delete cascade,
  codigo           text,             -- código del control del skill
  area             text,             -- Bancos, Ventas, Payroll, Balance…
  cuenta           text,
  monto            numeric(14,2),
  severidad        text not null default 'Media' check (severidad in ('Alta','Media','Baja')),
  titulo           text not null,
  detalle          text,
  recomendacion    text,
  estado           text not null default 'Abierto' check (estado in ('Abierto','Resuelto','Descartado')),
  resuelto_fecha   date,
  resuelto_run_id  bigint references chermisqui.qb_aud_runs(id) on delete set null,
  creado_at        timestamptz not null default now()
);
create index if not exists qb_aud_hallazgos_cliente_idx on chermisqui.qb_aud_hallazgos(cliente_id, estado);
create index if not exists qb_aud_hallazgos_run_idx on chermisqui.qb_aud_hallazgos(run_id);

-- Memoria del cliente: datos firmes ("el payroll va por Gusto"). La IA
-- propone (estado Propuesta) y el usuario aprueba (Vigente) o archiva.
create table if not exists chermisqui.qb_aud_memoria (
  id             bigint generated always as identity primary key,
  cliente_id     bigint not null references chermisqui.qb_clientes(id) on delete cascade,
  tema           text not null default 'General',
  contenido      text not null,
  estado         text not null default 'Vigente' check (estado in ('Vigente','Propuesta','Archivada')),
  origen_run_id  bigint references chermisqui.qb_aud_runs(id) on delete set null,
  creado_at      timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);
create index if not exists qb_aud_memoria_cliente_idx on chermisqui.qb_aud_memoria(cliente_id);

create table if not exists chermisqui.qb_aud_notas (
  id         bigint generated always as identity primary key,
  cliente_id bigint not null references chermisqui.qb_clientes(id) on delete cascade,
  run_id     bigint references chermisqui.qb_aud_runs(id) on delete set null,
  fecha      date not null default current_date,
  autor      text,
  texto      text not null,
  creado_at  timestamptz not null default now()
);
create index if not exists qb_aud_notas_cliente_idx on chermisqui.qb_aud_notas(cliente_id, fecha desc);

alter table chermisqui.qb_aud_runs      enable row level security;
alter table chermisqui.qb_aud_archivos  enable row level security;
alter table chermisqui.qb_aud_hallazgos enable row level security;
alter table chermisqui.qb_aud_memoria   enable row level security;
alter table chermisqui.qb_aud_notas     enable row level security;
revoke all on chermisqui.qb_aud_runs, chermisqui.qb_aud_archivos, chermisqui.qb_aud_hallazgos,
              chermisqui.qb_aud_memoria, chermisqui.qb_aud_notas from anon, authenticated;
grant all on chermisqui.qb_aud_runs, chermisqui.qb_aud_archivos, chermisqui.qb_aud_hallazgos,
             chermisqui.qb_aud_memoria, chermisqui.qb_aud_notas to service_role;

-- Bucket privado (50 MB por archivo). Sin políticas en storage.objects para
-- este bucket: solo se entra con URLs firmadas que da la Edge Function.
insert into storage.buckets (id, name, public, file_size_limit)
values ('qb-auditorias', 'qb-auditorias', false, 52428800)
on conflict (id) do nothing;
