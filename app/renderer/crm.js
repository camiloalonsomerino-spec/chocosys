// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Vista CRM (sprints 3 y 4, 20-10-2026): el embudo de negocios por etapa, lo que requiere atención hoy, la ficha de
// cada negocio (actividades, requisitos de la etapa, documentos e historial) y «Configurar» (cuestionario →
// plantilla recomendada). Usa las utilidades de app.js (h, $, aviso, modo, actual, espacio, maxima).
// Escribir desde acá firma como quien usa la app; el historial guarda cada cambio.
//
// Sprint 4: la vista se redibuja solo cuando cambian sus datos (antes se rehacía con cada evento de cualquier sesión
// y el desplazamiento del embudo saltaba: «se ve muy lagueado, se sincroniza mal»), conserva el desplazamiento y lo
// que se está escribiendo, y la rueda mueve el embudo hacia el lado con suavidad.

const crmEstado = { resumen: null, negocios: [], hoy: [], sel: null, ficha: null, todos: false, nuevo: false, cargando: false,
  embudoVer: null, embudoPor: {}, entorno: null, firma: null, config: null, mapa: false, proyectoNuevo: false };

async function crmCargar() {
  if (crmEstado.cargando) { crmEstado.otraVez = true; return; }
  crmEstado.cargando = true;
  try {
    const e = espacio(actual);
    const todos = await api.crm.negocios({});
    // Una pestaña es un entorno del CRM si tiene negocios o si es uno de los entornos de entornos.json.
    crmEstado.entornosLista = await api.entornos().then((l) => l || []).catch(() => []);
    const conocidos = crmEstado.entornosLista.map((x) => x.nombre);
    const entorno = !crmEstado.todos && e && (todos.some((n) => n.entorno === e.nombre) || conocidos.includes(e.nombre)) ? e.nombre : null;
    crmEstado.entorno = entorno;
    crmEstado.resumen = await api.crm.resumen(entorno);
    // Cada pestaña recuerda el embudo que se eligió en ella (sprint 6: una empresa tiene Trabajos y Encargos); si no se
    // eligió ninguno, el de la pestaña.
    const elegido = crmEstado.embudoPor[entorno || '*'];
    crmEstado.embudoVer = elegido && crmEstado.resumen.embudos.includes(elegido) ? elegido : crmEstado.resumen.embudo;
    crmEstado.negocios = todos.filter((n) => (!entorno || n.entorno === entorno) && n.embudo === crmEstado.embudoVer);
    crmEstado.hoy = await api.crm.hoy(entorno ? { entorno } : {});
    crmEstado.ficha = crmEstado.sel ? await api.crm.negocio(crmEstado.sel) : null;
  } catch (err) {
    aviso('No se pudo leer el CRM: ' + (err && err.message ? err.message : err));
  } finally {
    crmEstado.cargando = false;
  }
  pintarCrm();
  if (crmEstado.otraVez) { crmEstado.otraVez = false; crmCargar(); }
}

// Sprint 20 (H2, 22-10-2026): en la ficha, junto al entorno del negocio, «Abrir en Obsidian» abre el index.md de ese
// entorno. Solo si el entorno tiene guía dentro de una bóveda (`obsidian` no vacío); si no, no hay botón.
function botonObsidianNegocio(n) {
  const ent = n.entorno && (crmEstado.entornosLista || []).find((x) => x.nombre.toLowerCase() === String(n.entorno).toLowerCase());
  if (!ent || !ent.obsidian) return null;
  return h('button', { type: 'button', class: 'boton chico crm-obs', id: 'crm-f-obsidian', title: ent.guia + (ent.log ? '\nRegistro: ' + ent.log : ''), onclick: async () => {
    const r = await api.abrirObsidian(ent.nombre).catch((err) => ({ ok: false, error: err.message }));
    if (!r || !r.ok) aviso('No se abrió Obsidian: ' + ((r && r.error) || 'sin respuesta'));
    else if (r.prueba) aviso('Chocosys de prueba: no se abre. ' + r.url);
  } }, 'Abrir en Obsidian');
}

const plata = (monto, moneda) => (monto === null || monto === undefined ? '' : (moneda === 'USD' ? 'USD ' + Number(monto).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : moneda === 'UF' ? 'UF ' + Number(monto).toLocaleString('es-CL', { maximumFractionDigits: 2 }) : '$' + Math.round(monto).toLocaleString('es-CL')));
const etapasVisibles = () => (crmEstado.resumen ? crmEstado.resumen.todasEtapas.filter((e) => e.embudo === crmEstado.embudoVer) : []);

// Sprint 26 (H3, 22-10-2026): sumas del tablero. Se calculan con las mismas filas que se pintan (cada negocio ya trae su
// `ponderado` desde crm.js, que lo calcula al leer), así lo que suma la columna es lo que se ve en ella. Las monedas no
// se suman entre sí (D4); un negocio sin monto no suma (D5); uno sin probabilidad suma el monto y no pondera (D9).
// Con un crm.js de antes del sprint (sin `ponderado`), todo cae en «sin %» y el tablero sigue funcionando.
const ORDEN_MONEDAS = ['CLP', 'UF', 'USD'];
function sumasPorMoneda(lista) {
  const m = {};
  let sinPct = 0, sinMonto = 0;
  for (const n of lista) {
    if (n.monto === null || n.monto === undefined) { sinMonto++; continue; }
    const k = n.moneda || 'CLP';
    const x = m[k] || (m[k] = { monto: 0, ponderado: 0, conPct: 0 });
    x.monto += n.monto;
    if (n.ponderado === null || n.ponderado === undefined) sinPct++;
    else { x.ponderado += n.ponderado; x.conPct++; }
  }
  const lugar = (k) => (ORDEN_MONEDAS.includes(k) ? ORDEN_MONEDAS.indexOf(k) : ORDEN_MONEDAS.length);
  const monedas = Object.keys(m).sort((a, b) => lugar(a) - lugar(b)).map((k) => ({ moneda: k, ...m[k] }));
  return { monedas, sinPct, sinMonto };
}
const enMonedas = (monedas, campo) => monedas.map((x) => plata(x[campo], x.moneda)).join(' · ');

// Bajo el nombre de la columna: una línea por moneda con el monto y, en las abiertas, el ponderado.
function sumaColumna(e, deEtapa) {
  const s = sumasPorMoneda(deEtapa);
  if (!s.monedas.length) return null;
  const abierta = e.tipo === 'abierta';
  const notas = [abierta && s.sinPct ? (s.sinPct === deEtapa.length - s.sinMonto ? 'sin %' : `${s.sinPct} sin %`) : null,
    s.sinMonto ? `${s.sinMonto} sin monto` : null].filter(Boolean);
  return h('div', { class: 'crm-col-suma' },
    s.monedas.map((x) => h('div', { class: 'crm-col-linea' },
      h('span', { title: 'Suma del monto esperado' }, plata(x.monto, x.moneda)),
      abierta && x.conPct ? h('span', { class: 'crm-col-pond', title: 'Ponderado: monto × probabilidad de cada negocio' }, 'pond. ' + plata(x.ponderado, x.moneda)) : null)),
    notas.length ? h('div', { class: 'crm-col-nota', title: 'Sin probabilidad no pondera; sin monto no suma' }, notas.join(' · ')) : null);
}

// Arriba del embudo: lo que falta cerrar (ponderado de las etapas abiertas, D6) y, aparte, lo ganado.
function pronosticoTablero() {
  const etapaDe = new Map(etapasVisibles().map((e) => [e.id, e]));
  const de = (tipo) => crmEstado.negocios.filter((n) => (etapaDe.get(n.etapa_id) || {}).tipo === tipo);
  const abiertas = sumasPorMoneda(de('abierta'));
  const ganadas = sumasPorMoneda(de('ganada'));
  if (!abiertas.monedas.length && !ganadas.monedas.length) return null;
  const conPond = abiertas.monedas.filter((x) => x.conPct);
  return h('section', { class: 'crm-pronostico', 'aria-label': 'Pronóstico del embudo' },
    h('div', { class: 'crm-pron-bloque' },
      h('span', { class: 'rotulo' }, 'Por cerrar, ponderado'),
      h('span', { class: 'crm-pron-cifra' }, conPond.length ? enMonedas(conPond, 'ponderado') : 'sin %'),
      abiertas.monedas.length ? h('span', { class: 'crm-pron-det' }, 'de ' + enMonedas(abiertas.monedas, 'monto') + ' en etapas abiertas'
        + (abiertas.sinPct ? ` · ${abiertas.sinPct} sin %` : '')) : null),
    h('div', { class: 'crm-pron-bloque' },
      h('span', { class: 'rotulo' }, 'Ganado'),
      h('span', { class: 'crm-pron-cifra' }, ganadas.monedas.length ? enMonedas(ganadas.monedas, 'monto') : '$0')));
}

// Lo que se ve; si no cambió, no se redibuja.
function firmaCrm() {
  return JSON.stringify([crmEstado.resumen && [crmEstado.resumen.crm, crmEstado.resumen.crms, crmEstado.resumen.modo, crmEstado.resumen.embudo, crmEstado.resumen.todasEtapas.length, crmEstado.resumen.empresas.length,
    crmEstado.resumen.proyectos, crmEstado.resumen.carpetas],
    crmEstado.embudoVer, crmEstado.entorno, crmEstado.todos, crmEstado.nuevo, crmEstado.mapa, crmEstado.proyectoNuevo, crmEstado.salaForm, crmEstado.negocios, crmEstado.hoy, crmEstado.ficha,
    crmEstado.config && [crmEstado.config.nuevo, crmEstado.config.respuestas, crmEstado.config.recomendacion, crmEstado.config.paso]]);
}

