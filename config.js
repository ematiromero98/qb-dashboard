// Configuración pública del proyecto QB Dashboard.
// La anon key es segura de exponer: las tablas qb_ tienen RLS activado SIN políticas,
// así que la anon key por sí sola NO puede leer nada. Todo el acceso a datos pasa por
// la Edge Function 'qb-api', que valida el PIN y usa el service_role del lado servidor.
// DECISIÓN DE AUDITORÍA (sep-2026): la auth por PIN (el valor vive en la base, no en el repo) se dejó A PROPÓSITO.
// Se evaluó migrar a Supabase Auth por persona (trazabilidad + rate-limit + caducidad)
// y se decidió NO hacerlo por ahora. Riesgo aceptado y documentado.
window.QB_CONFIG = {
  URL: "https://zpwccecovhjmeibxafkg.supabase.co",
  ANON: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpwd2NjZWNvdmhqbWVpYnhhZmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MjM5MTgsImV4cCI6MjA5NTM5OTkxOH0.E6H-a8b-Dze1ugp0KdKIh2SWwLNLb9Pe3BYyLngppC4",
  FN: "qb-api",
  REFRESH_MS: 15000, // refresco automático multiusuario
};
