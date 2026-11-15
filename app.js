'use strict';
const LOCAL = /TU-PROYECTO|TU-CLAVE/.test(CFG.url + CFG.key);
const sb = LOCAL ? localClient() : supabase.createClient(CFG.url, CFG.key);
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: CFG.moneda || 'CLP', maximumFractionDigits: 0 }).format(n || 0);
const num = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(n || 0);
const app = $('#app');

const S = { user: null, perfil: null, emp: null, empresas: [], cats: [], provs: [], prods: [], q: '' };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { } };
const VERSION = '2026-11-14.11';
const negocio = () => S.emp?.nombre || CFG.negocio || '';
const isAdmin = () => S.perfil?.rol === 'admin';
const canEdit = () => ['admin', 'bodega'].includes(S.perfil?.rol);
// Quien ve costos, precios y valores en dinero: el administrador siempre; Bodega solo si el administrador lo permite (Ajustes). Solo lectura nunca.
const canCost = () => S.perfil?.rol === 'admin' || (S.perfil?.rol === 'bodega' && S.emp?.ver_costos === 'bodega');
const maxOf = p => Number(p.stock_maximo) || 0;
const plural = w => { w = String(w || '').toLowerCase(); return w + (/[aeiouáéíóú]$/.test(w) ? 's' : 'es'); };
// Cantidad (en unidades) escrita de forma natural: "4 cajas" si es exacta, si no "50 un"
const fmtQ = (p, un) => { const u = Number(p.unidades_por_empaque) || 1; un = Number(un) || 0; return u > 1 && un % u === 0 ? `${num(un / u)} ${un / u === 1 ? String(p.empaque).toLowerCase() : plural(p.empaque)}` : `${num(un)} un`; };
const ROLES = { admin: 'Administrador', bodega: 'Bodega', lector: 'Solo lectura' };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}
const fail = e => { console.error(e); toast('⚠️ ' + (e?.message || e)); };