function pintarCrm() {
  const cont = $('#vista-crm');
  cont.hidden = modo !== 'crm' || !!maxima;
  if (cont.hidden) { crmEstado.firma = null; return; }
  if (!crmEstado.resumen) { if (!cont.children.length) cont.replaceChildren(h('p', { class: 'kb-vacio' }, 'Cargando el CRM…')); crmCargar(); return; }
  const firma = firmaCrm();
  if (firma === crmEstado.firma && cont.children.length) return;
  crmEstado.firma = firma;

  // Guardar lo que no debe perderse al redibujar: desplazamientos, lo escrito y el foco.
  const embudo0 = cont.querySelector('.crm-embudo');
  const ficha0 = cont.querySelector('.crm-ficha');
  const guardado = { vy: cont.scrollTop, ex: embudo0 ? embudo0.scrollLeft : 0, fy: ficha0 ? ficha0.scrollTop : 0, campos: {}, foco: document.activeElement && cont.contains(document.activeElement) ? document.activeElement.id : null };
  cont.querySelectorAll('input[id], select[id], textarea[id]').forEach((x) => { if (x.type !== 'checkbox' && x.type !== 'radio') guardado.campos[x.id] = x.value; });

  const r = crmEstado.resumen;
  // Lista lateral de CRM (uno por proyecto o empresa) con «+ Agregar CRM» al final.
  const lado = h('nav', { class: 'crm-lado', 'aria-label': 'CRM' },
    h('span', { class: 'rotulo' }, 'CRMs'),
    (r.crms || []).map((x) => h('button', { type: 'button', class: 'crm-lado-item' + (x === r.crm && !(crmEstado.config && crmEstado.config.nuevo) ? ' activo' : ''), title: 'Abrir el CRM «' + x + '»', onclick: async () => {
      crmEstado.config = null;
      if (x !== r.crm) { await api.crm.elegir(x); crmEstado.sel = null; crmEstado.ficha = null; crmEstado.resumen = null; }
      crmEstado.firma = null; crmCargar();
    } }, x, x === (r.crms || [])[0] ? h('span', { class: 'crm-lado-sub' }, r.modo === 'prueba' ? 'principal · prueba' : 'principal') : null)),
    h('button', { type: 'button', class: 'crm-lado-item agregar' + (crmEstado.config && crmEstado.config.nuevo ? ' activo' : ''), onclick: () => abrirConfigurar(true) }, '+ Agregar CRM'));
  const cabeza = h('header', { class: 'crm-cabeza' },
    h('h2', {}, 'Negocios', crmEstado.entorno ? h('em', {}, ' · ' + crmEstado.entorno) : h('em', {}, ' · todos los entornos')),
    h('span', { class: 'crm-embudo-nombre', title: r.plantilla ? 'Plantilla: ' + r.plantilla : '' }, 'embudo ' + crmEstado.embudoVer),
    r.modo === 'prueba' ? h('span', { class: 'crm-modo', title: 'No hay base real: son datos ficticios para probar' }, 'datos de prueba') : null,
    crmEstado.entorno || crmEstado.todos ? h('button', { type: 'button', class: 'boton chico', onclick: () => { crmEstado.todos = !crmEstado.todos; crmCargar(); } }, crmEstado.todos ? 'Solo esta pestaña' : 'Ver todos') : null,
    r.embudos.length > 1 ? h('span', { class: 'crm-embudos' }, r.embudos.map((x) => h('button', { type: 'button', class: 'boton chico' + (x === crmEstado.embudoVer ? ' activo' : ''), onclick: () => { elegirEmbudo(x); crmEstado.firma = null; crmCargarSinEntorno(); } }, x))) : null,
    h('span', { class: 'relleno' }),
    h('button', { type: 'button', id: 'crm-b-config', class: 'boton chico', onclick: () => abrirConfigurar(false), title: 'Cuestionario del negocio → plantilla de embudo recomendada para este CRM; y dónde nacen las carpetas' }, 'Configurar'),
    h('button', { type: 'button', id: 'crm-b-ia', class: 'boton chico', title: 'Abre el asistente de CRM (Claude) en chico; con su botón de agrandar pasa a pantalla completa', onclick: () => impulsarConIA() }, 'Impulsar con IA'),
    h('button', { type: 'button', id: 'crm-b-mapa', class: 'boton chico' + (crmEstado.mapa ? ' activo' : ''), title: 'Qué dato va con qué, y cómo se llama cada cosa en HubSpot, Pipedrive y Odoo', onclick: () => { crmEstado.mapa = !crmEstado.mapa; pintarCrm(); } }, 'Mapa de datos'),
    h('button', { type: 'button', id: 'crm-b-proyecto', class: 'boton chico', title: 'Un proyecto grande agrupa encargos y negocios que comparten papelería, imágenes y marca, con su carpeta', onclick: () => { crmEstado.proyectoNuevo = !crmEstado.proyectoNuevo; crmEstado.nuevo = false; pintarCrm(); } }, crmEstado.proyectoNuevo ? 'Cancelar' : '+ Proyecto'),
    h('button', { type: 'button', id: 'crm-b-solicitud', class: 'boton chico brasa-boton', title: 'Lo que te piden, de un cliente o del mismo negocio: entra en la primera etapa y, si se puede, nace con su carpeta', onclick: () => { crmEstado.nuevo = !crmEstado.nuevo; crmEstado.proyectoNuevo = false; pintarCrm(); } }, crmEstado.nuevo ? 'Cancelar' : '+ Solicitud'),
    h('span', { class: 'crm-exportar' }, 'Exportar CSV:', ['negocios', 'empresas', 'contactos', 'actividades'].map((o) =>
      h('button', { type: 'button', class: 'boton chico', onclick: async () => { const p = await api.crm.exportar(o); if (p) aviso('Exportado: ' + p); } }, o))));

  const hoyLista = h('section', { class: 'crm-hoy' },
    h('div', { class: 'crm-hoy-t' }, h('span', { class: 'rotulo' }, 'Requiere atención hoy'), h('span', { class: 'cuenta' }, String(crmEstado.hoy.length))),
    crmEstado.hoy.length
      ? h('div', { class: 'crm-hoy-lista' }, crmEstado.hoy.map((t) => h('button', { type: 'button', class: 'crm-tarjeta-hoy n-' + t.nivel, onclick: () => crmAbrir(t.negocio_id) },
        h('span', { class: 'crm-regla' }, t.regla), h('span', { class: 'crm-hoy-neg' }, t.negocio || 'sin negocio'), h('span', { class: 'crm-hoy-det' }, t.detalle))))
      : h('p', { class: 'crm-nada' }, 'Nada pendiente según las reglas.'));

  const columnas = etapasVisibles().map((e) => {
    const deEtapa = crmEstado.negocios.filter((n) => n.etapa_id === e.id);
    const col = h('div', { class: 'crm-col' + (e.tipo !== 'abierta' ? ' cerrada' : ''), 'data-etapa': e.nombre },
      h('div', { class: 'crm-col-t' }, h('span', {}, e.nombre,
        e.tipo === 'abierta' && e.probabilidad !== null && e.probabilidad !== undefined ? h('span', { class: 'crm-col-pct', title: 'Probabilidad de la etapa' }, e.probabilidad + ' %') : null),
        h('span', { class: 'cuenta' }, String(deEtapa.length))),
      sumaColumna(e, deEtapa),
      deEtapa.map((n) => {
        const card = h('button', { type: 'button', class: 'crm-card' + (n.id === crmEstado.sel ? ' sel' : ''), draggable: 'true', onclick: () => crmAbrir(n.id) },
          h('div', { class: 'crm-card-n' }, n.nombre),
          n.empresa ? h('div', { class: 'crm-card-e' }, n.empresa + (n.empresa_tipo === 'interno' ? ' · interno' : '')) : null,
          n.proyecto || n.tipo ? h('div', { class: 'crm-card-d' }, [n.proyecto ? '◆ ' + n.proyecto : null, n.tipo].filter(Boolean).join(' · ')) : null,
          n.monto !== null && n.monto !== undefined ? h('div', { class: 'crm-card-m' }, plata(n.monto, n.moneda),
            n.etapa_tipo === 'abierta' && n.probabilidad !== null && n.probabilidad !== undefined
              ? h('span', { class: 'crm-card-pct' + (n.probabilidad_pisada !== null && n.probabilidad_pisada !== undefined ? ' pisada' : ''),
                title: n.probabilidad_pisada !== null && n.probabilidad_pisada !== undefined ? 'Puesta a mano en la ficha (la etapa dice ' + (n.etapa_probabilidad ?? 'nada') + ' %)' : 'La de la etapa' }, n.probabilidad + ' %')
              : null) : null,
          h('div', { class: 'crm-card-p' + (n.proxima ? '' : ' falta') }, n.proxima ? '→ ' + n.proxima : 'sin próxima acción'),
          n.documentos ? h('div', { class: 'crm-card-d' }, `${n.documentos} ${n.documentos === 1 ? 'documento' : 'documentos'}`) : null);
        card.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', String(n.id)); card.classList.add('arrastrando'); });
        card.addEventListener('dragend', () => card.classList.remove('arrastrando'));
        return card;
      }));
    col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('destino'); });
    col.addEventListener('dragleave', () => col.classList.remove('destino'));
    col.addEventListener('drop', async (ev) => {
      ev.preventDefault(); col.classList.remove('destino');
      const id = Number(ev.dataTransfer.getData('text/plain'));
      const n = crmEstado.negocios.find((x) => x.id === id);
      if (!n || n.etapa === e.nombre) return;
      await moverConAviso(n, e.nombre);
    });
    return col;
  });
  const embudoEl = h('div', { class: 'crm-embudo' }, columnas);
  ruedaHorizontal(embudoEl);

  const principal = crmEstado.config && crmEstado.config.nuevo
    ? h('div', { class: 'crm-principal' }, panelConfigurar())
    : h('div', { class: 'crm-principal' }, cabeza, crmEstado.config ? panelConfigurar() : null, crmEstado.mapa ? panelMapa(r) : null,
      crmEstado.proyectoNuevo ? formProyecto(r) : null, crmEstado.nuevo ? formSolicitud(r) : null, hoyLista,
      pronosticoTablero(),
      h('div', { class: 'crm-cuerpo' }, embudoEl, crmEstado.ficha ? fichaNegocio(crmEstado.ficha, r) : null));
  cont.replaceChildren(lado, principal);

  // Devolver lo guardado. Los campos de la ficha (crm-f-, crm-a-, crm-d-) solo si sigue abierto el mismo negocio: si no,
  // la etapa de la ficha anterior quedaba puesta en la nueva (sprint 6: Fittings, en Ganado, mostraba «Terreno»).
  const mismaFicha = cont.dataset.sel === String(crmEstado.sel);
  cont.dataset.sel = String(crmEstado.sel);
  for (const [id, v] of Object.entries(guardado.campos)) {
    if (!mismaFicha && /^crm-[fad]-/.test(id)) continue;
    const x = document.getElementById(id); if (x && cont.contains(x) && x.value !== v) x.value = v;
  }
  cont.scrollTop = guardado.vy;
  embudoEl.scrollLeft = guardado.ex;
  const ficha1 = cont.querySelector('.crm-ficha'); if (ficha1) ficha1.scrollTop = guardado.fy;
  if (guardado.foco) { const x = document.getElementById(guardado.foco); if (x) x.focus({ preventScroll: true }); }
}

