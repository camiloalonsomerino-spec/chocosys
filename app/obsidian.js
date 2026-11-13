// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Obsidian opcional (sprint 20). Si quien usa Chocosys tiene Obsidian, cada entorno suma su guía (el index.md) y la
// bóveda donde vive. Si no lo tiene, todo devuelve vacío y Chocosys queda igual. Sin Electron: se prueba en Node.

const fs = require('fs');
const path = require('path');

// obsidian.json de Obsidian: { "vaults": { "<id>": { "path": "C:\\…", "open": true } } }. Devuelve las rutas de las
// bóvedas que existen. Recibe la lista de archivos a probar en orden (la Chocosys de prueba pone el suyo primero).
function leerBovedas(candidatos) {
  for (const archivo of candidatos.filter(Boolean)) {
    let datos;
    try { datos = JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch (e) { continue; }
    const vaults = (datos && typeof datos.vaults === 'object' && datos.vaults) || {};
    return Object.values(vaults).map((v) => v && v.path && String(v.path)).filter((p) => p && fs.existsSync(p));
  }
  return [];
}

// ¿Está «ruta» dentro de «carpeta» (o es ella)? En Windows sin distinguir mayúsculas.
function dentroDe(ruta, carpeta) {
  if (!ruta || !carpeta) return false;
  const rel = path.relative(path.resolve(carpeta).toLowerCase(), path.resolve(ruta).toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const bovedaDe = (ruta, bovedas) => bovedas.find((b) => dentroDe(ruta, b)) || '';

// «Empresa Uno» → «empresa-uno»; «Señales Ópticas» → «senales-opticas»: como se nombran las carpetas del taller.
const carpetaDeNombre = (nombre) => String(nombre).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, '-');

// La guía de un entorno es su index.md (D2 del sprint 20), buscada en este orden: la clave «guia» de entornos.json
// (archivo o carpeta), <carpeta>\index.md y <bóveda>\entornos\<nombre>\index.md. La carpeta de trabajo no siempre es
// la guía: un entorno puede trabajar fuera de la bóveda y tener su index.md dentro.
function buscarGuia(ent, bovedas) {
  const candidatos = [];
  if (ent.guia) candidatos.push(/\.md$/i.test(ent.guia) ? ent.guia : path.join(ent.guia, 'index.md'));
  if (ent.carpeta) candidatos.push(path.join(ent.carpeta, 'index.md'));
  for (const b of bovedas) candidatos.push(path.join(b, 'entornos', carpetaDeNombre(ent.nombre), 'index.md'));
  return candidatos.find((c) => { try { return fs.statSync(c).isFile(); } catch (e) { return false; } }) || '';
}

// Las entradas del log.md son «- DD-MM-AAAA · qué · dónde». No todos siguen «la más nueva arriba»: se toma la de fecha
// más nueva y, si empatan, la que el propio archivo trata como más nueva (arriba si va de nuevo a viejo, abajo si no).
const RE_ENTRADA = /^\s*[-*]\s+(\d{2})-(\d{2})-(\d{4})\s*·\s*(.+)$/;
function ultimaDelLog(guia) {
  if (!guia) return '';
  let texto;
  try { texto = fs.readFileSync(path.join(path.dirname(guia), 'log.md'), 'utf8'); } catch (e) { return ''; }
  const entradas = [];
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.match(RE_ENTRADA);
    if (m) entradas.push({ clave: m[3] + m[2] + m[1], texto: linea.replace(/^\s*[-*]\s+/, '').trim() });
  }
  if (!entradas.length) return '';
  const deNuevoAViejo = entradas[0].clave >= entradas[entradas.length - 1].clave;
  const orden = deNuevoAViejo ? entradas : entradas.slice().reverse();
  return orden.reduce((mejor, x) => (x.clave > mejor.clave ? x : mejor), orden[0]).texto;
}

// Suma a cada entorno su guía, la bóveda (vacía si la guía no está en una) y la última línea de su registro.
function completarEntornos(lista, bovedas) {
  return lista.map((ent) => {
    const guia = buscarGuia(ent, bovedas);
    return Object.assign({}, ent, { guia, obsidian: guia ? bovedaDe(guia, bovedas) : '', log: ultimaDelLog(guia) });
  });
}

// Dirección para abrir un archivo en Obsidian (D3): solo si existe y está dentro de una bóveda conocida; si no,
// Obsidian abriría una bóveda equivocada. Devuelve { url } o { error } en palabras.
function direccionPara(ruta, bovedas) {
  if (!ruta) return { error: 'falta la ruta' };
  if (!bovedas.length) return { error: 'no hay Obsidian en este computador' };
  const absoluta = path.resolve(String(ruta));
  if (!fs.existsSync(absoluta)) return { error: 'no existe ' + absoluta };
  if (!bovedaDe(absoluta, bovedas)) return { error: 'la ruta no está dentro de una bóveda de Obsidian' };
  return { url: 'obsidian://open?path=' + encodeURIComponent(absoluta) };
}

// H4: ¿una sesión suelta nueva tiene que leer la guía de su entorno? Solo si su pestaña es la de un entorno con guía
// dentro de una bóveda (sin Obsidian, Chocosys queda igual) y su carpeta no está dentro de la carpeta de la guía (ahí
// Claude Code ya carga ese CLAUDE.md solo). La pestaña es de un entorno por su clave «entorno» (sprint 25) o por su
// nombre. Devuelve la carpeta de la guía o ''.
function guiaParaSesion(carpeta, espacio, entornos) {
  if (!espacio) return '';
  const nombre = String(espacio.entorno || espacio.nombre || '').toLowerCase();
  const ent = (entornos || []).find((x) => x && x.nombre && x.nombre.toLowerCase() === nombre);
  if (!ent || !ent.guia || !ent.obsidian) return '';
  const dir = path.dirname(ent.guia);
  return dentroDe(carpeta, dir) ? '' : dir;
}

// La misma frase que flujos.js pone a una receta con «entorno:» (D5 del sprint 20). El CLAUDE.md se nombra solo si
// existe: en Consultora y Personal la guía vive en la carpeta de trabajo y no siempre trae uno.
function fraseGuia(dir) {
  const claude = path.join(dir, 'CLAUDE.md');
  const lee = fs.existsSync(claude) ? `${claude} (sus recursos clave y límites) y ` : '';
  return `Entorno: antes de empezar lee ${lee}${path.join(dir, 'index.md')} (dónde vive cada cosa); trabaja en las carpetas reales que lista y, si creas, mueves o archivas una carpeta, anótalo con fecha en ${path.join(dir, 'log.md')}.`;
}

// ── H5: lo que deja una sesión, un flujo o una sala, anotado en el log.md del entorno ──
// Una sesión suelta se anota al cerrarla si trabajó al menos estos turnos (D4: si el registro se llena de sesiones
// cortas, se sube a 3).
const MIN_TURNOS_PARA_ANOTAR = 1;

// El entorno (con guía dentro de una bóveda) que se llama «nombre». Sin Obsidian no hay ninguno: Chocosys queda igual.
function entornoConGuia(nombre, entornos) {
  const n = String(nombre || '').toLowerCase();
  if (!n) return null;
  return (entornos || []).find((x) => x && x.nombre && x.nombre.toLowerCase() === n && x.guia && x.obsidian) || null;
}
// El entorno cuya guía vive en «dir» (la clave «entorno:» de una receta es esa carpeta).
function entornoDeCarpeta(dir, entornos) {
  if (!dir) return null;
  return (entornos || []).find((x) => x && x.guia && x.obsidian && path.resolve(path.dirname(x.guia)).toLowerCase() === path.resolve(dir).toLowerCase()) || null;
}

const unaLinea = (t, max) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max - 1) + '…' : s; };
const fechaDMA = (d) => { const x = d || new Date(); return String(x.getDate()).padStart(2, '0') + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + x.getFullYear(); };

