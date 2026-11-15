// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';
// Prueba de las fuentes propias: node scripts/probar-fuentes.js (sale con 1 si algo falla). Trabaja en una carpeta temporal.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { leer, pesoDe } = require('../tipografia');

for (const [archivo, peso] of [['barlow-400.woff2', '400'], ['Barlow-SemiBold.ttf', '600'], ['LibreBaskerville-BoldItalic.ttf', '700'],
  ['BlackOpsOne-Regular.ttf', '400'], ['Inter[wght].ttf', '100 900'], ['rara.otf', '400']]) assert.strictEqual(pesoDe(archivo), peso, archivo);

const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'chocosys-fuentes-'));
const programa = path.join(__dirname, '..');
const json = (texto) => fs.writeFileSync(path.join(datos, 'fuentes', 'fuentes.json'), texto, 'utf8');
try {
  assert.deepStrictEqual(leer(datos, programa), { avisos: [] }, 'sin carpeta ni fuentes.json no cambia nada');
  fs.mkdirSync(path.join(datos, 'fuentes', 'Mi Letra'), { recursive: true });
  fs.writeFileSync(path.join(datos, 'fuentes', 'Mi Letra', 'MiLetra-Bold.woff2'), '');
  // Con BOM, como lo guardan algunos editores de Windows.
  json('﻿{ "titulos": "Libre Baskerville", "interfaz": "mi-letra", "terminal": "Consolas" }');
  const r = leer(datos, programa);
  assert.deepStrictEqual(r.avisos, []);
  assert.deepStrictEqual(r.titulos.caras.map((c) => c.peso).sort(), ['400', '700'], 'la que trae el programa');
  assert(r.titulos.caras[0].url.startsWith('file:///'));
  assert.strictEqual(r.interfaz.caras.length, 1, 'carpeta del usuario, con otro formato de nombre');
  assert.strictEqual(r.interfaz.caras[0].peso, '700');
  assert.deepStrictEqual(r.terminal.caras, [], 'instalada en Windows: sin archivos');
  json('{ "interfaz": "x\\"; } body { display: none" }');
  assert(!leer(datos, programa).interfaz && leer(datos, programa).avisos.length === 1, 'un nombre con comillas no entra al CSS');
  json('{ "titulos": ');
  assert(/no se pudo leer/.test(leer(datos, programa).avisos[0]), 'un fuentes.json roto avisa y no rompe');
} finally {
  fs.rmSync(datos, { recursive: true, force: true });
}
console.log('Fuentes propias: 6 nombres de archivo y 5 casos de fuentes.json pasan.');
