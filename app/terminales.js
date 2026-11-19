// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Dueño de las terminales de Chocosys. Corre aparte de la ventana (electron.exe con ELECTRON_RUN_AS_NODE en Windows; el
// node del sistema en macOS, donde el armado apaga ese fusible) para que
// cerrar o reiniciar Chocosys no corte a las sesiones: al volver, la consola se conecta de nuevo y las encuentra vivas.
// Idea del demonio orcad de Orca (MIT, stablyai/orca), en chico. Habla por un tubo con mensajes JSON, uno por línea.
// Sin consola conectada por ESPERA_MS, cierra todo y se va. Si se cae, Windows cierra sus hijos (trabajo-windows.ps1).
// En macOS el tubo es un socket Unix (plataforma.js) y node-pty usa forkpty en vez de ConPTY.

const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');
const pty = require('@lydell/node-pty');

const TUBO = process.argv[2];
const ESPERA_MS = 10 * 60 * 1000;
const terminales = new Map();
let cliente = null;
let reloj = null;

// En macOS no hace falta: si este proceso se cae, se cierra el lado maestro de cada PTY y sus claude reciben SIGHUP.
if (process.platform === 'win32') {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'trabajo-windows.ps1'), '-Proceso', String(process.pid)], { windowsHide: true, timeout: 20000 });
  } catch (e) { /* sin trabajo: si este proceso se cae, sus hijos quedan como antes y la consola los cierra al abrir */ }
} else {
  // Un socket Unix que quedó de un dueño caído impide escuchar (EADDRINUSE). La consola lanza este proceso solo cuando no
  // pudo conectarse a ese socket, así que nadie lo atiende.
  try { require('fs').unlinkSync(TUBO); } catch (e) { /* no había */ }
}

function enviar(m) { if (cliente) cliente.write(JSON.stringify(m) + '\n'); }

function esperarConsola() {
  clearTimeout(reloj);
  reloj = setTimeout(() => {
    for (const t of terminales.values()) { try { t.proceso.kill(); } catch (e) { /* ya cerró */ } }
    process.exit(0);
  }, ESPERA_MS);
}

function abrir(m) {
  if (terminales.has(m.id)) return;
  let proceso;
  try { proceso = pty.spawn(m.archivo, m.args, m.opciones); }
  catch (e) { enviar({ tipo: 'salida', id: m.id, codigo: -1, error: e.message }); return; }
  const t = { proceso, cols: m.opciones.cols, rows: m.opciones.rows };
  terminales.set(m.id, t);
  proceso.onData((datos) => enviar({ tipo: 'datos', id: m.id, datos }));
  proceso.onExit(({ exitCode }) => { terminales.delete(m.id); enviar({ tipo: 'salida', id: m.id, codigo: exitCode }); });
  enviar({ tipo: 'abierta', id: m.id, pid: proceso.pid });
}

function atender(m) {
  const t = terminales.get(m.id);
  if (m.tipo === 'abrir') abrir(m);
  else if (m.tipo === 'escribir' && t) t.proceso.write(m.datos);
  else if (m.tipo === 'tamano' && t) { try { t.proceso.resize(m.cols, m.rows); t.cols = m.cols; t.rows = m.rows; } catch (e) { /* cerrando */ } }
  else if (m.tipo === 'matar' && t) { try { t.proceso.kill(); } catch (e) { /* ya cerró */ } }
}

const servidor = net.createServer((sock) => {
  // Una sola consola a la vez: la que llega reemplaza a la anterior.
  if (cliente) cliente.destroy();
  cliente = sock;
  clearTimeout(reloj);
  sock.setEncoding('utf8');
  let resto = '';
  sock.on('data', (c) => {
    resto += c;
    let i;
    while ((i = resto.indexOf('\n')) >= 0) {
      const linea = resto.slice(0, i);
      resto = resto.slice(i + 1);
      if (linea) { try { atender(JSON.parse(linea)); } catch (e) { /* mensaje roto */ } }
    }
  });
  sock.on('error', () => {});
  sock.on('close', () => { if (cliente === sock) { cliente = null; esperarConsola(); } });
  enviar({ tipo: 'hola', pid: process.pid, terminales: [...terminales].map(([id, t]) => ({ id, cols: t.cols, rows: t.rows })) });
});
// Fuera de Windows el socket nace solo para su dueño (0600): quien se conecta puede pedir abrir un programa, y en Linux
// /tmp es de todos. La máscara se devuelve al tiro (el bind es síncrono), para que las sesiones creen archivos como siempre.
const mascara = process.platform === 'win32' ? null : process.umask(0o077);
servidor.listen(TUBO, esperarConsola);
if (mascara !== null) process.umask(mascara);
