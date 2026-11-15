// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Motor de flujos: abre las etapas de una receta en orden, espera a que todas sus sesiones
// terminen y dejen su archivo de traspaso, y se detiene en cada puerta hasta tu OK.
// No decide nada por su cuenta: si falta un traspaso, espera y lo muestra.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const acciones = require('./acciones');

// Dos lugares (sprint 18): las recetas de ejemplo vienen con el programa; las de quien lo usa viven en sus datos y
// mandan si se llaman igual. main.js fija la segunda carpeta y las variables con configurar().
const CARPETA_EJEMPLOS = path.join(__dirname, 'flujos');
let carpetaPropias = CARPETA_EJEMPLOS;
let variables = { nombre: 'quien usa Chocosys' };
// Sprint 23 (H2): las acciones estándar (las del programa y las de los datos). main.js dice cómo leerlas.
let listaAcciones = () => [];
// Agentes en paralelo por etapa que permite el plan (plan.js): la receta puede pedir más y se recorta al lanzar.
let topeAgentes = () => MAX_AGENTES;
function configurar(o) {
  if (typeof o.topeAgentes === 'function') topeAgentes = o.topeAgentes;
  if (o.recetas) carpetaPropias = o.recetas;
  if (o.variables) variables = Object.assign({}, variables, o.variables);
  if (typeof o.acciones === 'function') listaAcciones = o.acciones;
}
const carpetaRecetas = () => carpetaPropias;
// {nombre}, {salas} y {skill_sala} en una receta: así no lleva el nombre ni las rutas de nadie.
const conVariables = (texto) => texto.replace(/\{(nombre|salas|skill_sala)\}/g, (m, k) => (variables[k] != null ? String(variables[k]) : m));
const ESFUERZOS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Ante la duda: Haiku en medium, Opus en xhigh (skill clasificar-complejidad, paso 3).
const ESFUERZO_POR_DEFECTO = { haiku: 'medium', opus: 'xhigh' };
const MODELOS_RECETA = ['auto', 'haiku', 'opus'];
const MAX_AGENTES = 6;
const entreAgentes = (n) => Math.max(1, Math.min(MAX_AGENTES, topeAgentes(), Number(n) || 1));

// Cómo nació una receta (sprint 21, base del 24): a mano, desde una sesión («Hacer flujo») o por entrevista.
const ORIGENES = ['mano', 'sesion', 'entrevista'];
const origenDe = (v) => (ORIGENES.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'mano');

// Sprint 27, H3: un tope de palabras es un entero de 50 a 5.000; otro valor es «sin tope» (revisarReceta lo rechaza
// antes de guardar). Las palabras se cuentan como en la medida (D6): letras o números seguidos, sin «|» ni Markdown.
const TOPE_MIN = 50;
const TOPE_MAX = 5000;
const topeDe = (v) => (Number.isInteger(Number(v)) && Number(v) >= TOPE_MIN && Number(v) <= TOPE_MAX ? Number(v) : 0);
const contarPalabras = (texto) => (String(texto || '').match(/[\p{L}\p{N}]+/gu) || []).length;

// Sprint 23 (H2, D5): una etapa «accion: <id>» guarda la acción y sus parámetros; la instrucción se arma al lanzar
// (armarAcciones). Lo que la receta no pone (nombre, modelo, esfuerzo, traspaso) lo trae la acción. Una acción que no
// existe no rompe la lectura: la etapa queda con «accion» y sin instrucción, y validarReceta o lanzar dicen por qué.
function conAccion(e, it, cache) {
  if (!e || e.accion === undefined || e.accion === null) return it;
  it.accion = String(e.accion);
  it.parametros = e.parametros && typeof e.parametros === 'object' && !Array.isArray(e.parametros) ? Object.assign({}, e.parametros) : {};
  if (!cache.lista) { try { cache.lista = listaAcciones() || []; } catch (err) { cache.lista = []; } }
  const a = cache.lista.find((x) => x.id === it.accion && !x.error);
  if (!a) return it;
  it.sale = !!a.sale;
  if (!e.nombre) it.nombre = a.nombre;
  if (!e.traspaso && a.traspaso) it.traspaso = a.traspaso;
  if (e.modelo === undefined && a.modelo) it.modeloConfig = a.modelo;
  if (!it.esfuerzoConfig && a.esfuerzo) it.esfuerzoConfig = a.esfuerzo;
  return it;
}

