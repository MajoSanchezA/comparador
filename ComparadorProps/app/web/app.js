(() => {
const el = id => document.getElementById(id);
const api = async (r, o) => {
  let res;
  try {
    res = await fetch(r, o);
  } catch {
    throw new Error('Sin conexión con el servidor. Comprueba que la ventana negra siga abierta y que la dirección del navegador sea http://localhost:8777');
  }
  const d = await res.json();
  if (d && d.error) throw new Error(d.error);
  return d;
};

const estado = {
  modo:'wipe', escala:1, x:0, y:0, cortina:.5,
  anotando:false, herramienta:'mano', notas:[], lado:'B', verAmbas:false,
  seleccion:null, versiones:[], A:null, B:null, arbol:{}, archivoNuevo:null
};

/* ======================= AVISOS ======================= */
function avisar(texto, tipo){
  const d = document.createElement('div');
  d.className = 'aviso ' + (tipo || '');
  d.textContent = texto;
  el('avisos').appendChild(d);
  setTimeout(() => d.remove(), 6000);
  d.onclick = () => d.remove();
}

function confirmar(texto){
  return new Promise(resolver => {
    el('confTexto').textContent = texto;
    const dc = el('dlgConfirmar');
    const cerrar = valor => { dc.close(); resolver(valor); };
    el('confSi').onclick = () => cerrar(true);
    el('confNo').onclick = () => cerrar(false);
    dc.oncancel = () => resolver(false);
    dc.showModal();
  });
}

/* ======================= BIBLIOTECA ======================= */
async function cargarArbol(){
  const cont = el('panelBiblio');
  try {
    estado.arbol = await api('/api/arbol');
  } catch (e) {
    cont.innerHTML = '<div class="vacio"><b style="color:#ffcf5c">Sin conexión con el servidor</b><br><br>' +
      'La dirección del navegador tiene que ser <b>http://localhost:8777</b>, no la ruta del archivo.<br><br>' +
      'Si es así, revisa que la ventana negra del servidor siga abierta.</div>';
    return;
  }
  cont.textContent = '';
  const proyectos = Object.keys(estado.arbol);
  const filtro = el('filtroTipo').value;
  const filtroEstado = el('filtroEstado').value;
  const texto = el('buscar').value.trim().toLocaleLowerCase();
  const coincide = (p, proyecto, episodio, shot) => {
    const estadoRevision = p.estado || 'sin_revisar';
    const datos = [p.prop, proyecto, episodio, shot, p.tipo || ''].join(' ').toLocaleLowerCase();
    return (!filtro || (p.tipo || '') === filtro) &&
      (!filtroEstado || estadoRevision === filtroEstado) &&
      (!texto || datos.includes(texto));
  };
  let encontrados = 0;

  if (!proyectos.length){
    cont.innerHTML = '<div class="vacio">Todavía no hay nada guardado.<br>Sube la primera versión de un prop y aparecerá aquí.</div>';
  }
  for (const proyecto of proyectos){
    const episodios = estado.arbol[proyecto];
    const d1 = document.createElement('details'); d1.className='n1'; d1.open = true;
    d1.appendChild(titulo(proyecto, {proyecto}, contar(episodios)));
    let hayEnProyecto = false;
    for (const episodio of Object.keys(episodios)){
      const shots = episodios[episodio];
      const d2 = document.createElement('details'); d2.className='n2'; d2.open = true;
      d2.appendChild(titulo(episodio, {proyecto, episodio}, contar(shots)));
      let hayEnEpisodio = false;
      for (const shot of Object.keys(shots)){
        const props = shots[shot];
        const visibles = props.filter(p => coincide(p, proyecto, episodio, shot));
        if (!visibles.length) continue;
        const d3 = document.createElement('details'); d3.className='n3'; d3.open = true;
        d3.appendChild(titulo(shot, {proyecto, episodio, shot}, visibles.reduce((n, p) => n + p.total, 0)));
        for (const p of visibles){
          const fila = document.createElement('div');
          fila.className = 'prop'; fila.tabIndex = 0;
          const nombre = document.createElement('span'); nombre.textContent = p.prop;
          const cuenta = document.createElement('span'); cuenta.className = 'cuenta'; cuenta.textContent = 'v' + p.total;
          fila.append(nombre);
          if (p.estado === 'aprobado' || p.estado === 'cambios'){
            const marca = document.createElement('span');
            marca.className = 'marca';
            marca.textContent = p.estado === 'aprobado' ? '🦁' : '✎';
            marca.title = p.estado === 'aprobado' ? 'Última versión aprobada' : 'Última versión con cambios pedidos';
            fila.append(marca);
          }
          if (p.tipo){
            const insignia = document.createElement('span');
            insignia.className = 'tipo'; insignia.textContent = p.tipo.slice(0, 4);
            insignia.title = p.tipo;
            fila.append(insignia);
          }
          fila.append(cuenta, botonBorrar(p.prop, {proyecto, episodio, shot, prop:p.prop}, p.total));
          const abrir = () => seleccionar(proyecto, episodio, shot, p.prop);
          fila.onclick = abrir;
          fila.onkeydown = e => { if(e.key==='Enter'){ e.preventDefault(); abrir(); } };
          d3.appendChild(fila);
          encontrados++;
        }
        d2.appendChild(d3);
        hayEnEpisodio = true;
      }
      if (hayEnEpisodio){
        d1.appendChild(d2);
        hayEnProyecto = true;
      }
    }
    if (hayEnProyecto) cont.appendChild(d1);
  }
  if (proyectos.length && !encontrados) cont.innerHTML = '<div class="vacio">No hay assets que coincidan con estos filtros.</div>';
  rellenarSugerencias();
  marcarSeleccion();
}

/* cuenta cuántas versiones cuelgan de una rama del árbol */
function contar(rama){
  if (Array.isArray(rama)) return rama.reduce((n, p) => n + p.total, 0);
  return Object.values(rama).reduce((n, sub) => n + contar(sub), 0);
}

function titulo(texto, datos, cantidad){
  const s = document.createElement('summary');
  const t = document.createElement('span'); t.textContent = texto;
  s.append(t, botonBorrar(texto, datos, cantidad));
  return s;
}

function botonBorrar(nombre, datos, cantidad){
  const b = document.createElement('span');
  b.className = 'x'; b.textContent = '×'; b.title = 'Eliminar';
  b.tabIndex = 0;
  b.onclick = async e => {
    e.preventDefault(); e.stopPropagation();
    const plural = cantidad === 1 ? '1 versión' : cantidad + ' versiones';
    if (!await confirmar(`Se van a quitar ${plural} de "${nombre}".`)) return;
    try {
      const r = await api('/api/borrar', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(datos)
      });
      const afectaLoAbierto = estado.seleccion &&
        Object.keys(datos).every(k => estado.seleccion[k] === datos[k]);
      if (afectaLoAbierto) limpiarVisor();
      await cargarArbol();
      if (!el('panelAvance').hidden) cargarAvance();
      avisar(`"${nombre}" eliminado — ${r.eliminadas === 1 ? '1 archivo está' : r.eliminadas + ' archivos están'} en la papelera`, 'bien');
    } catch (err) {
      avisar('No se pudo eliminar: ' + err.message, 'mal');
    }
  };
  b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.onclick(e); } };
  return b;
}

function limpiarVisor(){
  estado.seleccion = null; estado.versiones = []; estado.A = null; estado.B = null;
  el('selA').innerHTML = ''; el('selB').innerHTML = '';
  imgA.removeAttribute('src'); imgB.removeAttribute('src');
  el('ruta').textContent = 'Ningún prop seleccionado';
  el('nota').textContent = ''; el('alerta').textContent = '';
  el('aviso').hidden = false;
  pintar();
}

function rellenarSugerencias(){
  const juegos = {lProyecto:new Set(), lEpisodio:new Set(), lShot:new Set(), lProp:new Set()};
  for (const p in estado.arbol){
    juegos.lProyecto.add(p);
    for (const e in estado.arbol[p]){
      juegos.lEpisodio.add(e);
      for (const s in estado.arbol[p][e]){
        juegos.lShot.add(s);
        estado.arbol[p][e][s].forEach(x => juegos.lProp.add(x.prop));
      }
    }
  }
  for (const id in juegos){
    el(id).innerHTML = [...juegos[id]].map(v => `<option value="${escapar(v)}">`).join('');
  }
}

async function cargarAvance(){
  const cont = el('panelAvance');
  let datos;
  try {
    datos = await api('/api/avance?dias=7');
  } catch (e) {
    cont.innerHTML = '<div class="vacio">Sin conexión con el servidor.</div>';
    return;
  }
  cont.textContent = '';
  if (!datos.length){
    cont.innerHTML = '<div class="vacio">Ningún prop cambió en los últimos 7 días.</div>';
    return;
  }

  const porProyecto = {};
  for (const d of datos) (porProyecto[d.proyecto] = porProyecto[d.proyecto] || []).push(d);

  for (const proyecto of Object.keys(porProyecto)){
    const titulo = document.createElement('div');
    titulo.className = 'grupoTit';
    titulo.textContent = proyecto;
    cont.appendChild(titulo);

    for (const d of porProyecto[proyecto]){
      const t = document.createElement('div');
      t.className = 'tarjeta';
      const par = d.previa ? `v${d.previa.numero} → v${d.nueva.numero}` : `v${d.nueva.numero} (primera)`;
      const nombre = document.createElement('div');
      nombre.className = 't'; nombre.textContent = d.prop;
      const detalle = document.createElement('div');
      detalle.className = 's';
      detalle.textContent = `${d.episodio} › ${d.shot} · ${par} · ${d.fecha.slice(5,10)}`;
      t.append(nombre, detalle);
      t.onclick = async () => {
        await seleccionar(d.proyecto, d.episodio, d.shot, d.prop);
        if (d.previa) el('selA').value = d.previa.id;
        el('selB').value = d.nueva.id;
        mostrarPar();
      };
      cont.appendChild(t);
    }
  }
}