/* ---------- datos ---------- */
async function loadAll() {
  const [m, pf] = await Promise.all([
    sb.from('inv_miembros').select('*, inv_empresas(id,nombre,ver_costos)').eq('user_id', S.user.id),
    sb.from('inv_perfiles').select('*').eq('id', S.user.id).single()
  ]);
  for (const r of [m, pf]) if (r.error) throw r.error;
  S.empresas = m.data.filter(x => x.inv_empresas).map(x => ({ id: x.inv_empresas.id, nombre: x.inv_empresas.nombre, rol: x.rol, ver_costos: x.inv_empresas.ver_costos || 'admin' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  S.emp = S.empresas.find(e => e.id === lsGet('inv_emp_' + S.user.id)) || S.empresas[0] || null;
  S.perfil = { ...pf.data, rol: S.emp?.rol };
  if (!S.emp) { S.cats = []; S.provs = []; S.prods = []; return; }
  const [c, p, pr] = await Promise.all([
    sb.from('inv_categorias').select('*').eq('empresa_id', S.emp.id).order('orden').order('nombre'),
    sb.from('inv_proveedores').select('*').eq('empresa_id', S.emp.id).order('nombre'),
    sb.from('inv_productos').select('*').eq('empresa_id', S.emp.id).eq('activo', true).order('nombre')
  ]);
  for (const r of [c, p, pr]) if (r.error) throw r.error;
  S.cats = c.data; S.provs = p.data; S.prods = pr.data;
}
async function elegirEmpresa(id) {
  lsSet('inv_emp_' + S.user.id, id); M.lines = []; M.cat = ''; M.q = ''; S.q = '';
  await loadAll(); location.hash = '#/'; render();
}
async function crearEmpresa(nombre) {
  const { data, error } = await sb.rpc('inv_crear_empresa', { p_nombre: nombre });
  if (error) throw error;
  await elegirEmpresa(data);
}
const catOf = id => S.cats.find(c => c.id === id);
const provOf = id => S.provs.find(c => c.id === id);
const prodOf = id => S.prods.find(c => c.id === id);
const estado = p => p.stock <= 0 ? 'out' : p.stock <= p.stock_minimo ? 'low' : 'ok';
const alertas = () => S.prods.filter(p => p.stock <= p.stock_minimo);
function stockTxt(p) {
  const u = Number(p.unidades_por_empaque) || 1;
  if (u <= 1) return `${num(p.stock)} un`;
  return `${num(p.stock)} un · ${num(Math.floor(p.stock / u))} ${p.empaque.toLowerCase()}${p.stock % u ? ' + ' + num(p.stock % u) : ''}`;
}
const thumb = (url, emoji) => url ? `style="background-image:url('${esc(url)}')"` : '';

/* ---------- imagenes ---------- */
function resizeImage(file, max = 700) {
  return new Promise((res, rej) => {
    const img = new Image(); const u = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u); c.toBlob(b => b ? res(b) : rej(new Error('No se pudo procesar la imagen')), 'image/jpeg', .82);
    };
    img.onerror = () => rej(new Error('Imagen no válida')); img.src = u;
  });
}
async function uploadImage(file, folder) {
  const blob = await resizeImage(file);
  const path = `${S.emp.id}/${folder}/${uuid()}.jpg`;
  const { error } = await sb.storage.from('inv-imagenes').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw error;
  return sb.storage.from('inv-imagenes').getPublicUrl(path).data.publicUrl;
}

/* ---------- modal ---------- */
function modal(html) {
  closeModal();
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'modal';
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.addEventListener('click', e => { if (e.target === m) closeModal(); });
  document.body.appendChild(m); return m.firstChild;
}
const closeModal = () => { $('#modal')?.remove(); if ($('#mgrid')) { paintGrid(); paintBar(); } };

/* ---------- login ---------- */
function loginView(modo = 'in') {
  app.innerHTML = `<div class="login"><h1>📦 Inventario</h1>
  <form id="lf"><label>Correo</label><input type="email" name="email" required autocomplete="username">
  <label>Contraseña</label><input type="password" name="pass" required minlength="6" autocomplete="${modo === 'in' ? 'current-password' : 'new-password'}">
  <p><button class="btn full">${modo === 'in' ? 'Entrar' : 'Crear cuenta'}</button></p></form>
  <p class="center"><a href="#" id="sw">${modo === 'in' ? 'Crear una cuenta' : 'Ya tengo cuenta'}</a></p>
  <p class="center mut" style="font-size:13px">${modo === 'in' ? '' : 'Luego podrás crear tu empresa, o pedirle a un administrador que te agregue con este correo.'}</p>
  ${LOCAL ? '<p class="center mut" style="font-size:12px">🧪 Modo local: los datos quedan solo en este navegador.</p>' : ''}</div>`;
  $('#sw').onclick = e => { e.preventDefault(); loginView(modo === 'in' ? 'up' : 'in'); };
  $('#lf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target); const btn = $('button', e.target); btn.disabled = true;
    const cred = { email: f.get('email').trim(), password: f.get('pass') };
    let data, error;
    try { ({ data, error } = modo === 'in' ? await sb.auth.signInWithPassword(cred) : await sb.auth.signUp(cred)); } catch (er) { error = er; }
    btn.disabled = false;
    if (error) return fail(error);
    if (modo === 'up' && !data.session) toast('Cuenta creada. Revisa tu correo para confirmarla.');
  };
}

/* ---------- layout ---------- */
function shell(title, body, opt = {}) {
  const h = location.hash || '#/'; const n = alertas().length;
  const nav = (href, ic, lb, extra = '') => `<a href="${href}" class="${h === href || (href !== '#/' && h.startsWith(href)) ? 'on' : ''}"><span>${ic}</span>${lb}${extra}</a>`;
  app.innerHTML = `${opt.nohead ? '' : `<header>${opt.back ? `<button class="btn sec sm" data-go="${opt.back}">←</button>` : ''}<h1>${opt.sub ? `${esc(title)} <span class="emp">“${esc(opt.sub)}”</span>` : esc(title)}</h1>
    <span class="mut who">${esc(S.perfil.nombre || S.perfil.email)} · ${ROLES[S.perfil.rol]}</span></header>`}
    <div class="wrap">${body}</div>
    ${opt.fab ? `<button class="btn fab" data-act="${opt.fab}" aria-label="Agregar">＋</button>` : ''}
    <nav>${nav('#/', '🏠', 'Inicio')}${canEdit() ? nav('#/mover', '🔄', 'Mover') : ''}${nav('#/stock', '📋', 'Stock')}${nav('#/pedido', '🛒', 'Pedido', n ? `<i>${n}</i>` : '')}<a href="#/mas" class="${['#/mas', '#/ajustes', '#/conteo', '#/proveedores', '#/historial', '#/usuarios'].includes(h) ? 'on' : ''}"><span>☰</span>Más</a></nav>`;
}

/* ---------- vistas ---------- */
// Unidad por defecto al sacar un producto: la del producto, si no la de su categoria, si no unidades.
// Solo aplica a productos que vienen en caja/empaque (unidades_por_empaque > 1).
// Explica de donde sale la regla (para mostrarla en pantalla)
function reglaSalida(p) {
  const u = Number(p.unidades_por_empaque) || 1, c = catOf(p.categoria_id), nom = x => x === 'emp' ? 'Caja' : 'Unidades';
  if (u <= 1) return `Unidades (este producto tiene ${num(u)} unidad por empaque)`;
  if (p.unidad_salida) return `${nom(p.unidad_salida)} (regla del producto)`;
  return `${nom(c?.unidad_salida || 'un')} (regla de la categoría${c ? ' ' + c.nombre : ''})`;
}
const unidadSalida = p => (Number(p.unidades_por_empaque) || 1) > 1 ? (p.unidad_salida || catOf(p.categoria_id)?.unidad_salida || 'un') : 'un';

function prodRow(p) {
  const c = catOf(p.categoria_id), u = upeOf(p), e = estado(p);
  return `<button class="row st-${e}" data-act="prod" data-id="${p.id}"><div class="th lg" ${thumb(p.imagen_url)}>${p.imagen_url ? '' : (c?.emoji || '📦')}</div>
  <div class="mid"><b>${esc(p.nombre)}</b><small>${esc(p.empaque)}${u > 1 ? ' x' + num(u) : ''}${p.capacidad ? ' · ' + num(p.capacidad) + ' ' + esc(p.unidad_capacidad || '') : ''}</small></div>
  <div class="stock">${num(p.stock)}<small class="mut" style="display:block;font-size:12px;font-weight:400">${u > 1 ? num(Math.floor(p.stock / u)) + ' ' + esc(p.empaque.toLowerCase()) : 'un'}</small></div>
  <span class="pill ${e}">${{ ok: 'OK', low: 'Bajo', out: 'Agotado' }[e]}</span></button>`;
}

function viewHome() {
  const q = S.q.trim().toLowerCase();
  const sinStock = S.prods.length > 0 && S.prods.every(p => !p.stock);
  const nb = S.prods.filter(p => estado(p) === 'low').length, no = S.prods.filter(p => estado(p) === 'out').length;
  const stat = (n, l, cls, attr) => `<button class="hs ${cls}" ${attr}><b>${n}</b><small>${l}</small></button>`;
  // Encabezado de marca: logo, empresa, indicadores que llevan a la pantalla correspondiente y buscador
  let body = `<div class="hero2">
    <div class="h2top"><img class="hlogo" src="icons/icon-192.png" alt=""><div class="h2t"><small>INVENTARIO</small><h1>${esc(negocio())}</h1></div>
    <button class="hgear" data-go="#/ajustes" aria-label="Ajustes">⚙️</button></div>
    <div class="hstats">${stat(S.prods.length, 'Productos', '', 'data-go="#/stock"')}${stat(nb, 'Bajo mínimo', nb ? 'warn' : '', 'data-go="#/pedido"')}${stat(no, 'Agotados', no ? 'bad' : '', 'data-act="gostock" data-f="out"')}</div>
    <input class="search hsearch" id="q" type="search" placeholder="🔍 Buscar un producto…" value="${esc(S.q)}" autocomplete="off"></div>`;
  if (!q && canEdit() && sinStock) body += `<button class="banner info" data-go="#/conteo"><span class="bi">📝</span><div><b>Carga tu inventario inicial</b><small>Anota lo que hay hoy en bodega</small></div><span class="mut">›</span></button>`;
  if (q) {
    const r = S.prods.filter(p => (p.nombre + ' ' + (p.sku || '')).toLowerCase().includes(q));
    body += r.length ? r.map(prodRow).join('') : '<p class="mut center">Sin resultados</p>';
  } else if (!S.cats.length) {
    body += `<p class="center mut">Aún no hay categorías.${isAdmin() ? ' Crea la primera con el botón ＋' : ''}</p>`;
  } else {
    const info = c => { const ps = S.prods.filter(p => p.categoria_id === c.id); return { n: ps.length, al: ps.filter(p => p.stock <= p.stock_minimo).length }; };
    body += `<div class="home-h"><h2>Categorías</h2><span class="mut">${S.cats.length} · ${S.prods.length} producto${S.prods.length === 1 ? '' : 's'}</span></div>` + S.cats.map(c => {
      const { n, al } = info(c);
      return `<button class="row crow" data-go="#/cat/${c.id}"><div class="th lg" ${thumb(c.imagen_url)}>${c.imagen_url ? '' : esc(c.emoji)}</div>
      <div class="mid"><b>${esc(c.nombre)}</b><small>${n} producto${n === 1 ? '' : 's'}</small></div>
      ${al ? `<span class="pill low">${al} ⚠️</span>` : ''}<span class="mut">›</span></button>`;
    }).join('');
    const sin = S.prods.filter(p => !p.categoria_id);
    if (sin.length) body += `<div class="sec-h">Sin categoría</div>` + sin.map(prodRow).join('');
  }
  shell('Inventario', body, { nohead: true, fab: isAdmin() ? 'newcat' : '' });
  $('#q').oninput = e => { S.q = e.target.value; const pos = e.target.selectionStart; viewHome(); const i = $('#q'); i.focus(); i.setSelectionRange(pos, pos); };
}

function viewCat(id) {
  const c = catOf(id); if (!c) return (location.hash = '#/');
  const ps = S.prods.filter(p => p.categoria_id === id);
  const body = ps.length ? ps.map(prodRow).join('') : '<p class="center mut">Sin productos en esta categoría</p>';
  shell(`${c.emoji} ${c.nombre}`, body, { back: '#/', fab: canEdit() ? 'newprod' : '' });
  $('.fab')?.setAttribute('data-cat', id);
}

function viewProv() {
  const body = S.provs.length ? S.provs.map(p => `<div class="row" ${canEdit() ? `data-act="editprov" data-id="${p.id}"` : ''}>
    <div class="th">🚚</div><div class="mid"><b>${esc(p.nombre)}</b><small>${esc([p.contacto, p.telefono].filter(Boolean).join(' · '))}</small></div>
    ${p.telefono ? `<a class="btn sec sm" href="tel:${esc(p.telefono)}" onclick="event.stopPropagation()">📞</a>` : ''}</div>`).join('')
    : '<p class="center mut">Aún no hay proveedores</p>';
  shell('Proveedores', body, { fab: canEdit() ? 'newprov' : '' });
}

async function viewHist() {
  shell('Historial', '<p class="center mut">Cargando…</p>');
  const { data, error } = await sb.from('inv_movimientos').select('*, inv_productos(nombre)').eq('empresa_id', S.emp.id).order('created_at', { ascending: false }).limit(150);
  if (error) return fail(error);
  shell('Historial', data.length ? data.map(m => `<div class="hist"><div><b>${esc(m.inv_productos?.nombre || '—')}</b><br><small class="mut">${new Date(m.created_at).toLocaleString('es-CL')} · ${esc(m.usuario_email || '')}${m.nota ? ' · ' + esc(m.nota) : ''}</small></div>
    <div class="center"><span class="${m.tipo === 'ingreso' ? 'in-c' : 'out-c'}">${m.tipo === 'ingreso' ? '+' : '−'}${num(m.cantidad)}</span><br><small class="mut">= ${num(m.stock_resultante)}</small></div></div>`).join('') : '<p class="center mut">Sin movimientos</p>');
}

async function viewUsers() {
  if (!isAdmin()) return (location.hash = '#/');
  const { data, error } = await sb.from('inv_miembros').select('*').eq('empresa_id', S.emp.id).order('created_at');
  if (error) return fail(error);
  const rolOpts = sel => Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v}</option>`).join('');
  shell('Usuarios', `<p class="mut" style="margin-top:0">Usuarios de <b>${esc(negocio())}</b></p>` + data.map(u => `<div class="row" style="cursor:default"><div class="th">👤</div><div class="mid"><b>${esc(u.email)}</b></div>
    <select data-role="${u.user_id}" style="width:auto" ${u.user_id === S.user.id ? 'disabled' : ''}>${rolOpts(u.rol)}</select>
    ${u.user_id === S.user.id ? '' : `<button class="btn sec sm" data-act="rmmember" data-uid="${u.user_id}" data-email="${esc(u.email)}" aria-label="Quitar">✕</button>`}</div>`).join('')
    + `<div class="sec-h">Agregar usuario</div><form id="fadd" class="row" style="cursor:default;flex-wrap:wrap"><input name="email" type="email" required placeholder="correo@ejemplo.com" style="flex:1 1 200px">
    <select name="rol" style="width:auto">${rolOpts('bodega')}</select><button class="btn sm">Agregar</button></form>
    <p class="mut" style="font-size:13px">La persona debe crear antes su cuenta con ese correo. <b>Administrador</b>: todo. <b>Bodega</b>: ingresos/salidas y editar productos y proveedores. <b>Solo lectura</b>: consulta.</p>`);
  $('#fadd').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    const r = await sb.rpc('inv_agregar_miembro', { p_empresa: S.emp.id, p_email: f.get('email'), p_rol: f.get('rol') });
    if (r.error) return fail(r.error); toast('Usuario agregado ✓'); viewUsers();
  };
}

/* ---------- empresas y ajustes ---------- */
function viewOnboard() {
  app.innerHTML = `<div class="login"><h1>🏢 Bienvenido</h1><p class="center mut">Crea tu empresa para empezar. Tú serás el administrador.</p>
    <form id="fe"><label>Nombre de la empresa</label><input name="nombre" required maxlength="60" placeholder="Ej. Bar La Esquina" autofocus>
    <p><button class="btn full">Crear empresa</button></p></form>
    <p class="center mut" style="font-size:13px">¿Te invitaron a una empresa? Pídele al administrador que te agregue con el correo <b>${esc(S.user.email)}</b> y vuelve a abrir la app.</p>
    <p class="center"><button class="btn sec sm" data-act="logout">Cerrar sesión</button></p></div>`;
  $('#fe').onsubmit = async e => { e.preventDefault(); const b = $('button', e.target); b.disabled = true; try { await crearEmpresa(new FormData(e.target).get('nombre')); } catch (er) { fail(er); b.disabled = false; } };
}

function viewAjustes() {
  const adm = isAdmin();
  shell('Ajustes', `<div class="sec-h" style="margin-top:0">Empresa</div>
    <form id="fname" class="row" style="cursor:default"><input name="nombre" value="${esc(S.emp.nombre)}" required maxlength="60" ${adm ? '' : 'disabled'} style="flex:1">${adm ? '<button class="btn sm">Guardar</button>' : ''}</form>
    ${adm ? '' : '<p class="mut" style="font-size:13px">Solo el administrador puede cambiar el nombre.</p>'}
    ${adm ? `<div class="sec-h">Privacidad</div><label style="margin-top:0">¿Quién ve costos, precios y valores en dinero?</label>
    <select data-vc><option value="admin" ${S.emp.ver_costos !== 'bodega' ? 'selected' : ''}>Solo el administrador</option><option value="bodega" ${S.emp.ver_costos === 'bodega' ? 'selected' : ''}>Administrador y Bodega</option></select>
    <p class="mut" style="font-size:13px">Solo lectura nunca ve valores en dinero. Esto afecta a la pestaña Stock, las fichas, los precios al editar y las compras.</p>` : ''}
    <div class="sec-h">Mis empresas</div>
    ${S.empresas.map(e => `<button class="row" data-act="setemp" data-id="${e.id}"><div class="th">🏢</div><div class="mid"><b>${esc(e.nombre)}</b><small>${ROLES[e.rol]}</small></div>${e.id === S.emp.id ? '<span class="pill ok">Actual</span>' : '<span class="mut">Cambiar ›</span>'}</button>`).join('')}
    ${adm ? '<button class="btn sec full" data-act="newemp">＋ Crear otra empresa</button>' : ''}
    ${adm ? `<div class="sec-h">Categorías</div>${S.cats.length ? S.cats.map(c => `<button class="row" data-act="editcat" data-id="${c.id}"><div class="th" ${thumb(c.imagen_url)}>${c.imagen_url ? '' : esc(c.emoji)}</div><div class="mid"><b>${esc(c.nombre)}</b><small>Tocar para editar</small></div><span class="mut">✏️</span></button>`).join('') : '<p class="mut">Aún no hay categorías</p>'}
    <button class="btn sec full" data-act="newcat">＋ Nueva categoría</button>` : ''}
    ${adm ? `<div class="sec-h">Prueba en limpio</div>
    <button class="btn sec full" data-act="resetstock">🧹 Poner todas las cantidades en 0</button>
    <p class="mut" style="font-size:13px">Deja el stock de todos los productos en 0 para empezar una prueba de cero. Los productos, categorías, proveedores y reglas se mantienen.</p>` : ''}
    <div class="sec-h">Mi cuenta</div>
    <p class="mut" style="margin-top:0">${esc(S.user.email)} · ${ROLES[S.perfil.rol]}</p>
    <button class="btn sec full" data-act="logout">Cerrar sesión</button>
    <p class="center mut" style="font-size:12px;margin-top:18px">Versión ${VERSION}${LOCAL ? ' · modo local' : ''}</p>`);
  $('#fname').onsubmit = async e => {
    e.preventDefault(); const nombre = new FormData(e.target).get('nombre').trim(); if (!nombre) return;
    const r = await sb.from('inv_empresas').update({ nombre }).eq('id', S.emp.id);
    if (r.error) return fail(r.error);
    await loadAll(); toast('Nombre actualizado ✓'); viewAjustes();
  };
}
function empresaForm() {
  form('Nueva empresa', '<label>Nombre de la empresa *</label><input name="nombre" required maxlength="60" autofocus><p class="mut" style="font-size:13px">Tendrá sus propios productos, proveedores y usuarios. Tú serás el administrador.</p>',
    async f => { await crearEmpresa(f.get('nombre')); });
}

/* ---------- Mover estilo POS (varios productos) ---------- */
const M = { modo: 'salida', lines: [], prov: '', nota: '', motivo: 'Venta', cat: '', q: '' };
const MOTIVOS = ['Venta', 'Consumo interno', 'Merma / vencido', 'Devolución a proveedor', 'Otro'];
const upeOf = p => Number(p.unidades_por_empaque) || 1;

// Cuadro de producto con foto (sirve para la categoria y para Mover)
function ptile(p, act, line) {
  const c = catOf(p.categoria_id);
  const md = M.modo === 'compra' ? 'in' : 'out';
  const badge = line ? `<span class="qb ${md}">${num(line.qty)}${line.unit === 'emp' ? ' ' + esc(p.empaque.toLowerCase().slice(0, 4)) : ''}</span><span class="mn" data-act="dec" data-id="${p.id}">−</span>` : '';
  return `<div class="tile${line ? ' sel ' + md : ''}" role="button" data-act="${act}" data-id="${p.id}"><div class="img" ${thumb(p.imagen_url)}>${p.imagen_url ? '' : esc(c?.emoji || '📦')}<span class="st pill ${estado(p)}">${num(p.stock)}</span>${badge}</div>
    <div class="lbl">${esc(p.nombre)}</div></div>`;
}

// Fila de pestañas deslizable: se desvanece a la derecha mientras haya mas pestañas por ver, y deja visible la activa
function tabsFade(el) {
  if (!el) return;
  const upd = () => el.classList.toggle('fade', el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
  const on = el.querySelector('.on'); if (on) el.scrollLeft = Math.max(0, on.offsetLeft - 40);
  upd(); el.addEventListener('scroll', upd, { passive: true });
}
function viewMove() {
  if (!canEdit()) return (location.hash = '#/');
  const c = M.modo === 'compra';
  shell('Mover', `<div class="mvbar ${c ? 'in' : 'out'}">
      <div class="mvrow"><div class="mvtog"><button data-act="mode" data-m="salida" class="${c ? '' : 'on out'}">⬇️ Salida</button><button data-act="mode" data-m="compra" class="${c ? 'on in' : ''}">⬆️ Compra</button></div>
      <input class="search" id="mq" type="search" placeholder="🔍 Buscar…" value="${esc(M.q)}" autocomplete="off"></div>
      <div class="tabs" id="mtabs"><button class="${M.cat === '' ? 'on' : ''}" data-act="mcat" data-c="">Todas</button>${S.cats.map(k => `<button class="${M.cat === k.id ? 'on' : ''}" data-act="mcat" data-c="${k.id}">${esc(k.emoji)} ${esc(k.nombre)}</button>`).join('')}</div>
    </div>
    <div id="mgrid" class="grid sm"></div><div style="height:84px"></div><div id="cartbar"></div>`);
  document.documentElement.style.setProperty('--hh', ($('header')?.offsetHeight || 46) + 'px'); // la barra de Mover queda fija justo bajo el titulo
  tabsFade($('#mtabs'));
  $('#mq').oninput = e => { M.q = e.target.value; paintGrid(); };
  paintGrid(); paintBar();
}
function paintGrid() {
  const g = $('#mgrid'); if (!g) return;
  const q = M.q.trim().toLowerCase();
  let r = S.prods; if (M.cat) r = r.filter(p => p.categoria_id === M.cat);
  if (q) r = r.filter(p => (p.nombre + ' ' + (p.sku || '')).toLowerCase().includes(q));
  g.innerHTML = r.length ? r.map(p => ptile(p, 'tap', M.lines.find(l => l.id === p.id))).join('') : '<p class="mut center" style="grid-column:1/-1">Sin productos</p>';
}
function paintBar() {
  const b = $('#cartbar'); if (!b) return;
  const n = M.lines.length, c = M.modo === 'compra';
  b.innerHTML = n ? `<div class="cartbar ${c ? 'in' : 'out'}"><button class="clr" data-act="mclear" aria-label="Vaciar la lista">✕</button>
    <div class="ct"><b>${n} producto${n === 1 ? '' : 's'}</b><small>${c ? 'Compra' : 'Salida'} sin confirmar</small></div><button class="btn" data-act="review">Revisar ›</button></div>` : '';
}
function addLine(id) {
  const p = prodOf(id); if (!p) return;
  const emp = upeOf(p) > 1 && (M.modo === 'compra' || unidadSalida(p) === 'emp'); // compra: caja; salida: segun categoria/producto
  M.lines.push({ id, qty: 1, unit: emp ? 'emp' : 'un', costo: Math.round((Number(p.precio_costo) || 0) * (emp ? upeOf(p) : 1) * 100) / 100 });
}
function tapProd(id) {
  const l = M.lines.find(x => x.id === id); if (l) l.qty += 1; else addLine(id);
  paintGrid(); paintBar();
}
function decProd(id) {
  const i = M.lines.findIndex(x => x.id === id); if (i < 0) return;
  M.lines[i].qty -= 1; if (M.lines[i].qty <= 0) M.lines.splice(i, 1);
  paintGrid(); paintBar();
}
function review() {
  const c = M.modo === 'compra';
  modal(`<h2>${c ? '🛒 Compra' : '📤 Salida'}</h2>
    ${c ? `<label>Proveedor</label><select id="mprov">${opts(S.provs, M.prov, '— cualquiera —')}</select><label>N° factura / guía (opcional)</label>`
      : `<label>Motivo</label><select id="mmot">${MOTIVOS.map(m => `<option ${m === M.motivo ? 'selected' : ''}>${m}</option>`).join('')}</select><label>Nota (opcional)</label>`}
    <input id="mnota" value="${esc(M.nota)}" placeholder="${c ? 'Ej. F-1234' : 'Ej. cumpleaños, rotura…'}">
    <div class="sec-h">Detalle</div><div id="mlines"></div><div id="mfoot"></div>
    <p><button class="btn sec full" data-act="closemodal">Seguir agregando</button></p>`);
  $('#mprov')?.addEventListener('change', e => M.prov = e.target.value);
  $('#mmot')?.addEventListener('change', e => M.motivo = e.target.value);
  $('#mnota').oninput = e => M.nota = e.target.value;
  paintLines();
}

// Panel rapido de un solo producto (desde la categoria): Ingreso / Salida en 2 toques
function quickMove(id) {
  const p = prodOf(id); if (!p) return;
  const u = upeOf(p), c = catOf(p.categoria_id), st = { tipo: 'salida', unit: unidadSalida(p) };
  const s = modal(`<div style="display:flex;gap:12px;align-items:center"><div class="qth" ${thumb(p.imagen_url)}>${p.imagen_url ? '' : esc(c?.emoji || '📦')}</div>
    <div style="flex:1;min-width:0"><h2 style="margin:0">${esc(p.nombre)}</h2><div class="mut" style="font-size:14px">Stock: ${esc(stockTxt(p))}</div><div class="mut" style="font-size:12px;text-decoration:underline dotted;cursor:pointer" data-act="diag" data-id="${p.id}">Salida: ${esc(reglaSalida(p))} ⓘ</div></div><span class="pill ${estado(p)}">${{ ok: 'OK', low: 'Bajo', out: 'Agotado' }[estado(p)]}</span></div>
    <div class="seg"><button class="in" data-t="ingreso">⬆️ Ingreso</button><button class="on out" data-t="salida">⬇️ Salida</button></div>
    ${u > 1 ? `<div class="seg" style="margin-top:0"><button class="on in" id="u1" data-u="un">Unidades</button><button id="u2" data-u="emp">${esc(p.empaque)} (x${num(u)})</button></div>` : ''}
    ${u > 1 ? '<p style="margin:-2px 0 8px;text-align:right"><button class="btn sec sm" id="pin" type="button" style="display:none"></button></p>' : ''}
    <div class="chips">${[1, 2, 3, 5, 10, 20].map(n => `<button class="chip" data-n="${n}">${n}</button>`).join('')}</div>
    <div class="step"><button id="m">−</button><input id="cant" type="number" inputmode="decimal" min="0" step="any" value="1"><button id="pl">+</button></div>
    <p><button class="btn full bad" id="ok">Registrar salida</button></p>
    <div class="two"><button class="btn sec" id="det">Detalle / editar</button><button class="btn sec" data-act="closemodal">Cerrar</button></div>`);
  const ci = $('#cant', s);
  // Boton "Salir siempre en ...": aparece si en una salida eliges una unidad distinta a la regla; la guarda en el producto
  const paintU = () => {
    if (u > 1) {
      $('#u1', s).className = st.unit === 'un' ? 'on in' : ''; $('#u2', s).className = st.unit === 'emp' ? 'on in' : '';
      const pin = $('#pin', s); pin.style.display = st.tipo === 'salida' && st.unit !== unidadSalida(p) ? '' : 'none';
      pin.textContent = `📌 Que este producto salga siempre en ${st.unit === 'emp' ? p.empaque.toLowerCase() : 'unidades'}`;
    }
  };
  $('#pin', s)?.addEventListener('click', async () => {
    const { error } = await sb.from('inv_productos').update({ unidad_salida: st.unit }).eq('id', id);
    if (error) return fail(error);
    await loadAll(); toast(`✓ ${p.nombre} saldrá siempre en ${st.unit === 'emp' ? p.empaque.toLowerCase() : 'unidades'}`); quickMove(id);
  });
  const setT = t => {
    st.tipo = t; st.unit = t === 'ingreso' ? (u > 1 ? 'emp' : 'un') : unidadSalida(p); // ingreso -> cajas; salida -> segun categoria/producto (por defecto unidades)
    s.querySelectorAll('[data-t]').forEach(b => b.className = (b.dataset.t === t ? 'on ' : '') + (b.dataset.t === 'ingreso' ? 'in' : 'out'));
    $('#ok', s).textContent = t === 'ingreso' ? 'Registrar ingreso' : 'Registrar salida'; $('#ok', s).classList.toggle('bad', t === 'salida'); paintU();
  };
  paintU();
  s.querySelectorAll('[data-t]').forEach(b => b.onclick = () => setT(b.dataset.t));
  s.querySelectorAll('[data-u]').forEach(b => b.onclick = () => { st.unit = b.dataset.u; paintU(); });
  s.querySelectorAll('[data-n]').forEach(b => b.onclick = () => ci.value = b.dataset.n);
  $('#m', s).onclick = () => ci.value = Math.max(0, (Number(ci.value) || 0) - 1);
  $('#pl', s).onclick = () => ci.value = (Number(ci.value) || 0) + 1;
  $('#det', s).onclick = () => openProd(id);
  $('#ok', s).onclick = async e => {
    const q = (Number(ci.value) || 0) * (st.unit === 'emp' ? u : 1);
    if (q <= 0) return toast('Ingresa una cantidad');
    e.target.disabled = true;
    const { error } = await sb.rpc('inv_mover_stock', { p_producto: id, p_tipo: st.tipo, p_cantidad: q, p_nota: 'Rápido' });
    e.target.disabled = false;
    if (error) return fail(error);
    toast(`${st.tipo === 'ingreso' ? '＋' : '－'}${num(q)} un · ${p.nombre}`);
    await loadAll(); closeModal(); render();
  };
}

// Aviso en una compra si lo que se agrega deja el stock sobre el maximo definido
function warnTxt(l) {
  const p = prodOf(l.id), mx = maxOf(p); if (M.modo !== 'compra' || !p || !mx) return '';
  const nu = p.stock + (l.qty || 0) * (l.unit === 'emp' ? upeOf(p) : 1);
  return nu > mx ? `<span style="color:var(--warn)">⚠️ Quedaría en ${fmtQ(p, nu)}, sobre el máximo (${fmtQ(p, mx)})</span>` : '';
}
function paintLines() {
  const c = M.modo === 'compra', box = $('#mlines'); if (!box) return;
  box.innerHTML = M.lines.length ? M.lines.map((l, i) => {
    const p = prodOf(l.id), emp = upeOf(p) > 1;
    return `<div class="ord" data-i="${i}"><div style="flex:1;min-width:0"><b>${esc(p.nombre)}</b><br><small class="mut">Stock actual ${num(p.stock)} un</small>
      <div class="two" style="margin-top:6px"><input type="number" inputmode="decimal" min="0" step="any" data-f="qty" value="${l.qty}" style="width:100%">
      ${emp ? `<select data-f="unit"><option value="un" ${l.unit === 'un' ? 'selected' : ''}>unidades</option><option value="emp" ${l.unit === 'emp' ? 'selected' : ''}>${esc(p.empaque)} (x${num(upeOf(p))})</option></select>` : '<span class="mut" style="align-self:center">unidades</span>'}</div>
      ${c && canCost() ? `<label style="margin:6px 0 2px">Costo por ${l.unit === 'emp' ? esc(p.empaque.toLowerCase()) : 'unidad'}</label><input type="number" inputmode="decimal" min="0" step="any" data-f="costo" value="${l.costo}">` : ''}
      <small data-warn style="display:block;margin-top:4px">${warnTxt(l)}</small></div>
      <button class="btn sec sm" data-act="rmline" data-i="${i}" aria-label="Quitar">✕</button></div>`;
  }).join('') : '<p class="mut center">Busca y agrega productos arriba</p>';
  paintFoot();
}
function paintFoot() {
  const c = M.modo === 'compra', f = $('#mfoot'); if (!f) return;
  const tot = M.lines.reduce((a, l) => a + (l.qty || 0) * (l.costo || 0), 0);
  f.innerHTML = M.lines.length ? `${c && canCost() ? `<p class="center"><b>Total compra: ${money(tot)}</b></p>` : ''}<button class="btn full ${c ? '' : 'bad'}" data-act="submitmove">${c ? 'Registrar compra' : 'Registrar salida'} (${M.lines.length})</button>` : '';
}
async function submitMove(btn) {
  const c = M.modo === 'compra', L = M.lines.filter(l => l.qty > 0);
  if (!L.length) return toast('Ingresa cantidades mayores a 0');
  btn.disabled = true; const fails = []; const left = [];
  const nota = c ? ['Compra', M.nota && 'Doc. ' + M.nota, provOf(M.prov)?.nombre].filter(Boolean).join(' · ') : [M.motivo, M.nota].filter(Boolean).join(' · ');
  for (const l of L) {
    const p = prodOf(l.id), u = upeOf(p), q = l.qty * (l.unit === 'emp' ? u : 1);
    const r = await sb.rpc('inv_mover_stock', { p_producto: l.id, p_tipo: c ? 'ingreso' : 'salida', p_cantidad: q, p_nota: nota });
    if (r.error) { fails.push(`${p.nombre}: ${r.error.message}`); left.push(l); continue; }
    if (c && canCost() && l.costo > 0) {
      const cu = l.unit === 'emp' ? l.costo / u : l.costo;
      if (Math.abs(cu - (Number(p.precio_costo) || 0)) > 0.005) { const u2 = await sb.from('inv_productos').update({ precio_costo: cu }).eq('id', l.id); if (u2.error) fails.push(`${p.nombre} (costo): ${u2.error.message}`); }
    }
  }
  M.lines = left; if (!left.length) M.nota = '';
  try { await loadAll(); } catch (e) { fail(e); }
  closeModal(); viewMove();
  if (fails.length) alert('Algunos movimientos no se registraron:\n\n' + fails.join('\n')); else toast(`${c ? 'Compra' : 'Salida'} registrada ✓ (${L.length} producto${L.length === 1 ? '' : 's'})`);
}

/* ---------- Stock: listado por categoria ---------- */
const K = { f: 'all', q: '', closed: new Set(), painting: false };
const FILTROS = [['all', 'Todos'], ['ok', 'OK'], ['low', 'Bajo'], ['out', 'Agotado']];
const valC = p => (Number(p.stock) || 0) * (Number(p.precio_costo) || 0);
const catKey = p => catOf(p.categoria_id) ? p.categoria_id : '';
const grupos = () => [...S.cats.map(c => [c.id, `${c.emoji} ${c.nombre}`]), ['', 'Sin categoría']];
function stockList() {
  const q = K.q.trim().toLowerCase();
  return S.prods.filter(p => (K.f === 'all' || estado(p) === K.f) && (!q || (p.nombre + ' ' + (p.sku || '')).toLowerCase().includes(q)));
}
function srow(p) {
  const e = estado(p), u = upeOf(p), mn = Number(p.stock_minimo) || 0, mx = maxOf(p), over = mx > 0 && p.stock > mx;
  const sc = Math.max(mx || mn * 2, p.stock, 1), fill = Math.max(0, Math.min(100, p.stock / sc * 100)), mk = mn ? Math.min(100, mn / sc * 100) : null;
  const lim = mn || mx ? ` · mín ${fmtQ(p, mn)}${mx ? ' · máx ' + fmtQ(p, mx) : ''}` : '';
  return `<button class="row srow" data-act="prod" data-id="${p.id}"><div class="th" ${thumb(p.imagen_url)}>${p.imagen_url ? '' : esc(catOf(p.categoria_id)?.emoji || '📦')}</div>
    <div class="mid"><b>${esc(p.nombre)}</b><small>${esc(p.empaque)}${u > 1 ? ' x' + num(u) : ''}${lim}</small>
    <div class="bar"><i class="${over ? 'over' : e}" style="width:${fill}%"></i>${mk !== null ? `<u style="left:${mk}%"></u>` : ''}</div></div>
    <div class="stock">${num(p.stock)}<small class="mut" style="display:block;font-size:12px;font-weight:400">${u > 1 ? num(Math.floor(p.stock / u)) + ' ' + esc(p.empaque.toLowerCase()) + (p.stock % u ? ' +' + num(p.stock % u) : '') : 'un'}</small>${over ? '<span class="pill over" style="margin-top:2px">Sobre máx.</span>' : ''}</div></button>`;
}
function viewStock() {
  const all = S.prods, n = { ok: 0, low: 0, out: 0 }; all.forEach(p => n[estado(p)]++);
  const cnt = { all: all.length, ...n };
  // Los valores en dinero solo los ve quien tiene permiso (Ajustes > Privacidad)
  const kpi = canCost()
    ? [['Productos', all.length], ['Inversión (costo)', money(all.reduce((a, p) => a + valC(p), 0))], ['Venta potencial', money(all.reduce((a, p) => a + (Number(p.stock) || 0) * (Number(p.precio_venta) || 0), 0))]]
    : [['Productos', all.length], ['Categorías', S.cats.length], ['Con alerta', n.low + n.out]];
  // Resumen en una tarjeta; selector de 4 partes (cabe completo) + buscador fijos al bajar
  shell('Stock', `<div class="skpi"><div class="k3">${kpi.map(([t, v]) => `<div><small>${t}</small><b>${v}</b></div>`).join('')}</div>
    <div class="health">${['ok', 'low', 'out'].map(k => n[k] ? `<i class="${k}" style="flex:${n[k]}"></i>` : '').join('')}</div></div>
    <div class="stbar">
      <div class="seg4">${FILTROS.map(([k, l]) => `<button class="${K.f === k ? 'on' : ''}" data-act="sfil" data-f="${k}">${k !== 'all' ? `<i class="dot ${k}"></i>` : ''}${l}<b>${cnt[k]}</b></button>`).join('')}</div>
      <div class="searchbar"><input class="search" id="sq" type="search" placeholder="🔍 Buscar en el stock…" value="${esc(K.q)}" autocomplete="off">
      <button class="btn sec ibtn" data-act="stoggle" aria-label="Contraer o expandir categorías">↕</button><button class="btn sec ibtn" data-act="sexport" aria-label="Exportar">⤓</button></div>
    </div>
    <div id="stklist"></div>`);
  document.documentElement.style.setProperty('--hh', ($('header')?.offsetHeight || 43) + 'px');
  $('#sq').oninput = e => { K.q = e.target.value; paintStock(); };
  paintStock();
}
function paintStock() {
  const box = $('#stklist'); if (!box) return;
  const list = stockList(), force = K.q.trim() || K.f !== 'all', cost = canCost();
  K.painting = true; setTimeout(() => K.painting = false, 80);
  box.innerHTML = grupos().map(([id, title]) => {
    const ps = list.filter(p => catKey(p) === id); if (!ps.length) return '';
    const sub = ps.reduce((a, p) => a + valC(p), 0), al = ps.filter(p => estado(p) !== 'ok').length;
    return `<details class="grp" data-gid="${id || '_'}" ${force || !K.closed.has(id) ? 'open' : ''}><summary><b>${esc(title)}</b><span class="mut">${ps.length}</span>${al ? `<span class="pill low">${al} ⚠️</span>` : ''}${cost ? `<span class="sub">${money(sub)}</span>` : ''}</summary>${ps.map(srow).join('')}</details>`;
  }).join('') || '<p class="center mut">Sin productos para mostrar</p>';
}
document.addEventListener('toggle', e => {
  const d = e.target; if (K.painting || d.dataset?.gid === undefined) return;
  const id = d.dataset.gid === '_' ? '' : d.dataset.gid; d.open ? K.closed.delete(id) : K.closed.add(id);
}, true);
function stockCSV() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`, cost = canCost();
  const head = ['Categoría', 'Producto', 'SKU', 'Empaque', 'Unid. por empaque', 'Stock (un)', 'Stock (empaques)', 'Mínimo (un)', 'Máximo (un)', 'Estado', ...(cost ? ['Costo unit.', 'Venta unit.', 'Valor a costo'] : [])];
  const rows = [];
  grupos().forEach(([id]) => stockList().filter(p => catKey(p) === id).forEach(p => rows.push([catOf(id)?.nombre || 'Sin categoría', p.nombre, p.sku, p.empaque, upeOf(p), p.stock, Math.round(p.stock / upeOf(p) * 100) / 100, p.stock_minimo, maxOf(p), { ok: 'OK', low: 'Bajo', out: 'Agotado' }[estado(p)], ...(cost ? [p.precio_costo, p.precio_venta, Math.round(valC(p))] : [])])));
  return '﻿' + [head, ...rows].map(r => r.map(q).join(';')).join('\r\n');
}
function stockText() {
  const list = stockList(), out = [`📦 Stock ${negocio()} — ${new Date().toLocaleDateString('es-CL')}`];
  grupos().forEach(([id, title]) => {
    const ps = list.filter(p => catKey(p) === id); if (!ps.length) return;
    out.push('', `*${title}*`, ...ps.map(p => `• ${p.nombre}: ${num(p.stock)} un${upeOf(p) > 1 ? ` (${num(Math.floor(p.stock / upeOf(p)))} ${p.empaque.toLowerCase()})` : ''}${estado(p) !== 'ok' ? ' ⚠️' : ''}`));
  });
  return out.join('\n');
}
async function shareStock() {
  const text = stockText();
  if (navigator.share) { try { await navigator.share({ title: 'Stock', text }); } catch { } return; }
  try { await navigator.clipboard.writeText(text); toast('Lista copiada: pégala donde quieras'); } catch { toast('Tu navegador no permite compartir'); }
}

