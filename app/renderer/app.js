// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Chocosys · la ventana (PRD-03). El estado vive en el proceso principal; acá se dibuja el lienzo
// del espacio elegido: cada sesión es una ventana con su terminal real, cada flujo un marco con su
// cañería. La bandeja en lista es la segunda vista. Nada de acá interrumpe a un agente por su cuenta.

const api = window.consola;
// Edición (lite/terminales, lite/flujos o la completa): main.js la pasa en la dirección; styles.css esconde lo que no va.
const EDICION = new URLSearchParams(location.search).get('edicion') || 'completa';
document.documentElement.dataset.edicion = EDICION;
const VISTAS_EDICION = { terminales: ['lienzo', 'bandeja'], flujos: ['lienzo', 'bandeja', 'flujo'] }[EDICION];
const ORDEN = ['necesita', 'termino', 'trabajando', 'pausa'];
const ETIQUETA = { necesita: 'TE NECESITA', termino: 'TERMINÓ', trabajando: 'TRABAJANDO', pausa: 'EN PAUSA', espera: 'EN ESPERA', listo: 'TERMINÓ' };
const movimientoReducido = matchMedia('(prefers-reduced-motion: reduce)');

const TEMA = {
  background: '#0e0c0a', foreground: '#e9e1d6', cursor: '#f1e9df', cursorAccent: '#0e0c0a',
  selectionBackground: 'rgba(241, 233, 223, 0.22)',
  black: '#1a1613', red: '#e5735b', green: '#93d3a0', yellow: '#f2b03d',
  blue: '#8fb3d9', magenta: '#d6a0c9', cyan: '#7ec9c4', white: '#d9d0c4',
  brightBlack: '#7f766b', brightRed: '#f0927d', brightGreen: '#b0e2b9', brightYellow: '#f7c76e',
  brightBlue: '#adc7e4', brightMagenta: '#e4bcdb', brightCyan: '#a0dad6', brightWhite: '#f6efe6'
};

// Medidas del lienzo
const VENTANA = { w: 560, h: 360 };
// fila: espacio vertical entre ventanas; deja lugar al Clawd que se para sobre cada barra.
const EN_FLUJO = { w: 420, h: 280, cols: 3, gap: 16, fila: 52, cabeza: 140 };
const GRILLA = { x0: 70, y0: 104, gap: 28, fila: 56 };
// Paso de la cuadrícula del fondo: al soltar o estirar, las esquinas caen sobre sus puntos.
const PASO = 22;
const alPaso = (n) => Math.round(n / PASO) * PASO;

let sesiones = [];
let flujos = [];
let espacios = [];
let actual = null;
let sel = null;
const MODOS = ['lienzo', 'bandeja', 'flujo', 'crm'];
// La app abre en el Inicio (pestaña fija). modoPrevio es la vista a la que se vuelve al salir del Inicio.
let modo = VISTAS_EDICION ? 'lienzo' : 'inicio';
let modoPrevio = 'lienzo';
// La bandeja siempre muestra una terminal; el lienzo, el kanban y el CRM parten sin ninguna maximizada.
// Lite: el CRM, la sala y el tutorial se cargan la primera vez que se piden (opinion.js y tutorial.js usan partes de crm.js).
const diferidos = {};
const cargarDiferido = (n) => diferidos[n] || (diferidos[n] = new Promise((listo, falla) => document.body.append(h('script', { src: n + '.js', onload: listo, onerror: falla }))));
const alPrimerClic = (sel, scripts, abrir) => $(sel).addEventListener('click', async (ev) => {
  ev.stopPropagation();
  for (const n of scripts) await cargarDiferido(n);
  abrir();
}, { once: true });
function cambiarModo(m) {
  // Una lite no tiene Inicio ni CRM (ni kanban de flujos en «terminales»): atajos, MCP y botones caen al lienzo.
  if (VISTAS_EDICION && !VISTAS_EDICION.includes(m)) m = 'lienzo';
  if (m === 'inicio' && modo !== 'inicio') { modoPrevio = modo; if (typeof inicioEstado !== 'undefined') inicioEstado.cargado = false; }
  modo = m;
  if (m !== 'bandeja') maxima = null;
  if (m === 'crm' && typeof crmEstado !== 'undefined') crmEstado.resumen = null;
  if (m === 'crm' && !diferidos.crm) cargarDiferido('crm').then(pintar);
  pintar();
}
let maxima = null;
let seguirFlujo = null;
const vistas = new Map();
const terminales = new Map();
const ventanas = new Map();
const marcos = new Map();
const filas = new Map();
const flujosBandeja = new Map();
const abiertas = new Set();

const $ = (s) => document.querySelector(s);
// replaceChildren escribe «null» en pantalla si recibe null (pasó en la puerta de elegir, 20-10-2026).
// Se filtra igual que en h(): null, undefined y false no se pintan, y las listas se aplanan.
const reemplazarOriginal = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...hijos) {
  return reemplazarOriginal.apply(this, hijos.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
};
const SVG = 'http://www.w3.org/2000/svg';

// Crea un elemento con texto seguro (nunca innerHTML con datos de las sesiones).
function h(etiqueta, atributos, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(atributos || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const hijo of hijos.flat(Infinity)) if (hijo !== null && hijo !== undefined && hijo !== false) el.append(hijo instanceof Node ? hijo : String(hijo));
  return el;
}
function svg(clase, caminos, caja) {
  const el = document.createElementNS(SVG, 'svg');
  el.setAttribute('viewBox', caja || '0 0 18 18');
  el.setAttribute('class', clase);
  el.setAttribute('aria-hidden', 'true');
  for (const d of caminos) { const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); el.append(p); }
  return el;
}
const valvula = (clase) => svg('valvula' + (clase ? ' ' + clase : ''), ['M1 1v16l8-8z', 'M17 1v16l-8-8z']);
const icono = (d) => { const el = svg('', d, '0 0 24 24'); el.setAttribute('width', '14'); el.setAttribute('height', '14'); el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor'); el.setAttribute('stroke-width', '2'); el.setAttribute('stroke-linecap', 'round'); return el; };

const sesion = (id) => sesiones.find((x) => x.id === id);
const flujo = (fid) => flujos.find((x) => x.id === fid);
const espacio = (id) => espacios.find((x) => x.id === id);
const esPuerta = (id) => typeof id === 'string' && id.startsWith('p:');
// «v:<flujo>»: el veredicto de una sala que espera que quien usa la app lo deje como nota en el negocio (sprint 7).
const esVeredicto = (id) => typeof id === 'string' && id.startsWith('v:');
const salasVistas = new Map();   // fid -> veredicto leído de la sala (o null mientras se lee)
const delEspacio = (lista) => lista.filter((x) => x.espacio === actual);
const nombreModelo = (m) => ({ haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' }[m] || '');
// Lo de quien usa esta Chocosys (sprint 18, perfil.json en sus datos): responsables del CRM y orden de las recetas.
let perfilUI = { nombre: '', responsables: [], orden_recetas: [] };
api.perfil().then((p) => { if (p) perfilUI = p; }).catch(() => {});

function hace(ms) {
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return min + ' min';
  const horas = Math.floor(min / 60);
  if (horas < 24) return horas + ' h';
  const d = new Date(ms);
  return String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function ordenar(lista) {
  const g = (s) => ORDEN.indexOf(s.estado);
  return lista.slice().sort((a, b) => (g(a) !== g(b) ? g(a) - g(b) : (a.estado === 'necesita' ? a.cambio - b.cambio : b.cambio - a.cambio)));
}
function subtitulo(s) {
  if (s.estado === 'necesita') return s.mensaje || 'Espera tu respuesta';
  if (s.flujo && s.listo && s.traspaso && s.estado !== 'trabajando') return 'Dejó ' + s.traspaso;
  if (s.estado === 'trabajando') return s.ultimo ? '› ' + s.ultimo : 'Trabajando';
  if (s.estado === 'termino') return s.ultimo ? 'Listo: ' + s.ultimo : 'Terminó';
  if (s.mensaje) return s.mensaje;
  if (s.viva) return 'Esperando tu instrucción';
  return s.iniciada ? 'Cerrada · se puede retomar' : 'Lista para abrir';
}
function aviso(texto) {
  const el = $('#aviso');
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => { el.hidden = true; }, 3800);
}

// ── Terminales ──────────────────────────────────────────

// La de fuentes.json reemplaza a esta si es monoespaciada (aplicarFuentes).
const MONO_BASE = '"Cascadia Code Variable", Consolas, monospace';
let monoTerminal = MONO_BASE;
function terminal(id) {
  if (terminales.has(id)) return terminales.get(id);
  const host = h('div', { class: 'term-host' });
  $('#pool').appendChild(host);
  // Tras recargar la interfaz nace con el tamaño que su PTY ya tiene (lo anota ajustar): main repone la salida reciente,
  // y escrita en otra grilla los movimientos de cursor de Claude Code caían donde no era (texto encimado, 03-11-2026).
  const previo = (sessionStorage.getItem('tam-' + id) || '').split('x').map(Number);
  const term = new Terminal({
    fontFamily: monoTerminal,
    fontSize: 13.5, lineHeight: 1.1, fontWeight: 400, fontWeightBold: 650,
    // 120x32 es el tamaño con que main abre cada sesión (abrirAlMedir): oculta no mide, y con el 80x24 de xterm la pantalla
    // de Claude se dibujaba en una grilla distinta a la de su PTY y dejaba restos al ajustarse.
    cols: previo[0] || 120, rows: previo[1] || 32, cursorBlink: true, scrollback: 10000, theme: TEMA
  });
  const ajuste = new FitAddon.FitAddon();
  term.loadAddon(ajuste);
  term.open(host);
  // El dibujo por GPU se pone al mostrarla (gpu(), desde pintarVentana), no aquí.
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true;
    const tecla = ev.key.toLowerCase();
    if (ev.ctrlKey && !ev.shiftKey && tecla === 'c' && term.hasSelection()) { api.copiar(term.getSelection()); term.clearSelection(); return false; }
    if (ev.ctrlKey && !ev.shiftKey && tecla === 'v') return false;
    // Ctrl+Shift+← y → cambian de pestaña: no le llegan a Claude Code.
    if (ev.ctrlKey && ev.shiftKey && (tecla === 'arrowleft' || tecla === 'arrowright' || tecla === 'tab')) return false;
    if (ev.altKey && !ev.ctrlKey && /^Digit[1-9]$/.test(ev.code)) return false;
    return true;
  });
  term.onData((datos) => api.escribir(id, datos));
  const t = { term, ajuste, host };
  terminales.set(id, t);
  return t;
}

// Devuelve si la pudo medir. Oculta o a medio dibujar no se ajusta: el mínimo de 8x4 celdas es el de Orca (MIT,
// stablyai/orca, src/renderer/src/lib/pane-manager/pane-fit-measurability.ts).
// Si no puede medir reintenta por cuadros (hasta 30) y, al lograrlo, repinta: una terminal que se creó o se mostró sin
// medida quedaba negra hasta el primer clic (29-10-2026).
function ajustar(id) {
  const t = terminales.get(id);
  if (!t || !t.host.isConnected || t.host.closest('#pool')) return false;
  const d = t.ajuste.proposeDimensions();
  if (!d || !(d.cols >= 8 && d.rows >= 4)) {
    t.pendiente = true;
    if (!t.reintentos) {
      t.reintentos = 1;
      const volver = () => { if (t.reintentos > 30 || ajustar(id)) t.reintentos = 0; else { t.reintentos++; requestAnimationFrame(volver); } };
      requestAnimationFrame(volver);
    }
    return false;
  }
  try { t.ajuste.fit(); } catch (e) { return false; }
  api.tamano(id, t.term.cols, t.term.rows);
  try { sessionStorage.setItem('tam-' + id, t.term.cols + 'x' + t.term.rows); } catch (e) { /* sin guardar: nace en 120x32 */ }
  if (t.pendiente) { t.pendiente = false; repintar(t, true); }
  return true;
}
// Dibuja otra vez todas las filas (y el atlas del WebGL) para una terminal que quedó en negro tras estar oculta.
function repintar(t, alFondo) {
  try {
    t.term.clearTextureAtlas();
    t.term.refresh(0, t.term.rows - 1);
    if (alFondo) t.term.scrollToBottom();
  } catch (e) { /* todavía sin dibujo */ }
}
// Dibujo por GPU (WebGL): los caracteres de bloque (el logo de Claude Code, barras, bordes de tablas) llenan la celda
// entera, sin las franjas del interlineado del dibujo normal (20-10-2026). Lo llevan las terminales a la vista:
// Chromium admite 16 contextos WebGL por ventana y pasado eso apaga el más viejo, que quedaba 3 s quieta y caía al dibujo
// normal con otro ancho de celda (7,2 a 7,9 px) sin reajustarse: texto desalineado y cortado a la derecha (03-11-2026).
// Una oculta lo conserva mientras haya cupo: crearlo de nuevo al volver a su pestaña dejaba la ventana pegada 25 a 80 ms
// por terminal (14-11-2026). shortcut: sale la primera de la lista, no la menos usada; con más de 6 abiertas importaría.
const GPU_MAX = 6;
function gpu(id, encender) {
  const t = terminales.get(id);
  // Si cambió la escala de pantalla (otro monitor) se crea de nuevo, como cuando no se conservaba: conservarlo ahí no está probado.
  if (t && t.gpu && t.escala !== devicePixelRatio) { t.gpu.dispose(); t.gpu = null; }
  if (!t || !!t.gpu === encender || typeof WebglAddon === 'undefined') return;
  if (!encender) { if ([...terminales.values()].filter((x) => x.gpu).length > GPU_MAX) { t.gpu.dispose(); t.gpu = null; } return; }
  try {
    const g = new WebglAddon.WebglAddon();
    // Si igual se pierde (GPU reiniciada, más de 16 a la vista), sigue con el dibujo normal ajustado a su celda.
    g.onContextLoss(() => { if (t.gpu !== g) return; t.gpu = null; g.dispose(); ajustar(id); });
    t.term.loadAddon(g);
    t.gpu = g;
    t.escala = devicePixelRatio;
  } catch (e) { /* sin WebGL: dibujo normal */ }
}
// Al salir de pantalla completa o cambiar el tamaño de la ventana, repinta las terminales a la vista.
let esperaRepintar;
window.addEventListener('resize', () => {
  clearTimeout(esperaRepintar);
  esperaRepintar = setTimeout(() => { for (const [id, t] of terminales) if (ajustar(id)) repintar(t); }, 200);
});

// ── Vista del lienzo (pan y zoom por espacio) ───────────

function vista() {
  if (!vistas.has(actual)) {
    const e = espacio(actual);
    vistas.set(actual, e && e.vista ? Object.assign({}, e.vista) : { x: 0, y: 0, zoom: 1 });
  }
  return vistas.get(actual);
}
function aplicarVista(suave) {
  const v = vista();
  const lienzo = $('#lienzo');
  lienzo.classList.toggle('suave', !!suave && !movimientoReducido.matches);
  lienzo.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
  $('#zoom-txt').textContent = Math.round(v.zoom * 100) + ' %';
  const fondo = $('#vista-lienzo');
  // Cada punto se dibuja al centro de su baldosa: medio paso hacia atrás deja los puntos en los múltiplos de PASO.
  fondo.style.backgroundPosition = `${v.x - (PASO / 2) * v.zoom}px ${v.y - (PASO / 2) * v.zoom}px`;
  fondo.style.backgroundSize = `${PASO * v.zoom}px ${PASO * v.zoom}px`;
  clearTimeout(aplicarVista.t);
  aplicarVista.t = setTimeout(() => api.vistaEspacio(actual, v), 400);
}
function zoomEn(nuevo, cx, cy, suave) {
  const v = vista();
  const z = Math.max(0.3, Math.min(1.25, nuevo));
  const r = $('#vista-lienzo').getBoundingClientRect();
  const px = (cx === undefined ? r.width / 2 : cx - r.left);
  const py = (cy === undefined ? r.height / 2 : cy - r.top);
  v.x = px - ((px - v.x) / v.zoom) * z;
  v.y = py - ((py - v.y) / v.zoom) * z;
  v.zoom = z;
  aplicarVista(suave);
}
function centrarEn(rect, zoom) {
  const v = vista();
  const r = $('#vista-lienzo').getBoundingClientRect();
  v.zoom = zoom || 1;
  v.x = r.width / 2 - (rect.x + rect.w / 2) * v.zoom;
  v.y = (r.height - 110) / 2 - (rect.y + rect.h / 2) * v.zoom;
  aplicarVista(true);
}
function ajustarTodo() {
  const rects = rectsDelEspacio();
  if (!rects.length) { const v = vista(); v.x = 0; v.y = 0; v.zoom = 1; aplicarVista(true); return; }
  const x0 = Math.min(...rects.map((r) => r.x)) - 40;
  const y0 = Math.min(0, ...rects.map((r) => r.y)) - 20;
  const x1 = Math.max(...rects.map((r) => r.x + r.w)) + 40;
  const y1 = Math.max(...rects.map((r) => r.y + r.h)) + 40;
  const r = $('#vista-lienzo').getBoundingClientRect();
  const zoom = Math.max(0.3, Math.min(1, Math.min((r.width - 100) / (x1 - x0), (r.height - 140) / (y1 - y0))));
  centrarEn({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, zoom);
}

// ── Posiciones ──────────────────────────────────────────

function tamanoMarco(f) {
  const n = Math.max(1, sesionesDe(f).length);
  const filasN = Math.ceil(n / EN_FLUJO.cols);
  const cols = Math.min(n, EN_FLUJO.cols);
  return { w: Math.max(760, 32 + cols * EN_FLUJO.w + (cols - 1) * EN_FLUJO.gap), h: EN_FLUJO.cabeza + filasN * (EN_FLUJO.h + EN_FLUJO.fila) + 8 };
}
function sesionesDe(f) { return f.items.flatMap((it) => it.sesiones || []).map(sesion).filter(Boolean); }

function rectsDelEspacio(excepto) {
  const rects = [];
  for (const f of delEspacio(flujos)) if (f.id !== excepto && f.pos) { const t = tamanoMarco(f); rects.push({ x: f.pos.x, y: f.pos.y, w: t.w, h: t.h }); }
  for (const s of delEspacio(sesiones)) if (s.id !== excepto && !s.flujo && s.pos) rects.push(s.pos);
  return rects;
}
const choca = (a, b) => a.x < b.x + b.w + 12 && a.x + a.w + 12 > b.x && a.y < b.y + b.h + 12 && a.y + a.h + 12 > b.y;
function lugarLibre(w, h, excepto) {
  const ocupados = rectsDelEspacio(excepto);
  for (let fila = 0; fila < 40; fila++) {
    for (let col = 0; col < 4; col++) {
      const r = { x: alPaso(GRILLA.x0 + col * (VENTANA.w + GRILLA.gap)), y: alPaso(GRILLA.y0 + fila * (VENTANA.h + GRILLA.fila)), w, h };
      if (!ocupados.some((o) => choca(r, o))) return r;
    }
  }
  return { x: GRILLA.x0, y: GRILLA.y0, w, h };
}
function posDeSesion(s) {
  if (s.flujo) {
    const f = flujo(s.flujo);
    if (f && f.pos) {
      const i = sesionesDe(f).findIndex((x) => x.id === s.id);
      return {
        x: f.pos.x + 16 + (i % EN_FLUJO.cols) * (EN_FLUJO.w + EN_FLUJO.gap),
        y: f.pos.y + EN_FLUJO.cabeza + Math.floor(i / EN_FLUJO.cols) * (EN_FLUJO.h + EN_FLUJO.fila),
        w: EN_FLUJO.w, h: EN_FLUJO.h
      };
    }
  }
  if (!s.pos) {
    s.pos = lugarLibre(VENTANA.w, VENTANA.h, s.id);
    api.posicion(s.id, s.pos);
  }
  return s.pos;
}
function posDeFlujo(f) {
  if (!f.pos) {
    const t = tamanoMarco(f);
    // Con el mosaico, el flujo nuevo va arriba, debajo de los otros flujos; las ventanas sueltas bajan detrás.
    let y = alPaso(GRILLA.y0);
    for (const o of delEspacio(flujos)) if (o.id !== f.id && o.pos) y = Math.max(y, alPaso(o.pos.y + tamanoMarco(o).h + GRILLA.fila));
    const r = f.espacio === actual && mosaicoEncendido(actual) ? { x: alPaso(GRILLA.x0), y } : lugarLibre(t.w, t.h, f.id);
    f.pos = { x: r.x, y: r.y };
    api.posicionFlujo(f.id, f.pos);
  }
  return f.pos;
}

// ── Clawd de 8 bits ─────────────────────────────────────
// Sentado sobre la barra de cada ventana: camina si trabaja, salta con «!» si te necesita, queda
// contento si terminó y duerme si está en pausa. Dibujado pixel a pixel (grilla de 18 × 6, como el
// Clawd de bloques de Claude Code, pero nítido).
const PIXELES = {
  cuerpo: [[3, 0, 1, 2], [4, 0, 2, 1], [4, 1, 1, 1], [6, 0, 6, 2], [12, 0, 2, 1], [13, 1, 1, 1], [14, 0, 1, 2], [2, 2, 1, 1], [3, 2, 1, 2], [4, 2, 10, 2], [14, 2, 1, 2], [15, 2, 1, 1]],
  ojos: [[5, 1, 1, 1], [12, 1, 1, 1]],
  brazos: [[1, 2, 1, 1], [16, 2, 1, 1]],
  brazosArriba: [[1, 0, 1, 2], [16, 0, 1, 2]],
  patasA: [[4, 4, 1, 1], [11, 4, 1, 1]],
  patasB: [[6, 4, 1, 1], [13, 4, 1, 1]]
};
function clawd() {
  // 18 × 5 celdas de 4 × 8 px, como los cuartos de carácter del Clawd en la terminal; la sexta
  // fila (vacía) queda fuera para que las patas pisen la barra.
  const caja = svg('clawd-svg', [], '0 0 18 5');
  caja.setAttribute('shape-rendering', 'crispEdges');
  caja.setAttribute('preserveAspectRatio', 'none');
  for (const [grupo, rects] of Object.entries(PIXELES)) {
    const g = document.createElementNS(SVG, 'g');
    g.setAttribute('class', 'c-' + grupo);
    for (const [x, y, w, alto] of rects) {
      const r = document.createElementNS(SVG, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', alto);
      g.append(r);
    }
    caja.append(g);
  }
  return h('div', { class: 'clawd', 'aria-hidden': 'true' },
    h('span', { class: 'clawd-globo' }, '!'),
    h('span', { class: 'clawd-z' }, 'z'),
    h('span', { class: 'clawd-z z2' }, 'z'),
    h('span', { class: 'clawd-brillo' }),
    caja);
}

// ── Ventanas ────────────────────────────────────────────

function ventana(s) {
  let v = ventanas.get(s.id);
  if (v) return v;
  const nombre = h('span', { class: 'v-nombre', title: 'Doble clic para renombrar' });
  // Modelo, esfuerzo y contexto reales (de la statusLine); un clic los cambia (sprint 15, M1).
  const modelo = h('button', { type: 'button', class: 'v-modelo', 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); menuModeloDe(s.id, modelo); } });
  const estado = h('span', { class: 'estado' }, h('span', { class: 'lamp' }), h('span', {}));
  // Hacer flujo (sprint 21, H1): dos cajas unidas, una etapa que lleva a la otra. Sin el preload nuevo (interfaz
  // recargada sin reiniciar la app) no aparece.
  const flujoBtn = h('button', { type: 'button', class: 'v-boton v-hacer-flujo', hidden: !api.hacerFlujo, title: 'Hacer flujo: que esta sesión proponga una receta con lo que se hizo', 'aria-label': 'Hacer flujo', onclick: (e) => { e.stopPropagation(); hacerFlujo(s.id); } },
    icono(['M4 5h6v5H4z', 'M14 14h6v5h-6z', 'M10 7.5h2.5v9H14']));
  const maxBtn = h('button', { type: 'button', class: 'v-boton', title: 'Maximizar (doble clic en la barra)', 'aria-label': 'Maximizar', onclick: (e) => { e.stopPropagation(); alternarMax(s.id); } },
    icono(['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5']));
  const cerrarBtn = h('button', { type: 'button', class: 'v-boton', title: 'Cerrar la sesión', 'aria-label': 'Cerrar la sesión', onclick: (e) => { e.stopPropagation(); cerrar(s.id, cerrarBtn); } },
    icono(ICONO_CERRAR));
  // Subagentes (sprint 14, A1): el chip abre o esconde sus cuadros al lado de la ventana.
  const subChip = h('button', { type: 'button', class: 'v-subchip', hidden: true, 'aria-expanded': 'false', onclick: (e) => { e.stopPropagation(); alternarSubagentes(s.id); } });
  const subs = h('div', { class: 'v-subs', hidden: true });
  // Orquesta (sprint 16, A1): en la coordinadora, un chip por cada sesión a su cargo; un clic lleva a ella.
  const orq = h('span', { class: 'v-orq', hidden: true });
  const barra = h('div', { class: 'v-barra' }, nombre, orq, subChip, flujoBtn, modelo, estado, maxBtn, cerrarBtn);
  const cuerpo = h('div', { class: 'v-cuerpo' });
  const retomarTexto = h('p', {});
  const retomar = h('div', { class: 'v-retomar', hidden: true }, retomarTexto,
    h('button', { type: 'button', class: 'boton principal', onclick: (e) => { e.stopPropagation(); retomarSesion(s.id); } }, 'Retomar la conversación'));
  cuerpo.append(retomar);
  const mascota = clawd();
  const el = h('section', { class: 'ventana', 'aria-label': s.nombre }, mascota, barra, cuerpo, subs,
    ['n', 's', 'e', 'o'].map((c) => h('div', { class: 'manija borde ' + c, 'data-borde': c })),
    ['no', 'ne', 'so', 'se'].map((c) => h('div', { class: 'manija esquina ' + c, 'data-borde': c })));
  $('#lienzo').appendChild(el);

  // Clic: con el lienzo alejado, acerca a 100 % sobre la ventana; si no, la elige.
  // La barra, los bordes y Alt+arrastrar mueven o estiran aunque el lienzo esté alejado.
  let soloAcercar = false;
  el.addEventListener('pointerdown', (e) => {
    if (vista().zoom < 0.97 && !el.classList.contains('max') && !e.altKey && !e.target.closest('.manija, .v-barra')) {
      e.preventDefault();
      e.stopPropagation();
      soloAcercar = true;
      centrarEn(posDeSesion(sesion(s.id)), 1);
      setTimeout(() => seleccionar(s.id), 300);
      return;
    }
    if (sel !== s.id) seleccionar(s.id, true);
  }, true);
  // Ese primer clic solo acerca: el botón que quedó debajo no se aprieta.
  el.addEventListener('click', (e) => { if (soloAcercar) { soloAcercar = false; e.preventDefault(); e.stopPropagation(); } }, true);
  barra.addEventListener('dblclick', (e) => { if (e.target === nombre) return; alternarMax(s.id); });
  nombre.addEventListener('dblclick', (e) => { e.stopPropagation(); renombrar(s.id, nombre); });
  barra.addEventListener('pointerdown', (e) => iniciarArrastre(e, s.id));
  for (const m of el.querySelectorAll('.manija')) m.addEventListener('pointerdown', (e) => iniciarRedimension(e, s.id, m.dataset.borde));
  // Alt + arrastrar desde cualquier parte de la ventana la mueve (sin pasar por la barra).
  el.addEventListener('pointerdown', (e) => { if (e.altKey && !el.classList.contains('max')) iniciarArrastre(e, s.id); }, true);

  const t = terminal(s.id);
  cuerpo.insertBefore(t.host, retomar);
  v = { el, nombre, modelo, estado, retomar, retomarTexto, cuerpo, mascota, subChip, subs, orq };
  ventanas.set(s.id, v);
  // Una sesión nueva parte con el tamaño de su ventana. Si todavía no se puede medir (oculta), parte igual al rato y se
  // ajusta al mostrarla. Las que abre la consola (flujos, MCP, CRM) esperan esto antes de partir solas. El respaldo va en
  // un temporizador propio: con Chocosys minimizada o tapada no hay cuadros de animación y el del cuadro no corría.
  const nueva = !s.viva && !s.iniciada && !abiertas.has(s.id);
  const partir = () => { if (abiertas.has(s.id) || (sesion(s.id) || {}).iniciada) return; abiertas.add(s.id); api.abrir(s.id, t.term.cols, t.term.rows); };
  if (nueva) setTimeout(partir, 1500);
  requestAnimationFrame(() => {
    if (ajustar(s.id) && nueva) partir();
  });
  return v;
}

// Una sesión «acoplada» (el asistente del CRM) se ve chica abajo a la derecha fuera del lienzo; su botón de agrandar
// la pasa a pantalla completa y otra vez la vuelve a chica, como cualquier ventana del espacio.
let acoplada = null;
const estaAcoplada = (s) => acoplada === s.id && modo !== 'lienzo' && maxima !== s.id;
function acoplar(id) {
  acoplada = id;
  pintar();
  requestAnimationFrame(() => { ajustar(id); const t = terminales.get(id); if (t) t.term.focus(); });
}
function pintarVentana(s) {
  const v = ventana(s);
  const enEste = s.espacio === actual;
  const visible = enEste && (modo === 'lienzo' || maxima === s.id || estaAcoplada(s));
  const recienVisible = visible && v.el.hidden;
  v.el.hidden = !visible;
  // Antes del ajuste: el ancho de celda depende del dibujo (GPU o normal).
  gpu(s.id, visible);
  if (!visible) return;
  // Oculta no se pudo medir: al aparecer toma el tamaño de su ventana.
  if (recienVisible) { const t = terminales.get(s.id); if (t) t.pendiente = true; requestAnimationFrame(() => ajustar(s.id)); }
  const p = posDeSesion(s);
  v.el.classList.toggle('acoplada', estaAcoplada(s));
  if (!v.el.classList.contains('arrastrando') && !v.el.classList.contains('redimensionando') && !v.el.classList.contains('max') && !estaAcoplada(s)) {
    v.el.style.left = p.x + 'px';
    v.el.style.top = p.y + 'px';
    v.el.style.width = p.w + 'px';
    v.el.style.height = p.h + 'px';
  }
  const apagada = !s.viva && s.estado === 'pausa';
  for (const e of ORDEN) v.el.classList.toggle('e-' + e, s.estado === e);
  v.el.classList.toggle('foco', s.id === sel);
  v.el.classList.toggle('apagada', apagada);
  v.el.classList.toggle('en-flujo', !!s.flujo);
  v.el.classList.toggle('max', maxima === s.id);
  if (!document.activeElement || !document.activeElement.classList.contains('v-nombre-editar')) v.nombre.textContent = s.nombre;
  v.nombre.title = s.carpeta;
  const l = s.linea;
  v.modelo.textContent = l && l.modelo ? [l.modelo, l.esfuerzo, l.contexto != null ? 'contexto ' + l.contexto + ' %' : ''].filter(Boolean).join(' · ') + ' ▾'
    : s.modelo ? `${nombreModelo(s.modelo)} ${s.esfuerzo} ▾` : s.viva ? 'modelo ▾' : '';
  v.modelo.hidden = !v.modelo.textContent;
  v.modelo.classList.toggle('espera', !!s.cambioPendiente);
  v.modelo.title = s.cambioPendiente ? `Cambia a ${nombreModelo(s.cambioPendiente.modelo) || s.cambioPendiente.modelo} ${s.cambioPendiente.esfuerzo || ''} cuando termine lo que está haciendo` : 'Modelo, esfuerzo y contexto que usa ahora. Clic para cambiarlos';
  v.mascota.className = 'clawd c-' + s.estado + (apagada ? ' c-cerrada' : '');
  v.estado.className = 'estado e-' + s.estado;
  v.estado.lastChild.textContent = ETIQUETA[s.estado];
  v.estado.title = subtitulo(s);
  pintarSubagentes(s, v);
  pintarOrquesta(s, v);
  const pausada = !s.viva && s.iniciada;
  v.retomar.hidden = !pausada;
  if (pausada) v.retomarTexto.textContent = s.ultimo ? `En pausa desde ${hace(s.cambio)}. Lo último: «${s.ultimo}».` : `En pausa desde ${hace(s.cambio)}.`;
  const destino = maxima === s.id || estaAcoplada(s) ? $('#capa-max') : $('#lienzo');
  if (v.el.parentElement !== destino) { destino.appendChild(v.el); requestAnimationFrame(() => ajustar(s.id)); }
  else if (v.acopladaAntes !== estaAcoplada(s)) requestAnimationFrame(() => ajustar(s.id));
  v.acopladaAntes = estaAcoplada(s);
}

function alternarMax(id) {
  maxima = maxima === id ? null : id;
  if (modo === 'bandeja' && !maxima) maxima = id;
  pintar();
  requestAnimationFrame(() => { ajustar(id); const t = terminales.get(id); if (t) t.term.focus(); });
}

// ── Arrastre: un solo mecanismo para mover ventanas, mover marcos y cambiar tamaños ──
// Captura el puntero (nada debajo recibe el arrastre: ni las terminales ni el texto), no parte hasta
// que el mouse se mueve 3 px (un clic en la barra no mueve nada), junta los movimientos en un cuadro
// por fotograma y, mientras dura, apaga la selección de texto en toda la ventana.
function arrastrar(e, { cursor, alMover, alSoltar }) {
  const origen = e.currentTarget || e.target;
  const inicio = { x: e.clientX, y: e.clientY };
  let activo = false;
  let ultimo = null;
  let cuadro = 0;
  try { origen.setPointerCapture(e.pointerId); } catch (err) { /* sin captura, sigue igual */ }
  const pintarCuadro = () => { cuadro = 0; if (ultimo) alMover(ultimo.x - inicio.x, ultimo.y - inicio.y, ultimo); };
  const mover = (ev) => {
    if (!activo) {
      if (Math.abs(ev.clientX - inicio.x) < 3 && Math.abs(ev.clientY - inicio.y) < 3) return;
      activo = true;
      document.body.classList.add('arrastrando-ui');
      if (cursor) document.body.style.cursor = cursor;
      const sel = window.getSelection && window.getSelection();
      if (sel) sel.removeAllRanges();
    }
    ultimo = { x: ev.clientX, y: ev.clientY, shift: ev.shiftKey };
    if (!cuadro) cuadro = requestAnimationFrame(pintarCuadro);
  };
  const soltar = () => {
    origen.removeEventListener('pointermove', mover);
    origen.removeEventListener('pointerup', soltar);
    origen.removeEventListener('pointercancel', soltar);
    origen.removeEventListener('lostpointercapture', soltar);
    if (cuadro) { cancelAnimationFrame(cuadro); pintarCuadro(); }
    document.body.classList.remove('arrastrando-ui');
    document.body.style.cursor = '';
    if (activo && alSoltar) alSoltar();
  };
  origen.addEventListener('pointermove', mover);
  origen.addEventListener('pointerup', soltar);
  origen.addEventListener('pointercancel', soltar);
  origen.addEventListener('lostpointercapture', soltar);
}

// Arrastrar la barra mueve la ventana (con Alt, desde cualquier parte); en un flujo, mueve el marco entero.
// Durante el arrastre se mueve con transform (no recalcula el diseño) y al soltar queda en left/top.
function iniciarArrastre(e, id) {
  if (e.button !== 0 || e.target.closest('button') || e.target.classList.contains('v-nombre-editar')) return;
  const s = sesion(id);
  if (!s || maxima === id) return;
  if (s.flujo) { iniciarArrastreMarco(e, s.flujo); return; }
  e.preventDefault();
  e.stopPropagation();
  const v = ventanas.get(id);
  const z = vista().zoom;
  const ini = { x: s.pos.x, y: s.pos.y };
  arrastrar(e, {
    cursor: 'grabbing',
    alMover: (dx, dy) => {
      v.el.classList.add('arrastrando');
      v.el.style.transform = `translate(${dx / z}px, ${dy / z}px)`;
      s.pos.x = Math.round(ini.x + dx / z);
      s.pos.y = Math.round(ini.y + dy / z);
    },
    alSoltar: () => {
      s.pos.x = alPaso(s.pos.x);
      s.pos.y = alPaso(s.pos.y);
      v.el.style.transform = '';
      v.el.style.left = s.pos.x + 'px';
      v.el.style.top = s.pos.y + 'px';
      v.el.classList.remove('arrastrando');
      // Movida a mano: el mosaico la deja donde quedó hasta «Ordenar».
      s.fija = true;
      api.posicion(id, s.pos, true);
    }
  });
}

// Bordes y esquinas. La terminal se reajusta mientras se arrastra (cada 90 ms), no solo al soltar.
const MINIMO = { w: 340, h: 200 };
function iniciarRedimension(e, id, borde) {
  if (e.button !== 0) return;
  const s = sesion(id);
  if (!s || s.flujo || maxima === id) return;
  e.preventDefault();
  e.stopPropagation();
  const v = ventanas.get(id);
  const z = vista().zoom;
  const ini = Object.assign({}, s.pos);
  arrastrar(e, {
    cursor: getComputedStyle(e.currentTarget).cursor,
    alMover: (dxp, dyp) => {
      const dx = dxp / z;
      const dy = dyp / z;
      let { x, y, w, h: alto } = ini;
      if (borde.includes('e')) w = ini.w + dx;
      if (borde.includes('o')) { w = ini.w - dx; x = ini.x + dx; }
      if (borde.includes('s')) alto = ini.h + dy;
      if (borde.includes('n')) { alto = ini.h - dy; y = ini.y + dy; }
      if (w < MINIMO.w) { if (borde.includes('o')) x -= MINIMO.w - w; w = MINIMO.w; }
      if (alto < MINIMO.h) { if (borde.includes('n')) y -= MINIMO.h - alto; alto = MINIMO.h; }
      s.pos = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(alto) };
      Object.assign(v.el.style, { left: s.pos.x + 'px', top: s.pos.y + 'px', width: s.pos.w + 'px', height: s.pos.h + 'px' });
      v.el.classList.add('redimensionando');
    },
    // La terminal cambia de tamaño una sola vez, al soltar: cada cambio hace que Claude Code se redibuje entero.
    alSoltar: () => {
      // Los cuatro bordes al paso; si el mínimo queda corto, crece un paso más.
      const x = alPaso(s.pos.x);
      const y = alPaso(s.pos.y);
      let w = alPaso(s.pos.x + s.pos.w) - x;
      let alto = alPaso(s.pos.y + s.pos.h) - y;
      while (w < MINIMO.w) w += PASO;
      while (alto < MINIMO.h) alto += PASO;
      s.pos = { x, y, w, h: alto };
      Object.assign(v.el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: alto + 'px' });
      v.el.classList.remove('redimensionando');
      s.fija = true;
      api.posicion(id, s.pos, true);
      ajustar(id);
    }
  });
}

