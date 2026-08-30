# QB Dashboard — Chermisqui

Control de **conciliaciones mensuales de QuickBooks** de los clientes de Chermisqui.
Reemplaza el Excel "QB DashBoard" por una web con base de datos: los bookkeepers
abren un link, ponen un PIN y cargan todo ahí, **todos sobre el mismo dato y en vivo**.

## Qué hace

- Grilla editable agrupada por cliente (igual que el Excel): estado, fecha, bookkeeper,
  documentación, workflow de review (Junior/Auto/Claude/Senior/Memos) y análisis por área
  (Payroll / P&L / Balance / Ventas) + notas.
- **Dashboard de KPIs** automático: % de avance, reconciliadas, pendientes, por bookkeeper.
- **Vistas** que reemplazan las hojas del Excel (Pendientes, Pend. de Acceso, Escalar,
  Falta Doc, Nueva Cuenta, Por Bookkeeper) — se calculan solas.
- **Períodos**: un mes nuevo se crea con un botón arrastrando las cuentas activas
  (ya no un Excel por mes; queda todo el histórico).
- Alta de clientes y cuentas, filtros, buscador y export a CSV.
- Refresco automático cada 15 s → multiusuario en vivo.

## Arquitectura

```
Navegador (GitHub Pages, HTML/CSS/JS vanilla)
        │  fetch con PIN
        ▼
Edge Function  qb-api   (Supabase, service_role)
        │
        ▼
Postgres (Supabase)  tablas qb_periodos / qb_clientes / qb_cuentas / qb_conciliaciones
```

- Front: `index.html` + `styles.css` + `app.js` + `config.js`.
- Backend: `supabase/functions/qb-api/` (Deno) + `supabase/migrations/0001_qb_schema.sql`.
- Proyecto Supabase: **EMPLOYEE-PRO** (`ffczbimnuodzcbgsdxbx`), tablas prefijadas `qb_`.

## Seguridad

- La lista de clientes es confidencial. Las tablas `qb_` tienen **RLS activado sin políticas**:
  la `anon key` (que sí está en `config.js`) **no puede leer ni escribir** nada por sí sola.
- Todo el acceso pasa por la Edge Function, que valida el **PIN** y usa el `service_role`
  (que nunca sale del servidor). El PIN vive en la tabla `qb_config`, no en el repo.

### Cambiar el PIN

Opción A — desde SQL en Supabase:
```sql
update public.qb_config set pin = 'NUEVO-PIN', updated_at = now() where id = 1;
```
Opción B — llamando a la función con el PIN actual (acción `set_pin`).

## Publicar / actualizar

- **Front**: es estático → GitHub Pages sirve `index.html`. Cada push a `main` actualiza el sitio.
- **Backend**: desplegar la función con la CLI de Supabase:
  ```bash
  supabase functions deploy qb-api --no-verify-jwt --project-ref ffczbimnuodzcbgsdxbx
  ```
- **Migración**: aplicar `supabase/migrations/0001_qb_schema.sql` en el proyecto.

## Correr local

```bash
python -m http.server 5177 --directory .
# abrir http://localhost:5177
```
