// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';
// Qué edición corre (13-11-2026): la completa (app/) o una lite (lite/terminales, lite/flujos), con el mismo código.
// El arranque de cada lite fija CHOCOSYS_EDICION; main.js, el MCP y la ventana esconden lo que esa edición no lleva.
const NOMBRE = ['terminales', 'flujos'].includes(process.env.CHOCOSYS_EDICION) ? process.env.CHOCOSYS_EDICION : 'completa';
// Herramientas del MCP que cada edición deja fuera: «terminales» no lleva MCP; «flujos», ni CRM, ni sala, ni programadas.
const FUERA = { completa: null, flujos: /^(crm_|sala_|programad|programar)/, terminales: /./ };
const herramienta = (nombre) => !FUERA[NOMBRE] || !FUERA[NOMBRE].test(nombre);
module.exports = { NOMBRE, herramienta };