// ── Marcos de flujo ─────────────────────────────────────

// Un flujo completo (o un simulacro que ya llegó a su puerta) no va a hacer nada más: se quita desde
// donde se lo vea (marco, bandeja y kanban), con el botón junto al nombre para que no quede fuera de la pantalla.
const terminado = (f) => f.estado === 'completo' || (f.simulacro && f.estado === 'puerta');
function botonQuitar(fid, texto, extra) {
  const b = h('button', { type: 'button', class: 'boton chico quitar-flujo' + (extra ? ' ' + extra : ''),
    title: 'Quita el flujo de la consola y cierra sus terminales. Los archivos quedan en su carpeta.',
    onclick: (e) => { e.stopPropagation(); confirmarDosVeces(b, { aviso: 'Confirmar: cierra sus terminales', clase: 'peligro', original: () => texto, alConfirmar: () => api.quitarFlujo(fid) }); } }, texto);
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
}
function quitarTerminados(boton) {
  const lista = delEspacio(flujos).filter(terminado);
  if (!lista.length) return;
  confirmarDosVeces(boton, { aviso: `Confirmar: quita ${lista.length} y cierra sus terminales`, clase: 'peligro', original: () => textoQuitarTerminados(),
    alConfirmar: async () => { for (const f of lista) await api.quitarFlujo(f.id); aviso(lista.length === 1 ? 'Flujo terminado quitado.' : `${lista.length} flujos terminados quitados.`); } });
}
function textoQuitarTerminados() {
  const n = delEspacio(flujos).filter(terminado).length;
  return n === 1 ? 'Quitar terminado' : `Quitar ${n} terminados`;
}

function marco(f) {
  let m = marcos.get(f.id);
  if (m) return m;
  const nombre = h('span', { class: 'marco-nombre' });
  const meta = h('span', { class: 'rotulo' });
  const quitar = botonQuitar(f.id, 'Quitar');
  const quitarListo = botonQuitar(f.id, 'Quitar flujo terminado', 'destacado');
  quitarListo.hidden = true;
  const cabeza = h('div', { class: 'marco-cabeza' }, h('span', { class: 'rotulo' }, 'Flujo'), nombre, meta, quitarListo,
    h('span', { class: 'marco-acciones' }, h('button', { type: 'button', class: 'boton chico', onclick: () => api.abrirCarpeta(f.carpeta) }, 'Carpeta'), quitar));
  const tuberia = h('div', { class: 'tuberia' });
  const falta = h('p', { class: 'marco-falta', hidden: true });
  const el = h('div', { class: 'marco' }, cabeza, tuberia, falta);
  $('#lienzo').insertBefore(el, $('#lienzo').children[1] || null);
  cabeza.addEventListener('pointerdown', (e) => iniciarArrastreMarco(e, f.id));
  m = { el, nombre, meta, tuberia, falta, quitarListo };
  marcos.set(f.id, m);
  return m;
}

function iniciarArrastreMarco(e, fid) {
  if (e.button !== 0 || e.target.closest('button')) return;
  const f = flujo(fid);
  if (!f) return;
  e.preventDefault();
  e.stopPropagation();
  const z = vista().zoom;
  const ini = { x: f.pos.x, y: f.pos.y };
  const m = marcos.get(fid);
  // Se mueven solo el marco y sus ventanas (antes se redibujaba el lienzo entero en cada movimiento).
  const piezas = () => [m.el, ...sesionesDe(f).map((x) => ventanas.get(x.id)).filter(Boolean).map((v) => v.el)];
  arrastrar(e, {
    cursor: 'grabbing',
    alMover: (dx, dy) => {
      m.el.classList.add('arrastrando');
      const t = `translate(${dx / z}px, ${dy / z}px)`;
      for (const el of piezas()) el.style.transform = t;
      f.pos = { x: Math.round(ini.x + dx / z), y: Math.round(ini.y + dy / z) };
    },
    alSoltar: () => {
      f.pos = { x: alPaso(f.pos.x), y: alPaso(f.pos.y) };
      for (const el of piezas()) el.style.transform = '';
      m.el.classList.remove('arrastrando');
      pintarLienzo();
      api.posicionFlujo(fid, f.pos);
    }
  });
}

function metaFlujo(f) {
  const pre = f.simulacro ? 'simulacro · ' : '';
  if (f.estado === 'completo') return pre + 'completo';
  if (f.estado === 'puerta') return pre + (f.simulacro ? 'llegó a la puerta' : 'puerta · te necesita');
  const etapas = f.items.filter((it) => it.tipo === 'etapa');
  const n = etapas.indexOf(f.items[f.actual]) + 1;
  return `${pre}etapa ${n} de ${etapas.length}`;
}

function pintarMarco(f) {
  const m = marco(f);
  m.el.hidden = f.espacio !== actual || modo !== 'lienzo';
  if (m.el.hidden) return;
  const p = posDeFlujo(f);
  const t = tamanoMarco(f);
  Object.assign(m.el.style, { left: p.x + 'px', top: p.y + 'px', width: t.w + 'px', height: t.h + 'px' });
  const necesita = f.estado === 'puerta' || sesionesDe(f).some((s) => s.estado === 'necesita');
  m.el.classList.toggle('necesita', necesita && !f.simulacro);
  const partes = f.nombre.split(' · ');
  m.nombre.replaceChildren(partes[0] + ' · ', h('em', {}, partes.slice(1).join(' · ') || ''));
  m.meta.textContent = metaFlujo(f);
  m.quitarListo.hidden = !terminado(f);
  // La cañería: nodos por etapa, válvulas por puerta; el tramo hacia la etapa activa fluye.
  const piezas = [];
  f.items.forEach((it, i) => {
    if (i > 0) {
      const previo = f.items[i - 1];
      const lleno = ['listo', 'abierta', 'saltada'].includes(previo.estado);
      piezas.push(h('span', { class: 'tubo' + (lleno ? ' lleno' : '') + (it.estado === 'trabajando' && lleno ? ' fluye' : '') }));
    }
    if (it.tipo === 'puerta') {
      const pide = it.estado === 'necesita';
      piezas.push(h('button', { type: 'button', class: 'valvula-paso ' + it.estado + (it.critica ? ' critica' : '') + (pide ? ' pide' : ''),
        title: it.critica ? 'Puerta crítica: se confirma dos veces' : 'Puerta',
        onclick: () => { if (pide) seleccionar('p:' + f.id); } }, valvula(), h('span', { class: 'paso-txt' }, it.nombre)));
    } else {
      const txt = it.nombre + (it.agentes > 1 ? ` ×${it.agentes}` : '') + (it.modelo ? ` · ${nombreModelo(it.modelo)}` : (it.eligiendo ? ' · eligiendo…' : ''));
      piezas.push(h('div', { class: 'paso ' + it.estado, title: it.motivoModelo || '' }, h('span', { class: 'nodo' }), h('span', { class: 'paso-txt' }, txt)));
    }
  });
  m.tuberia.replaceChildren(...piezas);
  const actualIt = f.items[f.actual];
  const falta = actualIt && actualIt.falta && actualIt.falta.length ? actualIt.falta : [];
  m.falta.hidden = !falta.length;
  if (falta.length) {
    m.falta.replaceChildren('Terminó, pero falta (o es de antes de esta etapa) ', ...falta.map((x, i) => [i ? ', ' : '', h('code', {}, x)]).flat(), '. ',
      actualIt.modelo === 'haiku' ? h('button', { type: 'button', class: 'boton chico', onclick: () => api.repetirEnOpus(f.id) }, 'Repetir en Opus') : null, ' ',
      h('button', { type: 'button', class: 'boton chico', onclick: () => api.seguirIgual(f.id) }, 'Seguir igual'));
  }
}

function pintarLienzo() {
  const e = espacio(actual);
  const titulo = $('#titulo-espacio');
  if (e && !document.querySelector('.titulo-editar')) titulo.textContent = e.nombre;
  titulo.hidden = modo !== 'lienzo';
  const vivosF = new Set(flujos.map((f) => f.id));
  for (const [fid, m] of marcos) if (!vivosF.has(fid)) { m.el.remove(); marcos.delete(fid); }
  for (const f of flujos) pintarMarco(f);
  const vivas = new Set(sesiones.map((s) => s.id));
  for (const [id, v] of ventanas) {
    if (vivas.has(id)) continue;
    const t = terminales.get(id);
    if (t) { t.term.dispose(); terminales.delete(id); }
    v.el.remove();
    ventanas.delete(id);
  }
  for (const s of sesiones) pintarVentana(s);
  pintarFlechasOrquesta();
  pintarBotonMosaico();
  // Si cambió cuántas ventanas hay en la pestaña, el mosaico las reparte (la firma evita trabajo si nada cambió).
  pedirMosaico();
}

// ── Bandeja (segunda vista) ─────────────────────────────

function fila(s) {
  let el = filas.get(s.id);
  if (!el) {
    el = h('button', { type: 'button', class: 'fila entra', onclick: () => seleccionar(s.id) },
      h('span', { class: 'lampara' }), h('span', { class: 'fila-cuerpo' }, h('span', { class: 'fila-nombre' }), h('span', { class: 'fila-sub' })), h('span', { class: 'fila-tiempo' }));
    el.addEventListener('animationend', () => el.classList.remove('entra'), { once: true });
    filas.set(s.id, el);
  }
  el.classList.remove('e-necesita', 'e-termino', 'e-trabajando', 'e-pausa');
  el.classList.add('e-' + s.estado);
  el.classList.toggle('sel', s.id === sel);
  el.querySelector('.fila-nombre').textContent = s.nombre;
  el.querySelector('.fila-sub').textContent = subtitulo(s);
  el.querySelector('.fila-tiempo').textContent = hace(s.cambio);
  el.title = s.carpeta;
  return el;
}
function colocar(contenedor, elementos) {
  elementos.forEach((el, i) => { if (contenedor.children[i] !== el) contenedor.insertBefore(el, contenedor.children[i] || null); });
  while (contenedor.children.length > elementos.length) contenedor.lastElementChild.remove();
}
function flujoBandeja(f) {
  let t = flujosBandeja.get(f.id);
  if (!t) {
    const nombre = h('span', { class: 'marco-nombre' });
    const meta = h('span', { class: 'flujo-b-meta' });
    const lista = h('div', { class: 'filas' });
    const quitar = botonQuitar(f.id, 'Quitar');
    const el = h('section', { class: 'flujo-b' }, h('div', { class: 'flujo-b-cabeza', onclick: () => { if (f.estado === 'puerta' && !f.simulacro) seleccionar('p:' + f.id); } }, nombre, meta, quitar), lista);
    t = { el, nombre, meta, lista, quitar };
    flujosBandeja.set(f.id, t);
  }
  const partes = f.nombre.split(' · ');
  t.nombre.replaceChildren(partes[0] + ' · ', h('em', {}, partes.slice(1).join(' · ')));
  t.meta.textContent = metaFlujo(f);
  t.el.classList.toggle('necesita', f.estado === 'puerta' && !f.simulacro);
  t.quitar.classList.toggle('destacado', terminado(f));
  colocar(t.lista, ordenar(sesionesDe(f)).map(fila));
  return t.el;
}
function pintarBandeja() {
  $('#bandeja').hidden = modo !== 'bandeja';
  if (modo !== 'bandeja') return;
  const antes = new Map();
  for (const [id, el] of filas) if (el.isConnected) antes.set(id, el.getBoundingClientRect().top);
  const vivas = new Set(sesiones.map((s) => s.id));
  for (const [id, el] of filas) if (!vivas.has(id)) { el.remove(); filas.delete(id); }
  colocar($('#flujos'), delEspacio(flujos).map(flujoBandeja));
  const sueltas = ordenar(delEspacio(sesiones).filter((s) => !s.flujo));
  for (const estado of ORDEN) {
    const grupo = document.querySelector(`.grupo[data-estado="${estado}"]`);
    const deEste = sueltas.filter((s) => s.estado === estado);
    grupo.hidden = deEste.length === 0;
    grupo.querySelector('.cuenta').textContent = deEste.length;
    colocar(grupo.querySelector('.filas'), deEste.map(fila));
  }
  if (movimientoReducido.matches) return;
  for (const [id, el] of filas) {
    const y0 = antes.get(id);
    if (y0 === undefined) continue;
    const dy = y0 - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' });
  }
}

// ── Vista Flujo (tercera vista): cada flujo como kanban ─
// Una columna por etapa, en orden; la puerta es una columna angosta con su válvula. La etapa activa
// se ensancha y las hechas se angostan; los agentes en paralelo se apilan en su columna.
// Clic en una tarjeta abre su terminal encima; la puerta abre su tarjeta.

let firmaFlujo = null;

function duracion(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + ' s';
  const min = Math.round(s / 60);
  if (min < 60) return min + ' min';
  return Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
}
const chipKb = (estado) => h('span', { class: 'kb-chip k-' + estado }, h('span', { class: 'kb-lamp' }), ETIQUETA[estado] || estado);

// Inicio y fin de una etapa: los registra el motor; un flujo anterior a eso los saca de sus sesiones.
function tiemposEtapa(f, idx) {
  const it = f.items[idx];
  const ses = (it.sesiones || []).map(sesion).filter(Boolean);
  let inicio = it.inicio || (ses.length ? Math.min(...ses.map((s) => s.creada || s.cambio)) : null);
  let fin = it.fin || (it.estado === 'listo' && ses.length ? Math.max(...ses.map((s) => s.cambio)) : null);
  if (it.tipo === 'puerta' && !inicio) {
    const previa = f.items.slice(0, idx).reverse().find((x) => x.tipo === 'etapa');
    const sp = previa ? (previa.sesiones || []).map(sesion).filter(Boolean) : [];
    if (sp.length) inicio = Math.max(...sp.map((s) => s.cambio));
  }
  return { inicio, fin };
}

function columnaPuerta(f, it, idx) {
  const pide = it.estado === 'necesita';
  const t = tiemposEtapa(f, idx);
  const tiempo = pide ? (t.inicio ? 'espera ' + duracion(Date.now() - t.inicio) : 'espera') : it.estado === 'abierta' && t.inicio && t.fin ? duracion(t.fin - t.inicio) : '';
  const tarjeta = h('div', { class: 'kb-tarj' + (pide ? ' pide' : it.estado === 'abierta' ? '' : ' fantasma') },
    h('div', { class: 'kb-nom' }, it.nombre),
    it.critica ? h('div', { class: 'kb-det' }, 'crítica · se confirma dos veces') : null,
    pide && !f.simulacro ? h('button', { type: 'button', class: 'boton brasa-boton chico', onclick: () => seleccionar('p:' + f.id) }, 'Abrir la puerta')
      : pide ? h('div', { class: 'kb-det' }, 'simulacro: termina acá')
      : it.estado === 'abierta' ? chipKb('listo') : null);
  return h('section', { class: 'kb-col puerta' + (pide && !f.simulacro ? ' pide activa' : '') + (it.estado === 'abierta' ? ' hecha' : '') },
    h('header', { class: 'kb-cab' }, h('div', { class: 'kb-fila1' }, h('b', {}, valvula(pide ? '' : 'apagada'), ' Puerta'), h('span', {}, tiempo))),
    h('div', { class: 'kb-carril' }, tarjeta));
}

function columnaEtapa(f, it, idx, n) {
  const ses = (it.sesiones || []).map(sesion).filter(Boolean);
  const pide = ses.some((s) => s.estado === 'necesita');
  const activa = it.estado === 'trabajando';
  const t = tiemposEtapa(f, idx);
  const tiempo = it.estado === 'listo' && t.inicio && t.fin ? duracion(t.fin - t.inicio) : activa && t.inicio ? 'hace ' + duracion(Date.now() - t.inicio) : it.estado === 'espera' ? 'después' : '';
  const listos = ses.filter((s) => s.listo).length;
  const sub = [it.modelo ? `${nombreModelo(it.modelo)} ${it.esfuerzo || ''}`.trim() : (it.eligiendo ? 'eligiendo modelo…' : (it.modeloConfig === 'auto' ? 'modelo auto' : nombreModelo(it.modeloConfig))),
    it.agentes > 1 ? (ses.length ? `${listos} de ${it.agentes} listos` : `${it.agentes} en paralelo`) : '', it.skill ? it.skill : ''].filter(Boolean).join(' · ');
  const tarjetas = ses.length
    ? ses.map((s) => {
      const estado = s.listo && s.estado !== 'necesita' ? 'listo' : s.estado;
      return h('button', { type: 'button', class: 'kb-tarj k-' + estado + (s.id === sel ? ' sel' : ''), title: s.carpeta, onclick: () => abrirDesdeKanban(s.id) },
        h('div', { class: 'kb-nom' }, s.nombre),
        h('div', { class: 'kb-det' }, subtitulo(s)),
        chipKb(estado));
    })
    : Array.from({ length: it.agentes }, (_, k) => h('div', { class: 'kb-tarj fantasma' },
      h('div', { class: 'kb-nom' }, it.agentes > 1 ? (f.nombres && f.nombres[k] ? `${it.nombre} · ${f.nombres[k]}` : `${it.nombre} ${k + 1}`) : it.nombre),
      it.traspaso ? h('div', { class: 'kb-det' }, it.traspaso.split('/').pop().replace('{i}', k + 1)) : null));
  const falta = it.falta && it.falta.length ? h('div', { class: 'kb-falta' }, 'Terminó sin dejar nuevo ', it.falta.map((x, i) => [i ? ', ' : '', h('code', {}, x.split('/').pop())]), '.',
    h('div', { class: 'kb-falta-acc' },
      it.modelo === 'haiku' ? h('button', { type: 'button', class: 'boton chico', onclick: () => api.repetirEnOpus(f.id) }, 'Repetir en Opus') : null,
      h('button', { type: 'button', class: 'boton chico', onclick: () => api.seguirIgual(f.id) }, 'Seguir igual'))) : null;
  return h('section', { class: 'kb-col' + (activa ? ' activa' : '') + (it.estado === 'listo' ? ' hecha' : '') + (pide ? ' pide' : '') },
    h('header', { class: 'kb-cab' },
      h('span', { class: 'kb-num' }, 'ETAPA ' + n),
      h('div', { class: 'kb-fila1' }, h('b', {}, it.nombre), h('span', {}, tiempo)),
      sub ? h('span', { class: 'kb-sub', title: it.motivoModelo || '' }, sub) : null),
    h('div', { class: 'kb-carril' }, tarjetas, falta));
}

