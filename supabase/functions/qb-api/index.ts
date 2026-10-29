import { createClient } from './db.ts'; // cliente PostgREST local, sin dependencias (ver db.ts)

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
  { db: { schema: 'chermisqui' } }, // tablas en el schema 'chermisqui'
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
  'info_pedida','info_pedida_fecha','info_pedida_detalle','info_respondida_fecha',
  // legacy (se mantienen para no perder datos históricos):
  'doc_payroll','junior_input','auto_review','claude_review','senior_review',
  'analisis_payroll','analisis_pl','analisis_balance','analisis_ventas',
]);
// Error 500 genérico: el detalle va solo al log de la función.
const errInterno = (donde: string, e: unknown) => {
  console.error(`qb-api ${donde}:`, e);
  return json({ error: 'Error interno, probá de nuevo' }, 500);
};
const PIN_MIN = 8;
const PIN_MAX = 64;
const validarPinNuevo = (np: string): string | null =>
  np.length < PIN_MIN ? `El PIN nuevo debe tener al menos ${PIN_MIN} caracteres`
    : np.length > PIN_MAX ? 'PIN demasiado largo' : null;

const clean = (patch: Record<string, unknown>, allowed: Set<string>) => {
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(patch || {})) if (allowed.has(k)) o[k] = patch[k];
  return o;
};

// ── Expedientes de auditoría ───────────────────────────────────────────────
// Los archivos van al bucket privado 'qb-auditorias' y solo se entra con URLs
// firmadas que da esta función (subida y descarga, vencen solas).
const SB_URL = Deno.env.get('SUPABASE_URL')!.replace(/\/$/, '');
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUD_BUCKET = 'qb-auditorias';
const AUD_TIPOS = [
  // entrada
  'Transaction Detail', 'Profit and Loss', 'Balance Sheet', 'Extracto bancario', 'Tarjeta', 'Cash Analysis', 'Reporte de nómina',
  // salida
  'Reporte resumido', 'Reporte detallado', 'Reporte financiero', 'Mail al cliente', 'Informe', 'Papel de trabajo', 'Otro',
];
const RUN_FIELDS = new Set(['tipo','periodo_desde','periodo_hasta','fecha','estado','semaforo','resumen','conclusiones','metricas','skill_version','auditor','reporte_dennis','mail_cliente']);
const HALL_FIELDS = new Set(['codigo','area','cuenta','monto','severidad','titulo','detalle','recomendacion','estado','destino','en_resumen']);
const HALL_INS = ['codigo','area','cuenta','monto','severidad','titulo','detalle','recomendacion','estado','destino','en_resumen'];
const HALL_ABIERTOS = ['Abierto', 'Repetido'];
const MEM_FIELDS = new Set(['tema','contenido','estado','origen','control']);
// Resultado de cada control del catálogo (qb_aud_controles).
const CTRL_INS = ['codigo','modulo','control','paso_dennis','criterio','estado','detalle','fuente'];
const CTRL_FIELDS = new Set(['estado','detalle','fuente']);
// Estados de la auditoría que cuentan como hecha en la agenda.
const RUN_HECHA = ['Enviada a Dennis', 'Hecho', 'Cerrada'];

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const nombreSeguro = (n: string) =>
  String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\- ]+/g, '')
    .trim().replace(/\s+/g, '_').slice(-120) || 'archivo';

