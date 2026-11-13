// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Acciones estándar (sprint 23): enviar un correo, guardar en la carpeta del trabajo, anotar en el CRM y emitir un
// documento son siempre lo mismo con otros datos. Cada una es un YAML en config\acciones\ con sus parámetros y la
// plantilla de su instrucción; una copia en <datos>\acciones\ manda (y ahí se suman acciones propias). Este módulo solo
// lee, valida y arma texto: no envía, no guarda ni toca el CRM. La etapa sigue siendo una sesión normal (D1).
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PARAM = /^[a-z][a-z0-9_]*$/;
const TIPOS = ['texto', 'lista', 'si-no', 'opcion'];
const MODELOS = ['auto', 'haiku', 'opus'];
const ESFUERZOS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MARCA = /\{p:([a-z][a-z0-9_]*)\}/g;
const TRAMO = /\[\[([\s\S]*?)\]\]/g;

const vacio = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.some((x) => String(x == null ? '' : x).trim()));
const sinAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Del YAML ya leído a la acción. Un archivo mal hecho se rechaza entero, con el porqué en palabras.
function armarAccion(id, a) {
  if (!ID.test(id)) throw new Error(`el nombre del archivo «${id}» tiene que ir en kebab-minúscula`);
  if (!a || typeof a !== 'object') throw new Error('no es un YAML con campos');
  if (!a.instruccion || !String(a.instruccion).trim()) throw new Error('le falta «instruccion»');
  const crudos = a.parametros || {};
  if (typeof crudos !== 'object' || Array.isArray(crudos)) throw new Error('«parametros» tiene que ser una lista de nombre: campos');
  const parametros = Object.entries(crudos).map(([pid, p]) => {
    if (!PARAM.test(pid)) throw new Error(`el parámetro «${pid}» tiene que ir en minúscula, sin espacios ni guiones`);
    p = p || {};
    const tipo = String(p.tipo || 'texto').toLowerCase();
    if (!TIPOS.includes(tipo)) throw new Error(`el parámetro «${pid}» tiene tipo «${p.tipo}»; los que hay: ${TIPOS.join(', ')}`);
    const opciones = Array.isArray(p.opciones) ? p.opciones.map(String) : [];
    if (tipo === 'opcion' && !opciones.length) throw new Error(`el parámetro «${pid}» es de opción y no trae «opciones»`);
    const textos = p.textos && typeof p.textos === 'object' ? { si: p.textos.si != null ? String(p.textos.si) : 'sí', no: p.textos.no != null ? String(p.textos.no) : 'no' } : { si: 'sí', no: 'no' };
    return { id: pid, obligatorio: !!p.obligatorio, ayuda: p.ayuda ? String(p.ayuda) : '', defecto: p.defecto === undefined || p.defecto === null ? '' : p.defecto, tipo, opciones, textos };
  });
  const instruccion = String(a.instruccion).trim();
  for (const [, pid] of instruccion.matchAll(MARCA)) {
    if (!parametros.some((p) => p.id === pid)) throw new Error(`la instrucción usa {p:${pid}} y la acción no tiene ese parámetro`);
  }
  const modelo = String(a.modelo || 'auto').toLowerCase();
  const esfuerzo = String(a.esfuerzo || '').toLowerCase();
  return {
    id, nombre: String(a.nombre || id), descripcion: String(a.descripcion || ''), sale: a.sale === true,
    modelo: MODELOS.includes(modelo) ? modelo : 'auto', esfuerzo: ESFUERZOS.includes(esfuerzo) ? esfuerzo : '',
    traspaso: a.traspaso ? String(a.traspaso) : '', parametros, instruccion
  };
}

