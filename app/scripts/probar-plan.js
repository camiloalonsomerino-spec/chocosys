// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Prueba de las reglas del plan (plan.js): node scripts/probar-plan.js
const assert = require('assert');
const plan = require('../plan');

let pasan = 0;
const igual = (a, b, m) => { assert.deepStrictEqual(a, b, m); pasan++; };

// Sin plan, o con uno roto: como antes (sin límites).
igual(plan.actual(undefined).tipo, 'libre', 'sin plan');
igual(plan.actual('pro').tipo, 'libre', 'un texto no es un plan');
igual(plan.actual({ tipo: 'gratis' }).sesiones, 0, 'tipo desconocido = sin tope');

// Pro de fábrica y con el tope subido a conciencia.
const pro = plan.actual({ tipo: 'pro' });
igual([pro.sesiones, pro.modelo, pro.modelo_max, pro.agentes, pro.sala], [2, 'sonnet', 'sonnet', 2, false], 'Pro de fábrica');
const pro4 = plan.actual({ tipo: 'pro', sesiones: 4, sala: true });
igual([pro4.sesiones, pro4.sala, pro4.modelo], [4, true, 'sonnet'], 'Pro con tope subido');
igual(plan.actual({ tipo: 'pro', sesiones: 40, modelo: 'gpt', agentes: 0, sala: 'sí' }).sesiones, 2, 'valores inválidos no pasan');
igual(plan.actual({ tipo: 'pro', sesiones: 40, modelo: 'gpt', agentes: 0, sala: 'sí' }).sala, false, 'sala inválida no pasa');

// Ajuste de modelo y esfuerzo al abrir una sesión.
igual(plan.ajustar('', '', pro), { modelo: 'sonnet', esfuerzo: 'medium', bajado: false }, 'sin pedir nada: lo del plan');
igual(plan.ajustar('opus', 'xhigh', pro), { modelo: 'sonnet', esfuerzo: 'high', bajado: true }, 'Opus xhigh en Pro baja a Sonnet high');
igual(plan.ajustar('haiku', 'low', pro), { modelo: 'haiku', esfuerzo: 'low', bajado: false }, 'Haiku pasa igual');
const max20 = plan.actual({ tipo: 'max20' });
igual(plan.ajustar('opus', 'max', max20), { modelo: 'opus', esfuerzo: 'max', bajado: false }, 'Max 20x deja todo');
igual(plan.ajustar('', '', plan.actual()), { modelo: '', esfuerzo: '', bajado: false }, 'sin plan: no fija nada (Claude Code decide)');
igual(plan.ajustar('opus', '', plan.actual({ tipo: 'pro', modelo_max: 'opus' })).modelo, 'opus', 'Pro con Opus permitido a conciencia');

// Lo que se guarda: solo el tipo y lo distinto de fábrica.
igual(plan.paraGuardar({ tipo: 'pro', sesiones: 2, modelo: 'sonnet', sala: true }), { tipo: 'pro', sala: true }, 'guarda solo lo cambiado');
igual(plan.paraGuardar({ tipo: 'x', sesiones: 3 }), { tipo: 'libre', sesiones: 3 }, 'tipo inválido se guarda como libre');
igual(plan.paraGuardar({ tipo: 'max5', sesiones: 99 }), { tipo: 'max5' }, 'un valor inválido no se guarda');

console.log(`probar-plan: ${pasan} de ${pasan} pasan`);