// La sala directiva (sprint 7): con el flujo completo, una última columna con el veredicto y el botón para dejarlo
// como nota en el negocio. El veredicto se lee de su carpeta una vez y queda guardado acá.
function columnaVeredicto(f) {
  if (!salasVistas.has(f.id)) {
    salasVistas.set(f.id, null);
    api.sala.veredicto(f.id).then((v) => { salasVistas.set(f.id, v || { error: 'No se pudo leer la sala.' }); firmaFlujo = null; pintar(); });
  }
  const v = salasVistas.get(f.id);
  const j = v && v.veredicto;
  const etiqueta = j ? String(j.veredicto || '?') : '';
  const clase = /no hacerlo/.test(etiqueta) ? 'no' : /rehacer|esperar/.test(etiqueta) ? 'medio' : /condiciones/.test(etiqueta) ? 'cond' : 'si';
  const lista = (titulo, xs) => (xs && xs.length ? [h('h5', {}, titulo), h('ul', {}, xs.slice(0, 4).map((x) => h('li', {}, typeof x === 'string' ? x : `${x.que || ''}${x.quien ? ' · ' + x.quien : ''}${x.cuando ? ' · ' + x.cuando : ''}`)))] : null);
  const cuerpo = !v ? h('div', { class: 'kb-det' }, 'Leyendo el veredicto…')
    : !j ? h('div', { class: 'kb-falta' }, v.error || 'Todavía no hay VEREDICTO.json.')
      : h('div', { class: 'sala-ver' },
        h('div', { class: 'sala-etiqueta e-' + clase }, etiqueta, h('span', {}, j.puntaje !== undefined ? ` · ${j.puntaje}/10` : '')),
        h('div', { class: 'sala-scroll' },
        j.decision ? h('p', { class: 'sala-decision' }, j.decision) : null,
        (j.asientos || []).length ? h('ul', { class: 'sala-asientos' }, j.asientos.map((a) => h('li', {}, h('b', {}, String(a.asiento || '').split(' · ')[0]), ` ${a.nota ?? '?'}`, a.peso ? h('span', {}, ` ×${a.peso}`) : null))) : null,
        lista('Condiciones', j.condiciones), lista('Disidencia', j.disidencia), lista('Próximos pasos', j.pasos),
        (j.frenos || []).filter((x) => x && x !== 'ninguno').length ? h('div', { class: 'kb-det' }, 'Frenos: ' + j.frenos.join(', ')) : null,),
        h('div', { class: 'sala-acc' },
          v.registrado ? h('span', { class: 'kb-det' }, 'Quedó en el negocio el ' + v.registrado)
            : v.negocio_id ? h('button', { type: 'button', class: 'boton chico brasa-boton', onclick: async (ev) => {
              ev.target.disabled = true;
              try { const r = await api.sala.registrar(f.id); aviso(`Veredicto anotado en «${r.negocio}».`); salasVistas.delete(f.id); firmaFlujo = null; pintar(); }
              catch (err) { ev.target.disabled = false; aviso(String(err && err.message || err).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
            } }, 'Dejar como nota en el negocio') : h('span', { class: 'kb-det' }, 'No viene de un negocio del CRM'),
          h('button', { type: 'button', class: 'boton chico', title: v.carpeta, onclick: () => api.abrirCarpeta(v.carpeta) }, 'Ver la carpeta')),
        h('p', { class: 'sala-pie' }, j.pie || 'Los marcos vienen de la obra pública de cada autor, resumida por Claude. No son esas personas ni hablan por ellas.'));
  return h('section', { class: 'kb-col sala-col hecha' },
    h('header', { class: 'kb-cab' }, h('span', { class: 'kb-num' }, 'SALA'), h('div', { class: 'kb-fila1' }, h('b', {}, 'Veredicto'))),
    h('div', { class: 'kb-carril' }, cuerpo));
}

function tableroFlujo(f) {
  const columnas = [];
  let n = 0;
  f.items.forEach((it, idx) => {
    if (it.tipo === 'puerta' && it.estado === 'saltada') return;
    if (columnas.length) columnas.push(h('span', { class: 'kb-flecha', 'aria-hidden': 'true' }, '→'));
    columnas.push(it.tipo === 'puerta' ? columnaPuerta(f, it, idx) : columnaEtapa(f, it, idx, ++n));
  });
  if (f.sala && f.estado === 'completo') columnas.push(h('span', { class: 'kb-flecha', 'aria-hidden': 'true' }, '→'), columnaVeredicto(f));
  const partes = f.nombre.split(' · ');
  const necesita = (f.estado === 'puerta' && !f.simulacro) || sesionesDe(f).some((s) => s.estado === 'necesita');
  const estado = f.estado === 'completo' ? 'listo' : necesita ? 'necesita' : 'trabajando';
  const ultimoFin = Math.max(0, ...f.items.map((it) => it.fin || 0));
  const lleva = f.estado === 'completo' ? (ultimoFin ? 'tomó ' + duracion(ultimoFin - f.creado) : '') : 'lleva ' + duracion(Date.now() - f.creado);
  return h('article', { class: 'kb-flujo' },
    h('header', { class: 'kb-titulo' },
      h('h2', {}, partes[0] + ' · ', h('em', {}, partes.slice(1).join(' · '))),
      chipKb(estado),
      f.simulacro ? h('span', { class: 'kb-sub' }, 'simulacro') : null,
      h('span', { class: 'kb-resumen' }, [metaFlujo(f), lleva].filter(Boolean).join(' · ')),
      botonQuitar(f.id, terminado(f) ? 'Quitar flujo terminado' : 'Quitar', terminado(f) ? 'destacado' : '')),
    h('div', { class: 'kb-marco' },
      h('button', { type: 'button', class: 'kb-paso izq', 'aria-label': 'Ver las columnas anteriores', onclick: () => deslizarTablero(f.id, -1, true) }, '‹'),
      h('div', { class: 'kb-tablero', 'data-fid': f.id }, columnas),
      h('button', { type: 'button', class: 'kb-paso der', 'aria-label': 'Ver las columnas siguientes', onclick: () => deslizarTablero(f.id, 1, true) }, '›')));
}

// ── Recorrer el tablero ─────────────────────────────────
// La rueda vertical se vuelve horizontal (con inercia suave) mientras haya columnas hacia ese lado;
// en el borde, la rueda vuelve a bajar la página. El fondo del tablero se agarra y se arrastra.
// La posición vive por flujo (no por elemento), así un redibujo no la pierde.
const scrollTablero = new Map();   // fid -> { actual, objetivo, cuadro }
const centrados = new Set();
const tableroDe = (fid) => document.querySelector(`.kb-tablero[data-fid="${fid}"]`);
function bordesTablero(t) {
  const marco = t.parentElement;
  const max = t.scrollWidth - t.clientWidth;
  marco.classList.toggle('hay-izq', t.scrollLeft > 4);
  marco.classList.toggle('hay-der', t.scrollLeft < max - 4);
}
function deslizarTablero(fid, cuanto, porPagina) {
  const t = tableroDe(fid);
  if (!t) return;
  const max = Math.max(0, t.scrollWidth - t.clientWidth);
  const e = scrollTablero.get(fid) || { actual: t.scrollLeft, objetivo: t.scrollLeft, cuadro: 0 };
  if (!e.cuadro) e.actual = t.scrollLeft;
  const paso = porPagina ? cuanto * Math.max(240, t.clientWidth * 0.75) : cuanto;
  e.objetivo = Math.max(0, Math.min(max, (e.cuadro ? e.objetivo : t.scrollLeft) + paso));
  scrollTablero.set(fid, e);
  if (movimientoReducido.matches) { t.scrollLeft = e.objetivo; bordesTablero(t); return; }
  if (e.cuadro) return;
  const correr = () => {
    const tt = tableroDe(fid);
    if (!tt) { e.cuadro = 0; return; }
    e.actual += (e.objetivo - e.actual) * 0.2;
    if (Math.abs(e.objetivo - e.actual) < 0.6) e.actual = e.objetivo;
    tt.scrollLeft = e.actual;
    bordesTablero(tt);
    e.cuadro = e.actual === e.objetivo ? 0 : requestAnimationFrame(correr);
  };
  e.cuadro = requestAnimationFrame(correr);
}
function centrarEtapaActiva(t) {
  const activa = t.querySelector('.kb-col.activa, .kb-col.pide');
  if (!activa) return;
  t.scrollLeft = Math.max(0, activa.offsetLeft - (t.clientWidth - activa.offsetWidth) / 2);
}
$('#vista-flujo').addEventListener('wheel', (e) => {
  const t = e.target.closest('.kb-tablero');
  if (!t || e.ctrlKey) return;
  const max = t.scrollWidth - t.clientWidth;
  if (max <= 0) return;
  // Un touchpad que ya desliza hacia los lados se deja tal cual: es nativo y suave.
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  const delta = e.deltaY * (e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? t.clientWidth : 1);
  const e2 = scrollTablero.get(t.dataset.fid);
  const donde = e2 && e2.cuadro ? e2.objetivo : t.scrollLeft;
  if ((delta < 0 && donde <= 0) || (delta > 0 && donde >= max)) return;
  e.preventDefault();
  deslizarTablero(t.dataset.fid, delta * 1.2);
}, { passive: false });
$('#vista-flujo').addEventListener('scroll', (e) => { if (e.target.classList && e.target.classList.contains('kb-tablero')) bordesTablero(e.target); }, true);
$('#vista-flujo').addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.kb-tablero');
  if (!t || e.button !== 0 || e.target.closest('button, .kb-tarj, a, input')) return;
  e.preventDefault();
  const fid = t.dataset.fid;
  const inicio = t.scrollLeft;
  const s = scrollTablero.get(fid);
  if (s && s.cuadro) { cancelAnimationFrame(s.cuadro); s.cuadro = 0; }
  arrastrar(e, {
    cursor: 'grabbing',
    alMover: (dx) => { const tt = tableroDe(fid); if (tt) { tt.scrollLeft = inicio - dx; bordesTablero(tt); } }
  });
});

function abrirDesdeKanban(id) {
  maxima = id;
  seleccionar(id);
}

function pintarFlujo() {
  const cont = $('#vista-flujo');
  // Con una terminal abierta encima (maxima), el kanban se oculta; al achicarla, vuelve.
  cont.hidden = modo !== 'flujo' || !!maxima;
  if (modo !== 'flujo') { firmaFlujo = null; return; }
  const deEste = delEspacio(flujos);
  const sueltas = ordenar(delEspacio(sesiones).filter((s) => !s.flujo));
  // Se redibuja solo si cambió algo que se ve (o pasó un minuto), para no perder el scroll ni el hover.
  const firma = JSON.stringify([actual, sel, Math.floor(Date.now() / 60000), deEste, sueltas.map((s) => [s.id, s.estado, s.nombre, s.ultimo, s.mensaje]),
    sesiones.filter((s) => s.flujo && s.espacio === actual).map((s) => [s.id, s.estado, s.listo, s.ultimo, s.mensaje, s.nombre])]);
  if (firma === firmaFlujo) return;
  firmaFlujo = firma;
  const tableros = new Map([...cont.querySelectorAll('.kb-tablero')].map((t) => [t.dataset.fid, t.scrollLeft]));
  const y = cont.scrollTop;
  const hijos = deEste.slice().sort((a, b) => b.creado - a.creado).map(tableroFlujo);
  if (sueltas.length) hijos.push(h('article', { class: 'kb-flujo sueltas' },
    h('header', { class: 'kb-titulo' }, h('h2', {}, 'Sesiones sueltas'), h('span', { class: 'kb-resumen' }, sueltas.length + (sueltas.length === 1 ? ' sesión' : ' sesiones'))),
    h('div', { class: 'kb-sueltas' }, sueltas.map((s) => h('button', { type: 'button', class: 'kb-tarj k-' + s.estado + (s.id === sel ? ' sel' : ''), title: s.carpeta, onclick: () => abrirDesdeKanban(s.id) },
      h('div', { class: 'kb-nom' }, s.nombre), h('div', { class: 'kb-det' }, subtitulo(s)), chipKb(s.estado))))));
  if (!hijos.length) hijos.push(h('p', { class: 'kb-vacio' }, 'No hay flujos en este espacio. Lanza uno con «Lanzar flujo».'));
  cont.replaceChildren(...hijos);
  cont.scrollTop = y;
  cont.querySelectorAll('.kb-tablero').forEach((t) => {
    const fid = t.dataset.fid;
    const s = scrollTablero.get(fid);
    // La primera vez que aparece un flujo, se centra en su etapa activa; después se respeta donde lo dejaste.
    if (s && s.cuadro) t.scrollLeft = s.actual;
    else if (tableros.has(fid)) t.scrollLeft = tableros.get(fid);
    else if (!centrados.has(fid)) { centrados.add(fid); requestAnimationFrame(() => { centrarEtapaActiva(t); bordesTablero(t); }); }
    bordesTablero(t);
  });
}

// ── Barra superior, puerta y estado general ─────────────

