// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// El plan de Claude con que se usa Chocosys (15-11-2026). Cada sesión gasta del mismo límite de uso: en Pro, cuatro sesiones
// Opus a la vez agotan la ventana de horas en minutos. El plan fija lo que Chocosys abre por su cuenta; quien usa la app lo
// elige al primer inicio y lo cambia en ☰ › Mi plan (perfil.json, «plan»). Lo que se limita, y dónde lo aplica main.js:
//   sesiones      cuántas trabajan a la vez (abrir una más desde la ventana pregunta; el MCP no puede). 0 = sin tope.
//   modelo        el de una sesión que no pide otro ('' = el que tenga Claude Code).
//   esfuerzo      lo mismo para el esfuerzo.
//   modelo_max    ninguna sesión corre sobre este (un flujo que pide Opus en Pro corre en Sonnet).
//   esfuerzo_max  ídem para el esfuerzo.
//   agentes       agentes en paralelo por etapa de un flujo (la receta puede pedir más; se recorta).
//   programadas   tareas programadas guardadas a la vez. 0 = sin tope.
//   sala          la «Segunda opinión» (sala directiva): abre 5 o 6 sesiones y gasta varios millones de tokens.

const MODELOS = ['haiku', 'sonnet', 'opus'];
const ESFUERZOS = ['low', 'medium', 'high', 'xhigh', 'max'];

const PLANES = {
  pro: { nombre: 'Pro', sesiones: 2, modelo: 'sonnet', esfuerzo: 'medium', modelo_max: 'sonnet', esfuerzo_max: 'high', agentes: 2, programadas: 2, sala: false },
  max5: { nombre: 'Max 5x', sesiones: 4, modelo: 'opus', esfuerzo: 'high', modelo_max: 'opus', esfuerzo_max: 'xhigh', agentes: 4, programadas: 6, sala: true },
  max20: { nombre: 'Max 20x', sesiones: 8, modelo: 'opus', esfuerzo: 'xhigh', modelo_max: 'opus', esfuerzo_max: 'max', agentes: 6, programadas: 12, sala: true },
  api: { nombre: 'API', sesiones: 3, modelo: 'sonnet', esfuerzo: 'medium', modelo_max: 'opus', esfuerzo_max: 'high', agentes: 3, programadas: 3, sala: false },
  // Sin plan elegido: como era Chocosys antes de esto (las instalaciones que se actualizan no cambian hasta que elijan).
  libre: { nombre: 'Sin límites', sesiones: 0, modelo: '', esfuerzo: '', modelo_max: 'opus', esfuerzo_max: 'max', agentes: 6, programadas: 0, sala: true }
};

const entero = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const VALIDA = {
  sesiones: (v) => entero(v, 0, 12),
  modelo: (v) => v === '' || MODELOS.includes(v),
  esfuerzo: (v) => v === '' || ESFUERZOS.includes(v),
  modelo_max: (v) => MODELOS.includes(v),
  esfuerzo_max: (v) => ESFUERZOS.includes(v),
  agentes: (v) => entero(v, 1, 6),
  programadas: (v) => entero(v, 0, 50),
  sala: (v) => typeof v === 'boolean'
};

// El plan vigente: los valores de fábrica de su tipo, con encima los que quien usa la app cambió y son válidos.
function actual(guardado) {
  const g = guardado && typeof guardado === 'object' ? guardado : {};
  const tipo = PLANES[g.tipo] ? g.tipo : 'libre';
  const p = Object.assign({ tipo }, PLANES[tipo]);
  for (const k of Object.keys(VALIDA)) if (g[k] !== undefined && VALIDA[k](g[k])) p[k] = g[k];
  return p;
}

// Lo que se guarda: solo el tipo y lo que difiere de su fábrica (así un cambio de fábrica en otra versión le llega).
function paraGuardar(d) {
  const tipo = PLANES[d && d.tipo] ? d.tipo : 'libre';
  const r = { tipo };
  for (const k of Object.keys(VALIDA)) if (d[k] !== undefined && VALIDA[k](d[k]) && d[k] !== PLANES[tipo][k]) r[k] = d[k];
  return r;
}

// Modelo y esfuerzo con que parte una sesión: los suyos o los del plan, nunca sobre el máximo del plan.
function ajustar(modelo, esfuerzo, plan) {
  let m = modelo || plan.modelo || '';
  let e = esfuerzo || plan.esfuerzo || '';
  let bajado = false;
  if (m && MODELOS.indexOf(m) > MODELOS.indexOf(plan.modelo_max)) { m = plan.modelo_max; bajado = true; }
  if (e && ESFUERZOS.indexOf(e) > ESFUERZOS.indexOf(plan.esfuerzo_max)) { e = plan.esfuerzo_max; bajado = true; }
  return { modelo: m, esfuerzo: e, bajado };
}

module.exports = { PLANES, MODELOS, ESFUERZOS, actual, paraGuardar, ajustar };