async function cargarActividad(){
  const cont = el('panelActividad');
  if (!estado.seleccion){
    cont.innerHTML = '<div class="vacio">Elige un asset en la biblioteca para ver su historial.</div>';
    return;
  }
  cont.innerHTML = '<div class="vacio">Cargando historial…</div>';
  try {
    const datos = await api('/api/actividad?' + new URLSearchParams(estado.seleccion));
    if (!datos.length){
      cont.innerHTML = '<div class="vacio">Aún no hay actividad registrada para este asset.</div>';
      return;
    }
    cont.textContent = '';
    for (const item of datos){
      const tarjeta = document.createElement('div'); tarjeta.className = 'actividad';
      const accion = document.createElement('div'); accion.className = 'accion'; accion.textContent = item.accion;
      const meta = document.createElement('div'); meta.className = 'meta';
      meta.textContent = [item.autor || 'Sin autor', item.fecha.replace('T', ' · ')].join(' · ');
      tarjeta.append(accion, meta);
      if (item.detalle){
        const detalle = document.createElement('div'); detalle.className = 'detalle'; detalle.textContent = item.detalle;
        tarjeta.appendChild(detalle);
      }
      cont.appendChild(tarjeta);
    }
  } catch (e) {
    cont.innerHTML = '<div class="vacio">No se pudo cargar el historial: ' + escapar(e.message) + '</div>';
  }
}

async function seleccionar(proyecto, episodio, shot, prop){
  trazoEnCurso = null;
  estado.seleccion = {proyecto, episodio, shot, prop};
  const q = new URLSearchParams(estado.seleccion).toString();
  estado.versiones = await api('/api/versiones?' + q);
  el('ruta').innerHTML = `${escapar(proyecto)} › ${escapar(episodio)} › ${escapar(shot)} › <b>${escapar(prop)}</b>`;

  const opciones = estado.versiones.map(v =>
    `<option value="${v.id}">v${v.numero} · ${v.fecha.slice(0,10)} · ${v.ancho}×${v.alto}${v.autor ? ' · '+escapar(v.autor) : ''}</option>`
  ).join('');
  el('selA').innerHTML = opciones;
  el('selB').innerHTML = opciones;

  const n = estado.versiones.length;
  el('selA').value = estado.versiones[Math.max(0, n-2)].id;
  el('selB').value = estado.versiones[n-1].id;
  marcarSeleccion();
  mostrarPar();
  if (!el('panelActividad').hidden) cargarActividad();
}

function marcarSeleccion(){
  document.querySelectorAll('.prop').forEach(f => {
    const nombre = f.firstChild.textContent;
    f.classList.toggle('on', !!estado.seleccion && nombre === estado.seleccion.prop);
  });
}

function escapar(t){ const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

/* ======================= VISOR ======================= */
const viewport = el('viewport'), paneA = el('paneA'), paneB = el('paneB');
const imgA = el('imgA'), imgB = el('imgB'), handle = el('handle');

function mostrarPar(){
  const a = estado.versiones.find(v => v.id == el('selA').value);
  const b = estado.versiones.find(v => v.id == el('selB').value);
  if (!a || !b) return;
  estado.A = a; estado.B = b;
  el('aviso').hidden = true;
  el('nota').textContent = b.nota ? '“' + b.nota + '”' : '';
  el('alerta').textContent = (a.ancho !== b.ancho || a.alto !== b.alto)
    ? 'Resoluciones distintas — B se escaló para alinear' : '';

  let faltan = 2;
  const listo = () => { if (--faltan === 0) ajustar(); };
  imgA.onload = listo; imgB.onload = listo;
  imgA.src = '/archivo/' + a.id;
  imgB.src = '/archivo/' + b.id;
  cargarNotas();
  pintarSello();
}

function escalaB(){
  if (!estado.A || !estado.B) return 1;
  return estado.A.ancho && estado.B.ancho ? estado.A.ancho / estado.B.ancho : 1;
}

function pintar(){
  const vw = viewport.clientWidth, vh = viewport.clientHeight;
  const s = estado.escala, sb = s * escalaB();
  const medio = estado.modo === 'split' ? vw/2 : 0;
  const a = estado.A, b = estado.B;
  const aw = a ? a.ancho : 0, ah = a ? a.alto : 0, bw = b ? b.ancho : 0, bh = b ? b.alto : 0;

  imgA.style.transform = `translate(${estado.x - aw*s/2}px, ${estado.y - ah*s/2}px) scale(${s})`;
  imgB.style.transform = `translate(${estado.x + medio - bw*sb/2}px, ${estado.y - bh*sb/2}px) scale(${sb})`;
  paneB.style.opacity = estado.modo === 'onion' ? el('opacidad').value/100 : 1;

  const esA = estado.lado === 'A';
  capas.A.style.transform = imgA.style.transform;
  capas.B.style.transform = imgB.style.transform;
  capas.A.style.display = (estado.anotando && (estado.verAmbas || esA)) ? 'block' : 'none';
  capas.B.style.display = (estado.anotando && (estado.verAmbas || !esA)) ? 'block' : 'none';
  if (estado.anotando){
    const ambas = estado.verAmbas;
    paneA.style.opacity = (ambas || esA) ? 1 : 0;
    paneB.style.opacity = (ambas || !esA) ? 1 : 0;
    paneA.style.clipPath = 'none'; paneB.style.clipPath = 'none';
    handle.classList.remove('on');
    el('zoom').textContent = Math.round(estado.escala*100) + '%';
    return;
  }
  paneA.style.opacity = 1;

  if (estado.modo === 'wipe'){
    const px = estado.cortina * vw;
    paneA.style.clipPath = 'none';
    paneB.style.clipPath = `inset(0 0 0 ${px}px)`;
    handle.style.left = px + 'px';
    handle.classList.toggle('on', !!(estado.A && estado.B));
  } else if (estado.modo === 'split'){
    paneA.style.clipPath = `inset(0 ${vw/2}px 0 0)`;
    paneB.style.clipPath = `inset(0 0 0 ${vw/2}px)`;
    handle.classList.remove('on');
  } else {
    paneA.style.clipPath = 'none'; paneB.style.clipPath = 'none';
    handle.classList.remove('on');
  }
  el('zoom').textContent = estado.A ? Math.round(s*100) + '%' : '—';
  document.body.classList.toggle('crisp', s >= 1);
}

function ajustar(){
  const a = estado.A, b = estado.B;
  if (!a || !b){ pintar(); return; }
  const sb = escalaB();
  const w = Math.max(a.ancho, b.ancho * sb), h = Math.max(a.alto, b.alto * sb);
  const vw = viewport.clientWidth, vh = viewport.clientHeight;
  const disp = estado.modo === 'split' ? vw/2 : vw;
  estado.escala = Math.min(disp/w, vh/h) * 0.92;
  estado.x = disp/2; estado.y = vh/2;
  pintar();
}

/* En "lado a lado" cada imagen ocupa media pantalla, pero las dos comparten
   la misma posición: B se dibuja con medio ancho de desplazamiento. Por eso el
   ancla del zoom siempre tiene que estar referida al panel izquierdo; si no,
   las imágenes se abren hacia fuera. */
function anclaX(cx){
  const vw = viewport.clientWidth;
  if (estado.modo !== 'split') return cx;
  return cx > vw/2 ? cx - vw/2 : cx;
}

function centroVisor(){
  return estado.modo === 'split' ? viewport.clientWidth/4 : viewport.clientWidth/2;
}

function zoomEn(cx, cy, factor){
  const sig = Math.min(16, Math.max(.02, estado.escala * factor));
  const k = sig / estado.escala;
  estado.x = cx - (cx - estado.x)*k;
  estado.y = cy - (cy - estado.y)*k;
  estado.escala = sig;
  pintar();
}

viewport.addEventListener('wheel', e => {
  e.preventDefault();
  const r = viewport.getBoundingClientRect();
  zoomEn(anclaX(e.clientX - r.left), e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1/1.12);
}, {passive:false});

let arrastre = null;
viewport.addEventListener('pointerdown', e => {
  const r = viewport.getBoundingClientRect();

  // modo revisión: señalar o dibujar sobre la imagen
  if (estado.anotando && estado.herramienta !== 'mano'){
    const lado = ladoBajoCursor(e);
    const v = lado === 'A' ? estado.A : estado.B;
    if (!v) return;
    const p = aImagen(e, lado);
    if (!dentro(p)) return;
    viewport.setPointerCapture(e.pointerId);
    if (estado.herramienta === 'pin'){
      arrastre = {tipo:'nada'};
      crearNota('pin', {x:p.x, y:p.y}, '', lado);
    } else {
      arrastre = {tipo:'trazo', lado};
      trazoEnCurso = {lado, puntos: [[p.x, p.y]]};
    }
    return;
  }

  const enCortina = estado.modo === 'wipe' && Math.abs(e.clientX - r.left - estado.cortina*r.width) < 22;
  arrastre = {tipo: enCortina ? 'cortina' : 'pan', px:e.clientX, py:e.clientY};
  viewport.setPointerCapture(e.pointerId);
  if (!enCortina) viewport.classList.add('panning');
});
viewport.addEventListener('pointermove', e => {
  if (!arrastre) return;
  const r = viewport.getBoundingClientRect();
  if (arrastre.tipo === 'trazo'){
    const p = aImagen(e, arrastre.lado);
    trazoEnCurso.puntos.push([Math.min(1, Math.max(0, p.x)), Math.min(1, Math.max(0, p.y))]);
    pintarNotas();
    return;
  }
  if (arrastre.tipo === 'nada') return;
  if (arrastre.tipo === 'cortina'){
    estado.cortina = Math.min(1, Math.max(0, (e.clientX - r.left)/r.width));
  } else {
    estado.x += e.clientX - arrastre.px; estado.y += e.clientY - arrastre.py;
    arrastre.px = e.clientX; arrastre.py = e.clientY;
  }
  pintar();
});
const soltar = async () => {
  if (arrastre && arrastre.tipo === 'trazo' && trazoEnCurso){
    const { puntos, lado } = trazoEnCurso;
    trazoEnCurso = null;
    arrastre = null;
    if (puntos.length > 2) await crearNota('trazo', {puntos}, '', lado);
    else pintarNotas();
    return;
  }
  arrastre = null; viewport.classList.remove('panning');
};
viewport.addEventListener('pointerup', soltar);
viewport.addEventListener('pointercancel', soltar);

document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => ponerModo(b.dataset.mode));
function ponerModo(m){
  estado.modo = m;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  el('ctlOnion').hidden = m !== 'onion';
  ajustar();
}

