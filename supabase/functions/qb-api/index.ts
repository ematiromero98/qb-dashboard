import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CONC_FIELDS = new Set([
  'estado','fecha_completado','bookkeeper',
  'conciliado','revisado','memos_checks','notas',
  // legacy (se mantienen para no perder datos históricos):
  'doc_payroll','junior_input','auto_review','claude_review','senior_review',
  'analisis_payroll','analisis_pl','analisis_balance','analisis_ventas',
]);
const clean = (patch: Record<string, unknown>, allowed: Set<string>) => {
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(patch || {})) if (allowed.has(k)) o[k] = patch[k];
  return o;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const { pin, action } = body ?? {};

  const { data: cfg } = await db.from('qb_config').select('pin').eq('id', 1).single();
  if (!cfg || String(pin ?? '') !== String(cfg.pin)) return json({ error: 'PIN incorrecto' }, 401);

  try {
    switch (action) {
      case 'login':
        return json({ ok: true });

      case 'bootstrap': {
        const { data: periodos } = await db.from('qb_periodos').select('*').order('fecha', { ascending: false });
        const { data: clientes } = await db.from('qb_clientes').select('*').order('nombre');
        let periodo_id = body.periodo_id;
        if (!periodo_id && periodos && periodos.length) {
          periodo_id = (periodos.find((p: any) => p.activo) ?? periodos[0]).id;
        }
        let filas: any[] = [];
        if (periodo_id) {
          const { data } = await db.from('qb_vista').select('*').eq('periodo_id', periodo_id)
            .order('orden').order('cuenta');
          filas = data ?? [];
        }
        return json({ periodos: periodos ?? [], clientes: clientes ?? [], periodo_id, filas });
      }

      case 'update_conc': {
        const patch = clean(body.patch, CONC_FIELDS);
        if (!body.id || !Object.keys(patch).length) return json({ error: 'nada para actualizar' }, 400);
        const { data, error } = await db.from('qb_conciliaciones').update(patch).eq('id', body.id).select().single();
        if (error) throw error;
        return json({ ok: true, row: data });
      }

      case 'add_cliente': {
        const nombre = String(body.nombre ?? '').trim();
        if (!nombre) return json({ error: 'falta nombre' }, 400);
        const { data, error } = await db.from('qb_clientes')
          .insert({ nombre, bookkeeper_default: body.bookkeeper_default ?? null }).select().single();
        if (error) throw error;
        return json({ ok: true, cliente: data });
      }

      case 'update_cliente': {
        const patch = clean(body.patch, new Set(['nombre','bookkeeper_default','activo']));
        const { data, error } = await db.from('qb_clientes').update(patch).eq('id', body.id).select().single();
        if (error) throw error;
        return json({ ok: true, cliente: data });
      }

      case 'add_cuenta': {
        const nombre = String(body.nombre ?? '').trim();
        if (!body.cliente_id || !nombre) return json({ error: 'faltan datos' }, 400);
        const { data: cuenta, error } = await db.from('qb_cuentas')
          .insert({ cliente_id: body.cliente_id, nombre, tipo: body.tipo ?? 'Bank' }).select().single();
        if (error) throw error;
        if (body.periodo_id) {
          await db.from('qb_conciliaciones')
            .insert({ periodo_id: body.periodo_id, cuenta_id: cuenta.id, estado: 'Pendiente de Hacer' })
            .select();
        }
        return json({ ok: true, cuenta });
      }

      case 'update_cuenta': {
        const patch = clean(body.patch, new Set(['nombre','tipo','activo','orden']));
        const { data, error } = await db.from('qb_cuentas').update(patch).eq('id', body.id).select().single();
        if (error) throw error;
        return json({ ok: true, cuenta: data });
      }

      case 'new_periodo': {
        const etiqueta = String(body.etiqueta ?? '').trim();
        const fecha = String(body.fecha ?? '').trim();
        if (!etiqueta || !fecha) return json({ error: 'faltan etiqueta/fecha' }, 400);
        const { data: per, error } = await db.from('qb_periodos')
          .insert({ etiqueta, fecha, activo: true }).select().single();
        if (error) throw error;
        const { data: cuentas } = await db.from('qb_cuentas').select('id, cliente_id').eq('activo', true);
        if (cuentas && cuentas.length) {
          const { data: cls } = await db.from('qb_clientes').select('id, bookkeeper_default');
          const bkOf: Record<number, string | null> = {};
          (cls ?? []).forEach((c: any) => (bkOf[c.id] = c.bookkeeper_default));
          const rows = cuentas.map((cu: any) => ({
            periodo_id: per.id, cuenta_id: cu.id, estado: 'Pendiente de Hacer', bookkeeper: bkOf[cu.cliente_id] ?? null,
          }));
          for (let i = 0; i < rows.length; i += 500) {
            await db.from('qb_conciliaciones').upsert(rows.slice(i, i + 500), { onConflict: 'periodo_id,cuenta_id', ignoreDuplicates: true });
          }
        }
        return json({ ok: true, periodo: per });
      }

      case 'set_pin': {
        const np = String(body.new_pin ?? '').trim();
        if (np.length < 4) return json({ error: 'PIN muy corto' }, 400);
        await db.from('qb_config').update({ pin: np, updated_at: new Date().toISOString() }).eq('id', 1);
        return json({ ok: true });
      }

      default:
        return json({ error: 'accion desconocida' }, 400);
    }
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
