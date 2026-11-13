// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// La statusLine de las sesiones de Chocosys (sprint 15). Claude Code le pasa por stdin el modelo, el esfuerzo, el
// contexto, el costo y el uso del plan, y la llama solo cuando algo cambia. Escribe una línea corta en la terminal y le
// pasa los datos a la consola. Puerto y token salen de conexion.json, como en hook.js.

const http = require('http');
const fs = require('fs');

let entrada = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { entrada += c; });
process.stdin.on('end', () => {
  let d = {};
  try { d = JSON.parse(entrada); } catch (e) { d = {}; }
  const modelo = (d.model && d.model.display_name) || '';
  const esfuerzo = d.effort && d.effort.level;
  const contexto = d.context_window && d.context_window.used_percentage;
  process.stdout.write([modelo, esfuerzo, typeof contexto === 'number' ? 'contexto ' + Math.round(contexto) + ' %' : ''].filter(Boolean).join(' · ') + '\n');
  const panel = process.env.CONSOLA_PANEL;
  let c = {};
  try { c = JSON.parse(fs.readFileSync(process.env.CONSOLA_CONEXION || '', 'utf8')); } catch (e) { return; }
  if (!panel || !c.puerto) return;
  const rl = d.rate_limits || {};
  const datos = { modelo, modeloId: d.model && d.model.id, esfuerzo, contexto, costo: d.cost && d.cost.total_cost_usd, cinco: rl.five_hour, semana: rl.seven_day };
  const cuerpo = JSON.stringify({ panel, evento: 'Linea', datos });
  const req = http.request({
    host: '127.0.0.1', port: c.puerto, path: '/estado', method: 'POST', timeout: 800,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(cuerpo), 'x-consola-token': c.token || '' }
  }, (res) => res.resume());
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.end(cuerpo);
});