el('opacidad').oninput = pintar;
el('selA').onchange = mostrarPar;
el('selB').onchange = mostrarPar;
el('mas').onclick = () => zoomEn(centroVisor(), viewport.clientHeight/2, 1.25);
el('menos').onclick = () => zoomEn(centroVisor(), viewport.clientHeight/2, .8);
el('ajustar').onclick = ajustar;
el('cien').onclick = () => zoomEn(centroVisor(), viewport.clientHeight/2, 1/estado.escala);
window.addEventListener('resize', pintar);

document.addEventListener('keydown', e => {
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) || el('dlg').open) return;
  const mapa = {'1':'wipe','2':'split','3':'onion'};
  if (mapa[e.key]) ponerModo(mapa[e.key]);
  if (e.key.toLowerCase() === 'f') ajustar();
  if (e.key === '0') el('cien').click();
});



/* ======================= APROBACIÓN ======================= */
/* En el estudio el jefe pone su león cuando algo queda aprobado.
   Aquí queda registrado contra la versión, con nombre y fecha. */
function pintarSello(){
  const b = estado.B;
  const boton = el('sello');
  boton.classList.remove('aprobado', 'cambios');
  if (!b) { el('selloTexto').textContent = 'Sin revisar'; return; }
  if (b.estado === 'aprobado'){
    boton.classList.add('aprobado');
    el('selloTexto').textContent = 'Aprobado' + (b.visto_por ? ' · ' + b.visto_por : '');
  } else if (b.estado === 'cambios'){
    boton.classList.add('cambios');
    el('selloTexto').textContent = 'Con cambios' + (b.visto_por ? ' · ' + b.visto_por : '');
  } else {
    el('selloTexto').textContent = 'Sin revisar';
  }
}

el('sello').onclick = () => {
  if (!estado.B) return avisar('Elige un prop primero', 'mal');
  el('selloQue').textContent =
    `${estado.seleccion.prop} · v${estado.B.numero} · subida el ${estado.B.fecha.slice(0,10)}`;
  el('selloQuien').value = estado.B.visto_por || localStorage_seguro('revisor') || '';
  el('dlgSello').showModal();
};

/* el nombre del revisor se recuerda entre sesiones si el navegador lo permite */
function localStorage_seguro(clave, valor){
  try {
    if (valor === undefined) return localStorage.getItem('comparador_' + clave);
    localStorage.setItem('comparador_' + clave, valor);
  } catch { return null; }
}

async function ponerEstado(nuevo){
  const quien = el('selloQuien').value.trim();
  if (nuevo && !quien) return avisar('Escribe quién revisa', 'mal');
  try {
    const r = await api('/api/estado', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({id: estado.B.id, estado: nuevo, quien})
    });
    Object.assign(estado.B, r);
    if (quien) localStorage_seguro('revisor', quien);
    el('dlgSello').close();
    pintarSello();
    await cargarArbol();
    avisar(nuevo === 'aprobado' ? `🦁 Aprobado por ${quien}`
         : nuevo === 'cambios'  ? `Marcado con cambios por ${quien}`
         : 'Marca quitada', nuevo ? 'bien' : '');
  } catch (e){
    avisar('No se pudo guardar: ' + e.message, 'mal');
  }
}

el('selloAprobar').onclick = () => ponerEstado('aprobado');
el('selloCambios').onclick = () => ponerEstado('cambios');
el('selloQuitar').onclick  = () => ponerEstado('');

/* ======================= REVISIÓN: NOTAS SOBRE LA IMAGEN ======================= */
const capas = {A: el('capaA'), B: el('capaB')};
/* las notas de cada lado se guardan aparte para poder pintar las dos */
const notasPorLado = {A: [], B: []};
let trazoEnCurso = null;

/* cuál de las dos se está anotando */
function ladoActivo(){
  const esA = estado.lado === 'A';
  return {
    esA,
    datos: esA ? estado.A : estado.B,
    img: esA ? imgA : imgB,
    escala: estado.escala * (esA ? 1 : escalaB()),
    /* con las dos a la vista, B se dibuja media pantalla a la derecha */
    desplazamiento: (estado.anotando && estado.verAmbas && !esA) ? viewport.clientWidth/2 : 0,
  };
}

async function cargarNotas(){
  for (const lado of ['A', 'B']){
    const v = lado === 'A' ? estado.A : estado.B;
    if (!v){ notasPorLado[lado] = []; continue; }
    try { notasPorLado[lado] = await api('/api/notas?version=' + v.id); }
    catch { notasPorLado[lado] = []; }
  }
  estado.notas = notasPorLado[estado.lado];
  const { datos } = ladoActivo();
  if (datos) el('notasVersion').textContent = `v${datos.numero} · ${datos.fecha.slice(0,10)}`;
  pintarNotas();
  listarNotas();
}

/* numera solo las que están puestas sobre la imagen */
function numeroDe(nota){
  let n = 0;
  for (const x of estado.notas){
    if (x.tipo === 'pin'){ n++; if (x.id === nota.id) return n; }
  }
  return null;
}

function dibujarNotas(g, ancho, alto, grosorBase){
  const radio = Math.max(14, ancho * 0.016);
  for (const nota of estado.notas){
    if (nota.resuelta) g.globalAlpha = 0.35;
    if (nota.tipo === 'trazo' && nota.datos && nota.datos.puntos){
      g.strokeStyle = nota.color || '#ff3b30';
      g.lineWidth = grosorBase; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      nota.datos.puntos.forEach(([x, y], i) => {
        const px = x*ancho, py = y*alto;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      });
      g.stroke();
    }
    if (nota.tipo === 'pin' && nota.datos){
      const px = nota.datos.x*ancho, py = nota.datos.y*alto;
      g.beginPath(); g.arc(px, py, radio, 0, Math.PI*2);
      g.fillStyle = nota.color || '#ff3b30'; g.fill();
      g.lineWidth = Math.max(2, radio*0.14); g.strokeStyle = '#ffffff'; g.stroke();
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `700 ${radio*1.1}px system-ui, sans-serif`;
      g.fillText(String(numeroDe(nota)), px, py);
    }
    g.globalAlpha = 1;
  }
}

function pintarNotas(){
  for (const lado of ['A', 'B']){
    const v = lado === 'A' ? estado.A : estado.B;
    const capa = capas[lado];
    if (!v) continue;
    if (capa.width !== v.ancho){ capa.width = v.ancho; capa.height = v.alto; }
    const g = capa.getContext('2d');
    g.clearRect(0, 0, capa.width, capa.height);
    const guardadas = estado.notas;
    estado.notas = notasPorLado[lado];
    dibujarNotas(g, capa.width, capa.height, Math.max(3, capa.width*0.004));
    if (trazoEnCurso && trazoEnCurso.lado === lado && trazoEnCurso.puntos.length > 1){
      g.strokeStyle = el('colorNota').value;
      g.lineWidth = Math.max(3, capa.width*0.004); g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      trazoEnCurso.puntos.forEach(([x, y], i) => {
        const px = x*capa.width, py = y*capa.height;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      });
      g.stroke();
    }
    estado.notas = guardadas;
  }
}