// De un YAML ya leído a lo que usan el lanzador y el motor. La usan leerRecetas y la vista previa del editor de
// propuestas (interpretarReceta), para que las dos pinten exactamente lo mismo.
function armarReceta(id, r) {
  if (!r || !Array.isArray(r.etapas)) throw new Error('le falta la lista «etapas»');
  const cache = {};
  return {
    nombre: String(r.nombre || id), descripcion: String(r.descripcion || ''),
    contexto: r.contexto ? String(r.contexto).replace(/\s+/g, ' ').trim() : '',
    // Para lo que se repite: la carpeta y el espacio vienen en la receta; el grupo ordena el lanzador.
    carpeta: r.carpeta ? String(r.carpeta) : '', espacio: r.espacio ? String(r.espacio) : '', grupo: r.grupo ? String(r.grupo) : 'Otras',
    // entorno: la carpeta del entorno (su index.md dice dónde vive cada cosa); buscar_en: donde abre el selector
    // cuando la carpeta cambia en cada corrida (un trabajo, un proyecto, un caso).
    entorno: r.entorno ? String(r.entorno) : '', buscarEn: r.buscar_en ? String(r.buscar_en) : '',
    origen: origenDe(r.origen), nacioDe: r.nacio_de ? String(r.nacio_de) : '',
    // Sprint 22: el registro entero de la entrevista que la originó (relativo a la carpeta de recetas).
    entrevista: r.entrevista ? String(r.entrevista) : '',
    etapas: r.etapas.map((e) => (e && e.puerta !== undefined)
      // elegir: la puerta despliega la lista numerada del traspaso para marcar qué sigue y qué no.
      ? { tipo: 'puerta', nombre: String(e.puerta || 'Revisar antes de seguir'), critica: !!e.critica, elegir: !!e.elegir }
      : conAccion(e, {
        tipo: 'etapa', nombre: String(e.nombre || 'Etapa'), skill: e.skill ? String(e.skill) : '',
        agentes: entreAgentes(e.agentes), paralelo: !!e.paralelo,
        traspaso: e.traspaso ? String(e.traspaso) : '', instruccion: String(e.instruccion || '').trim(),
        soloLectura: !!e.solo_lectura,
        // Sprint 27, H3: tope de palabras de lo que deja cada agente (el traspaso, o tope_archivo si se mide otro).
        // tope_detalle: adónde va lo que sobra al reescribir (el veredicto lo manda a VEREDICTO-DETALLE.md).
        topePalabras: topeDe(e.tope_palabras), topeArchivo: e.tope_archivo ? String(e.tope_archivo) : '',
        topeDetalle: e.tope_detalle ? String(e.tope_detalle) : '',
        // web: su terminal abre con WebSearch y WebFetch permitidos, para investigar sin quedar esperando un permiso (sprint 10).
        web: !!e.web,
        // auto: lo decide la skill clasificar-complejidad al abrir la etapa.
        modeloConfig: ['haiku', 'opus'].includes(String(e.modelo || '').toLowerCase()) ? String(e.modelo).toLowerCase() : 'auto',
        esfuerzoConfig: ESFUERZOS.includes(String(e.esfuerzo || '').toLowerCase()) ? String(e.esfuerzo).toLowerCase() : ''
      }, cache))
  };
}

// Sprint 23 (H2, D4 y D5): al lanzar, la instrucción de cada etapa con acción, con los parámetros de la receta pisados
// por los de esa corrida (parametros: { índice de etapa: { nombre: valor } }). Una acción que sale del computador
// necesita una puerta crítica justo antes, aunque la receta no haya pasado por validarReceta (una puesta a mano).
// Devuelve { índice: instrucción } o lanza Error con todos los problemas juntos, antes de abrir nada.
function armarAcciones(receta, parametros) {
  const salida = {};
  const errores = [];
  let lista = null;
  (receta.etapas || []).forEach((e, idx) => {
    if (e.tipo !== 'etapa' || !e.accion) return;
    try {
      if (!lista) lista = listaAcciones() || [];
      const a = acciones.buscar(lista, e.accion);
      const previa = receta.etapas[idx - 1];
      if (a.sale && !(previa && previa.tipo === 'puerta' && previa.critica)) throw new Error(`«${a.nombre}» sale del computador y la receta no tiene una puerta crítica justo antes.`);
      const valores = parametros && typeof parametros === 'object' ? (parametros[idx] || parametros[String(idx)]) : undefined;
      salida[idx] = acciones.armarInstruccion(a, e.parametros, valores);
    } catch (err) {
      errores.push(`Etapa ${idx + 1} («${e.nombre}»): ${err.message}`);
    }
  });
  if (errores.length) throw new Error(errores.join(' '));
  return salida;
}
const interpretarReceta = (id, texto) => Object.assign({ id }, armarReceta(id, yaml.load(conVariables(String(texto || '')))));