let borrandoEspacio = null;
function pintarBarra() {
  const cont = $('#espacios');
  const editando = cont.querySelector('.pill-nombre-editar');
  if (!editando) {
    cont.replaceChildren(...espacios.map((e) => {
      const n = sesiones.filter((s) => s.espacio === e.id).length;
      const pide = sesiones.some((s) => s.espacio === e.id && s.estado === 'necesita') || flujos.some((f) => f.espacio === e.id && f.estado === 'puerta' && !f.simulacro);
      const enEsta = e.id === actual && modo !== 'inicio';
      // Un punto por sesión (sprint 19, T1); al dejar el mouse encima, su lista (mostrarPestana).
      const b = h('button', { type: 'button', class: 'pill' + (enEsta ? ' activa' : '') + (pide && !enEsta ? ' alarma' : ''), 'data-esp': e.id, title: e.nombre,
        onclick: () => { ocultarPestana(); if (modo === 'inicio') cambiarModo(modoPrevio || 'lienzo'); cambiarEspacio(e.id); } }, e.nombre, n ? puntosDe(e.id) : h('span', { class: 'cuenta-pill' }, '0'));
      b.addEventListener('dblclick', () => renombrarEspacioEn(b, e));
      if (modo === 'inicio') return b;
      // Borrar: solo el espacio a la vista y nunca el último. Si tiene sesiones o flujos, se elige qué pasa con
      // ellos: cerrarlos todos (el espacio desaparece de verdad) o pasarlos a otro espacio.
      if (e.id !== actual || espacios.length <= 1) return b;
      const destino = espacios.find((x) => x.id !== e.id);
      const fl = flujos.filter((f) => f.espacio === e.id);
      const sueltas = sesiones.filter((s) => s.espacio === e.id && !s.flujo);
      const cuenta = [fl.length ? `${fl.length} ${fl.length === 1 ? 'flujo' : 'flujos'}` : '', sueltas.length ? `${sueltas.length} ${sueltas.length === 1 ? 'sesión' : 'sesiones'}` : ''].filter(Boolean).join(' y ');
      // Al borrar una pestaña se vuelve al Inicio.
      const irse = async () => { const nuevo = await api.borrarEspacio(e.id); borrandoEspacio = null; if (nuevo) { vistas.delete(e.id); actual = nuevo; aplicarVista(false); cambiarModo('inicio'); } };
      // La pregunta vive en borrandoEspacio (no en el botón), así sobrevive a los repintados de la barra.
      if (borrandoEspacio === e.id) {
        const cancelar = h('button', { type: 'button', class: 'pill-borrar', title: 'No borrar', 'aria-label': 'No borrar' }, 'No');
        cancelar.addEventListener('click', () => { borrandoEspacio = null; pintarBarra(); });
        if (!cuenta) {
          const si = h('button', { type: 'button', class: 'pill-borrar confirmar' }, 'Borrar el espacio vacío');
          si.addEventListener('click', irse);
          return h('span', { class: 'pill-grupo' }, b, si, cancelar);
        }
        const cerrarTodo = h('button', { type: 'button', class: 'pill-borrar confirmar', title: 'Cierra sus terminales y quita sus flujos; los archivos quedan en sus carpetas' }, `Cerrar ${cuenta} y borrar`);
        cerrarTodo.addEventListener('click', async () => {
          for (const f of fl) await api.quitarFlujo(f.id);
          for (const s of sueltas) await api.cerrar(s.id);
          await irse();
        });
        const pasar = h('button', { type: 'button', class: 'pill-borrar opcion' }, `Pasarlos a «${destino.nombre}»`);
        pasar.addEventListener('click', irse);
        return h('span', { class: 'pill-grupo' }, b, cerrarTodo, pasar, cancelar);
      }
      const borrar = h('button', { type: 'button', class: 'pill-borrar', title: 'Borrar este espacio', 'aria-label': 'Borrar este espacio' }, '×');
      borrar.addEventListener('click', () => {
        borrandoEspacio = e.id;
        clearTimeout(pintarBarra.espera);
        pintarBarra.espera = setTimeout(() => { if (borrandoEspacio === e.id) { borrandoEspacio = null; pintarBarra(); } }, PLAZO_CONFIRMAR * 2);
        pintarBarra();
      });
      return h('span', { class: 'pill-grupo' }, b, borrar);
    }));
    // Al cambiar de pestaña, la activa queda a la vista aunque haya muchas.
    const activa = cont.querySelector('.pill.activa');
    if (activa && pintarBarra.ultima !== actual) { pintarBarra.ultima = actual; (activa.closest('.pill-grupo') || activa).scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  verFlechas();
  pintarPlan();
  const vivas = sesiones.filter((s) => s.viva).length;
  $('#vivas-txt').textContent = vivas === 1 ? '1 viva' : vivas + ' vivas';
  const trab = sesiones.filter((s) => s.estado === 'trabajando').length;
  $('#trabajando-txt').textContent = trab === 0 ? 'nadie trabajando' : (trab === 1 ? '1 trabajando' : trab + ' trabajando');
  $('#trabajando').classList.toggle('activo', trab > 0);
  if (!$('#lista-trabajando').hidden) pintarTrabajando();
  const n = ronda(true).length;
  $('#necesitan-txt').textContent = n === 0 ? 'nada pendiente' : (n === 1 ? '1 por revisar' : n + ' por revisar');
  $('#necesitan').classList.toggle('alarma', n > 0);
  $('#chip-siguiente').classList.toggle('alerta', n > 0);
  const terminados = delEspacio(flujos).filter(terminado).length;
  const chipQ = $('#chip-quitar-terminados');
  chipQ.hidden = !terminados;
  if (!chipQ.classList.contains('peligro')) chipQ.textContent = textoQuitarTerminados();
  $('#tema-txt').textContent = TEMAS[temaActual()].nombre;
  verPista();
  for (const m of MODOS) {
    $('#modo-' + m).classList.toggle('on', modo === m);
    $('#modo-' + m).setAttribute('aria-pressed', String(modo === m));
  }
  $('#ir-inicio').classList.toggle('activa', modo === 'inicio');
  $('#zoom').hidden = modo !== 'lienzo';
  $('#vista-lienzo').hidden = modo !== 'lienzo';
  // La tarjeta de espacio vacío es del lienzo y la bandeja: el kanban y el CRM tienen su propia pantalla.
  $('#vacio').hidden = delEspacio(sesiones).length > 0 || delEspacio(flujos).length > 0 || ['crm', 'flujo', 'inicio'].includes(modo);
}

function etapaAnterior(f, idx) {
  for (let i = idx - 1; i >= 0; i--) if (f.items[i].tipo === 'etapa') return f.items[i];
  return null;
}
function pintarPuerta() {
  const f = esPuerta(sel) ? flujo(sel.slice(2)) : null;
  const ver = !!f && f.estado === 'puerta';
  $('#puerta').hidden = !ver;
  // Con una puerta a la vista, el CSS personal (lo puede escribir el MCP) se apaga: no puede estirar ni tapar «Aprobar».
  const personal = document.getElementById('estilo-personal');
  if (personal) personal.disabled = ver;
  if (!ver) return;
  const puerta = f.items[f.actual];
  const previa = etapaAnterior(f, f.actual);
  const siguienteEtapa = f.items.slice(f.actual + 1).find((x) => x.tipo === 'etapa');
  $('#puerta-titulo').textContent = puerta ? puerta.nombre : '';
  let texto = previa ? `Terminó la etapa «${previa.nombre}». Revisa lo que dejó antes de seguir; la siguiente no parte hasta que apruebes.` : 'Revisa antes de seguir.';
  if (puerta && puerta.elegir && previa) texto = `Terminó «${previa.nombre}». Ve fila por fila con H, D o N (o marca con clic); lo que vence esta semana viene sugerido.`;
  if (puerta && puerta.critica && siguienteEtapa) texto += ` Es una puerta crítica: «${siguienteEtapa.nombre}» hace algo que no se deshace, por eso se confirma dos veces.`;
  if (f.simulacro) texto = (previa ? `Terminó la etapa «${previa.nombre}». ` : '') + 'Es un simulacro: el flujo termina en esta puerta y no se puede aprobar.';
  $('#puerta-texto').textContent = texto;
  const rotulo = $('.puerta-rotulo span');
  if (rotulo) rotulo.textContent = f.simulacro ? 'Puerta · simulacro' : 'Puerta · espera tu OK';
  $('#puerta-aprobar').hidden = !!f.simulacro;
  $('#puerta-pedir').hidden = !!f.simulacro;
  $('#puerta-etiqueta').textContent = previa ? `La indicación va a ${previa.agentes > 1 ? 'las ' + previa.agentes + ' sesiones' : 'la sesión'} de «${previa.nombre}»` : '';
  pintarContenidoPuerta(f, puerta);
}

// ── Puerta desplegada ───────────────────────────────────
// La tarjeta muestra lo que dejó la etapa anterior. Si la puerta es de elegir (elegir: true en la receta),
// la lista numerada se vuelve marcable: H, D o N decide la fila activa y salta a la siguiente sin decidir.

const eleccion = { clave: null, cargando: false, archivos: [], archivo: null, items: [], resto: [], decididos: new Set(), activo: 0, version: 0, pintado: null };

function fechaDe(texto) {
  if (/^sin fecha/i.test(texto)) return null;
  const m = texto.match(/(\d{2})-(\d{2})/);
  if (!m) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const d = new Date(hoy.getFullYear(), Number(m[2]) - 1, Number(m[1]));
  if (d - hoy < -180 * 864e5) d.setFullYear(d.getFullYear() + 1);
  return Math.round((d - hoy) / 864e5);
}
// «N. ramo · qué · fecha · tipo · navegador»: se lee desde el final; si la línea no tiene esa forma, va entera.
function leerItems(texto) {
  const lineas = texto.split(/\r?\n/);
  const items = [];
  let ultimo = -1;
  lineas.forEach((l, i) => {
    const m = l.match(/^(\d+)\.\s+(.*)$/);
    if (!m) return;
    ultimo = i;
    let cuerpo = m[2];
    const no = /\s\[no\]\s*$/.test(cuerpo);
    cuerpo = cuerpo.replace(/\s*\[no\]\s*$/, '');
    const p = cuerpo.split(' · ');
    const it = { n: Number(m[1]), ramo: '', que: cuerpo, fecha: '', tipo: '', nav: false, dias: null, estado: 'despues' };
    if (p.length >= 4) {
      it.nav = p[p.length - 1].trim() === 'navegador';
      if (it.nav) p.pop();
      it.tipo = p.pop(); it.fecha = p.pop(); it.ramo = p.shift(); it.que = p.join(' · ');
      it.dias = fechaDe(it.fecha);
    }
    it.que = it.que.replace(/`/g, '');
    it.marcadoNo = no;
    items.push(it);
  });
  // Lo que viene después de la lista (fuera de la lista, lo no verificado), sin la elección anterior.
  const resto = ultimo < 0 ? [] : lineas.slice(ultimo + 1);
  const corte = resto.findIndex((l) => /^##\s+Elección de /.test(l));
  return { items, resto: corte < 0 ? resto : resto.slice(0, corte) };
}

async function cargarPuerta(f, clave) {
  eleccion.cargando = true;
  let archivos = [];
  try { archivos = await api.traspasos(f.id); } catch (e) { /* se muestra vacío */ }
  eleccion.cargando = false;
  eleccion.clave = clave;
  eleccion.archivos = archivos || [];
  const conLista = eleccion.archivos.find((a) => a.texto && /^\d+\.\s/m.test(a.texto));
  eleccion.archivo = conLista ? conLista.ruta : null;
  const leido = conLista ? leerItems(conLista.texto) : { items: [], resto: [] };
  eleccion.items = leido.items;
  eleccion.resto = leido.resto;
  eleccion.decididos = new Set();
  // Sugerido: lo que vence en 7 días o menos. Lo que ya venía con [no] queda decidido como «después».
  for (const it of eleccion.items) {
    if (it.marcadoNo) { it.estado = 'despues'; eleccion.decididos.add(it.n); }
    else it.estado = it.dias !== null && it.dias <= 7 ? 'hoy' : 'despues';
  }
  eleccion.activo = Math.max(0, eleccion.items.findIndex((it) => !eleccion.decididos.has(it.n)));
  eleccion.version++;
  pintarPuerta();
}

function eligiendo() {
  const f = esPuerta(sel) ? flujo(sel.slice(2)) : null;
  const puerta = f && f.estado === 'puerta' ? f.items[f.actual] : null;
  return !!(puerta && puerta.elegir && eleccion.items.length && !$('#puerta').hidden);
}
function decidir(estado) {
  const it = eleccion.items[eleccion.activo];
  if (!it) return;
  it.estado = estado;
  eleccion.decididos.add(it.n);
  const tot = eleccion.items.length;
  for (let k = 1; k <= tot; k++) {
    const j = (eleccion.activo + k) % tot;
    if (!eleccion.decididos.has(eleccion.items[j].n)) { eleccion.activo = j; break; }
  }
  eleccion.version++;
  eleccion.mover = true;
  pintarPuerta();
}
function moverActivo(paso) {
  eleccion.activo = Math.max(0, Math.min(eleccion.items.length - 1, eleccion.activo + paso));
  eleccion.version++;
  eleccion.mover = true;
  pintarPuerta();
}
function cambiarTodas(fn) { eleccion.items.forEach(fn); eleccion.version++; pintarPuerta(); }

const plazoTexto = (d) => d === null ? 'sin fecha' : d < 0 ? `hace ${-d} ${d === -1 ? 'día' : 'días'}` : d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`;
const fechaCorta = (t) => t.split(/[,;(]/)[0].trim();

// Markdown mínimo y seguro (sin innerHTML): títulos, viñetas, negrita y código.
function enLinea(texto) {
  return texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map((t) =>
    t.startsWith('**') ? h('strong', {}, t.slice(2, -2)) : t.startsWith('`') ? h('code', {}, t.slice(1, -1)) : t);
}
function markdown(texto) {
  const out = [];
  let lista = null;
  for (const l of texto.split(/\r?\n/)) {
    const v = l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (v) { if (!lista) { lista = h('ul', {}); out.push(lista); } lista.append(h('li', {}, enLinea(v[1]))); continue; }
    lista = null;
    const t = l.match(/^(#{1,4})\s+(.*)$/);
    if (t) out.push(h('div', { class: 'el-md-t' }, enLinea(t[2])));
    else if (l.trim()) out.push(h('p', {}, enLinea(l)));
  }
  return out;
}

function pintarContenidoPuerta(f, puerta) {
  const caja = $('#puerta-contenido');
  const tarjeta = $('#puerta .puerta-tarjeta');
  const clave = f.id + ':' + f.actual + ':' + f.cambio;
  if (eleccion.clave !== clave && !eleccion.cargando) { cargarPuerta(f, clave); return; }
  if (eleccion.clave !== clave) return;
  const elegir = !!puerta.elegir && eleccion.items.length > 0;
  const siguienteEtapa = f.items.slice(f.actual + 1).find((x) => x.tipo === 'etapa');
  const n = eleccion.items.filter((x) => x.estado === 'hoy').length;
  // Los archivos: un clic los abre.
  $('#puerta-archivos').replaceChildren(...eleccion.archivos.map((a) => h('li', {},
    h('button', { type: 'button', class: 'el-archivo', title: 'Abrir ' + a.abs, onclick: () => api.abrirCarpeta(a.abs) }, a.ruta, a.texto === null ? ' · no está' : ''),
    elegir && a.ruta === eleccion.archivo ? h('span', { class: 'el-nota-in' }, ' · lo que no va hoy queda con [no] en su línea') : null)));
  restaurarTextoAprobar(!elegir ? 'Aprobar y seguir ' : n === 0 ? 'Seguir sin elegir nada ' : `Aprobar ${n} y seguir `);
  const firma = clave + ':' + eleccion.version + ':' + (elegir ? 'e' : 'l');
  if (eleccion.pintado === firma) return;
  eleccion.pintado = firma;
  const lista0 = caja.querySelector('.el-lista, .el-md');
  const y = lista0 ? lista0.scrollTop : 0;
  const conTexto = eleccion.archivos.filter((a) => a.texto);
  caja.hidden = !elegir && !conTexto.length;
  tarjeta.classList.toggle('ancha', !caja.hidden);
  if (caja.hidden) { caja.replaceChildren(); return; }
  if (!elegir) {
    caja.replaceChildren(h('div', { class: 'el-md' }, conTexto.map((a) => [conTexto.length > 1 ? h('div', { class: 'el-md-t' }, a.ruta) : null, markdown(a.texto)])));
    caja.querySelector('.el-md').scrollTop = y;
    return;
  }
  const items = eleccion.items;
  const tot = items.length;
  const hoyIt = items.filter((x) => x.estado === 'hoy');
  const prep = hoyIt.filter((x) => !x.nav);
  const nav = hoyIt.filter((x) => x.nav);
  const hayNav = items.some((x) => x.nav);
  const agentes = siguienteEtapa ? siguienteEtapa.agentes || 1 : 1;
  const urgentesFuera = items.filter((x) => x.dias !== null && x.dias <= 2 && x.estado !== 'hoy').length;
  const listos = eleccion.decididos.size;
  const cifra = (num, txt, brasa) => h('div', { class: 'el-cifra' + (brasa ? ' alerta' : '') }, h('div', { class: 'el-n' }, String(num)), h('div', { class: 'el-l' }, txt));
  const medidor = h('div', { class: 'el-medidor' },
    cifra(n, `de ${tot} van hoy`, true),
    cifra(hayNav ? prep.length : n, (siguienteEtapa ? `a ${siguienteEtapa.nombre.toLowerCase()}` : 'a la siguiente') + (agentes > 1 ? ` · ${agentes} agentes` : '')),
    hayNav ? cifra(nav.length, 'al navegador, de a uno') : null,
    cifra(urgentesFuera, urgentesFuera ? 'vencen en 2 días y no van' : 'urgentes fuera: ninguno', urgentesFuera > 0));
  const barraCarga = h('div', { class: 'el-barra' },
    h('i', { class: 'b-hoy', style: `width:${(hayNav ? prep.length : n) / tot * 100}%` }),
    h('i', { class: 'b-nav', style: `width:${(hayNav ? nav.length : 0) / tot * 100}%` }));
  const progreso = h('div', { class: 'el-progreso' }, h('span', {}, listos === tot ? 'Todo decidido' : `Decidiste ${listos} de ${tot}`), listos === tot ? null : h('span', {}, `${tot - listos} sin mirar`));
  const barraAvance = h('div', { class: 'el-barra delgada' }, h('i', { class: 'b-avance', style: `width:${listos / tot * 100}%` }));
  const atajo = (txt, fn) => h('button', { type: 'button', class: 'boton chico', onclick: fn }, txt);
  const atajos = h('div', { class: 'el-atajos' },
    atajo('Aceptar las sugerencias', () => cambiarTodas((x) => eleccion.decididos.add(x.n))),
    atajo('Solo lo de 2 días', () => cambiarTodas((x) => { x.estado = x.dias !== null && x.dias <= 2 ? 'hoy' : 'despues'; eleccion.decididos.add(x.n); })),
    hayNav ? atajo('Sin navegador', () => cambiarTodas((x) => { if (x.nav && x.estado === 'hoy') { x.estado = 'despues'; eleccion.decididos.add(x.n); } })) : null,
    atajo('Empezar de nuevo', () => { cargarPuerta(f, clave); }));
  const filaEleccion = (it, idx) => {
    const es = idx === eleccion.activo;
    const marca = h('span', { class: 'el-caja', role: 'checkbox', 'aria-checked': String(it.estado === 'hoy'), onclick: (e) => { e.stopPropagation(); it.estado = it.estado === 'hoy' ? 'despues' : 'hoy'; eleccion.decididos.add(it.n); eleccion.version++; pintarPuerta(); } },
      svg('', ['M2 6.5l2.5 2.5L10 3'], '0 0 12 12'));
    const boton = (txt, tecla, estado, brasa) => h('button', { type: 'button', class: 'boton' + (brasa ? ' brasa-boton' : ''), onclick: (e) => { e.stopPropagation(); eleccion.activo = idx; decidir(estado); } }, txt, h('kbd', {}, tecla));
    return h('div', { class: 'el-item' + (it.estado === 'hoy' ? ' si' : '') + (it.estado === 'no' ? ' no' : '') + (es ? ' activo' : '') + (eleccion.decididos.has(it.n) ? '' : ' pend'),
      onclick: () => { eleccion.activo = idx; eleccion.version++; pintarPuerta(); } },
      marca,
      h('div', {},
        h('div', { class: 'el-que' }, h('span', { class: 'el-num' }, it.n), it.ramo ? [h('span', { class: 'el-ramo' }, it.ramo), ' · '] : null, it.que),
        h('div', { class: 'el-meta' }, it.tipo ? h('span', { class: 'el-tag' }, it.tipo) : null, it.nav ? h('span', { class: 'el-tag nav' }, 'navegador') : null,
          eleccion.decididos.has(it.n) ? null : h('span', { class: 'el-tag sug' }, it.estado === 'hoy' ? 'sugerido: hoy' : 'sin decidir')),
        es ? h('div', { class: 'el-decide' }, boton('Hoy', 'H', 'hoy', true), boton('Después', 'D', 'despues'), boton('No', 'N', 'no'), h('span', { class: 'el-pista' }, '↑ ↓ para moverte')) : null),
      it.fecha ? h('div', { class: 'el-plazo' + (it.dias !== null && it.dias <= 2 ? ' urge' : '') }, plazoTexto(it.dias), h('span', {}, fechaCorta(it.fecha))) : h('span'));
  };
  const grupos = [['Esta semana', (d) => d !== null && d <= 7], ['Más adelante', (d) => d !== null && d > 7], ['Sin fecha', (d) => d === null]];
  const lista = h('div', { class: 'el-lista' }, grupos.map(([titulo, cumple]) => {
    const de = items.map((x, i) => [x, i]).filter(([x]) => cumple(x.dias));
    if (!de.length) return null;
    return [h('div', { class: 'el-grupo' }, h('span', {}, titulo), h('span', {}, `${de.filter(([x]) => x.estado === 'hoy').length} de ${de.length} hoy`)), de.map(([x, i]) => filaEleccion(x, i))];
  }));
  const resto = eleccion.resto.join('\n').trim();
  caja.replaceChildren(medidor, barraCarga, h('div', { class: 'el-cabeza' }, atajos, progreso), barraAvance, lista,
    resto ? h('details', { class: 'el-fuera' }, h('summary', {}, 'El resto del archivo'), h('div', { class: 'el-md' }, markdown(resto))) : null);
  lista.scrollTop = y;
  if (eleccion.mover) {
    eleccion.mover = false;
    const a = lista.querySelector('.el-item.activo');
    if (a) a.scrollIntoView({ block: 'nearest', behavior: movimientoReducido.matches ? 'auto' : 'smooth' });
  }
}
function datosEleccion() {
  const por = (estado) => eleccion.items.filter((x) => x.estado === estado).map((x) => x.n);
  return { archivo: eleccion.archivo, hoy: por('hoy'), despues: por('despues'), no: por('no') };
}

function pintar() {
  if (modo === 'bandeja') {
    const candidata = sel && !esPuerta(sel) && sesion(sel) && sesion(sel).espacio === actual ? sel : (ordenar(delEspacio(sesiones))[0] || {}).id;
    maxima = candidata || null;
  }
  pintarBarra();
  pintarLienzo();
  pintarBandeja();
  pintarFlujo();
  if (typeof pintarCrm === 'function') pintarCrm();
  if (typeof pintarInicio === 'function') pintarInicio();
  pintarPuerta();
}

// ── Acciones ────────────────────────────────────────────

function seleccionar(id, sinFoco) {
  // Un veredicto pendiente: la vista Flujo de su pestaña, el tablero corrido hasta la columna «Veredicto» y resaltada.
  if (esVeredicto(id)) {
    const f = flujo(id.slice(2));
    if (!f) return;
    if (f.espacio !== actual) cambiarEspacio(f.espacio, true);
    maxima = null;
    if (modo !== 'flujo') cambiarModo('flujo'); else { firmaFlujo = null; pintar(); }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const t = tableroDe(f.id);
      if (!t) return;
      t.closest('.kb-flujo').scrollIntoView({ block: 'nearest' });
      t.scrollLeft = t.scrollWidth;
      const col = t.querySelector('.sala-col');
      if (col) { col.classList.add('destacada'); setTimeout(() => col.classList.remove('destacada'), 2400); }
    }));
    return;
  }
  if (esPuerta(id)) {
    const f = flujo(id.slice(2));
    if (!f) return;
    if (f.espacio !== actual) cambiarEspacio(f.espacio, true);
    sel = id;
    // Que las teclas de la puerta no lleguen a la terminal que tenía el foco.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    pintar();
    return;
  }
  const s = sesion(id);
  if (!s) { sel = null; pintar(); return; }
  if (s.espacio !== actual) cambiarEspacio(s.espacio, true);
  sel = id;
  api.foco(id);
  pintar();
  if (sinFoco) return;
  const t = terminales.get(id);
  requestAnimationFrame(() => { ajustar(id); if (t) t.term.focus(); });
}

function retomarSesion(id) {
  const t = terminal(id);
  t.term.write('\x1b[90mRetomando…\x1b[0m\r\n');
  ajustar(id);
  api.abrir(id, t.term.cols, t.term.rows);
  seleccionar(id);
}

// Sprint 21 (H1): la orden fija va a la terminal de la sesión; la receta vuelve por receta_proponer. Main revisa lo
// mismo antes de escribir: esto solo adelanta el aviso.
const NO_HACER_FLUJO = {
  cerrada: (s) => `«${s.nombre}» está cerrada: retómala y vuelve a pedir el flujo.`,
  trabajando: (s) => `«${s.nombre}» está trabajando: espera a que termine y vuelve a pedir el flujo.`,
  pregunta: (s) => `«${s.nombre}» te hizo una pregunta: respóndela primero.`,
  'sin-orden': () => 'No se pudo leer la orden de «Hacer flujo» (config\\orden-hacer-flujo.md). Detalle en el registro.',
  'no-existe': () => 'Esa sesión ya no existe.'
};
async function hacerFlujo(id) {
  const s = sesion(id);
  if (!s) return;
  const antes = !s.viva ? 'cerrada' : s.estado === 'trabajando' ? 'trabajando' : s.estado === 'necesita' ? 'pregunta' : null;
  if (antes) { aviso(NO_HACER_FLUJO[antes](s)); return; }
  const r = await api.hacerFlujo(id);
  if (!r || !r.ok) { aviso((NO_HACER_FLUJO[r && r.motivo] || NO_HACER_FLUJO['no-existe'])(s)); return; }
  aviso(`«${s.nombre}» está armando la receta. Cuando la proponga, se abre para que la revises antes de guardarla.`);
  seleccionar(id);
}

function cambiarEspacio(id, sinPintar) {
  if (id === actual) return;
  // Para Ctrl+Shift+Tab: la pestaña de la que se viene.
  if (actual) espacioPrevio = actual;
  actual = id;
  maxima = null;
  if (esPuerta(sel)) sel = null;
  api.espacioActual(id);
  aplicarVista(false);
  // El CRM se filtra por el entorno de la pestaña: al cambiar de pestaña se vuelve a leer.
  if (typeof crmEstado !== 'undefined') { crmEstado.resumen = null; crmEstado.sel = null; crmEstado.ficha = null; }
  if (!sinPintar) pintar();
}

async function nuevoEspacio() {
  const e = await api.nuevoEspacio('');
  if (e) { actual = e.id; aplicarVista(false); }
}

// Un campo de texto en el lugar de un nombre: Enter o salir del campo guarda, Esc descarta.
// montar(campo) lo pone en su sitio; desmontar(campo) lo saca y deja todo como estaba.
function editarEnLinea({ valor, clase, montar, desmontar, alGuardar }) {
  const campo = h('input', { class: clase });
  campo.value = valor;
  montar(campo);
  campo.focus();
  campo.select();
  let listo = false;
  const terminar = (guardar) => {
    if (listo) return;
    listo = true;
    if (guardar && campo.value.trim() && campo.value.trim() !== valor) alGuardar(campo.value.trim());
    desmontar(campo);
  };
  campo.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  campo.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') terminar(true); if (ev.key === 'Escape') terminar(false); });
  campo.addEventListener('blur', () => terminar(true));
}
function renombrarEspacioEn(boton, e) {
  editarEnLinea({ valor: e.nombre, clase: 'pill-nombre-editar', alGuardar: (t) => api.renombrarEspacio(e.id, t),
    montar: (campo) => boton.replaceChildren(campo), desmontar: (campo) => { campo.remove(); pintar(); } });
}
function renombrarTitulo() {
  const e = espacio(actual);
  if (!e) return;
  editarEnLinea({ valor: e.nombre, clase: 'titulo-editar', alGuardar: (t) => api.renombrarEspacio(e.id, t),
    montar: (campo) => { $('#titulo-espacio').hidden = true; $('#lienzo').appendChild(campo); },
    desmontar: (campo) => { campo.remove(); $('#titulo-espacio').hidden = false; } });
}
function renombrar(id, nombreEl) {
  const s = sesion(id);
  if (!s) return;
  editarEnLinea({ valor: s.nombre, clase: 'v-nombre-editar', alGuardar: (t) => api.renombrar(id, t),
    montar: (campo) => nombreEl.replaceWith(campo),
    desmontar: (campo) => { campo.replaceWith(nombreEl); const t = terminales.get(id); if (t) t.term.focus(); } });
}

// Lo que no se deshace pide un segundo clic: el primero cambia el botón a su aviso y, si no llega
// el segundo en PLAZO_CONFIRMAR, vuelve solo. (La puerta crítica tiene su propia versión.)
const PLAZO_CONFIRMAR = 6000;
function confirmarDosVeces(boton, { aviso, clase, original, alConfirmar }) {
  if (boton.classList.contains(clase)) { clearTimeout(boton.esperaConfirmar); alConfirmar(); return; }
  boton.classList.add(clase);
  boton.replaceChildren(aviso);
  boton.esperaConfirmar = setTimeout(() => { if (boton.isConnected) { boton.classList.remove(clase); boton.replaceChildren(original()); } }, PLAZO_CONFIRMAR);
}

const ICONO_CERRAR = ['M6 6l12 12', 'M18 6L6 18'];
function cerrar(id, boton) {
  confirmarDosVeces(boton, { aviso: 'Cerrar', clase: 'peligro', original: () => icono(ICONO_CERRAR), alConfirmar: () => {
    if (maxima === id) maxima = null;
    if (acoplada === id) acoplada = null;
    if (sel === id) sel = null;
    sesiones = sesiones.filter((x) => x.id !== id);
    api.cerrar(id);
    pintar();
  } });
}

async function nuevaSesion() {
  const s = await api.nueva();
  if (!s) return;
  if (!sesion(s.id)) sesiones.push(s);
  seleccionar(s.id);
}

// Sprint 20 (H3, 22-10-2026): el «+» de las pestañas y «+ Nueva sesión» (también Ctrl+Shift+N) abren un menú corto con
// los entornos de entornos.json, para que abrir el de un entorno no pase por el diálogo de carpeta. No depende de
// Obsidian. Enter elige la primera fila: en la sesión es la carpeta de esta pestaña; si la pestaña no tiene carpeta,
// «Elegir otra carpeta…» (el diálogo de antes). Las flechas se mueven y Esc cierra.
let menuCrearDe = null, menuCrearAncla = null, menuCrearFoco = null;
const claveEntorno = (x) => String(x || '').toLowerCase();
const pestanaDeEntorno = (nombre) => espacios.find((e) => claveEntorno(e.entorno || e.nombre) === claveEntorno(nombre)) || null;
const ultimaParte = (ruta) => String(ruta || '').split(/[\\/]/).filter(Boolean).pop() || '';
function cerrarMenuCrear(volver) {
  const caja = document.getElementById('pop-crear');
  if (!caja || caja.hidden) return;
  caja.hidden = true;
  menuCrearDe = null;
  menuCrearAncla = null;
  if (volver && menuCrearFoco && menuCrearFoco.isConnected) menuCrearFoco.focus();
  menuCrearFoco = null;
}
async function irAEntorno(nombre) {
  const id = await api.abrirEntorno(nombre);
  if (!id) { aviso(`El entorno «${nombre}» no está en entornos.json.`); return null; }
  if (modo === 'inicio') cambiarModo(modoPrevio || 'lienzo');
  cambiarEspacio(id);
  return id;
}
async function abrirSesionEn(carpeta) {
  const s = await api.nueva(carpeta || undefined);
  if (!s) return;
  if (!sesion(s.id)) sesiones.push(s);
  seleccionar(s.id);
}
// La sesión de un entorno cae en la pestaña del entorno (se crea si falta), así H4 le puede dar su guía.
async function sesionEnEntorno(ent) {
  if (!(await irAEntorno(ent.nombre))) return;
  await abrirSesionEn(ent.existe ? ent.carpeta : '');
}
// La central (27-10-2026): si ya hay una, lleva a ella; si no, la abre con lo de perfil.json, aunque no esté activa.
async function abrirCentral() {
  const r = await api.abrirCentral();
  if (!r) { aviso('No hay central en perfil.json («central»).'); return; }
  if (!sesion(r.sesion.id)) sesiones.push(r.sesion);
  if (modo === 'inicio') cambiarModo(modoPrevio || 'lienzo');
  cambiarEspacio(r.espacio);
  seleccionar(r.sesion.id);
  if (!r.activa) aviso(`«${r.sesion.nombre}» quedó abierta, pero no se abre sola al iniciar: para eso, «central.activa: true» en perfil.json.`);
}
function filaCrear(texto, dato, uso, alElegir, titulo) {
  return h('button', { type: 'button', class: 'menu-fila', role: 'menuitem', 'data-uso': uso, title: titulo || null, onclick: (e) => { e.stopPropagation(); cerrarMenuCrear(false); alElegir(); } },
    texto, dato ? h('span', { class: 'menu-dato' }, dato) : null);
}
async function menuCrear(de, ancla) {
  let caja = document.getElementById('pop-crear');
  if (caja && !caja.hidden && menuCrearDe === de) { cerrarMenuCrear(true); return; }
  if (!caja) {
    caja = h('div', { id: 'pop-crear', class: 'menu-barra pop-modelo pop-crear', role: 'menu' });
    caja.hidden = true;
    document.body.appendChild(caja);
  }
  if (!caja.hidden) cerrarMenuCrear(false);
  const foco = document.activeElement;
  const ents = await api.entornos().catch(() => null);
  if (Array.isArray(ents)) entornosPop = ents;
  const lista = Array.isArray(ents) ? ents : entornosPop;
  // Se relee cada vez: «central» de perfil.json pudo cambiar con la app abierta.
  // Sin «central» en el perfil se ofrece igual, con los valores de fábrica (main.js la abre así desde el menú).
  const cfgCentral = await api.perfil().then((p) => (p && p.central) || {}).catch(() => null);
  let filas;
  if (de === 'pestana') {
    const libres = lista.filter((x) => !pestanaDeEntorno(x.nombre));
    filas = [
      libres.length ? h('div', { class: 'menu-t' }, 'Entornos sin pestaña') : null,
      libres.map((x) => filaCrear(x.nombre, x.existe ? ultimaParte(x.carpeta) : 'sin carpeta', 'crear:pestana-entorno', () => irAEntorno(x.nombre), x.carpeta || 'Sin carpeta en entornos.json')),
      libres.length ? h('div', { class: 'menu-t' }, 'Otra') : null,
      filaCrear('Pestaña vacía', 'sin carpeta', 'crear:pestana-vacia', nuevoEspacio, 'Una pestaña sin entorno; su carpeta se elige después')
    ];
  } else {
    const e = espacio(actual);
    const aqui = e && e.carpeta;
    const otros = lista.filter((x) => !e || claveEntorno(x.nombre) !== claveEntorno(e.entorno || e.nombre));
    const viva = sesiones.find((s) => s.central);
    filas = [
      cfgCentral && EDICION !== 'terminales' ? filaCrear(cfgCentral.nombre || 'central', viva ? 'ir a ella' : 'abrirla', 'crear:sesion-central', abrirCentral,
        viva ? 'Ya está abierta: lleva a ella' : `La central: abre sesiones, las cierra, las enlaza y programa${cfgCentral.activa ? '' : ' (no se abre sola al iniciar)'}`) : null,
      aqui ? filaCrear('En la carpeta de esta pestaña', ultimaParte(e.carpeta), 'crear:sesion-aqui', () => abrirSesionEn(e.carpeta), e.carpeta) : null,
      otros.length ? h('div', { class: 'menu-t' }, 'En un entorno') : null,
      otros.map((x) => filaCrear(x.nombre, pestanaDeEntorno(x.nombre) ? 'su pestaña' : 'pestaña nueva', 'crear:sesion-entorno', () => sesionEnEntorno(x), x.carpeta || 'Sin carpeta: se elige al abrir')),
      filaCrear('Elegir otra carpeta…', '', 'crear:sesion-elegir', nuevaSesion, 'El diálogo de carpeta; la sesión queda en esta pestaña')
    ];
  }
  caja.replaceChildren(h('div', { class: 'menu-t' }, de === 'pestana' ? 'Pestaña nueva' : 'Sesión nueva'), ...filas.flat().filter(Boolean));
  caja.setAttribute('aria-label', de === 'pestana' ? 'Pestaña nueva' : 'Sesión nueva');
  menuCrearDe = de;
  menuCrearAncla = ancla || null;
  menuCrearFoco = foco;
  caja.hidden = false;
  const base = ancla || $('#herr-sesion');
  const r = base && base.getBoundingClientRect();
  const alto = caja.offsetHeight, ancho = caja.offsetWidth;
  // Desde la paleta de la izquierda se abre a su lado, para no taparla.
  if (r && r.width && base.closest('.paleta')) Object.assign(caja.style, { left: Math.min(r.right + 10, innerWidth - ancho - 12) + 'px', top: Math.max(12, Math.min(r.top, innerHeight - alto - 12)) + 'px', right: 'auto' });
  else if (r && r.width) Object.assign(caja.style, { left: Math.max(12, Math.min(r.left, innerWidth - ancho - 12)) + 'px', top: (r.bottom + 6 + alto > innerHeight ? Math.max(12, r.top - alto - 6) : r.bottom + 6) + 'px', right: 'auto' });
  else Object.assign(caja.style, { left: Math.max(12, (innerWidth - ancho) / 2) + 'px', top: '18%', right: 'auto' });
  // La central va arriba, pero Enter sigue eligiendo la carpeta de esta pestaña (o «Elegir otra carpeta…»).
  const primera = caja.querySelector('.menu-fila:not([data-uso="crear:sesion-central"])');
  if (primera) primera.focus();
}
document.addEventListener('pointerdown', (ev) => {
  const caja = document.getElementById('pop-crear');
  if (!caja || caja.hidden || ev.target.closest('#pop-crear') || (menuCrearAncla && menuCrearAncla.contains(ev.target))) return;
  cerrarMenuCrear(false);
}, true);
// Va en window y en captura: así sus teclas no le llegan a la terminal ni a los atajos de la puerta de elegir.
window.addEventListener('keydown', (ev) => {
  const caja = document.getElementById('pop-crear');
  if (!caja || caja.hidden || ev.ctrlKey || ev.altKey || ev.metaKey) return;
  const filas = [...caja.querySelectorAll('.menu-fila')];
  if (!filas.length) return;
  const i = filas.indexOf(document.activeElement);
  if (ev.key === 'Escape') cerrarMenuCrear(true);
  else if (ev.key === 'ArrowDown') filas[(i + 1) % filas.length].focus();
  else if (ev.key === 'ArrowUp') filas[(i <= 0 ? filas.length : i) - 1].focus();
  else if (ev.key === 'Home') filas[0].focus();
  else if (ev.key === 'End') filas[filas.length - 1].focus();
  else if (ev.key === 'Enter') (filas[i] || filas[0]).click();
  else if (ev.key === 'Tab') { cerrarMenuCrear(false); return; }
  else return;
  ev.preventDefault();
  ev.stopPropagation();
}, true);

// ── Temas (Brasa, Gris, Blanco) ─────────────────────────
// Los colores están en styles.css (data-tema); acá solo se elige y se recuerda en este equipo.
const TEMAS = { brasa: { nombre: 'Brasa', sig: 'gris' }, gris: { nombre: 'Gris', sig: 'blanco' }, blanco: { nombre: 'Blanco', sig: 'brasa' } };
function temaActual() { const t = document.documentElement.dataset.tema; return TEMAS[t] ? t : 'brasa'; }
function aplicarTema(t) {
  if (t === 'brasa' || !TEMAS[t]) delete document.documentElement.dataset.tema;
  else document.documentElement.dataset.tema = t;
  try { localStorage.setItem('chocosys-tema', temaActual()); } catch (e) { /* sin almacenamiento: dura hasta cerrar */ }
  const el = $('#tema-txt');
  if (el) el.textContent = TEMAS[temaActual()].nombre;
}
try { aplicarTema(localStorage.getItem('chocosys-tema') || 'brasa'); } catch (e) { /* tema de fábrica */ }

// ── Pista sobre la barra ────────────────────────────────
// Una a la vez; clic en el texto pasa a la siguiente; la × las apaga para siempre en este equipo.
const PISTAS = [
  'Escribe @nombre: y una orden para hablarle a una sesión que ya existe.',
  'Ctrl+Tab te lleva a lo siguiente que te necesita: primero las puertas.',
  'Alt + arrastrar mueve una ventana desde cualquier parte.',
  'Ctrl + rueda acerca o aleja el lienzo; «Ajustar» encuadra todo.',
  'Ctrl+Shift+M agranda la ventana elegida; otra vez la achica.',
  'Un flujo terminado se quita con el botón junto a su nombre.',
  'A varias a la vez: @alfa @beta: orden. A todas las de esta pestaña: @todas: orden.',
  '@#Ventas: orden le escribe a todas las sesiones de la pestaña Ventas.',
  'junta @alfa @beta: abre una sesión que lee lo que hicieron y lo junta en un informe.'
];
// Solo en el lienzo: en la bandeja o con una terminal agrandada taparía la última línea de la terminal.
let pistasApagadas = false;
function verPista() { $('#pista').hidden = pistasApagadas || modo !== 'lienzo' || !!maxima || !$('#pista-txt').textContent; }
function pintarPista(paso) {
  let i = 0;
  try { pistasApagadas = localStorage.getItem('chocosys-pistas') === 'no'; i = Number(localStorage.getItem('chocosys-pista')) || 0; } catch (e) { /* se muestran igual */ }
  if (paso) i += paso;
  i = ((i % PISTAS.length) + PISTAS.length) % PISTAS.length;
  try { localStorage.setItem('chocosys-pista', String(i)); } catch (e) { /* nada */ }
  $('#pista-txt').textContent = PISTAS[i];
  verPista();
}

// Lo que te necesita: puertas primero, después las sesiones; en todos los espacios.
// Los veredictos de sala que esperan «Dejar como nota en el negocio»: salas completas, de verdad (no simulacro), que
// vienen de un negocio y todavía no quedaron anotadas. Se leen una vez y quedan en salasVistas.
function veredictosPendientes() {
  return flujos.filter((f) => f.sala && f.sala.negocio_id && f.estado === 'completo' && !f.simulacro).filter((f) => {
    if (!salasVistas.has(f.id)) {
      salasVistas.set(f.id, null);
      api.sala.veredicto(f.id).then((v) => { salasVistas.set(f.id, v || { error: 'No se pudo leer la sala.' }); firmaFlujo = null; pintar(); });
      return false;
    }
    const v = salasVistas.get(f.id);
    return !!(v && v.veredicto && !v.registrado);
  }).map((f) => 'v:' + f.id);
}

// Lo que te necesita: puertas y veredictos primero, después las sesiones; en todos los espacios.
function ronda(soloNecesita) {
  const puertas = flujos.filter((f) => f.estado === 'puerta' && !f.simulacro).map((f) => 'p:' + f.id);
  const veredictos = veredictosPendientes();
  const necesitan = ordenar(sesiones).filter((s) => s.estado === 'necesita').map((s) => s.id);
  if (soloNecesita) return [...puertas, ...veredictos, ...necesitan];
  return puertas.length || veredictos.length || necesitan.length ? [...puertas, ...veredictos, ...necesitan] : ordenar(delEspacio(sesiones)).map((s) => s.id);
}
function siguiente() {
  const lista = ronda(false);
  if (!lista.length) return;
  if (modo === 'inicio') cambiarModo(modoPrevio || 'lienzo');
  const destino = lista[(lista.indexOf(sel) + 1) % lista.length];
  seleccionar(destino);
  // En la vista Flujo, la sesión que te necesita se abre encima del kanban (después de seleccionar,
  // que al cambiar de espacio deja maxima en null).
  if (esVeredicto(destino)) return;
  if (modo === 'flujo' && !esPuerta(destino)) { maxima = destino; pintar(); }
  if (!esPuerta(destino) && modo === 'lienzo' && maxima !== destino) {
    const s = sesion(destino);
    if (s) centrarEn(posDeSesion(s), 1);
  }
}

// ── ¿Quién está trabajando? (sprint 7, pedido de quien usa la app: «que haya un botón que diga cuál está trabajando») ──
// El botón de arriba cuenta las sesiones que trabajan en todas las pestañas; al apretarlo, la lista con su pestaña,
// su flujo y etapa, lo último que hicieron y hace cuánto. Un clic en una te lleva a ella (como «Siguiente que te necesita»).
function irASesion(id) {
  if (modo === 'inicio' || modo === 'crm') cambiarModo('lienzo');
  seleccionar(id);
  if (modo === 'flujo') { maxima = id; pintar(); }
  if (modo === 'lienzo' && maxima !== id) { const s = sesion(id); if (s) centrarEn(posDeSesion(s), 1); }
}
// La lista se rehace solo si cambia quién está en ella: si cambian los detalles, se actualiza el texto de cada fila
// sin reemplazarla. Rehacerla con cada aviso de los agentes se comía el clic (la fila cambiaba bajo el mouse).
let filasTrabajando = { firma: '', filas: new Map() };
// Lo que hace ahora (lo «en vivo» de la terminal) y lo último que dijo, del registro (lo que mostraba «Ojear», retirado el 04-11-2026).
const ahoraDe = (s) => [enVivo(s.id), (ojeada.get(s.id) || {}).hace].filter(Boolean).join(' · ') || subtitulo(s);
const dijoDe = (s) => (ojeada.get(s.id) || {}).dijo ? '«' + ojeada.get(s.id).dijo + '»' : '';
function pintarTrabajando() {
  const caja = $('#lista-trabajando');
  const trab = sesiones.filter((s) => s.estado === 'trabajando').sort((a, b) => (a.creada || 0) - (b.creada || 0));
  const firma = trab.map((s) => s.id).join(',');
  if (firma === filasTrabajando.firma && caja.children.length) {
    for (const s of trab) {
      const el = filasTrabajando.filas.get(s.id);
      if (!el) continue;
      el.querySelector('.pop-ultimo').textContent = ahoraDe(s);
      const dj = el.querySelector('.pop-dijo');
      dj.textContent = dijoDe(s);
      dj.hidden = !dj.textContent;
      const c = el.querySelector('.pop-cuando');
      if (c && s.cambio) c.textContent = 'hace ' + duracion(Date.now() - s.cambio);
    }
    return;
  }
  filasTrabajando = { firma, filas: new Map() };
  const fila = (s) => {
    const f = s.flujo ? flujos.find((x) => x.id === s.flujo) : null;
    const etapa = f && f.items[s.etapa] ? f.items[s.etapa].nombre : '';
    const donde = [espacio(s.espacio) ? espacio(s.espacio).nombre : '', f ? f.nombre.split(' · ')[0] + (etapa && !s.nombre.startsWith(etapa) ? ' · ' + etapa : '') : 'sesión suelta'].filter(Boolean).join(' · ');
    const el = h('button', { type: 'button', class: 'pop-fila', onclick: () => { caja.hidden = true; $('#trabajando').setAttribute('aria-expanded', 'false'); irASesion(s.id); } },
      h('span', { class: 'pop-nom' }, h('span', { class: 'punto respira' }), s.nombre),
      h('span', { class: 'pop-donde' }, donde),
      h('span', { class: 'pop-ultimo' }, ahoraDe(s)),
      h('span', { class: 'pop-ultimo pop-dijo', hidden: !dijoDe(s) }, dijoDe(s)),
      h('span', { class: 'pop-cuando' }, s.cambio ? 'hace ' + duracion(Date.now() - s.cambio) : ''));
    filasTrabajando.filas.set(s.id, el);
    return el;
  };
  caja.replaceChildren(
    h('div', { class: 'pop-t' }, h('b', {}, trab.length ? `${trab.length} trabajando` : 'Nadie está trabajando'), h('span', {}, 'en todas las pestañas')),
    trab.length ? h('div', { class: 'pop-lista' }, trab.map(fila)) : h('p', { class: 'pop-nada' }, 'Cuando una sesión o un agente de un flujo esté trabajando, aparece acá.'));
  const r = $('#trabajando').getBoundingClientRect();
  Object.assign(caja.style, { top: r.bottom + 8 + 'px', left: Math.max(12, Math.min(r.left, innerWidth - 392)) + 'px' });
}
// ── Pestañas que dicen qué pasa adentro (sprint 19, T1) ──
// Un punto por sesión, del más urgente al más quieto; desde 6, el número y el punto del más urgente.
const URGENCIA = { necesita: 0, trabajando: 1, termino: 2, pausa: 3 };
let espacioPrevio = null;
function puntosDe(espId) {
  const de = ordenar(sesiones.filter((s) => s.espacio === espId));
  const cuenta = Object.entries(de.reduce((c, s) => (c[s.estado] = (c[s.estado] || 0) + 1, c), {})).map(([e, n]) => `${n} ${(ETIQUETA[e] || e).toLowerCase()}`).join(', ');
  const etiqueta = `${de.length} ${de.length === 1 ? 'sesión' : 'sesiones'}: ${cuenta}`;
  if (de.length > 5) return h('span', { class: 'puntos-pill', 'aria-label': etiqueta }, h('span', { class: 'n' }, String(de.length)), h('i', { class: 'pp e-' + de[0].estado }));
  return h('span', { class: 'puntos-pill', 'aria-label': etiqueta }, de.map((s) => h('i', { class: 'pp e-' + s.estado })));
}
function pasarAPestana(id) {
  if (!id || !espacio(id)) return;
  ocultarPestana();
  if (modo === 'inicio') cambiarModo(modoPrevio || 'lienzo');
  cambiarEspacio(id);
}
// La lista al dejar el mouse encima: cada sesión con lo último que dijo o hace. Lo último se lee del registro solo
// al abrirla (la misma lectura incremental de la lista «trabajando»).
let relojPestana = null, pestanaAbierta = null;
function ocultarPestana() { clearTimeout(relojPestana); $('#pop-pestana').hidden = true; pestanaAbierta = null; }
function filaPestana(s, d) {
  const linea = s.estado === 'necesita' && s.mensaje ? s.mensaje : s.estado === 'trabajando' && (enVivo(s.id) || d.hace) ? [enVivo(s.id), d.hace].filter(Boolean).join(' · ') : d.dijo ? '«' + d.dijo + '»' : subtitulo(s);
  return h('button', { type: 'button', class: 'pop-fila', onclick: () => { ocultarPestana(); irASesion(s.id); } },
    h('span', { class: 'pop-nom' }, h('i', { class: 'pp e-' + s.estado }), s.nombre, h('span', { class: 'pop-donde' }, (ETIQUETA[s.estado] || '').toLowerCase())),
    h('span', { class: 'pop-ultimo' }, linea));
}
// Sprint 20 (H2, 22-10-2026): si la pestaña es un entorno con guía dentro de una bóveda de Obsidian, la lista termina
// con «Abrir en Obsidian» y la última línea de su log.md. Sin Obsidian (`obsidian` vacío) no aparece nada. El entorno se
// busca por `entorno` de la pestaña (sprint 25) o, si no lo tiene, por su nombre. La lista se pide al abrir, junto con
// la ojeada, y mientras llega se usa la última que se leyó.
let entornosPop = [];
function entornoDePestana(e) {
  const clave = String(e.entorno || e.nombre || '').toLowerCase();
  return entornosPop.find((x) => x.nombre.toLowerCase() === clave) || null;
}
function filaObsidian(ent) {
  if (!ent || !ent.obsidian) return null;
  return h('div', { class: 'pop-obs' }, h('button', { type: 'button', class: 'pop-fila', id: 'pop-obsidian', title: ent.guia, onclick: async () => {
    ocultarPestana();
    const r = await api.abrirObsidian(ent.nombre).catch((err) => ({ ok: false, error: err.message }));
    if (!r || !r.ok) aviso('No se abrió Obsidian: ' + ((r && r.error) || 'sin respuesta'));
    else if (r.prueba) aviso('Chocosys de prueba: no se abre. ' + r.url);
  } },
  h('span', { class: 'pop-nom' }, 'Abrir en Obsidian', h('span', { class: 'pop-donde' }, 'index.md')),
  h('span', { class: 'pop-ultimo', title: ent.log || '' }, ent.log ? 'Registro: ' + ent.log : 'El log.md no tiene entradas con fecha')));
}
async function mostrarPestana(espId, pill) {
  const e = espacio(espId);
  if (!e) return;
  pestanaAbierta = espId;
  const caja = $('#pop-pestana');
  const pintarLista = () => {
    const de = ordenar(sesiones.filter((s) => s.espacio === espId));
    caja.replaceChildren(
      h('div', { class: 'pop-t' }, h('b', {}, e.nombre), h('span', {}, `${de.length} ${de.length === 1 ? 'sesión' : 'sesiones'} · doble clic en la pestaña para renombrarla`)),
      de.length ? h('div', { class: 'pop-lista' }, de.map((s) => filaPestana(s, ojeada.get(s.id) || {}))) : h('p', { class: 'pop-nada' }, 'Sin sesiones. Un clic en la pestaña para entrar.'),
      filaObsidian(entornoDePestana(e)));
  };
  pintarLista();
  const r = pill.getBoundingClientRect();
  Object.assign(caja.style, { top: r.bottom + 6 + 'px', left: Math.max(12, Math.min(r.left, innerWidth - 392)) + 'px' });
  caja.hidden = false;
  const [oj, ents] = await Promise.all([api.ojear().catch(() => null), api.entornos().catch(() => null)]);
  if (oj) ojeada = new Map(oj.map((x) => [x.id, x]));
  if (Array.isArray(ents)) entornosPop = ents;
  if (pestanaAbierta === espId && (oj || ents)) pintarLista();
}
$('#espacios').addEventListener('mouseover', (ev) => {
  const p = ev.target.closest('.pill[data-esp]');
  if (!p || document.querySelector('.pill-nombre-editar')) return;
  clearTimeout(relojPestana);
  if (pestanaAbierta === p.dataset.esp && !$('#pop-pestana').hidden) return;
  relojPestana = setTimeout(() => mostrarPestana(p.dataset.esp, p), 280);
});
$('#espacios').addEventListener('mouseleave', () => { clearTimeout(relojPestana); relojPestana = setTimeout(ocultarPestana, 240); });
$('#pop-pestana').addEventListener('mouseenter', () => clearTimeout(relojPestana));
$('#pop-pestana').addEventListener('mouseleave', () => { relojPestana = setTimeout(ocultarPestana, 240); });

// ── Bienvenida y «Revisar instalación» (sprint 18, P1): lo que Chocosys necesita y un botón para lo que falte ──
async function abrirBienvenida(sola) {
  let r;
  try { r = await api.instalacion.revisar(); } catch (e) { return; }
  // Sola: la primera vez en una Chocosys instalada, o si falta algo sin lo que no se puede trabajar.
  if (sola) {
    let vista = false;
    try { vista = localStorage.getItem('chocosys-bienvenida') === 'vista'; } catch (e) { /* sin guardar */ }
    if (vista || (!r.empaquetada && r.claude.ok && r.pestana.ok)) return;
  }
  const filas = [
    ['claude', 'Claude Code', r.claude, () => api.instalacion.abrir('claude'), 'Cómo instalarlo'],
    ['node', 'Node.js', r.node, () => api.instalacion.abrir('node'), 'Descargar'],
    ['mcp', 'Conectar el MCP de Chocosys', r.mcp, async (b) => { b.disabled = true; b.textContent = 'Conectando…'; const x = await api.instalacion.conectarMcp(); aviso(x.ok ? 'MCP conectado: las sesiones que abras desde ahora lo tienen.' : 'No se pudo conectar: ' + (x.motivo || '')); abrirBienvenida(); }, 'Conectar'],
    ['pestana', 'Tu primera pestaña', r.pestana, () => { cerrarBienvenida(); $('#espacio-nuevo').click(); }, 'Crear'],
    ['sala', 'Segunda opinión (opcional)', r.sala, null, '']
  ].filter(([id]) => !(VISTAS_EDICION && id === 'sala') && !(EDICION === 'terminales' && id === 'mcp'));
  $('#bienvenida-lista').replaceChildren(...filas.map(([id, titulo, x, accion, texto]) => h('div', { class: 'bienvenida-fila' + (x.ok ? ' ok' : '') },
    h('span', { class: 'bienvenida-marca', 'aria-hidden': 'true' }, x.ok ? '✓' : '!'),
    h('span', { class: 'bienvenida-txt' }, h('b', {}, titulo), h('span', {}, x.dice)),
    !x.ok && accion ? h('button', { type: 'button', class: 'boton chico', id: 'bienvenida-' + id, onclick: (e) => accion(e.currentTarget) }, texto) : null)));
  $('#bienvenida-bajada').textContent = filas.every(([, , x]) => x.ok) ? 'Está todo listo en este computador.' : 'Revisemos lo que necesita en este computador. Toma un minuto.';
  $('#bienvenida').hidden = false;
}
function cerrarBienvenida() {
  $('#bienvenida').hidden = true;
  try { localStorage.setItem('chocosys-bienvenida', 'vista'); } catch (e) { /* sin guardar */ }
}
$('#bienvenida-listo').addEventListener('click', cerrarBienvenida);
$('#revisar-instalacion').addEventListener('click', () => abrirBienvenida());
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#bienvenida').hidden) cerrarBienvenida(); });
// La revisión de instalación sale después de los créditos y del «sobre mí» (los llama bienvenida.js, en ese orden).

// ── Orquesta (sprint 16, A1): chips de las sesiones a cargo y flechas cuando están en la misma pestaña ──
const MARCA_ORQ = { trabajando: '●', termino: '✓', necesita: '!', pausa: '○' };
function pintarOrquesta(s, v) {
  const hijas = sesiones.filter((x) => x.coordinador === s.id);
  v.el.classList.toggle('coord', !!s.orquesta);
  v.orq.hidden = !hijas.length;
  if (!hijas.length) return;
  v.orq.replaceChildren(...hijas.map((x) => h('button', { type: 'button', class: 'v-orq-chip e-' + x.estado, title: `${x.nombre} · ${(ETIQUETA[x.estado] || '').toLowerCase()}${espacio(x.espacio) && x.espacio !== s.espacio ? ' · pestaña ' + espacio(x.espacio).nombre : ''}. Clic: ir a ella`, onclick: (e) => { e.stopPropagation(); irASesion(x.id); } }, (MARCA_ORQ[x.estado] || '○') + ' ' + x.nombre)));
}
// Flechas entre la coordinadora y sus sesiones de la misma pestaña: punteada mientras trabaja, verde cuando terminó.
function pintarFlechasOrquesta() {
  let svg = document.getElementById('orq-flechas');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'orq-flechas';
    svg.setAttribute('aria-hidden', 'true');
    $('#lienzo').prepend(svg);
  }
  const caminos = [];
  for (const c of sesiones) {
    if (!c.orquesta || c.espacio !== actual || modo !== 'lienzo') continue;
    const a = posDeSesion(c);
    for (const x of sesiones) {
      if (x.coordinador !== c.id || x.espacio !== actual) continue;
      const b = posDeSesion(x);
      const derecha = b.x >= a.x + a.w / 2;
      const x1 = derecha ? a.x + a.w : a.x, x2 = derecha ? b.x : b.x + b.w;
      const y1 = a.y + 60, y2 = b.y + 40, m = (x1 + x2) / 2;
      caminos.push(`<path class="${x.estado === 'termino' ? 'vuelta' : 'ida'}" d="M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2}"/>`);
    }
  }
  svg.innerHTML = caminos.join('');
}

// ── Modelo, esfuerzo y uso del plan (sprint 15: P1, M1 y L1) ──
// Todo sale de la statusLine de cada sesión (linea.js): nada se pregunta a cada rato.
let plan = { cinco: null, semana: null };
const MODELOS_UI = [['opus', 'Opus 5.5', 'lo más capaz'], ['sonnet', 'Sonnet 5.5', 'equilibrado'], ['haiku', 'Haiku 5.5', 'rápido']];
const NIVELES = ['low', 'medium', 'high', 'xhigh', 'max'];
const pct = (x) => (x && typeof x.used_percentage === 'number' ? Math.round(x.used_percentage) : null);
const reinicio = (x) => {
  if (!x || !x.resets_at) return '';
  const d = new Date(x.resets_at * 1000);
  const hoy = new Date().toDateString() === d.toDateString();
  return (hoy ? '' : d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric' }) + ' ') + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
};

// P1: el chip de la barra de arriba, ámbar sobre 80 %. Sin datos (antes de la primera respuesta, o sin plan Pro o Max), no se ve.
function pintarPlan() {
  const c = pct(plan.cinco), s = pct(plan.semana);
  $('#plan').hidden = c == null && s == null;
  if ($('#plan').hidden) return;
  $('#plan-b5').style.width = (c || 0) + '%';
  $('#plan-bs').style.width = (s || 0) + '%';
  $('#plan-b5').classList.toggle('alto', c >= 80);
  $('#plan-bs').classList.toggle('alto', s >= 80);
  $('#plan').classList.toggle('alto', c >= 80 || s >= 80);
  $('#plan-txt').textContent = [c != null ? `5 h ${c} %` : '', s != null ? `sem ${s} %` : ''].filter(Boolean).join(' · ');
}
$('#plan').addEventListener('click', (ev) => {
  ev.stopPropagation();
  const caja = $('#pop-plan');
  if (!caja.hidden) { caja.hidden = true; return; }
  const costo = sesiones.reduce((t, s) => t + ((s.linea && s.linea.costo) || 0), 0);
  caja.replaceChildren(
    h('div', { class: 'pop-t' }, h('b', {}, 'Uso del plan'), h('span', {}, 'según Claude Code')),
    h('div', { class: 'uso-fila' }, h('span', {}, 'Últimas 5 horas'), h('b', {}, (pct(plan.cinco) ?? '—') + ' %' + (reinicio(plan.cinco) ? ' · se reinicia ' + reinicio(plan.cinco) : ''))),
    h('div', { class: 'uso-fila' }, h('span', {}, 'Semana'), h('b', {}, (pct(plan.semana) ?? '—') + ' %' + (reinicio(plan.semana) ? ' · se reinicia ' + reinicio(plan.semana) : ''))),
    h('div', { class: 'uso-fila' }, h('span', {}, 'Sesiones abiertas, estimado'), h('b', {}, 'US$ ' + costo.toFixed(2))));
  const r = $('#plan').getBoundingClientRect();
  Object.assign(caja.style, { top: r.bottom + 8 + 'px', left: Math.max(12, Math.min(r.left, innerWidth - 392)) + 'px' });
  caja.hidden = false;
});
document.addEventListener('click', (ev) => { if (!$('#pop-plan').hidden && !ev.target.closest('#pop-plan')) $('#pop-plan').hidden = true; });

// Un solo menú de modelo y esfuerzo, para la ventana (M1) y para la sugerencia de la barra (L1).
function menuModelo(ancla, actual, alElegir) {
  const caja = $('#pop-modelo');
  const elegido = { modelo: actual.modelo || 'opus', esfuerzo: actual.esfuerzo || 'xhigh', mcp: actual.mcp ? [...actual.mcp] : null };
  // Lite: casillas de servidores MCP, solo para una sesión y con el perfil MCP encendido. Rigen al abrir o retomar.
  const marcar = (n) => { elegido.mcp = elegido.mcp.includes(n) ? elegido.mcp.filter((x) => x !== n) : elegido.mcp.concat(n); pintarMenu(); };
  const filaMcp = (lista) => h('div', { class: 'niveles' }, lista.map((n) => h('button', { type: 'button', class: elegido.mcp.includes(n) ? 'sel' : '', 'aria-pressed': String(elegido.mcp.includes(n)), title: n === 'todo' ? 'Como siempre: todos los servidores, también Gmail y Docs de claude.ai' : null, onclick: (e) => { e.stopPropagation(); marcar(n); } }, n === 'todo' ? 'todo' : '+' + n)));
  const pintarMenu = () => caja.replaceChildren(
    h('div', { class: 'menu-t' }, 'Modelo'),
    MODELOS_UI.map(([id, nombre, dice]) => h('button', { type: 'button', class: 'menu-fila' + (elegido.modelo === id ? ' sel' : ''), role: 'menuitemradio', 'aria-checked': String(elegido.modelo === id), onclick: (e) => { e.stopPropagation(); elegido.modelo = id; pintarMenu(); } }, nombre, h('span', { class: 'menu-dato' }, dice))),
    h('div', { class: 'menu-t' }, 'Esfuerzo'),
    h('div', { class: 'niveles' }, NIVELES.map((n) => h('button', { type: 'button', class: elegido.esfuerzo === n ? 'sel' : '', 'aria-pressed': String(elegido.esfuerzo === n), onclick: (e) => { e.stopPropagation(); elegido.esfuerzo = n; pintarMenu(); } }, n))),
    ...(elegido.mcp ? [h('div', { class: 'menu-t' }, 'Servidores MCP (al retomar)'), filaMcp(['rea', 'whatsapp', 'methodic']), filaMcp(['effectcraft', 'chrome', 'todo'])] : []),
    h('button', { type: 'button', class: 'boton principal chico', onclick: (e) => { e.stopPropagation(); caja.hidden = true; alElegir(elegido); } }, 'Usar este'));
  pintarMenu();
  const r = ancla.getBoundingClientRect();
  caja.hidden = false;
  const alto = caja.offsetHeight;
  Object.assign(caja.style, { left: Math.max(12, Math.min(r.left, innerWidth - 252)) + 'px', top: (r.bottom + 6 + alto > innerHeight ? r.top - alto - 6 : r.bottom + 6) + 'px', right: 'auto' });
}
document.addEventListener('click', (ev) => { if (!$('#pop-modelo').hidden && !ev.target.closest('#pop-modelo')) $('#pop-modelo').hidden = true; });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { $('#pop-modelo').hidden = true; $('#pop-plan').hidden = true; } });
const modeloDeTexto = (t) => (/haiku/i.test(t) ? 'haiku' : /sonnet/i.test(t) ? 'sonnet' : /opus/i.test(t) ? 'opus' : '');

// M1: cambiar el de una sesión. Si está trabajando o te necesita, Chocosys espera a que termine (no escribe encima de su tarea).
function menuModeloDe(id, ancla) {
  const s = sesion(id);
  if (!s) return;
  const l = s.linea || {};
  const antes = { modelo: modeloDeTexto(l.modelo) || s.modelo, esfuerzo: l.esfuerzo || s.esfuerzo, mcp: perfilUI.mcp_por_sesion ? s.mcp || [] : null };
  menuModelo(ancla, antes, async (e) => {
    if (e.mcp && e.mcp.join() !== antes.mcp.join()) {
      const m = await api.sesionMcp(id, e.mcp);
      aviso(`Servidores MCP de «${s.nombre}»: ${e.mcp.length ? e.mcp.join(', ') : 'los de su entorno'}. Rige ${m.rige}.`);
      if (e.modelo === antes.modelo && e.esfuerzo === antes.esfuerzo) return;
    }
    const r = await api.cambiarModelo(id, e.modelo, e.esfuerzo);
    aviso(!r.ok ? r.motivo : r.espera ? `${r.necesita ? 'Espera tu respuesta' : 'Está trabajando'}: cambia a ${nombreModelo(e.modelo)} ${e.esfuerzo} cuando termine.` : `Cambiando a ${nombreModelo(e.modelo)} ${e.esfuerzo}.`);
  });
}

// L1: mientras escribes una orden sin @, la sugerencia al instante (reglas de clasificar-complejidad, la pestaña y lo
// que elegiste antes para algo parecido). Si la cambias, Chocosys lo anota y la próxima parecida sugiere lo tuyo.
let sugerencia = null, eleccionManual = null, esperaSugerir = null;
function pintarSugerido() {
  const e = eleccionManual || sugerencia;
  $('#sugerido').hidden = !e;
  if (!e) return;
  $('#sugerido-chip').textContent = `${nombreModelo(e.modelo)} 5.5 · ${e.esfuerzo} ▾`;
  $('#sugerido-porque').textContent = eleccionManual ? 'elegido por ti (la próxima parecida lo recuerda)' : `porque ${sugerencia.motivo}${sugerencia.regla ? ' (' + (sugerencia.regla === 'tuya' ? 'tu elección' : 'regla ' + sugerencia.regla) + ')' : ''}`;
}
$('#orden').addEventListener('input', () => {
  clearTimeout(esperaSugerir);
  const t = $('#orden').value.trim();
  if (!t || t.startsWith('@') || /^junta(r)?\s/i.test(t)) { sugerencia = null; eleccionManual = null; pintarSugerido(); return; }
  esperaSugerir = setTimeout(async () => { try { sugerencia = await api.sugerirModelo(t); } catch (e) { sugerencia = null; } pintarSugerido(); }, 180);
});
$('#sugerido-chip').addEventListener('mousedown', (e) => e.preventDefault());
$('#sugerido-chip').addEventListener('click', (ev) => {
  ev.stopPropagation();
  const e = eleccionManual || sugerencia;
  if (!e) return;
  menuModelo($('#sugerido-chip'), e, (elegido) => {
    eleccionManual = elegido.modelo === (sugerencia || {}).modelo && elegido.esfuerzo === (sugerencia || {}).esfuerzo ? null : elegido;
    pintarSugerido();
    $('#orden').focus();
  });
});


// ── Subagentes a la vista (sprint 14, A1) y lo que dice cada sesión que trabaja ──
// Cuándo parte y cuándo vuelve cada subagente llega por los avisos de Claude Code (sesiones[].subagentes). Lo que dice
// y hace, del final de su registro (api.ojear), que se pide cada 3 s solo mientras la lista «trabajando» o algún cuadro esté abierto.
const subAbiertos = new Set();
let ojeada = new Map();
let relojOjeo = null;
const ALTO_SUB = 92, PASO_SUB = 104;

function lapso(desde, hasta) {
  const seg = Math.max(0, Math.round(((hasta || Date.now()) - desde) / 1000));
  return seg < 60 ? seg + ' s' : Math.floor(seg / 60) + ' min ' + (seg % 60) + ' s';
}
function alternarSubagentes(id) {
  if (subAbiertos.has(id)) subAbiertos.delete(id); else subAbiertos.add(id);
  const s = sesion(id), v = ventanas.get(id);
  if (s && v) pintarSubagentes(s, v);
  seguirOjeando();
}
function pintarSubagentes(s, v) {
  const lista = s.subagentes || [];
  const trabajando = lista.filter((x) => x.estado === 'trabajando').length;
  v.subChip.hidden = !lista.length;
  v.subChip.textContent = !lista.length ? '' : trabajando ? `${lista.length} ${lista.length === 1 ? 'subagente' : 'subagentes'} ▾` : `✓ ${lista.length === 1 ? 'volvió' : lista.length + ' volvieron'} ▾`;
  v.subChip.classList.toggle('on', trabajando > 0);
  const abierto = subAbiertos.has(s.id) && lista.length > 0;
  v.subChip.setAttribute('aria-expanded', String(abierto));
  v.subs.hidden = !abierto;
  if (!abierto) return;
  const datos = new Map(((ojeada.get(s.id) || {}).subagentes || []).map((x) => [x.id, x]));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'v-sub-flechas');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '64');
  svg.setAttribute('height', String(lista.length * PASO_SUB));
  const cuadros = lista.map((x, i) => {
    const d = Object.assign({}, x, datos.get(x.id) || {});
    const volvio = d.estado === 'volvio';
    // Ida punteada desde la ventana mientras trabaja; vuelta verde hacia la ventana cuando entrega.
    const y1 = 56 + i * 18, y2 = i * PASO_SUB + ALTO_SUB / 2;
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', volvio ? `M64 ${y2} C34 ${y2} 30 ${y1} 0 ${y1}` : `M0 ${y1} C30 ${y1} 34 ${y2} 64 ${y2}`);
    p.setAttribute('class', volvio ? 'vuelta' : 'ida');
    svg.append(p);
    return h('div', { class: 'v-sub' + (volvio ? ' listo' : ''), style: `top:${i * PASO_SUB}px` },
      h('div', { class: 'v-sub-tp' }, h('span', { class: 'punto ' + (volvio ? 'verde' : 'respira') }), `${d.tipo} · ${volvio ? 'volvió en ' + lapso(d.inicio, d.fin) : 'trabajando hace ' + lapso(d.inicio)}`),
      h('b', {}, d.tarea || 'Subagente'),
      h('span', {}, [d.herramientas ? d.herramientas + (d.herramientas === 1 ? ' herramienta' : ' herramientas') : '', d.tokens ? (d.tokens >= 1000 ? (d.tokens / 1000).toFixed(1).replace('.', ',') + ' k' : d.tokens) + ' tokens escritos' : '', volvio ? (d.ultimo || d.dijo || 'Entregó su resultado.') : (d.hace || d.dijo || 'Partiendo…')].filter(Boolean).join(' · ')));
  });
  v.subs.replaceChildren(svg, ...cuadros);
}

// Lo que Claude Code muestra mientras trabaja («✶ Crunching… (19s · ↓ 1.5k tokens)»), leído de las últimas líneas de su
// terminal (sprint 17, idea de OpenHarness). Solo con la lista «trabajando» o la de una pestaña abiertas: no lee archivos.
function enVivo(id) {
  const t = terminales.get(id);
  if (!t) return '';
  const b = t.term.buffer.active;
  for (let i = b.length - 1; i >= Math.max(0, b.length - 30); i--) {
    const l = b.getLine(i);
    const m = l && l.translateToString(true).match(/^\s*\S\s+(\p{L}+…)\s*\(([^)]*)\)/u);
    if (m) return m[1] + ' ' + m[2].replace(/esc to interrupt/i, '').replace(/\s*·\s*$/, '').trim();
  }
  return '';
}
async function ojearAhora() {
  if (document.visibilityState !== 'visible') return;
  try { ojeada = new Map((await api.ojear()).map((x) => [x.id, x])); } catch (e) { return; }
  if (!$('#lista-trabajando').hidden) pintarTrabajando();
  for (const id of subAbiertos) { const s = sesion(id), v = ventanas.get(id); if (s && v) pintarSubagentes(s, v); }
  seguirOjeando();
}
// El reloj corre solo si hay algo abierto que lo muestre (la lista «trabajando» o un cuadro de subagentes): en
// reposo, Chocosys no lee ningún registro. Al cerrar la lista, el reloj se apaga solo en la vuelta siguiente.
function seguirOjeando() {
  const hayQueVer = !$('#lista-trabajando').hidden || [...subAbiertos].some((id) => (sesion(id) || {}).subagentes && sesion(id).subagentes.length);
  if (hayQueVer && !relojOjeo) { ojearAhora(); relojOjeo = setInterval(ojearAhora, 3000); }
  if (!hayQueVer && relojOjeo) { clearInterval(relojOjeo); relojOjeo = null; }
}

// ── Qué usas (sprint 14, H7): cada clic, atajo y tipo de orden suma uno en uso.json, para decidir qué priorizar ──
function claveDeUso(el) {
  if (el.id) return el.id;
  if (el.closest('#espacios')) return 'pestaña';
  if (el.classList.contains('v-subchip')) return 'ventana:subagentes';
  if (el.classList.contains('v-hacer-flujo')) return 'hacer-flujo';
  if (el.closest('.v-barra')) return 'ventana:' + (el.getAttribute('aria-label') || 'botón');
  if (el.closest('#lista-trabajando')) return 'trabajando:ir';
  return el.dataset.uso || '';
}
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('button, .pill, .chip, .herr, [data-uso]');
  const clave = el && claveDeUso(el);
  if (clave) api.uso(clave);
}, true);
// Conteos que no son un botón con id (sprint 21, H6): su nombre en «Qué usas».
const NOMBRES_USO = { 'hacer-flujo': 'Hacer flujo', 'receta-desde-propuesta': 'Receta guardada desde «Hacer flujo»',
  // Sprint 20 (H3): las filas del menú del «+» de pestañas y de «Nueva sesión».
  'crear:pestana-entorno': 'Pestaña de un entorno', 'crear:pestana-vacia': 'Pestaña vacía', 'crear:sesion-aqui': 'Sesión en la carpeta de la pestaña',
  'crear:sesion-entorno': 'Sesión en un entorno', 'crear:sesion-elegir': 'Sesión en otra carpeta' };
