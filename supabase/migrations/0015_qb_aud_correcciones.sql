-- ============================================================
-- QB DASHBOARD — Revisión: qué corregir, fila por fila
-- Cada hallazgo de una auditoría trae las transacciones a
-- corregir (una fila por transacción). El equipo las tilda en
-- la pestaña «Revisión» del expediente; cada cambio queda con
-- quién y cuándo. Cuando todas las filas de un hallazgo están
-- resueltas, el hallazgo pasa a Resuelto solo (qb-api).
-- Solo agrega: no cambia nada de lo que ya existe.
-- ============================================================

-- Hallazgos: dónde van en la Revisión y la respuesta de Dennis.
alter table chermisqui.qb_aud_hallazgos add column if not exists paso text;   -- paso de Dennis: '0'..'10', 'T' (tarjetas y bancos) u 'otros'
alter table chermisqui.qb_aud_hallazgos add column if not exists ref text;    -- número en la Revisión: '2.1', 'T.2', 'O.4'
alter table chermisqui.qb_aud_hallazgos add column if not exists orden int;   -- orden dentro de la Revisión
alter table chermisqui.qb_aud_hallazgos add column if not exists respuesta_dennis text;  -- lo que definió Dennis (destino DEFINIR → DEFINIDO)

-- Transacciones a corregir.
create table if not exists chermisqui.qb_aud_correcciones (
  id             bigint generated always as identity primary key,
  hallazgo_id    bigint not null references chermisqui.qb_aud_hallazgos(id) on delete cascade,
  run_id         bigint not null references chermisqui.qb_aud_runs(id) on delete cascade,
  cliente_id     bigint not null references chermisqui.qb_clientes(id) on delete cascade,
  orden          int not null default 0,
  clave          text not null,          -- fecha|num|payee|monto normalizados: reconoce la fila al volver a correr la auditoría
  fecha          text,                   -- MM/DD/AAAA, como en QuickBooks
  num            text,
  payee          text,
  monto          numeric,
  de             text,                   -- dónde está hoy (cuenta, payee, memo…)
  a              text,                   -- adónde va / qué hacer
  a_editado      boolean not null default false,  -- el «a» lo cambió una persona: no se pisa al volver a correr
  estado         text not null default 'Pendiente'
                 check (estado in ('Pendiente','Corregido','Hecho distinto','No corresponde','Ya no aparece')),
  nota           text,                   -- obligatoria en «Hecho distinto» y «No corresponde»
  origen         text not null default 'Auditoría' check (origen in ('Auditoría','Manual')),
  nueva          boolean not null default false,  -- apareció al volver a correr la auditoría
  hecho_por      text,
  hecho_at       timestamptz,
  actualizado_at timestamptz not null default now()
);
create index if not exists qb_aud_correcciones_hall_idx on chermisqui.qb_aud_correcciones(hallazgo_id);
create index if not exists qb_aud_correcciones_cli_idx on chermisqui.qb_aud_correcciones(cliente_id);

alter table chermisqui.qb_aud_correcciones enable row level security;
revoke all on chermisqui.qb_aud_correcciones from anon, authenticated;
grant all on chermisqui.qb_aud_correcciones to service_role;