/* ---------- Inventario inicial / conteo fisico ---------- */
// Se anota lo que hay en bodega (cajas + sueltas); al guardar se registra la diferencia como ingreso o salida con nota.
const C = { v: {}, q: '', modo: 'Inventario inicial', manual: false };
const cTotal = p => {
  const v = C.v[p.id]; if (!v || (v.c === '' && v.s === '')) return null;
  return Math.round(((upeOf(p) > 1 ? fnum(v.c) * upeOf(p) : 0) + fnum(v.s)) * 1000) / 1000;
};
function crow(p) {
  const u = upeOf(p), v = C.v[p.id] || { c: '', s: '' };
  return `<div class="cnt" data-cid="${p.id}"><div class="mid"><b>${esc(p.nombre)}</b><small class="mut">Hay: ${esc(stockTxt(p))}</small></div>
    <div class="cin">${u > 1 ? `<div><label>${esc(plural(p.empaque))}</label><input type="number" inputmode="decimal" min="0" step="any" data-cf="c" value="${esc(v.c)}" placeholder="${num(Math.floor(p.stock / u))}"></div>` : ''}
    <div><label>${u > 1 ? 'Sueltas (un)' : 'Unidades'}</label><input type="number" inputmode="decimal" min="0" step="any" data-cf="s" value="${esc(v.s)}" placeholder="${num(u > 1 ? p.stock % u : p.stock)}"></div></div>
    <div class="cdelta" data-cd></div></div>`;
}
function viewConteo() {
  if (!canEdit()) return (location.hash = '#/');
  if (!C.manual) C.modo = S.prods.every(p => !p.stock) ? 'Inventario inicial' : 'Ajuste por conteo';
  shell('Inventario inicial', `<p class="mut" style="margin-top:0">Anota lo que hay físicamente en bodega. Los campos vacíos no cambian: solo se guardan los productos que escribas.</p>
    <div class="seg"><button data-act="cmodo" data-m="Inventario inicial" class="${C.modo === 'Inventario inicial' ? 'on in' : ''}">Inventario inicial</button><button data-act="cmodo" data-m="Ajuste por conteo" class="${C.modo === 'Ajuste por conteo' ? 'on in' : ''}">Ajuste por conteo</button></div>
    <p class="mut" style="font-size:13px;margin:-2px 2px 12px">${C.modo === 'Inventario inicial' ? 'Para cargar lo que hay por primera vez.' : 'Para corregir diferencias después de un recuento.'} Los dos calculan igual: solo cambia la nota <b>«${C.modo}»</b> que queda en el historial.</p>
    <input class="search" id="cq" type="search" placeholder="🔍 Buscar producto…" value="${esc(C.q)}" autocomplete="off">
    <div id="clist"></div><div style="height:80px"></div><div id="cbar"></div>`, { back: '#/mas' });
  $('#cq').oninput = e => { C.q = e.target.value; paintConteo(); };
  paintConteo();
}
function paintConteo() {
  const box = $('#clist'); if (!box) return;
  const q = C.q.trim().toLowerCase(), list = S.prods.filter(p => !q || (p.nombre + ' ' + (p.sku || '')).toLowerCase().includes(q));
  box.innerHTML = grupos().map(([id, title]) => {
    const ps = list.filter(p => catKey(p) === id); if (!ps.length) return '';
    return `<div class="sec-h">${esc(title)}</div>` + ps.map(crow).join('');
  }).join('') || '<p class="center mut">Sin productos</p>';
  paintDeltas();
}
function paintDeltas() {
  let n = 0; S.prods.forEach(p => { const t = cTotal(p); if (t !== null && Math.abs(t - p.stock) > 1e-9) n++; });
  document.querySelectorAll('[data-cid]').forEach(r => {
    const p = prodOf(r.dataset.cid), t = p && cTotal(p), el = r.querySelector('[data-cd]'); if (!el || !p) return;
    if (t === null) { el.innerHTML = ''; return; }
    const d = Math.round((t - p.stock) * 1000) / 1000;
    el.innerHTML = d === 0 ? '<span class="mut">sin cambio</span>' : `<b class="${d > 0 ? 'in-c' : 'out-c'}">${esc(fmtQ(p, t))}</b> <span class="mut">(${d > 0 ? '+' : ''}${num(d)} un)</span>`;
  });
  const b = $('#cbar'); if (b) b.innerHTML = n ? `<div class="cartbar in"><b>${n} producto${n === 1 ? '' : 's'} con cambios</b><button class="btn" data-act="csave">Guardar inventario</button></div>` : '';
}
async function guardarConteo(btn) {
  const cambios = S.prods.map(p => ({ p, t: cTotal(p) })).filter(x => x.t !== null && Math.abs(x.t - x.p.stock) > 1e-9);
  if (!cambios.length) return toast('No hay cambios que guardar');
  if (!confirm(`Se actualizará el stock de ${cambios.length} producto${cambios.length === 1 ? '' : 's'} (${C.modo}). ¿Continuar?`)) return;
  btn.disabled = true; const fails = [];
  for (const { p, t } of cambios) {
    const d = Math.round((t - p.stock) * 1000) / 1000;
    const r = await sb.rpc('inv_mover_stock', { p_producto: p.id, p_tipo: d > 0 ? 'ingreso' : 'salida', p_cantidad: Math.abs(d), p_nota: C.modo });
    if (r.error) fails.push(`${p.nombre}: ${r.error.message}`); else delete C.v[p.id];
  }
  try { await loadAll(); } catch (e) { fail(e); }
  C.manual = false; viewConteo();
  if (fails.length) alert('Algunos productos no se guardaron:\n\n' + fails.join('\n')); else toast(`✓ Inventario guardado (${cambios.length} producto${cambios.length === 1 ? '' : 's'})`);
}

