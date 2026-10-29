-- ============================================================
-- QB DASHBOARD — Auditoría integral (skill auditoria-qb)
-- Cada auditoría corre el catálogo completo de controles
-- (qb_aud_controles, uno por fila, editable por el auditor).
-- A Dennis le llega solo el reporte resumido (reporte_dennis):
-- los 9 pasos + los hallazgos marcados en_resumen.
-- ============================================================

-- Auditorías: tipo, estados del circuito con Dennis y textos
-- de salida (reporte resumido y mail al cliente).
alter table chermisqui.qb_aud_runs drop constraint if exists qb_aud_runs_estado_check;
update chermisqui.qb_aud_runs set estado = case estado when 'Final' then 'Cerrada' when 'Borrador' then 'En curso' else estado end;
alter table chermisqui.qb_aud_runs alter column estado set default 'En curso';
alter table chermisqui.qb_aud_runs add constraint qb_aud_runs_estado_check
  check (estado in ('En curso','Enviada a Dennis','Hecho','Cerrada'));
alter table chermisqui.qb_aud_runs add column if not exists tipo text not null default 'Integral'
  check (tipo in ('Integral','Mensual','Cierre anual'));
alter table chermisqui.qb_aud_runs add column if not exists reporte_dennis text;  -- reporte resumido (formato 9 pasos)
alter table chermisqui.qb_aud_runs add column if not exists mail_cliente text;    -- en inglés, lo envía Breana

-- Resultado de cada control del catálogo en una auditoría.
create table if not exists chermisqui.qb_aud_controles (
  id             bigint generated always as identity primary key,
  run_id         bigint not null references chermisqui.qb_aud_runs(id) on delete cascade,
  cliente_id     bigint not null references chermisqui.qb_clientes(id) on delete cascade,
  codigo         text not null,          -- A01..G06 (catálogo del skill)
  modulo         text,                   -- A Insumos, B Conciliaciones, C P&L, D Diario, E Activos, F Clasificación, G Red flags
  control        text not null,
  paso_dennis    text,                   -- 0..9 / Lista de efectivo / Entrega; null = solo detallado
  criterio       text,
  estado         text not null default 'Pendiente'
                 check (estado in ('OK','DIFERENCIA','SIN DATO','N/A','Pendiente')),
  detalle        text,
  fuente         text,                   -- con qué se verificó
  editado        boolean not null default false,  -- lo cambió el auditor a mano
  actualizado_at timestamptz not null default now(),
  unique (run_id, codigo)
);
create index if not exists qb_aud_controles_run_idx on chermisqui.qb_aud_controles(run_id);

-- Hallazgos: destino (circuito de Dennis), si va al reporte
-- resumido y el estado "Repetido" que marca Dennis.
alter table chermisqui.qb_aud_hallazgos drop constraint if exists qb_aud_hallazgos_estado_check;
alter table chermisqui.qb_aud_hallazgos add constraint qb_aud_hallazgos_estado_check
  check (estado in ('Abierto','Repetido','Resuelto','Descartado'));
alter table chermisqui.qb_aud_hallazgos add column if not exists destino text
  check (destino in ('AJUSTE','CLIENTE','CIERRE ANUAL','DEFINIR','DEFINIDO','CONTROL'));
alter table chermisqui.qb_aud_hallazgos add column if not exists en_resumen boolean not null default false;

-- Memoria: de dónde salió la regla y a qué control aplica.
alter table chermisqui.qb_aud_memoria add column if not exists origen text;   -- Dennis | Matías | Cliente | Auditoría
alter table chermisqui.qb_aud_memoria add column if not exists control text;  -- código del catálogo

alter table chermisqui.qb_aud_controles enable row level security;
revoke all on chermisqui.qb_aud_controles from anon, authenticated;
grant all on chermisqui.qb_aud_controles to service_role;
