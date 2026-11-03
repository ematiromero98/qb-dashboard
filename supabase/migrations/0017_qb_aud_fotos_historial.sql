-- ============================================================
-- QB DASHBOARD — Mail al cliente con fotos e historial de correcciones
-- · hallazgos.mail_texto: el pedido al cliente, en inglés.
-- · qb_aud_fotos: capturas del mail (QuickBooks / Extracto) y de lo
--   corregido. Van al bucket privado qb-auditorias.
-- · qb_aud_log: qué se corrigió, quién y cuándo. Guarda una copia de
--   los datos de la fila para no perderlos si la fila cambia.
-- Solo agrega: no cambia nada de lo que ya existe.
-- ============================================================

alter table chermisqui.qb_aud_hallazgos add column if not exists mail_texto text;

create table if not exists chermisqui.qb_aud_fotos (
  id            bigint generated always as identity primary key,
  cliente_id    bigint not null references chermisqui.qb_clientes(id) on delete cascade,
  run_id        bigint not null references chermisqui.qb_aud_runs(id) on delete cascade,
  hallazgo_id   bigint references chermisqui.qb_aud_hallazgos(id) on delete cascade,
  correccion_id bigint references chermisqui.qb_aud_correcciones(id) on delete cascade,
  tipo          text not null check (tipo in ('QuickBooks','Extracto','Correccion')),
  nombre        text not null,
  storage_path  text not null unique,
  bytes         bigint,
  mime          text,
  subido_por    text,
  creado_at     timestamptz not null default now()
);
create index if not exists qb_aud_fotos_cli_idx on chermisqui.qb_aud_fotos(cliente_id);
alter table chermisqui.qb_aud_fotos enable row level security;
revoke all on chermisqui.qb_aud_fotos from anon, authenticated;
grant all on chermisqui.qb_aud_fotos to service_role;

create table if not exists chermisqui.qb_aud_log (
  id            bigint generated always as identity primary key,
  cliente_id    bigint not null references chermisqui.qb_clientes(id) on delete cascade,
  run_id        bigint not null references chermisqui.qb_aud_runs(id) on delete cascade,
  hallazgo_id   bigint references chermisqui.qb_aud_hallazgos(id) on delete set null,
  correccion_id bigint references chermisqui.qb_aud_correcciones(id) on delete set null,
  ref           text,      -- número del punto al momento del cambio
  fila          text,      -- fecha · num · payee al momento del cambio
  monto         numeric,
  accion        text not null,
  nota          text,
  quien         text,
  creado_at     timestamptz not null default now()
);
create index if not exists qb_aud_log_cli_idx on chermisqui.qb_aud_log(cliente_id, creado_at desc);
alter table chermisqui.qb_aud_log enable row level security;
revoke all on chermisqui.qb_aud_log from anon, authenticated;
grant all on chermisqui.qb_aud_log to service_role;

-- Lo que ya estaba marcado entra al historial con su quién y cuándo.
insert into chermisqui.qb_aud_log (cliente_id, run_id, hallazgo_id, correccion_id, ref, fila, monto, accion, nota, quien, creado_at)
select c.cliente_id, c.run_id, c.hallazgo_id, c.id, h.ref,
       concat_ws(' · ', nullif(c.fecha,''), nullif(c.num,''), nullif(c.payee,'')), c.monto, c.estado, c.nota, c.hecho_por, c.hecho_at
from chermisqui.qb_aud_correcciones c
join chermisqui.qb_aud_hallazgos h on h.id = c.hallazgo_id
where c.hecho_at is not null
  and not exists (select 1 from chermisqui.qb_aud_log l where l.correccion_id = c.id);