function leerRecetas() {
  const recetas = [];
  const rutas = new Map();
  for (const carpeta of [CARPETA_EJEMPLOS, carpetaPropias]) {
    let lista = [];
    try { lista = fs.readdirSync(carpeta).filter((f) => /\.ya?ml$/i.test(f)); } catch (e) { continue; }
    for (const f of lista) rutas.set(f.replace(/\.ya?ml$/i, ''), path.join(carpeta, f));
  }
  for (const [id, ruta] of [...rutas].sort((a, b) => a[0].localeCompare(b[0]))) {
    const archivo = path.basename(ruta);
    const propia = path.dirname(ruta) !== CARPETA_EJEMPLOS;
    try {
      const r = yaml.load(conVariables(fs.readFileSync(ruta, 'utf8')));
      recetas.push(Object.assign({ id, archivo, ruta, propia }, armarReceta(id, r)));
    } catch (err) {
      recetas.push({ id, archivo, ruta, propia, nombre: id, descripcion: 'No se pudo leer: ' + err.message, etapas: [], error: true, origen: 'mano' });
    }
  }
  return recetas;
}

// {fecha} es la fecha del día (AAAA-MM-DD): un flujo diario deja sus traspasos en su propia carpeta del día.
function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function rellenar(texto, valores) {
  const v = Object.assign({ fecha: hoy() }, valores);
  return texto.replace(/\{(i|n|traspaso|carpeta|fecha)\}/g, (m, k) => (v[k] !== undefined ? String(v[k]) : m));
}