function nombreDeUso(clave) {
  if (NOMBRES_USO[clave]) return NOMBRES_USO[clave] + ' · ' + clave;
  const el = document.getElementById(clave);
  const texto = el ? (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  return texto && texto.length < 40 ? texto + ' · ' + clave : clave;
}
async function abrirQueUsas() {
  const caja = $('#panel-uso');
  let u;
  try { u = await api.usoLeer(); } catch (e) { return; }
  const veces = Object.entries(u.veces || {}).sort((a, b) => b[1] - a[1]);
  // Lo que nunca se tocó: los botones con id de la barra de arriba, la paleta y la barra de abajo.
  const todos = [...document.querySelectorAll('.barra-sup button[id], .paleta button[id], .chips button[id]')].map((b) => b.id);
  const nunca = todos.filter((id) => !(u.veces || {})[id]);
  const estado = h('p', { class: 'pop-nada uso-estado' });
  const exportar = h('button', { type: 'button', class: 'uso-exportar', title: 'Guarda un archivo con estas cuentas para que lo envíes tú' }, 'Exportar para compartir…');
  exportar.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (!api.usoExportar) { estado.textContent = 'Disponible al reiniciar Chocosys.'; return; }
    try {
      const ruta = await api.usoExportar(nunca);
      estado.textContent = ruta ? 'Guardado en ' + ruta + '. Envíalo tú, si quieres.' : '';
    } catch (e) { estado.textContent = 'No se pudo guardar.'; }
  });
  caja.replaceChildren(
    h('div', { class: 'pop-t' }, h('b', {}, 'Qué usas'), h('span', {}, 'desde el ' + String(u.desde || '').split('-').reverse().join('-') + ' · solo en este computador')),
    veces.length ? h('div', { class: 'uso-lista' }, veces.slice(0, 25).map(([k, n]) => h('div', { class: 'uso-fila' }, h('span', {}, nombreDeUso(k)), h('b', {}, String(n))))) : h('p', { class: 'pop-nada' }, 'Todavía no hay usos anotados.'),
    nunca.length ? h('p', { class: 'pop-nada' }, h('b', {}, 'Nunca usado: '), nunca.map(nombreDeUso).join(' · ')) : null,
    h('p', { class: 'pop-nada uso-aviso' }, 'Al exportar solo salen estas cuentas: sin textos, sin nombres de sesiones ni carpetas, sin costos. Lo envías tú, si quieres.'),
    exportar, estado);
  caja.hidden = false;
  const r = $('#menu-boton').getBoundingClientRect();
  Object.assign(caja.style, { top: r.bottom + 8 + 'px', left: Math.max(12, Math.min(r.right - 380, innerWidth - 392)) + 'px' });
}
$('#que-usas').addEventListener('click', (ev) => { ev.stopPropagation(); abrirQueUsas(); });
document.addEventListener('click', (ev) => { if (!$('#panel-uso').hidden && !ev.target.closest('#panel-uso')) $('#panel-uso').hidden = true; });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') $('#panel-uso').hidden = true; });