function listarNotas(){
  const cont = el('listaNotas');
  cont.textContent = '';
  if (!estado.notas.length){
    cont.innerHTML = '<div class="vacio" style="padding:8px">Sin notas todavía.<br>Usa Señalar para marcar un punto sobre la imagen, o escribe un comentario general abajo.</div>';
    return;
  }
  for (const nota of estado.notas){
    const item = document.createElement('div');
    item.className = 'notaItem' + (nota.resuelta ? ' hecha' : '');

    const cab = document.createElement('div');
    cab.className = 'notaCab';
    const globo = document.createElement('span');
    globo.className = 'globo';
    globo.style.background = nota.color || '#5c6b7a';
    globo.textContent = nota.tipo === 'pin' ? numeroDe(nota) : (nota.tipo === 'trazo' ? '~' : '·');
    const meta = document.createElement('span');
    meta.textContent = [nota.autor, nota.fecha.slice(5,10)].filter(Boolean).join(' · ');
    cab.append(globo, meta);

    const texto = document.createElement('input');
    texto.className = 'texto'; texto.type = 'text'; texto.value = nota.texto || '';
    texto.placeholder = 'qué hay que cambiar…';
    texto.onchange = async () => {
      nota.texto = texto.value;
      await api('/api/nota-editar', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({id: nota.id, texto: texto.value})});
    };

    const acciones = document.createElement('div');
    acciones.className = 'acciones';
    const hecho = document.createElement('span');
    hecho.textContent = nota.resuelta ? '↺ reabrir' : '✓ resuelta';
    hecho.onclick = async () => {
      await api('/api/nota-editar', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({id: nota.id, resuelta: !nota.resuelta})});
      nota.resuelta = nota.resuelta ? 0 : 1;
      pintarNotas(); listarNotas();
    };
    const quitar = document.createElement('span');
    quitar.textContent = '× borrar';
    quitar.onclick = async () => {
      await api('/api/nota-quitar', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({id: nota.id})});
      estado.notas = estado.notas.filter(x => x.id !== nota.id);
      pintarNotas(); listarNotas();
    };
    acciones.append(hecho, quitar);

    item.append(cab, texto, acciones);
    cont.appendChild(item);
  }
}

async function crearNota(tipo, datos, texto, lado){
  lado = lado || estado.lado;
  const version = lado === 'A' ? estado.A : estado.B;
  if (lado !== estado.lado){
    estado.lado = lado;
    document.querySelectorAll('[data-lado]').forEach(x => x.classList.toggle('on', x.dataset.lado === lado));
  }
  const r = await api('/api/nota-visual', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({version: version.id, tipo, datos, texto: texto || '',
                          autor: el('hAutor') ? el('hAutor').value.trim() : '',
                          color: el('colorNota').value})
  });
  await cargarNotas();
  const ultima = el('listaNotas').lastElementChild;
  if (ultima){ const c = ultima.querySelector('input.texto'); if (c) c.focus(); }
  return r;
}

/* pantalla -> coordenadas de la imagen, entre 0 y 1 */
/* con las dos a la vista, el lado lo decide dónde se hace clic */
function ladoBajoCursor(ev){
  if (!estado.verAmbas) return estado.lado;
  const r = viewport.getBoundingClientRect();
  return (ev.clientX - r.left) < r.width/2 ? 'A' : 'B';
}

function aImagen(ev, lado){
  lado = lado || estado.lado;
  const r = viewport.getBoundingClientRect();
  const datos = lado === 'A' ? estado.A : estado.B;
  const escala = estado.escala * (lado === 'A' ? 1 : escalaB());
  const desplazamiento = (estado.anotando && estado.verAmbas && lado === 'B') ? viewport.clientWidth/2 : 0;
  const tx = estado.x + desplazamiento - datos.ancho*escala/2;
  const ty = estado.y - datos.alto*escala/2;
  return {
    x: ((ev.clientX - r.left) - tx) / (datos.ancho * escala),
    y: ((ev.clientY - r.top)  - ty) / (datos.alto  * escala),
  };
}

function dentro(p){ return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1; }

el('btnAnotar').onclick = () => {
  if (!estado.B) return avisar('Elige un prop primero', 'mal');
  estado.anotando = !estado.anotando;
  el('btnAnotar').classList.toggle('on', estado.anotando);
  el('panelNotas').hidden = !estado.anotando;
  if (estado.anotando){
    if (!estado.verAmbas && estado.modo === 'split') ponerModo('wipe');
    estado.herramienta = 'mano';
    document.querySelectorAll('[data-herr]').forEach(x => x.classList.toggle('on', x.dataset.herr === 'mano'));
    ajustar();
  } else pintar();
};
el('cerrarNotas').onclick = () => el('btnAnotar').onclick();

el('verAmbas').onclick = () => {
  estado.verAmbas = !estado.verAmbas;
  el('verAmbas').classList.toggle('on', estado.verAmbas);
  ponerModo(estado.verAmbas ? 'split' : 'wipe');
};

document.querySelectorAll('[data-lado]').forEach(b => b.onclick = async () => {
  estado.lado = b.dataset.lado;
  document.querySelectorAll('[data-lado]').forEach(x => x.classList.toggle('on', x === b));
  estado.notas = notasPorLado[estado.lado];
  const { datos } = ladoActivo();
  if (datos) el('notasVersion').textContent = `v${datos.numero} · ${datos.fecha.slice(0,10)}`;
  listarNotas(); pintar();
});

document.querySelectorAll('[data-herr]').forEach(b => b.onclick = () => {
  estado.herramienta = b.dataset.herr;
  document.querySelectorAll('[data-herr]').forEach(x => x.classList.toggle('on', x === b));
  viewport.classList.toggle('mano', estado.herramienta === 'mano');
});

el('comentarioNuevo').onkeydown = async e => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  await crearNota('general', null, e.target.value.trim());
  e.target.value = '';
};

