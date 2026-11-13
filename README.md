# Inventario

App web (HTML + JS, sin compilar) con Supabase. Pensada para celular y tablet. Multi-empresa.

## Modo local (sin Supabase)
Mientras `config.js` tenga los valores de ejemplo, la app funciona sola: los datos se guardan en el navegador (localStorage) de ese equipo.
- Para probar en el celular (misma WiFi): doble clic en `iniciar-servidor.bat` y abrir la dirección que muestra (ej. `http://192.168.1.88:8765`).
- Límites: los datos no se comparten entre equipos ni pasan a Supabase, y se pierden si borras los datos del navegador.
- Si tenías datos de una versión anterior (sin empresas), se agrupan solos en una empresa llamada como `negocio` en `config.js`.

## Puesta en marcha con Supabase
1. Crea un proyecto **nuevo** (no el de COMANDA / Caja Ramada). En *SQL Editor* pega y ejecuta `schema.sql` completo (se puede volver a ejecutar sin problema).
2. *Authentication > Providers > Email*: desactiva "Confirm email" para que las cuentas entren al tiro.
3. *Project Settings > API Keys*: copia la **Project URL** y la clave **anon (legacy, empieza con `eyJ`)** a `config.js`. Esta clave es pública por diseño; la seguridad la dan las reglas del `schema.sql`. Nunca pongas la `service_role`.
4. Publica en **GitHub Pages**: sube la carpeta a un repo y activa *Settings > Pages > Deploy from branch > main / root*. La app queda en `https://USUARIO.github.io/REPO/`. En HTTPS se puede **instalar** en el teléfono (menú del navegador > "Agregar a pantalla de inicio" / "Instalar app") con su ícono.
5. Tras publicar, en Supabase *Authentication > URL Configuration* pon esa dirección como **Site URL**.

Los archivos `servidor-local.ps1` e `iniciar-servidor.bat` son solo para probar en tu computador y no se publican (`.gitignore`).

## Empresas y roles
- Cada usuario crea su cuenta y luego **crea su empresa** (queda como administrador) o es agregado a una existente.
- Una persona puede estar en varias empresas, con un rol distinto en cada una. Se cambia en **Más > Ajustes**.
- Cada empresa tiene sus propios productos, categorías, proveedores, stock e historial.
- **Administrador**: todo (nombre de la empresa, categorías, usuarios, eliminar).
- **Bodega**: ingresos/salidas, crear y editar productos y proveedores.
- **Solo lectura**: consultar.
- Para agregar a alguien: *Más > Usuarios > Agregar usuario* (la persona debe haber creado antes su cuenta con ese correo).

## Pantallas
- **Inicio**: categorías, una tarjeta por fila. Siempre abre aquí. Toca una categoría para ver sus productos y registrar ingreso/salida (parte en *Salida*; el ingreso va en caja).
- **Salida por defecto**: en cada categoría (Ajustes > Categorías) y, si hace falta, en cada producto, se elige si la salida va en *Unidades* o en *Caja*. Ej.: Vinos = Caja; en Bajativo solo "Araucano" = Caja. Siempre se puede cambiar al registrar (en "Revisar y confirmar" de Mover hay un selector por línea).
- **Mover**: estilo caja registradora para compras (facturas con varios productos) o salidas.
- **Stock**: resumen, filtros con contadores (OK / Bajo / Agotado), buscador y listado por categoría con barra de nivel entre mínimo y máximo. Exportar (CSV, compartir, imprimir) está en el botón ⤓.
- **Mínimo y máximo**: cada producto tiene un mínimo (alerta) y un máximo (hasta dónde pedir), que se escriben en cajas o en unidades. Ej. Araucano mínimo 1 caja, máximo 8 cajas.
- **Pedido**: todo lo que está bajo su máximo, por proveedor, con la cantidad que falta para llegar al máximo (editable). Sin máximo se sugiere el doble del mínimo. Genera una imagen para el proveedor que **no incluye stock ni costos**.
- **Inventario inicial** (Más): se anota lo que hay físicamente (cajas + sueltas) y se guarda la diferencia como ingreso/salida con nota. Sirve también para ajustes por conteo.
- **Privacidad** (Ajustes): el administrador decide si Bodega ve costos, precios y valores en dinero. Solo lectura nunca los ve. (Es una restricción de pantalla; para blindarla del todo habría que mover los precios a una tabla aparte.)
- **Más**: Ajustes (empresa, categorías, cuenta), Proveedores, Historial, Usuarios.

## Nota
Los precios de costo los ve cualquier usuario de la empresa. Si quieres ocultarlos a "Solo lectura", hay que separarlos en otra tabla.
