// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';
// Chocosys lite «terminales»: el mismo código de app/, sin flujos, CRM, segunda opinión, tareas programadas ni MCP.
// Solo fija la edición y carga la app completa; app/edicion.js decide qué se esconde.
process.env.CHOCOSYS_EDICION = 'terminales';
require('../../app/main.js');
