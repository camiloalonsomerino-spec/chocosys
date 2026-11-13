// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// «Segunda opinión» (sprint 10, 21-10-2026; pedidos 40 a 42 de quien usa la app): el directorio a mano desde cualquier vista.
// Arriba se pide (qué evaluar, contexto, negocio opcional, tema y profundidad); abajo, «Opiniones del directorio» con
// su veredicto y su rastro: qué receta, con qué modelo, qué sesión la hizo, cuánto tardó, si usó internet y qué dejó.
// Desde ahí se abre el veredicto, la deliberación y las fuentes, se vuelve a la sesión para seguir conversando con ella
// y se anota la opinión en un negocio. Usa camposSala, EXPRES_SALA y avisoSala de crm.js.

const opinion = { abierto: false, lista: [], negocios: [], reloj: null, firma: '' };
const errorLimpio = (err) => String(err && err.message || err).replace(/^Error invoking remote method '[^']+': Error: /, '');
const dmaHm = (iso) => { if (!iso) return '—'; const d = new Date(iso); const p = (x) => String(x).padStart(2, '0'); return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };

function formOpinion() {
  const c = camposSala('op');
  const negocio = h('select', { id: 'op-negocio', 'aria-label': 'Negocio (opcional)' }, h('option', { value: '' }, 'Sin negocio'),
    opinion.negocios.map((n) => h('option', { value: n.id }, `${n.nombre}${n.empresa ? ' · ' + n.empresa : ''}`)));
  const form = h('form', { class: 'crm-form op-form' },
    h('label', { class: 'crm-campo crm-ancho' }, h('span', {}, 'Qué evaluar'), c.decision),
    h('label', { class: 'crm-campo crm-ancho' }, h('span', {}, 'Tu inclinación'), c.inclinacion),
    h('label', { class: 'crm-campo crm-ancho' }, h('span', {}, 'Contexto'), c.contexto),
    h('div', { class: 'crm-par crm-ancho' }, c.tema, c.profundidad),
    h('div', { class: 'crm-ancho' }, c.ayuda),
    h('label', { class: 'crm-campo crm-ancho' }, h('span', {}, 'Negocio del CRM a la vista (opcional: suma su contexto)'), negocio),
    h('div', { class: 'crm-sala-asientos crm-ancho' }, c.marcas.map((m) => m.el)),
    h('div', { class: 'crm-s-pie' }, h('span', { class: 'crm-nada' }, 'No ejecuta ni envía nada: solo opina.'), h('span', { class: 'relleno' }),
      h('button', { type: 'submit', class: 'boton principal', id: 'op-pedir' }, 'Pedir segunda opinión')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = c.datos();
    if (!d.decision) { c.decision.focus(); return; }
    if (d.asientos.length < 2) { aviso('Marca al menos dos asientos: la sala necesita que choquen.'); return; }
    if (negocio.value) d.negocio_id = Number(negocio.value);
    const boton = $('#op-pedir');
    boton.disabled = true;
    try {
      await api.sala.pedir(d);
      aviso(avisoSala(d.profundidad));
      c.decision.value = ''; c.inclinacion.value = ''; c.contexto.value = '';
      await cargarOpiniones(true);
    } catch (err) { aviso(errorLimpio(err)); }
    boton.disabled = false;
  });
  return form;
}

// El rastro en una línea: profundidad, modelo, sesiones, tiempo e internet (pedido 42: «ver qué sesión abre qué»).
function rastroOpinion(o) {
  const min = o.fin && o.creado ? Math.max(1, Math.round((new Date(o.fin) - new Date(o.creado)) / 60000)) : null;
  return [o.profundidad_nombre, o.receta, (o.modelos || []).filter(Boolean).join(' + ') || null,
    o.sesiones.length ? (o.sesiones.length === 1 ? '1 sesión' : o.sesiones.length + ' sesiones') : null,
    min ? min + ' min' : null, o.web ? 'con internet' : null, o.crm ? 'CRM ' + o.crm : null].filter(Boolean).join(' · ');
}

