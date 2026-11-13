// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';
// Pone o quita la línea de aviso legal en cada archivo propio de Chocosys (.js, .ps1, .css, .html y .md).
//   node herramientas/aviso-legal.js <carpeta>             solo informa qué tocaría
//   node herramientas/aviso-legal.js <carpeta> --aplicar   la pone donde falta
//   node herramientas/aviso-legal.js <carpeta> --quitar    la quita (deja el archivo como estaba)
// No entra a node_modules, dist, .git ni .github (las plantillas de GitHub se copian en cada issue).
const fs = require('fs');
const path = require('path');

const TEXTO = 'Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)';
const LINEA = {
  '.js': `// ${TEXTO}`,
  '.ps1': `# ${TEXTO}`,
  '.css': `/* ${TEXTO} */`,
  '.html': `<!-- ${TEXTO} -->`,
  '.md': `*${TEXTO}*`
};
const BOM = String.fromCharCode(0xfeff);
const FUERA = new Set(['node_modules', 'dist', '.git', '.github']);
// creditos.md se muestra tal cual en la ventana de créditos (que ya lo dice) y orden-hacer-flujo.md se escribe tal cual
// en la terminal de una sesión: el aviso viajaría dentro de la orden.
const EXCLUIDOS = [/[\\/]config[\\/](creditos|orden-hacer-flujo)\.md$/];

const raiz = path.resolve(process.argv[2] || '.');
const modo = process.argv.includes('--quitar') ? 'quitar' : process.argv.includes('--aplicar') ? 'aplicar' : 'simular';

function archivos(dir, lista = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (FUERA.has(e.name)) continue;
    const r = path.join(dir, e.name);
    if (e.isDirectory()) archivos(r, lista);
    else if (LINEA[path.extname(e.name).toLowerCase()] && !EXCLUIDOS.some((x) => x.test(r))) lista.push(r);
  }
  return lista;
}

// El BOM (un .ps1 con tildes lo necesita) se aparta antes y se repone después.
const sinBom = (texto) => (texto.startsWith(BOM) ? [BOM, texto.slice(1)] : ['', texto]);

// Dónde va: después del shebang, de @charset o del doctype, que tienen que ser lo primero.
function poner(texto, linea, ext) {
  const [bom, cuerpo] = sinBom(texto);
  const eol = cuerpo.includes('\r\n') ? '\r\n' : '\n';
  const primera = cuerpo.split(/\r?\n/, 1)[0];
  const vaDespues = (ext === '.js' && primera.startsWith('#!')) || (ext === '.css' && /^@charset/i.test(primera)) || (ext === '.html' && /^<!doctype/i.test(primera));
  if (vaDespues) return bom + primera + eol + linea + eol + cuerpo.slice(primera.length + eol.length);
  return bom + linea + eol + (ext === '.md' ? eol : '') + cuerpo;
}

// En un .md se puso la línea más una vacía; en el resto, solo la línea.
function quitar(texto, linea) {
  const [bom, cuerpo] = sinBom(texto);
  const patron = new RegExp(`^${linea.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?\\n(\\r?\\n)?`, 'm');
  return bom + cuerpo.replace(patron, (m, vacia) => (linea.startsWith('*') ? '' : (vacia || '')));
}

let tocados = 0, yaEstaban = 0;
for (const f of archivos(raiz)) {
  const ext = path.extname(f).toLowerCase();
  const linea = LINEA[ext];
  const antes = fs.readFileSync(f, 'utf8');
  const tiene = antes.split(/\r?\n/).some((l) => l === linea || l === BOM + linea);
  let despues = antes;
  if (modo === 'quitar') { if (tiene) despues = quitar(antes, linea); }
  else if (tiene) yaEstaban++;
  else despues = poner(antes, linea, ext);
  if (despues === antes) continue;
  tocados++;
  if (modo !== 'simular') fs.writeFileSync(f, despues, 'utf8');
}
const verbo = { simular: 'tocaría', aplicar: 'tocó', quitar: 'quitó la línea de' }[modo];
console.log(`aviso-legal (${modo}): ${verbo} ${tocados} archivos; ${yaEstaban} ya la tenían.`);
