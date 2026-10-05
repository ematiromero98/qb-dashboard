-- Bloqueo por intentos fallidos de PIN en las Edge Functions del proyecto
-- EMPLOYEE-PRO (ffczbimnuodzcbgsdxbx): qb-api, tx-api, chcal-api, cal-ausencias.
-- Mismo diseño que comprobantes-cel: una fila por (IP, función); 5 fallos en
-- 15 min => 15 min bloqueado. La tabla es compartida por las 4 funciones (este
-- mismo archivo está en qb-dashboard, chermisqui-control-dias y
-- calendario-ausencias; es idempotente).
-- Solo la usan las funciones con service_role: RLS habilitado SIN políticas =
-- ni anon ni authenticated pueden leerla ni escribirla.
create table if not exists public.pin_intentos (
  ip              text        not null,
  funcion         text        not null,
  fallidos        integer     not null default 0,
  primer_fallo    timestamptz not null default now(),
  bloqueado_hasta timestamptz,
  actualizado     timestamptz not null default now(),
  primary key (ip, funcion)
);
alter table public.pin_intentos enable row level security;
revoke all on table public.pin_intentos from anon, authenticated;
comment on table public.pin_intentos is
  'Edge Functions (qb-api, qb-api:admin, tx-api, chcal-api, cal-ausencias): intentos fallidos de PIN por IP (5 fallos en 15 min => bloqueo 15 min)';