function leerCarpeta(carpeta, origen) {
  const salida = [];
  let lista = [];
  try { lista = fs.readdirSync(carpeta).filter((f) => /\.ya?ml$/i.test(f)); } catch (e) { return salida; }
  for (const f of lista.sort()) {
    const id = f.replace(/\.ya?ml$/i, '');
    const archivo = path.join(carpeta, f);
    try {
      salida.push(Object.assign(armarAccion(id, yaml.load(fs.readFileSync(archivo, 'utf8'))), { origen, archivo }));
    } catch (err) {
      salida.push({ id, origen, archivo, error: `La acción «${f}» (${origen === 'datos' ? 'copia en los datos' : 'del programa'}) no se pudo leer: ${String(err.message).split('\n')[0]}` });
    }
  }
  return salida;
}

// Todas las acciones: las del programa y, encima, las de <datos>\acciones\. Una copia rota en los datos no tumba a la
// del programa: sigue la del programa con «aviso». Una propia rota queda en la lista con «error» (no se puede usar).
function leerAcciones(datos, programa) {
  const porId = new Map();
  for (const a of leerCarpeta(path.join(programa, 'config', 'acciones'), 'programa')) porId.set(a.id, a);
  for (const a of leerCarpeta(path.join(datos, 'acciones'), 'datos')) {
    const previa = porId.get(a.id);
    if (a.error && previa && !previa.error) porId.set(a.id, Object.assign({}, previa, { aviso: a.error + ' Se usa la del programa.' }));
    else porId.set(a.id, a);
  }
  return [...porId.values()].sort((x, y) => x.id.localeCompare(y.id));
}

function buscar(acciones, id) {
  const a = (acciones || []).find((x) => x.id === String(id || ''));
  if (!a) {
    const hay = (acciones || []).filter((x) => !x.error).map((x) => x.id);
    throw new Error(`No existe la acción «${id}». Las que hay: ${hay.join(', ') || 'ninguna'}.`);
  }
  if (a.error) throw new Error(a.error);
  return a;
}

// Un valor a su forma: lista (array o texto con saltos de línea o «;»), sí/no y opción. Devuelve { valor } o { error }.
function normalizar(p, v, nombreAccion) {
  if (vacio(v)) return { valor: '' };
  if (p.tipo === 'lista') {
    const items = (Array.isArray(v) ? v : String(v).split(/[;\r\n]+/)).map((x) => String(x == null ? '' : x).trim()).filter(Boolean);
    return { valor: items };
  }
  if (p.tipo === 'si-no') {
    if (v === true || ['si', 'true', 'yes'].includes(sinAcento(v))) return { valor: 'si' };
    if (v === false || ['no', 'false'].includes(sinAcento(v))) return { valor: 'no' };
    return { error: `En «${nombreAccion}», «${p.id}» tiene que ser «sí» o «no» (llegó «${v}»).` };
  }
  if (p.tipo === 'opcion') {
    const o = p.opciones.find((x) => sinAcento(x) === sinAcento(v));
    if (!o) return { error: `En «${nombreAccion}», «${p.id}» tiene que ser una de: ${p.opciones.join(', ')} (llegó «${v}»).` };
    return { valor: o };
  }
  if (Array.isArray(v)) return { valor: v.map((x) => String(x == null ? '' : x).trim()).filter(Boolean).join(', ') };
  if (typeof v === 'object') return { error: `En «${nombreAccion}», «${p.id}» tiene que ser texto.` };
  return { valor: String(v).trim() };
}