function viewMas() {
  const it = (go, ic, t, s) => `<button class="row" data-go="${go}"><div class="th">${ic}</div><div class="mid"><b>${t}</b><small>${s}</small></div><span class="mut">›</span></button>`;
  shell('Más', it('#/ajustes', '⚙️', 'Ajustes', 'Empresa, categorías y cuenta') + (canEdit() ? it('#/conteo', '📝', 'Inventario inicial', 'Anota lo que hay hoy en bodega') : '') +it('#/proveedores', '🚚', 'Proveedores', 'Contactos y datos de compra') + it('#/historial', '📜', 'Historial', 'Todos los ingresos y salidas') + (isAdmin() ? it('#/usuarios', '👥', 'Usuarios', 'Roles y permisos') : ''));
}

/* ---------- pedido a proveedor ---------- */
// Meta de cada producto: su maximo; si no tiene maximo, el doble del minimo; sin ninguno no se sugiere nada.
const objetivo = p => maxOf(p) || (Number(p.stock_minimo) > 0 ? Number(p.stock_minimo) * 2 : 0);
// Cuantos empaques (o unidades si no tiene empaque) faltan para llegar a la meta, sin pasarse del maximo
function sugerido(p) {
  const u = upeOf(p), obj = objetivo(p); if (!obj) return 0;
  const falta = Math.max(0, obj - p.stock);
  let q = u > 1 ? Math.floor(falta / u + 1e-9) : Math.ceil(falta - 1e-9);
  if (q < 1 && p.stock <= (Number(p.stock_minimo) || 0)) q = 1; // bajo el minimo: al menos 1
  return q;
}
const porPedir = () => S.prods.filter(p => sugerido(p) >= 1);
// Fila de un producto en el pedido: foto, estado, barra "hoy -> quedara" y cantidad con - / +
function poRow(p) {
  const u = upeOf(p), mx = maxOf(p), mn = Number(p.stock_minimo) || 0, c = catOf(p.categoria_id);
  return `<div class="po" data-po="${p.id}">
    <div class="pot"><input type="checkbox" checked data-pid="${p.id}" aria-label="Incluir en el pedido"><div class="th" ${thumb(p.imagen_url)}>${p.imagen_url ? '' : esc(c?.emoji || '📦')}</div>
      <div class="mid"><b>${esc(p.nombre)}</b>${estado(p) !== 'ok' ? ' <span class="pill low">Bajo mínimo</span>' : ''}
      <small class="mut">Hay ${esc(fmtQ(p, p.stock))} · mín ${esc(fmtQ(p, mn))} · ${mx ? 'máx ' + esc(fmtQ(p, mx)) : 'sin máximo'}</small></div></div>
    <div class="pob"><div class="pproj"><div class="bar proj"><i class="cur"></i><i class="add"></i><u></u></div><small data-after></small></div>
      <div class="sq"><div class="stepper2"><button type="button" data-act="pstep" data-id="${p.id}" data-d="-1" aria-label="Menos">−</button><input type="number" min="1" step="1" inputmode="numeric" value="${sugerido(p)}" data-qty="${p.id}"><button type="button" data-act="pstep" data-id="${p.id}" data-d="1" aria-label="Más">＋</button></div>
      <small>${u > 1 ? esc(plural(p.empaque)) : 'unidades'}</small></div></div>
  </div>`;
}
// Actualiza la barra, el texto "quedara en..." y el pie de la tarjeta del proveedor
function updPO(row) {
  const p = row && prodOf(row.dataset.po); if (!p) return;
  const g = row.closest('.pcard'), u = upeOf(p), chk = row.querySelector('[data-pid]').checked, mx = maxOf(p), mn = Number(p.stock_minimo) || 0;
  const qty = Math.max(0, Math.round(Number(row.querySelector('[data-qty]').value) || 0)), after = p.stock + qty * u;
  const sc = Math.max(mx || objetivo(p) || 0, after, p.stock, 1), cur = Math.min(100, p.stock / sc * 100);
  row.classList.toggle('off', !chk);
  row.querySelector('.cur').style.width = cur + '%';
  row.querySelector('.add').style.width = chk ? Math.min(100 - cur, qty * u / sc * 100) + '%' : '0%';
  const mk = row.querySelector('.proj u'); mk.style.display = mn ? '' : 'none'; mk.style.left = Math.min(100, mn / sc * 100) + '%';
  row.querySelector('[data-after]').innerHTML = chk ? `Quedará en <b>${esc(fmtQ(p, after))}</b>${mx && after > mx ? ' <span style="color:var(--warn)">· sobre el máximo</span>' : ''}` : 'No se pedirá';
  let n = 0, un = 0, cost = 0;
  g.querySelectorAll('.po').forEach(r => {
    const q = prodOf(r.dataset.po), v = Math.max(0, Math.round(Number(r.querySelector('[data-qty]').value) || 0));
    if (r.querySelector('[data-pid]').checked && v) { n++; un += v * upeOf(q); cost += v * upeOf(q) * (Number(q.precio_costo) || 0); }
  });
  g.querySelector('[data-pt]').innerHTML = n ? `${n} producto${n === 1 ? '' : 's'} · ${num(un)} un${canCost() && cost ? `<br>Costo estimado <b>${money(cost)}</b>` : ''}` : 'Nada seleccionado';
  g.querySelector('[data-act=genorder]').disabled = !n;
}
function viewOrder() {
  const lista = porPedir().sort((a, b) => (estado(a) === 'ok') - (estado(b) === 'ok') || a.nombre.localeCompare(b.nombre, 'es'));
  const groups = {}; lista.forEach(p => (groups[p.proveedor_id || ''] ||= []).push(p));
  const urg = lista.filter(p => estado(p) !== 'ok').length;
  const keys = Object.keys(groups).sort((a, b) => (a === '') - (b === '') || (provOf(a)?.nombre || '').localeCompare(provOf(b)?.nombre || '', 'es'));
  let body;
  if (!lista.length) {
    body = '<div class="empty"><div class="ei">✅</div><b>Nada que pedir</b><p class="mut">Todo está sobre el mínimo y cerca de su máximo.</p></div>';
  } else {
    body = `<div class="skpi"><div class="k3"><div><small>Por pedir</small><b>${lista.length}</b></div><div><small>Bajo mínimo</small><b style="color:${urg ? 'var(--bad)' : 'inherit'}">${urg}</b></div><div><small>Proveedores</small><b>${keys.length}</b></div></div>
      <div class="health">${urg ? `<i class="out" style="flex:${urg}"></i>` : ''}${lista.length - urg ? `<i class="ok" style="flex:${lista.length - urg}"></i>` : ''}</div></div>
      <p class="mut" style="font-size:13px;margin:0 2px 12px">Cada cantidad lleva el producto hasta su máximo. Ajústala con − y ＋, o desmarca lo que no quieras pedir.</p>`;
    for (const pid of keys) {
      const pv = provOf(pid), n = groups[pid].length;
      body += `<div class="pcard" data-grp="${pid}"><div class="phead"><span class="pi">🚚</span><b>${pv ? esc(pv.nombre) : 'Sin proveedor asignado'}</b><span class="mut">${n} producto${n === 1 ? '' : 's'}</span></div>
        ${groups[pid].map(poRow).join('')}
        <div class="pfoot"><div class="pt mut" data-pt></div><button class="btn" data-act="genorder" data-pid="${pid}">📷 Generar imagen</button></div></div>`;
    }
    const sinMax = S.prods.filter(p => Number(p.stock_minimo) > 0 && !maxOf(p)).length;
    if (sinMax) body += `<p class="mut" style="font-size:13px;text-align:center">💡 ${sinMax} producto${sinMax === 1 ? ' tiene' : 's tienen'} mínimo pero no máximo. Con el máximo, el pedido se calcula solo.</p>`;
  }
  shell('Pedido a proveedores', body);
  document.querySelectorAll('.po').forEach(updPO);
}

