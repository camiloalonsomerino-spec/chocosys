// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Tutorial (sprint 5, 20-10-2026): el botón «? Tutorial» recorre la pantalla en la que estás, paso a paso, iluminando
// cada elemento con qué es y para qué sirve. Pedido de quien usa la app: «que abra como un tutorial de qué significa esto, qué
// significa esto otro… si alguien quiere meterse en el sistema y ver para qué sirve cada cosa».
// Sprint 11 (21-10-2026, pedidos 42 a 44): el contenido salió del código a app\config\tutorial.json (el índice de la
// interfaz, que se relee en cada apertura) y se sumaron tres cosas:
// - «Seleccionar una parte»: pasas el mouse, se ilumina lo que el índice conoce, y un clic lo explica;
// - cada parte trae cómo se usa o cómo se escribe ahí, y un ejemplo armado con tus pestañas, sesiones, CRM, negocios y recetas;
// - dos páginas: «Cómo personalizar» (qué se cambia y en qué archivo, con «Abrir») y «Cómo trabajar con la IA».

let tour = null;
const NOMBRE_VISTA = { inicio: 'Inicio', lienzo: 'el lienzo', bandeja: 'la bandeja', flujo: 'los flujos', crm: 'el CRM' };

// ── El índice y los ejemplos con tus datos ──────────────────────────────────────────────────
async function cargarIndice() {
  const indice = await api.tutorial.indice().catch((err) => ({ error: String(err && err.message || err) }));
  // T-A101: la ruta la da main.js (puede ser la copia de <DATOS>\config\); sin ella, la de siempre.
  if (!indice || indice.error) { aviso('No pude leer el índice del tutorial (' + (indice && indice.ruta || 'app\\config\\tutorial.json') + '). ' + (indice && indice.error || '')); return null; }
  return indice;
}
// T-A91: «Abrir» de «Cómo personalizar» avisa si no pudo (antes fallaba callado, p. ej. un archivo dentro del instalador).
async function abrirPersonalizable(clave) {
  const r = await api.tutorial.abrir(clave).catch((err) => ({ error: String(err && err.message || err) }));
  if (r && r.error) aviso(r.error);
}
const visible =(el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
function partesDe(indice) {
  return [...((indice.vistas || {})[modo] || []), ...(indice.comunes || [])].filter((p) => p && p.sel && p.titulo);
}
// Los nombres reales de quien lo usa, para que el ejemplo hable de su Chocosys y no de una genérica.
async function datosEjemplo() {
  const esp = espacio(actual) || espacios[0];
  const deEsta = sesiones.filter((s) => !esp || s.espacio === esp.id);
  const nombres = (deEsta.length ? deEsta : sesiones).map((s) => s.nombre);
  let receta = 'Prueba · tres agentes';
  try { const r = await api.recetas(); if (r && r.length) receta = (r.find((x) => !/prueba/i.test(x.grupo || '')) || r[0]).nombre; } catch (err) { /* queda el de ejemplo */ }
  return {
    'pestaña': esp ? esp.nombre : 'General', sesion: nombres[0] || 'mi-sesion', sesion2: nombres[1] || 'otra-sesion',
    crm: (crmEstado.resumen && crmEstado.resumen.crm) || 'Principal',
    negocio: (crmEstado.negocios[0] && crmEstado.negocios[0].nombre) || 'un negocio', receta
  };
}
const rellenarEjemplo = (texto, datos) => String(texto || '').replace(/\{(pestaña|sesion2?|crm|negocio|receta)\}/g, (_, k) => datos[k] || k);

// La explicación de una parte: qué es, cómo se usa, un ejemplo con tus datos y dónde se personaliza.
function cuerpoParte(p, datos, indice) {
  const filaPers = p.personalizar && indice.paginas && indice.paginas.personalizar
    ? (indice.paginas.personalizar.filas || []).find((f) => f.clave === p.personalizar) : null;
  return [
    h('h3', {}, p.titulo),
    h('p', {}, p.texto),
    p.cuando ? h('p', { class: 'tut-como' }, h('b', {}, 'Cuándo usarlo: '), p.cuando) : null,
    p.como ? h('p', { class: 'tut-como' }, h('b', {}, 'Cómo se usa: '), p.como) : null,
    p.ejemplo ? h('div', { class: 'tut-ejemplo' }, h('span', { class: 'rotulo' }, 'Ejemplo con tus datos'), h('code', {}, rellenarEjemplo(p.ejemplo, datos))) : null,
    filaPers ? h('button', { type: 'button', class: 'boton chico tut-pers', title: filaPers.donde, onclick: () => abrirPersonalizable(filaPers.clave) }, 'Personalizar: abrir ' + filaPers.donde) : null
  ];
}

function cerrarTutorial() {
  if (!tour) return;
  tour.capa.remove();
  removeEventListener('resize', tour.alRedimensionar);
  document.removeEventListener('keydown', tour.teclas, true);
  tour = null;
}
// La tarjeta va bajo el elemento si cabe; si no, encima; nunca fuera de la ventana.
function ubicarJunto(tarjeta, r) {
  const tw = tarjeta.offsetWidth || 380, th = tarjeta.offsetHeight || 200;
  const x = Math.min(Math.max(12, r.left), innerWidth - tw - 12);
  let y = r.bottom + 14;
  if (y + th > innerHeight - 12) y = Math.max(12, r.top - th - 14);
  Object.assign(tarjeta.style, { left: x + 'px', top: y + 'px' });
}
function marcarFoco(foco, r) {
  Object.assign(foco.style, { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px', display: '' });
}
// Botones de abajo, iguales en el recorrido, la selección y las páginas.
const botonesGuia = (indice, datos) => [
  h('button', { type: 'button', class: 'boton chico', id: 'tut-seleccionar', onclick: () => seleccionarParte(indice, datos) }, 'Seleccionar una parte'),
  h('button', { type: 'button', class: 'boton chico', id: 'tut-personalizar', onclick: () => abrirPagina(indice, datos, 'personalizar') }, 'Cómo personalizar'),
  h('button', { type: 'button', class: 'boton chico', id: 'tut-ia', onclick: () => abrirPagina(indice, datos, 'ia') }, 'Cómo trabajar con la IA')
];

function nuevaCapa(modoCapa) {
  cerrarTutorial();
  const foco = h('div', { class: 'tut-foco' });
  const tarjeta = h('div', { class: 'tut-tarjeta', role: 'dialog', 'aria-live': 'polite' });
  const capa = h('div', { class: 'tut-capa' + (modoCapa ? ' ' + modoCapa : '') }, foco, tarjeta);
  document.body.appendChild(capa);
  tour = { capa, foco, tarjeta, i: 0, reubicar: () => {}, teclas: (e) => { if (e.key === 'Escape') { cerrarTutorial(); e.preventDefault(); e.stopPropagation(); } } };
  // Un solo oyente de tamaño y uno de teclas por capa: cerrarTutorial saca exactamente estos dos.
  tour.alRedimensionar = () => tour && tour.reubicar();
  addEventListener('resize', tour.alRedimensionar);
  document.addEventListener('keydown', tour.teclas, true);
  return tour;
}
// Cambia las teclas de la capa abierta (el recorrido usa flechas), sacando las anteriores.
function teclasDeCapa(t, fn) {
  document.removeEventListener('keydown', t.teclas, true);
  t.teclas = fn;
  document.addEventListener('keydown', t.teclas, true);
}

// ── El recorrido de siempre ────────────────────────────────────────────────────────────────
async function abrirTutorial() {
  const indice = await cargarIndice();
  if (!indice) return;
  const datos = await datosEjemplo();
  const pasos = partesDe(indice).filter((p) => visible(document.querySelector(p.sel)));
  if (!pasos.length) { abrirPagina(indice, datos, 'ia'); return; }
  const t = nuevaCapa();
  const atras = h('button', { type: 'button', class: 'boton chico' }, 'Anterior');
  const sig = h('button', { type: 'button', class: 'boton chico brasa-boton' }, 'Siguiente');
  const salir = h('button', { type: 'button', class: 'boton chico' }, 'Salir');
  const cuenta = h('span', { class: 'tut-cuenta' });
  const cuerpo = h('div', { class: 'tut-cuerpo' });
  t.tarjeta.append(h('span', { class: 'rotulo' }, 'Tutorial · ' + (NOMBRE_VISTA[modo] || 'esta pantalla')), cuerpo,
    h('div', { class: 'tut-acc' }, cuenta, h('span', { class: 'relleno' }), salir, atras, sig),
    h('div', { class: 'tut-acc tut-guias' }, botonesGuia(indice, datos)));
  const ir = (i) => {
    t.i = Math.max(0, Math.min(pasos.length - 1, i));
    const p = pasos[t.i];
    const el = document.querySelector(p.sel);
    if (!el) { cerrarTutorial(); return; }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    marcarFoco(t.foco, r);
    cuerpo.replaceChildren(...cuerpoParte(p, datos, indice));
    cuenta.textContent = `${t.i + 1} de ${pasos.length}`;
    atras.disabled = t.i === 0;
    sig.textContent = t.i === pasos.length - 1 ? 'Listo' : 'Siguiente';
    ubicarJunto(t.tarjeta, r);
  };
  t.reubicar = () => ir(t.i);
  teclasDeCapa(t, (e) => {
    if (e.key === 'Escape') { cerrarTutorial(); e.preventDefault(); e.stopPropagation(); }
    // Enter sobre un botón lo aprieta (no avanza también el recorrido).
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { if (e.target && e.target.tagName === 'BUTTON' && e.key === 'Enter') return; if (t.i === pasos.length - 1) cerrarTutorial(); else ir(t.i + 1); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'ArrowLeft') { ir(t.i - 1); e.preventDefault(); e.stopPropagation(); }
  });
  sig.addEventListener('click', () => { if (t.i === pasos.length - 1) cerrarTutorial(); else ir(t.i + 1); });
  atras.addEventListener('click', () => ir(t.i - 1));
  salir.addEventListener('click', cerrarTutorial);
  requestAnimationFrame(() => ir(0));
  sig.focus();
}

// ── «Seleccionar una parte» (pedido 43) ────────────────────────────────────────────────────
// La capa deja pasar el mouse a una cortina transparente que escucha; bajo el puntero se busca la parte más chica del
// índice que lo contiene (así «Barra de comando» le gana a «Barra de herramientas»). Un clic la explica.
function parteBajo(x, y, partes) {
  const bajo = document.elementsFromPoint(x, y).filter((e) => !e.closest('.tut-capa'));
  let mejor = null;
  for (const e of bajo) {
    for (const p of partes) {
      const el = e.closest(p.sel);
      if (!el || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (!mejor || area < mejor.area) mejor = { p, el, r, area };
    }
    if (mejor) break;   // el elemento de más arriba bajo el puntero manda
  }
  return mejor;
}
async function seleccionarParte(indiceDado, datosDados) {
  const indice = indiceDado || await cargarIndice();
  if (!indice) return;
  const datos = datosDados || await datosEjemplo();
  const partes = partesDe(indice);
  const t = nuevaCapa('tut-seleccion');
  const cortina = h('div', { class: 'tut-cortina', 'aria-hidden': 'true' });
  const rotulo = h('div', { class: 'tut-rotulo-puntero' });
  t.capa.prepend(cortina);
  t.capa.append(rotulo);
  t.foco.style.display = 'none';
  const instruccion = () => t.tarjeta.replaceChildren(h('span', { class: 'rotulo' }, 'Tutorial · seleccionar una parte'),
    h('h3', {}, 'Elige qué quieres entender'),
    h('p', {}, 'Pasa el mouse por la pantalla: se ilumina lo que el tutorial conoce. Un clic te explica qué hace, cómo se usa y un ejemplo con tus datos.'),
    h('div', { class: 'tut-acc' }, h('span', { class: 'relleno' }), h('button', { type: 'button', class: 'boton chico', onclick: cerrarTutorial }, 'Salir')));
  instruccion();
  Object.assign(t.tarjeta.style, { left: Math.max(12, innerWidth - 400) + 'px', top: '70px' });
  let elegido = null;
  cortina.addEventListener('mousemove', (ev) => {
    if (elegido) return;
    const m = parteBajo(ev.clientX, ev.clientY, partes);
    if (!m) { t.foco.style.display = 'none'; rotulo.hidden = true; return; }
    marcarFoco(t.foco, m.r);
    rotulo.hidden = false;
    rotulo.textContent = m.p.titulo + ' · clic para explicar';
    Object.assign(rotulo.style, { left: Math.min(ev.clientX + 14, innerWidth - 260) + 'px', top: Math.min(ev.clientY + 16, innerHeight - 40) + 'px' });
  });
  cortina.addEventListener('click', (ev) => {
    const m = parteBajo(ev.clientX, ev.clientY, partes);
    if (!m) return;
    elegido = m;
    rotulo.hidden = true;
    cortina.style.pointerEvents = 'none';   // con la explicación abierta, la pantalla no se toca por error
    marcarFoco(t.foco, m.r);
    t.tarjeta.replaceChildren(h('span', { class: 'rotulo' }, 'Tutorial · ' + (NOMBRE_VISTA[modo] || 'esta pantalla')), ...cuerpoParte(m.p, datos, indice),
      h('div', { class: 'tut-acc' }, h('span', { class: 'relleno' }),
        h('button', { type: 'button', class: 'boton chico', onclick: cerrarTutorial }, 'Salir'),
        h('button', { type: 'button', class: 'boton chico brasa-boton', id: 'tut-otra', onclick: () => { elegido = null; cortina.style.pointerEvents = ''; t.foco.style.display = 'none'; instruccion(); Object.assign(t.tarjeta.style, { left: Math.max(12, innerWidth - 400) + 'px', top: '70px' }); } }, 'Seleccionar otra')));
    ubicarJunto(t.tarjeta, m.r);
  });
  t.reubicar = () => { if (elegido && document.contains(elegido.el)) { elegido.r = elegido.el.getBoundingClientRect(); marcarFoco(t.foco, elegido.r); ubicarJunto(t.tarjeta, elegido.r); } };
}

// ── Las dos páginas (pedidos 42 y 44) ──────────────────────────────────────────────────────
function abrirPagina(indice, datos, cual) {
  const pag = indice.paginas && indice.paginas[cual];
  if (!pag) { aviso('El índice del tutorial no trae la página «' + cual + '».'); return; }
  const t = nuevaCapa('tut-con-pagina');
  t.foco.style.display = 'none';
  const contenido = cual === 'personalizar'
    ? [pag.intro ? h('p', {}, pag.intro) : null,
      h('div', { class: 'tut-tabla' }, (pag.filas || []).map((f) => h('div', { class: 'tut-fila' },
        h('span', { class: 'tut-que' }, f.que), h('code', {}, f.donde),
        h('button', { type: 'button', class: 'boton chico', onclick: () => abrirPersonalizable(f.clave) }, 'Abrir'))))]
    : (pag.secciones || []).map((s) => h('section', { class: 'tut-seccion' }, h('b', {}, s.titulo), h('p', {}, rellenarEjemplo(s.texto, datos))));
  t.tarjeta.classList.add('tut-pagina');
  t.tarjeta.append(h('span', { class: 'rotulo' }, 'Tutorial'), h('h3', {}, pag.titulo), h('div', { class: 'tut-pagina-cuerpo' }, contenido),
    h('div', { class: 'tut-acc' }, botonesGuia(indice, datos).filter((b) => b.id !== 'tut-' + (cual === 'ia' ? 'ia' : 'personalizar')), h('span', { class: 'relleno' }),
      h('button', { type: 'button', class: 'boton chico brasa-boton', onclick: cerrarTutorial }, 'Listo')));
}

$('#tutorial').addEventListener('click', abrirTutorial);
