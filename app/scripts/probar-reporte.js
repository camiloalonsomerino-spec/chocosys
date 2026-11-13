// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';
// Prueba del tachado del reporte de fallos: node scripts/probar-reporte.js (sale con 1 si algo se filtra).
const assert = require('assert');
const { tachar, armar } = require('../reporte');

const quien = { usuario: 'pepita', equipo: 'PC-PEPITA' };
const sucio = [
  'abrí C:\\Users\\pepita\\Documents\\Cliente Uno\\informe.md y falló',
  'en git bash: /c/Users/pepita/proyectos/x',
  'otra: C:/Users/pepita/Mis Clientes/Obra Norte/plano.pdf; listo',
  'correo pepita.perez@correo.cl, rut 12.345.678-5, fono +56 9 1234 5678',
  'token: abcdef1234567890abcdef12 y sk-ant-api03-AAAAAAAAAAAAAAAAAAAA',
  '"password": "hunter22" · ghp_ABCDEFGHIJ0123456789',
  'usuario pepita en PC-PEPITA, %APPDATA%\\consola-agentes\\registro.txt'
].join('\n');
const limpio = tachar(sucio, quien);
for (const fuga of ['pepita', 'PEPITA', 'Cliente Uno', 'Uno', 'Norte', 'Clientes', 'correo.cl', '12.345.678', '1234 5678', 'abcdef1234567890', 'sk-ant', 'hunter22', 'ghp_', 'consola-agentes\\registro']) {
  assert(!limpio.includes(fuga), `se filtró «${fuga}»:\n${limpio}`);
}
assert(limpio.includes('<ruta>') && limpio.includes('<correo>') && limpio.includes('<rut>') && limpio.includes('<clave>'));
// Lo que no es dato personal queda: el texto común y las versiones.
assert(tachar('Chocosys 0.20.0 se cerró al abrir el CRM', quien) === 'Chocosys 0.20.0 se cerró al abrir el CRM');
// Prosa con «contraseña» o «token» sin «:» ni «=» no se tacha (la persona no podría corregirla: guardar vuelve a tachar).
assert(tachar('la contraseña nunca se guarda y el token vence hoy', quien) === 'la contraseña nunca se guarda y el token vence hoy');
// El usuario se tacha como palabra entera, también junto a letras con tilde: «ana» no toca «mañana» ni «Ánade».
assert(tachar('ana abrió mañana el Ánade de ana.', { usuario: 'ana', equipo: 'PC-X' }) === '<usuario> abrió mañana el Ánade de <usuario>.');

const r = armar({ version: '0.20.0', electron: '44.9.0', windows: '10.0', capturas: 1, paso: 'se cerró; escríbeme a a@b.cl', esperaba: 'que abra', pasos: '1. abrir', registro: 'error en D:\\x\\y', quien });
for (const t of ['# Reporte de fallo · Chocosys 0.20.0', '## Qué pasó', '## Qué esperabas', '## Pasos para repetirlo', '## Registro']) assert(r.includes(t), `falta «${t}»`);
assert(!r.includes('a@b.cl') && !r.includes('D:\\x'));
console.log('Tachado del reporte: 6 de 6 pruebas pasan.');