/* ======================= REPORTE DE REVISIÓN ======================= */
el('btnReporte').onclick = async () => {
  if (!estado.B || !estado.A) return;
  const sel = estado.seleccion;
  const datos = {produccion: sel.proyecto, prop: sel.prop, capitulo: sel.episodio, shot: sel.shot};

  const { datos: ver, img: imagen } = ladoActivo();
  estado.notas = notasPorLado[estado.lado];
  const anchoImg = ver.ancho;
  const panel = Math.max(900, anchoImg * 0.55);
  const contenidoW = anchoImg + 60 + panel;
  const esc = Math.min(1, 5200 / contenidoW);
  const cw = contenidoW * esc;
  const e = Math.max(1, cw / 2240);
  const u = n => n * e;

  const conTexto = estado.notas.filter(n => n.tipo !== 'trazo' || (n.texto || '').trim());
  const altoLista = u(120) + conTexto.length * u(96);
  const contenidoAlto = Math.max(ver.alto * esc, altoLista, u(560));
  const ancho = cw + u(280);
  const cabecera = u(230);
  const alto = cabecera + u(60) + contenidoAlto + u(60) + u(80);

  const c = document.createElement('canvas');
  c.width = Math.round(ancho); c.height = Math.round(alto);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  g.textBaseline = 'middle';
  dibujarCabecera(g, ancho, u, datos, hoja.logo);

  const mx = u(80), my = cabecera, mw = ancho - u(160), mh = alto - cabecera - u(80);
  g.strokeStyle = '#111111'; g.lineWidth = Math.max(2, u(4));
  g.strokeRect(mx, my, mw, mh);
  g.strokeStyle = '#d8d8d8'; g.lineWidth = Math.max(1, u(2));
  g.strokeRect(mx + u(18), my + u(18), mw - u(36), mh - u(36));

  /* la imagen con las marcas encima */
  const ix = mx + u(60), iy = my + u(60);
  const w = anchoImg * esc, h = ver.alto * esc;
  g.drawImage(imagen, ix, iy, w, h);
  g.strokeStyle = '#cccccc'; g.lineWidth = Math.max(1, u(2));
  g.strokeRect(ix, iy, w, h);
  g.save(); g.translate(ix, iy);
  dibujarNotas(g, w, h, Math.max(3, w*0.004));
  g.restore();

  /* la lista de notas */
  const px = ix + w + u(60);
  const anchoPanel = mx + mw - u(60) - px;
  let y = iy + u(10);
  g.textAlign = 'left'; g.fillStyle = '#1c1c1c';
  g.font = `600 ${u(34)}px system-ui, sans-serif`;
  g.fillText('Notas de revisión', px, y + u(12));
  g.fillStyle = '#777777'; g.font = `${u(22)}px system-ui, sans-serif`;
  g.fillText(`v${ver.numero} · subida el ${ver.fecha.slice(0,10)}` +
             (ver.autor ? ' · ' + ver.autor : ''), px, y + u(52));
  y += u(110);

  const radio = u(17);
  for (const nota of conTexto){
    g.beginPath(); g.arc(px + radio, y + radio, radio, 0, Math.PI*2);
    g.fillStyle = nota.color || '#5c6b7a'; g.fill();
    g.fillStyle = '#ffffff'; g.textAlign = 'center';
    g.font = `700 ${u(20)}px system-ui, sans-serif`;
    g.fillText(nota.tipo === 'pin' ? String(numeroDe(nota)) : (nota.tipo === 'trazo' ? '~' : '·'),
               px + radio, y + radio);

    g.textAlign = 'left'; g.fillStyle = nota.resuelta ? '#999999' : '#1c1c1c';
    g.font = `${u(26)}px system-ui, sans-serif`;
    const lineas = envolver(g, nota.texto || '(sin texto)', anchoPanel - u(60)).slice(0, 2);
    lineas.forEach((linea, i) => g.fillText(linea, px + u(50), y + u(14) + i*u(32)));
    if (nota.resuelta){
      g.fillStyle = '#4a9d6a'; g.font = `${u(20)}px system-ui, sans-serif`;
      g.fillText('resuelta', px + u(50), y + u(14) + lineas.length*u(32));
    }
    y += u(96);
  }

  g.textAlign = 'right'; g.fillStyle = '#888888';
  g.font = `${u(22)}px system-ui, sans-serif`;
  g.fillText('Reporte generado el ' + new Date().toLocaleDateString('es-CO'),
             mx + mw - u(60), my + mh - u(46));

  c.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reporte_${sel.prop.replace(/[^\w\-]+/g,'_')}_v${ver.numero}.png`;
    a.click();
  }, 'image/png');
  avisar('Reporte descargado', 'bien');
};

/* ======================= HOJAS ======================= */
/* Adaptadores: en esta versión los proyectos viven en el servidor */
async function proyectosListar(){
  return await api('/api/proyectos');
}

async function proyectoGuardar(d){
  let logo_datos = null, logo_nombre = null;
  if (d.logoArchivo){
    logo_datos = await new Promise((ok, mal) => {
      const l = new FileReader();
      l.onload = () => ok(l.result.split(',')[1]);
      l.onerror = () => mal(new Error('no se pudo leer el logo'));
      l.readAsDataURL(d.logoArchivo);
    });
    logo_nombre = d.logoArchivo.name;
  }
  return api('/api/proyecto', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({nombre:d.nombre, produccion:d.produccion, logo_datos, logo_nombre})
  });
}

function urlLogoProyecto(p){
  return p.logo ? '/logo/' + encodeURIComponent(p.logo) : null;
}

function piezasDeLaApp(){
  const r = [];
  if (estado.A) r.push({img:imgA, ancho:estado.A.ancho, alto:estado.A.alto,
                        etiqueta:`A · v${estado.A.numero}`, color:'#0a7c8c'});
  if (estado.B) r.push({img:imgB, ancho:estado.B.ancho, alto:estado.B.alto,
                        etiqueta:`B · v${estado.B.numero}`, color:'#c04a2b'});
  return r;
}

function prellenarFicha(){
  const s = estado.seleccion;
  if (s){
    if (!el('hProduccion').value) el('hProduccion').value = s.proyecto;
    el('hCapitulo').value = s.episodio;
    el('hShot').value = s.shot;
    el('hProp').value = s.prop;
  }
  if (estado.B){
    el('hNota').value = estado.B.nota || '';
    el('hAutor').value = estado.B.autor || '';
  }
}

el('exportar').onclick = () => {
  if (!estado.A || !estado.B) return avisar('Elige un prop en la biblioteca primero', 'mal');
  abrirDialogoHoja();
};

/* ==================== HOJAS DE EXPORTACIÓN ====================
   Este bloque es idéntico en las dos versiones del comparador.
   Depende de cuatro funciones que cada versión define a su manera:
     proyectosListar()      -> [{nombre, produccion, logo}]
     proyectoGuardar(datos) -> guarda uno
     urlLogoProyecto(p)     -> dirección de la imagen del logo, o null
     piezasDeLaApp()        -> las imágenes que ya están cargadas
   ============================================================== */

const PLANTILLAS = {
  ab:         {nombre:'Comparación A/B',        min:2, max:2},
  turnaround: {nombre:'Turnaround · 3 vistas',  min:3, max:3},
  ficha:      {nombre:'Ficha de prop',          min:1, max:1},
  contacto:   {nombre:'Contact sheet',          min:1, max:12},
};

const hoja = {plantilla:'ab', piezas:[], logo:null, proyecto:'', ajuste:'original',
              formato:'16:9', seleccion:null};

/* Proporciones de página. 'auto' deja que la hoja crezca con el contenido;
   las demás mantienen siempre la misma forma, como una página de Canva. */
const FORMATOS = {
  '16:9':  {nombre:'Apaisado 16:9', razon: 16/9},
  'a4':    {nombre:'A4 apaisado',   razon: 297/210},
  '4:3':   {nombre:'4:3',           razon: 4/3},
  '1:1':   {nombre:'Cuadrado',      razon: 1},
  'auto':  {nombre:'Se ajusta al contenido', razon: null},
};

/* ---------- utilidades de dibujo ---------- */
function recortar(g, texto, maximo){
  texto = texto || '';
  if (g.measureText(texto).width <= maximo) return texto;
  let t = texto;
  while (t.length > 4 && g.measureText(t + '…').width > maximo) t = t.slice(0, -1);
  return t + '…';
}

function envolver(g, texto, maximo){
  const palabras = (texto || '').split(' ');
  const lineas = []; let linea = '';
  for (const p of palabras){
    const prueba = linea ? linea + ' ' + p : p;
    if (g.measureText(prueba).width > maximo && linea){ lineas.push(linea); linea = p; }
    else linea = prueba;
  }
  if (linea) lineas.push(linea);
  return lineas;
}

/* Tamaño con que se dibuja cada imagen, según el ajuste elegido.
   original  → tal cual viene
   alto      → todas al mismo alto, respetando su proporción
   recortar  → todas a la misma celda, recortando lo que sobra (como Canva) */
function medidaPieza(p, celda){
  if (hoja.ajuste === 'alto'){
    const alto = celda.alto;
    return {ancho: p.ancho * (alto / p.alto), alto, recorte: null};
  }
  if (hoja.ajuste === 'recortar'){
    const enc = p.encuadre || {zoom: 1, cx: 0.5, cy: 0.5};
    const factor = Math.max(celda.ancho / p.ancho, celda.alto / p.alto) * enc.zoom;
    // ventana de la imagen original que cabe en la celda
    const sw = Math.min(p.ancho, celda.ancho / factor);
    const sh = Math.min(p.alto,  celda.alto  / factor);
    // el centro se mueve al arrastrar, sin salirse de la imagen
    const sx = Math.min(p.ancho - sw, Math.max(0, p.ancho * enc.cx - sw/2));
    const sy = Math.min(p.alto  - sh, Math.max(0, p.alto  * enc.cy - sh/2));
    return {ancho: celda.ancho, alto: celda.alto, recorte: {sx, sy, sw, sh}};
  }
  return {ancho: p.ancho, alto: p.alto, recorte: null};
}

/* celda de referencia: la mediana evita que una imagen enorme mande sobre todas */
function celdaBase(p){
  if (hoja.ajuste === 'recortar'){
    const anchos = p.map(x => x.ancho).sort((a, b) => a - b);
    const altos  = p.map(x => x.alto).sort((a, b) => a - b);
    const medio = x => x[Math.floor(x.length/2)];
    return {ancho: medio(anchos), alto: medio(altos)};
  }
  return {ancho: Math.max(...p.map(x => x.ancho)),
          alto:  Math.min(...p.map(x => x.alto))};
}

function medidasHoja(){
  const p = hoja.piezas;
  if (!p.length) return null;
  const hueco = 60;
  const celda = celdaBase(p);
  const medidas = p.map(x => medidaPieza(x, celda));

  if (hoja.plantilla === 'ficha'){
    return {ficha:true, hueco, medidas, contenidoW: medidas[0].ancho + hueco + 620};
  }
  const n = p.length;
  let filas;
  if (hoja.plantilla === 'ab' || hoja.plantilla === 'turnaround' || n <= 3){
    filas = [n];                                  // todo en una fila
  } else {
    // reparto parejo: 4 -> 2+2, 5 -> 3+2, 7 -> 3+2+2
    const cuantas = Math.round(Math.sqrt(n));
    const base = Math.floor(n / cuantas), resto = n % cuantas;
    filas = Array.from({length: cuantas}, (_, i) => base + (i < resto ? 1 : 0));
  }
  const columnas = Math.max(...filas);
  const celdaW = Math.max(...medidas.map(m => m.ancho));
  const celdaH = Math.max(...medidas.map(m => m.alto));
  return {columnas, filas, celdaW, celdaH, hueco, medidas,
          contenidoW: columnas*celdaW + (columnas-1)*hueco};
}

/* Dibuja la cabecera del estudio. La usan la hoja y el reporte. */
function dibujarCabecera(g, ancho, u, datos, logo){
  /* --- cabecera: una sola banda gris con separadores, como la plantilla --- */
  if (logo){
    const h = u(130), w = h * (logo.width / logo.height);
    g.drawImage(logo, u(80), u(45), w, h);
  }
  const titulo = [datos.produccion, datos.prop].filter(Boolean).join(' / ') || 'Comparación de versiones';
  const bandaDer = ancho - u(80);
  const bandaIzq = Math.max(u(80) + u(430), ancho * 0.29);
  const bandaW = bandaDer - bandaIzq;
  const bandaY = u(62), bandaH = u(58);

  g.fillStyle = '#e9e9e9';
  g.fillRect(bandaIzq, bandaY, bandaW, bandaH);

  let cursor = bandaIzq;
  const secciones = [0.62, 0.17, 0.21].map(proporcion => {
    const s = {x: cursor, w: bandaW * proporcion};
    cursor += s.w;
    return s;
  });
  const valores = [titulo, datos.capitulo, datos.shot];
  const pies = ['Producción', 'Capítulo', 'Versión'];

  secciones.forEach((s, i) => {
    g.textAlign = 'center';
    g.fillStyle = '#1c1c1c';
    g.font = `${u(i === 0 ? 30 : 28)}px system-ui, sans-serif`;
    g.fillText(recortar(g, valores[i], s.w - u(28)), s.x + s.w/2, bandaY + bandaH/2);
    g.fillStyle = '#555555';
    g.font = `${u(22)}px system-ui, sans-serif`;
    g.fillText(pies[i], s.x + s.w/2, bandaY + bandaH + u(28));
  });

  g.strokeStyle = '#1c1c1c'; g.lineWidth = Math.max(1, u(3));
  for (let i = 1; i < secciones.length; i++){
    const sx = secciones[i].x;
    g.beginPath(); g.moveTo(sx, bandaY + u(8));  g.lineTo(sx, bandaY + bandaH - u(8)); g.stroke();
    g.beginPath(); g.moveTo(sx, bandaY + bandaH + u(14)); g.lineTo(sx, bandaY + bandaH + u(42)); g.stroke();
  }

}

/* Dibuja una pieza, recortándola si el ajuste lo pide */
function ponerImagen(g, pieza, medida, x, y, w, h){
  if (medida.recorte){
    const r = medida.recorte;
    g.drawImage(pieza.img, r.sx, r.sy, r.sw, r.sh, x, y, w, h);
  } else {
    g.drawImage(pieza.img, x, y, w, h);
  }
}

/* Sello de aprobación en la esquina, como el león del chat del estudio */
function dibujarSello(g, u, x, y, marca){
  if (!marca || !marca.estado) return;
  const aprobado = marca.estado === 'aprobado';
  const texto = aprobado ? 'APROBADO' : 'CON CAMBIOS';
  const pie = [marca.visto_por, (marca.visto_fecha || '').slice(0,10)].filter(Boolean).join(' · ');
  g.font = `700 ${u(24)}px system-ui, sans-serif`;
  const ancho = Math.max(g.measureText(texto).width, u(150)) + u(90);
  const alto = pie ? u(86) : u(60);

  g.save();
  g.strokeStyle = aprobado ? '#2f8f5b' : '#c98a2e';
  g.fillStyle = aprobado ? '#eef8f2' : '#fdf5e8';
  g.lineWidth = Math.max(2, u(3));
  g.beginPath();
  g.rect(x - ancho, y, ancho, alto);
  g.fill(); g.stroke();

  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.font = `${u(30)}px system-ui, sans-serif`;
  g.fillStyle = '#000';
  g.fillText(aprobado ? '🦁' : '✎', x - ancho + u(18), y + (pie ? u(30) : alto/2));
  g.fillStyle = aprobado ? '#1e6b42' : '#8a5d18';
  g.font = `700 ${u(24)}px system-ui, sans-serif`;
  g.fillText(texto, x - ancho + u(64), y + (pie ? u(28) : alto/2));
  if (pie){
    g.fillStyle = '#777';
    g.font = `${u(20)}px system-ui, sans-serif`;
    g.fillText(pie, x - ancho + u(64), y + u(60));
  }
  g.restore();
}

/* ---------- la hoja ---------- */
function dibujarHoja(){
  const m = medidasHoja();
  if (!m) return null;
  hoja.celdas = [];
  const datos = datosDeLaFicha();

  const esc = Math.min(1, 5200 / m.contenidoW);      // techo para hojas enormes
  const cw = m.contenidoW * esc;
  const e = Math.max(1, cw / 2240);
  const u = n => n * e;

  const hayRotulos = hoja.piezas.some(p => (p.etiqueta || '').trim());
  const rotulo = hayRotulos ? u(46) : u(10);

  let contenidoAlto;
  if (m.ficha){
    contenidoAlto = Math.max(m.medidas[0].alto * esc + rotulo, u(560));
  } else {
    const altoCelda = m.celdaH * esc;
    contenidoAlto = m.filas.length * (rotulo + altoCelda) + (m.filas.length - 1) * u(50);
  }

  let ancho = cw + u(280);           // 80 de margen + 60 de aire, a cada lado
  const cabecera = u(230);
  let alto = cabecera + u(60) + contenidoAlto + u(60) + u(80);

  /* La página conserva su proporción añadiendo margen, nunca deformando:
     si sobra ancho crece el alto, y si la hoja queda muy alta crece el ancho. */
  const razon = FORMATOS[hoja.formato] ? FORMATOS[hoja.formato].razon : null;
  let sobra = 0, sobraX = 0;
  if (razon){
    const altoIdeal = ancho / razon;
    if (altoIdeal > alto){
      sobra = altoIdeal - alto; alto = altoIdeal;
    } else {
      const anchoIdeal = alto * razon;
      sobraX = anchoIdeal - ancho; ancho = anchoIdeal;
    }
  }

  const c = document.createElement('canvas');
  c.width = Math.round(ancho); c.height = Math.round(alto);
  hoja.tamano = {ancho: c.width, alto: c.height};
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  g.textBaseline = 'middle';

  dibujarCabecera(g, ancho, u, datos, hoja.logo);
  if (typeof marcaDeAprobacion === 'function'){
    dibujarSello(g, u, ancho - u(80), u(158), marcaDeAprobacion());
  }

  /* --- marco --- */
  const mx = u(80), my = cabecera, mw = ancho - u(160), mh = alto - cabecera - u(80);
  const centrado = sobra / 2;   // aire de más, repartido arriba y abajo
  g.strokeStyle = '#111111'; g.lineWidth = Math.max(2, u(4));
  g.strokeRect(mx, my, mw, mh);
  g.strokeStyle = '#d8d8d8'; g.lineWidth = Math.max(1, u(2));
  g.strokeRect(mx + u(18), my + u(18), mw - u(36), mh - u(36));
  const inicioY = my + u(60) + centrado;

  /* --- contenido --- */
  if (m.ficha){
    const p = hoja.piezas[0];
    const md = m.medidas[0];
    const w = md.ancho * esc, h = md.alto * esc;
    const ix = mx + u(60);
    if ((p.etiqueta || '').trim()){
      g.textAlign = 'left'; g.fillStyle = p.color;
      g.font = `600 ${u(26)}px system-ui, sans-serif`;
      g.fillText(recortar(g, p.etiqueta, w), ix, inicioY + u(20));
    }
    hoja.celdas.push({i:0, x:ix, y:inicioY + rotulo, w, h});
    ponerImagen(g, p, md, ix, inicioY + rotulo, w, h);
    g.strokeStyle = '#cccccc'; g.lineWidth = Math.max(1, u(2));
    g.strokeRect(ix, inicioY + rotulo, w, h);

    const px = ix + w + u(60);
    const anchoPanel = mx + mw - u(60) - px;
    let y = inicioY + u(20);
    const lineas = [
      ['Prop', datos.prop], ['Producción', datos.produccion],
      ['Capítulo', datos.capitulo], ['Shot', datos.shot],
      ['Autor', datos.autor], ['Fecha', new Date().toLocaleDateString('es-CO')],
    ];
    for (const [etiqueta, valor] of lineas){
      if (!valor) continue;
      g.fillStyle = '#8a8a8a'; g.font = `${u(20)}px system-ui, sans-serif`;
      g.fillText(etiqueta.toUpperCase(), px, y);
      g.fillStyle = '#1c1c1c'; g.font = `${u(28)}px system-ui, sans-serif`;
      g.fillText(recortar(g, valor, anchoPanel), px, y + u(34));
      y += u(80);
    }
    if (datos.nota){
      g.fillStyle = '#8a8a8a'; g.font = `${u(20)}px system-ui, sans-serif`;
      g.fillText('NOTAS', px, y);
      g.fillStyle = '#333333'; g.font = `${u(25)}px system-ui, sans-serif`;
      y += u(36);
      for (const linea of envolver(g, datos.nota, anchoPanel)){
        g.fillText(linea, px, y); y += u(34);
      }
    }
  } else {
    const altoCelda = m.celdaH * esc, anchoCelda = m.celdaW * esc, hueco = m.hueco * esc;
    let i = 0, y = inicioY;
    for (const enFila of m.filas){
      let x = mx + (mw - (enFila*anchoCelda + (enFila-1)*hueco)) / 2;
      for (let col = 0; col < enFila && i < hoja.piezas.length; col++, i++){
        const p = hoja.piezas[i];
        const md = m.medidas[i];
        const w = md.ancho * esc, h = md.alto * esc;
        const ix = x + (anchoCelda - w)/2;
        if ((p.etiqueta || '').trim()){
          g.textAlign = 'left'; g.fillStyle = p.color;
          g.font = `600 ${u(26)}px system-ui, sans-serif`;
          g.fillText(recortar(g, p.etiqueta, anchoCelda), ix, y + u(20));
        }
        hoja.celdas.push({i, x:ix, y:y + rotulo, w, h});
        ponerImagen(g, p, md, ix, y + rotulo, w, h);
        g.strokeStyle = '#cccccc'; g.lineWidth = Math.max(1, u(2));
        g.strokeRect(ix, y + rotulo, w, h);
        x += anchoCelda + hueco;
      }
      y += rotulo + altoCelda + u(50);
    }
    if (datos.nota){
      g.textAlign = 'left'; g.fillStyle = '#444444';
      g.font = `italic ${u(24)}px system-ui, sans-serif`;
      g.fillText(recortar(g, 'Nota: ' + datos.nota, mw - u(500)), mx + u(60), my + mh - u(46));
    }
    if (datos.autor){
      g.textAlign = 'right'; g.fillStyle = '#888888';
      g.font = `${u(22)}px system-ui, sans-serif`;
      g.fillText(datos.autor, mx + mw - u(60), my + mh - u(46));
    }
  }
  return c;
}

/* ---------- diálogo ---------- */
function datosDeLaFicha(){
  return {
    produccion: el('hProduccion').value.trim(),
    capitulo:   el('hCapitulo').value.trim(),
    shot:       el('hShot').value.trim(),
    prop:       el('hProp').value.trim(),
    nota:       el('hNota').value.trim(),
    autor:      el('hAutor').value.trim(),
  };
}

function colorDePieza(i){
  return ['#0a7c8c', '#c04a2b', '#5c6b7a', '#7a5c8c', '#4a7c4a'][i % 5];
}

function agregarPieza(archivo, etiqueta){
  return new Promise(listo => {
    const img = new Image();
    img.onload = () => {
      hoja.piezas.push({
        img, ancho: img.naturalWidth, alto: img.naturalHeight,
        etiqueta: etiqueta || '',
        encuadre: {zoom: 1, cx: 0.5, cy: 0.5},
        color: colorDePieza(hoja.piezas.length),
        nombre: archivo.name,
      });
      listo(true);
    };
    img.onerror = () => listo(false);
    img.src = URL.createObjectURL(archivo);
  });
}

function pintarHuecos(){
  const cont = el('hHuecos');
  cont.textContent = '';
  const p = PLANTILLAS[hoja.plantilla];

  hoja.piezas.forEach((pieza, i) => {
    const caja = document.createElement('div');
    caja.className = 'hueco lleno';
    const et = document.createElement('input');
    et.type = 'text'; et.value = pieza.etiqueta; et.className = 'etiqueta';
    et.placeholder = 'rótulo (opcional)';
    et.oninput = () => { pieza.etiqueta = et.value; refrescarPrevia(); };
    const info = document.createElement('span');
    info.className = 'chico';
    info.textContent = `${pieza.ancho}×${pieza.alto}`;
    const quitar = document.createElement('span');
    quitar.className = 'x'; quitar.textContent = '×'; quitar.title = 'Quitar';
    quitar.onclick = () => { hoja.piezas.splice(i, 1); pintarHuecos(); refrescarPrevia(); };
    caja.append(et, info, quitar);
    cont.appendChild(caja);
  });

  if (hoja.piezas.length < p.max){
    const vacio = document.createElement('div');
    vacio.className = 'hueco';
    vacio.textContent = hoja.piezas.length < p.min
      ? `Falta imagen ${hoja.piezas.length + 1} de ${p.min} — clic o arrastra`
      : 'Añadir otra imagen';
    const elegir = () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
      inp.onchange = async () => {
        for (const f of [...inp.files].slice(0, p.max - hoja.piezas.length)) await agregarPieza(f);
        pintarHuecos(); refrescarPrevia();
      };
      inp.click();
    };
    vacio.onclick = elegir;
    vacio.ondragover = e => { e.preventDefault(); vacio.classList.add('over'); };
    vacio.ondragleave = () => vacio.classList.remove('over');
    vacio.ondrop = async e => {
      e.preventDefault(); vacio.classList.remove('over');
      for (const f of [...e.dataTransfer.files].slice(0, p.max - hoja.piezas.length)) await agregarPieza(f);
      pintarHuecos(); refrescarPrevia();
    };
    cont.appendChild(vacio);
  }
}

let temporizadorPrevia = null;
function refrescarPrevia(){
  clearTimeout(temporizadorPrevia);
  temporizadorPrevia = setTimeout(() => {
    const previa = el('hPrevia');
    const p = PLANTILLAS[hoja.plantilla];
    const aviso = el('hAviso');
    if (hoja.piezas.length < p.min){
      previa.hidden = true;
      aviso.textContent = `Esta plantilla necesita ${p.min} ${p.min === 1 ? 'imagen' : 'imágenes'}.`;
      aviso.hidden = false;
      return;
    }
    aviso.hidden = true; previa.hidden = false;
    const c = dibujarHoja();
    if (!c) return;
    const anchoPrevia = previa.parentElement.clientWidth || 460;
    previa.width = anchoPrevia;
    previa.height = Math.round(anchoPrevia * c.height / c.width);
    const g = previa.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, previa.width, previa.height);
    g.drawImage(c, 0, 0, previa.width, previa.height);
    dibujarSeleccion(g, c.width / previa.width);
  }, 120);
}

async function llenarProyectos(seleccionado){
  const lista = await proyectosListar();
  el('hProyecto').innerHTML = '<option value="">— sin proyecto —</option>' +
    lista.map(p => `<option value="${p.nombre.replace(/"/g,'&quot;')}">${p.nombre}</option>`).join('');
  if (seleccionado) el('hProyecto').value = seleccionado;
  return lista;
}