function orderLines(pid) {
  const g = $(`[data-grp="${pid}"]`);
  return [...g.querySelectorAll('[data-pid]')].filter(c => c.checked).map(c => {
    const p = prodOf(c.dataset.pid); const cant = Math.max(1, Math.round(Number($(`[data-qty="${p.id}"]`, g).value) || 1));
    return { p, cant };
  });
}
const loadImg = url => new Promise(r => {
  if (!url) return r(null);
  const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => r(i); i.onerror = () => r(null); i.src = url; setTimeout(() => r(null), 6000);
});
async function drawOrder(prov, lines) {
  const W = 900, RH = 110, HH = 190, FH = 150, H = HH + lines.length * RH + FH, dpr = 1;
  const cv = document.createElement('canvas'); cv.width = W * dpr; cv.height = H * dpr; const x = cv.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#0f766e'; x.fillRect(0, 0, W, HH - 30);
  x.fillStyle = '#fff'; x.font = 'bold 44px sans-serif'; x.fillText('PEDIDO', 40, 70);
  x.font = '28px sans-serif'; x.fillText(negocio(), 40, 112);
  x.font = '22px sans-serif'; x.fillText(new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }), 40, 146);
  x.textAlign = 'right'; x.font = 'bold 28px sans-serif'; x.fillText(prov ? prov.nombre : '', W - 40, 112); x.textAlign = 'left';
  const imgs = await Promise.all(lines.map(l => loadImg(l.p.imagen_url)));
  lines.forEach((l, i) => {
    const y = HH + i * RH, p = l.p, u = Number(p.unidades_por_empaque) || 1;
    x.fillStyle = i % 2 ? '#f4f6f5' : '#fff'; x.fillRect(0, y - 20, W, RH);
    if (imgs[i]) { x.save(); x.beginPath(); x.roundRect(40, y - 8, 84, 84, 12); x.clip(); x.drawImage(imgs[i], 40, y - 8, 84, 84); x.restore(); }
    else { x.fillStyle = '#d7ece9'; x.beginPath(); x.roundRect(40, y - 8, 84, 84, 12); x.fill(); x.font = '40px sans-serif'; x.fillStyle = '#000'; x.fillText(catOf(p.categoria_id)?.emoji || '📦', 58, y + 50); }
    x.fillStyle = '#14201e'; x.font = 'bold 30px sans-serif'; x.fillText(p.nombre.slice(0, 30), 144, y + 22);
    x.fillStyle = '#667571'; x.font = '22px sans-serif';
    x.fillText(`${p.empaque}${u > 1 ? ' x' + num(u) : ''}${p.capacidad ? ' · ' + num(p.capacidad) + ' ' + (p.unidad_capacidad || '') : ''}`, 144, y + 54);
    x.fillText(`Total: ${num(l.cant * u)} un`, 144, y + 82);
    x.textAlign = 'right'; x.fillStyle = '#0f766e'; x.font = 'bold 54px sans-serif'; x.fillText('×' + l.cant, W - 40, y + 50);
    x.font = '20px sans-serif'; x.fillStyle = '#667571'; x.fillText(p.empaque.toLowerCase() + (l.cant > 1 ? 's' : ''), W - 40, y + 80); x.textAlign = 'left';
  });
  const fy = HH + lines.length * RH + 20;
  x.fillStyle = '#14201e'; x.font = 'bold 28px sans-serif'; x.fillText(`${lines.length} producto${lines.length === 1 ? '' : 's'}`, 40, fy + 30);
  // (la imagen se comparte con el proveedor: no lleva stock ni costos nuestros)
  x.fillStyle = '#667571'; x.font = '20px sans-serif'; x.fillText('Gracias. Favor confirmar disponibilidad y plazo de entrega.', 40, fy + 80);
  return cv;
}
async function genOrder(pid) {
  const lines = orderLines(pid); if (!lines.length) return toast('Selecciona al menos un producto');
  const prov = provOf(pid); toast('Generando imagen…');
  const cv = await drawOrder(prov, lines); const url = cv.toDataURL('image/png');
  const txt = `Pedido ${negocio()}:\n` + lines.map(l => `• ${l.cant} ${l.p.empaque.toLowerCase()} de ${l.p.nombre}`).join('\n');
  const s = modal(`<h2>Pedido listo</h2><img class="previmg" src="${url}" alt="Pedido">
    <div class="two" style="margin-top:12px"><button class="btn" id="shr">📤 Compartir</button><button class="btn sec" id="dl">⬇️ Descargar</button></div>
    ${prov?.whatsapp || prov?.telefono ? `<p><a class="btn sec full" style="display:block;text-align:center;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/${(prov.whatsapp || prov.telefono).replace(/\D/g, '')}?text=${encodeURIComponent(txt)}">WhatsApp con el texto</a></p>` : ''}
    <button class="btn sec full" data-act="closemodal">Cerrar</button>`);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const file = new File([blob], `pedido-${Date.now()}.png`, { type: 'image/png' });
  $('#dl', s).onclick = () => { const a = document.createElement('a'); a.href = url; a.download = file.name; a.click(); };
  $('#shr', s).onclick = async () => {
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Pedido', text: txt }); } catch { } }
    else { $('#dl', s).click(); toast('Tu navegador no permite compartir: se descargó la imagen'); }
  };
}