function filaOpinion(o) {
  const v = o.veredicto;
  // Los mismos colores que la tarjeta del veredicto en el kanban (app.js, columnaVeredicto).
  const e = String(v && v.etiqueta || '');
  const clase = /no hacerlo/.test(e) ? 'no' : /rehacer|esperar/.test(e) ? 'medio' : /condiciones/.test(e) ? 'cond' : 'si';
  const etiqueta = e ? e.charAt(0).toUpperCase() + e.slice(1) : '?';   // «Adelante con condiciones», no «Adelante Con Condiciones»
  const estado = v ? h('span', { class: 'op-veredicto e-' + clase }, `${etiqueta}${v.puntaje !== null ? ' · ' + v.puntaje + '/10' : ''}`)
    : o.error ? h('span', { class: 'op-veredicto e-error' }, 'Veredicto ilegible')
    : o.estado === 'puerta' || o.simulacro ? h('span', { class: 'op-veredicto' }, 'Espera su puerta')
    : h('span', { class: 'op-veredicto e-pensando' }, h('span', { class: 'punto respira' }), ' pensando');
  const abrir = (archivo, texto) => h('button', { type: 'button', class: 'boton chico', onclick: () => api.sala.abrir(o.carpeta, archivo) }, texto);
  const acciones = [];
  if (o.archivos.includes('VEREDICTO.md')) acciones.push(abrir('VEREDICTO.md', 'Ver veredicto'));
  // Sprint 27: lo que no cupo en las 700 palabras del veredicto (la cuenta completa, el detalle por asiento).
  if (o.archivos.includes('VEREDICTO-DETALLE.md')) acciones.push(abrir('VEREDICTO-DETALLE.md', 'Detalle'));
  if (o.archivos.includes('DELIBERACION.md')) acciones.push(abrir('DELIBERACION.md', 'Deliberación'));
  if (o.archivos.includes('INVESTIGACION.md')) acciones.push(abrir('INVESTIGACION.md', 'Fuentes'));
  acciones.push(abrir(null, 'Carpeta'));
  // Volver a la sesión que dio la opinión, para preguntarle más (mientras siga en Chocosys).
  const viva = o.sesiones.find((s) => s.viva && sesion(s.id));
  if (viva) acciones.push(h('button', { type: 'button', class: 'boton chico', title: 'Ir a la terminal de la sesión que dio esta opinión, para seguir conversando con ella',
    onclick: () => { cerrarOpinion(); irASesion(viva.id); } }, 'Abrir la sesión'));
  let anotar = null;
  if (o.registrado) anotar = h('p', { class: 'op-nota' }, `Anotada en «${o.negocio || 'el negocio'}» el ${o.registrado}.`);
  else if (v && o.negocio_id) anotar = h('button', { type: 'button', class: 'boton chico', onclick: async () => {
    try { const r = await api.sala.anotar(o.carpeta, o.negocio_id); aviso(`Anotada en «${r.negocio}».`); cargarOpiniones(true); } catch (err) { aviso(errorLimpio(err)); }
  } }, `Anotar en «${o.negocio}»`);
  else if (v) {
    const sel = h('select', { 'aria-label': 'Negocio donde anotarla' }, h('option', { value: '' }, 'Anotar en un negocio…'), opinion.negocios.map((n) => h('option', { value: n.id }, n.nombre)));
    anotar = h('div', { class: 'op-anotar' }, sel, h('button', { type: 'button', class: 'boton chico', onclick: async () => {
      if (!sel.value) { sel.focus(); return; }
      try { const r = await api.sala.anotar(o.carpeta, Number(sel.value)); aviso(`Anotada en «${r.negocio}».`); cargarOpiniones(true); } catch (err) { aviso(errorLimpio(err)); }
    } }, 'Anotar'));
    if (opinion.negocios.length === 0) anotar = h('p', { class: 'op-nota' }, `Para anotarla, elige el CRM ${o.crm} en la vista CRM.`);
  }
  return h('article', { class: 'op-fila' },
    h('div', { class: 'op-cab' }, h('span', { class: 'op-cuando' }, dmaHm(o.creado)), estado),
    h('p', { class: 'op-decision' }, (v && v.decision) || o.decision),
    h('p', { class: 'op-rastro' }, rastroOpinion(o)),
    o.negocio && !o.registrado ? h('p', { class: 'op-nota' }, 'Negocio: ' + o.negocio) : null,
    h('div', { class: 'op-acc' }, acciones),
    anotar);
}

