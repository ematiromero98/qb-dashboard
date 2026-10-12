// Cliente PostgREST mínimo, SIN dependencias externas.
//
// Reemplaza a `createClient` de @supabase/supabase-js en las Edge Functions de
// Chermisqui (qb-api, tx-api, chcal-api). Motivo: en oct-2026, al mudarlas al
// proyecto compartido (zpwcc), el bundler de Supabase no podía descargar
// paquetes remotos (jsr:/npm:/esm.sh daban timeout) y sólo aceptaba código
// local. Implementa únicamente lo que usan esas funciones:
//   from(t).select/insert/update/upsert/delete
//          .eq/.lt/.order/.limit/.range/.single/.maybeSingle
// y devuelve { data, error } igual que supabase-js.

type Res = { data: any; error: any };
type Cfg = { url: string; key: string; schema: string };

class Query implements PromiseLike<Res> {
  private method = 'GET';
  private params: [string, string][] = [];
  private orders: string[] = [];
  private body: unknown = undefined;
  private prefer: string[] = [];
  private mode: '' | 'single' | 'maybe' = '';
  private returning = false;
  private cfg: Cfg;
  private table: string;

  constructor(cfg: Cfg, table: string) {
    this.cfg = cfg;
    this.table = table;
  }

  select(cols = '*') {
    this.params.push(['select', cols.replace(/\s+/g, '')]);
    if (this.method !== 'GET') this.returning = true;
    return this;
  }
  insert(values: unknown) { this.method = 'POST'; this.body = values; return this; }
  update(patch: unknown) { this.method = 'PATCH'; this.body = patch; return this; }
  delete() { this.method = 'DELETE'; return this; }
  upsert(values: unknown, opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.method = 'POST';
    this.body = values;
    this.prefer.push(opts.ignoreDuplicates ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates');
    if (opts.onConflict) this.params.push(['on_conflict', opts.onConflict]);
    return this;
  }
  eq(col: string, v: unknown) { this.params.push([col, `eq.${v}`]); return this; }
  lt(col: string, v: unknown) { this.params.push([col, `lt.${v}`]); return this; }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orders.push(`${col}.${opts.ascending === false ? 'desc' : 'asc'}`);
    return this;
  }
  limit(n: number) { this.params.push(['limit', String(n)]); return this; }
  range(from: number, to: number) {
    this.params.push(['offset', String(from)], ['limit', String(to - from + 1)]);
    return this;
  }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }

  private async run(): Promise<Res> {
    const qs = new URLSearchParams(this.params);
    if (this.orders.length) qs.set('order', this.orders.join(','));
    const prefer = [...this.prefer];
    if (this.method !== 'GET') prefer.push(this.returning ? 'return=representation' : 'return=minimal');
    const headers: Record<string, string> = {
      apikey: this.cfg.key,
      Authorization: `Bearer ${this.cfg.key}`,
      'Accept-Profile': this.cfg.schema,
      'Content-Profile': this.cfg.schema,
      'Content-Type': 'application/json',
    };
    if (prefer.length) headers.Prefer = prefer.join(',');
    try {
      const r = await fetch(`${this.cfg.url}/rest/v1/${this.table}?${qs}`, {
        method: this.method,
        headers,
        body: this.body === undefined ? undefined : JSON.stringify(this.body),
      });
      const txt = await r.text();
      const parsed = txt ? JSON.parse(txt) : null;
      if (!r.ok) return { data: null, error: parsed ?? { message: `HTTP ${r.status}` } };
      if (!this.mode) return { data: parsed, error: null };
      const rows = Array.isArray(parsed) ? parsed : parsed == null ? [] : [parsed];
      if (rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'más de una fila' } };
      if (rows.length === 0) {
        return this.mode === 'maybe'
          ? { data: null, error: null }
          : { data: null, error: { code: 'PGRST116', message: 'ninguna fila' } };
      }
      return { data: rows[0], error: null };
    } catch (e) {
      return { data: null, error: { message: String((e as Error)?.message ?? e) } };
    }
  }

  then<A = Res, B = never>(
    ok?: ((v: Res) => A | PromiseLike<A>) | null,
    ko?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(ok, ko);
  }
}

export function createClient(url: string, key: string, opts: { db?: { schema?: string } } = {}) {
  const cfg: Cfg = { url: url.replace(/\/$/, ''), key, schema: opts.db?.schema ?? 'public' };
  return { from: (table: string) => new Query(cfg, table) };
}
