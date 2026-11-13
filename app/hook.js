// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Lo llama Claude Code en cada hook de una sesión abierta por la consola. Lee el JSON del
// evento por stdin y lo manda al servidor local de la app. Nunca escribe en stdout: en
// SessionStart y UserPromptSubmit lo que se imprime entra al contexto de Claude.

const http = require('http');
const fs = require('fs');

const evento = process.argv[2] || '';
const panel = process.env.CONSOLA_PANEL;
// Puerto y token se leen de conexion.json en cada aviso: cambian al reabrir la consola y la sesión puede haber
// sobrevivido al reinicio (sprint 12). Así el token tampoco viaja en el entorno de la sesión.
let conexion = {};
try { conexion = JSON.parse(fs.readFileSync(process.env.CONSOLA_CONEXION || '', 'utf8')); } catch (e) { /* consola cerrada */ }
const puerto = Number(conexion.puerto);
const token = conexion.token || '';

if (!panel || !puerto) process.exit(0);

let entrada = '';
let enviado = false;

process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { entrada += c; });
process.stdin.on('end', enviar);
setTimeout(enviar, 1500);

function enviar() {
  if (enviado) return;
  enviado = true;
  let d = {};
  try { d = JSON.parse(entrada || '{}'); } catch (e) { d = {}; }
  const datos = {
    session_id: d.session_id,
    source: d.source,
    message: d.message,
    notification_type: d.notification_type,
    tool_name: d.tool_name,
    prompt: typeof d.prompt === 'string' ? d.prompt.slice(0, 2000) : undefined,
    // Subagentes (sprint 14): quién es y, al volver, lo último que dijo. El registro de la sesión lo lee la consola.
    agent_id: d.agent_id,
    agent_type: d.agent_type,
    last_assistant_message: typeof d.last_assistant_message === 'string' ? d.last_assistant_message.slice(0, 400) : undefined,
    transcript_path: d.transcript_path
  };
  const cuerpo = JSON.stringify({ panel, evento, datos });
  const req = http.request({
    host: '127.0.0.1', port: puerto, path: '/estado', method: 'POST', timeout: 1000,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(cuerpo), 'x-consola-token': token }
  }, (res) => { res.resume(); res.on('end', () => process.exit(0)); });
  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.end(cuerpo);
}