async function aplicarProyecto(){
  const nombre = el('hProyecto').value;
  hoja.proyecto = nombre;
  if (!nombre){ hoja.logo = null; el('hLogoNombre').textContent = 'sin logo'; refrescarPrevia(); return; }
  const lista = await proyectosListar();
  const p = lista.find(x => x.nombre === nombre);
  if (!p) return;
  if (p.produccion) el('hProduccion').value = p.produccion;
  const url = urlLogoProyecto(p);
  if (url){
    const img = new Image();
    img.onload = () => { hoja.logo = img; el('hLogoNombre').textContent = 'logo del proyecto'; refrescarPrevia(); };
    img.onerror = () => { hoja.logo = null; refrescarPrevia(); };
    img.src = url;
  } else {
    hoja.logo = null; el('hLogoNombre').textContent = 'sin logo'; refrescarPrevia();
  }
}

/* ---------- encuadre manual, con tiradores como en Canva ---------- */
const TIRADOR = 9;   // radio en pixeles de pantalla

function celdaDe(indice){
  return (hoja.celdas || []).find(c => c.i === indice);
}

/* dibuja el marco de selección sobre la vista previa (no sale en el PNG) */
function dibujarSeleccion(g, escala){
  const sel = hoja.seleccion;
  if (sel === null || hoja.ajuste !== 'recortar') return;
  const c = celdaDe(sel);
  if (!c) return;
  const x = c.x/escala, y = c.y/escala, w = c.w/escala, h = c.h/escala;
  g.save();
  g.strokeStyle = '#7c6cf0'; g.lineWidth = 2;
  g.strokeRect(x, y, w, h);
  g.fillStyle = '#ffffff';
  for (const [px, py] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]]){
    g.beginPath(); g.arc(px, py, TIRADOR, 0, Math.PI*2);
    g.fill(); g.stroke();
  }
  g.restore();
}

