// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Lo que cambia entre Windows y macOS, en un solo lugar. En Windows cada función hace exactamente lo de antes; en macOS
// (y en Linux, sin probar) lo equivalente con herramientas del sistema (ps, which, un socket Unix).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execFile } = require('child_process');

const esWin = process.platform === 'win32';
const esMac = process.platform === 'darwin';

// Dónde suele estar cada programa si no aparece en el PATH.
const RESPALDOS = esWin
  ? { node: ['C:\\Program Files\\nodejs\\node.exe'], claude: [path.join(os.homedir(), '.local', 'bin', 'claude.exe')] }
  : { node: ['/opt/homebrew/bin/node', '/usr/local/bin/node'], claude: [path.join(os.homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'] };

function ejecutable(ruta) { try { fs.accessSync(ruta, fs.constants.X_OK); return fs.statSync(ruta).isFile(); } catch (e) { return false; } }

function buscar(programa) {
  if (esWin) {
    try {
      const salida = execFileSync('where.exe', [programa], { encoding: 'utf8', windowsHide: true });
      // Solo .exe: Node 26 no lanza un .cmd sin shell (EINVAL) y con shell un salto de línea en un argumento corta la orden.
      const primera = salida.split(/\r?\n/).find((l) => l.trim() && /\.exe$/i.test(l.trim()));
      if (primera) return primera.trim();
    } catch (e) { /* no está en el PATH */ }
  } else {
    // Solo carpetas absolutas: un «.» en el PATH elegiría un «claude» de la carpeta en que se esté.
    for (const dir of String(process.env.PATH || '').split(':').filter((d) => path.isAbsolute(d))) {
      const ruta = path.join(dir, programa);
      if (ejecutable(ruta)) return ruta;
    }
  }
  return (RESPALDOS[programa] || []).find((r) => fs.existsSync(r)) || null;
}

// Una app abierta desde el Finder o el Dock no hereda el PATH de la terminal (solo /usr/bin:/bin:/usr/sbin:/sbin), y ahí no
// están claude, node ni git. Se le pide una vez al shell de login de quien usa el Mac y se suma al PATH del proceso, que
// heredan las sesiones. En Windows no hace nada.
function cargarPathDelShell() {
  if (esWin) return '';
  const marca = '__CHOCOSYS_PATH__';
  try {
    const salida = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', `printf '${marca}%s${marca}' "$PATH"`], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    const del = (salida.split(marca)[1] || '').trim();
    if (!del) return '';
    const juntos = [...new Set([...del.split(':'), ...String(process.env.PATH || '').split(':')].filter(Boolean))];
    process.env.PATH = juntos.join(':');
    return process.env.PATH;
  } catch (e) { return ''; }
}

// Abierta desde el Finder o el Dock, la app no trae LANG (17-11-2026: en las sesiones solo llegaba LC_CTYPE=UTF-8), y
// Claude Code y las herramientas de la sesión quedan sin idioma. Se completa desde el idioma del sistema
// (app.getSystemLocale(), «es-CL») con una variante que exista en este Mac: es_CL.UTF-8 no está en macOS 13 y sí
// es_ES.UTF-8; sin ninguna de la lengua, en_US.UTF-8. Si LANG ya viene (abierta desde la Terminal), no se toca.
function completarIdioma(idiomaSistema, carpeta = '/usr/share/locale') {
  if (esWin || process.env.LANG) return process.env.LANG || '';
  const [lengua, region] = String(idiomaSistema || '').split(/[-_]/);
  let hay = [];
  try { hay = fs.readdirSync(carpeta).filter((n) => n.endsWith('.UTF-8')); } catch (e) { /* sin la carpeta */ }
  const deLengua = /^[a-z]{2,3}$/i.test(lengua || '') ? hay.filter((n) => n.startsWith(lengua.toLowerCase() + '_')).sort() : [];
  const exacta = lengua && region ? `${lengua.toLowerCase()}_${region.toUpperCase()}.UTF-8` : '';
  const elegido = (exacta && hay.includes(exacta) ? exacta : '') || deLengua[0] || 'en_US.UTF-8';
  process.env.LANG = elegido;
  return elegido;
}

// El tubo entre la consola y el dueño de las terminales: una tubería con nombre en Windows, un socket Unix en macOS
// (en la carpeta temporal del usuario: la ruta de un socket no puede pasar de 104 caracteres).
function tuboTerminales(datos) {
  const h = crypto.createHash('sha1').update(datos.toLowerCase()).digest('hex').slice(0, 12);
  if (esWin) return '\\\\.\\pipe\\chocosys-terminales-' + h;
  // En macOS la carpeta temporal es del usuario (modo 700); en Linux /tmp es de todos y otro usuario podría crear antes un
  // socket con este nombre: ahí va en XDG_RUNTIME_DIR o en la carpeta de datos.
  return path.join(esMac ? os.tmpdir() : (process.env.XDG_RUNTIME_DIR || datos), 'chocosys-' + h + '.sock');
}

// Si la consola anterior se cerró a la fuerza, sus claude siguen vivos sin ventana. Se reconocen por el archivo de hooks de
// la consola en su línea de comando; los del dueño de terminales (su pid) no son huérfanos. Devuelve los pid cerrados.
function cerrarHuerfanas(archivoHooks, dueno) {
  return new Promise((resolver) => {
    if (esWin) {
      const orden = `Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object { $_.CommandLine -like '*${archivoHooks.replace(/'/g, "''")}*' -and $_.ParentProcessId -ne ${Number(dueno) || 0} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }`;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', orden], { windowsHide: true, timeout: 15000 }, (err, salida) => {
        resolver(String(salida || '').trim().split(/\s+/).filter(Boolean));
      });
      return;
    }
    execFile('ps', ['-axww', '-o', 'pid=,ppid=,args='], { timeout: 15000, maxBuffer: 32 * 1024 * 1024 }, (err, salida) => {
      const cerrados = [];
      for (const l of String(salida || '').split('\n')) {
        const m = l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
        if (!m || Number(m[2]) === Number(dueno) || !m[3].includes(archivoHooks) || !/(^|\/)claude(\s|$)/.test(m[3])) continue;
        try { process.kill(Number(m[1]), 'SIGKILL'); cerrados.push(m[1]); } catch (e) { /* ya no estaba */ }
      }
      resolver(cerrados);
    });
  });
}

// Las opciones de la barra de la ventana. En macOS los semáforos van a la izquierda, centrados en la barra de 52 px.
function opcionesVentana() {
  return esMac
    ? { titleBarStyle: 'hidden', titleBarOverlay: true, trafficLightPosition: { x: 18, y: 18 } }
    : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#b8ad9f', height: 52 } };
}

// Los atajos de la app van con Ctrl+Shift en Windows y con Cmd+Shift en macOS (Ctrl es de Claude Code en los dos).
const conModificador = (input) => (esMac ? input.meta : input.control);

// Dónde guardan sus datos las apps del usuario (Obsidian, por ejemplo): %APPDATA% o ~/Library/Application Support.
const datosDeApps = () => process.env.APPDATA || (esMac ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));

module.exports = { esWin, esMac, buscar, cargarPathDelShell, completarIdioma, tuboTerminales, cerrarHuerfanas, opcionesVentana, conModificador, datosDeApps };
