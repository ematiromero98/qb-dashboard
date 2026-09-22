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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const { pin, action, key } = body ?? {};

  // Auth por PIN (una fila en tx_config)
  const { data: cfg } = await db.from('tx_config').select('pin').eq('id', 1).single();
  if (!cfg || String(pin ?? '') !== String(cfg.pin)) return json({ error: 'PIN incorrecto' }, 401);

  try {
    switch (action) {
      case 'login':
        return json({ ok: true });

      // Lee el documento JSON (todo el estado) de una clave
      case 'get': {
        if (!key) return json({ error: 'falta key' }, 400);
        const { data } = await db.from('tx_kv').select('value, rev').eq('id', key).maybeSingle();
        return json({ value: data?.value ?? null, rev: data?.rev ?? 0 });
      }

      // Guarda/actualiza el documento JSON y sube la versión (rev)
      case 'set': {
        if (!key) return json({ error: 'falta key' }, 400);
        const v = typeof body.value === 'string' ? body.value : JSON.stringify(body.value ?? null);
        const { data: cur } = await db.from('tx_kv').select('rev').eq('id', key).maybeSingle();
        const rev = Number(cur?.rev ?? 0) + 1;
        const { error } = await db.from('tx_kv')
          .upsert({ id: key, value: v, rev, updated_at: new Date().toISOString() });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, rev });
      }

      // Cambiar el PIN (opcional)
      case 'set_pin': {
        const np = String(body.new_pin ?? '').trim();
        if (np.length < 4) return json({ error: 'PIN muy corto' }, 400);
        await db.from('tx_config').update({ pin: np }).eq('id', 1);
        return json({ ok: true });
      }

      default:
        return json({ error: 'acción desconocida' }, 400);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