function conectarEncuadre(){
  const previa = el('hPrevia');
  let accion = null;

  /* pasa de coordenadas de pantalla a las de la hoja */
  function enHoja(ev){
    const r = previa.getBoundingClientRect();
    const k = hoja.tamano ? hoja.tamano.ancho / r.width : 1;
    return {x: (ev.clientX - r.left) * k, y: (ev.clientY - r.top) * k, k};
  }

  function tiradorBajo(p){
    if (hoja.seleccion === null) return null;
    const c = celdaDe(hoja.seleccion);
    if (!c) return null;
    const margen = TIRADOR * p.k * 1.6;
    const esquinas = [[c.x,c.y],[c.x+c.w,c.y],[c.x,c.y+c.h],[c.x+c.w,c.y+c.h]];
    for (const [ex, ey] of esquinas){
      if (Math.abs(p.x-ex) < margen && Math.abs(p.y-ey) < margen) return {cx:c.x+c.w/2, cy:c.y+c.h/2};
    }
    return null;
  }

  function celdaBajo(p){
    return (hoja.celdas || []).find(c => p.x >= c.x && p.x <= c.x+c.w && p.y >= c.y && p.y <= c.y+c.h);
  }

  previa.addEventListener('pointerdown', ev => {
    if (hoja.ajuste !== 'recortar') return;
    const p = enHoja(ev);
    const tirador = tiradorBajo(p);
    if (tirador){
      ev.preventDefault();
      previa.setPointerCapture(ev.pointerId);
      const enc = hoja.piezas[hoja.seleccion].encuadre;
      accion = {tipo:'escalar', centro:tirador, zoom0:enc.zoom,
                dist0: Math.hypot(p.x - tirador.cx, p.y - tirador.cy)};
      return;
    }
    const celda = celdaBajo(p);
    hoja.seleccion = celda ? celda.i : null;
    if (celda){
      ev.preventDefault();
      previa.setPointerCapture(ev.pointerId);
      accion = {tipo:'mover', celda, px:ev.clientX, py:ev.clientY, k:p.k};
    }
    actualizarControles();
    refrescarPrevia();
  });

  previa.addEventListener('pointermove', ev => {
    if (!accion) return;
    const enc = hoja.piezas[hoja.seleccion].encuadre;
    if (accion.tipo === 'escalar'){
      const p = enHoja(ev);
      const dist = Math.hypot(p.x - accion.centro.cx, p.y - accion.centro.cy);
      const factor = accion.dist0 > 0 ? dist / accion.dist0 : 1;
      enc.zoom = Math.min(6, Math.max(1, accion.zoom0 * factor));
    } else {
      // al arrastrar, la imagen sigue al cursor
      enc.cx = Math.min(1, Math.max(0, enc.cx - (ev.clientX - accion.px) * accion.k / (accion.celda.w * enc.zoom)));
      enc.cy = Math.min(1, Math.max(0, enc.cy - (ev.clientY - accion.py) * accion.k / (accion.celda.h * enc.zoom)));
      accion.px = ev.clientX; accion.py = ev.clientY;
    }
    refrescarPrevia();
  });

  const soltar = () => { accion = null; };
  previa.addEventListener('pointerup', soltar);
  previa.addEventListener('pointercancel', soltar);

  previa.addEventListener('wheel', ev => {
    if (hoja.ajuste !== 'recortar') return;
    const p = enHoja(ev);
    const celda = celdaBajo(p);
    if (!celda) return;
    ev.preventDefault();
    hoja.seleccion = celda.i;
    const enc = hoja.piezas[celda.i].encuadre;
    enc.zoom = Math.min(6, Math.max(1, enc.zoom * (ev.deltaY < 0 ? 1.1 : 1/1.1)));
    actualizarControles();
    refrescarPrevia();
  }, {passive:false});

  previa.addEventListener('dblclick', ev => {
    if (hoja.ajuste !== 'recortar') return;
    const celda = celdaBajo(enHoja(ev));
    if (!celda) return;
    hoja.piezas[celda.i].encuadre = {zoom:1, cx:.5, cy:.5};
    refrescarPrevia();
  });
}

function actualizarControles(){
  const hay = hoja.seleccion !== null && hoja.ajuste === 'recortar';
  el('hControlesImagen').hidden = !hay;
  if (!hay) return;
  const enc = hoja.piezas[hoja.seleccion].encuadre;
  el('hZoom').value = Math.round(enc.zoom * 100);
  el('hZoomTexto').textContent = Math.round(enc.zoom * 100) + '%';
  el('hCualImagen').textContent = 'Imagen ' + (hoja.seleccion + 1);
}