// Revisa los parámetros de una etapa. «parametros» son los de la receta; «valores», los de esa corrida, que los pisan
// (una clave presente pisa aunque venga vacía: borrar el campo en el lanzador lo deja vacío). Con enReceta: true, un
// obligatorio vacío no es error (se pide al lanzar). Devuelve { errores: [texto], valores: { id: valor ya normalizado } }.
function validarParametros(accion, parametros, valores, opciones) {
  const enReceta = !!(opciones && opciones.enReceta);
  const errores = [];
  const juntos = {};
  for (const fuente of [parametros, valores]) {
    if (fuente === undefined || fuente === null) continue;
    if (typeof fuente !== 'object' || Array.isArray(fuente)) { errores.push(`Los parámetros de «${accion.nombre}» tienen que ir como nombre: valor.`); continue; }
    for (const [k, v] of Object.entries(fuente)) juntos[k] = v;
  }
  const conocidos = accion.parametros.map((p) => p.id);
  for (const k of Object.keys(juntos)) {
    if (!conocidos.includes(k)) errores.push(`La acción «${accion.nombre}» no tiene el parámetro «${k}». Tiene: ${conocidos.join(', ')}.`);
  }
  const salida = {};
  for (const p of accion.parametros) {
    let { valor, error } = normalizar(p, juntos[p.id], accion.nombre);
    if (error) { errores.push(error); continue; }
    if (vacio(valor) && !vacio(p.defecto)) ({ valor } = normalizar(p, p.defecto, accion.nombre));
    if (vacio(valor) && p.obligatorio && !enReceta) errores.push(`Falta «${p.id}» en «${accion.nombre}»${p.ayuda ? ': ' + p.ayuda.charAt(0).toLowerCase() + p.ayuda.slice(1) : ''}.`);
    salida[p.id] = vacio(valor) ? '' : valor;
  }
  return { errores, valores: salida };
}

// La instrucción de la etapa: los tramos [[ ]] con un parámetro vacío se van; cada {p:x} toma su valor (las listas con
// «; », sí/no con su texto). {carpeta}, {traspaso} y {fecha} quedan para el motor. Los valores se ponen al final, así un
// valor con «[[», «]]» o «{p:» queda tal cual. Los saltos de línea de la plantilla se juntan, como en una receta con «>».
// Con un error, lanza Error con todos los errores en palabras.
function armarInstruccion(accion, parametros, valores) {
  const r = validarParametros(accion, parametros, valores);
  if (r.errores.length) throw new Error(r.errores.join(' '));
  const texto = (p) => {
    const v = r.valores[p.id];
    if (p.tipo === 'lista') return v.join('; ');
    if (p.tipo === 'si-no') return v === 'si' ? p.textos.si : p.textos.no;
    return String(v);
  };
  const porId = new Map(accion.parametros.map((p) => [p.id, p]));
  const sinTramos = accion.instruccion.replace(TRAMO, (m, dentro) => {
    const usados = [...dentro.matchAll(MARCA)].map((x) => x[1]);
    return usados.some((id) => vacio(r.valores[id])) ? '' : dentro;
  });
  return sinTramos.replace(MARCA, (m, id) => texto(porId.get(id))).replace(/\s+/g, ' ').trim();
}

// D7: la lista de correos permitidos vive en <datos>\acciones\correo.json ({ "solo_a": [ ... ] }). Sin archivo, sin
// lista o con la lista vacía, devuelve null: no hay restricción. Un archivo roto cierra todo (lista vacía = nadie), con
// el porqué en «error»: si alguien puso una lista, un error de escritura no la debe abrir.
function soloA(datos) {
  const archivo = path.join(datos, 'acciones', 'correo.json');
  let texto;
  try { texto = fs.readFileSync(archivo, 'utf8').replace(/^﻿/, ''); } catch (e) { return null; }
  try {
    const j = JSON.parse(texto);
    const lista = Array.isArray(j && j.solo_a) ? j.solo_a.map((c) => String(c).trim().toLowerCase()).filter(Boolean) : [];
    return lista.length ? lista : null;
  } catch (e) {
    return Object.assign([], { error: `No se pudo leer ${archivo} (${e.message}): mientras esté roto no sale ningún correo.` });
  }
}

// Los correos de un texto («a@b.cl, c@d.cl») que no están en la lista. Sin lista, ninguno.
function correosFuera(lista, texto) {
  if (!lista) return [];
  const correos = (Array.isArray(texto) ? texto.join(',') : String(texto || '')).split(/[\s,;]+/).map((c) => c.replace(/^<|>$/g, '').trim().toLowerCase()).filter(Boolean);
  return correos.filter((c) => !lista.includes(c));
}

module.exports = { leerAcciones, armarAccion, buscar, validarParametros, armarInstruccion, soloA, correosFuera, TIPOS };