/* ---------- producto: detalle + movimiento ---------- */
async function openProd(id) {
  const p = prodOf(id); if (!p) return;
  const u = Number(p.unidades_por_empaque) || 1, c = catOf(p.categoria_id), pv = provOf(p.proveedor_id);
  const margen = p.precio_costo > 0 ? Math.round((p.precio_venta - p.precio_costo) / p.precio_costo * 100) : null;
  const st = { tipo: 'salida', unit: unidadSalida(p) };
  const s = modal(`<div class="hero" ${thumb(p.imagen_url)}>${p.imagen_url ? '' : (c?.emoji || '📦')}</div>
    <h2>${esc(p.nombre)}</h2><div class="mut">${esc(c?.nombre || 'Sin categoría')}${pv ? ' · ' + esc(pv.nombre) : ''}${p.sku ? ' · ' + esc(p.sku) : ''}</div>
    <div class="kv"><div><small>Stock</small><b>${num(p.stock)} un</b></div><div><small>Mín / Máx</small><b style="font-size:14px">${fmtQ(p, p.stock_minimo)} / ${maxOf(p) ? fmtQ(p, maxOf(p)) : '—'}</b></div><div><small>Estado</small><span class="pill ${estado(p)}">${{ ok: 'OK', low: 'Bajo', out: 'Agotado' }[estado(p)]}</span></div></div>
    <div class="mut" style="font-size:12px">Salida por defecto: ${esc(reglaSalida(p))}</div>
    <div class="mut" style="font-size:14px">${esc(stockTxt(p))}${p.capacidad ? ' · ' + num(p.capacidad) + ' ' + esc(p.unidad_capacidad || '') + ' c/u' : ''}</div>
    ${canCost() ? `<div class="kv"><div><small>Costo</small><b>${money(p.precio_costo)}</b></div><div><small>Venta</small><b>${money(p.precio_venta)}</b></div><div><small>Margen</small><b>${margen === null ? '—' : margen + '%'}</b></div></div>` : ''}
    ${canEdit() ? `<div class="seg"><button class="in" data-t="ingreso">⬆️ Ingreso</button><button data-t="salida" class="on out">⬇️ Salida</button></div>
    ${u > 1 ? `<div class="seg" style="margin-top:0"><button class="${st.unit === 'un' ? 'on in' : ''}" data-u="un" id="u1">Unidades</button><button class="${st.unit === 'emp' ? 'on in' : ''}" data-u="emp" id="u2">${esc(p.empaque)} (x${num(u)})</button></div>` : ''}
    <div class="step"><button id="m">−</button><input id="cant" type="number" inputmode="decimal" min="0" step="any" value="1"><button id="pl">+</button></div>
    <label>Nota (opcional)</label><input id="nota" placeholder="Factura, motivo, destino…">
    <p><button class="btn full bad" id="ok">Registrar salida</button></p>` : ''}
    <div id="hh"></div>
    <div class="two">${canEdit() ? '<button class="btn sec" id="ed">✏️ Editar</button>' : '<span></span>'}<button class="btn sec" data-act="closemodal">Cerrar</button></div>`);
  if (canEdit()) {
    const ci = $('#cant', s), setT = t => { st.tipo = t; st.unit = t === 'ingreso' ? (u > 1 ? 'emp' : 'un') : unidadSalida(p); if (u > 1) { $('#u1', s).className = st.unit === 'un' ? 'on in' : ''; $('#u2', s).className = st.unit === 'emp' ? 'on in' : ''; } s.querySelectorAll('[data-t]').forEach(b => { const on = b.dataset.t === t; b.className = (on ? 'on ' : '') + (b.dataset.t === 'ingreso' ? 'in' : 'out'); }); $('#ok', s).textContent = t === 'ingreso' ? 'Registrar ingreso' : 'Registrar salida'; $('#ok', s).classList.toggle('bad', t === 'salida'); };
    s.querySelectorAll('[data-t]').forEach(b => b.onclick = () => setT(b.dataset.t));
    s.querySelectorAll('[data-u]').forEach(b => b.onclick = () => { st.unit = b.dataset.u; $('#u1').className = st.unit === 'un' ? 'on in' : ''; $('#u2').className = st.unit === 'emp' ? 'on in' : ''; });
    $('#m', s).onclick = () => ci.value = Math.max(0, (Number(ci.value) || 0) - 1);
    $('#pl', s).onclick = () => ci.value = (Number(ci.value) || 0) + 1;
    $('#ok', s).onclick = async e => {
      const q = (Number(ci.value) || 0) * (st.unit === 'emp' ? u : 1);
      if (q <= 0) return toast('Ingresa una cantidad');
      e.target.disabled = true;
      const { error } = await sb.rpc('inv_mover_stock', { p_producto: id, p_tipo: st.tipo, p_cantidad: q, p_nota: $('#nota', s).value });
      e.target.disabled = false;
      if (error) return fail(error);
      toast(`${st.tipo === 'ingreso' ? '＋' : '－'}${num(q)} un registrado`);
      await loadAll(); closeModal(); render();
    };
    $('#ed', s).onclick = () => prodForm(p);
  }
  const { data } = await sb.from('inv_movimientos').select('*').eq('producto_id', id).order('created_at', { ascending: false }).limit(5);
  if (data?.length && $('#hh')) $('#hh').innerHTML = '<div class="sec-h">Últimos movimientos</div>' + data.map(m => `<div class="hist"><span>${new Date(m.created_at).toLocaleDateString('es-CL')} · ${esc(m.nota || m.usuario_email || '')}</span><span class="${m.tipo === 'ingreso' ? 'in-c' : 'out-c'}">${m.tipo === 'ingreso' ? '+' : '−'}${num(m.cantidad)}</span></div>`).join('');
}

