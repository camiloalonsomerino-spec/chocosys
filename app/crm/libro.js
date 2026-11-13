// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Lector de Excel (.xlsx) sin dependencias (sprint 6, 20-10-2026). Un .xlsx es un ZIP con XML; acá se lee lo justo
// para sacar un número por su etiqueta: «la celda que dice TOTAL NETO y el primer número a su derecha». Nunca por
// coordenada: si alguien agrega una fila, la etiqueta sigue ahí. Excel guarda el valor calculado de cada fórmula,
// así que no hace falta Excel para leerlo. Solo lee: no escribe ni ejecuta nada del archivo.

const fs = require('fs');
const zlib = require('zlib');

function leerZip(buf) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('No es un .xlsx (no tiene índice ZIP).');
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const entradas = new Map();
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const largo = buf.readUInt32LE(p + 20);
    const n = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), coment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + n);
    entradas.set(nombre, () => {
      const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const datos = buf.subarray(ini, ini + largo);
      return (metodo === 8 ? zlib.inflateRawSync(datos) : datos).toString('utf8');
    });
    p += 46 + n + extra + coment;
  }
  return entradas;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const texto = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));
const unirT = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => texto(m[1])).join('');
const colNum = (letras) => [...letras].reduce((s, c) => s * 26 + c.charCodeAt(0) - 64, 0);
// Para comparar etiquetas: sin tildes, sin espacios de más, en mayúscula.
const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

// Devuelve { hojas: [{ nombre, celdas: [{ fila, col, ref, valor }] }] }; valor es número o texto.
function leer(ruta) {
  const zip = leerZip(fs.readFileSync(ruta));
  const de = (n) => (zip.has(n) ? zip.get(n)() : '');
  const compartidos = [...de('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unirT(m[1]));
  const rels = new Map([...de('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const id = (m[0].match(/\bId="([^"]+)"/) || [])[1];
    const destino = (m[0].match(/\bTarget="([^"]+)"/) || [])[1] || '';
    return [id, destino.startsWith('/') ? destino.slice(1) : 'xl/' + destino.replace(/^\.\//, '')];
  }));
  const hojas = [...de('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const nombre = texto((m[0].match(/\bname="([^"]*)"/) || [])[1] || '');
    const rid = (m[0].match(/\br:id="([^"]+)"/) || [])[1];
    const xml = de(rels.get(rid) || '');
    const celdas = [];
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (c[1].match(/\br="([A-Z]+)(\d+)"/) || []);
      if (!ref[1] || !c[2]) continue;
      const tipo = (c[1].match(/\bt="([^"]+)"/) || [])[1] || 'n';
      const v = (c[2].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let valor;
      if (tipo === 's') valor = compartidos[Number(v)] ?? '';
      else if (tipo === 'inlineStr') valor = unirT(c[2]);
      else if (tipo === 'str' || tipo === 'e') valor = v === undefined ? '' : texto(v);
      else if (tipo === 'b') valor = v === '1';
      else valor = v === undefined || v === '' ? null : Number(v);
      if (valor === null || valor === '') continue;
      celdas.push({ fila: Number(ref[2]), col: colNum(ref[1]), ref: ref[1] + ref[2], valor });
    }
    return { nombre, celdas };
  });
  return { hojas };
}

// El número a la derecha de la etiqueta (la misma fila). Si la etiqueta aparece varias veces, gana la de más abajo
// que tenga un número: los totales van al pie. hoja es opcional (sin ella, busca en todas).
function valorDe(libro, { hoja, etiqueta }) {
  const buscada = normal(etiqueta);
  const hojas = hoja ? libro.hojas.filter((x) => normal(x.nombre) === normal(hoja)) : libro.hojas;
  let mejor = null;
  for (const h of hojas) {
    for (const c of h.celdas) {
      if (typeof c.valor !== 'string' || normal(c.valor) !== buscada) continue;
      const num = h.celdas.filter((x) => x.fila === c.fila && x.col > c.col && typeof x.valor === 'number').sort((a, b) => a.col - b.col)[0];
      if (num && (!mejor || c.fila >= mejor.fila)) mejor = { valor: num.valor, hoja: h.nombre, celda: num.ref, fila: c.fila };
    }
  }
  return mejor;
}

// La moneda la dice el propio documento: «Pesos chilenos», «USD», «Dólares», «UF». Sin pista, pesos.
function monedaDe(libro, hoja) {
  const textos = (hoja ? libro.hojas.filter((x) => normal(x.nombre) === normal(hoja)) : libro.hojas)
    .flatMap((h) => h.celdas.filter((c) => typeof c.valor === 'string' && c.fila <= 25).map((c) => normal(c.valor)));
  if (textos.some((t) => /PESOS CHILENOS|\bCLP\b/.test(t))) return 'CLP';
  if (textos.some((t) => /\bUSD\b|DOLAR|US\$/.test(t))) return 'USD';
  if (textos.some((t) => /\bUF\b|UNIDADES DE FOMENTO/.test(t))) return 'UF';
  return 'CLP';
}

module.exports = { leer, valorDe, monedaDe, normal };
