// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';
// Chocosys lite «flujos»: el mismo código de app/, con flujos y el MCP, sin CRM, segunda opinión ni tareas programadas.
// Solo fija la edición y carga la app completa; app/edicion.js decide qué se esconde.
process.env.CHOCOSYS_EDICION = 'flujos';
require('../../app/main.js');