/* ---------- formularios ---------- */
const opts = (arr, sel, ph) => `<option value="">${ph}</option>` + arr.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('');
function form(title, html, onSave, onDelete) {
  const s = modal(`<h2>${title}</h2><form id="ff">${html}<p><button class="btn full">Guardar</button></p></form>
    ${onDelete ? '<button class="btn bad full" id="del" type="button">Eliminar</button>' : ''}<p><button class="btn sec full" data-act="closemodal" type="button">Cancelar</button></p>`);
  $('#ff', s).onsubmit = async e => {
    e.preventDefault(); const b = $('#ff button', s); b.disabled = true;
    try { await onSave(new FormData(e.target)); await loadAll(); closeModal(); render(); toast('Guardado ✓'); } catch (er) { fail(er); b.disabled = false; }
  };
  if (onDelete) $('#del', s).onclick = async () => {
    if (!confirm('¿Eliminar? Esta acción no se puede deshacer.')) return;
    try { await onDelete(); await loadAll(); closeModal(); location.hash = '#/'; render(); toast('Eliminado'); } catch (er) { fail(er); }
  };
}
const nz = v => (v === '' || v == null) ? null : v;
const fnum = v => Number(String(v).replace(',', '.')) || 0;

function prodForm(p, catId) {
  const e = !!p; p = p || { empaque: 'Unidad', unidades_por_empaque: 1, categoria_id: catId };
  const emp = ['Unidad', 'Caja', 'Bolsa', 'Paquete', 'Saco', 'Botella', 'Lata', 'Bandeja', 'Pack', 'Bidón'];
  // Mínimo y máximo se muestran en cajas cuando son exactos; se guardan siempre en unidades
  const u0 = Number(p.unidades_por_empaque) || 1, mn0 = Number(p.stock_minimo) || 0, mx0 = Number(p.stock_maximo) || 0;
  const mmu0 = !e || (u0 > 1 && mn0 % u0 === 0 && mx0 % u0 === 0) ? 'emp' : 'un';
  const dv = x => mmu0 === 'emp' ? Math.round(x / u0 * 1000) / 1000 : x;
  form(e ? 'Editar producto' : 'Nuevo producto', `
    <label>Nombre *</label><input name="nombre" required value="${esc(p.nombre)}">
    <div class="two"><div><label>Categoría</label><select name="categoria_id">${opts(S.cats, p.categoria_id, '— ninguna —')}</select></div>
    <div><label>Proveedor</label><select name="proveedor_id">${opts(S.provs, p.proveedor_id, '— ninguno —')}</select></div></div>
    <label>Imagen (toca para elegir o tomar foto)</label><input type="file" name="img" accept="image/*">
    <label>Código / SKU</label><input name="sku" value="${esc(p.sku)}">
    <div class="sec-h">Empaque</div>
    <div class="two"><div><label>Tipo de empaque</label><select name="empaque">${emp.map(x => `<option ${x === p.empaque ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    <div><label>Unidades por empaque</label><input name="upe" inputmode="decimal" value="${p.unidades_por_empaque}"></div></div>
    <label>Salida por defecto <span style="font-weight:400">(requiere "Unidades por empaque" mayor que 1)</span></label><select name="us"><option value="">Según la categoría</option><option value="un" ${p.unidad_salida === 'un' ? 'selected' : ''}>Unidades</option><option value="emp" ${p.unidad_salida === 'emp' ? 'selected' : ''}>Caja / empaque</option></select>
    <div class="two"><div><label>Capacidad c/u</label><input name="capacidad" inputmode="decimal" value="${p.capacidad ?? ''}" placeholder="ej. 500"></div>
    <div><label>Medida</label><select name="uc">${['', 'g', 'kg', 'ml', 'L', 'cm', 'm', 'un'].map(x => `<option ${x === (p.unidad_capacidad || '') ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
    <div class="sec-h">Stock${e ? '' : ' inicial'}, mínimo y máximo</div>
    <label style="margin-top:0">Escribir estas cantidades en</label>
    <select name="mmu"><option value="emp" ${mmu0 === 'emp' ? 'selected' : ''}>Cajas / empaque</option><option value="un" ${mmu0 === 'un' ? 'selected' : ''}>Unidades</option></select>
    <div class="two">${e ? '' : '<div><label>Stock inicial</label><input name="stock0" inputmode="decimal" value="0"></div>'}
    <div><label>Mínimo (alerta)</label><input name="min" inputmode="decimal" value="${dv(mn0)}"></div>
    <div><label>Máximo (hasta dónde pedir)</label><input name="max" inputmode="decimal" value="${dv(mx0)}"></div></div>
    <p class="mut" style="font-size:13px;margin:4px 0 0">Ej. mínimo 1 y máximo 8 cajas: con 4 cajas en bodega, el Pedido sugiere 4 para llegar a 8.${e ? ' Para corregir el stock actual usa Más → Inventario inicial.' : ''}</p>
    ${canCost() ? `<div class="sec-h">Precios (por unidad)</div>
    <div class="two"><div><label>Precio costo</label><input name="costo" inputmode="decimal" value="${p.precio_costo ?? 0}"></div>
    <div><label>Precio venta</label><input name="venta" inputmode="decimal" value="${p.precio_venta ?? 0}"></div></div>` : ''}`,
    async f => {
      if (f.get('us') === 'emp' && fnum(f.get('upe')) <= 1) throw new Error('Para que salga por caja, "Unidades por empaque" debe ser mayor que 1 (ej. 12 si la caja trae 12 botellas).');
      const upe = Math.max(fnum(f.get('upe')), 0.0001) || 1, fac = f.get('mmu') === 'emp' ? upe : 1, mn = fnum(f.get('min')) * fac, mx = fnum(f.get('max')) * fac;
      if (mx > 0 && mx < mn) throw new Error('El máximo debe ser mayor o igual al mínimo.');
      const row = { empresa_id: S.emp.id, nombre: f.get('nombre').trim(), categoria_id: nz(f.get('categoria_id')), proveedor_id: nz(f.get('proveedor_id')), sku: nz(f.get('sku')?.trim()), empaque: f.get('empaque'),
        unidades_por_empaque: upe, capacidad: nz(f.get('capacidad')) === null ? null : fnum(f.get('capacidad')), unidad_capacidad: nz(f.get('uc')), unidad_salida: nz(f.get('us')),
        stock_minimo: mn, stock_maximo: mx, ...(canCost() ? { precio_costo: fnum(f.get('costo')), precio_venta: fnum(f.get('venta')) } : {}) };
      const file = f.get('img'); if (file?.size) row.imagen_url = await uploadImage(file, 'productos');
      if (e) { const { error } = await sb.from('inv_productos').update(row).eq('id', p.id); if (error) throw error; }
      else {
        const { data, error } = await sb.from('inv_productos').insert(row).select().single(); if (error) throw error;
        const s0 = fnum(f.get('stock0')) * fac; if (s0 > 0) { const r = await sb.rpc('inv_mover_stock', { p_producto: data.id, p_tipo: 'ingreso', p_cantidad: s0, p_nota: 'Stock inicial' }); if (r.error) throw r.error; }
      }
    }, e && isAdmin() ? async () => { const { error } = await sb.from('inv_productos').delete().eq('id', p.id); if (error) throw error; } : null);
}

function catForm(c) {
  const e = !!c; c = c || { emoji: '📦' };
  form(e ? 'Editar categoría' : 'Nueva categoría', `<label>Nombre *</label><input name="nombre" required value="${esc(c.nombre)}">
    <label>Emoji (si no hay imagen)</label><input name="emoji" value="${esc(c.emoji)}" maxlength="4">
    <label>Salida por defecto de sus productos con empaque</label><select name="us"><option value="un" ${c.unidad_salida !== 'emp' ? 'selected' : ''}>Unidades</option><option value="emp" ${c.unidad_salida === 'emp' ? 'selected' : ''}>Caja / empaque</option></select>
    <p class="mut" style="font-size:13px;margin:4px 0 0">Ej. en Vinos elige "Caja". Un producto puede tener su propia regla al editarlo. Siempre se puede cambiar al registrar.</p>
    <label>Imagen</label><input type="file" name="img" accept="image/*">`,
    async f => {
      const row = { empresa_id: S.emp.id, nombre: f.get('nombre').trim(), emoji: f.get('emoji') || '📦', unidad_salida: f.get('us') === 'emp' ? 'emp' : 'un' };
      const file = f.get('img'); if (file?.size) row.imagen_url = await uploadImage(file, 'categorias');
      const { error } = e ? await sb.from('inv_categorias').update(row).eq('id', c.id) : await sb.from('inv_categorias').insert(row); if (error) throw error;
    }, e ? async () => { const { error } = await sb.from('inv_categorias').delete().eq('id', c.id); if (error) throw error; } : null);
}

function provForm(p) {
  const e = !!p; p = p || {};
  form(e ? 'Editar proveedor' : 'Nuevo proveedor', `<label>Nombre *</label><input name="nombre" required value="${esc(p.nombre)}">
    <label>Persona de contacto</label><input name="contacto" value="${esc(p.contacto)}">
    <div class="two"><div><label>Teléfono</label><input name="telefono" type="tel" value="${esc(p.telefono)}"></div><div><label>WhatsApp</label><input name="whatsapp" type="tel" value="${esc(p.whatsapp)}" placeholder="con código de país"></div></div>
    <label>Correo</label><input name="email" type="email" value="${esc(p.email)}">
    <label>Notas</label><textarea name="notas" rows="2">${esc(p.notas)}</textarea>`,
    async f => {
      const row = { empresa_id: S.emp.id, ...Object.fromEntries(['nombre', 'contacto', 'telefono', 'whatsapp', 'email', 'notas'].map(k => [k, nz(f.get(k)?.trim())])) };
      const { error } = e ? await sb.from('inv_proveedores').update(row).eq('id', p.id) : await sb.from('inv_proveedores').insert(row); if (error) throw error;
    }, e && isAdmin() ? async () => { const { error } = await sb.from('inv_proveedores').delete().eq('id', p.id); if (error) throw error; } : null);
}

/* ---------- acciones y router ---------- */
const actions = {
  logout: () => sb.auth.signOut(),
  closemodal: closeModal,
  prod: d => canEdit() ? quickMove(d.id) : openProd(d.id),
  tap: d => tapProd(d.id), dec: d => decProd(d.id),
  sfil: d => { K.f = d.f; viewStock(); },
  stoggle: () => { const any = [...document.querySelectorAll('#stklist details')].some(x => x.open); K.closed = new Set(any ? grupos().map(g => g[0]) : []); K.f = 'all'; K.q = ''; viewStock(); },
  sexport: () => modal(`<h2>Exportar stock</h2><p class="mut" style="margin-top:0">Se exporta lo que ves ahora (filtros y búsqueda incluidos).</p>
    <button class="btn full" data-act="sshare">📤 Compartir como texto</button><p><button class="btn sec full" data-act="scsv">📊 Descargar para Excel (CSV)</button></p>
    <p><button class="btn sec full" data-act="sprint">🖨️ Imprimir / guardar PDF</button></p><button class="btn sec full" data-act="closemodal">Cerrar</button>`),
  cmodo: d => { C.modo = d.m; C.manual = true; viewConteo(); }, // manual: respeta lo que eliges y no lo reemplaza por el modo automatico
  csave: (d, el) => guardarConteo(el),
  sshare: () => { closeModal(); shareStock(); },
  scsv: () => { closeModal(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([stockCSV()], { type: 'text/csv;charset=utf-8' })); a.download = `stock-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); },
  sprint: () => { closeModal(); document.querySelectorAll('#stklist details').forEach(x => x.open = true); window.print(); },
  mcat: d => { M.cat = d.c; viewMove(); },
  gostock: d => { K.f = d.f; K.q = ''; location.hash = '#/stock'; },
  review: () => review(),
  pstep: d => { const i = document.querySelector(`[data-qty="${d.id}"]`); i.value = Math.max(1, (Number(i.value) || 0) + Number(d.d)); updPO(i.closest('.po')); },
  mclear: () => { if (confirm('¿Vaciar la lista de productos?')) { M.lines = []; paintGrid(); paintBar(); } },
  newcat: () => catForm(), editcat: d => catForm(catOf(d.id)),
  newprod: d => prodForm(null, d.cat), newprov: () => provForm(), editprov: d => provForm(provOf(d.id)),
  genorder: d => genOrder(d.pid),
  resetstock: () => {
    const s = modal(`<h2>🧹 Cantidades en 0</h2><p>Se pondrá en <b>0</b> el stock de los <b>${S.prods.length}</b> productos de <b>${esc(negocio())}</b>. Esto no se puede deshacer.</p>
      <label style="display:flex;gap:10px;align-items:center;color:var(--tx);font-size:15px"><input type="checkbox" id="rhist" checked style="width:22px;height:22px"> También borrar el historial de movimientos</label>
      <p class="mut" style="font-size:13px">Productos, categorías, proveedores y reglas de salida no se tocan. Solo afecta a este dispositivo mientras uses el modo local.</p>
      <button class="btn bad full" id="rgo">Sí, dejar todo en 0</button><p><button class="btn sec full" data-act="closemodal">Cancelar</button></p>`);
    $('#rgo', s).onclick = async e => {
      e.target.disabled = true;
      const { error } = await sb.rpc('inv_reiniciar_stock', { p_empresa: S.emp.id, p_borrar_historial: $('#rhist', s).checked });
      if (error) { e.target.disabled = false; return fail(error); }
      await loadAll(); closeModal(); render(); toast('✓ Cantidades en 0. Listo para probar de cero');
    };
  },
  diag: d => {
    const p = prodOf(d.id), c = catOf(p.categoria_id), t = v => v === undefined ? 'undefined' : `${JSON.stringify(v)} (${typeof v})`;
    modal(`<h2>Diagnóstico</h2><pre style="white-space:pre-wrap;word-break:break-word;font-size:13px;background:var(--bg);padding:10px;border-radius:10px">` + esc([
      `Versión: ${VERSION}${LOCAL ? ' (local)' : ''}`, `Producto: ${p.nombre}`, `unidades_por_empaque: ${t(p.unidades_por_empaque)}`, `empaque: ${t(p.empaque)}`,
      `unidad_salida (producto): ${t(p.unidad_salida)}`, `Categoría: ${c ? c.nombre : '(ninguna)'}`, `unidad_salida (categoría): ${t(c?.unidad_salida)}`,
      `Resultado unidadSalida(): ${t(unidadSalida(p))}`, `Regla: ${reglaSalida(p)}`].join('\n')) + `</pre><button class="btn sec full" data-act="closemodal">Cerrar</button>`);
  },
  setemp: d => { if (d.id !== S.emp.id) elegirEmpresa(d.id).catch(fail); },
  newemp: () => empresaForm(),
  rmmember: async d => {
    if (!confirm(`¿Quitar a ${d.email} de ${negocio()}?`)) return;
    const r = await sb.from('inv_miembros').delete().eq('empresa_id', S.emp.id).eq('user_id', d.uid);
    r.error ? fail(r.error) : (toast('Usuario quitado'), viewUsers());
  },
  mode: d => { if (M.modo !== d.m) { M.modo = d.m; M.lines = []; } viewMove(); },
  rmline: d => { M.lines.splice(+d.i, 1); M.lines.length ? paintLines() : closeModal(); },
  submitmove: (d, el) => submitMove(el)
};
document.addEventListener('input', e => {
  if (e.target.dataset.qty !== undefined) { updPO(e.target.closest('.po')); return; } // pedido a proveedor
  const cf = e.target.dataset.cf; // inventario inicial: cajas / sueltas
  if (cf) { const id = e.target.closest('[data-cid]').dataset.cid; (C.v[id] ||= { c: '', s: '' })[cf] = e.target.value; paintDeltas(); return; }
  const f = e.target.dataset.f, row = e.target.closest('[data-i]'); if (!f || !row) return;
  const l = M.lines[+row.dataset.i]; if (!l) return;
  if (f === 'qty' || f === 'costo') { l[f] = Number(e.target.value) || 0; paintFoot(); const w = row.querySelector('[data-warn]'); if (w) w.innerHTML = warnTxt(l); }
});
document.addEventListener('change', e => {
  if (e.target.dataset.f !== 'unit') return;
  const l = M.lines[+e.target.closest('[data-i]').dataset.i], p = prodOf(l.id), u = upeOf(p), nu = e.target.value;
  if (nu !== l.unit) { l.costo = Math.round(l.costo * (nu === 'emp' ? u : 1 / u) * 100) / 100; l.unit = nu; }
  paintLines();
});
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) { location.hash = g.dataset.go; return; }
  const a = e.target.closest('[data-act]'); if (a && actions[a.dataset.act]) actions[a.dataset.act](a.dataset, a);
});
document.addEventListener('change', async e => {
  if (e.target.dataset.pid !== undefined) { updPO(e.target.closest('.po')); return; } // incluir/excluir del pedido
  if (e.target.dataset.vc !== undefined) {
    const r = await sb.from('inv_empresas').update({ ver_costos: e.target.value }).eq('id', S.emp.id);
    if (r.error) return fail(r.error);
    await loadAll(); return toast('Privacidad actualizada ✓');
  }
  const id = e.target.dataset.role; if (!id) return;
  const { error } = await sb.from('inv_miembros').update({ rol: e.target.value }).eq('empresa_id', S.emp.id).eq('user_id', id);
  error ? fail(error) : toast('Rol actualizado');
});

function render() {
  if (!S.perfil) return;
  if (!S.emp) return viewOnboard();
  const h = location.hash || '#/';
  if (h.startsWith('#/cat/')) return viewCat(h.slice(6));
  ({ '#/conteo': viewConteo, '#/ajustes': viewAjustes, '#/stock': viewStock, '#/mas': viewMas, '#/mover': viewMove, '#/pedido': viewOrder, '#/proveedores': viewProv, '#/historial': viewHist, '#/usuarios': viewUsers }[h] || viewHome)();
}
window.addEventListener('hashchange', () => {
  closeModal(); S.q = '';
  if (location.hash === '#/mover' && !M.lines.length) M.modo = 'salida'; // al entrar a Mover siempre parte en Salida (si hay una compra a medias, se respeta)
  render();
});

let booting = false;
async function boot(session) {
  if (booting) return; booting = true;
  try {
    if (!session) { S.user = S.perfil = S.emp = null; return loginView(); }
    if (S.perfil && S.user?.id === session.user.id) return; // refresco de token: no re-render
    S.user = session.user; await loadAll();
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', location.pathname + location.search); // siempre empieza en Categorias
    render();
  } catch (e) { fail(e); app.innerHTML = `<div class="login"><h1>⚠️</h1><p class="center">No se pudo cargar. ¿Ejecutaste schema.sql y configuraste config.js?</p><p class="center mut">${esc(e.message)}</p><button class="btn full" onclick="location.reload()">Reintentar</button></div>`; }
  finally { booting = false; }
}
sb.auth.onAuthStateChange((ev, session) => { if (ev === 'INITIAL_SESSION' || ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') setTimeout(() => boot(session), 0); });
