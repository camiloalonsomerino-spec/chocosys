// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// El lector de procesos de macOS (y Linux, sin probar): responde las mismas órdenes que el PowerShell de recursos.js
// («p», «a», «u <pid>», «c <ids>», «g» y «k <raíz> <conservar>») con el mismo JSON, leyendo `ps` y, para la GPU, `ioreg`.
// Diferencias con Windows: «inicio» va en ms desde 1970 con resolución de 1 s (Windows: ms desde 1601); la «sesión» de cada
// proceso es su usuario (uid), así el panel muestra solo los de quien usa el Mac.

const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const yo = typeof process.getuid === 'function' ? process.getuid() : 0;
const TRABAJO = /^(claude|python[\d.]*|pythonw|py|node|cplex|oplrun|java|rscript|julia|bash|zsh|sh)$/i;

function correr(programa, args) {
  return new Promise((ok, mal) => execFile(programa, args, { env: Object.assign({}, process.env, { LC_ALL: 'C' }), maxBuffer: 64 * 1024 * 1024, timeout: 15000 },
    (err, salida) => (err ? mal(err) : ok(String(salida)))));
}

// «0:01.23», «123:45.67» (macOS) o «1-02:03:04» (Linux) → ms de CPU.
function msCpu(t) {
  const [d, resto] = t.includes('-') ? t.split('-') : ['0', t];
  const p = resto.split(':').map(Number);
  while (p.length < 3) p.unshift(0);
  return Math.round((((Number(d) * 24 + p[0]) * 60 + p[1]) * 60 + p[2]) * 1000);
}

// El ejecutable de Claude Code nativo vive en …/versions/<número>: su nombre real se lee de la línea de comando.
const nombreDe = (comm, cmd) => (/^(\S*\/)?claude(\s|$)/.test(cmd) ? 'claude' : path.basename(comm));

// Una foto de todos los procesos. Dos lecturas de ps: comm y args pueden llevar espacios y cada una debe ir al final.
async function leer() {
  return parsear(...await Promise.all([
    correr('ps', ['-axww', '-o', 'pid=,ppid=,uid=,rss=,time=,lstart=,comm=']),
    correr('ps', ['-axww', '-o', 'pid=,args='])
  ]));
}
function parsear(a, b) {
  const cmds = new Map();
  for (const l of b.split('\n')) { const m = l.match(/^\s*(\d+)\s(.*)$/); if (m) cmds.set(Number(m[1]), m[2].trim()); }
  const lista = [];
  for (const l of a.split('\n')) {
    const m = l.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]), comm = m[7].trim(), cmd = cmds.get(pid) || comm;
    lista.push({ pid, ppid: Number(m[2]), uid: Number(m[3]), bytes: Number(m[4]) * 1024, ms: msCpu(m[5]), inicio: Date.parse(m[6].replace(/\s+/g, ' ')) || 0, comm, cmd, nombre: nombreDe(comm, cmd) });
  }
  return lista;
}

