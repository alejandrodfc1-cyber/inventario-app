# Cómo ofrecer Inventario a un negocio sin relación (NO implementado, solo conocimiento)

## Dos caminos

**A) Una empresa más dentro de tu Supabase** (para gente de tu confianza)
1. La persona crea su cuenta en la app. Verá «Pídele al administrador que te agregue».
2. Tú (administrador) creas la empresa con su nombre.
3. La agregas en Más → Usuarios con su correo y rol Administrador.
- Tú quedas como administrador de esa empresa y ves sus datos. La app no tiene botón para salirte (se hace con SQL).
- Un administrador puede crear más empresas; Bodega y Solo lectura no.
- Sus datos viven en tu base de datos.

**B) Instalación separada para el cliente** (recomendado si es un negocio ajeno)
Cada cliente tiene su propio Supabase y su propia copia de la app. Sus datos no se mezclan con los tuyos.

Pasos:
1. El cliente crea su cuenta en **Supabase** (gratis) con su correo (puede entrar con GitHub o con correo y clave).
2. Crea un proyecto nuevo. Región cercana (ej. São Paulo).
3. En SQL Editor ejecuta `schema.sql` completo (es re-ejecutable).
4. Authentication → apagar «Confirm email» (o configurar correo si prefiere dejarlo).
5. Project Settings → API: copiar la **Project URL** y la clave **publishable** (`sb_publishable_…`). Nunca la `sb_secret`.
6. Publicar la app con esos datos en `config.js`:
   - Opción 1: tú mantienes una copia del repo con SU `config.js` y la publicas en tu GitHub Pages (el cliente solo necesita Supabase).
   - Opción 2: el cliente tiene su propia cuenta de **GitHub**, copia (fork) el repo, edita `config.js` y activa Pages (Settings → Pages → rama main, carpeta raíz).
7. El cliente abre la URL, crea su cuenta y crea su empresa (la primera cuenta puede crearla porque aún no existe ninguna).
8. Cuando todo su personal tenga cuenta, cerrar el registro: Authentication → desactivar «Allow new users to sign up».

Para que el cliente necesite GitHub: solo si quiere ser dueño del hosting (opción 2). Supabase sí es obligatorio en el camino B.

## Límites a recordar
- Plan gratis de Supabase: pocos proyectos activos por cuenta (los pausados no cuentan), proyectos sin uso ~1 semana se pausan, sin respaldos automáticos (exportar CSV de vez en cuando).
- Ocultar costos a Bodega/Lector es solo en pantalla; los precios sí llegan al dispositivo.
- Mantener varias copias implica actualizar cada una cuando cambie la app.
