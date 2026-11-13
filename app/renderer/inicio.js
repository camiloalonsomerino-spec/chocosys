// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Inicio (sprint 3, 20-10-2026): la «bandeja de hoy» en una pestaña fija. Arriba lo que te necesita y los flujos que
// corren; al medio lo que el CRM marca para hoy; abajo los entornos (Empresa, Consultora…) para abrir cada uno.
// Usa las utilidades de app.js (h, $, ronda, sesion, flujo, espacio, metaFlujo, cambiarModo, cambiarEspacio…).

const inicioEstado = { hoy: [], entornos: [], abiertosPor: {}, modoCrm: '', cargando: false, cargado: false };

async function inicioCargar() {
  if (inicioEstado.cargando) return;
  inicioEstado.cargando = true;
  try {
    inicioEstado.entornos = await api.entornos();
    if (api.crm) {
      inicioEstado.hoy = await api.crm.hoy({});
      const negocios = await api.crm.negocios({});
      inicioEstado.abiertosPor = {};
      for (const n of negocios) if (n.etapa_tipo === 'abierta') inicioEstado.abiertosPor[n.entorno || '—'] = (inicioEstado.abiertosPor[n.entorno || '—'] || 0) + 1;
      inicioEstado.modoCrm = (await api.crm.resumen()).modo;
    }
  } catch (err) { /* sin CRM o sin entornos: el Inicio muestra lo demás */ }
  inicioEstado.cargando = false;
  inicioEstado.cargado = true;
  pintarInicio();
}

// Salir del Inicio hacia una pestaña (y opcionalmente una vista).
function irA(espacioId, vista) {
  cambiarModo(vista || modoPrevio || 'lienzo');
  if (espacioId) cambiarEspacio(espacioId);
}

async function abrirEntornoDesdeInicio(nombre) {
  const id = await api.abrirEntorno(nombre);
  if (id) irA(id);
}

