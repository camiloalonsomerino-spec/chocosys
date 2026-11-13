// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Tareas programadas de Chocosys (25-10-2026, pedido de quien usa la app: «crons como Hermes»). Este módulo no ejecuta nada:
// lee y guarda la lista, valida y entiende las horas. Qué hace cada tarea al llegar su hora lo decide main.js.
// La lista vive en los datos de quien usa Chocosys (programadas.json), nunca en el programa. Una tarea:
//   { id, nombre, cuando: '30 7 * * 1-5' (cron de 5 campos, hora local) | en: 'AAAA-MM-DD HH:MM' (una sola vez),
//     tipo: 'orden' | 'sesion' | 'receta', texto, sesion, carpeta, entorno, receta, simulacro, modelo, esfuerzo,
//     atrasada: 'correr' | 'saltar', activa, creada, ultima: { clave, hora, resultado, ok } }

const fs = require('fs');
const path = require('path');

const TIPOS = ['orden', 'sesion', 'receta'];
// Campo por campo: minuto, hora, día del mes, mes, día de la semana (0 o 7 = domingo).
const CAMPOS = [{ n: 'minuto', min: 0, max: 59 }, { n: 'hora', min: 0, max: 23 }, { n: 'día del mes', min: 1, max: 31 },
  { n: 'mes', min: 1, max: 12 }, { n: 'día de la semana', min: 0, max: 7 }];
// Una tarea atrasada (Chocosys estaba cerrada a su hora) se corre al abrir solo si no lleva más de esto.
const MAX_ATRASO_MS = 24 * 60 * 60 * 1000;

// '*/15', '1-5', '8,12,18', '9-17/2' → el conjunto de valores. Lanza un error en palabras si no se entiende.
function campo(texto, c) {
  const valores = new Set();
  for (const parte of String(texto).split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(parte.trim());
    if (!m) throw new Error(`«${parte}» no se entiende como ${c.n}.`);
    const desde = m[1] === '*' ? c.min : Number(m[2]);
    const hasta = m[1] === '*' ? c.max : (m[3] !== undefined ? Number(m[3]) : (m[4] ? c.max : desde));
    const paso = m[4] ? Number(m[4]) : 1;
    if (desde < c.min || hasta > c.max || desde > hasta || paso < 1) throw new Error(`«${parte}» se sale del rango de ${c.n} (${c.min} a ${c.max}).`);
    for (let v = desde; v <= hasta; v += paso) valores.add(c.n === 'día de la semana' && v === 7 ? 0 : v);
  }
  return valores;
}
function interpretar(cuando) {
  const partes = String(cuando || '').trim().split(/\s+/);
  if (partes.length !== 5) throw new Error('«cuando» lleva 5 campos: minuto hora día-del-mes mes día-de-la-semana (ej. «30 7 * * 1-5» = lunes a viernes a las 7:30).');
  const [mi, ho, dm, me, ds] = partes.map((p, i) => campo(p, CAMPOS[i]));
  // Como en cron: si se restringen el día del mes y el de la semana, basta con que calce uno.
  return { mi, ho, dm, me, ds, ambos: partes[2] !== '*' && partes[4] !== '*' };
}
function calza(c, f) {
  if (!c.mi.has(f.getMinutes()) || !c.ho.has(f.getHours()) || !c.me.has(f.getMonth() + 1)) return false;
  const d = c.dm.has(f.getDate()), s = c.ds.has(f.getDay());
  return c.ambos ? d || s : d && s;
}
// «2026-10-26 07:30» (hora local) → Date, o null.
function fechaUna(en) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(String(en || '').trim());
  if (!m) return null;
  const f = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(f.getTime()) ? null : f;
}
// La clave de un minuto, en hora local: así una tarea corre una sola vez por minuto aunque el reloj revise dos.
const clave = (f) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')} ${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}`;
const minuto = (f) => { const x = new Date(f); x.setSeconds(0, 0); return x; };

