-- ============================================================
-- 0022 · Una sola auditoría abierta por cliente (Matías, 9-nov-2026)
-- · Abierta = «En curso» o «Enviada a Dennis».
-- · Si se abre una nueva (o se reabre otra) sin haber cerrado la anterior,
--   la anterior pasa a «Cerrada», aunque sea de otro período.
-- · Sus puntos todavía abiertos pasan a «Descartado» (la auditoría nueva
--   vuelve a correr todo y saca lo que siga mal) y queda en el historial.
-- · Índice único parcial: la base no acepta dos abiertas del mismo cliente.
-- ============================================================

create or replace function chermisqui.qb_aud_cerrar_anteriores()
returns trigger
language plpgsql
set search_path = chermisqui, pg_temp
as $$
declare
  v record;
begin
  for v in
    select id from chermisqui.qb_aud_runs
    where cliente_id = new.cliente_id
      and id is distinct from new.id
      and estado in ('En curso', 'Enviada a Dennis')
  loop
    insert into chermisqui.qb_aud_log (cliente_id, run_id, hallazgo_id, ref, accion, nota, quien)
    select h.cliente_id, h.run_id, h.id, h.ref, 'Descartado',
           'Auditoría cerrada al abrir otra del mismo cliente', 'Automático'
    from chermisqui.qb_aud_hallazgos h
    where h.run_id = v.id and h.estado in ('Abierto', 'Repetido');

    update chermisqui.qb_aud_hallazgos set estado = 'Descartado'
    where run_id = v.id and estado in ('Abierto', 'Repetido');

    update chermisqui.qb_aud_runs set estado = 'Cerrada' where id = v.id;

    insert into chermisqui.qb_aud_log (cliente_id, run_id, accion, nota, quien)
    values (new.cliente_id, v.id, 'Auditoría cerrada',
            'Se cerró sola al abrir otra auditoría del mismo cliente', 'Automático');
  end loop;
  return new;
end;
$$;

revoke all on function chermisqui.qb_aud_cerrar_anteriores() from public, anon, authenticated;

drop trigger if exists qb_aud_runs_una_abierta on chermisqui.qb_aud_runs;
create trigger qb_aud_runs_una_abierta
before insert or update of estado on chermisqui.qb_aud_runs
for each row
when (new.estado in ('En curso', 'Enviada a Dennis'))
execute function chermisqui.qb_aud_cerrar_anteriores();

-- Lo que hoy está duplicado: queda abierta la más nueva de cada cliente.
do $$
declare v record;
begin
  for v in
    select distinct on (cliente_id) id from chermisqui.qb_aud_runs
    where estado in ('En curso', 'Enviada a Dennis')
      and cliente_id in (select cliente_id from chermisqui.qb_aud_runs
                         where estado in ('En curso', 'Enviada a Dennis')
                         group by cliente_id having count(*) > 1)
    order by cliente_id, fecha desc, id desc
  loop
    -- re-guardar el estado de la más nueva dispara el cierre de las demás
    update chermisqui.qb_aud_runs set estado = estado where id = v.id;
  end loop;
end $$;

create unique index if not exists qb_aud_runs_una_abierta_idx
  on chermisqui.qb_aud_runs (cliente_id)
  where estado in ('En curso', 'Enviada a Dennis');