function pintarInicio() {
  const cont = $('#vista-inicio');
  cont.hidden = modo !== 'inicio' || !!maxima;
  if (cont.hidden) return;
  if (!inicioEstado.cargado) { inicioCargar(); }
  const d = new Date();
  const fecha = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;

  // Te necesitan: puertas primero, después sesiones (todas las pestañas).
  const necesitan = ronda(true).map((id) => {
    // Un veredicto de la sala que espera «Dejar como nota en el negocio» (sprint 7).
    if (esVeredicto(id)) {
      const f = flujo(id.slice(2));
      if (!f) return null;
      return h('button', { type: 'button', class: 'in-fila n-puerta', onclick: () => seleccionar(id) },
        h('span', { class: 'in-tipo' }, 'Veredicto'), h('span', { class: 'in-nom' }, 'Dejar como nota en «' + (f.sala.negocio || 'el negocio') + '»'), h('span', { class: 'in-sub' }, f.nombre + ' · ' + ((espacio(f.espacio) || {}).nombre || '')));
    }
    if (esPuerta(id)) {
      const f = flujo(id.slice(2));
      if (!f) return null;
      const p = f.items[f.actual];
      return h('button', { type: 'button', class: 'in-fila n-puerta', onclick: () => { irA(f.espacio, 'lienzo'); seleccionar(id); } },
        h('span', { class: 'in-tipo' }, 'Puerta'), h('span', { class: 'in-nom' }, p ? p.nombre : 'Puerta'), h('span', { class: 'in-sub' }, f.nombre + ' · ' + ((espacio(f.espacio) || {}).nombre || '')));
    }
    const s = sesion(id);
    if (!s) return null;
    return h('button', { type: 'button', class: 'in-fila n-sesion', onclick: () => { irA(s.espacio, 'lienzo'); seleccionar(s.id); } },
      h('span', { class: 'in-tipo' }, 'Sesión'), h('span', { class: 'in-nom' }, s.nombre), h('span', { class: 'in-sub' }, (s.mensaje || 'te necesita') + ' · ' + ((espacio(s.espacio) || {}).nombre || '')));
  }).filter(Boolean);

  // Flujos que no han terminado, con su avance.
  const corriendo = flujos.filter((f) => f.estado !== 'completo').map((f) => {
    const etapas = f.items.filter((it) => it.tipo === 'etapa');
    const listas = etapas.filter((it) => it.estado === 'listo').length;
    return h('button', { type: 'button', class: 'in-fila', onclick: () => irA(f.espacio, 'flujo') },
      h('span', { class: 'in-tipo' }, f.simulacro ? 'Simulacro' : 'Flujo'), h('span', { class: 'in-nom' }, f.nombre),
      h('span', { class: 'in-sub' }, metaFlujo(f) + ' · ' + ((espacio(f.espacio) || {}).nombre || '')),
      h('span', { class: 'in-avance', 'aria-label': `${listas} de ${etapas.length} etapas` }, h('i', { style: `width:${etapas.length ? (listas / etapas.length) * 100 : 0}%` })));
  });

  // Lo que el CRM marca para hoy.
  const crmHoy = inicioEstado.hoy.map((t) => h('button', { type: 'button', class: 'in-fila n-' + t.nivel, onclick: async () => {
    const n = t.negocio_id ? await api.crm.negocio(t.negocio_id) : null;
    const esp = n && n.entorno ? espacios.find((x) => x.nombre.toLowerCase() === n.entorno.toLowerCase()) : null;
    irA(esp ? esp.id : null, 'crm');
    if (t.negocio_id) cargarDiferido('crm').then(() => crmAbrir(t.negocio_id));
  } }, h('span', { class: 'in-tipo' }, t.regla), h('span', { class: 'in-nom' }, t.negocio || 'sin negocio'), h('span', { class: 'in-sub' }, t.detalle)));

  // Los entornos, con lo que tiene cada uno.
  const nombresEntorno = new Set(inicioEstado.entornos.map((e) => e.nombre.toLowerCase()));
  const tarjetaEntorno = (e) => {
    const esp = espacios.find((x) => x.nombre.toLowerCase() === e.nombre.toLowerCase());
    const ses = esp ? sesiones.filter((s) => s.espacio === esp.id) : [];
    const fl = esp ? flujos.filter((f) => f.espacio === esp.id && f.estado !== 'completo') : [];
    const pide = esp && (ses.some((s) => s.estado === 'necesita') || fl.some((f) => f.estado === 'puerta' && !f.simulacro));
    const abiertos = inicioEstado.abiertosPor[e.nombre] || 0;
    return h('button', { type: 'button', class: 'in-entorno' + (pide ? ' pide' : ''), title: e.carpeta || 'Sin carpeta', onclick: () => abrirEntornoDesdeInicio(e.nombre) },
      h('span', { class: 'in-entorno-n' }, e.nombre),
      h('span', { class: 'in-entorno-d' }, [ses.length ? `${ses.length} ${ses.length === 1 ? 'sesión' : 'sesiones'}` : null, fl.length ? `${fl.length} ${fl.length === 1 ? 'flujo' : 'flujos'}` : null,
        abiertos ? `${abiertos} ${abiertos === 1 ? 'negocio' : 'negocios'}` : null].filter(Boolean).join(' · ') || (esp ? 'sin nada abierto' : 'abrir')),
      e.existe ? null : h('span', { class: 'in-entorno-falta' }, 'la carpeta no está'));
  };
  const otras = espacios.filter((x) => !nombresEntorno.has(x.nombre.toLowerCase()));

  const seccion = (titulo, cuenta, contenido, vacio) => h('section', { class: 'in-seccion' },
    h('div', { class: 'in-t' }, h('span', { class: 'rotulo' }, titulo), cuenta !== null ? h('span', { class: 'cuenta' }, String(cuenta)) : null),
    contenido.length ? h('div', { class: 'in-lista' }, contenido) : h('p', { class: 'crm-nada' }, vacio));

  cont.replaceChildren(
    h('header', { class: 'in-cabeza' }, h('h1', { class: 'titulo-mano' }, 'Inicio'), h('span', { class: 'in-fecha' }, fecha),
      inicioEstado.modoCrm === 'prueba' ? h('span', { class: 'crm-modo' }, 'CRM con datos de prueba') : null),
    h('div', { class: 'in-grilla' },
      seccion('Te necesitan', necesitan.length, necesitan, 'Nadie te necesita ahora.'),
      seccion('Flujos corriendo', corriendo.length, corriendo, 'No hay flujos corriendo.'),
      seccion('Requiere atención hoy · CRM', inicioEstado.hoy.length, crmHoy, 'Nada pendiente según las reglas del CRM.')),
    h('section', { class: 'in-seccion' },
      h('div', { class: 'in-t' }, h('span', { class: 'rotulo' }, 'Proyectos')),
      inicioEstado.entornos.length
        ? h('div', { class: 'in-entornos' }, inicioEstado.entornos.map(tarjetaEntorno))
        : h('p', { class: 'crm-nada' }, 'Sin entornos configurados: se definen en entornos.json, junto al estado de la app.'),
      otras.length ? h('div', { class: 'in-otras' }, h('span', { class: 'in-sub' }, 'Otras pestañas:'), otras.map((x) => h('button', { type: 'button', class: 'boton chico', onclick: () => irA(x.id) }, x.nombre))) : null));
}

if (api.crm) api.crm.alCambiar(() => { inicioEstado.cargado = false; if (modo === 'inicio') inicioCargar(); });