function elegirEmbudo(x, entorno) {
  crmEstado.embudoVer = x;
  crmEstado.embudoPor[(entorno === undefined ? crmEstado.entorno : entorno) || '*'] = x;
}
async function crmCargarSinEntorno() {
  const todos = await api.crm.negocios({});
  crmEstado.negocios = todos.filter((n) => (!crmEstado.entorno || n.entorno === crmEstado.entorno) && n.embudo === crmEstado.embudoVer);
  pintarCrm();
}

async function moverConAviso(n, etapa) {
  const faltaba = await api.crm.mover(n.id, etapa);
  aviso(faltaba && faltaba.length ? `«${n.nombre}» pasó a ${etapa}. Le falta: ${faltaba.join(' · ')} (quedó anotado en el historial).` : `«${n.nombre}» pasó a ${etapa}.`);
}

// La rueda vertical mueve el embudo hacia el lado con inercia suave, mientras haya columnas hacia ese lado; en el
// borde, la rueda vuelve a bajar la página. Con Shift o con un panel táctil (deltaX) se deja al navegador.
function ruedaHorizontal(el) {
  let objetivo = null;
  let cuadro = 0;
  let ultimo = 0;
  const correr = () => {
    ultimo = performance.now();
    const paso = (objetivo - el.scrollLeft) * 0.22;
    if (Math.abs(paso) < 0.5) { el.scrollLeft = objetivo; objetivo = null; cuadro = 0; return; }
    el.scrollLeft += paso;
    cuadro = requestAnimationFrame(correr);
  };
  // Si alguien arrastra la barra a mano, el destino guardado ya no vale.
  el.addEventListener('pointerdown', () => { if (cuadro) cancelAnimationFrame(cuadro); cuadro = 0; objetivo = null; });
  el.addEventListener('wheel', (ev) => {
    if (ev.shiftKey || ev.ctrlKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    // Una animación que no avanzó (ventana oculta: Chromium pausa los cuadros) no deja un destino viejo.
    if (cuadro && performance.now() - ultimo > 250) { cancelAnimationFrame(cuadro); cuadro = 0; objetivo = null; }
    const base = objetivo === null ? el.scrollLeft : objetivo;
    if ((ev.deltaY < 0 && base <= 0) || (ev.deltaY > 0 && base >= max)) return;
    ev.preventDefault();
    objetivo = Math.max(0, Math.min(max, base + ev.deltaY * 1.2));
    if (!cuadro) { ultimo = performance.now(); cuadro = requestAnimationFrame(correr); }
  }, { passive: false });
}

function campo(etiqueta, control) { return h('label', { class: 'crm-campo' }, h('span', {}, etiqueta), control); }

// La solicitud (sprint 6): lo que te piden, de un cliente o del mismo negocio (interno). Entra en la primera etapa de
// su embudo con su contacto, lo pedido y la tarea de responderla; si el CRM sabe dónde, nace con su carpeta (dentro de
// su proyecto o en el área de su tipo). Es de la app: sirve igual para cualquier CRM.
function formSolicitud(r) {
  const entorno = crmEstado.entorno || (espacio(actual) || {}).nombre || null;
  const nombre = h('input', { id: 'crm-s-nombre', placeholder: 'Qué piden, corto: «Sitio web nuevo», «Logo y tarjetas»', required: true });
  const embudo = h('select', { id: 'crm-s-embudo' }, r.embudos.map((x) => h('option', { value: x, selected: x === crmEstado.embudoVer }, x)));
  const tipo = h('select', { id: 'crm-s-tipo' });
  const proyecto = h('select', { id: 'crm-s-proyecto' }, h('option', { value: '' }, '— sin proyecto —'), (r.proyectos || []).filter((p) => p.estado === 'activo').map((p) => h('option', { value: p.id }, p.nombre)));
  const empresa = h('select', { id: 'crm-s-empresa' }, h('option', { value: '' }, '— sin cliente —'), h('option', { value: 'interno' }, `Interno (${r.crm})`),
    r.empresas.filter((e) => e.tipo !== 'proveedor' && e.tipo !== 'interno').map((e) => h('option', { value: e.id }, e.nombre)), h('option', { value: 'nueva' }, '+ cliente nuevo…'));
  const empresaNueva = h('input', { id: 'crm-s-empresa-nueva', placeholder: 'Nombre del cliente nuevo', hidden: true });
  const contacto = h('input', { id: 'crm-s-contacto', placeholder: 'Quién lo pide' });
  const correo = h('input', { id: 'crm-s-correo', type: 'email', placeholder: 'correo (opcional)' });
  const telefono = h('input', { id: 'crm-s-telefono', placeholder: 'teléfono (opcional)' });
  const detalle = h('textarea', { id: 'crm-s-detalle', rows: 3, placeholder: 'Lo que pidieron, con sus palabras. Queda en la ficha y en el TRABAJO.md.' });
  const cuando = h('input', { id: 'crm-s-cuando', type: 'date', 'aria-label': 'Para cuándo' });
  const toma = h('input', { id: 'crm-s-toma', placeholder: 'Quién la toma', list: 'crm-s-responsables' });
  const origen = h('select', { id: 'crm-s-origen' }, h('option', { value: '' }, '— por dónde llegó —'), (r.origenes || []).map((o) => h('option', { value: o }, o)));
  const monto = h('input', { id: 'crm-s-monto', type: 'number', step: 'any', placeholder: 'opcional' });
  const moneda = h('select', { id: 'crm-s-moneda' }, h('option', { value: 'CLP' }, 'CLP'), h('option', { value: 'USD' }, 'USD'), h('option', { value: 'UF' }, 'UF'));
  const conCarpeta = h('input', { type: 'checkbox', id: 'crm-s-carpeta', checked: true });
  const adjuntar = h('input', { type: 'checkbox', id: 'crm-s-adjuntar' });
  const destino = h('span', { class: 'crm-nada crm-s-destino' });
  // Dónde nacería la carpeta, para que se vea antes de crear.
  const dondeVa = () => {
    const p = (r.proyectos || []).find((x) => String(x.id) === proyecto.value);
    const raices = (r.carpetas && r.carpetas.raices[embudo.value]) || {};
    const ruta = p && p.carpeta ? p.carpeta + '\\encargos' : raices[tipo.value] || raices['*'] || null;
    conCarpeta.disabled = !ruta;
    destino.textContent = ruta ? 'Nace en ' + ruta : 'Este embudo no sabe dónde crear carpetas (Configurar → Carpetas).';
  };
  const llenarTipos = () => {
    const tipos = (r.carpetas && r.carpetas.tipos[embudo.value]) || [];
    tipo.replaceChildren(h('option', { value: '' }, tipos.length ? '— tipo —' : 'sin tipos'), tipos.map((t) => h('option', { value: t }, t)));
    tipo.disabled = !tipos.length;
    dondeVa();
  };
  embudo.addEventListener('change', llenarTipos);
  tipo.addEventListener('change', dondeVa);
  proyecto.addEventListener('change', dondeVa);
  empresa.addEventListener('change', () => { empresaNueva.hidden = empresa.value !== 'nueva'; });
  llenarTipos();
  const form = h('form', { class: 'crm-form crm-solicitud' },
    h('div', { class: 'crm-form-t' }, h('b', {}, 'Nueva solicitud'), h('span', { class: 'crm-nada' }, ' Entra en la primera etapa del embudo con la tarea de responderla.')),
    campo('Qué piden', nombre),
    r.embudos.length > 1 ? campo('Embudo', embudo) : null, campo('Tipo', tipo), campo('Proyecto', proyecto),
    campo('Cliente', h('div', { class: 'crm-par' }, empresa, empresaNueva)),
    h('label', { class: 'crm-campo crm-doble' }, h('span', {}, 'Contacto'), h('div', { class: 'crm-par' }, contacto, correo, telefono)),
    h('label', { class: 'crm-campo crm-ancho' }, h('span', {}, 'Detalle'), detalle),
    campo('Para cuándo', cuando), campo('Quién la toma', h('div', {}, toma, h('datalist', { id: 'crm-s-responsables' }, (perfilUI.responsables || []).map((x) => h('option', { value: x }))))),
    campo('Origen', origen), campo('Monto esperado', h('div', { class: 'crm-par' }, monto, moneda)),
    h('div', { class: 'crm-s-pie' },
      h('label', { class: 'crm-check' }, conCarpeta, ' Crear su carpeta'), destino,
      h('label', { class: 'crm-check' }, adjuntar, ' Adjuntar lo que llegó al crear'),
      h('span', { class: 'relleno' }), h('button', { type: 'submit', class: 'boton principal' }, 'Crear solicitud')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!nombre.value.trim()) { nombre.focus(); return; }
    const d = { nombre: nombre.value.trim(), entorno, embudo: embudo.value, tipo: tipo.value || null, proyecto_id: proyecto.value ? Number(proyecto.value) : null,
      interno: empresa.value === 'interno', empresa_id: /^\d+$/.test(empresa.value) ? Number(empresa.value) : null,
      empresa_nueva: empresa.value === 'nueva' ? empresaNueva.value.trim() : null,
      contacto: contacto.value.trim() ? { nombre: contacto.value.trim(), correo: correo.value.trim() || null, telefono: telefono.value.trim() || null } : (correo.value.trim() ? { correo: correo.value.trim() } : null),
      detalle: detalle.value.trim() || null, cierre_esperado: cuando.value || null, responsable: toma.value.trim() || null, origen: origen.value || null,
      monto: monto.value === '' ? undefined : Number(monto.value), moneda: moneda.value, crear_carpeta: conCarpeta.checked && !conCarpeta.disabled };
    try {
      const res = await api.crm.solicitud(d);
      crmEstado.nuevo = false;
      crmEstado.sel = res.id;
      elegirEmbudo(embudo.value);
      elegirEmbudo(embudo.value, entorno);
      aviso(res.carpeta ? 'Solicitud creada, con su carpeta: ' + res.carpeta : 'Solicitud creada.');
      if (adjuntar.checked) await api.crm.subir(res.id, 'Lo que llegó', '01-LO-QUE-LLEGO');
      crmAbrir(res.id);
    } catch (err) { aviso(String(err && err.message || err).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
  });
  requestAnimationFrame(() => { if (!document.activeElement || !document.activeElement.closest('.crm-form')) nombre.focus(); });
  return form;
}

function formProyecto(r) {
  const nombre = h('input', { id: 'crm-p-nombre', placeholder: 'Ej.: Arriendos', required: true });
  const notas = h('input', { id: 'crm-p-notas', placeholder: 'Qué es y qué se quiere lograr (opcional)' });
  const raiz = r.carpetas && r.carpetas.raiz_proyectos;
  const form = h('form', { class: 'crm-form' },
    h('div', { class: 'crm-form-t' }, h('b', {}, 'Nuevo proyecto'), h('span', { class: 'crm-nada' }, raiz ? ` Nace en ${raiz}, con PROYECTO.md, _compartido (papelería, imágenes, marca) y encargos.` : ' Sin carpeta: falta elegir dónde nacen los proyectos (Configurar → Carpetas).')),
    campo('Proyecto', nombre), h('label', { class: 'crm-campo crm-ancho' }, h('span', {}, 'Qué es'), notas),
    h('button', { type: 'submit', class: 'boton principal' }, 'Crear proyecto'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!nombre.value.trim()) { nombre.focus(); return; }
    try {
      const p = await api.crm.proyectoNuevo({ nombre: nombre.value.trim(), notas: notas.value.trim() || null, entorno: crmEstado.entorno || (espacio(actual) || {}).nombre || null });
      crmEstado.proyectoNuevo = false;
      crmEstado.resumen = null;
      aviso(p.carpeta ? 'Proyecto creado: ' + p.carpeta : 'Proyecto creado (sin carpeta).');
      crmCargar();
    } catch (err) { aviso(String(err && err.message || err).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
  });
  requestAnimationFrame(() => nombre.focus());
  return form;
}

// Mapa de datos (sprint 6): qué va con qué, y cómo se llama cada cosa en los CRM conocidos. Sirve para entender el
// CRM de un vistazo y para que una IA que viene de otro CRM lo personalice sola.
function panelMapa(r) {
  const caja = (x, y, w, titulo, ingles, detalle, clase) => `<g class="mapa-caja ${clase || ''}"><rect x="${x}" y="${y}" width="${w}" height="54" rx="10"/>` +
    `<text x="${x + 12}" y="${y + 22}" class="mapa-t">${titulo}</text><text x="${x + w - 12}" y="${y + 22}" class="mapa-en" text-anchor="end">${ingles}</text>` +
    `<text x="${x + 12}" y="${y + 41}" class="mapa-d">${detalle}</text></g>`;
  const linea = (d) => `<path d="${d}" class="mapa-l" marker-end="url(#mapa-fl)"/>`;
  const svg = `<svg class="crm-mapa-svg" viewBox="0 0 900 300" role="img" aria-label="Mapa de datos del CRM">
    <defs><marker id="mapa-fl" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L8 4L0 8Z" class="mapa-punta"/></marker></defs>
    ${caja(10, 20, 200, 'Empresa', 'company', `cliente · interno · proveedor (${r.empresas.length})`)}
    ${caja(10, 120, 200, 'Contacto', 'contact', `personas de la empresa (${r.contactos.length})`)}
    ${caja(350, 120, 200, 'Negocio', 'deal', 'trabajo, encargo o venta', 'centro')}
    ${caja(350, 20, 200, 'Proyecto', 'project', `agrupa negocios (${(r.proyectos || []).length})`)}
    ${caja(690, 20, 200, 'Etapa del embudo', 'stage', 'requisitos y probabilidad')}
    ${caja(690, 120, 200, 'Plata', 'amount · cost', 'leída del libro y las OC')}
    ${caja(150, 226, 180, 'Actividades', 'tasks', 'la próxima acción')}
    ${caja(360, 226, 180, 'Documentos', 'files', 'en la carpeta del negocio')}
    ${caja(570, 226, 180, 'Historial', 'audit log', 'todo cambio y quién')}
    ${linea('M110 74V118')} ${linea('M210 47C290 47 290 140 348 140')} ${linea('M210 147H348')}
    ${linea('M450 74V118')} ${linea('M690 47C620 47 620 135 552 135')} ${linea('M552 150H688')}
    ${linea('M420 174C380 200 280 200 260 224')} ${linea('M450 174V224')} ${linea('M480 174C520 200 620 200 640 224')}
  </svg>`;
  const filas = [['empresa', 'Company', 'Organization', 'res.partner (empresa)'], ['contacto', 'Contact', 'Person', 'res.partner (persona)'],
    ['negocio', 'Deal', 'Deal', 'crm.lead (oportunidad)'], ['etapa', 'Deal stage', 'Stage', 'crm.stage'], ['embudo', 'Pipeline', 'Pipeline', 'crm.team (equipo de ventas)'],
    ['probabilidad', 'Deal probability', 'Probability', 'probability'], ['ponderado (monto × %)', 'Weighted amount', 'Weighted value', 'prorated_revenue'],
    ['actividad', 'Task, Call, Meeting, Note', 'Activity', 'mail.activity'], ['historial', 'Property history', 'Changelog', 'Chatter'],
    ['documento', 'Attachments', 'Files', 'ir.attachment'], ['plata (costo, venta)', 'Line items (unit cost)', 'Products (direct cost)', 'sale.order + sale_margin'],
    ['proyecto', '—', '—', 'project.project']];
  const cont = h('section', { class: 'crm-mapa' },
    h('div', { class: 'crm-config-t' }, h('h3', {}, 'Mapa de datos'), h('span', { class: 'crm-nada' }, 'Qué dato va con qué. Las flechas van del que agrupa al agrupado.'),
      h('span', { class: 'relleno' }), h('button', { type: 'button', class: 'v-boton', 'aria-label': 'Cerrar', onclick: () => { crmEstado.mapa = false; pintarCrm(); } }, '×')),
    h('div', { class: 'crm-mapa-dibujo' }),
    h('div', { class: 'crm-mapa-tabla' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Chocosys', 'HubSpot', 'Pipedrive', 'Odoo'].map((x) => h('th', {}, x)))),
      h('tbody', {}, filas.map((f) => h('tr', {}, f.map((x, i) => h(i ? 'td' : 'th', {}, x))))))),
    h('p', { class: 'crm-nada' }, 'Equivalencias del 20-10-2026 (probabilidad y ponderado, del 22-10-2026), de la documentación de cada CRM (detalle en referencias\\crm-publicos\\). Los nombres de las tablas están en crm\\ESQUEMA.md.'));
  cont.querySelector('.crm-mapa-dibujo').innerHTML = svg;
  return cont;
}

function fichaNegocio(n, r) {
  const etapa = h('select', { id: 'crm-f-etapa', 'aria-label': 'Etapa' }, r.todasEtapas.filter((e) => e.embudo === n.embudo).map((e) => h('option', { value: e.nombre, selected: e.id === n.etapa_id }, e.nombre)));
  etapa.addEventListener('change', () => moverConAviso(n, etapa.value));
  const pendientes = n.actividades.filter((a) => !a.hecha);
  const hechas = n.actividades.filter((a) => a.hecha);
  const filaAct = (a) => h('li', { class: 'crm-act' + (a.hecha ? ' hecha' : '') },
    h('input', { type: 'checkbox', id: 'crm-act-' + a.id, checked: !!a.hecha, onchange: (ev) => api.crm.actividadHecha(a.id, ev.target.checked), 'aria-label': 'Hecha' }),
    h('span', { class: 'crm-act-tipo' }, a.tipo),
    h('span', { class: 'crm-act-que' }, a.que),
    h('span', { class: 'crm-act-meta' }, [a.responsable, a.vence ? 'vence ' + a.vence.slice(8, 10) + '-' + a.vence.slice(5, 7) + '-' + a.vence.slice(0, 4) : null].filter(Boolean).join(' · ')));
  const tipo = h('select', { id: 'crm-a-tipo' }, ['tarea', 'llamada', 'correo', 'reunión', 'nota'].map((t) => h('option', { value: t }, t)));
  const que = h('input', { id: 'crm-a-que', placeholder: 'Qué hay que hacer' });
  const resp = h('input', { id: 'crm-a-resp', placeholder: 'Quién', list: 'crm-responsables' });
  const vence = h('input', { id: 'crm-a-vence', type: 'date', 'aria-label': 'Vence (opcional)' });
  const formAct = h('form', { class: 'crm-form-act' }, tipo, que, resp, vence, h('button', { type: 'submit', class: 'boton chico brasa-boton' }, 'Anotar'),
    h('datalist', { id: 'crm-responsables' }, [...new Set([...(perfilUI.responsables || []), 'cliente', 'proveedor'])].map((x) => h('option', { value: x }))));
  formAct.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!que.value.trim()) { que.focus(); return; }
    await api.crm.actividadNueva({ negocio_id: n.id, tipo: tipo.value, que: que.value.trim(), responsable: resp.value.trim() || null, vence: vence.value || null });
    que.value = ''; resp.value = ''; vence.value = '';
  });

  // Requisitos: lo de la etapa actual y lo que pide la siguiente.
  const req = n.requisitos || { actual: [], siguiente: null, tiposDocumento: [] };
  const filaReq = (x) => h('li', { class: 'crm-req' + (x.cumple ? ' ok' : ' falta') },
    h('span', { class: 'crm-req-marca', 'aria-hidden': 'true' }, x.cumple ? '✓' : '○'),
    h('span', {}, x.texto), x.como ? h('span', { class: 'crm-req-como' }, x.como) : null,
    !x.cumple && x.tipo === 'documento' ? h('button', { type: 'button', class: 'boton chico', onclick: () => subir(n, x.clave) }, 'Subir') : null);
  const bloqueReq = (titulo, items) => (items && items.length ? [h('h5', {}, titulo), h('ul', { class: 'crm-reqs' }, items.map(filaReq))] : null);
  const requisitosEl = (req.actual.length || (req.siguiente && req.siguiente.items.length))
    ? [h('h4', {}, 'Lo que pide cada etapa'), bloqueReq('En ' + n.etapa, req.actual), req.siguiente ? bloqueReq('Para pasar a ' + req.siguiente.nombre, req.siguiente.items) : null]
    : null;

  // Documentos: los subidos (con su tipo) y el botón para subir otro.
  const tipoDoc = h('select', { id: 'crm-d-tipo', 'aria-label': 'Tipo de documento' }, h('option', { value: '' }, 'Otro documento'), (req.tiposDocumento || []).map((t) => h('option', { value: t }, t)));
  const docs = n.documentosLista || [];
  const documentosEl = [h('h4', {}, 'Documentos'),
    h('div', { class: 'crm-form-act' }, tipoDoc, h('button', { type: 'button', class: 'boton chico brasa-boton', onclick: () => subir(n, tipoDoc.value) }, 'Subir…')),
    docs.length ? h('ul', { class: 'crm-docs' }, docs.map((d) => h('li', {},
      h('button', { type: 'button', class: 'crm-doc', title: d.ruta, onclick: () => api.crm.abrirDoc(n.id, d.id) }, d.nombre),
      h('span', { class: 'crm-act-meta' }, [d.tipo, d.autor, d.subido.slice(0, 10)].filter(Boolean).join(' · ')))))
      : h('p', { class: 'crm-nada' }, n.carpetaAbs ? 'Ninguno subido; los de la carpeta se reconocen por nombre.' : 'Ninguno subido.')];

  const cuando = (iso) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const carpetaEl = n.carpeta
    ? h('button', { type: 'button', class: 'boton chico', disabled: !n.carpetaAbs, title: n.carpetaAbs || 'La carpeta no está en este equipo', onclick: () => api.crm.carpeta(n.id) }, n.carpetaAbs ? 'Abrir carpeta' : 'Sin carpeta a la vista')
    : h('button', { type: 'button', class: 'boton chico', title: 'Crea la carpeta AAAA-MM_nombre con su estructura y su TRABAJO.md, donde corresponde', onclick: async () => {
      try { const ruta = await api.crm.crearCarpeta(n.id); aviso(ruta ? 'Carpeta creada: ' + ruta : 'Este negocio no tiene dónde nacer: falta su raíz (Configurar → Carpetas).'); crmAbrir(n.id); }
      catch (err) { aviso(String(err && err.message || err).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    } }, 'Crear carpeta');
  return h('aside', { class: 'crm-ficha', 'aria-label': 'Ficha del negocio' },
    h('div', { class: 'crm-ficha-t' }, h('h3', {}, n.nombre),
      h('button', { type: 'button', class: 'boton chico', id: 'crm-f-definir', title: 'El asistente te pregunta qué hay que entregar, a quién y para cuándo, y lo deja como actividades y en el TRABAJO.md. Solo si lo aprietas.', onclick: () => impulsarConIA(n.id) }, 'Definir con IA'),
      h('button', { type: 'button', class: 'boton chico' + (crmEstado.salaForm === n.id ? ' activo' : ''), id: 'crm-f-sala', title: 'Segunda opinión del directorio: asesores propios que se confrontan sobre algo de este negocio y entregan un veredicto, con la profundidad que elijas', onclick: async () => { if (crmEstado.salaForm !== n.id) await cargarDirectorio(); crmEstado.salaForm = crmEstado.salaForm === n.id ? null : n.id; crmEstado.firma = null; pintarCrm(); } }, 'Segunda opinión'),
      h('button', { type: 'button', class: 'v-boton', 'aria-label': 'Cerrar la ficha', title: 'Cerrar', onclick: () => { crmEstado.sel = null; crmEstado.ficha = null; pintarCrm(); } }, '×')),
    crmEstado.salaForm === n.id ? formSala(n) : null,
    h('dl', { class: 'crm-datos' },
      h('dt', {}, 'Etapa'), h('dd', {}, etapa),
      h('dt', {}, 'Cliente'), h('dd', {}, n.empresa ? n.empresa + (n.empresa_tipo === 'interno' ? ' (interno)' : '') : '—', n.contacto ? h('span', { class: 'crm-act-meta' }, ' · ' + n.contacto) : null),
      n.proyecto ? [h('dt', {}, 'Proyecto'), h('dd', {}, n.proyecto)] : null,
      n.tipo || n.origen ? [h('dt', {}, 'Tipo'), h('dd', {}, [n.tipo, n.origen ? 'llegó por: ' + n.origen : null].filter(Boolean).join(' · '))] : null,
      h('dt', {}, 'Para cuándo'), h('dd', {}, n.cierre_esperado ? n.cierre_esperado.slice(8, 10) + '-' + n.cierre_esperado.slice(5, 7) + '-' + n.cierre_esperado.slice(0, 4) : '—'),
      h('dt', {}, 'Entorno'), h('dd', {}, n.entorno || '—', botonObsidianNegocio(n)),
      h('dt', {}, 'Carpeta'), h('dd', {}, carpetaEl)),
    bloquePlata(n),
    requisitosEl,
    h('h4', {}, 'Próximas acciones'), formAct,
    pendientes.length ? h('ul', { class: 'crm-acts' }, pendientes.map(filaAct)) : h('p', { class: 'crm-nada' }, 'Nadie tiene la próxima acción.'),
    hechas.length ? h('details', { class: 'crm-hechas' }, h('summary', {}, `Hechas (${hechas.length})`), h('ul', { class: 'crm-acts' }, hechas.map(filaAct))) : null,
    documentosEl,
    h('h4', {}, 'Historial'),
    h('ol', { class: 'crm-historial' }, n.historial.map((x) => h('li', {}, h('span', { class: 'crm-h-cuando' }, cuando(x.cuando)), ' ', h('b', {}, x.autor), ' ',
      x.accion === 'crear' ? `creó ${x.objeto === 'actividad' ? 'la actividad «' + x.despues + '»' : 'el negocio en ' + x.despues}`
        : x.campo === 'documento' ? `subió ${x.despues}`
          : x.campo === 'faltaba al pasar' ? `pasó con faltantes: ${x.despues}`
            : `cambió ${x.campo}: ${x.antes ?? '—'} → ${x.despues ?? '—'}`))));
}

// «Segunda opinión» (sprint 10; antes «Llevar a la sala», sprint 7): la pregunta, el tema (elige los 4 asientos) y la
// profundidad. La sala arma su carpeta con el contexto de este negocio y lanza su receta. El mismo formulario vive en el
// panel de la barra (opinion.js), sin negocio.
// Desde el sprint 11 (21-10-2026), asesores, temas y profundidades vienen de app\config\directorio.json (cargarDirectorio,
// que se llama antes de mostrar un formulario). Lo de abajo es el respaldo si el archivo no se pudo leer.
let ASIENTOS_SALA = [['caja', 'Caja'], ['comercial', 'Comercial'], ['operacion', 'Operación'], ['metodo', 'Método'], ['tu-tiempo', 'Tu tiempo'], ['legal', 'Legal']];
let TEMAS_SALA = { plata: ['caja', 'comercial', 'operacion', 'tu-tiempo'], cliente: ['comercial', 'operacion', 'legal', 'caja'],
  legal: ['legal', 'metodo', 'comercial', 'caja'], operacion: ['operacion', 'metodo', 'caja', 'tu-tiempo'], personal: ['tu-tiempo', 'caja', 'metodo', 'comercial'] };
let TEMAS_ORDEN = [['operacion', 'Operación'], ['plata', 'Plata'], ['cliente', 'Cliente'], ['legal', 'Legal'], ['personal', 'Personal']];
// Profundidad (pedido 41): las tres primeras son exprés, una sola sesión y sin puerta; las dos últimas abren la sala de siempre.
let PROFUNDIDADES_SALA = [
  ['opinion', 'Opinión', 'Una idea precisa: veredicto, por qué y la disidencia. 1 sesión, 2 a 3 min'],
  ['plan', 'Opinión y plan de acción', 'Lo anterior más un plan con dueño y fecha. 1 sesión, 3 a 4 min'],
  ['investigacion', 'Con investigación en internet', 'Busca en la red antes de opinar y deja sus fuentes. 1 sesión con internet, 5 a 8 min'],
  ['debate', 'Debate del directorio', '4 asesores en sesiones aparte y 2 rondas, con una puerta. 11 sesiones Opus, unos 8 min'],
  ['completo', 'Directorio completo', 'Los 6 asesores y 3 rondas, con una puerta. 22 sesiones Opus: para decisiones grandes']];
let EXPRES_SALA = ['opinion', 'plan', 'investigacion'];
let COMPLETAS_SALA = ['completo'];   // las que llaman a todos los asesores, no solo a los 4 del tema
let PROFUNDIDAD_POR_DEFECTO = 'plan';
async function cargarDirectorio() {
  try {
    const c = await api.sala.config();
    if (!c || !c.asientos) return;
    ASIENTOS_SALA = c.asientos.map(([id, nombre]) => [id, nombre]);
    TEMAS_SALA = Object.fromEntries(c.temas.map(([id, , a]) => [id, a]));
    TEMAS_ORDEN = c.temas.map(([id, nombre]) => [id, nombre]);
    PROFUNDIDADES_SALA = c.profundidades.map(([id, nombre, ayuda]) => [id, nombre, ayuda]);
    EXPRES_SALA = c.profundidades.filter((p) => p[3]).map((p) => p[0]);
    COMPLETAS_SALA = c.profundidades.filter((p) => p[4] === 'completa').map((p) => p[0]);
    PROFUNDIDAD_POR_DEFECTO = c.por_defecto || PROFUNDIDADES_SALA[0][0];
    if (c.error) aviso('No pude leer directorio.json; uso lo último que sirvió. ' + c.error);
  } catch (err) { /* sin el archivo, quedan los de respaldo */ }
}
cargarDirectorio();
function camposSala(prefijo) {
  const decision = h('textarea', { id: prefijo + '-decision', rows: 3, placeholder: '¿Qué quieres que evalúe el directorio? Una decisión, una idea o un proyecto. Ej.: ¿conviene arrendar la camioneta por un año a un cliente con deudas?' });
  const inclinacion = h('input', { id: prefijo + '-inclinacion', placeholder: 'Hacia dónde te inclinas y por qué (opcional)' });
  const contexto = h('textarea', { id: prefijo + '-contexto', rows: 2, placeholder: 'Contexto que la sala debe tener en cuenta: datos, enlaces, lo que ya sabes (opcional)' });
  const tema = h('select', { id: prefijo + '-tema', 'aria-label': 'Tema' }, TEMAS_ORDEN.map(([v, t]) => h('option', { value: v }, 'Tema: ' + t)));
  const profundidad = h('select', { id: prefijo + '-profundidad', 'aria-label': 'Profundidad' }, PROFUNDIDADES_SALA.map(([v, t]) => h('option', { value: v, selected: v === PROFUNDIDAD_POR_DEFECTO }, t)));
  const ayuda = h('span', { class: 'crm-nada sala-ayuda' });
  const marcas = ASIENTOS_SALA.map(([id, nombre]) => { const c = h('input', { type: 'checkbox', value: id, 'aria-label': nombre }); return { id, c, el: h('label', { class: 'crm-check' }, c, ' ' + nombre) }; });
  const marcar = () => {
    const elegidos = COMPLETAS_SALA.includes(profundidad.value) ? ASIENTOS_SALA.map((x) => x[0]) : (TEMAS_SALA[tema.value] || []).slice(0, 4);
    for (const m of marcas) m.c.checked = elegidos.includes(m.id);
    ayuda.textContent = (PROFUNDIDADES_SALA.find((p) => p[0] === profundidad.value) || [])[2] || '';
  };
  tema.addEventListener('change', marcar);
  profundidad.addEventListener('change', marcar);
  marcar();
  const datos = () => ({ decision: decision.value.trim(), inclinacion: inclinacion.value.trim() || null, contexto: contexto.value.trim() || null,
    tema: tema.value, profundidad: profundidad.value, asientos: marcas.filter((m) => m.c.checked).map((m) => m.id) });
  return { decision, inclinacion, contexto, tema, profundidad, ayuda, marcas, datos };
}
function avisoSala(prof) {
  return EXPRES_SALA.includes(prof)
    ? 'El directorio está pensando. La opinión aparece en «Segunda opinión», arriba, cuando termine.'
    : 'La sala está trabajando. Te aviso en la puerta antes del veredicto.';
}
function formSala(n) {
  const c = camposSala('crm-sala');
  const { decision } = c;
  const form = h('form', { class: 'crm-form crm-sala' },
    h('div', { class: 'crm-form-t' }, h('b', {}, 'Segunda opinión'), h('span', { class: 'crm-nada' }, ' El directorio (asesores propios que se confrontan) evalúa algo de este negocio.')),
    h('label', { class: 'crm-campo crm-ancho' }, h('span', {}, 'Qué evaluar'), decision),
    h('label', { class: 'crm-campo crm-ancho' }, h('span', {}, 'Tu inclinación'), c.inclinacion),
    h('label', { class: 'crm-campo crm-ancho' }, h('span', {}, 'Contexto'), c.contexto),
    h('div', { class: 'crm-par crm-ancho' }, c.tema, c.profundidad),
    h('div', { class: 'crm-ancho' }, c.ayuda),
    h('div', { class: 'crm-sala-asientos crm-ancho' }, c.marcas.map((m) => m.el)),
    h('div', { class: 'crm-s-pie' }, h('span', { class: 'crm-nada' }, 'El contexto de este negocio (plata, actividades, TRABAJO.md) va solo.'), h('span', { class: 'relleno' }),
      h('button', { type: 'submit', class: 'boton principal' }, 'Pedir segunda opinión')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = c.datos();
    if (!d.decision) { decision.focus(); return; }
    if (d.asientos.length < 2) { aviso('Marca al menos dos asientos: la sala necesita que choquen.'); return; }
    try {
      const r = await api.crm.sala(n.id, d);
      crmEstado.salaForm = null;
      aviso(`${r.asientos.join(', ')}: ${avisoSala(d.profundidad)}`);
      if (!EXPRES_SALA.includes(d.profundidad)) cambiarModo('flujo');
    } catch (err) { aviso(String(err && err.message || err).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
  });
  requestAnimationFrame(() => { if (!document.activeElement || !document.activeElement.closest('.crm-sala')) decision.focus(); });
  return form;
}

// La plata (sprint 6): costo y venta leídos de los archivos, con de dónde salió cada número. El recargo va primero y con
// su nombre, porque así se fija el precio en una empresa de servicios («le puse un 30» = costo × 1,30); el margen real, al lado.
// Sprint 26 (H4): la probabilidad del negocio, con la de la etapa como punto de partida. Se pisa escribiendo un número y
// se vuelve a la etapa con el botón (o dejando el campo vacío). Ganado y perdido no se editan (D2: valen 100 y 0).
// El campo no lleva id a propósito: pintarCrm devuelve el valor escrito a los campos con id, y tras «Volver a la de la
// etapa» o un cambio de etapa (D3) dejaría puesto el número viejo.
function filasProbabilidad(n) {
  const pisada = n.probabilidad_pisada !== null && n.probabilidad_pisada !== undefined;
  const deEtapa = n.etapa_probabilidad === null || n.etapa_probabilidad === undefined ? null : n.etapa_probabilidad;
  const filas = [];
  if (n.etapa_tipo === 'ganada' || n.etapa_tipo === 'perdida') {
    filas.push(h('dt', {}, 'Probabilidad'), h('dd', {}, (n.etapa_tipo === 'ganada' ? 100 : 0) + ' %', h('span', { class: 'crm-act-meta' }, ' · etapa cerrada')));
  } else {
    const cambiar = async (valor, campo) => {
      try { await api.crm.cambiar(n.id, { probabilidad: valor }); aviso(valor === null ? `«${n.nombre}» vuelve a la probabilidad de su etapa.` : `«${n.nombre}» queda en ${valor} %.`); }
      catch (err) { if (campo) campo.value = pisada ? n.probabilidad_pisada : ''; aviso(String(err && err.message || err).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    };
    const campo = h('input', { type: 'number', class: 'crm-f-prob', min: 0, max: 100, step: 1, value: pisada ? n.probabilidad_pisada : '',
      placeholder: deEtapa === null ? '—' : String(deEtapa), 'aria-label': 'Probabilidad de cerrar, en %' });
    campo.addEventListener('change', () => {
      const v = campo.value.trim();
      if (v === '' && !pisada) return;
      cambiar(v === '' ? null : v, campo);
    });
    filas.push(h('dt', {}, 'Probabilidad'), h('dd', { class: 'crm-prob' }, campo, ' %',
      h('span', { class: 'crm-act-meta' }, pisada ? ' puesta a mano · la etapa dice ' + (deEtapa === null ? 'nada' : deEtapa + ' %') : deEtapa === null ? ' esta etapa no tiene %' : ' la de la etapa'),
      pisada ? h('button', { type: 'button', class: 'boton chico crm-prob-volver', onclick: () => cambiar(null) }, 'Volver a la de la etapa') : null));
  }
  if (n.ponderado !== null && n.ponderado !== undefined) filas.push(h('dt', {}, 'Ponderado'), h('dd', {}, plata(n.ponderado, n.moneda)));
  return filas;
}
function bloquePlata(n) {
  const c = n.control;
  const fuentes = c ? c.fuentes : [];
  const hayAlgo = c && (c.costo !== null || c.venta !== null || Object.keys(c.otras || {}).length || fuentes.length);
  if (!hayAlgo) {
    // Un embudo sin «plata» en su plantilla (Encargos, por ejemplo) no lee archivos: solo el monto esperado.
    return [h('h4', {}, 'Plata'), h('dl', { class: 'crm-datos' }, h('dt', {}, 'Monto esperado'), h('dd', {}, plata(n.monto, n.moneda) || '—'), filasProbabilidad(n)),
      n.conPlata === false ? null : h('p', { class: 'crm-nada' }, n.carpetaAbs ? 'No hay libro de control ni órdenes de compra en su carpeta.' : 'Sin carpeta: la plata se lee de los archivos del trabajo.')];
  }
  const venta = c.venta !== null ? c.venta : null;
  const otras = Object.entries(c.otras || {});
  const pct = (x) => (Math.round(x * 1000) / 10).toLocaleString('es-CL') + ' %';
  const filas = [
    h('dt', {}, 'Costo'), h('dd', {}, c.costo !== null ? plata(c.costo, c.moneda) : '—', otras.map(([m, v]) => h('span', { class: 'crm-plata-otra', title: 'Compras en otra moneda: no se suman a la principal' }, ' + ' + plata(v, m)))),
    h('dt', {}, 'Venta'), h('dd', {}, venta !== null ? plata(venta, c.moneda) : h('span', { class: 'crm-nada' }, 'sin venta en el libro')),
    h('dt', {}, 'Monto esperado'), h('dd', {}, plata(n.monto, n.moneda) || '—'), ...filasProbabilidad(n)];
  if (c.costo && venta) {
    filas.push(h('dt', {}, 'Recargo'), h('dd', {}, pct((venta - c.costo) / c.costo), h('span', { class: 'crm-act-meta' }, ' sobre el costo')),
      h('dt', {}, 'Margen real'), h('dd', {}, pct((venta - c.costo) / venta), h('span', { class: 'crm-act-meta' }, ' sobre la venta')));
  }
  const nombre = (ruta) => String(ruta || '').split(/[\\/]/).pop();
  return [h('h4', {}, 'Plata'), h('dl', { class: 'crm-datos' }, filas),
    otras.length && c.costo && venta ? h('p', { class: 'crm-nada' }, 'El recargo y el margen son solo de lo comprado en ' + c.moneda + '.') : null,
    h('ul', { class: 'crm-fuentes' }, fuentes.map((f, i) => h('li', {},
      h('button', { type: 'button', class: 'crm-doc', title: f.archivo, onclick: () => api.crm.abrirFuente(n.id, i) }, nombre(f.archivo)),
      h('span', { class: 'crm-act-meta' }, f.que === 'error' ? 'no se pudo leer: ' + f.error : `${f.que} · ${plata(f.valor, f.moneda)} · celda ${f.celda} de «${f.hoja}»`)))),
    h('p', { class: 'crm-nada' }, 'Leído de los archivos ' + (c.leido ? cuandoCorto(c.leido) : '') + '; se vuelve a leer solo si cambian.')];
}
const cuandoCorto = (iso) => { const d = new Date(iso); return `el ${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()} a las ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

async function subir(n, tipo) {
  const r = await api.crm.subir(n.id, tipo || null);
  if (r && r.subidos.length) aviso(`${r.subidos.length === 1 ? 'Subido' : 'Subidos'}: ${r.subidos.join(', ')} → ${r.destino}`);
}

async function crmAbrir(id) {
  if (!id) return;
  crmEstado.sel = id;
  crmEstado.ficha = await api.crm.negocio(id);
  pintarCrm();
}

// ── Configurar y Agregar CRM: cuestionario del negocio → plantilla recomendada (sprint 4) ────
// nuevo = true: el formulario de un CRM nuevo (nombre + cuestionario), con «¿Quieres crearlo con IA?» arriba.
async function abrirConfigurar(nuevo) {
  if (crmEstado.config && !!crmEstado.config.nuevo === !!nuevo) { crmEstado.config = null; crmEstado.firma = null; pintarCrm(); return; }
  crmEstado.config = { nuevo: !!nuevo, cuestionario: await api.crm.cuestionario(), respuestas: {}, recomendacion: null, paso: 'preguntas' };
  crmEstado.firma = null;
  pintarCrm();
  if (nuevo) requestAnimationFrame(() => { const x = document.getElementById('crm-c-nombre'); if (x) x.focus(); });
}

// El asistente se abre en chico (acoplado) abajo a la derecha; si ya hay uno, se trae ese.
// Con negocioId («Definir con IA» en la ficha), el asistente parte definiendo ese encargo.
async function impulsarConIA(negocioId) {
  const s = await api.crm.impulsar(crmEstado.entorno, !negocioId && !!(crmEstado.config && crmEstado.config.nuevo), negocioId || null);
  if (!s) return;
  if (!sesion(s.id)) { const datos = await api.lista(); recibir(datos); }
  acoplar(s.id);
  if (s.reusada) aviso(negocioId ? 'El asistente ya estaba abierto: le pasé el encargo.' : 'El asistente de CRM ya estaba abierto.');
}

function panelConfigurar() {
  const c = crmEstado.config;
  const q = c.cuestionario;
  const destino = crmEstado.entorno || (espacio(actual) || {}).nombre || null;
  const errorTexto = (err) => String(err && err.message || err).replace(/^Error invoking remote method '[^']+': Error: /, '');
  const preguntas = q.preguntas.map((p) => h('fieldset', { class: 'crm-preg' },
    h('legend', {}, p.texto),
    h('div', { class: 'crm-opciones' }, p.opciones.map((o) => {
      const marcada = p.multiple ? (c.respuestas[p.id] || []).includes(o.id) : c.respuestas[p.id] === o.id;
      return h('button', { type: 'button', class: 'crm-opcion' + (marcada ? ' on' : ''), 'aria-pressed': String(marcada), onclick: () => {
        if (p.multiple) { const s = new Set(c.respuestas[p.id] || []); if (s.has(o.id)) s.delete(o.id); else s.add(o.id); c.respuestas[p.id] = [...s]; }
        else c.respuestas[p.id] = marcada ? undefined : o.id;
        c.recomendacion = null;
        pintarCrm();
      } }, o.texto);
    }))));
  const contestadas = q.preguntas.filter((p) => (p.multiple ? (c.respuestas[p.id] || []).length : c.respuestas[p.id])).length;
  const recomendar = async () => { c.recomendacion = await api.crm.recomendar(c.respuestas); pintarCrm(); };
  const resultados = c.recomendacion ? h('div', { class: 'crm-recs' }, c.recomendacion.map((rec, i) => h('article', { class: 'crm-rec' + (i === 0 ? ' mejor' : '') },
    h('div', { class: 'crm-rec-t' }, h('b', {}, rec.nombre), h('span', { class: 'crm-rec-pts' }, i === 0 ? `recomendada · ${rec.ajuste} % de calce` : `${rec.ajuste} % de calce`)),
    h('p', { class: 'crm-rec-d' }, rec.descripcion),
    h('div', { class: 'crm-rec-etapas' }, rec.etapas.map((e, k) => [k ? h('span', { class: 'crm-flecha' }, '→') : null, h('span', { class: 'crm-rec-etapa' }, e)])),
    rec.razones.length ? h('ul', { class: 'crm-rec-razones' }, rec.razones.map((x) => h('li', {}, x))) : null,
    h('p', { class: 'crm-rec-insp' }, 'Basada en: ' + rec.inspirado_en),
    h('button', { type: 'button', class: 'boton chico' + (i === 0 ? ' brasa-boton' : ''), disabled: !c.nuevo && !destino, onclick: async () => {
      try {
        let nombre = null;
        if (c.nuevo) {
          const x = document.getElementById('crm-c-nombre');
          nombre = x ? x.value.trim() : '';
          if (!nombre) { aviso('Escribe el nombre del CRM arriba.'); if (x) x.focus(); return; }
          await api.crm.nuevo(nombre);
        }
        await api.crm.aplicar(rec.id, destino);
        crmEstado.config = null; crmEstado.resumen = null; crmEstado.sel = null; crmEstado.ficha = null; crmEstado.firma = null;
        aviso(c.nuevo ? `CRM «${nombre}» creado con el embudo «${rec.embudo}».` : `Plantilla «${rec.nombre}» aplicada a ${destino}: su embudo es «${rec.embudo}». Los negocios existentes no se movieron.`);
        crmCargar();
      } catch (err) { aviso(errorTexto(err)); }
    } }, c.nuevo ? 'Crear con esta' : destino ? `Usar en ${destino}` : 'Abre una pestaña para aplicarla')))) : null;
  return h('section', { class: 'crm-config' + (c.nuevo ? ' nuevo' : '') },
    c.nuevo ? h('div', { class: 'crm-con-ia' },
      h('div', {}, h('b', {}, '¿Quieres crearlo con IA?'), h('span', { class: 'crm-nada' }, ' Le cuentas el negocio en dos frases y el asistente arma el CRM contigo. Se abre en chico; con su botón de agrandar pasa a pantalla completa.')),
      h('button', { type: 'button', class: 'boton brasa-boton', onclick: () => impulsarConIA() }, 'Crear con IA')) : null,
    h('div', { class: 'crm-config-t' }, h('h3', {}, c.nuevo ? 'Nuevo CRM' : q.titulo), h('span', { class: 'crm-nada' }, c.nuevo ? 'O llénalo tú: el nombre y las preguntas.' : q.nota),
      h('span', { class: 'relleno' }), h('button', { type: 'button', class: 'v-boton', 'aria-label': 'Cerrar', onclick: () => abrirConfigurar(c.nuevo) }, '×')),
    c.nuevo ? h('label', { class: 'crm-campo crm-nombre-nuevo' }, h('span', {}, 'Nombre del proyecto o empresa'), h('input', { id: 'crm-c-nombre', placeholder: 'Ej.: Taller Mecánico Biobío' })) : null,
    h('div', { class: 'crm-pregs' }, preguntas),
    h('div', { class: 'crm-config-acc' },
      h('button', { type: 'button', class: 'boton principal', disabled: contestadas < 3, onclick: recomendar }, `Recomendar embudo (${contestadas} de ${q.preguntas.length})`),
      c.nuevo ? null : h('button', { type: 'button', class: 'boton chico', title: 'El asistente ajusta el embudo contigo (en chico, agrandable)', onclick: () => impulsarConIA() }, 'Ajustarlo con IA')),
    resultados,
    c.nuevo ? null : seccionEtapas(),
    c.nuevo ? null : seccionCarpetas());
}

// Sprint 26 (H6): el % de cada etapa del embudo que se ve, editable aquí; queda en la base de este CRM, no en la
// plantilla en disco, y deja su línea en el historial. Los campos no llevan id por lo mismo que en la ficha (D13).
// Sin el IPC (ventana recargada antes de reiniciar la app) la sección lo dice en vez de fallar al guardar.
function seccionEtapas() {
  const lista = etapasVisibles();
  if (!lista.length) return null;
  const titulo = [h('h4', {}, 'Etapas'), h('p', { class: 'crm-nada' }, `Probabilidad de cerrar en cada etapa de «${crmEstado.embudoVer}». Cambiarla mueve el ponderado de los negocios que siguen a su etapa; los que tienen un % puesto a mano en la ficha no cambian. Vacío: la etapa no pondera.`)];
  if (!api.crm.etapaProbabilidad) return h('div', { class: 'crm-carpetas' }, titulo, h('p', { class: 'crm-nada' }, 'Se puede editar después de cerrar y abrir Chocosys.'));
  const siguen = (e) => crmEstado.negocios.filter((n) => n.etapa_id === e.id && (n.probabilidad_pisada === null || n.probabilidad_pisada === undefined)).length;
  const fila = (e) => {
    if (e.tipo !== 'abierta') return h('li', { class: 'crm-raiz crm-etapa-pct' }, h('span', {}, e.nombre), h('span', { class: 'crm-act-meta' }, (e.tipo === 'ganada' ? 100 : 0) + ' % · etapa cerrada'), h('span', {}));
    const actual = e.probabilidad === null || e.probabilidad === undefined ? '' : String(e.probabilidad);
    const campo = h('input', { type: 'number', class: 'crm-f-prob', min: 0, max: 100, step: 1, value: actual, placeholder: '—', 'aria-label': 'Probabilidad de ' + e.nombre + ', en %' });
    campo.addEventListener('change', async () => {
      const v = campo.value.trim();
      if (v === actual) return;
      try {
        const r = await api.crm.etapaProbabilidad(e.id, v === '' ? null : v);
        if (r && r.cambio) aviso(r.probabilidad === null ? `«${e.nombre}» queda sin %: sus negocios no ponderan.` : `«${e.nombre}» queda en ${r.probabilidad} % (antes ${r.antes === null || r.antes === undefined ? 'sin %' : r.antes + ' %'}).`);
      } catch (err) { campo.value = actual; aviso(String(err && err.message || err).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    });
    const n = siguen(e);
    return h('li', { class: 'crm-raiz crm-etapa-pct' }, h('span', {}, e.nombre), h('span', { class: 'crm-prob' }, campo, ' %'),
      h('span', { class: 'crm-act-meta' }, n ? `${n} negocio${n === 1 ? '' : 's'} la sigue${n === 1 ? '' : 'n'}` : ''));
  };
  return h('div', { class: 'crm-carpetas' }, titulo, h('ul', { class: 'crm-raices' }, lista.map(fila)));
}

// Dónde nacen las carpetas (sprint 6): la raíz de los proyectos y, por embudo, la de cada tipo de negocio («todo lo
// demás» = «*»). Se elige con el diálogo de Windows; queda en la base de este CRM, no en el código.
function seccionCarpetas() {
  const k = crmEstado.resumen.carpetas || { raiz_proyectos: null, raices: {}, tipos: {} };
  const elegir = async (embudo, tipo) => { const r = await api.crm.carpetaRaiz(embudo, tipo); if (r) { crmEstado.resumen = null; aviso('Listo: carpeta elegida.'); crmCargar(); } };
  const fila = (texto, ruta, embudo, tipo) => h('li', { class: 'crm-raiz' }, h('span', {}, texto), h('code', { title: ruta || '' }, ruta || (tipo && tipo !== '*' && embudo ? 'va a «todo lo demás»' : 'sin elegir')),
    h('button', { type: 'button', class: 'boton chico', onclick: () => elegir(embudo, tipo) }, ruta ? 'Cambiar' : 'Elegir'));
  return h('div', { class: 'crm-carpetas' },
    h('h4', {}, 'Carpetas'),
    h('p', { class: 'crm-nada' }, 'Dónde nace la carpeta de cada proyecto y de cada solicitud. Un encargo de un proyecto va dentro del proyecto; si no, a la de su tipo.'),
    h('ul', { class: 'crm-raices' },
      fila('Proyectos', k.raiz_proyectos, null, null),
      Object.keys(k.raices || {}).map((embudo) => [
        ...(k.tipos[embudo] || []).map((t) => fila(`${embudo} · ${t}`, (k.raices[embudo] || {})[t], embudo, t)),
        fila(`${embudo} · ${(k.tipos[embudo] || []).length ? 'todo lo demás' : 'todos'}`, (k.raices[embudo] || {})['*'], embudo, '*')])));
}

api.crm.alCambiar(() => { if (modo === 'crm') crmCargar(); else crmEstado.resumen = null; });
