// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';
// Fuentes propias (15-11-2026): <datos>\fuentes\fuentes.json dice qué familia va en títulos, interfaz y terminal.
// Cada familia es una carpeta con sus archivos, en la de datos o en app\fuentes; sin carpeta, se usa la instalada en
// Windows. Lo aplica la ventana (aplicarFuentes, renderer/app.js). Guía: docs/fuentes.md.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROLES = ['titulos', 'interfaz', 'terminal'];
const PESOS = { thin: 100, extralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, black: 900, heavy: 900 };
const juntar = (t) => t.toLowerCase().replace(/[\s_-]+/g, '');

// shortcut: el peso sale del nombre del archivo (400, Bold, SemiBold…), no de la fuente; con un nombre raro queda en 400.
function pesoDe(archivo) {
  const base = archivo.replace(/\.[^.]+$/, '').toLowerCase();
  if (/\[wght|variable/.test(base)) return '100 900';
  const numero = base.match(/(?:^|[-_ ])([1-9]00)(?:[-_ ]|$)/);
  return numero ? numero[1] : String(PESOS[base.split(/[-_ ]/).pop().replace('italic', '')] || 400);
}

// Las del usuario van primero: una carpeta suya con el mismo nombre gana a la que trae el programa.
function carasDe(nombre, raices) {
  for (const raiz of raices) {
    let carpeta;
    try { carpeta = fs.readdirSync(raiz, { withFileTypes: true }).find((e) => e.isDirectory() && juntar(e.name) === juntar(nombre)); } catch (e) { continue; }
    if (!carpeta) continue;
    return fs.readdirSync(path.join(raiz, carpeta.name)).filter((f) => /\.(woff2?|ttf|otf)$/i.test(f)).map((f) => ({
      url: pathToFileURL(path.join(raiz, carpeta.name, f)).href, peso: pesoDe(f), cursiva: /italic/i.test(f)
    }));
  }
  return [];
}

// datos: la carpeta de datos de la app; programa: la carpeta de app/. Nunca lanza: lo que no sirve vuelve como aviso.
function leer(datos, programa) {
  const propias = path.join(datos, 'fuentes');
  const r = { avisos: [] };
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(propias, 'fuentes.json'), 'utf8').replace(/^﻿/, '')) || {}; } catch (e) {
    if (e.code !== 'ENOENT') r.avisos.push(`fuentes.json no se pudo leer (${e.message}): siguen las fuentes de siempre.`);
  }
  for (const rol of ROLES) {
    const nombre = typeof cfg[rol] === 'string' ? cfg[rol].trim() : '';
    if (!nombre) continue;
    // El nombre va dentro del CSS de la ventana: solo letras, números, espacios y guiones.
    if (!/^[\p{L}\p{N} _-]{1,60}$/u.test(nombre)) { r.avisos.push(`El nombre de «${rol}» en fuentes.json lleva caracteres que una fuente no usa: se ignora.`); continue; }
    r[rol] = { nombre, caras: carasDe(nombre, [propias, path.join(programa, 'fuentes')]) };
  }
  return r;
}

module.exports = { leer, pesoDe };
