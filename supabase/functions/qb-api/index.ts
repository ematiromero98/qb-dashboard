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

// ── Bloqueo por intentos fallidos de PIN (tabla pin_intentos) ──────────────
// Mismo diseño que comprobantes-cel: una fila por (IP, función). El PIN es
// corto y la función es pública: sin esto se podía probar todo el espacio de
// PINs con un script. 5 fallos en 15 min => 15 min bloqueado. Un PIN vacío no
// cuenta (es la app antes de que el usuario cargue el PIN).
const MAX_FALLOS = 5;
const VENTANA_MS = 15 * 60 * 1000;
const BLOQUEO_MS = 15 * 60 * 1000;

// IP real del cliente. Delante de la función está Cloudflare, que pone la IP
// de conexión en cf-connecting-ip y REESCRIBE x-forwarded-for.
function ipDe(req: Request): string {
  const cf = (req.headers.get('cf-connecting-ip') || '').trim();
  if (cf) return cf;
  const xf = (req.headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xf[0] || 'desconocida';
}

// Comparación en tiempo constante (no corta en el primer carácter distinto).
function pinIgual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let d = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) d |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return d === 0;
}

function respBloqueo(seg: number): Response {
  const min = Math.max(1, Math.ceil(seg / 60));
  return json({ error: `Demasiados intentos, probá de nuevo en ${min} minuto${min === 1 ? '' : 's'}`, bloqueado: true, espera: seg }, 429);
}