// Inserta «- DD-MM-AAAA · qué · dónde» en <guiaDir>\log.md. D7: justo encima de la primera entrada (debajo del
// encabezado), como dice el propio archivo («la más nueva arriba»), aunque alguno venga agregando abajo; sin entradas, al
// final. Leer, insertar y escribir en una pasada síncrona (el proceso principal no se interrumpe a la mitad). No crea el
// log.md si falta, y la misma línea no se escribe dos veces. Devuelve { ok, linea } o { error }.
function anotarEnLog(guiaDir, que, donde, fecha) {
  const archivo = path.join(guiaDir, 'log.md');
  let texto;
  try { texto = fs.readFileSync(archivo, 'utf8'); } catch (e) { return { error: 'no hay log.md en ' + guiaDir }; }
  const linea = `- ${fechaDMA(fecha)} · ${unaLinea(que, 220)}${donde ? ' · ' + unaLinea(donde, 200) : ''}`;
  const fin = texto.includes('\r\n') ? '\r\n' : '\n';
  const lineas = texto.split(/\r?\n/);
  if (lineas.some((l) => l.trim() === linea)) return { ok: true, linea, repetida: true };
  const primera = lineas.findIndex((l) => RE_ENTRADA.test(l));
  if (primera >= 0) lineas.splice(primera, 0, linea);
  else {
    while (lineas.length && lineas[lineas.length - 1].trim() === '') lineas.pop();
    lineas.push('', linea, '');
  }
  try { fs.writeFileSync(archivo, lineas.join(fin), 'utf8'); } catch (e) { return { error: e.message }; }
  return { ok: true, linea };
}

module.exports = { leerBovedas, dentroDe, bovedaDe, carpetaDeNombre, buscarGuia, ultimaDelLog, completarEntornos, direccionPara, guiaParaSesion, fraseGuia,
  MIN_TURNOS_PARA_ANOTAR, entornoConGuia, entornoDeCarpeta, anotarEnLog, unaLinea };
