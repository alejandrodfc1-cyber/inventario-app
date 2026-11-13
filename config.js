// Pega aqui los datos de tu proyecto Supabase (Project Settings > API).
// La clave "anon/publishable" es publica por diseno; la seguridad la dan las reglas RLS de schema.sql.
// El nombre de cada empresa se cambia dentro de la app (Mas > Ajustes), no aqui.
window.CFG = {
  url: 'https://TU-PROYECTO.supabase.co',
  key: 'TU-CLAVE-ANON-PUBLICA',
  negocio: 'Mi Negocio',   // solo nombre por defecto al migrar datos locales antiguos
  moneda: 'CLP'            // CLP, USD, EUR...
};