// Devuelve null si el PIN es válido; si no, la Response de error a devolver.
// `funcion` separa los contadores (ej. 'qb-api' y 'qb-api:admin').
async function checkPin(req: Request, funcion: string, enviado: string, esperado: string, msgError: string): Promise<Response | null> {
  const ip = ipDe(req);
  const ahora = Date.now();
  const { data: row } = await db.from('pin_intentos')
    .select('fallidos, primer_fallo, bloqueado_hasta').eq('ip', ip).eq('funcion', funcion).maybeSingle();

  const hasta = row?.bloqueado_hasta ? new Date(row.bloqueado_hasta).getTime() : 0;
  if (hasta > ahora) return respBloqueo(Math.ceil((hasta - ahora) / 1000));

  if (esperado !== '' && pinIgual(enviado, esperado)) {
    if (row) await db.from('pin_intentos').delete().eq('ip', ip).eq('funcion', funcion);
    return null;
  }
  if (enviado === '') return json({ error: msgError }, 401);

  // Fallo: acumular dentro de la ventana; un bloqueo vencido arranca de cero.
  let fallidos = 1;
  let primer = new Date(ahora).toISOString();
  if (row && !row.bloqueado_hasta && row.primer_fallo && (ahora - new Date(row.primer_fallo).getTime()) < VENTANA_MS) {
    fallidos = Number(row.fallidos || 0) + 1;
    primer = row.primer_fallo;
  }
  const bloqueado_hasta = fallidos >= MAX_FALLOS ? new Date(ahora + BLOQUEO_MS).toISOString() : null;
  await db.from('pin_intentos').upsert(
    { ip, funcion, fallidos, primer_fallo: primer, bloqueado_hasta, actualizado: new Date(ahora).toISOString() },
    { onConflict: 'ip,funcion' },
  );
  // Limpieza oportunista de filas viejas (más de 1 día sin movimiento).
  await db.from('pin_intentos').delete().lt('actualizado', new Date(ahora - 24 * 3600 * 1000).toISOString());

  if (bloqueado_hasta) return respBloqueo(Math.ceil(BLOQUEO_MS / 1000));
  return json({ error: msgError, restantes: MAX_FALLOS - fallidos }, 401);
}

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

  const { data: cfg } = await db.from('qb_config').select('pin, pin_admin').eq('id', 1).single();
  const isAdmin = typeof action === 'string' && action.startsWith('rrhh_');
  if (!cfg) return json({ error: 'PIN incorrecto' }, 401);
  // PIN general y PIN de jefes (rrhh_*) llevan contadores de bloqueo separados.
  const need = String((isAdmin ? cfg.pin_admin : cfg.pin) ?? '');
  const deny = await checkPin(req, isAdmin ? 'qb-api:admin' : 'qb-api', String(pin ?? ''), need, 'PIN incorrecto');
  if (deny) return deny;

  try {
    switch (action) {
      case 'login':
        return json({ ok: true });

      case 'bootstrap': {
        const { data: periodos } = await db.from('qb_periodos').select('*').order('fecha', { ascending: false });
        const { data: clientes } = await db.from('qb_clientes').select('*').order('nombre');
        const { data: auditorias } = await db.from('qb_auditorias').select('*');
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
        return json({ periodos: periodos ?? [], clientes: clientes ?? [], auditorias: auditorias ?? [], periodo_id, filas });
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
        const prioridad = ['Alta','Media','Baja','Sales Tax'].includes(body.prioridad) ? body.prioridad : 'Media';
        const { data, error } = await db.from('qb_clientes')
          .insert({ nombre, bookkeeper_default: body.bookkeeper_default ?? null, prioridad }).select().single();
        if (error) throw error;
        return json({ ok: true, cliente: data });
      }

      case 'update_cliente': {
        const patch = clean(body.patch, new Set(['nombre','bookkeeper_default','activo','comentarios','prioridad','audit_freq','audit_prox','audit_nota']));
        const { data, error } = await db.from('qb_clientes').update(patch).eq('id', body.id).select().single();
        if (error) throw error;
        return json({ ok: true, cliente: data });
      }

      case 'audit_toggle': {
        const cliente_id = body.cliente_id, mes = String(body.mes ?? '').trim();
        if (!cliente_id || !mes) return json({ error: 'faltan datos' }, 400);
        if (body.hecho) {
          const { data, error } = await db.from('qb_auditorias').upsert(
            { cliente_id, mes, hecho: true, fecha: body.fecha ?? new Date().toISOString().slice(0,10), nota: body.nota ?? null },
            { onConflict: 'cliente_id,mes' }).select().single();
          if (error) throw error;
          return json({ ok: true, auditoria: data });
        }
        await db.from('qb_auditorias').delete().eq('cliente_id', cliente_id).eq('mes', mes);
        return json({ ok: true, removed: true });
      }

      case 'add_cuenta': {
        const nombre = String(body.nombre ?? '').trim();
        if (!body.cliente_id || !nombre) return json({ error: 'faltan datos' }, 400);
        const { data: cuenta, error } = await db.from('qb_cuentas')
          .insert({ cliente_id: body.cliente_id, nombre, tipo: body.tipo ?? 'Bank', manual: !!body.manual }).select().single();
        if (error) throw error;
        if (body.periodo_id) {
          await db.from('qb_conciliaciones')
            .insert({ periodo_id: body.periodo_id, cuenta_id: cuenta.id, estado: 'Pendiente de Hacer' })
            .select();
        }
        return json({ ok: true, cuenta });
      }

      case 'update_cuenta': {
        const patch = clean(body.patch, new Set(['nombre','tipo','activo','orden','manual']));
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

      // ============ MÓDULO SUELDOS / EVALUACIONES (jefes) ============
      case 'rrhh_login':
        return json({ ok: true });

      case 'rrhh_bootstrap': {
        const [bandas, personas, tareas, sueldos, evals] = await Promise.all([
          db.from('qb_bandas').select('*').order('nivel'),
          db.from('qb_personas').select('*').order('orden'),
          db.from('qb_tareas').select('*').order('orden'),
          db.from('qb_sueldos').select('*').order('vigente_desde'),
          db.from('qb_evaluaciones').select('*'),
        ]);
        return json({
          bandas: bandas.data ?? [], personas: personas.data ?? [], tareas: tareas.data ?? [],
          sueldos: sueldos.data ?? [], evaluaciones: evals.data ?? [],
        });
      }

      case 'rrhh_update_persona': {
        const patch = clean(body.patch, new Set(['nombre','apellido','rol_perfil','banda','ingreso','sueldo_actual_usd','es_coordinacion','activo','comentarios','orden']));
        const { data, error } = await db.from('qb_personas').update(patch).eq('id', body.id).select().single();
        if (error) throw error;
        return json({ ok: true, persona: data });
      }

      case 'rrhh_add_persona': {
        const nombre = String(body.nombre ?? '').trim();
        if (!nombre) return json({ error: 'falta nombre' }, 400);
        const { data, error } = await db.from('qb_personas').insert({
          nombre, apellido: body.apellido ?? null, rol_perfil: body.rol_perfil ?? null,
          banda: body.banda ?? null, ingreso: body.ingreso ?? null, sueldo_actual_usd: body.sueldo_actual_usd ?? null,
        }).select().single();
        if (error) throw error;
        return json({ ok: true, persona: data });
      }

      case 'rrhh_add_sueldo': {
        const { persona_id, vigente_desde, monto_usd } = body;
        if (!persona_id || !vigente_desde || monto_usd == null) return json({ error: 'faltan datos' }, 400);
        const { data, error } = await db.from('qb_sueldos').upsert(
          { persona_id, vigente_desde, monto_usd, motivo: body.motivo ?? 'Ajuste', nota: body.nota ?? null },
          { onConflict: 'persona_id,vigente_desde' }).select().single();
        if (error) throw error;
        // el más reciente pasa a ser el sueldo actual
        const { data: ult } = await db.from('qb_sueldos').select('monto_usd,vigente_desde')
          .eq('persona_id', persona_id).order('vigente_desde', { ascending: false }).limit(1).single();
        if (ult) await db.from('qb_personas').update({ sueldo_actual_usd: ult.monto_usd }).eq('id', persona_id);
        return json({ ok: true, sueldo: data });
      }

      case 'rrhh_del_sueldo': {
        await db.from('qb_sueldos').delete().eq('id', body.id);
        return json({ ok: true });
      }

      case 'rrhh_add_tarea': {
        const descripcion = String(body.descripcion ?? '').trim();
        if (!body.persona_id || !descripcion) return json({ error: 'faltan datos' }, 400);
        const { data, error } = await db.from('qb_tareas').insert({ persona_id: body.persona_id, descripcion, orden: body.orden ?? 0 }).select().single();
        if (error) throw error;
        return json({ ok: true, tarea: data });
      }

      case 'rrhh_update_tarea': {
        const patch = clean(body.patch, new Set(['descripcion','activo','orden']));
        const { data, error } = await db.from('qb_tareas').update(patch).eq('id', body.id).select().single();
        if (error) throw error;
        return json({ ok: true, tarea: data });
      }

      case 'rrhh_del_tarea': {
        await db.from('qb_tareas').delete().eq('id', body.id);
        return json({ ok: true });
      }

      case 'rrhh_update_eval': {
        const { persona_id, ciclo } = body;
        if (!persona_id || !ciclo) return json({ error: 'faltan datos' }, 400);
        const patch = clean(body.patch, new Set(['fecha','desempeno','confiabilidad','autonomia','actitud','potencial','retencion','mercado','nivel','fortalezas','evidencias','impacto','mejoras','feedback_sugerido','compromisos','seguimiento','notas']));
        const { data, error } = await db.from('qb_evaluaciones').upsert(
          { persona_id, ciclo, ...patch }, { onConflict: 'persona_id,ciclo' }).select().single();
        if (error) throw error;
        return json({ ok: true, evaluacion: data });
      }

      case 'rrhh_set_pin': {
        const np = String(body.new_pin ?? '').trim();
        if (np.length < 4) return json({ error: 'PIN muy corto' }, 400);
        await db.from('qb_config').update({ pin_admin: np }).eq('id', 1);
        return json({ ok: true });
      }

      default:
        return json({ error: 'accion desconocida' }, 400);
    }
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