function conectarDialogoHoja(){
  conectarEncuadre();
  el('hPlantilla').innerHTML = Object.keys(PLANTILLAS)
    .map(k => `<option value="${k}">${PLANTILLAS[k].nombre}</option>`).join('');
  el('hFormato').innerHTML = Object.keys(FORMATOS)
    .map(k => `<option value="${k}">${FORMATOS[k].nombre}</option>`).join('');
  el('hFormato').value = hoja.formato;

  el('hFormato').onchange = () => { hoja.formato = el('hFormato').value; refrescarPrevia(); };

  el('hZoom').oninput = () => {
    if (hoja.seleccion === null) return;
    hoja.piezas[hoja.seleccion].encuadre.zoom = el('hZoom').value / 100;
    el('hZoomTexto').textContent = el('hZoom').value + '%';
    refrescarPrevia();
  };
  el('hCentrar').onclick = () => {
    if (hoja.seleccion === null) return;
    const enc = hoja.piezas[hoja.seleccion].encuadre;
    enc.cx = .5; enc.cy = .5;
    refrescarPrevia();
  };
  el('hReiniciar').onclick = () => {
    if (hoja.seleccion === null) return;
    hoja.piezas[hoja.seleccion].encuadre = {zoom:1, cx:.5, cy:.5};
    actualizarControles(); refrescarPrevia();
  };
  el('hMismoTodas').onclick = () => {
    if (hoja.seleccion === null) return;
    const base = hoja.piezas[hoja.seleccion].encuadre;
    hoja.piezas.forEach(p => p.encuadre = {...base});
    refrescarPrevia();
  };

  el('hAjuste').onchange = () => {
    hoja.seleccion = null;
    actualizarControles();
    hoja.ajuste = el('hAjuste').value;
    el('hPistaEncuadre').hidden = hoja.ajuste !== 'recortar';
    el('hPrevia').style.cursor = hoja.ajuste === 'recortar' ? 'grab' : 'default';
    refrescarPrevia();
  };

  el('hPlantilla').onchange = () => {
    hoja.plantilla = el('hPlantilla').value;
    const max = PLANTILLAS[hoja.plantilla].max;
    if (hoja.piezas.length > max) hoja.piezas = hoja.piezas.slice(0, max);
    hoja.seleccion = null; actualizarControles();
    pintarHuecos(); refrescarPrevia();
  };
  el('hProyecto').onchange = aplicarProyecto;
  ['hProduccion','hCapitulo','hShot','hProp','hNota','hAutor'].forEach(id => {
    el(id).oninput = refrescarPrevia;
  });

  el('hLogo').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const archivo = inp.files[0]; if (!archivo) return;
      hoja.logoArchivo = archivo;
      const img = new Image();
      img.onload = () => { hoja.logo = img; el('hLogoNombre').textContent = archivo.name; refrescarPrevia(); };
      img.src = URL.createObjectURL(archivo);
    };
    inp.click();
  };

  el('hGuardarProyecto').onclick = async () => {
    const nombre = (el('hNuevoProyecto').value || el('hProyecto').value || '').trim();
    if (!nombre) return avisar('Escribe un nombre de proyecto para guardarlo', 'mal');
    try {
      await proyectoGuardar({
        nombre,
        produccion: el('hProduccion').value.trim(),
        logoArchivo: hoja.logoArchivo || null,
      });
      el('hNuevoProyecto').value = '';
      await llenarProyectos(nombre);
      hoja.proyecto = nombre;
      avisar(`Proyecto "${nombre}" guardado`, 'bien');
    } catch (e){
      avisar('No se pudo guardar el proyecto: ' + e.message, 'mal');
    }
  };

  el('hCerrar').onclick = () => el('dlgHoja').close();

  el('hExportar').onclick = () => {
    const c = dibujarHoja();
    if (!c) return avisar('Faltan imágenes para esta plantilla', 'mal');
    const nombre = (datosDeLaFicha().prop || 'hoja').replace(/[^\w\-]+/g, '_');
    c.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nombre + '.png';
      a.click();
    }, 'image/png');
  };
}

async function abrirDialogoHoja(){
  hoja.piezas = piezasDeLaApp();
  hoja.piezas.forEach((p, i) => p.color = colorDePieza(i));
  hoja.plantilla = hoja.piezas.length === 2 ? 'ab' : 'contacto';
  el('hPlantilla').value = hoja.plantilla;
  await llenarProyectos(hoja.proyecto);
  if (hoja.proyecto) await aplicarProyecto();
  if (typeof prellenarFicha === 'function') prellenarFicha();
  pintarHuecos();
  refrescarPrevia();
  el('dlgHoja').showModal();
}

/* el sello viaja con la hoja */
function marcaDeAprobacion(){
  return estado.B ? {estado: estado.B.estado, visto_por: estado.B.visto_por,
                     visto_fecha: estado.B.visto_fecha} : null;
}

/* ======================= SUBIR ======================= */
const dlg = el('dlg'), zona = el('zonaArchivo');

el('btnSubir').onclick = () => {
  if (estado.seleccion){
    el('fProyecto').value = estado.seleccion.proyecto;
    el('fEpisodio').value = estado.seleccion.episodio;
    el('fShot').value = estado.seleccion.shot;
    el('fProp').value = estado.seleccion.prop;
  }
  estado.archivoNuevo = null;
  errorEnFormulario('');
  zona.textContent = 'Arrastra la imagen aquí, pégala con Ctrl+V o haz clic';
  el('fNota').value = '';
  dlg.showModal();
};

function tomarArchivo(archivo){
  if (!archivo || !archivo.type.startsWith('image/')) return;
  estado.archivoNuevo = archivo;
  zona.textContent = `${archivo.name} · ${(archivo.size/1048576).toFixed(2)} MB`;
}
zona.onclick = () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => tomarArchivo(inp.files[0]);
  inp.click();
};
zona.ondragover = e => { e.preventDefault(); zona.classList.add('over'); };
zona.ondragleave = () => zona.classList.remove('over');
zona.ondrop = e => { e.preventDefault(); zona.classList.remove('over'); tomarArchivo(e.dataTransfer.files[0]); };
window.addEventListener('paste', e => {
  if (!dlg.open) return;
  const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
  if (item) tomarArchivo(item.getAsFile());
});

function errorEnFormulario(texto){
  const caja = el('dlgError');
  caja.textContent = texto || '';
  caja.hidden = !texto;
}

el('btnCancelar').onclick = () => dlg.close();

el('btnGuardar').onclick = async () => {
  errorEnFormulario('');
  const campos = {fProyecto:'proyecto', fEpisodio:'episodio', fShot:'shot', fProp:'prop'};
  const faltan = Object.keys(campos).filter(c => !el(c).value.trim()).map(c => campos[c]);
  if (faltan.length) return errorEnFormulario('Falta rellenar: ' + faltan.join(', ') + '.');
  if (!estado.archivoNuevo) return errorEnFormulario('Falta elegir la imagen. Arrástrala al recuadro de abajo o haz clic en él.');

  const boton = el('btnGuardar');
  boton.disabled = true; boton.textContent = 'Guardando…';
  try {
    const datos = await new Promise((ok, mal) => {
      const l = new FileReader();
      l.onload = () => ok(l.result.split(',')[1]);
      l.onerror = () => mal(new Error('No se pudo leer el archivo'));
      l.readAsDataURL(estado.archivoNuevo);
    });
    const r = await api('/api/subir', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        proyecto: el('fProyecto').value.trim(), episodio: el('fEpisodio').value.trim(),
        shot: el('fShot').value.trim(), prop: el('fProp').value.trim(),
        autor: el('fAutor').value.trim(), nota: el('fNota').value.trim(),
        tipo: el('fTipo').value,
        nombre: estado.archivoNuevo.name, datos
      })
    });
    dlg.close();
    await cargarArbol();
    await seleccionar(el('fProyecto').value.trim(), el('fEpisodio').value.trim(),
                      el('fShot').value.trim(), el('fProp').value.trim());
    if (!el('panelAvance').hidden) cargarAvance();
    avisar(`Guardada como v${r.numero} de "${el('fProp').value.trim()}"`, 'bien');
  } catch (e) {
    errorEnFormulario('No se pudo guardar: ' + e.message);
  } finally {
    boton.disabled = false; boton.textContent = 'Guardar versión';
  }
};

/* ======================= PESTAÑAS ======================= */
el('filtroTipo').onchange = cargarArbol;
el('filtroEstado').onchange = cargarArbol;
el('buscar').oninput = cargarArbol;
el('tabBiblio').onclick = () => cambiarPestana('biblioteca');
el('tabAvance').onclick = () => cambiarPestana('avance');
el('tabActividad').onclick = () => cambiarPestana('actividad');
function cambiarPestana(nombre){
  const biblioteca = nombre === 'biblioteca';
  const avance = nombre === 'avance';
  el('tabBiblio').classList.toggle('on', biblioteca);
  el('tabAvance').classList.toggle('on', avance);
  el('tabActividad').classList.toggle('on', nombre === 'actividad');
  el('panelBiblio').hidden = !biblioteca;
  el('panelAvance').hidden = !avance;
  el('panelActividad').hidden = nombre !== 'actividad';
  if (avance) cargarAvance();
  if (nombre === 'actividad') cargarActividad();
}

cargarArbol();
conectarDialogoHoja();
pintar();
})();