function pintarOpinion() {
  const caja = $('#opinion-panel');
  if (!opinion.abierto) { caja.hidden = true; return; }
  caja.hidden = false;
  // El formulario se arma una vez por apertura (para no borrar lo que estás escribiendo); la lista se repinta sola.
  if (!caja.querySelector('.op-form')) {
    caja.replaceChildren(
      h('div', { class: 'op-t' }, h('b', {}, 'Segunda opinión del directorio'),
        h('span', { class: 'crm-nada' }, ' Asesores propios (Caja, Comercial, Operación, Método, Tu tiempo, Legal) que se confrontan y entregan un veredicto.'),
        h('span', { class: 'relleno' }), h('button', { type: 'button', class: 'v-boton', 'aria-label': 'Cerrar', title: 'Cerrar (Esc)', onclick: cerrarOpinion }, '×')),
      formOpinion(),
      h('div', { class: 'op-lista-t' }, h('b', {}, 'Opiniones del directorio'), h('span', { class: 'crm-nada', id: 'op-cuenta' })),
      h('div', { class: 'op-lista', id: 'op-lista' }));
    requestAnimationFrame(() => { const d = $('#op-decision'); if (d) d.focus(); });
  }
  const firma = JSON.stringify(opinion.lista.map((o) => [o.carpeta, o.estado, o.veredicto && o.veredicto.etiqueta, o.registrado, o.sesiones.length, o.fin, o.error])) + opinion.negocios.length;
  if (firma === opinion.firma) return;
  opinion.firma = firma;
  $('#op-cuenta').textContent = opinion.lista.length ? ` ${opinion.lista.length}` : '';
  $('#op-lista').replaceChildren(...(opinion.lista.length ? opinion.lista.map(filaOpinion)
    : [h('p', { class: 'pop-nada' }, 'Todavía no hay opiniones. La primera aparece acá, con su veredicto y el rastro de quién la hizo.')]));
}

async function cargarOpiniones(forzar) {
  try { opinion.lista = await api.sala.opiniones(); } catch (err) { opinion.lista = []; }
  if (forzar) opinion.firma = '';
  pintarOpinion();
}

async function abrirOpinion() {
  opinion.abierto = true;
  $('#segunda-opinion').setAttribute('aria-expanded', 'true');
  await cargarDirectorio();   // asesores, temas y profundidades, recién leídos de directorio.json (sprint 11)
  try { opinion.negocios = await api.crm.negocios({}); } catch (err) { opinion.negocios = []; }
  $('#opinion-panel').replaceChildren();
  opinion.firma = '';
  await cargarOpiniones(true);
  // Mientras esté abierto, la lista se pone al día sola (una opinión exprés tarda de 2 a 8 minutos).
  clearInterval(opinion.reloj);
  opinion.reloj = setInterval(() => { if (opinion.abierto && document.visibilityState === 'visible') cargarOpiniones(false); }, 4000);
}
function cerrarOpinion() {
  opinion.abierto = false;
  clearInterval(opinion.reloj);
  $('#segunda-opinion').setAttribute('aria-expanded', 'false');
  pintarOpinion();
}

$('#segunda-opinion').addEventListener('click', (ev) => { ev.stopPropagation(); if (opinion.abierto) cerrarOpinion(); else abrirOpinion(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && opinion.abierto) { cerrarOpinion(); ev.stopPropagation(); } });
