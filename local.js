'use strict';
// Modo local: imita lo que la app usa de Supabase, guardando todo en localStorage de ESTE navegador.
// Se activa solo cuando config.js todavia tiene los valores de ejemplo.
// crypto.randomUUID solo existe en HTTPS/localhost; por HTTP (celular en la red) se usa un respaldo.
function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(16)) : Array.from({ length: 16 }, () => Math.random() * 256 | 0);
  b[6] = b[6] & 0x0f | 0x40; b[8] = b[8] & 0x3f | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function localClient() {
  const KEY = 'inv_local_db_v1';
  const TABLES = ['inv_perfiles', 'inv_empresas', 'inv_miembros', 'inv_categorias', 'inv_proveedores', 'inv_productos', 'inv_movimientos'];
  const DATA = ['inv_categorias', 'inv_proveedores', 'inv_productos', 'inv_movimientos']; // tablas con empresa_id
  const empty = () => ({ v: 2, users: [], session: null, files: {}, t: Object.fromEntries(TABLES.map(t => [t, []])) });
  const now = () => new Date().toISOString();
  const uid = uuid;
  const save = d => localStorage.setItem(KEY, JSON.stringify(d));
  // Datos creados antes del modo multi-empresa: se agrupan en una empresa y los usuarios conservan su rol.
  function migrate(d) {
    d.v = 2; d.t.inv_empresas ||= []; d.t.inv_miembros ||= [];
    const hay = d.t.inv_perfiles.length || DATA.some(t => d.t[t]?.length);
    if (hay) {
      const e = { id: uid(), nombre: (typeof CFG !== 'undefined' && CFG.negocio) || 'Mi Negocio', creada_por: d.t.inv_perfiles[0]?.id, created_at: now() };
      d.t.inv_empresas.push(e);
      d.t.inv_perfiles.forEach(p => d.t.inv_miembros.push({ empresa_id: e.id, user_id: p.id, email: p.email, rol: p.rol || 'lector', created_at: now() }));
      DATA.forEach(t => (d.t[t] || []).forEach(r => r.empresa_id = e.id));
    }
    d.t.inv_perfiles.forEach(p => delete p.rol);
    save(d); return d;
  }
  const load = () => {
    let d; try { d = JSON.parse(localStorage.getItem(KEY)); } catch { d = null; }
    if (!d) return empty();
    return d.v === 2 ? d : migrate(d);
  };
  const listeners = [];
  const sess = d => { const u = d.users.find(x => x.id === d.session); return u ? { user: { id: u.id, email: u.email } } : null; };
  const emit = ev => { const s = sess(load()); listeners.forEach(f => f(ev, s)); };
  const roleIn = (d, e) => d.t.inv_miembros.find(m => m.empresa_id === e && m.user_id === d.session)?.rol || null;
  const canWrite = (d, t, e) => { const r = roleIn(d, e); return t === 'inv_categorias' || t === 'inv_empresas' || t === 'inv_miembros' ? r === 'admin' : r === 'admin' || r === 'bodega'; };
  // Equivale a las reglas RLS: solo se ve lo de las empresas a las que perteneces
  const visible = (d, t, r) => t === 'inv_perfiles' ? r.id === d.session : t === 'inv_empresas' ? !!roleIn(d, r.id) : !!roleIn(d, r.empresa_id);

  const defaults = {
    inv_categorias: () => ({ emoji: '📦', orden: 0 }),
    inv_proveedores: () => ({}),
    inv_productos: () => ({ empaque: 'Unidad', unidades_por_empaque: 1, stock: 0, stock_minimo: 0, precio_costo: 0, precio_venta: 0, activo: true })
  };

  function auth(email, password, nuevo) {
    const d = load(); email = (email || '').toLowerCase();
    let u = d.users.find(x => x.email === email);
    if (nuevo) {
      if (u) return { data: {}, error: { message: 'Ese correo ya está registrado' } };
      u = { id: uid(), email, password };
      d.users.push(u);
      d.t.inv_perfiles.push({ id: u.id, email, nombre: email.split('@')[0], created_at: now() });
    } else if (!u) return { data: {}, error: { message: 'Este dispositivo aún no tiene esa cuenta (modo local). Toca "Crear una cuenta".' } };
    else if (u.password !== password) return { data: {}, error: { message: 'Contraseña incorrecta' } };
    d.session = u.id; save(d); setTimeout(() => emit('SIGNED_IN'), 0);
    return { data: { session: sess(d) }, error: null };
  }

  class Q {
    constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.o = []; this.lim = null; this.one = false; this.ret = false; this.joinP = false; this.joinE = false; }
    select(cols) { if (this.op !== 'select') this.ret = true; else { this.joinP = /inv_productos\(/.test(cols || ''); this.joinE = /inv_empresas\(/.test(cols || ''); } return this; }
    insert(p) { this.op = 'insert'; this.p = p; return this; }
    update(p) { this.op = 'update'; this.p = p; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.f.push([c, v]); return this; }
    order(c, o) { this.o.push([c, o?.ascending === false ? -1 : 1]); return this; }
    limit(n) { this.lim = n; return this; }
    single() { this.one = true; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
    run() {
      try {
        const d = load(), t = this.t, rows = d.t[t], match = r => this.f.every(([c, v]) => r[c] === v);
        const empOf = r => t === 'inv_empresas' ? r.id : r.empresa_id;
        const deny = () => ({ data: null, error: { message: 'Sin permiso para esta acción' } });
        let out;
        if (this.op === 'select') {
          out = rows.filter(r => match(r) && visible(d, t, r));
          this.o.slice().reverse().forEach(([c, k]) => out.sort((a, b) => (a[c] == null) - (b[c] == null) || (typeof a[c] === 'number' ? a[c] - b[c] : String(a[c] ?? '').localeCompare(String(b[c] ?? ''), 'es')) * k));
          if (this.lim) out = out.slice(0, this.lim);
          out = out.map(r => ({ ...r }));
          if (this.joinP) out.forEach(r => { r.inv_productos = { nombre: d.t.inv_productos.find(p => p.id === r.producto_id)?.nombre }; });
          if (this.joinE) out.forEach(r => { const e = d.t.inv_empresas.find(x => x.id === r.empresa_id); r.inv_empresas = e ? { ...e } : null; });
        } else if (this.op === 'insert') {
          if (t === 'inv_empresas' || t === 'inv_miembros' || t === 'inv_perfiles') return deny();
          const items = [].concat(this.p);
          if (items.some(r => !r.empresa_id)) return { data: null, error: { message: 'Falta la empresa' } };
          if (items.some(r => !canWrite(d, t, r.empresa_id))) return deny();
          out = items.map(r => ({ id: uid(), created_at: now(), ...(defaults[t]?.() || {}), ...r }));
          rows.push(...out);
        } else if (this.op === 'update') {
          out = rows.filter(r => match(r) && visible(d, t, r) && canWrite(d, t, empOf(r)));
          if (!out.length && rows.some(match)) return deny();
          out.forEach(r => { const e = r.empresa_id; Object.assign(r, this.p); if (e) r.empresa_id = e; });
        } else {
          out = rows.filter(r => match(r) && visible(d, t, r) && roleIn(d, empOf(r)) === 'admin' && !(t === 'inv_miembros' && r.user_id === d.session));
          if (!out.length && rows.some(match)) return deny();
          const ids = new Set(out.map(r => r.id));
          if (t === 'inv_miembros') d.t.inv_miembros = rows.filter(r => !out.includes(r));
          else d.t[t] = rows.filter(r => !ids.has(r.id));
          if (t === 'inv_categorias') d.t.inv_productos.forEach(p => { if (ids.has(p.categoria_id)) p.categoria_id = null; });
          if (t === 'inv_proveedores') d.t.inv_productos.forEach(p => { if (ids.has(p.proveedor_id)) p.proveedor_id = null; });
          if (t === 'inv_productos') d.t.inv_movimientos = d.t.inv_movimientos.filter(m => !ids.has(m.producto_id));
          if (t === 'inv_empresas') DATA.concat('inv_miembros').forEach(x => d.t[x] = d.t[x].filter(r => !ids.has(r.empresa_id)));
        }
        save(d);
        if (this.op !== 'select' && !this.ret) return { data: null, error: null };
        if (this.one) return out.length ? { data: out[0], error: null } : { data: null, error: { message: 'No encontrado' } };
        return { data: out, error: null };
      } catch (e) { return { data: null, error: { message: e.name === 'QuotaExceededError' ? 'Almacenamiento del navegador lleno' : e.message } }; }
    }
  }

  const err = m => ({ data: null, error: { message: m } });
  const rpcs = {
    inv_mover_stock(d, a) {
      const p = d.t.inv_productos.find(x => x.id === a.p_producto);
      if (!p) return err('Producto no existe');
      if (!['admin', 'bodega'].includes(roleIn(d, p.empresa_id))) return err('Sin permiso para mover stock');
      if (!(a.p_cantidad > 0)) return err('Cantidad inválida');
      if (a.p_tipo === 'salida' && p.stock < a.p_cantidad) return err(`Stock insuficiente (hay ${p.stock})`);
      p.stock += a.p_tipo === 'ingreso' ? a.p_cantidad : -a.p_cantidad;
      d.t.inv_movimientos.push({ id: d.t.inv_movimientos.length + 1 + Date.now(), empresa_id: p.empresa_id, producto_id: p.id, tipo: a.p_tipo, cantidad: a.p_cantidad, stock_resultante: p.stock, nota: a.p_nota || null, usuario_id: d.session, usuario_email: d.users.find(u => u.id === d.session)?.email, created_at: now() });
      return { data: p.stock, error: null };
    },
    inv_reiniciar_stock(d, a) {
      if (roleIn(d, a.p_empresa) !== 'admin') return err('Solo el administrador puede reiniciar las cantidades');
      d.t.inv_productos.forEach(p => { if (p.empresa_id === a.p_empresa) p.stock = 0; });
      if (a.p_borrar_historial) d.t.inv_movimientos = d.t.inv_movimientos.filter(m => m.empresa_id !== a.p_empresa);
      return { data: null, error: null };
    },
    inv_crear_empresa(d, a) {
      if (!d.session) return err('Sin sesion');
      if (!(a.p_nombre || '').trim()) return err('Escribe el nombre de la empresa');
      const mias = d.t.inv_miembros.filter(m => m.user_id === d.session);
      if (mias.length && !mias.some(m => m.rol === 'admin')) return err('Solo un administrador puede crear otra empresa');
      const e = { id: uid(), nombre: a.p_nombre.trim(), creada_por: d.session, created_at: now() };
      d.t.inv_empresas.push(e);
      d.t.inv_miembros.push({ empresa_id: e.id, user_id: d.session, email: d.users.find(u => u.id === d.session)?.email, rol: 'admin', created_at: now() });
      return { data: e.id, error: null };
    },
    inv_agregar_miembro(d, a) {
      if (roleIn(d, a.p_empresa) !== 'admin') return err('Solo el administrador puede agregar usuarios');
      if (!['admin', 'bodega', 'lector'].includes(a.p_rol)) return err('Rol inválido');
      const u = d.users.find(x => x.email === (a.p_email || '').trim().toLowerCase());
      if (!u) return err('Ese correo aún no tiene cuenta. Pídele que cree su cuenta primero.');
      const m = d.t.inv_miembros.find(x => x.empresa_id === a.p_empresa && x.user_id === u.id);
      if (m) m.rol = a.p_rol; else d.t.inv_miembros.push({ empresa_id: a.p_empresa, user_id: u.id, email: u.email, rol: a.p_rol, created_at: now() });
      return { data: null, error: null };
    }
  };

  return {
    auth: {
      signInWithPassword: async c => auth(c.email, c.password, false),
      signUp: async c => auth(c.email, c.password, true),
      signOut: async () => { const d = load(); d.session = null; save(d); setTimeout(() => emit('SIGNED_OUT'), 0); return { error: null }; },
      onAuthStateChange: cb => { listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', sess(load())), 0); return { data: { subscription: { unsubscribe() { } } } }; }
    },
    from: t => new Q(t),
    rpc: async (fn, a) => {
      if (!rpcs[fn]) return err('RPC desconocida');
      const d = load(), r = rpcs[fn](d, a);
      if (!r.error) { try { save(d); } catch { return err('Almacenamiento del navegador lleno'); } }
      return r;
    },
    storage: {
      from: () => ({
        upload: async (path, blob) => {
          const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
          try { const d = load(); d.files[path] = url; save(d); } catch { return { error: { message: 'Almacenamiento del navegador lleno (imagen muy pesada)' } }; }
          return { error: null };
        },
        getPublicUrl: path => ({ data: { publicUrl: load().files[path] } })
      })
    }
  };
}
