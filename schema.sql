-- INVENTARIO (multi-empresa): esquema para Supabase.
-- Ejecutar completo en el SQL Editor de un proyecto NUEVO (no usar el de COMANDA / Caja Ramada).
-- Todas las tablas llevan prefijo inv_. Cada dato pertenece a una empresa; un usuario puede
-- pertenecer a varias empresas con un rol distinto en cada una (admin / bodega / lector).

create table if not exists inv_perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nombre text,
  created_at timestamptz default now()
);

create table if not exists inv_empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  creada_por uuid,
  ver_costos text not null default 'admin' check (ver_costos in ('admin','bodega')),  -- quien ve costos y valores en dinero (solo lectura nunca)
  created_at timestamptz default now()
);

create table if not exists inv_miembros (
  empresa_id uuid not null references inv_empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  rol text not null default 'lector' check (rol in ('admin','bodega','lector')),
  created_at timestamptz default now(),
  primary key (empresa_id, user_id)
);
create index if not exists inv_miembros_user on inv_miembros(user_id);

create table if not exists inv_categorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references inv_empresas(id) on delete cascade,
  nombre text not null,
  emoji text default '📦',
  imagen_url text,
  unidad_salida text not null default 'un' check (unidad_salida in ('un','emp')),  -- salida por defecto de sus productos con empaque
  orden int default 0,
  created_at timestamptz default now()
);

create table if not exists inv_proveedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references inv_empresas(id) on delete cascade,
  nombre text not null,
  contacto text,
  telefono text,
  whatsapp text,
  email text,
  notas text,
  created_at timestamptz default now()
);

create table if not exists inv_productos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references inv_empresas(id) on delete cascade,
  nombre text not null,
  sku text,
  categoria_id uuid references inv_categorias(id) on delete set null,
  proveedor_id uuid references inv_proveedores(id) on delete set null,
  imagen_url text,
  empaque text default 'Unidad',
  unidades_por_empaque numeric not null default 1 check (unidades_por_empaque > 0),
  capacidad numeric,
  unidad_capacidad text,
  unidad_salida text check (unidad_salida in ('un','emp')),  -- null = segun la categoria
  stock numeric not null default 0,               -- siempre en unidades
  orden int not null default 0,                   -- orden manual dentro de la categoria (0 = por nombre)
  stock_minimo numeric not null default 0,
  stock_maximo numeric not null default 0,        -- 0 = sin maximo; el Pedido sugiere hasta llegar aqui
  precio_costo numeric not null default 0,        -- por unidad
  precio_venta numeric not null default 0,        -- por unidad
  activo boolean not null default true,
  created_at timestamptz default now()
);
create index if not exists inv_productos_emp on inv_productos(empresa_id, categoria_id);

create table if not exists inv_movimientos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references inv_empresas(id) on delete cascade,
  producto_id uuid not null references inv_productos(id) on delete cascade,
  tipo text not null check (tipo in ('ingreso','salida')),
  cantidad numeric not null check (cantidad > 0),
  stock_resultante numeric not null,
  nota text,
  usuario_id uuid,
  usuario_email text,
  created_at timestamptz default now()
);
create index if not exists inv_mov_prod on inv_movimientos(producto_id, created_at desc);
create index if not exists inv_mov_emp on inv_movimientos(empresa_id, created_at desc);

-- Rol del usuario actual en una empresa (null si no pertenece)
create or replace function inv_rol(p_empresa uuid) returns text
language sql stable security definer set search_path = public as $$
  select rol from inv_miembros where empresa_id = p_empresa and user_id = auth.uid()
$$;

-- Al registrarse: perfil automatico
create or replace function inv_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into inv_perfiles(id, email, nombre) values (new.id, new.email, split_part(new.email,'@',1))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists inv_on_auth_user on auth.users;
create trigger inv_on_auth_user after insert on auth.users
  for each row execute function inv_nuevo_usuario();

-- ¿Puede esta cuenta crear una empresa? (admin de alguna, o instalacion inicial sin empresas)
create or replace function inv_puede_crear_empresa() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from inv_miembros where user_id = auth.uid() and rol = 'admin')
    or not exists (select 1 from inv_empresas)
  );
