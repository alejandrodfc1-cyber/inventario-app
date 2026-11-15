// Datos del proyecto Supabase "inventario" (Project Settings > API Keys).
// La clave "publishable" es publica por diseno; la seguridad la dan las reglas RLS de schema.sql.
// NUNCA pongas aqui la clave "secret" ni la "service_role".
// El nombre de cada empresa se cambia dentro de la app (Mas > Ajustes), no aqui.
window.CFG = {
  url: 'https://mqjvoquobuziobrsfxeq.supabase.co',
  key: 'sb_publishable_p2hGsBlnbF2Hu-CjAgsFYg_4Nbh9bQk',
  negocio: 'Mi Negocio',   // solo nombre por defecto al migrar datos locales antiguos
  moneda: 'CLP'            // CLP, USD, EUR...
};