// ── Barra de arriba: pestañas que se corren y menú ☰ (sprint 13, alternativa 4) ──

// Las flechas aparecen solo si las pestañas no caben. La de un lado se enciende si ahí, fuera de la vista, hay una
// pestaña que te necesita: lo que espera algo de ti nunca queda escondido.
function verFlechas() {
  const cont = $('#espacios');
  const sobra = cont.scrollWidth - cont.clientWidth > 1;
  const izq = sobra && cont.scrollLeft > 1;
  const der = sobra && cont.scrollLeft < cont.scrollWidth - cont.clientWidth - 1;
  $('#esp-izq').hidden = !sobra;
  $('#esp-der').hidden = !sobra;
  $('#esp-izq').disabled = !izq;
  $('#esp-der').disabled = !der;
  cont.classList.toggle('corta-izq', izq);
  cont.classList.toggle('corta-der', der);
  const r = cont.getBoundingClientRect();
  const alarmas = [...cont.querySelectorAll('.pill.alarma')].map((p) => p.getBoundingClientRect());
  $('#esp-izq').classList.toggle('alarma', alarmas.some((a) => a.left < r.left - 1));
  $('#esp-der').classList.toggle('alarma', alarmas.some((a) => a.right > r.right + 1));
}
// La rueda vertical corre la fila hacia el lado; el touchpad horizontal queda nativo.
$('#espacios').addEventListener('wheel', (ev) => {
  const c = ev.currentTarget;
  if (c.scrollWidth <= c.clientWidth || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
  ev.preventDefault();
  c.scrollBy({ left: ev.deltaY, behavior: 'instant' });
}, { passive: false });
$('#espacios').addEventListener('scroll', verFlechas);
new ResizeObserver(verFlechas).observe($('#espacios'));
$('#esp-izq').addEventListener('click', () => $('#espacios').scrollBy({ left: -$('#espacios').clientWidth * 0.7, behavior: 'smooth' }));
$('#esp-der').addEventListener('click', () => $('#espacios').scrollBy({ left: $('#espacios').clientWidth * 0.7, behavior: 'smooth' }));

function pasarEspacio(paso) {
  const i = espacios.findIndex((x) => x.id === actual);
  const e = espacios[(i + paso + espacios.length) % espacios.length];
  if (!e) return;
  if (modo === 'inicio') cambiarModo(modoPrevio || 'lienzo');
  cambiarEspacio(e.id);
}

// Tema, segunda opinión y tutorial viven en el menú con su mismo id: sus funciones siguen iguales.
function cerrarMenuBarra() { $('#menu-barra').hidden = true; $('#menu-boton').setAttribute('aria-expanded', 'false'); }
$('#menu-boton').addEventListener('click', (ev) => {
  ev.stopPropagation();
  const m = $('#menu-barra');
  m.hidden = !m.hidden;
  $('#menu-boton').setAttribute('aria-expanded', String(!m.hidden));
});
// En captura: «Segunda opinión» corta la propagación. El tema se puede cambiar varias veces seguidas.
$('#menu-barra').addEventListener('click', (ev) => { if (!ev.target.closest('#tema')) cerrarMenuBarra(); }, true);
document.addEventListener('click', (ev) => { if (!$('#menu-barra').hidden && !ev.target.closest('.menu-barra-caja')) cerrarMenuBarra(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#menu-barra').hidden) cerrarMenuBarra(); });

$('#trabajando').addEventListener('click', (ev) => {
  ev.stopPropagation();
  const caja = $('#lista-trabajando');
  caja.hidden = !caja.hidden;
  $('#trabajando').setAttribute('aria-expanded', String(!caja.hidden));
  if (!caja.hidden) { filasTrabajando.firma = ''; pintarTrabajando(); }
  seguirOjeando();
});
document.addEventListener('click', (ev) => { const caja = $('#lista-trabajando'); if (!caja.hidden && !caja.contains(ev.target)) { caja.hidden = true; $('#trabajando').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#lista-trabajando').hidden) { $('#lista-trabajando').hidden = true; $('#trabajando').setAttribute('aria-expanded', 'false'); } });

// Ordenar: las ventanas sueltas del espacio a una grilla, después de los flujos.
// ── Mosaico (sprint 17, L1): las ventanas sueltas se reparten la pantalla al 100 %, sin alejar el zoom ──
// Se aplica al cambiar cuántas hay en la pestaña o el tamaño de la ventana de Chocosys. Las que moviste a mano (fija)
// quedan donde están hasta «Ordenar». Los flujos siguen en su marco, arriba; el mosaico ocupa lo que queda debajo.
const ESPACIO_MOSAICO = { izq: 96, arriba: 132, der: 24, abajo: 160, gapX: 16, gapY: 52 };
let firmaMosaico = '';
const mosaicoEncendido = (id) => { try { return localStorage.getItem('chocosys-mosaico-' + id) !== 'no'; } catch (e) { return true; } };
function columnasPara(n) { return n <= 3 ? Math.max(1, n) : n === 4 ? 2 : 3; }
function aplicarMosaico(forzar) {
  if (modo !== 'lienzo' || !actual || !mosaicoEncendido(actual)) return false;
  const libres = delEspacio(sesiones).filter((s) => !s.flujo && !s.fija);
  const r = $('#vista-lienzo').getBoundingClientRect();
  // Los flujos entran en la firma: uno nuevo en la pestaña empuja el mosaico hacia abajo.
  const marcosF = delEspacio(flujos).map((f) => f.id + ':' + (f.pos ? f.pos.y + tamanoMarco(f).h : '')).join(',');
  const firma = actual + '|' + libres.map((s) => s.id).join(',') + '|' + marcosF + '|' + Math.round(r.width) + 'x' + Math.round(r.height);
  if (!forzar && firma === firmaMosaico) return false;
  firmaMosaico = firma;
  if (!libres.length || r.width < 200) return false;
  const E = ESPACIO_MOSAICO;
  // Debajo de los marcos de flujo de esta pestaña, si hay.
  let arriba = E.arriba;
  for (const f of delEspacio(flujos)) if (f.pos) arriba = Math.max(arriba, f.pos.y + tamanoMarco(f).h + E.gapY);
  const ancho = r.width - E.izq - E.der;
  const alto = Math.max(MINIMO.h, r.height - arriba - E.abajo);
  const cols = columnasPara(libres.length);
  // Solo las filas que caben enteras con el alto mínimo; las demás quedan completas más abajo, a un giro de rueda
  // (prueba del 22-10-2026: con 7 sesiones en 860 px de alto, la tercera fila salía cortada).
  const caben = Math.max(1, Math.floor((alto + E.gapY) / (MINIMO.h + E.gapY)));
  const filasVisibles = Math.min(3, caben, Math.ceil(libres.length / cols));
  const w = Math.max(MINIMO.w, Math.floor((ancho - (cols - 1) * E.gapX) / cols));
  const h = Math.max(MINIMO.h, Math.floor((alto - (filasVisibles - 1) * E.gapY) / filasVisibles));
  libres.forEach((s, i) => {
    s.pos = { x: Math.round(E.izq + (i % cols) * (w + E.gapX)), y: Math.round(arriba + Math.floor(i / cols) * (h + E.gapY)), w, h };
    api.posicion(s.id, s.pos, false);
  });
  // Al 100 % y sin desplazamiento: lo que ves es la pantalla tal cual.
  const v = vista();
  v.x = 0; v.y = 0; v.zoom = 1;
  aplicarVista(true);
  return true;
}
let esperaMosaico = null;
function pedirMosaico() { clearTimeout(esperaMosaico); esperaMosaico = setTimeout(() => { if (aplicarMosaico()) { pintar(); requestAnimationFrame(() => { for (const s of delEspacio(sesiones)) ajustar(s.id); }); } }, 120); }
new ResizeObserver(pedirMosaico).observe($('#vista-lienzo'));
function pintarBotonMosaico() {
  const b = $('#mosaico');
  if (!b || !actual) return;
  const on = mosaicoEncendido(actual);
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('on', on);
}
$('#mosaico').addEventListener('click', () => {
  const on = !mosaicoEncendido(actual);
  try { localStorage.setItem('chocosys-mosaico-' + actual, on ? 'si' : 'no'); } catch (e) { /* sin guardar */ }
  pintarBotonMosaico();
  if (on) { firmaMosaico = ''; pedirMosaico(); }
  aviso(on ? 'Mosaico: las ventanas de esta pestaña se reparten la pantalla.' : 'Mosaico apagado en esta pestaña: acomoda las ventanas a mano.');
});

function ordenarLienzo() {
  const sueltas = delEspacio(sesiones).filter((s) => !s.flujo);
  // «Ordenar» suelta las que estaban fijas; con el mosaico encendido, las reparte en la pantalla.
  for (const s of sueltas) s.fija = false;
  if (mosaicoEncendido(actual) && modo === 'lienzo') {
    let y = alPaso(GRILLA.y0);
    for (const f of delEspacio(flujos)) { f.pos = { x: alPaso(GRILLA.x0), y }; api.posicionFlujo(f.id, f.pos); y = alPaso(y + tamanoMarco(f).h + GRILLA.fila); }
    aplicarMosaico(true);
    pintar();
    requestAnimationFrame(() => { for (const s of sueltas) ajustar(s.id); });
    return;
  }
  for (const s of sueltas) s.pos = null;
  let y = alPaso(GRILLA.y0);
  for (const f of delEspacio(flujos)) {
    f.pos = { x: alPaso(GRILLA.x0), y };
    api.posicionFlujo(f.id, f.pos);
    y = alPaso(y + tamanoMarco(f).h + GRILLA.fila);
  }
  sueltas.forEach((s, i) => {
    s.pos = { x: alPaso(GRILLA.x0 + (i % 3) * (VENTANA.w + GRILLA.gap)), y: alPaso(y + Math.floor(i / 3) * (VENTANA.h + GRILLA.fila)), w: VENTANA.w, h: VENTANA.h };
    api.posicion(s.id, s.pos);
  });
  pintar();
  requestAnimationFrame(() => { for (const s of sueltas) ajustar(s.id); ajustarTodo(); });
}

// ── Barra de comando ────────────────────────────────────

// La barra le habla a una, a varias o a todas las sesiones, de esta pestaña o de otras:
//   @alfa hola · @alfa @beta: revisen esto · @todas: guarden y paren · @#Empresa: …  (todas las de esa pestaña)
//   junta @alfa @beta: un solo informe  → abre una sesión nueva que lee lo que hicieron y lo junta.
let sugerenciaSel = 0;
const TODAS = ['todas', 'todos'];
// Lo que se está escribiendo después del último @ (si todavía no empezó la orden).
function ultimoArroba(texto) {
  const m = texto.match(/^(?:junta(?:r)?\s+)?((?:@[^@:]*?\s*,?\s*)*)@([^@:]*)$/i);
  return m ? { antes: texto.slice(0, texto.length - m[2].length - 1), q: m[2].toLowerCase() } : null;
}
function candidatos(texto) {
  const u = ultimoArroba(texto);
  if (!u) return [];
  const extra = [];
  if ('todas'.startsWith(u.q.trim()) || 'todos'.startsWith(u.q.trim())) extra.push({ tipo: 'todas', nombre: 'todas', sub: 'las de esta pestaña' });
  for (const e of espacios) if (('#' + e.nombre.toLowerCase()).includes(u.q.trim()) && u.q.trim().startsWith('#')) extra.push({ tipo: 'espacio', nombre: '#' + e.nombre, sub: 'todas las de esa pestaña' });
  const ses = sesiones.filter((s) => s.nombre.toLowerCase().includes(u.q.trim())).map((s) => ({ tipo: 'sesion', nombre: s.nombre, s }));
  return [...extra, ...ses].slice(0, 9);
}
function pintarSugerencias() {
  const lista = candidatos($('#orden').value);
  const ul = $('#sugerencias');
  ul.hidden = !lista.length;
  if (!lista.length) return;
  sugerenciaSel = Math.min(sugerenciaSel, lista.length - 1);
  ul.replaceChildren(...lista.map((c, i) => h('li', { class: 'sugerencia' + (i === sugerenciaSel ? ' sel' : ''), role: 'option', onmousedown: (e) => { e.preventDefault(); completar(c); } },
    c.s ? h('span', { class: 'lampara e-' + c.s.estado }) : h('span', { class: 'lampara grupo' }), c.nombre,
    h('span', { class: 's-esp' }, c.s ? (espacio(c.s.espacio) || {}).nombre || '' : c.sub))));
}
// Completa el último @ y deja un espacio: se puede seguir con otro @ o escribir la orden.
function completar(c) {
  const campo = $('#orden');
  const u = ultimoArroba(campo.value) || { antes: '' };
  campo.value = u.antes + '@' + c.nombre + ' ';
  $('#sugerencias').hidden = true;
  campo.focus();
}
// Lee los destinos del principio del texto. Los nombres pueden tener espacios: se prueba el más largo primero.
function leerDestinos(texto) {
  let resto = texto;
  const ids = new Set();
  const nombres = [];
  const porLargo = sesiones.slice().sort((a, b) => b.nombre.length - a.nombre.length);
  const espaciosPorLargo = espacios.slice().sort((a, b) => b.nombre.length - a.nombre.length);
  for (;;) {
    resto = resto.replace(/^[\s,]+/, '');
    if (!resto.startsWith('@')) break;
    const cuerpo = resto.slice(1);
    const bajo = cuerpo.toLowerCase();
    const todas = TODAS.find((t) => bajo.startsWith(t) && !/[\p{L}\d]/u.test(bajo.charAt(t.length)));
    if (todas) {
      for (const s of delEspacio(sesiones)) ids.add(s.id);
      nombres.push('todas las de esta pestaña');
      resto = cuerpo.slice(todas.length);
      continue;
    }
    if (bajo.startsWith('#')) {
      const e = espaciosPorLargo.find((x) => bajo.slice(1).startsWith(x.nombre.toLowerCase()));
      if (!e) return { error: 'No hay una pestaña con ese nombre después de #.' };
      for (const s of sesiones) if (s.espacio === e.id) ids.add(s.id);
      nombres.push('las de «' + e.nombre + '»');
      resto = cuerpo.slice(1 + e.nombre.length);
      continue;
    }
    const s = porLargo.find((x) => bajo.startsWith(x.nombre.toLowerCase()));
    if (!s) return { error: 'No hay una sesión con ese nombre. Escribe @ y elige de la lista.' };
    ids.add(s.id);
    nombres.push('«' + s.nombre + '»');
    resto = cuerpo.slice(s.nombre.length);
  }
  return { ids: [...ids], nombres, orden: resto.replace(/^[\s:,]+/, '').trim() };
}
async function enviarOrden() {
  const campo = $('#orden');
  const texto = campo.value.trim();
  if (!texto) return;
  const juntar = texto.match(/^junta(?:r)?\s+/i);
  const orquesta = texto.match(/^orquest(?:a|ar)\b\s*:?\s*/i);
  api.uso('orden:' + (orquesta ? 'orquesta' : juntar ? 'junta' : /^@todas\b/i.test(texto) ? '@todas' : texto.startsWith('@') ? '@sesion' : 'sesion-nueva'));
  if (juntar) { await juntarSesiones(texto.slice(juntar[0].length)); return; }
  // «orquesta: objetivo» o «orquesta @a @b: objetivo» (sprint 16): una coordinadora reparte y te informa.
  if (orquesta && EDICION === 'terminales') { aviso('La orquesta usa el MCP, que esta edición no lleva: está en lite/flujos y en la completa.'); return; }
  if (orquesta) {
    let resto = texto.slice(orquesta[0].length), ids = [];
    if (resto.startsWith('@')) {
      const d = leerDestinos(resto);
      if (d.error) { aviso(d.error); return; }
      ids = d.ids;
      resto = d.orden || '';
    }
    if (modo === 'inicio') cambiarModo(modoPrevio || 'lienzo');
    const s = await api.orquestar(resto, ids);
    if (!s || s.error) { aviso((s && s.error) || 'No se pudo abrir la coordinadora.'); return; }
    campo.value = '';
    sugerencia = null; eleccionManual = null; pintarSugerido();
    if (!sesion(s.id)) sesiones.push(s);
    seleccionar(s.id);
    aviso('La coordinadora reparte el trabajo y te informa en su ventana y en su INFORME.');
    return;
  }
  if (texto.startsWith('@')) {
    const d = leerDestinos(texto);
    if (d.error) { aviso(d.error); return; }
    if (!d.ids.length) { aviso('No hay sesiones a quién mandarle eso.'); return; }
    if (!d.orden) { if (d.ids.length === 1) { seleccionar(d.ids[0]); campo.value = ''; } else aviso('Falta la orden después de los nombres.'); return; }
    const cerradas = [];
    for (const id of d.ids) {
      const ok = await api.ordenar(id, d.orden);
      if (!ok) { cerradas.push((sesion(id) || {}).nombre); continue; }
      const v = ventanas.get(id);
      if (v) { v.el.classList.add('recibe'); setTimeout(() => v.el.classList.remove('recibe'), 700); }
    }
    campo.value = '';
    const enviadas = d.ids.length - cerradas.length;
    aviso((d.ids.length === 1 ? `Enviada a ${d.nombres[0]}.` : `Enviada a ${enviadas} de ${d.ids.length} (${d.nombres.join(', ')}).`) +
      (cerradas.length ? ` Cerradas, retómalas primero: ${cerradas.join(', ')}.` : ''));
    return;
  }
  // Desde el Inicio, una orden sin @ abre la sesión en la pestaña de la que se venía.
  if (modo === 'inicio') cambiarModo(modoPrevio || 'lienzo');
  const carpeta = await api.carpetaEspacio(actual);
  if (!carpeta) { aviso('Elige la carpeta de este espacio para abrir sesiones desde la barra.'); return; }
  // El modelo y el esfuerzo de la sugerencia (L1), o los que elegiste en su chip. Si los cambiaste, queda anotado.
  const elegido = eleccionManual || sugerencia || (await api.sugerirModelo(texto).catch(() => null));
  if (eleccionManual) api.eleccionModelo(texto, eleccionManual.modelo, eleccionManual.esfuerzo);
  const s = await api.nueva(carpeta, texto, elegido ? { modelo: elegido.modelo, esfuerzo: elegido.esfuerzo } : undefined);
  if (!s) return;
  campo.value = '';
  sugerencia = null; eleccionManual = null; pintarSugerido();
  if (!sesion(s.id)) sesiones.push(s);
  seleccionar(s.id);
  if (modo === 'lienzo') centrarEn(posDeSesion(sesion(s.id) || s), vista().zoom < 0.97 ? 1 : vista().zoom);
}

// Juntar: una sesión nueva, en la carpeta de esta pestaña, lee las conversaciones de las elegidas (de esta
// pestaña o de otras) y junta lo que hicieron. Las conversaciones son los .jsonl que guarda Claude Code.
async function juntarSesiones(texto) {
  const d = leerDestinos(texto);
  if (d.error) { aviso(d.error); return; }
  if (d.ids.length < 1) { aviso('Escribe a quiénes juntar: junta @alfa @beta: qué quieres.'); return; }
  const carpeta = await api.carpetaEspacio(actual);
  if (!carpeta) { aviso('Elige la carpeta de esta pestaña: ahí queda el informe.'); return; }
  const trans = await api.transcripciones(d.ids);
  const fuentes = trans.map((t) => t.existe
    ? `«${t.nombre}» (trabajó en ${t.carpeta}): ${t.ruta}`
    : `«${t.nombre}» (trabajó en ${t.carpeta}): su conversación no está en ${t.ruta}; búscala entre los .jsonl más recientes de ${t.carpetaProyecto}`);
  const hoy = new Date();
  const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const pedido = d.orden || `resume qué pidió y qué dejó hecho cada una (archivos creados o cambiados, decisiones, pendientes) y júntalo en un solo informe en context/JUNTAR-${fecha}.md`;
  const instruccion = `Junta el trabajo de ${trans.length === 1 ? 'esta sesión' : `estas ${trans.length} sesiones`} de Chocosys. Sus conversaciones son archivos .jsonl de Claude Code (una línea JSON por mensaje; lo útil son los mensajes del usuario y del asistente y las herramientas que usó): ` +
    fuentes.join(' · ') + `. Léelas sin modificarlas ni modificar sus archivos, y después: ${pedido}.`;
  const s = await api.nueva(carpeta, instruccion);
  if (!s) return;
  const nombre = 'juntar · ' + trans.map((t) => t.nombre).join(' + ').slice(0, 44);
  await api.renombrar(s.id, nombre);
  s.nombre = nombre;
  if (!sesion(s.id)) sesiones.push(s);
  $('#orden').value = '';
  seleccionar(s.id);
  if (modo === 'lienzo') centrarEn(posDeSesion(sesion(s.id) || s), vista().zoom < 0.97 ? 1 : vista().zoom);
  const faltan = trans.filter((t) => !t.existe).length;
  aviso(`Juntando ${d.nombres.join(', ')} en «${nombre}».` + (faltan ? ` ${faltan} sin conversación a la vista: la buscará.` : ''));
}

// ── Puerta ──────────────────────────────────────────────

// La confirmación de una puerta crítica es de ESE flujo: un segundo clic sobre otra puerta no la usa.
// Entre el primer y el segundo clic tiene que pasar al menos ESPERA_MINIMA (un doble clic no aprueba).
let confirmarPuerta = null;
let confirmando = null;   // { fid, desde }
const ESPERA_MINIMA = 600;
function confirmacionVale(fid) {
  return !!(confirmarPuerta && confirmando && confirmando.fid === fid && Date.now() - confirmando.desde >= ESPERA_MINIMA);
}
function aprobar(fid, origen) {
  const f = flujo(fid);
  if (!f || f.simulacro) return;
  const puerta = f.items[f.actual];
  if (puerta && puerta.critica && origen !== 'confirmación') {
    if (confirmando && confirmando.fid === fid && confirmarPuerta) return;   // segundo clic demasiado rápido: sigue esperando
    const boton = $('#puerta-aprobar');
    boton.replaceChildren('Confirmar: no se puede deshacer');
    boton.classList.add('confirmar');
    clearTimeout(confirmarPuerta);
    confirmando = { fid, desde: Date.now() };
    confirmarPuerta = setTimeout(restaurarAprobar, 6000);
    return;
  }
  restaurarAprobar();
  seguirFlujo = fid;
  // En una puerta de elegir, la elección viaja con la aprobación y queda escrita en el archivo.
  const datos = puerta && puerta.elegir && eleccion.items.length && String(eleccion.clave).startsWith(fid + ':') ? datosEleccion() : null;
  api.aprobar(fid, origen, datos).then((ok) => { if (!ok && datos) aviso('No se pudo anotar la elección en el archivo: la puerta sigue cerrada.'); });
}
let textoAprobar = 'Aprobar y seguir ';
function restaurarTextoAprobar(texto) {
  if (textoAprobar === texto) return;
  textoAprobar = texto;
  if (!confirmarPuerta) restaurarAprobar();
}
function restaurarAprobar() {
  clearTimeout(confirmarPuerta);
  confirmarPuerta = null;
  confirmando = null;
  const boton = $('#puerta-aprobar');
  boton.classList.remove('confirmar');
  // En la puerta crítica Ctrl+Enter no aprueba, así que no se muestra.
  const f = esPuerta(sel) && flujo(sel.slice(2));
  const critica = f && f.items[f.actual] && f.items[f.actual].critica;
  boton.replaceChildren(textoAprobar, critica ? null : h('kbd', {}, 'Ctrl Enter'));
}
let pidiendoCambios = false;
function pedirCambios() {
  const f = esPuerta(sel) ? flujo(sel.slice(2)) : null;
  if (!f) return;
  const texto = $('#puerta-indicacion');
  if (!pidiendoCambios) {
    pidiendoCambios = true;
    $('#puerta-cambios').hidden = false;
    $('#puerta-pedir').textContent = 'Enviar cambios';
    texto.focus();
    return;
  }
  if (!texto.value.trim()) { texto.focus(); return; }
  seguirFlujo = f.id;
  api.pedirCambios(f.id, texto.value);
  cerrarCambios();
}
function cerrarCambios() {
  pidiendoCambios = false;
  $('#puerta-cambios').hidden = true;
  $('#puerta-indicacion').value = '';
  $('#puerta-pedir').textContent = 'Pedir cambios';
}

// Después de lanzar, aprobar o pedir cambios, el foco sigue a la etapa que está trabajando.
function seguir() {
  if (!seguirFlujo) return;
  const f = flujo(seguirFlujo);
  if (!f) { seguirFlujo = null; return; }
  if (f.estado === 'puerta') { seguirFlujo = null; seleccionar('p:' + f.id); return; }
  const it = f.items[f.actual];
  if (it && it.tipo === 'etapa' && it.estado === 'trabajando' && it.sesiones.length && sesion(it.sesiones[0])) {
    seguirFlujo = null;
    if (sel && esPuerta(sel)) sel = null;
    seleccionar(it.sesiones[0], true);
    if (modo === 'lienzo') requestAnimationFrame(() => { const t = tamanoMarco(f); centrarEn({ x: f.pos.x, y: f.pos.y, w: t.w, h: t.h }, Math.min(1, vista().zoom)); });
  }
}

// ── Lanzador ────────────────────────────────────────────

const lanzador = { recetas: [], receta: null, carpeta: null, agentes: {}, puertas: {}, modelos: {}, simulacro: false };
const SIGUIENTE_MODELO = { auto: 'haiku', haiku: 'opus', opus: 'auto' };

async function abrirLanzador() {
  if (EDICION === 'terminales') return;
  lanzador.recetas = await api.recetas();
  // Sprint 21 (D4): los borradores de receta_proponer que nadie guardó ni descartó, arriba de la lista.
  try { lanzador.pendientes = api.propuestas ? await api.propuestas() : []; } catch (err) { lanzador.pendientes = []; }
  if (!lanzador.receta || !lanzador.recetas.find((r) => r.id === lanzador.receta)) {
    const primera = lanzador.recetas.find((r) => !r.error);
    lanzador.receta = primera ? primera.id : null;
  }
  const elegida = lanzador.recetas.find((r) => r.id === lanzador.receta);
  lanzador.carpeta = (elegida && elegida.carpeta) || '';
  lanzador.agentes = {};
  lanzador.puertas = {};
  lanzador.modelos = {};
  pintarLanzador();
  const m = $('#lanzador');
  m.classList.remove('saliendo');
  m.hidden = false;
  // La receta elegida a la vista en la lista (si no, a la derecha se ven etapas de una receta que no se ve).
  const elegidaEl = $('#recetas .receta.sel');
  if (elegidaEl) elegidaEl.scrollIntoView({ block: 'nearest' });
  $('#lanzador-lanzar').focus();
}
function cerrarLanzador() {
  const m = $('#lanzador');
  if (m.hidden) return;
  m.classList.add('saliendo');
  setTimeout(() => { m.hidden = true; m.classList.remove('saliendo'); }, 150);
}
function pintarLanzador() {
  const receta = lanzador.recetas.find((r) => r.id === lanzador.receta);
  // Recetas por grupo, cada grupo con su rótulo. El orden lo pone cada uno en su perfil (orden_recetas); los grupos que
  // no nombra van después, por orden alfabético, y las pruebas al final.
  const primero = perfilUI.orden_recetas || [];
  const peso = (g) => (primero.includes(g) ? primero.indexOf(g) : (g === 'Pruebas' ? 99 : 50));
  const grupos = [...new Set(lanzador.recetas.map((r) => r.grupo || 'Otras'))].sort((a, b) => peso(a) - peso(b) || a.localeCompare(b));
  const pendientes = lanzador.pendientes || [];
  const fichaPendiente = (p) => h('button', { type: 'button', class: 'receta propuesta-pendiente' + (p.error ? ' error' : ''), onclick: () => abrirPendiente(p) },
    h('span', { class: 'receta-nombre' }, p.receta ? p.receta.nombre : p.id),
    h('span', { class: 'receta-desc' }, p.error ? 'No pasa la validación: ábrela para corregirla'
      : [p.sesion ? `De «${p.sesion.nombre}»` : 'De fuera de una sesión', fechaPropuesta(p.creada)].join(' · ')));
  $('#recetas').replaceChildren(...(pendientes.length ? [h('span', { class: 'rotulo receta-grupo' }, 'Propuestas pendientes'), ...pendientes.map(fichaPendiente)] : []), ...grupos.flatMap((g) => [
    h('span', { class: 'rotulo receta-grupo' }, g),
    ...lanzador.recetas.filter((r) => (r.grupo || 'Otras') === g).map((r) =>
      h('button', { type: 'button', class: 'receta' + (r.id === lanzador.receta ? ' sel' : '') + (r.error ? ' error' : ''), onclick: () => elegirReceta(r) },
        h('span', { class: 'receta-nombre' }, r.nombre), h('span', { class: 'receta-desc' }, r.descripcion)))
  ]));
  const carpeta = $('#lanzador-carpeta');
  carpeta.textContent = lanzador.carpeta || 'Sin elegir';
  carpeta.classList.toggle('vacio', !lanzador.carpeta);
  carpeta.title = lanzador.carpeta || '';
  $('#lanzador-simulacro').setAttribute('aria-pressed', String(lanzador.simulacro));
  if (!receta) { $('#lanzador-etapas').replaceChildren(); $('#lanzador-resumen').textContent = ''; return; }
  const cambiar = (clave, idx, valor) => { lanzador[clave][idx] = valor; pintarLanzador(); };
  $('#lanzador-etapas').replaceChildren(...receta.etapas.map((e, idx) => filaEtapa(e, idx, lanzador, cambiar)));
  const { primera, total, puertas } = cuentaEtapas(receta, lanzador);
  $('#lanzador-resumen').textContent = `Abre ${primera || 0} ${primera === 1 ? 'terminal' : 'terminales'} ahora · ${total} en total · ${puertas} ${puertas === 1 ? 'puerta' : 'puertas'}` + (lanzador.simulacro ? (puertas ? ' · termina en la primera puerta' : ' · sin puertas: el simulacro la corre entera') : '');
  $('#lanzador-lanzar').disabled = !!receta.error || lanzador.lanzando;
}
// Lo que vale para una etapa con los ajustes del lanzador encima (o sin ajustes, como dice la receta).
const SIN_AJUSTES = { agentes: {}, puertas: {}, modelos: {} };
function ajusteEtapa(e, idx, aj) {
  // Una puerta crítica no se apaga: lo que viene después no se deshace (PRD-01).
  if (e.tipo === 'puerta') return { activa: e.critica || aj.puertas[idx] !== false };
  return { n: aj.agentes[idx] || e.agentes, modelo: aj.modelos[idx] || e.modeloConfig || 'auto' };
}
function cuentaEtapas(receta, aj) {
  let primera = null;
  let total = 0;
  let puertas = 0;
  receta.etapas.forEach((e, idx) => {
    const a = ajusteEtapa(e, idx, aj);
    if (e.tipo === 'puerta') {
      if (a.activa) puertas++;
      // En simulacro, una puerta activa antes de toda etapa detiene el flujo sin abrir ninguna terminal (T-B94).
      if (a.activa && aj.simulacro && primera === null) primera = 0;
      return;
    }
    total += a.n;
    if (primera === null) primera = a.n;
  });
  return { primera, total, puertas };
}
// Una fila de etapa o puerta. El lanzador pasa «cambiar» y la fila trae sus controles; la vista previa de una receta
// propuesta (sprint 21) no lo pasa y la fila solo se lee, con el porqué que dio la sesión debajo del detalle.
function filaEtapa(e, idx, aj, cambiar, porque) {
  const a = ajusteEtapa(e, idx, aj);
  const lineaPorque = porque ? h('span', { class: 'etapa-porque' }, porque) : null;
  if (e.tipo === 'puerta') {
    return h('div', { class: 'etapa-fila' + (a.activa ? ' puerta-on' : '') },
      h('div', { class: 'e-cano' }, svg('e-valv', ['M1 1v16l8-8z', 'M17 1v16l-8-8z'])),
      h('div', { class: 'etapa-texto' }, h('span', { class: 'etapa-nombre' }, e.nombre + (e.critica ? ' · crítica' : '')), h('span', { class: 'etapa-detalle' }, e.critica ? 'Crítica: siempre se detiene hasta tu OK' : a.activa ? 'Se detiene hasta tu OK' : 'Sigue sin detenerse'), lineaPorque),
      e.critica || !cambiar
        ? h('span', { class: 'etapa-detalle' }, e.critica ? 'Fija' : '')
        : h('button', { type: 'button', class: 'interruptor', 'aria-pressed': String(a.activa), onclick: () => cambiar('puertas', idx, !a.activa) }, h('span', { class: 'perilla', 'aria-hidden': 'true' }), 'Puerta'));
  }
  const { n, modelo } = a;
  const textoModelo = modelo === 'auto' ? 'modelo: auto' : `${nombreModelo(modelo)}${e.esfuerzoConfig ? ' · ' + e.esfuerzoConfig : ''}`;
  const detalle = [e.skill || null, e.soloLectura ? 'solo lectura' : null].filter(Boolean).join(' · ');
  return h('div', { class: 'etapa-fila' },
    h('div', { class: 'e-cano' }, h('span', { class: 'e-nodo' })),
    h('div', { class: 'etapa-texto' },
      h('span', { class: 'etapa-nombre' }, e.nombre,
        cambiar
          ? h('button', { type: 'button', class: 'chip-modelo ' + modelo, title: 'Auto: lo decide la skill clasificar-complejidad. Clic para cambiar.', onclick: () => cambiar('modelos', idx, SIGUIENTE_MODELO[modelo]) }, textoModelo)
          : h('span', { class: 'chip-modelo solo-ver ' + modelo }, textoModelo)),
      h('span', { class: 'etapa-detalle' }, detalle ? detalle + ' · ' : '', e.traspaso ? h('code', {}, e.traspaso) : 'sin traspaso'),
      lineaPorque),
    e.paralelo && cambiar
      ? h('div', { class: 'contador' },
        h('button', { type: 'button', 'aria-label': 'Un agente menos', onclick: () => cambiar('agentes', idx, Math.max(1, n - 1)) }, '−'),
        h('span', {}, String(n)),
        h('button', { type: 'button', 'aria-label': 'Un agente más', onclick: () => cambiar('agentes', idx, Math.min(6, n + 1)) }, '+'))
      : h('span', { class: 'etapa-detalle' }, e.paralelo && n > 1 ? `${n} agentes` : '1 agente'));
}

// ── Receta propuesta (sprint 21) ────────────────────────
// Una sesión llamó a receta_proponer: el borrador espera en <datos>\propuestas\ y acá se ve, se corrige y se guarda,
// se prueba en simulacro o se descarta (H4). Cerrar lo deja pendiente: vuelve desde el lanzador.

const propuesta = { ficha: null, valida: false, receta: null, porque: new Map(), reloj: null, turno: 0, guardando: false };
const TEXTO_GUARDAR = { '#propuesta-guardar': 'Guardar', '#propuesta-probar': 'Guardar y probar' };

function abrirPropuesta(ficha) {
  propuesta.ficha = ficha;
  // El porqué se ata al nombre de la etapa: si quien usa la app mueve o agrega etapas, cada porqué sigue a la suya.
  propuesta.porque = new Map();
  ((ficha.receta && ficha.receta.etapas) || []).forEach((e, i) => { if (ficha.porque && ficha.porque[i]) propuesta.porque.set(e.nombre, ficha.porque[i]); });
  const ses = ficha.sesion;
  const fecha = ficha.creada ? new Date(ficha.creada).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-') : '';
  const origen = ses ? `Nació de la sesión «${ses.nombre}»` : 'Nació fuera de una sesión de Chocosys';
  $('#propuesta-origen').textContent = [origen, fecha, ficha.resumen || null].filter(Boolean).join(' · ');
  $('#propuesta-id').value = ficha.id || '';
  $('#propuesta-yaml').value = ficha.texto || '';
  soltarConfirmacion();
  // Un borrador pendiente que ya no pasa (editado a mano, o la regla cambió) se abre con su error, para corregirlo.
  pintarPropuesta(ficha.receta ? { ok: true, receta: ficha.receta, existe: ficha.existe } : { ok: false, error: ficha.error || 'La receta no se puede leer.' });
  $('#propuesta-descartar').hidden = !ficha.borrador || !api.descartarPropuesta;
  const m = $('#propuesta');
  m.classList.remove('saliendo');
  m.hidden = false;
  $('#propuesta-yaml').focus();
  $('#propuesta-yaml').setSelectionRange(0, 0);
  $('#propuesta-yaml').scrollTop = 0;
}
function cerrarPropuesta() {
  const m = $('#propuesta');
  if (m.hidden) return;
  clearTimeout(propuesta.reloj);
  m.classList.add('saliendo');
  setTimeout(() => { m.hidden = true; m.classList.remove('saliendo'); }, 150);
}
// 300 ms después de la última tecla se valida con el mismo código que guarda (recetas:validar en main.js).
function revisarPropuesta() {
  clearTimeout(propuesta.reloj);
  soltarConfirmacion();
  propuesta.valida = false;
  $('#propuesta-resumen').textContent = 'Revisando…';
  propuesta.reloj = setTimeout(async () => {
    const turno = ++propuesta.turno;
    let rev;
    try { rev = await api.validarReceta($('#propuesta-id').value, $('#propuesta-yaml').value); } catch (err) { rev = { ok: false, error: 'Chocosys no pudo revisarla: ' + err.message }; }
    // Una respuesta lenta no pisa a una más nueva.
    if (turno === propuesta.turno) pintarPropuesta(rev);
  }, 300);
}
function pintarPropuesta(rev) {
  propuesta.valida = !!rev.ok;
  $('#propuesta-guardar').disabled = !rev.ok || propuesta.guardando;
  $('#propuesta-probar').disabled = !rev.ok || propuesta.guardando;
  const error = $('#propuesta-error');
  const yaml = $('#propuesta-yaml');
  yaml.setAttribute('aria-invalid', String(!rev.ok));
  if (!rev.ok) {
    error.textContent = (rev.linea ? `Línea ${rev.linea}: ` : '') + String(rev.error || 'La receta no se puede leer.');
    error.hidden = false;
    $('#propuesta-vista').classList.add('vieja');
    $('#propuesta-resumen').textContent = 'Corrige el error para poder guardarla. La vista previa muestra la última versión que se pudo leer.';
    return;
  }
  error.hidden = true;
  const receta = rev.receta;
  propuesta.receta = receta;
  $('#propuesta-vista').classList.remove('vieja');
  $('#propuesta-nombre').textContent = receta.nombre;
  $('#propuesta-desc').textContent = receta.descripcion || 'Sin descripción';
  const donde = receta.carpeta ? 'Carpeta fija: ' + receta.carpeta : receta.buscarEn ? 'Pide la carpeta en: ' + receta.buscarEn : 'Pide la carpeta al lanzar';
  $('#propuesta-carpeta').textContent = donde + (receta.entorno ? ' · entorno ' + receta.entorno : '');
  const iguales = (propuesta.ficha.receta && propuesta.ficha.receta.etapas.length) === receta.etapas.length;
  $('#propuesta-etapas').replaceChildren(...receta.etapas.map((e, idx) =>
    filaEtapa(e, idx, SIN_AJUSTES, null, propuesta.porque.get(e.nombre) || (iguales && propuesta.ficha.porque ? propuesta.ficha.porque[idx] : ''))));
  const { total, puertas } = cuentaEtapas(receta, SIN_AJUSTES);
  const etapas = receta.etapas.length - receta.etapas.filter((e) => e.tipo === 'puerta').length;
  $('#propuesta-resumen').textContent = `Se puede guardar · ${etapas} ${etapas === 1 ? 'etapa' : 'etapas'} · ${total} ${total === 1 ? 'agente' : 'agentes'} · ${puertas} ${puertas === 1 ? 'puerta' : 'puertas'}` +
    (rev.existe ? ` · ya hay una receta «${$('#propuesta-id').value.trim()}»: guardarla la reemplaza` : '');
}
// Un cambio en el texto anula un «Confirmar: reemplaza» a medias: lo que se confirmó ya no es lo que se guardaría.
function soltarConfirmacion() {
  for (const [sel, texto] of Object.entries(TEXTO_GUARDAR)) {
    const b = $(sel);
    clearTimeout(b.esperaConfirmar);
    b.classList.remove('peligro');
    b.textContent = texto;
  }
}
// Guardar y «Guardar y probar»: se revisa en el momento (el último cambio pudo no alcanzar a revisarse) y, si el id ya
// es una receta, el primer clic avisa y el segundo reemplaza (la anterior queda en recetas\_archivo\).
async function pedirGuardarPropuesta(sel) {
  if (propuesta.guardando || !propuesta.ficha) return;
  const boton = $(sel);
  const id = $('#propuesta-id').value.trim();
  const opciones = { aviso: `Confirmar: reemplaza «${id}»`, clase: 'peligro', original: () => TEXTO_GUARDAR[sel], alConfirmar: () => guardarPropuesta(sel === '#propuesta-probar') };
  if (boton.classList.contains('peligro')) { confirmarDosVeces(boton, opciones); return; }
  clearTimeout(propuesta.reloj);
  const turno = ++propuesta.turno;
  let rev;
  try { rev = await api.validarReceta(id, $('#propuesta-yaml').value); } catch (err) { rev = { ok: false, error: 'Chocosys no pudo revisarla: ' + err.message }; }
  if (turno !== propuesta.turno) return;
  pintarPropuesta(rev);
  if (!rev.ok) return;
  if (rev.existe) confirmarDosVeces(boton, opciones);
  else guardarPropuesta(sel === '#propuesta-probar');
}
// «DD-MM-AAAA» de la fecha en que la sesión la propuso (la de hoy si el borrador no la trae).
function fechaPropuesta(iso) {
  const d = iso ? new Date(iso) : new Date();
  return [d.getDate(), d.getMonth() + 1].map((n) => String(n).padStart(2, '0')).join('-') + '-' + d.getFullYear();
}
async function guardarPropuesta(probar) {
  const ficha = propuesta.ficha;
  const id = $('#propuesta-id').value.trim();
  const ses = ficha.sesion;
  const extra = { origen: 'sesion', nacio_de: `${ses ? '«' + ses.nombre + '»' : 'fuera de una sesión de Chocosys'} · ${fechaPropuesta(ficha.creada)}`, borrador: ficha.borrador || null };
  propuesta.guardando = true;
  $('#propuesta-guardar').disabled = true;
  $('#propuesta-probar').disabled = true;
  let r;
  try { r = await api.guardarReceta(id, $('#propuesta-yaml').value, extra); } catch (err) { r = { ok: false, error: 'Chocosys no pudo guardarla: ' + err.message }; }
  propuesta.guardando = false;
  soltarConfirmacion();
  if (!r || !r.ok) { pintarPropuesta(r || { ok: false }); return; }
  cerrarPropuesta();
  api.uso('receta-desde-propuesta');
  aviso(`Receta «${id}» guardada` + (r.reemplazo ?': la anterior quedó en recetas\\_archivo' : '') + (r.avisoRegistro ? '. ' + r.avisoRegistro : ''));
  if (probar) {
    // El lanzador la trae elegida y en simulacro: termina en la primera puerta y no se puede aprobar.
    lanzador.receta = id;
    lanzador.simulacro = true;
    await abrirLanzador();
  }
}
// Descartar no borra: el borrador original pasa a propuestas\_archivo\ (lo corregido acá no se guarda).
async function descartarPropuesta() {
  const ficha = propuesta.ficha;
  if (!ficha || !ficha.borrador || propuesta.guardando) return;
  const movido = await api.descartarPropuesta(ficha.borrador);
  cerrarPropuesta();
  aviso(movido ? `Propuesta «${ficha.id}» descartada: el borrador quedó en propuestas\\_archivo` : 'Ese borrador ya no estaba entre las propuestas pendientes');
}
function abrirPendiente(p) {
  cerrarLanzador();
  abrirPropuesta(p);
}

// Una receta con carpeta propia la trae puesta; una sin carpeta la pide (nunca hereda la de la receta anterior).
function elegirReceta(r) {
  lanzador.receta = r.id;
  lanzador.agentes = {};
  lanzador.puertas = {};
  lanzador.modelos = {};
  lanzador.carpeta = r.carpeta || '';
  pintarLanzador();
}
async function elegirCarpetaLanzador() {
  const r = lanzador.recetas.find((x) => x.id === lanzador.receta);
  const ruta = await api.elegirCarpeta(r && (r.buscarEn || r.carpeta));
  if (ruta) { lanzador.carpeta = ruta; pintarLanzador(); }
  return ruta;
}
// Lanzar puede tardar hasta 90 s (la clasificación del modelo): mientras tanto el botón queda tomado,
// así un segundo clic no lanza el mismo flujo dos veces (pasó con un flujo de prueba el 18-10-2026).
async function lanzarFlujo() {
  if (!lanzador.receta || lanzador.lanzando) return;
  if (!lanzador.carpeta && !(await elegirCarpetaLanzador())) return;
  const boton = $('#lanzador-lanzar');
  lanzador.lanzando = true;
  boton.disabled = true;
  boton.textContent = 'Lanzando…';
  try {
    const f = await api.lanzar(lanzador.receta, lanzador.carpeta, { agentes: lanzador.agentes, puertas: lanzador.puertas, modelos: lanzador.modelos, simulacro: lanzador.simulacro });
    if (f) { seguirFlujo = f.id; cerrarLanzador(); }
  } finally {
    lanzador.lanzando = false;
    boton.textContent = 'Lanzar flujo';
    pintarLanzador();
  }
}

// ── Eventos ─────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  const tecla = e.key.toLowerCase();
  const enOrden = document.activeElement === $('#orden');
  const activo = document.activeElement;
  const enCampo = !!activo && (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA') && !activo.classList.contains('xterm-helper-textarea');
  let hecho = false;
  if (e.key === 'Escape' && !$('#propuesta').hidden) { cerrarPropuesta(); hecho = true; }
  // Con la receta propuesta abierta, las teclas son del editor: ningún atajo (Ctrl+Enter aprobaría la puerta de atrás).
  else if (!$('#propuesta').hidden) { /* nada */ }
  else if (e.key === 'Escape' && !$('#lanzador').hidden) { cerrarLanzador(); hecho = true; }
  else if (e.key === 'Escape' && enOrden) { $('#orden').blur(); $('#sugerencias').hidden = true; hecho = true; }
  // Ctrl+Shift+Tab: la pestaña anterior (y otra vez, de vuelta). Va antes de Ctrl+Tab, que la incluiría.
  else if (e.ctrlKey && e.shiftKey && e.key === 'Tab') { pasarAPestana(espacioPrevio); hecho = true; }
  else if (e.ctrlKey && e.key === 'Tab') { siguiente(); hecho = true; }
  // Alt+1 a Alt+9: directo a esa pestaña.
  else if (e.altKey && !e.ctrlKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) { pasarAPestana((espacios[Number(e.code.slice(5)) - 1] || {}).id); hecho = true; }
  else if (e.ctrlKey && e.shiftKey && tecla === 'n') { menuCrear('sesion'); hecho = true; }
  else if (e.ctrlKey && e.shiftKey && tecla === 'l') { abrirLanzador(); hecho = true; }
  // Con Shift, como los demás: Ctrl+K sin Shift borra hasta el final de la línea en Claude Code.
  else if (e.ctrlKey && e.shiftKey && tecla === 'k') { $('#orden').focus(); hecho = true; }
  // Ctrl+Shift+0: el Inicio.
  else if (e.ctrlKey && e.shiftKey && e.code === 'Digit0') { cambiarModo('inicio'); hecho = true; }
  // Vistas: Ctrl+Shift+1 lienzo, 2 bandeja, 3 flujo, 4 CRM (por la tecla física: con Shift, «1» llega como «!»).
  else if (e.ctrlKey && e.shiftKey && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
    cambiarModo(MODOS[Number(e.code.slice(-1)) - 1]);
    hecho = true;
  }
  // Ctrl+Shift+← y →: la pestaña anterior o la siguiente.
  else if (e.ctrlKey && e.shiftKey && (tecla === 'arrowleft' || tecla === 'arrowright')) { pasarEspacio(tecla === 'arrowleft' ? -1 : 1); hecho = true; }
  // Ctrl+Shift+M: maximiza o achica la ventana elegida.
  else if (e.ctrlKey && e.shiftKey && tecla === 'm' && sel && !esPuerta(sel) && sesion(sel)) { alternarMax(sel); hecho = true; }
  // Esc cierra la tarjeta de la puerta (sin aprobar nada), salvo que estés escribiendo los cambios.
  else if (e.key === 'Escape' && !$('#puerta').hidden && !pidiendoCambios) { restaurarAprobar(); sel = null; pintar(); hecho = true; }
  // En la puerta de elegir: H, D o N decide la fila activa; las flechas se mueven. No con el foco en un campo
  // (la barra de comando, renombrar una sesión o un espacio, el título).
  else if (!e.ctrlKey && !e.altKey && !e.metaKey && eligiendo() && !pidiendoCambios && !enCampo && ['h', 'd', 'n', 'arrowup', 'arrowdown'].includes(tecla)) {
    if (tecla === 'arrowup' || tecla === 'arrowdown') moverActivo(tecla === 'arrowup' ? -1 : 1);
    else decidir({ h: 'hoy', d: 'despues', n: 'no' }[tecla]);
    hecho = true;
  }
  else if (e.ctrlKey && e.key === 'Enter' && !$('#puerta').hidden && !pidiendoCambios) {
    const f = flujo(sel.slice(2));
    const puerta = f && f.items[f.actual];
    if (f && puerta && !puerta.critica) { aprobar(f.id, 'teclado'); hecho = true; }
  }
  if (hecho) {
    e.preventDefault();
    e.stopPropagation();
    // Qué usas: los atajos cuentan aparte de los clics (Esc no, que cierra cualquier cosa).
    if (e.key !== 'Escape') api.uso('atajo:' + [e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.code.replace(/^(Key|Digit)/, '')].filter(Boolean).join('+'));
  }
}, true);

$('#orden').addEventListener('input', () => { sugerenciaSel = 0; pintarSugerencias(); });
$('#orden').addEventListener('keydown', (e) => {
  const ul = $('#sugerencias');
  const lista = candidatos($('#orden').value);
  if (!ul.hidden && lista.length) {
    if (e.key === 'ArrowDown') { sugerenciaSel = (sugerenciaSel + 1) % lista.length; pintarSugerencias(); e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { sugerenciaSel = (sugerenciaSel - 1 + lista.length) % lista.length; pintarSugerencias(); e.preventDefault(); return; }
    if (e.key === 'Tab' || e.key === 'Enter') { completar(lista[sugerenciaSel]); e.preventDefault(); return; }
  }
  if (e.key === 'Enter') { e.preventDefault(); enviarOrden(); }
});
$('#orden').addEventListener('blur', () => setTimeout(() => { $('#sugerencias').hidden = true; }, 120));

// Pan y zoom del lienzo
const fondoLienzo = $('#vista-lienzo');
// Se explora arrastrando desde cualquier parte que no sea una ventana ni un control: el fondo, el
// título del espacio o el interior de un marco. Usa el mismo arrastre que las ventanas, así no
// selecciona el texto por el que pasa.
fondoLienzo.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.ventana, button, input, textarea, .marco-cabeza, .titulo-editar, .zoom')) return;
  e.preventDefault();
  const v = vista();
  const inicio = { x: v.x, y: v.y };
  arrastrar(e, {
    cursor: 'grabbing',
    alMover: (dx, dy) => { fondoLienzo.classList.add('paneando'); v.x = inicio.x + dx; v.y = inicio.y + dy; aplicarVista(false); },
    alSoltar: () => fondoLienzo.classList.remove('paneando')
  });
});
fondoLienzo.addEventListener('wheel', (e) => {
  const enTerminal = e.target.closest && e.target.closest('.v-cuerpo');
  if (e.ctrlKey) { e.preventDefault(); zoomEn(vista().zoom * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX, e.clientY, false); return; }
  if (enTerminal && vista().zoom >= 0.97) return;
  e.preventDefault();
  const v = vista();
  v.x -= e.deltaX;
  v.y -= e.deltaY;
  aplicarVista(false);
}, { passive: false });
$('#titulo-espacio').addEventListener('dblclick', renombrarTitulo);

$('#zoom-mas').addEventListener('click', () => zoomEn(vista().zoom + 0.1, undefined, undefined, true));
$('#zoom-menos').addEventListener('click', () => zoomEn(vista().zoom - 0.1, undefined, undefined, true));
$('#zoom-ajustar').addEventListener('click', ajustarTodo);
$('#espacio-nuevo').addEventListener('click', (ev) => menuCrear('pestana', ev.currentTarget));
$('#necesitan').addEventListener('click', siguiente);
$('#herr-sesion').addEventListener('click', (ev) => menuCrear('sesion', ev.currentTarget));
$('#herr-flujo').addEventListener('click', abrirLanzador);
for (const m of MODOS) $('#modo-' + m).addEventListener('click', () => cambiarModo(m));
$('#chip-sesion').addEventListener('click', (ev) => menuCrear('sesion', ev.currentTarget));
$('#chip-flujo').addEventListener('click', abrirLanzador);
$('#chip-siguiente').addEventListener('click', siguiente);
$('#chip-ordenar').addEventListener('click', ordenarLienzo);
$('#chip-quitar-terminados').addEventListener('click', (e) => quitarTerminados(e.currentTarget));
$('#ir-inicio').addEventListener('click', () => cambiarModo('inicio'));
$('#chip-juntar').addEventListener('click', () => { const c = $('#orden'); c.value = 'junta @'; c.focus(); sugerenciaSel = 0; pintarSugerencias(); });
$('#tema').addEventListener('click', () => aplicarTema(TEMAS[temaActual()].sig));
alPrimerClic('#segunda-opinion', ['crm', 'opinion'], () => abrirOpinion());
alPrimerClic('#tutorial', ['crm', 'tutorial'], () => abrirTutorial());
$('#pista-txt').addEventListener('click', () => pintarPista(1));
$('#pista-cerrar').addEventListener('click', () => { try { localStorage.setItem('chocosys-pistas', 'no'); } catch (e) { /* nada */ } pistasApagadas = true; verPista(); });
$('#vacio-sesion').addEventListener('click', (ev) => menuCrear('sesion', ev.currentTarget));
$('#vacio-flujo').addEventListener('click', abrirLanzador);
$('#puerta-aprobar').addEventListener('click', () => { const f = flujo(sel.slice(2)); if (!f) return; cerrarCambios(); aprobar(f.id, confirmacionVale(f.id) ? 'confirmación' : 'botón'); });
$('#puerta-pedir').addEventListener('click', pedirCambios);
$('#puerta-carpeta').addEventListener('click', () => { const f = flujo(sel.slice(2)); if (f) api.abrirCarpeta(f.carpeta); });
$('#puerta-volver').addEventListener('click', () => { cerrarCambios(); restaurarAprobar(); sel = null; pintar(); });
$('#lanzador-fondo').addEventListener('click', cerrarLanzador);
$('#lanzador-cancelar').addEventListener('click', cerrarLanzador);
$('#lanzador-elegir').addEventListener('click', elegirCarpetaLanzador);
$('#lanzador-lanzar').addEventListener('click', lanzarFlujo);
$('#lanzador-simulacro').addEventListener('click', () => { lanzador.simulacro = !lanzador.simulacro; pintarLanzador(); });
$('#propuesta-fondo').addEventListener('click', cerrarPropuesta);
$('#propuesta-cerrar').addEventListener('click', cerrarPropuesta);
$('#propuesta-yaml').addEventListener('input', revisarPropuesta);
$('#propuesta-id').addEventListener('input', revisarPropuesta);
$('#propuesta-guardar').addEventListener('click', () => pedirGuardarPropuesta('#propuesta-guardar'));
$('#propuesta-probar').addEventListener('click', () => pedirGuardarPropuesta('#propuesta-probar'));
$('#propuesta-descartar').addEventListener('click', descartarPropuesta);
// Con un preload anterior al sprint 21 no hay aviso: la propuesta igual queda en propuestas\.
if (api.alPropuesta) api.alPropuesta(abrirPropuesta);

// Al agrandar la ventana de Chocosys, la terminal maximizada se ajusta cuando el tamaño se queda quieto.
let esperaMax = null;
new ResizeObserver(() => { clearTimeout(esperaMax); esperaMax = setTimeout(() => { if (maxima) ajustar(maxima); }, 150); }).observe($('#escenario'));
function tiemposAlDia() { for (const s of sesiones) { const el = filas.get(s.id); if (el) el.querySelector('.fila-tiempo').textContent = hace(s.cambio); } pintarFlujo(); }
setInterval(() => { if (document.visibilityState === 'visible') tiemposAlDia(); }, 30000);
// P1 y P7 (04-11-2026): con la ventana oculta, minimizada o tapada, ninguna animación corre (clase «quieta» en <html>) y
// los relojes de la ventana no hacen nada; al volver a verse, los tiempos se ponen al día de inmediato.
function alCambiarVista() {
  const oculta = document.visibilityState !== 'visible';
  document.documentElement.classList.toggle('quieta', oculta);
  if (!oculta) tiemposAlDia();
}
document.addEventListener('visibilitychange', alCambiarVista);
document.documentElement.classList.toggle('quieta', document.visibilityState !== 'visible');

function recibir(datos) {
  if (datos.plan) plan = datos.plan;
  sesiones = datos.sesiones || [];
  flujos = datos.flujos || [];
  espacios = datos.espacios || [];
  // Una sesión de flujo se ve en la pestaña de su marco, aunque main la haya anotado en otra (estado de antes del 22-10-2026).
  for (const s of sesiones) { const f = s.flujo && flujo(s.flujo); if (f && f.espacio) s.espacio = f.espacio; }
  if (!actual || !espacio(actual)) actual = datos.espacioActual || (espacios[0] || {}).id;
  if (esPuerta(sel) && !flujo(sel.slice(2))) sel = null;
}
// Con el primer dato el PTY ya existe: main descarta un tamaño que llega antes de que el PTY se abra, así que se vuelve a enviar.
api.alDatos((id, datos) => {
  const t = terminal(id);
  t.term.write(datos);
  if (!t.conDatos) { t.conDatos = true; requestAnimationFrame(() => ajustar(id)); }
});
api.alCambiar((datos) => { recibir(datos); pintar(); seguir(); });
api.alSeleccionar((id) => seleccionar(id));
// Lo que llega del MCP de Chocosys.
api.alModo(cambiarModo);
api.alEspacio((id) => cambiarEspacio(id));
// Avisos de main (03-11-2026: el tope de la central). Con un preload anterior no existe.
if (api.alAviso) api.alAviso(aviso);
function estiloPersonal(css) {
  let el = document.getElementById('estilo-personal');
  if (!el) { el = document.createElement('style'); el.id = 'estilo-personal'; document.head.appendChild(el); }
  el.textContent = css || '';
  el.disabled = !$('#puerta').hidden;
}
api.alPersonal(estiloPersonal);
api.personal().then(estiloPersonal).catch(() => {});

// Fuentes propias (fuentes\fuentes.json en la carpeta de datos, ver docs/fuentes.md). La que no está deja la de siempre.
const lienzoMedir = document.createElement('canvas').getContext('2d');
function anchoTexto(familia, texto) { lienzoMedir.font = `16px ${familia}`; return lienzoMedir.measureText(texto).width; }
// Con dos respaldos distintos el texto mide igual solo si la fuente existe.
async function hayFuente(n) {
  await Promise.all(['16px', 'bold 16px'].map((p) => document.fonts.load(`${p} "${n}"`).catch(() => {})));
  return Math.abs(anchoTexto(`"${n}", monospace`, 'Mmi') - anchoTexto(`"${n}", serif`, 'Mmi')) < 0.5;
}
const esMono = (n) => Math.abs(anchoTexto(`"${n}", monospace`, 'iiiiiiiiii') - anchoTexto(`"${n}", monospace`, 'MMMMMMMMMM')) < 0.5;
async function aplicarFuentes() {
  const f = await api.fuentes().catch(() => ({}));
  const avisos = f.avisos || [];
  const raiz = getComputedStyle(document.documentElement);
  const variables = [];
  for (const rol of ['titulos', 'interfaz', 'terminal'].filter((r) => f[r])) {
    const n = f[rol].nombre;
    // FontFace y no @font-face: al reescribir una hoja se descargan sus fuentes y la terminal volvía a medir con la de respaldo.
    for (const c of f[rol].caras) document.fonts.add(new FontFace(n, `url("${c.url}")`, { weight: c.peso, style: c.cursiva ? 'italic' : 'normal' }));
    if (!(await hayFuente(n))) { avisos.push(`No encontré la fuente «${n}» (${rol}) ni en la carpeta fuentes ni instalada: sigue la de siempre.`); continue; }
    if (rol === 'terminal') {
      if (esMono(n)) monoTerminal = `"${n}", ${MONO_BASE}`;
      else avisos.push(`«${n}» no es monoespaciada: la terminal sigue con su fuente de siempre.`);
      continue;
    }
    const v = rol === 'titulos' ? '--f-mano' : '--f-ui';
    variables.push(`${v}: "${n}", ${raiz.getPropertyValue(v).trim()};`);
    if (rol === 'titulos') document.documentElement.classList.add('titulos-propios');
  }
  if (variables.length) {
    const el = document.createElement('style');
    el.id = 'estilo-fuentes';
    el.textContent = `:root { ${variables.join(' ')} }`;
    // Antes del CSS personal: si los dos cambian una fuente, manda el personal.
    document.head.insertBefore(el, document.getElementById('estilo-personal'));
  }
  if (monoTerminal !== MONO_BASE) for (const [id, t] of terminales) { t.term.options.fontFamily = monoTerminal; ajustar(id); }
  if (avisos.length) { console.warn(avisos.join('\n')); aviso(avisos.join(' ')); }
}
aplicarFuentes();

(async function iniciar() {
  try {
    await Promise.all([
      document.fonts.load('14px "Cascadia Code Variable"'),
      document.fonts.load('600 44px "Caveat Variable"'),
      document.fonts.load('italic 20px "Instrument Serif"'),
      document.fonts.load('14px "Instrument Sans Variable"')
    ]);
  } catch (e) { /* sigue con la fuente de respaldo */ }
  const datos = await api.lista();
  // crm.js e inicio.js cargan después de este archivo: el primer repintado espera a que estén todos.
  if (document.readyState === 'loading') await new Promise((listo) => document.addEventListener('DOMContentLoaded', listo, { once: true }));
  recibir(datos);
  aplicarVista(false);
  pintarPista(1);
  pintar();
  const primera = ronda(true)[0];
  if (primera) seleccionar(primera, true);
})();

// ── Recursos del PC (PRD-05) ──
// La pastilla pide los totales cada 2 s (no lanzan nada); el panel pide el detalle por proceso cada 3 s solo mientras
// está abierto. Con la ventana oculta, la pastilla no pregunta: el proceso principal sigue midiendo para poder avisar.
let recursosTot = null, recursosDet = null, relojRecDet = null;
const num = (x, d = 0) => Number(x).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
const pctCpu = (nucleos) => Math.round((100 * nucleos) / ((recursosTot && recursosTot.nucleos) || 1));
const gb = (mb) => (mb >= 1024 ? num(mb / 1024, 1) + ' GB' : num(mb) + ' MB');

// Un proceso principal anterior a la GPU por adaptador manda t.gpu como un solo objeto {pct, vramGB}: se lleva a la lista.
const conGpuLista = (t) => { if (t && t.gpu && !Array.isArray(t.gpu)) t.gpu = [{ nombre: 'GPU', pct: t.gpu.pct, memGB: t.gpu.vramGB, tipo: 'dedicada' }]; return t; };
function pintarRecursos() {
  const t = recursosTot;
  if (!t) return;
  const b = $('#recursos');
  $('#recursos-txt').textContent = `CPU ${t.cpu == null ? '…' : t.cpu + ' %'} · RAM ${t.ram} %` + (t.gpu ? ` · GPU ${gpuTop(t).pct} %` + (t.gpu.length > 1 ? ' ' + gpuCorta(gpuTop(t).nombre) : '') : '');
  b.classList.toggle('alto', !!t.alerta && t.alerta.nivel === 'alto');
  b.classList.toggle('alarma', !!t.alerta && t.alerta.nivel === 'critico');
  pintarPanelRecursos();
}
async function leerRecursos() {
  if (document.visibilityState !== 'visible') return;
  try { recursosTot = conGpuLista(await api.recursos.leer()); } catch (e) { return; }
  pintarRecursos();
}
// Una ventana nueva sobre un proceso principal viejo (recargada antes de reiniciar) no tiene recursos: la pastilla no sale.
$('#recursos').hidden = !api.recursos;
if (api.recursos) { setInterval(leerRecursos, 2000); leerRecursos(); }

// GPU: una línea por adaptador (equipos con dos, como NVIDIA más Intel). Con una sola se ve como siempre: «GPU z %».
const COLOR_GPU = ['#3f8f9b', '#8c6bb8', '#b8962e'];
const gpuCorta = (n) => n.replace(/\((R|TM)\)/gi, '').replace(/^(NVIDIA|AMD|Intel)\s+(GeForce\s+|Radeon\s+)?/i, '').replace(/\s+(Laptop GPU|Graphics|GPU)$/i, '').replace(/\s+/g, ' ').trim() || n;
const gpuTop = (t) => t.gpu.reduce((a, g) => (g.pct > a.pct ? g : a));
const gpuMem = (g) => `${num(g.memGB, 1)} GB ${g.tipo === 'dedicada' ? 'de VRAM' : 'de memoria compartida'}`;

// La línea de los últimos 5 min: CPU en brasa, RAM en tinta, una por GPU, y el umbral de CPU punteado (90 % de fábrica).
function graficoRecursos(hist, histGpu, gpus, umbralCpu) {
  const el = document.createElementNS(SVG, 'svg');
  el.setAttribute('viewBox', '0 0 300 64');
  el.setAttribute('preserveAspectRatio', 'none');
  el.setAttribute('role', 'img');
  const ultimo = hist.length ? hist[hist.length - 1] : null;
  el.setAttribute('aria-label', ultimo ? `Últimos 5 minutos: CPU ahora ${ultimo[1]} %, RAM ${ultimo[2]} %` + (gpus && gpus.length ? ', ' + gpus.map((g) => `${gpus.length > 1 ? gpuCorta(g.nombre) : 'GPU'} ${g.pct} %`).join(', ') : '') : 'Sin muestras todavía');
  const fin = Date.now(), ini = fin - 5 * 60 * 1000;
  const x = (t) => (300 * (t - ini)) / (fin - ini), y = (v) => 62 - (60 * v) / 100;
  const linea = (col, clase) => { const l = document.createElementNS(SVG, 'polyline'); l.setAttribute('class', clase); l.setAttribute('points', hist.filter((m) => m[col] != null).map((m) => x(m[0]).toFixed(1) + ',' + y(m[col]).toFixed(1)).join(' ')); return l; };
  const u = document.createElementNS(SVG, 'line');
  Object.entries({ class: 'umbral', x1: 0, x2: 300, y1: y(umbralCpu || 90), y2: y(umbralCpu || 90) }).forEach(([k, v]) => u.setAttribute(k, v));
  const lineasGpu = (gpus || []).map((g, i) => {
    const l = document.createElementNS(SVG, 'polyline');
    l.setAttribute('class', 'gpu');
    l.setAttribute('stroke', COLOR_GPU[i % COLOR_GPU.length]);
    l.setAttribute('points', (histGpu || []).filter((m) => m[1] && m[1][g.nombre] != null).map((m) => x(m[0]).toFixed(1) + ',' + y(m[1][g.nombre]).toFixed(1)).join(' '));
    return l;
  });
  el.append(u, ...lineasGpu, linea(2, 'ram'), linea(1, 'cpu'));
  return el;
}

const ETIQUETA_GRUPO = { chocosys: 'la ventana y el dueño de las terminales' };
function filaGrupo(g) {
  const cuantos = new Map();
  for (const p of g.procesos) cuantos.set(p.nombre, (cuantos.get(p.nombre) || 0) + 1);
  const detalle = [...cuantos].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ') + (g.n > g.procesos.length ? ` y ${g.n - g.procesos.length} más` : '');
  const donde = g.tipo === 'sesion' ? [g.espacio, (ETIQUETA[g.estado] || g.estado || '').toLowerCase(), g.cambio ? 'hace ' + duracion(Date.now() - g.cambio) : ''].filter(Boolean).join(' · ')
    : g.tipo === 'cerrada' ? (g.viva ? 'quedó fuera de su terminal' : 'de una sesión que ya no tiene terminal') : ETIQUETA_GRUPO[g.tipo];
  const hijos = [
    h('span', { class: 'pop-nom' }, g.nombre),
    h('span', { class: 'rec-num' }, `CPU ${pctCpu(g.nucleos)} % · ${gb(g.mb)}`),
    h('span', { class: 'pop-donde' }, [donde, detalle].filter(Boolean).join(' · '))];
  return g.tipo === 'sesion'
    ? h('button', { type: 'button', class: 'pop-fila rec-fila', 'data-k': 'fila:' + g.sesion, title: 'Ir a esta sesión', onclick: () => { cerrarRecursos(); irASesion(g.sesion); } }, hijos)
    : h('div', { class: 'pop-fila rec-fila' }, hijos);
}

function pintarPanelRecursos() {
  const caja = $('#pop-recursos');
  if (caja.hidden || !recursosTot) return;
  const t = recursosTot, d = recursosDet;
  const a = t.alerta;
  const deSesiones = d ? d.grupos.filter((g) => g.tipo === 'sesion') : [];
  // Se repinta cada 3 s: el foco vuelve al mismo botón para que el teclado no se pierda.
  const foco = caja.contains(document.activeElement) && document.activeElement.dataset.k;
  const scroll = caja.scrollTop; // replaceChildren lo manda al inicio en cada repintado
  caja.replaceChildren(
    h('div', { class: 'pop-t' }, h('b', {}, 'Recursos del PC'), h('span', {}, d ? 'al día cada 3 s' : 'leyendo los procesos…')),
    h('div', { class: 'rec-total' }, h('span', {}, 'CPU ', h('b', {}, t.cpu == null ? '…' : t.cpu + ' %')), h('span', {}, 'RAM ', h('b', {}, t.ram + ' %'), ` · ${num(t.ramUsadaGB, 1)} de ${num(t.ramTotalGB, 1)} GB`),
      h('span', {}, 'GPU ', t.gpu === undefined ? '…' : t.gpu === null ? h('b', {}, 'no disponible') : h('b', {}, gpuTop(t).pct + ' %'), t.gpu && t.gpu.length === 1 ? ` · ${gpuMem(t.gpu[0])}` : '')),
    t.gpu && t.gpu.length > 1 ? h('div', { class: 'rec-gpus' }, t.gpu.map((g, i) => h('span', {}, h('i', { style: `background: ${COLOR_GPU[i % COLOR_GPU.length]}` }), h('b', {}, gpuCorta(g.nombre)), ` ${g.pct} % · ${gpuMem(g)}`))) : null,
    a ? h('div', { class: 'rec-alerta' + (a.nivel === 'critico' ? ' critico' : '') }, a.tipo === 'ram' ? `RAM sobre ${t.umbral.ram} % hace más de ${t.umbral.ramSeg} s.` : `CPU sobre ${t.umbral.cpu} % hace más de ${t.umbral.cpuSeg} s.`, a.culpable ? ' Lo que más usa: ' + a.culpable + '.' : '') : null,
    h('div', { class: 'rec-graf' }, graficoRecursos(t.historia, t.historiaGpu, t.gpu, t.umbral && t.umbral.cpu),
      h('div', { class: 'rec-leyenda' }, h('span', {}, h('i', { style: 'background: var(--brasa)' }), 'CPU'), h('span', {}, h('i', { style: 'background: var(--tinta-2)' }), 'RAM'), ...(t.gpu || []).map((g, i) => h('span', {}, h('i', { style: `background: ${COLOR_GPU[i % COLOR_GPU.length]}` }), t.gpu.length > 1 ? gpuCorta(g.nombre) : 'GPU')), h('span', {}, `últimos 5 min · punteado: ${(t.umbral && t.umbral.cpu) || 90} %`))),
    d ? h('div', { class: 'pop-donde' }, `${d.sesiones.vivas} ${d.sesiones.vivas === 1 ? 'sesión viva' : 'sesiones vivas'}, ${d.sesiones.trabajando} trabajando` + (deSesiones.length ? ` · las sesiones usan CPU ${pctCpu(deSesiones.reduce((x, g) => x + g.nucleos, 0))} % y ${gb(deSesiones.reduce((x, g) => x + g.mb, 0))}` : '')) : null,
    d ? h('p', { class: 'rec-sub' }, 'Lo que más consume') : null,
    d ? h('div', { class: 'pop-lista' }, d.grupos.filter((g, i) => i < 8 || g.tipo === 'sesion' || g.tipo === 'cerrada').map(filaGrupo)) : null,
    h('p', { class: 'rec-pie' }, (d && d.costo ? `El monitor gastó ${num(d.costo.ps + d.costo.principal, 2)} % de la CPU en el último ${d.costo.segundos >= 60 ? 'minuto' : d.costo.segundos + ' s'}. ` : '') +
      `Alertas: RAM sobre ${t.umbral.ram} % por ${t.umbral.ramSeg} s, CPU sobre ${t.umbral.cpu} % por ${t.umbral.cpuSeg} s.`));
  caja.scrollTop = scroll;
  if (foco) { const el = caja.querySelector(`[data-k="${CSS.escape(foco)}"]`); if (el) el.focus({ preventScroll: true }); }
}
async function detalleRecursosAhora() {
  try { recursosDet = await api.recursos.detalle(); recursosTot = conGpuLista(recursosDet.totales); } catch (e) { return; }
  pintarRecursos();
}
function cerrarRecursos() {
  $('#pop-recursos').hidden = true;
  $('#recursos').setAttribute('aria-expanded', 'false');
  clearInterval(relojRecDet);
  relojRecDet = null;
}
$('#recursos').addEventListener('click', (ev) => {
  ev.stopPropagation();
  const caja = $('#pop-recursos');
  if (!caja.hidden) { cerrarRecursos(); return; }
  caja.hidden = false;
  $('#recursos').setAttribute('aria-expanded', 'true');
  const r = $('#recursos').getBoundingClientRect();
  Object.assign(caja.style, { top: r.bottom + 8 + 'px', left: Math.max(12, Math.min(r.left, innerWidth - 472)) + 'px' });
  pintarPanelRecursos();
  detalleRecursosAhora();
  relojRecDet = setInterval(() => { if (document.visibilityState === 'visible') detalleRecursosAhora(); }, 3000);
});
// Un clic que repinta el panel saca su botón del documento: se mira el camino del evento, no closest().
document.addEventListener('click', (ev) => { if (!$('#pop-recursos').hidden && !ev.composedPath().includes($('#pop-recursos'))) cerrarRecursos(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#pop-recursos').hidden) { cerrarRecursos(); $('#recursos').focus(); } });