$$;

-- Crear empresa (quien la crea queda como admin)
create or replace function inv_crear_empresa(p_nombre text) returns uuid
language plpgsql security definer set search_path = public as $$
declare e uuid; em text;
begin
  if auth.uid() is null then raise exception 'Sin sesion'; end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'Escribe el nombre de la empresa'; end if;
  -- Solo puede crear empresas: (a) un administrador de alguna empresa, o (b) la primera cuenta
  -- cuando todavia no existe ninguna empresa (instalacion inicial). Cualquier otra cuenta nueva NO puede.
  if not inv_puede_crear_empresa() then
    raise exception 'Solo un administrador puede crear empresas. Pidele que te agregue a la suya.';
  end if;
  select email into em from inv_perfiles where id = auth.uid();
  insert into inv_empresas(nombre, creada_por) values (trim(p_nombre), auth.uid()) returning id into e;
  insert into inv_miembros(empresa_id, user_id, email, rol) values (e, auth.uid(), em, 'admin');
  return e;
end $$;

-- Agregar (o cambiar el rol de) un usuario ya registrado, por correo. Solo admin de esa empresa.
create or replace function inv_agregar_miembro(p_empresa uuid, p_email text, p_rol text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid; em text;
begin
  if inv_rol(p_empresa) is distinct from 'admin' then raise exception 'Solo el administrador puede agregar usuarios'; end if;
  if p_rol not in ('admin','bodega','lector') then raise exception 'Rol invalido'; end if;
  select id, email into u, em from inv_perfiles where lower(email) = lower(trim(p_email));
  if u is null then raise exception 'Ese correo aun no tiene cuenta. Pidele que cree su cuenta primero.'; end if;
  insert into inv_miembros(empresa_id, user_id, email, rol) values (p_empresa, u, em, p_rol)
  on conflict (empresa_id, user_id) do update set rol = excluded.rol;
end $$;

-- Ingreso / salida atomico
create or replace function inv_mover_stock(p_producto uuid, p_tipo text, p_cantidad numeric, p_nota text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare s numeric; e uuid; em text;
begin
  select stock, empresa_id into s, e from inv_productos where id = p_producto for update;
  if not found then raise exception 'Producto no existe'; end if;
  if coalesce(inv_rol(e), '') not in ('admin','bodega') then raise exception 'Sin permiso para mover stock'; end if;  -- coalesce: quien no es miembro tampoco pasa
  if p_tipo not in ('ingreso','salida') then raise exception 'Tipo invalido'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'Cantidad invalida'; end if;
  if p_tipo = 'salida' and s < p_cantidad then raise exception 'Stock insuficiente (hay %)', s; end if;
  s := case when p_tipo = 'ingreso' then s + p_cantidad else s - p_cantidad end;
  perform set_config('inv.mov', '1', true);
  update inv_productos set stock = s where id = p_producto;
  select email into em from inv_perfiles where id = auth.uid();
  insert into inv_movimientos(empresa_id, producto_id, tipo, cantidad, stock_resultante, nota, usuario_id, usuario_email)
  values (e, p_producto, p_tipo, p_cantidad, s, nullif(p_nota,''), auth.uid(), em);
  return s;
end $$;

-- Anular una operacion: no se borra nada; se registra la operacion contraria y la original queda marcada como anulada.
alter table inv_movimientos add column if not exists anulado boolean not null default false;
alter table inv_movimientos add column if not exists anula_a bigint references inv_movimientos(id) on delete set null;

create or replace function inv_anular_movimiento(p_mov bigint, p_motivo text default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare m inv_movimientos%rowtype; s numeric; em text; t text;
begin
  select * into m from inv_movimientos where id = p_mov for update;
  if not found then raise exception 'La operacion no existe'; end if;
  if inv_rol(m.empresa_id) is distinct from 'admin' then raise exception 'Solo el administrador puede anular operaciones'; end if;
  if m.anulado then raise exception 'Esa operacion ya fue anulada'; end if;
  if m.anula_a is not null then raise exception 'Una anulacion no se puede anular'; end if;
  select stock into s from inv_productos where id = m.producto_id for update;
  t := case when m.tipo = 'ingreso' then 'salida' else 'ingreso' end;
  if t = 'salida' and s < m.cantidad then
    raise exception 'No se puede anular: el stock actual (%) es menor que lo que ingreso esa operacion (%). Primero ajusta con un conteo.', s, m.cantidad;
  end if;
  s := case when t = 'ingreso' then s + m.cantidad else s - m.cantidad end;
  perform set_config('inv.mov', '1', true);
  update inv_productos set stock = s where id = m.producto_id;
  select email into em from inv_perfiles where id = auth.uid();
  insert into inv_movimientos(empresa_id, producto_id, tipo, cantidad, stock_resultante, nota, usuario_id, usuario_email, anula_a)
  values (m.empresa_id, m.producto_id, t, m.cantidad, s,
          'Anula operacion #' || m.id || coalesce(' - ' || nullif(trim(p_motivo), ''), ''), auth.uid(), em, m.id);
  update inv_movimientos set anulado = true where id = m.id;
  return s;
end $$;

-- Prueba en limpio: pone el stock en 0 (y opcionalmente borra el historial). Solo admin de esa empresa.
create or replace function inv_reiniciar_stock(p_empresa uuid, p_borrar_historial boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if inv_rol(p_empresa) is distinct from 'admin' then raise exception 'Solo el administrador puede reiniciar las cantidades'; end if;
  perform set_config('inv.mov', '1', true);
  update inv_productos set stock = 0 where empresa_id = p_empresa;
  if p_borrar_historial then delete from inv_movimientos where empresa_id = p_empresa; end if;
end $$;

-- El stock solo cambia via inv_mover_stock; y un producto no puede cambiar de empresa
create or replace function inv_proteger_stock() returns trigger
language plpgsql as $$
begin
  if new.stock is distinct from old.stock and coalesce(current_setting('inv.mov', true),'') <> '1' then
    raise exception 'El stock solo se cambia con ingresos/salidas';
  end if;
  if new.empresa_id is distinct from old.empresa_id then raise exception 'No se puede cambiar la empresa'; end if;
  return new;
end $$;
drop trigger if exists inv_trg_stock on inv_productos;
create trigger inv_trg_stock before update on inv_productos
  for each row execute function inv_proteger_stock();

-- RLS
alter table inv_perfiles    enable row level security;
alter table inv_empresas    enable row level security;
alter table inv_miembros    enable row level security;
alter table inv_categorias  enable row level security;
alter table inv_proveedores enable row level security;
alter table inv_productos   enable row level security;
alter table inv_movimientos enable row level security;

drop policy if exists perf_sel on inv_perfiles;
create policy perf_sel on inv_perfiles for select to authenticated using (id = auth.uid());

drop policy if exists emp_sel on inv_empresas;
create policy emp_sel on inv_empresas for select to authenticated using (inv_rol(id) is not null);
drop policy if exists emp_upd on inv_empresas;
create policy emp_upd on inv_empresas for update to authenticated using (inv_rol(id) = 'admin') with check (inv_rol(id) = 'admin');
drop policy if exists emp_del on inv_empresas;
create policy emp_del on inv_empresas for delete to authenticated using (inv_rol(id) = 'admin');

drop policy if exists mie_sel on inv_miembros;
create policy mie_sel on inv_miembros for select to authenticated using (inv_rol(empresa_id) is not null);
drop policy if exists mie_upd on inv_miembros;
create policy mie_upd on inv_miembros for update to authenticated using (inv_rol(empresa_id) = 'admin') with check (inv_rol(empresa_id) = 'admin');
drop policy if exists mie_del on inv_miembros;
create policy mie_del on inv_miembros for delete to authenticated using (inv_rol(empresa_id) = 'admin' and user_id <> auth.uid());

drop policy if exists cat_sel on inv_categorias;
create policy cat_sel on inv_categorias for select to authenticated using (inv_rol(empresa_id) is not null);
drop policy if exists cat_all on inv_categorias;
create policy cat_all on inv_categorias for all to authenticated using (inv_rol(empresa_id) = 'admin') with check (inv_rol(empresa_id) = 'admin');

drop policy if exists prov_sel on inv_proveedores;
create policy prov_sel on inv_proveedores for select to authenticated using (inv_rol(empresa_id) is not null);
drop policy if exists prov_ins on inv_proveedores;
create policy prov_ins on inv_proveedores for insert to authenticated with check (inv_rol(empresa_id) in ('admin','bodega'));
drop policy if exists prov_upd on inv_proveedores;
create policy prov_upd on inv_proveedores for update to authenticated using (inv_rol(empresa_id) in ('admin','bodega'));
drop policy if exists prov_del on inv_proveedores;
create policy prov_del on inv_proveedores for delete to authenticated using (inv_rol(empresa_id) = 'admin');

drop policy if exists prod_sel on inv_productos;
create policy prod_sel on inv_productos for select to authenticated using (inv_rol(empresa_id) is not null);
drop policy if exists prod_ins on inv_productos;
create policy prod_ins on inv_productos for insert to authenticated with check (inv_rol(empresa_id) in ('admin','bodega'));
drop policy if exists prod_upd on inv_productos;
create policy prod_upd on inv_productos for update to authenticated using (inv_rol(empresa_id) in ('admin','bodega'));
drop policy if exists prod_del on inv_productos;
create policy prod_del on inv_productos for delete to authenticated using (inv_rol(empresa_id) = 'admin');

drop policy if exists mov_sel on inv_movimientos;
create policy mov_sel on inv_movimientos for select to authenticated using (inv_rol(empresa_id) is not null);

-- Imagenes: carpeta = id de la empresa (empresa_id/productos/archivo.jpg)
insert into storage.buckets(id, name, public) values ('inv-imagenes','inv-imagenes', true)
  on conflict (id) do nothing;
drop policy if exists img_sel on storage.objects;
create policy img_sel on storage.objects for select using (bucket_id = 'inv-imagenes');
drop policy if exists img_ins on storage.objects;
create policy img_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'inv-imagenes' and inv_rol(((storage.foldername(name))[1])::uuid) in ('admin','bodega'));
drop policy if exists img_upd on storage.objects;
create policy img_upd on storage.objects for update to authenticated
  using (bucket_id = 'inv-imagenes' and inv_rol(((storage.foldername(name))[1])::uuid) in ('admin','bodega'));
drop policy if exists img_del on storage.objects;
create policy img_del on storage.objects for delete to authenticated
  using (bucket_id = 'inv-imagenes' and inv_rol(((storage.foldername(name))[1])::uuid) in ('admin','bodega'));

-- Las funciones que modifican datos solo las puede llamar un usuario con sesion (no el publico anonimo)
revoke execute on function inv_mover_stock(uuid, text, numeric, text) from public, anon;
revoke execute on function inv_anular_movimiento(bigint, text) from public, anon;
grant execute on function inv_anular_movimiento(bigint, text) to authenticated;
revoke execute on function inv_crear_empresa(text) from public, anon;
revoke execute on function inv_puede_crear_empresa() from public, anon;
grant execute on function inv_puede_crear_empresa() to authenticated;
revoke execute on function inv_agregar_miembro(uuid, text, text) from public, anon;
revoke execute on function inv_reiniciar_stock(uuid, boolean) from public, anon;
grant execute on function inv_mover_stock(uuid, text, numeric, text) to authenticated;
grant execute on function inv_crear_empresa(text) to authenticated;
grant execute on function inv_agregar_miembro(uuid, text, text) to authenticated;
grant execute on function inv_reiniciar_stock(uuid, boolean) to authenticated;

-- Si ya tenias las tablas de una version anterior, estas lineas agregan lo que falte (no hacen nada si ya existe)
alter table inv_productos  add column if not exists orden int not null default 0;
alter table inv_empresas  add column if not exists ver_costos text not null default 'admin' check (ver_costos in ('admin','bodega'));
alter table inv_categorias add column if not exists unidad_salida text not null default 'un' check (unidad_salida in ('un','emp'));
alter table inv_productos add column if not exists unidad_salida text check (unidad_salida in ('un','emp'));
alter table inv_productos add column if not exists stock_maximo numeric not null default 0;