// Sprint 27, H2: {incluir:ruta} pega en la instrucción el archivo (relativo a la carpeta del flujo), así la sesión no
// gasta un turno en leerlo. Un «*» en el nombre junta varios en orden («r1/asiento-*.md»), cada uno con su nombre.
// Lo que falta, sale de la carpeta o no cabe en el tope queda como «lee el archivo ruta». Corre después de rellenar,
// para que «{incluir:perfiles/{i}.md}» ya traiga el número del agente.
const TOPE_INCLUIR = 24000;
function incluirArchivos(texto, carpeta, tope) {
  let queda = tope === undefined ? TOPE_INCLUIR : tope;
  const pegados = [];
  const faltan = [];
  const raiz = path.resolve(carpeta);
  const dentro = (abs) => abs === raiz || abs.startsWith(raiz + path.sep);
  const leer = (rel) => {
    const abs = path.resolve(raiz, rel);
    if (!dentro(abs)) return null;
    try { return fs.readFileSync(abs, 'utf8').replace(/^﻿/, '').trimEnd(); } catch (e) { return null; }
  };
  const salida = texto.replace(/\{incluir:([^{}]+)\}/g, (m, ruta) => {
    ruta = ruta.trim().replace(/\\/g, '/');
    let rutas = [ruta];
    const nombre = path.posix.basename(ruta);
    const dir = path.posix.dirname(ruta);
    if (nombre.includes('*') && !dir.includes('*')) {
      const patron = new RegExp('^' + nombre.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
      let lista = [];
      try { lista = fs.readdirSync(path.resolve(raiz, dir)).filter((x) => patron.test(x)); } catch (e) { /* sin carpeta */ }
      lista.sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
      if (!lista.length || !dentro(path.resolve(raiz, dir))) { faltan.push(ruta); return `lee el archivo ${ruta}`; }
      rutas = lista.map((x) => (dir === '.' ? x : `${dir}/${x}`));
    }
    return rutas.map((r) => {
      const contenido = leer(r);
      if (contenido === null || contenido.length > queda) { faltan.push(r); return `lee el archivo ${r}`; }
      queda -= contenido.length;
      pegados.push(r);
      return `\n\n[archivo ${r}]\n${contenido}\n[fin de ${r}]\n\n`;
    }).join(' ');
  });
  return { texto: salida, pegados, faltan };
}

// d: { sesiones, nuevaSesion, abrir, escribir, cambio, avisarPuerta, registrar }
function crearMotor(d) {
  const flujos = new Map();

  function publico(f) {
    return {
      id: f.id, nombre: f.nombre, receta: f.receta, carpeta: f.carpeta, estado: f.estado,
      actual: f.actual, creado: f.creado, cambio: f.cambio, simulacro: !!f.simulacro,
      espacio: f.espacio || null, pos: f.pos || null, nombres: f.nombres || null, sala: f.sala || null,
      items: f.items.map((it) => ({
        tipo: it.tipo, nombre: it.nombre, skill: it.skill || '', agentes: it.agentes || 0, critica: !!it.critica, elegir: !!it.elegir,
        modelo: it.modelo || '', modeloConfig: it.modeloConfig || 'auto', esfuerzo: it.esfuerzo || '',
        motivoModelo: it.motivoModelo || '', eligiendo: !!it.eligiendo, traspaso: it.traspaso || '', inicio: it.inicio || null, fin: it.fin || null,
        estado: it.estado, sesiones: it.sesiones || [], falta: it.falta || [],
        // Sprint 27, H3: el tope y lo que quedó sobre él después de la única reescritura (aviso en la tarjeta).
        topePalabras: it.topePalabras || 0, topes: it.excedidos || [],
        // Sprint 23: la acción estándar de la etapa y si sale del computador.
        accion: it.accion || '', sale: !!it.sale
      }))
    };
  }

  function tocar(f) {
    f.cambio = Date.now();
    d.cambio();
  }

  async function lanzar(receta, carpeta, ajustes) {
    const a = ajustes || {};
    // Sprint 23: con un parámetro que falta o una acción que no existe, no se abre nada (el error dice cuál).
    const deAcciones = armarAcciones(receta, a.parametros);
    const criticasPedidas = [];
    const items = receta.etapas.map((e, idx) => {
      const it = Object.assign({}, e, { estado: 'espera', sesiones: [], falta: [] });
      if (e.tipo === 'etapa' && e.paralelo && a.agentes && a.agentes[idx]) it.agentes = entreAgentes(a.agentes[idx]);
      if (e.tipo === 'etapa' && a.modelos && MODELOS_RECETA.includes(a.modelos[idx])) it.modeloConfig = a.modelos[idx];
      if (deAcciones[idx] !== undefined) it.instruccion = deAcciones[idx];
      // Sprint 23 (H2): una puerta crítica nunca se salta, venga de donde venga el pedido (la ventana ya no deja; el MCP podía).
      if (e.tipo === 'puerta') {
        const apagada = !!(a.puertas && a.puertas[idx] === false);
        it.activa = !!e.critica || !apagada;
        if (e.critica && apagada) criticasPedidas.push(idx);
      }
      return it;
    });
    const nombreCarpeta = path.basename(carpeta);
    const f = {
      id: 'f' + crypto.randomBytes(5).toString('hex'), nombre: `${receta.nombre} · ${nombreCarpeta}`,
      receta: receta.id, carpeta, items, actual: -1, estado: 'corriendo', creado: Date.now(), cambio: Date.now(),
      contexto: (receta.entorno
        ? `Entorno: antes de empezar lee ${path.join(receta.entorno, 'CLAUDE.md')} (sus recursos clave y límites) y ${path.join(receta.entorno, 'index.md')} (dónde vive cada cosa); trabaja en las carpetas reales que lista y, si creas, mueves o archivas una carpeta, anótalo con fecha en ${path.join(receta.entorno, 'log.md')}. `
        : '') + (receta.contexto || ''),
      // Simulacro: se detiene en la primera puerta y no deja aprobarla (para probar recetas sin consecuencias).
      simulacro: !!a.simulacro,
      espacio: a.espacio || null, pos: null,
      // nombres: cómo se llama cada agente de una etapa en paralelo (la sala: «Caja», «Legal»…), en el orden de {i}.
      nombres: Array.isArray(a.nombres) ? a.nombres.map((x) => String(x).slice(0, 40)).slice(0, MAX_AGENTES) : null,
      // sala: la corrida de la sala directiva (negocio, CRM, carpeta), para mostrar y registrar su veredicto.
      sala: a.sala && typeof a.sala === 'object' ? a.sala : null
    };
    flujos.set(f.id, f);
    d.registrar('flujo lanzado', f.id, receta.id);
    for (const idx of criticasPedidas) d.registrar('puerta crítica no se salta', f.id, idx);
    await avanzar(f);
    return publico(f);
  }

  async function avanzar(f) {
    for (let i = f.actual + 1; i < f.items.length; i++) {
      const it = f.items[i];
      f.actual = i;
      if (it.tipo === 'puerta') {
        if (!it.activa && !it.critica) { it.estado = 'saltada'; continue; }
        it.estado = 'necesita';
        it.inicio = Date.now();
        f.estado = 'puerta';
        tocar(f);
        d.avisarPuerta(f, it);
        return;
      }
      await abrirEtapa(f, i);
      return;
    }
    f.estado = 'completo';
    tocar(f);
  }

  // Qué modelo corre la etapa: el de la receta, el forzado («Repetir en Opus») o el que decide la skill.
  async function elegirModelo(f, idx, forzado) {
    const it = f.items[idx];
    const config = forzado || it.modeloConfig || 'auto';
    if (config !== 'auto') {
      it.modelo = config;
      it.esfuerzo = (!forzado && it.esfuerzoConfig) || ESFUERZO_POR_DEFECTO[config];
      it.reglaModelo = forzado ? 'repetida' : 'receta';
      it.motivoModelo = forzado ? 'Se repitió en Opus porque la etapa en Haiku no dejó su traspaso.' : 'Lo fija la receta.';
      return;
    }
    const siguiente = f.items[idx + 1];
    const tarea = [
      `Etapa «${it.nombre}» de la receta «${f.receta}».`,
      it.skill ? `Skill: ${it.skill}.` : 'Sin skill.',
      `Agentes en paralelo: ${it.agentes}.`,
      it.soloLectura ? 'Es de solo lectura (revisa, no corrige).' : '',
      siguiente && siguiente.tipo === 'puerta' && siguiente.critica ? 'Después viene una puerta crítica.' : '',
      `Instrucción: ${rellenar(it.instruccion, { i: 1, n: it.agentes, traspaso: it.traspaso, carpeta: f.carpeta }).replace(/\s+/g, ' ')}`
    ].filter(Boolean).join('\n');
    // La clave no lleva la carpeta ni la fecha: un flujo diario no se reclasifica cada día.
    const clave = crypto.createHash('sha256').update(tarea.split(f.carpeta).join('').split(hoy()).join('')).digest('hex').slice(0, 24);
    it.eligiendo = true;
    tocar(f);
    const v = await d.clasificar(clave, tarea);
    it.eligiendo = false;
    it.modelo = v.modelo;
    it.esfuerzo = it.esfuerzoConfig || (ESFUERZOS.includes(v.esfuerzo) ? v.esfuerzo : ESFUERZO_POR_DEFECTO[v.modelo]);
    it.reglaModelo = v.regla;
    it.motivoModelo = v.motivo;
  }

  async function abrirEtapa(f, idx, forzado) {
    const it = f.items[idx];
    it.estado = 'trabajando';
    it.sesiones = [];
    it.falta = [];
    it.reescritas = [];
    it.excedidos = [];
    // Inicio y fin de cada etapa y puerta: la vista Flujo los muestra como duración.
    it.inicio = Date.now();
    it.fin = null;
    f.estado = 'corriendo';
    await elegirModelo(f, idx, forzado);
    d.registrar('modelo de la etapa', f.id, idx, it.modelo, it.esfuerzo, it.reglaModelo);
    if (it.accion) d.registrar('accion', f.id, idx, it.accion, it.sale ? 'sale' : 'no sale');
    for (let k = 1; k <= it.agentes; k++) {
      const traspaso = it.traspaso ? rellenar(it.traspaso, { i: k, n: it.agentes }) : '';
      // La carpeta del traspaso se crea antes (context\ o _flujos\AAAA-MM-DD\, según la receta).
      if (traspaso) fs.mkdirSync(path.dirname(path.resolve(f.carpeta, traspaso)), { recursive: true });
      let instruccion = rellenar(it.instruccion, { i: k, n: it.agentes, traspaso, carpeta: f.carpeta }).replace(/\s+/g, ' ').trim();
      if (traspaso && !instruccion.includes(traspaso)) instruccion += ` Al terminar, deja el resultado en ${traspaso}.`;
      // Sprint 27, H2: los archivos se pegan después de juntar los espacios, para que conserven sus saltos de línea.
      if (instruccion.includes('{incluir:')) {
        const inc = incluirArchivos(instruccion, f.carpeta);
        instruccion = inc.texto.trim();
        d.registrar('archivos pegados', f.id, idx, k, inc.pegados.length, inc.faltan.join(', ') || '-');
      }
      // El contexto de la receta va primero: lo que vale para todas las etapas (perfil, límites).
      if (f.contexto) instruccion = `Contexto del flujo: ${rellenar(f.contexto, { carpeta: f.carpeta })} — Tu tarea: ${instruccion}`;
      // La sesión va a la pestaña del flujo, no a la que esté a la vista cuando parte la etapa (22-10-2026: quedaban
      // en otra pestaña que su marco, sin «Ordenar» que las moviera).
      const s = await d.nuevaSesion(f.carpeta, instruccion, {
        ...(f.espacio ? { espacio: f.espacio } : {}),
        flujo: f.id, etapa: idx, traspaso, soloLectura: !!it.soloLectura, web: !!it.web, modelo: it.modelo, esfuerzo: it.esfuerzo,
        nombre: it.agentes > 1 ? (f.nombres && f.nombres[k - 1] ? `${it.nombre} · ${f.nombres[k - 1]}` : `${it.nombre} ${k}`) : it.nombre
      });
      it.sesiones.push(s.id);
      d.abrir(s.id);
    }
    tocar(f);
  }

  // Una sesión del flujo terminó su turno (hook Stop).
  function alTerminar(s) {
    const f = flujos.get(s.flujo);
    if (!f) return;
    const it = f.items[s.etapa];
    if (!it || it.estado !== 'trabajando') return;
    s.listo = true;
    revisar(f, s.etapa);
  }

  function revisar(f, idx) {
    const it = f.items[idx];
    const ses = it.sesiones.map((id) => d.sesiones.get(id)).filter(Boolean);
    if (!ses.length || !ses.every((x) => x.listo)) { tocar(f); return; }
    // Un traspaso cuenta si existe Y es de esta etapa: un archivo anterior a su inicio (de otro día, de una
    // corrida previa) no prueba que el agente hizo el trabajo. Margen de 2 s por la resolución del reloj.
    const deEstaEtapa = (ruta) => {
      try { return !it.inicio || fs.statSync(path.resolve(f.carpeta, ruta)).mtimeMs >= it.inicio - 2000; } catch (e) { return false; }
    };
    it.falta = ses.filter((x) => x.traspaso && !deEstaEtapa(x.traspaso)).map((x) => x.traspaso);
    if (it.falta.length) { tocar(f); return; }
    if (it.topePalabras && revisarTopes(f, idx, ses)) { tocar(f); return; }
    it.estado = 'listo';
    it.fin = Date.now();
    avanzar(f);
  }

  // Sprint 27, H3 (D4): al agente cuyo archivo se pasa del tope se le pide UNA vez, en su misma sesión, que lo
  // reescriba entero con Write (en solo_lectura Edit está denegado: T-C12). Si la segunda versión también se pasa,
  // la etapa sigue y queda anotado (registro y it.excedidos para la tarjeta). Devuelve true si hay que esperar.
  function revisarTopes(f, idx, ses) {
    const it = f.items[idx];
    it.reescritas = it.reescritas || [];
    it.excedidos = it.excedidos || [];
    const tope = it.topePalabras;
    let esperar = false;
    for (const s of ses) {
      const k = it.sesiones.indexOf(s.id) + 1;
      const ruta = it.topeArchivo ? rellenar(it.topeArchivo, { i: k, n: it.agentes }) : s.traspaso;
      if (!ruta) continue;
      let texto;
      try { texto = fs.readFileSync(path.resolve(f.carpeta, ruta), 'utf8'); } catch (e) { continue; }
      const palabras = contarPalabras(texto);
      it.excedidos = it.excedidos.filter((x) => x.ruta !== ruta);
      if (palabras <= tope) continue;
      if (!it.reescritas.includes(s.id)) {
        it.reescritas.push(s.id);
        const detalle = it.topeDetalle ? rellenar(it.topeDetalle, { i: k, n: it.agentes }) : '';
        // T-C16c: apuntar al 85 % del tope; en T-C16 cuatro de cinco segundas versiones se pasaron por 2 a 18 %.
        const meta = Math.floor(tope * 0.85);
        const orden = `Tu archivo ${ruta} tiene ${palabras} palabras y el tope de esta etapa es ${tope}. ` +
          `Vuelve a escribir el archivo entero con la herramienta Write (no lo edites por partes con Edit), ` +
          `apuntando a unas ${meta} palabras para quedar bajo ${tope} con margen, ` +
          'sin perder números ni fuentes y manteniendo sus secciones fijas. ' +
          'Ojo al contar: una cifra con puntos o comas cuenta como varias palabras (1.334 son dos; 12,5 % son dos). ' +
          (detalle ? `Lo que sobre va completo a ${detalle}, también con Write. ` : 'Lo que sobre se deja fuera. ') +
          'No hagas nada más.';
        s.listo = false;
        if (d.escribir(s.id, orden) !== false) {
          d.registrar('tope: reescribir', f.id, idx, ruta, palabras, tope);
          esperar = true;
          continue;
        }
        s.listo = true;
      }
      it.excedidos.push({ ruta, palabras, tope });
      d.registrar('tope excedido', f.id, idx, ruta, palabras, tope);
    }
    return esperar;
  }

  // Los archivos que dejó la etapa anterior a la puerta, con su texto, para mostrarlos en la tarjeta.
  function traspasosPuerta(fid) {
    const f = flujos.get(fid);
    if (!f || f.estado !== 'puerta') return [];
    let previa = f.actual - 1;
    while (previa >= 0 && f.items[previa].tipo !== 'etapa') previa--;
    if (previa < 0) return [];
    const it = f.items[previa];
    const rutas = (it.sesiones || []).map((id) => (d.sesiones.get(id) || {}).traspaso).filter(Boolean);
    if (!rutas.length && it.traspaso) for (let k = 1; k <= it.agentes; k++) rutas.push(rellenar(it.traspaso, { i: k, n: it.agentes }));
    return [...new Set(rutas)].map((ruta) => {
      const abs = path.resolve(f.carpeta, ruta);
      let texto = null;
      try { texto = fs.readFileSync(abs, 'utf8').replace(/^﻿/, ''); } catch (e) { /* no está */ }
      return { ruta, abs, texto };
    });
  }

  // La elección de la puerta queda en el archivo: lo que no va hoy lleva [no] en su línea (así lo leen
  // las etapas siguientes) y al final se agrega la sección «Elección de quien usa la app» con los números.
  const MARCA_NO = ' [no]';
  function anotarEleccion(f, e) {
    const archivo = traspasosPuerta(f.id).find((x) => x.ruta === e.archivo && x.texto !== null);
    if (!archivo) throw new Error('no está el archivo ' + e.archivo);
    const fin = archivo.texto.includes('\r\n') ? '\r\n' : '\n';
    const fuera = new Set([...(e.despues || []), ...(e.no || [])].map(Number));
    const lineas = archivo.texto.split(/\r?\n/);
    const desde = lineas.findIndex((l) => /^##\s+Elección de /.test(l));
    if (desde >= 0) {
      let hasta = lineas.findIndex((l, i) => i > desde && /^##\s/.test(l));
      if (hasta < 0) hasta = lineas.length;
      lineas.splice(desde, hasta - desde);
    }
    const marcadas = lineas.map((l) => {
      const m = l.match(/^(\d+)\.\s/);
      if (!m) return l;
      const limpia = l.replace(/\s*\[no\]\s*$/, '');
      return fuera.has(Number(m[1])) ? limpia + MARCA_NO : limpia;
    });
    while (marcadas.length && !marcadas[marcadas.length - 1].trim()) marcadas.pop();
    const d2 = (n) => String(n).padStart(2, '0');
    const ahora = new Date();
    const lista = (xs) => (xs && xs.length ? xs.join(', ') : 'ninguno');
    marcadas.push('', `## Elección de ${variables.nombre} · ${d2(ahora.getDate())}-${d2(ahora.getMonth() + 1)}-${ahora.getFullYear()} ${d2(ahora.getHours())}:${d2(ahora.getMinutes())}`, '',
      `- **Hoy (${(e.hoy || []).length}):** ${lista(e.hoy)}`,
      `- **Después (${(e.despues || []).length}):** ${lista(e.despues)}`,
      `- **No (${(e.no || []).length}):** ${lista(e.no)}`, '',
      'Lo que no va hoy lleva [no] al final de su línea.', '');
    fs.writeFileSync(archivo.abs, marcadas.join(fin), 'utf8');
  }

  function aprobar(fid, origen, eleccion) {
    const f = flujos.get(fid);
    if (!f || f.estado !== 'puerta') return false;
    if (f.simulacro) { d.registrar('aprobación rechazada: simulacro', fid, f.actual, origen || '?'); return false; }
    // La puerta crítica exige la segunda confirmación también acá, no solo en la interfaz.
    if (f.items[f.actual].critica && origen !== 'confirmación') { d.registrar('aprobación rechazada: crítica sin confirmar', fid, f.actual, origen || '?'); return false; }
    if (eleccion && f.items[f.actual].elegir) {
      // Si la elección no queda escrita, la puerta no se abre: las etapas siguientes harían todo.
      try { anotarEleccion(f, eleccion); } catch (err) { d.registrar('elección sin anotar', fid, err.message); return false; }
      d.registrar('elección anotada', fid, eleccion.archivo, 'hoy', (eleccion.hoy || []).join(','));
    }
    f.items[f.actual].estado = 'abierta';
    f.items[f.actual].fin = Date.now();
    f.estado = 'corriendo';
    d.registrar('puerta aprobada', fid, f.actual, 'desde', origen || '?');
    avanzar(f);
    return true;
  }

  // La etapa anterior a la puerta vuelve a trabajar con tu indicación; al terminar, la puerta se cierra otra vez.
  function pedirCambios(fid, texto) {
    const f = flujos.get(fid);
    if (!f || f.estado !== 'puerta' || !texto || !texto.trim()) return;
    let previa = f.actual - 1;
    while (previa >= 0 && f.items[previa].tipo !== 'etapa') previa--;
    if (previa < 0) return;
    f.items[f.actual].estado = 'espera';
    const it = f.items[previa];
    it.estado = 'trabajando';
    it.falta = [];
    it.fin = null;
    f.actual = previa;
    f.estado = 'corriendo';
    for (const id of it.sesiones) {
      const s = d.sesiones.get(id);
      if (!s) continue;
      s.listo = false;
      d.escribir(id, texto.replace(/\s+/g, ' ').trim());
    }
    tocar(f);
  }

  // Si una etapa terminó pero falta un traspaso, se puede seguir igual (queda anotado).
  function seguirIgual(fid) {
    const f = flujos.get(fid);
    if (!f) return;
    const it = f.items[f.actual];
    if (!it || it.tipo !== 'etapa' || !it.falta.length) return;
    d.registrar('traspaso omitido', fid, it.falta.join(','));
    it.estado = 'listo';
    it.fin = Date.now();
    avanzar(f);
  }

  // Una etapa en Haiku que terminó sin su traspaso se vuelve a abrir en Opus; sus sesiones viejas se cierran.
  async function repetirEnOpus(fid) {
    const f = flujos.get(fid);
    if (!f) return;
    const it = f.items[f.actual];
    if (!it || it.tipo !== 'etapa' || !it.falta.length) return;
    d.registrar('etapa repetida en Opus', fid, f.actual);
    d.cerrarSesiones(it.sesiones);
    await abrirEtapa(f, f.actual, 'opus');
  }

  function quitar(fid) {
    const f = flujos.get(fid);
    if (!f) return [];
    flujos.delete(fid);
    tocar(f);
    return f.items.flatMap((it) => it.sesiones || []);
  }

  function exportar() { return [...flujos.values()].map(publico); }

  // Para guardar en disco: con las instrucciones, que hacen falta para seguir después de reabrir.
  function guardable() { return [...flujos.values()].map((f) => JSON.parse(JSON.stringify(f))); }

  function importar(lista) {
    const recetas = leerRecetas();
    for (const f of lista || []) {
      // Un flujo guardado antes de un cambio en su receta toma de ella lo que dicen las puertas (elegir, crítica)
      // y la instrucción de las etapas que todavía no parten.
      const receta = recetas.find((r) => r.id === f.receta);
      flujos.set(f.id, {
        id: f.id, nombre: f.nombre, receta: f.receta, carpeta: f.carpeta, estado: f.estado,
        actual: f.actual, creado: f.creado, cambio: f.cambio, contexto: f.contexto || '', simulacro: !!f.simulacro,
        espacio: f.espacio || null, pos: f.pos || null, nombres: f.nombres || null, sala: f.sala || null,
        items: (f.items || []).map((it, i) => {
          const copia = Object.assign({}, it);
          const e = receta && receta.etapas[i];
          if (copia.tipo === 'puerta' && e && e.tipo === 'puerta') { copia.elegir = e.elegir; copia.critica = copia.critica || e.critica; }
          // Una etapa con acción conserva la instrucción armada al lanzar (con los parámetros de esa corrida).
          if (copia.tipo === 'etapa' && copia.estado === 'espera' && !copia.accion && e && e.tipo === 'etapa' && !e.accion && e.nombre === copia.nombre) copia.instruccion = e.instruccion;
          return copia;
        })
      });
    }
  }

  function obtener(fid) { return flujos.get(fid); }
  function todos() { return [...flujos.values()]; }

  return { lanzar, alTerminar, aprobar, traspasosPuerta, pedirCambios, seguirIgual, repetirEnOpus, quitar, exportar, guardable, importar, obtener, todos };
}

module.exports = { leerRecetas, interpretarReceta, armarAcciones, incluirArchivos, TOPE_INCLUIR, contarPalabras, TOPE_MIN, TOPE_MAX, ORIGENES, crearMotor, configurar, carpetaRecetas, CARPETA_EJEMPLOS, ESFUERZOS, ESFUERZO_POR_DEFECTO, MODELOS_RECETA, MAX_AGENTES };
