-- ============================================================
-- Módulo SUELDOS / EVALUACIONES (área de jefes) — QB Dashboard
-- Confidencial: RLS on sin políticas; acceso por Edge Function
-- validando el PIN de jefes (qb_config.pin_admin).
-- ============================================================

-- 2º PIN (jefes). El valor real se setea aparte y se cambia desde la UI (no se versiona).
alter table public.qb_config add column if not exists pin_admin text;
update public.qb_config set pin_admin = 'CAMBIAR-EN-UI' where id = 1 and (pin_admin is null or pin_admin = '');

-- Bandas salariales (Escala de Aumentos)
create table if not exists public.qb_bandas (
  nivel       int primary key,        -- 1..5
  nombre      text not null,
  desde_usd   int,
  hasta_usd   int,
  descripcion text,
  requisitos  text
);

-- Legajo del equipo
create table if not exists public.qb_personas (
  id                bigint generated always as identity primary key,
  nombre            text not null,
  apellido          text,
  rol_perfil        text,
  banda             int references public.qb_bandas(nivel),
  ingreso           date,
  sueldo_actual_usd numeric,
  es_coordinacion   boolean not null default false,
  activo            boolean not null default true,
  orden             int not null default 0,
  comentarios       text,
  creado_at         timestamptz not null default now()
);

-- Historial de sueldos / aumentos
create table if not exists public.qb_sueldos (
  id            bigint generated always as identity primary key,
  persona_id    bigint not null references public.qb_personas(id) on delete cascade,
  vigente_desde date not null,
  monto_usd     numeric not null,
  motivo        text,   -- Ingreso | Escala mensual | Aumento Junio | Aumento Diciembre | Ajuste | Promoción de banda
  nota          text,
  creado_at     timestamptz not null default now(),
  unique(persona_id, vigente_desde)
);
create index if not exists qb_sueldos_persona_idx on public.qb_sueldos(persona_id);

-- Tareas a cargo
create table if not exists public.qb_tareas (
  id          bigint generated always as identity primary key,
  persona_id  bigint not null references public.qb_personas(id) on delete cascade,
  descripcion text not null,
  activo      boolean not null default true,
  orden       int not null default 0
);
create index if not exists qb_tareas_persona_idx on public.qb_tareas(persona_id);

-- Evaluaciones semestrales (Jun / Dic) + feedback
create table if not exists public.qb_evaluaciones (
  id           bigint generated always as identity primary key,
  persona_id   bigint not null references public.qb_personas(id) on delete cascade,
  ciclo        text not null,        -- '2026-H1' (Jun-26), '2026-H2' (Dic-26)
  fecha        date,
  desempeno int, confiabilidad int, autonomia int, actitud int, potencial int,   -- 1..5
  retencion int, mercado int,        -- factores de compensación 1..5
  nivel        text,
  fortalezas text, evidencias text, impacto text, mejoras text,
  feedback_sugerido text, compromisos text, seguimiento text, notas text,
  actualizado_at timestamptz not null default now(),
  unique(persona_id, ciclo)
);
create index if not exists qb_eval_persona_idx on public.qb_evaluaciones(persona_id);

drop trigger if exists qb_eval_touch on public.qb_evaluaciones;
create trigger qb_eval_touch before update on public.qb_evaluaciones
  for each row execute function public.qb_touch_updated();

-- RLS on (sin políticas) — solo la Edge Function (service_role) con PIN de jefes
alter table public.qb_bandas       enable row level security;
alter table public.qb_personas     enable row level security;
alter table public.qb_sueldos      enable row level security;
alter table public.qb_tareas       enable row level security;
alter table public.qb_evaluaciones enable row level security;
