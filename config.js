// Configuración pública del proyecto QB Dashboard.
// La anon key es segura de exponer: las tablas qb_ tienen RLS activado SIN políticas,
// así que la anon key por sí sola NO puede leer nada. Todo el acceso a datos pasa por
// la Edge Function 'qb-api', que valida el PIN y usa el service_role del lado servidor.
window.QB_CONFIG = {
  URL: "https://ffczbimnuodzcbgsdxbx.supabase.co",
  ANON: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmY3piaW1udW9kemNiZ3NkeGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMDk5OTIsImV4cCI6MjEwMTY4NTk5Mn0.askaC0kqNdzoxYhJhmzEKPOiW5n9QlbBrF5U1pqRlBE",
  FN: "qb-api",
  REFRESH_MS: 15000, // refresco automático multiusuario
};