// Nunca se cierra lo del sistema ni una aplicación de quien usa el Mac (lo que corre desde /Applications o /System), ni lo que
// cuelga de ellas. Un navegador con --headless (el de una prueba automática) no cuenta.
const SISTEMA = new Set(['launchd', 'kernel_task', 'windowserver', 'loginwindow', 'finder', 'dock', 'systemuiserver', 'controlcenter', 'spotlight', 'mds', 'coreaudiod']);
const APPS = [/^\/Applications\//, /^\/System\//, /^\/usr\/libexec\//, /^\/usr\/sbin\//, /^\/sbin\//, new RegExp('^' + os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/Applications/')];
const protegido = (w) => (SISTEMA.has(w.nombre.toLowerCase()) || APPS.some((re) => re.test(w.comm))) && !/--headless/.test(w.cmd);

// La raíz (el claude de una sesión, o un proceso «pid:inicio») y todo lo que cuelga de ella.
function arbol(q, todos) {
  const hijos = new Map();
  for (const w of todos) { if (!hijos.has(w.ppid)) hijos.set(w.ppid, []); hijos.get(w.ppid).push(w); }
  let raices;
  const pi = String(q).match(/^(\d+):(\d+)$/);
  if (pi) raices = todos.filter((w) => w.pid === Number(pi[1]) && w.inicio === Number(pi[2]) && !protegido(w));
  else {
    const re = new RegExp('--(session-id|resume)[ =]"?' + String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[" ]|$)');
    raices = todos.filter((w) => w.nombre === 'claude' && re.test(w.cmd));
  }
  const cola = [...raices], desc = [];
  while (cola.length) {
    const x = cola.shift();
    for (const h of hijos.get(x.pid) || []) {
      // Un hijo más viejo que su «padre» es de otro proceso que heredó el número: no se toca.
      if (h.pid !== x.pid && (!x.inicio || !h.inicio || h.inicio >= x.inicio) && !protegido(h)) { desc.push(h); cola.push(h); }
    }
  }
  return { raices, desc };
}

// Lo que gasta 0,3 núcleos o más en 1,5 s. Devuelve también la foto final, para verificar antes de cerrar.
async function ocupados(lista) {
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 1500));
  const despues = await lector();
  const dt = Date.now() - t0;
  const por = new Map(despues.map((w) => [w.pid, w]));
  const r = [];
  for (const w of lista) {
    const d = por.get(w.pid);
    if (!d || d.inicio !== w.inicio) continue;
    const n = (d.ms - w.ms) / dt;
    if (n >= 0.3) r.push([w, n]);
  }
  return { r, despues };
}

// GPU con ioreg (sin permisos de administrador). Apple Silicon: memoria unificada, se informa como «integrada».
function gpuDeIoreg(texto) {
  const r = [];
  for (const b of texto.split(/\+-o /).slice(1)) {
    const pct = b.match(/"Device Utilization %"\s*=\s*(\d+)/);
    if (!pct) continue;
    const nombre = (b.match(/"model"\s*=\s*<?"([^"]+)"/) || b.match(/^(\S+)/) || [, 'GPU'])[1];
    const mem = b.match(/"(?:In use system memory|vramUsedBytes)"\s*=\s*(\d+)/);
    r.push([nombre, Math.min(100, Number(pct[1])), mem ? Number(mem[1]) : 0, /"VRAM,totalMB"/.test(b) ? 'dedicada' : 'integrada']);
  }
  return r.length ? r : null;
}

// La prueba (scripts/probar-unix.js) cambia el lector por una foto armada a mano.
let lector = leer;

async function pedir(orden, senal) {
  if (senal && senal.cancelada) throw new Error('cancelada antes de empezar');
  if (senal) senal.empezo = true;
  if (orden === 'p') {
    const t = await lector();
    return { s: yo, p: t.map((w) => [w.pid, w.nombre, w.bytes, w.uid, w.uid === yo ? w.ms : -1]) };
  }
  if (orden === 'a' || orden.startsWith('u ')) {
    const solo = orden.startsWith('u ') ? Number(orden.slice(2)) : null;
    const t = (await lector()).filter((w) => solo === null || w.pid === solo);
    return { a: t.map((w) => [w.pid, w.ppid, w.inicio, TRABAJO.test(w.nombre) ? w.cmd.slice(0, 400) : '']) };
  }
  if (orden.startsWith('c ')) {
    const t = await lector();
    const de = new Map(), lista = [];
    for (const id of orden.slice(2).split(',')) for (const w of arbol(id, t).desc) { de.set(w.pid, id); lista.push(w); }
    const { r } = await ocupados(lista);
    return { c: r.map(([w, n]) => [de.get(w.pid), w.pid, w.inicio, w.nombre, Math.round(n * 100) / 100]) };
  }
  if (orden === 'g') {
    if (process.platform !== 'darwin') return { g: null };
    try { return { g: gpuDeIoreg(await correr('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'])) }; } catch (e) { return { g: null }; }
  }
  if (orden.startsWith('k ')) {
    const [raiz, conservar] = orden.slice(2).split(' ');
    let todos = await lector();
    const t = arbol(raiz, todos);
    const guardar = new Set();
    if (conservar === 'ocupados') {
      const o = await ocupados(t.desc);
      for (const [w] of o.r) guardar.add(w.pid + ':' + w.inicio);
      todos = o.despues;
    } else if (conservar && conservar !== '-') for (const x of conservar.split(',')) guardar.add(x);
    const porPid = new Map(t.desc.map((w) => [w.pid, w]));
    // Lo que se guarda, lo que cuelga de eso y sus padres hasta la raíz quedan vivos (desc va de padres a hijos).
    const sub = new Set();
    for (const w of t.desc) if (sub.has(w.ppid) || guardar.has(w.pid + ':' + w.inicio)) sub.add(w.pid);
    const quedan = new Set(sub);
    for (const k of sub) { let x = porPid.get(porPid.get(k).ppid); while (x && !quedan.has(x.pid)) { quedan.add(x.pid); x = porPid.get(x.ppid); } }
    const vivos = new Map(todos.map((w) => [w.pid, w.inicio]));
    let n = 0; const nombres = [], siguen = [];
    for (const x of [...t.desc, ...t.raices]) {
      if (quedan.has(x.pid)) { siguen.push(x.nombre); continue; }
      // Antes de cerrar, el mismo proceso: mismo número y misma hora de inicio.
      if (vivos.get(x.pid) !== x.inicio) continue;
      try { process.kill(x.pid, 'SIGKILL'); n++; nombres.push(x.nombre); } catch (e) { /* ya cerró */ }
    }
    return { raices: t.raices.length, cerrados: n, nombres: nombres.join(' '), quedan: siguen.join(' ') };
  }
  return {};
}

module.exports = { pedir, msCpu, gpuDeIoreg, nombreDe, parsear, _protegido: protegido, _fijarLector: (f) => { lector = f || leer; } };