async function storage(method: string, path: string, body?: unknown) {
  const r = await fetch(`${SB_URL}/storage/v1/${path}`, {
    method,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`storage ${r.status}: ${JSON.stringify(d)}`);
  return d;
}

// Una auditoría enviada a Dennis (o más adelante) queda marcada como hecha en
// la agenda (qb_auditorias), en el mes de su fecha.
async function marcarAgenda(run: any) {
  if (!RUN_HECHA.includes(run?.estado) || !run.fecha) return;
  await db.from('qb_auditorias').upsert(
    { cliente_id: run.cliente_id, mes: String(run.fecha).slice(0, 7), hecho: true, fecha: run.fecha },
    { onConflict: 'cliente_id,mes' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const { pin, action } = body ?? {};

  const { data: cfg } = await db.from('qb_config').select('pin, pin_admin, pin_aud').eq('id', 1).single();
  // Acciones de jefes: el módulo rrhh_* y cambiar el PIN general (set_pin).
  // Con el PIN general solo no se puede cambiar el PIN de todos.
  // Los expedientes de auditoría (aud_*) tienen su propio PIN (pin_aud; si
  // está vacío, rige el de jefes).
  const isAud = typeof action === 'string' && action.startsWith('aud_');
  const isAdmin = typeof action === 'string' && (action.startsWith('rrhh_') || action === 'set_pin');
  if (!cfg) return json({ error: 'PIN incorrecto' }, 401);
  // Cada PIN lleva su propio contador de bloqueo.
  const need = String((isAud ? (cfg.pin_aud || cfg.pin_admin) : isAdmin ? cfg.pin_admin : cfg.pin) ?? '');
  const deny = await checkPin(req, isAud ? 'qb-api:aud' : isAdmin ? 'qb-api:admin' : 'qb-api', String(pin ?? ''), need, 'PIN incorrecto');
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
          const { data: cls } = await db.from('qb_clientes').select('id, bookkeeper_default, activo');
          const bkOf: Record<number, string | null> = {};
          const cliActivo: Record<number, boolean> = {};
          (cls ?? []).forEach((c: any) => { bkOf[c.id] = c.bookkeeper_default; cliActivo[c.id] = c.activo !== false; });

          // Mes anterior (el último creado antes de este): de ahí se arrastran
          // las notas, las cuentas que estaban Inactive y los pedidos de
          // información que siguen abiertos (sin responder).
          const prevOf: Record<number, any> = {};
          const { data: prev } = await db.from('qb_periodos').select('id')
            .lt('id', per.id).order('id', { ascending: false }).limit(1).maybeSingle();
          if (prev) {
            for (let from = 0; ; from += 1000) {
              const { data: pc, error: e2 } = await db.from('qb_conciliaciones')
                .select('cuenta_id, notas, estado, info_pedida, info_pedida_fecha, info_pedida_detalle')
                .eq('periodo_id', prev.id).order('id').range(from, from + 999);
              if (e2) throw e2;
              (pc ?? []).forEach((r: any) => (prevOf[r.cuenta_id] = r));
              if (!pc || pc.length < 1000) break;
            }
          }

          const rows = cuentas.map((cu: any) => {
            const p = prevOf[cu.id];
            const inactiva = !cliActivo[cu.cliente_id] || p?.estado === 'Inactive';
            const pedida = !inactiva && p?.info_pedida === true;
            return {
              periodo_id: per.id, cuenta_id: cu.id, estado: inactiva ? 'Inactive' : 'Pendiente de Hacer',
              bookkeeper: bkOf[cu.cliente_id] ?? null, notas: p?.notas || null,
              info_pedida: pedida,
              info_pedida_fecha: pedida ? p.info_pedida_fecha : null,
              info_pedida_detalle: pedida ? p.info_pedida_detalle : null,
            };
          });
          for (let i = 0; i < rows.length; i += 500) {
            await db.from('qb_conciliaciones').upsert(rows.slice(i, i + 500), { onConflict: 'periodo_id,cuenta_id', ignoreDuplicates: true });
          }
        }
        return json({ ok: true, periodo: per });
      }

      // ============ EXPEDIENTES DE AUDITORÍA (jefes) ============
      // Las usa la web y también el skill de auditoría de Claude Code.
      case 'aud_login':
        return json({ ok: true });

      // Cambia el PIN de expedientes. Se autoriza con el PIN de expedientes actual (ver isAud).
      case 'aud_set_pin': {
        const np = String(body.new_pin ?? '').trim();
        const malo = validarPinNuevo(np);
        if (malo) return json({ error: malo }, 400);
        const { error } = await db.from('qb_config').update({ pin_aud: np, updated_at: new Date().toISOString() }).eq('id', 1);
        if (error) return errInterno('aud_set_pin', error);
        return json({ ok: true });
      }

      // Para la lista de clientes: todas las auditorías (cabecera) y los
      // hallazgos abiertos (incluye los Repetidos).
      case 'aud_resumen': {
        const [runs, hall] = await Promise.all([
          db.from('qb_aud_runs').select('id, cliente_id, fecha, periodo_desde, periodo_hasta, estado, semaforo')
            .order('fecha', { ascending: false }),
          db.from('qb_aud_hallazgos').select('cliente_id, severidad').in('estado', HALL_ABIERTOS),
        ]);
        if (runs.error) throw runs.error;
        if (hall.error) throw hall.error;
        return json({ runs: runs.data ?? [], abiertos: hall.data ?? [] });
      }

      // Expediente completo de un cliente. Es también el contexto que lee el
      // skill antes de empezar una auditoría.
      case 'aud_cliente': {
        const cid = Number(body.cliente_id);
        if (!cid) return json({ error: 'falta cliente_id' }, 400);
        const [runs, archivos, hallazgos, memoria, notas, controles] = await Promise.all([
          db.from('qb_aud_runs').select('*').eq('cliente_id', cid).order('fecha', { ascending: false }).order('id', { ascending: false }),
          db.from('qb_aud_archivos').select('*').eq('cliente_id', cid).order('id'),
          db.from('qb_aud_hallazgos').select('*').eq('cliente_id', cid).order('id'),
          db.from('qb_aud_memoria').select('*').eq('cliente_id', cid).order('tema').order('id'),
          db.from('qb_aud_notas').select('*').eq('cliente_id', cid).order('fecha', { ascending: false }).order('id', { ascending: false }),
          db.from('qb_aud_controles').select('*').eq('cliente_id', cid).order('codigo'),
        ]);
        for (const r of [runs, archivos, hallazgos, memoria, notas, controles]) if (r.error) throw r.error;
        return json({ runs: runs.data, archivos: archivos.data, hallazgos: hallazgos.data, memoria: memoria.data, notas: notas.data, controles: controles.data });
      }

      // Alta (sin id) o edición de una auditoría. Opcionales, para que el
      // skill cargue todo de una vez: `controles` (resultado de cada control
      // del catálogo; se pisan por código), `hallazgos` (lista nueva),
      // `memoria` (propuestas para la memoria del cliente) y `resueltos` (ids
      // de hallazgos anteriores que esta auditoría verificó corregidos).
      case 'aud_run_save': {
        const hs = Array.isArray(body.hallazgos) ? body.hallazgos : [];
        const ms = Array.isArray(body.memoria) ? body.memoria : [];
        const cs = Array.isArray(body.controles) ? body.controles : [];
        if (hs.some((h: any) => !String(h?.titulo ?? '').trim())) return json({ error: 'hay hallazgos sin título' }, 400);
        if (ms.some((m: any) => !String(m?.contenido ?? '').trim())) return json({ error: 'hay memoria sin contenido' }, 400);
        if (cs.some((c: any) => !String(c?.codigo ?? '').trim() || !String(c?.control ?? '').trim())) {
          return json({ error: 'hay controles sin código o sin nombre' }, 400);
        }
        const patch = clean(body.run ?? {}, RUN_FIELDS);
        let run: any;
        if (body.id) {
          const { data, error } = await db.from('qb_aud_runs')
            .update({ ...patch, actualizado_at: new Date().toISOString() }).eq('id', body.id).select().single();
          if (error) throw error;
          run = data;
        } else {
          const cliente_id = Number(body.run?.cliente_id);
          if (!cliente_id) return json({ error: 'falta cliente_id' }, 400);
          const { data, error } = await db.from('qb_aud_runs').insert({ ...patch, cliente_id }).select().single();
          if (error) throw error;
          run = data;
        }
        if (hs.length) {
          const rows = hs.map((h: any) => {
            const o: Record<string, unknown> = { run_id: run.id, cliente_id: run.cliente_id };
            for (const k of HALL_INS) o[k] = h?.[k] ?? null;
            o.severidad = o.severidad || 'Media';
            o.estado = o.estado || 'Abierto';
            o.en_resumen = o.en_resumen === true;
            return o;
          });
          const { error } = await db.from('qb_aud_hallazgos').insert(rows);
          if (error) throw error;
        }
        if (ms.length) {
          const rows = ms.map((m: any) => ({
            cliente_id: run.cliente_id, tema: m?.tema || 'General', contenido: m.contenido,
            estado: m?.estado || 'Propuesta', origen: m?.origen ?? 'Auditoría', control: m?.control ?? null,
            origen_run_id: run.id,
          }));
          const { error } = await db.from('qb_aud_memoria').insert(rows);
          if (error) throw error;
        }
        if (cs.length) {
          const ahora = new Date().toISOString();
          const rows = cs.map((c: any) => {
            const o: Record<string, unknown> = { run_id: run.id, cliente_id: run.cliente_id, editado: false, actualizado_at: ahora };
            for (const k of CTRL_INS) o[k] = c?.[k] ?? null;
            o.estado = o.estado || 'Pendiente';
            return o;
          });
          const { error } = await db.from('qb_aud_controles').upsert(rows, { onConflict: 'run_id,codigo' });
          if (error) throw error;
        }
        for (const hid of Array.isArray(body.resueltos) ? body.resueltos : []) {
          await db.from('qb_aud_hallazgos')
            .update({ estado: 'Resuelto', resuelto_fecha: run.fecha, resuelto_run_id: run.id })
            .eq('id', hid).eq('cliente_id', run.cliente_id);
        }
        await marcarAgenda(run);
        return json({ ok: true, run });
      }

      // Borra una auditoría con sus archivos (bucket) y hallazgos.
      case 'aud_run_del': {
        const { data: arch } = await db.from('qb_aud_archivos').select('storage_path').eq('run_id', body.id);
        const paths = (arch ?? []).map((a: any) => a.storage_path);
        if (paths.length) await storage('DELETE', `object/${AUD_BUCKET}`, { prefixes: paths });
        const { error } = await db.from('qb_aud_runs').delete().eq('id', body.id);
        if (error) throw error;
        return json({ ok: true });
      }

      case 'aud_hallazgo_save': {
        const patch: Record<string, unknown> = clean(body.patch, HALL_FIELDS);
        if (!body.id || !Object.keys(patch).length) return json({ error: 'nada para actualizar' }, 400);
        if (HALL_ABIERTOS.includes(String(patch.estado))) { patch.resuelto_fecha = null; patch.resuelto_run_id = null; }
        else if (patch.estado) patch.resuelto_fecha = body.patch.resuelto_fecha || new Date().toISOString().slice(0, 10);
        const { data, error } = await db.from('qb_aud_hallazgos').update(patch).eq('id', body.id).select().single();
        if (error) throw error;
        return json({ ok: true, hallazgo: data });
      }

      // Corrección manual del resultado de un control (queda marcado editado).
      case 'aud_control_save': {
        const patch = clean(body.patch ?? {}, CTRL_FIELDS);
        if (!body.id || !Object.keys(patch).length) return json({ error: 'nada para actualizar' }, 400);
        const { data, error } = await db.from('qb_aud_controles')
          .update({ ...patch, editado: true, actualizado_at: new Date().toISOString() }).eq('id', body.id).select().single();
        if (error) throw error;
        return json({ ok: true, control: data });
      }

      case 'aud_memoria_save': {
        const patch = clean(body.patch ?? {}, MEM_FIELDS);
        if (body.id) {
          const { data, error } = await db.from('qb_aud_memoria')
            .update({ ...patch, actualizado_at: new Date().toISOString() }).eq('id', body.id).select().single();
          if (error) throw error;
          return json({ ok: true, memoria: data });
        }
        const contenido = String(patch.contenido ?? '').trim();
        if (!body.cliente_id || !contenido) return json({ error: 'faltan datos' }, 400);
        const { data, error } = await db.from('qb_aud_memoria').insert({
          cliente_id: body.cliente_id, tema: patch.tema || 'General', contenido, estado: patch.estado || 'Vigente',
          origen: patch.origen ?? null, control: patch.control ?? null,
        }).select().single();
        if (error) throw error;
        return json({ ok: true, memoria: data });
      }

      case 'aud_memoria_del': {
        await db.from('qb_aud_memoria').delete().eq('id', body.id);
        return json({ ok: true });
      }

      case 'aud_nota_add': {
        const texto = String(body.texto ?? '').trim();
        if (!body.cliente_id || !texto) return json({ error: 'faltan datos' }, 400);
        const { data, error } = await db.from('qb_aud_notas').insert({
          cliente_id: body.cliente_id, texto, run_id: body.run_id ?? null, autor: body.autor ?? null,
          fecha: body.fecha ?? new Date().toISOString().slice(0, 10),
        }).select().single();
        if (error) throw error;
        return json({ ok: true, nota: data });
      }

      case 'aud_nota_del': {
        await db.from('qb_aud_notas').delete().eq('id', body.id);
        return json({ ok: true });
      }

      // Subida en 2 pasos: 1) aud_upload_url da una URL firmada (PUT del
      // archivo directo al bucket); 2) aud_archivo_add lo registra.
      case 'aud_upload_url': {
        const rol = String(body.rol ?? '');
        if (!['input', 'output'].includes(rol)) return json({ error: 'rol inválido' }, 400);
        const { data: run } = await db.from('qb_aud_runs').select('id, cliente_id').eq('id', body.run_id).maybeSingle();
        if (!run) return json({ error: 'auditoría inexistente' }, 404);
        const path = `${run.cliente_id}/${run.id}/${rol}/${Date.now()}-${nombreSeguro(body.nombre)}`;
        const d = await storage('POST', `object/upload/sign/${AUD_BUCKET}/${encPath(path)}`);
        return json({ ok: true, path, url: `${SB_URL}/storage/v1${d.url}` });
      }

      case 'aud_archivo_add': {
        const rol = String(body.rol ?? '');
        const { data: run } = await db.from('qb_aud_runs').select('id, cliente_id').eq('id', body.run_id).maybeSingle();
        if (!run) return json({ error: 'auditoría inexistente' }, 404);
        const path = String(body.path ?? '');
        if (!['input', 'output'].includes(rol) || !path.startsWith(`${run.cliente_id}/${run.id}/${rol}/`)) {
          return json({ error: 'ruta inválida' }, 400);
        }
        const { data, error } = await db.from('qb_aud_archivos').insert({
          run_id: run.id, cliente_id: run.cliente_id, rol,
          tipo: AUD_TIPOS.includes(body.tipo) ? body.tipo : 'Otro',
          nombre: String(body.nombre ?? '').trim() || path.split('/').pop(),
          storage_path: path, bytes: Number(body.bytes) || null, mime: body.mime ?? null,
        }).select().single();
        if (error) throw error;
        return json({ ok: true, archivo: data });
      }

      // URL de descarga firmada, válida 5 minutos.
      case 'aud_download_url': {
        const { data: a } = await db.from('qb_aud_archivos').select('storage_path, nombre').eq('id', body.id).maybeSingle();
        if (!a) return json({ error: 'archivo inexistente' }, 404);
        const d = await storage('POST', `object/sign/${AUD_BUCKET}/${encPath(a.storage_path)}`, { expiresIn: 300 });
        return json({ ok: true, url: `${SB_URL}/storage/v1${d.signedURL}&download=${encodeURIComponent(a.nombre)}` });
      }

      case 'aud_archivo_del': {
        const { data: a } = await db.from('qb_aud_archivos').select('storage_path').eq('id', body.id).maybeSingle();
        if (!a) return json({ ok: true });
        await storage('DELETE', `object/${AUD_BUCKET}`, { prefixes: [a.storage_path] });
        await db.from('qb_aud_archivos').delete().eq('id', body.id);
        return json({ ok: true });
      }

      // Cambia el PIN GENERAL. Se autoriza con el PIN de jefes (ver isAdmin).
      case 'set_pin': {
        const np = String(body.new_pin ?? '').trim();
        const malo = validarPinNuevo(np);
        if (malo) return json({ error: malo }, 400);
        const { error } = await db.from('qb_config').update({ pin: np, updated_at: new Date().toISOString() }).eq('id', 1);
        if (error) return errInterno('set_pin', error);
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
        const malo = validarPinNuevo(np);
        if (malo) return json({ error: malo }, 400);
        const { error } = await db.from('qb_config').update({ pin_admin: np }).eq('id', 1);
        if (error) return errInterno('rrhh_set_pin', error);
        return json({ ok: true });
      }

      default:
        return json({ error: 'accion desconocida' }, 400);
    }
  } catch (e) {
    return errInterno(String(action), e);
  }
});