// La próxima hora en que toca, desde «desde» (excluido). Avanza saltando días y horas que no calzan; mira hasta 400 días.
function proxima(t, desde) {
  if (t.en) { const f = fechaUna(t.en); return f && f > desde ? f : null; }
  const c = interpretar(t.cuando);
  const f = minuto(desde); f.setMinutes(f.getMinutes() + 1);
  const tope = desde.getTime() + 400 * 24 * 60 * 60 * 1000;
  while (f.getTime() < tope) {
    const diaCalza = c.ambos ? (c.dm.has(f.getDate()) || c.ds.has(f.getDay())) : (c.dm.has(f.getDate()) && c.ds.has(f.getDay()));
    if (!c.me.has(f.getMonth() + 1) || !diaCalza) { f.setDate(f.getDate() + 1); f.setHours(0, 0); continue; }
    if (!c.ho.has(f.getHours())) { f.setHours(f.getHours() + 1, 0); continue; }
    if (c.mi.has(f.getMinutes())) return new Date(f);
    f.setMinutes(f.getMinutes() + 1);
  }
  return null;
}
// La última hora en que tocaba, entre «desde» (excluido) y «hasta» (incluido): para saber si quedó una atrasada.
function ultimaEntre(t, desde, hasta) {
  let f = proxima(t, desde), ultima = null;
  while (f && f <= hasta) { ultima = f; f = proxima(t, f); }
  return ultima;
}

// Valida lo que llega del MCP y devuelve la tarea limpia. Los errores van en palabras, para que quien la pide corrija.
function validar(d, existe) {
  const nombre = String(d.nombre || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!nombre) throw new Error('Falta «nombre»: corto, dice qué hace (ej. «Revisar la bandeja»).');
  if (!!d.cuando === !!d.en) throw new Error('Da «cuando» (se repite, cron de 5 campos) o «en» (una sola vez, «AAAA-MM-DD HH:MM»), uno de los dos.');
  if (d.cuando) interpretar(d.cuando);
  if (d.en && !fechaUna(d.en)) throw new Error('«en» va como «AAAA-MM-DD HH:MM», en hora local.');
  if (d.en && fechaUna(d.en) <= new Date()) throw new Error('«en» ya pasó: ' + d.en + '.');
  const tipo = String(d.tipo || '');
  if (!TIPOS.includes(tipo)) throw new Error('«tipo» es «orden» (le escribe a la central o a una sesión), «sesion» (abre una sesión nueva con la instrucción) o «receta» (lanza un flujo).');
  if (tipo !== 'receta' && !String(d.texto || '').trim()) throw new Error('Falta «texto»: la orden o la instrucción, completa y que se entienda sola.');
  if (tipo === 'receta' && !String(d.receta || '').trim()) throw new Error('Falta «receta»: el id de la receta.');
  if (tipo === 'sesion' && !d.carpeta && !d.entorno) throw new Error('Una tarea «sesion» necesita «carpeta» o «entorno».');
  const t = {
    id: existe ? existe.id : 'p' + Date.now().toString(36), nombre, tipo,
    activa: d.activa !== false, atrasada: d.atrasada === 'saltar' ? 'saltar' : 'correr',
    creada: existe ? existe.creada : new Date().toISOString()
  };
  if (d.cuando) t.cuando = String(d.cuando).trim().replace(/\s+/g, ' '); else t.en = String(d.en).trim();
  for (const k of ['texto', 'sesion', 'carpeta', 'entorno', 'receta', 'modelo', 'esfuerzo']) if (d[k]) t[k] = String(d[k]).trim();
  // Una receta programada corre en simulacro salvo que se diga lo contrario: lo que emite algo no corre solo.
  if (tipo === 'receta') t.simulacro = d.simulacro !== false;
  if (existe && existe.ultima) t.ultima = existe.ultima;
  return t;
}

function crear(archivo) {
  const leer = () => { try { const l = JSON.parse(fs.readFileSync(archivo, 'utf8')); return Array.isArray(l) ? l : []; } catch (e) { return []; } };
  const guardar = (lista) => {
    const tmp = archivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(lista, null, 2), 'utf8');
    fs.renameSync(tmp, archivo);
  };
  // Retirar no es borrar: la que se quita queda en programadas-retiradas.jsonl con la fecha.
  const retirar = (t) => fs.appendFileSync(path.join(path.dirname(archivo), 'programadas-retiradas.jsonl'), JSON.stringify(Object.assign({ retirada: new Date().toISOString() }, t)) + '\n', 'utf8');
  const buscar = (lista, ref) => { const r = String(ref || '').trim().toLowerCase(); return lista.find((t) => t.id === r) || lista.find((t) => t.nombre.toLowerCase() === r) || null; };
  return { leer, guardar, retirar, buscar };
}

module.exports = { crear, validar, interpretar, calza, proxima, ultimaEntre, fechaUna, clave, minuto, MAX_ATRASO_MS };
