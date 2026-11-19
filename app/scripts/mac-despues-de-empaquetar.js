// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// afterPack de electron-builder para macOS (lo pone scripts/instalador.js; corre antes de firmar).
// node-pty arma la ruta de spawn-helper con helperPath.replace('app.asar', 'app.asar.unpacked'). Chocosys lanza
// terminales.js desde app.asar.unpacked, así que la ruta ya lo trae y queda en «app.asar.unpacked.unpacked»: la app armada
// no abría sesiones (posix_spawn failed). Desde el código fuente no pasa, y en Windows ese código no corre.
// Si la línea no aparece (una versión nueva de node-pty), el armado falla en vez de dejar la app rota callada.

const fs = require('fs');
const path = require('path');

const ORIGINAL = "helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');";
const ARREGLADA = "helperPath = helperPath.replace(/app\\.asar(?!\\.unpacked)/, 'app.asar.unpacked');";

module.exports = async function despuesDeEmpaquetar(contexto) {
  if (contexto.electronPlatformName !== 'darwin') return;
  const app = path.join(contexto.appOutDir, `${contexto.packager.appInfo.productFilename}.app`);
  const lydell = path.join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', '@lydell');
  const paquetes = fs.existsSync(lydell) ? fs.readdirSync(lydell).filter((n) => n.startsWith('node-pty-darwin-')) : [];
  if (!paquetes.length) throw new Error(`afterPack: no está node-pty para macOS en ${lydell}`);
  for (const paquete of paquetes) {
    const archivo = path.join(lydell, paquete, 'lib', 'unixTerminal.js');
    const texto = fs.readFileSync(archivo, 'utf8');
    if (texto.includes(ARREGLADA)) continue;
    if (!texto.includes(ORIGINAL)) throw new Error(`afterPack: ${paquete}/lib/unixTerminal.js cambió y no trae la línea de spawn-helper; revisar el arreglo`);
    fs.writeFileSync(archivo, texto.replace(ORIGINAL, ARREGLADA), 'utf8');
    console.log(`  • afterPack: ruta de spawn-helper arreglada en ${paquete}`);
  }
};
