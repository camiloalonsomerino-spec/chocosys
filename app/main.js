// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Proceso principal: una PTY por sesión de Claude Code, el servidor local que recibe
// los hooks y el estado que se guarda al cerrar. La ventana solo dibuja.

const { app, BrowserWindow, ipcMain, dialog, Notification, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const net = require('net');
const { execFileSync, spawn } = require('child_process');
const yaml = require('js-yaml');
const { leerRecetas, interpretarReceta, armarAcciones, ORIGENES, crearMotor, configurar: configurarFlujos, carpetaRecetas, ESFUERZOS, ESFUERZO_POR_DEFECTO, MODELOS_RECETA, MAX_AGENTES, TOPE_MIN, TOPE_MAX } = require('./flujos');
const accionesEstandar = require('./acciones');
const reporte = require('./reporte');
const tipografia = require('./tipografia');
const edicion = require('./edicion');
// Recursos del PC y el optimizador que sugiere (PRD-05, 02-11-2026).
const recursos = require('./recursos');

// Pruebas al lado de la consola en uso: --datos="<carpeta>" trae otro estado, otros hooks y otro candado de instancia.
const datosPrueba = process.argv.find((x) => x.startsWith('--datos='));
if (datosPrueba) {
  app.setPath('appData', datosPrueba.slice(8));
  app.setPath('userData', path.join(datosPrueba.slice(8), 'consola-agentes'));
}
const DATOS = path.join(app.getPath('appData'), 'consola-agentes');
const ARCHIVO_ESTADO = path.join(DATOS, 'estado.json');
const ARCHIVO_HOOKS = path.join(DATOS, 'hooks.json');
const ARCHIVO_CLASIFICACIONES = path.join(DATOS, 'clasificaciones.json');
const SKILL_COMPLEJIDAD = path.join(app.getPath('home'), '.claude', 'skills', 'clasificar-complejidad', 'SKILL.md');
const MODELOS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };
const { elegir: elegirModelo, palabras: palabrasDe } = require('./elegir-modelo');
const TOKEN = crypto.randomBytes(16).toString('hex');
// En el instalador (sprint 18), lo que corre fuera de Electron (hooks, statusLine, dueño de terminales, MCP) va suelto en
// app.asar.unpacked: node.exe y PowerShell no leen dentro del paquete. Corriendo desde la carpeta, es la misma ruta.
const deFuera = (...partes) => path.join(__dirname, ...partes).replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked');
// Quién usa esta Chocosys (sprint 18): su nombre y dónde guarda lo suyo viven en sus datos (perfil.json), no en el
// programa. Así el mismo programa sirve para cualquiera, sin llevar nombres ni rutas de nadie.
const ARCHIVO_PERFIL = path.join(DATOS, 'perfil.json');
// remote_control: «sueltas» (las que abres tú), «todas» (también las de flujos) o vacío (ninguna).
// central: { activa, carpeta, nombre, pestana, modelo, esfuerzo, tope }; con «activa», Chocosys abre al iniciar una sesión
// central con Remote Control que reparte el trabajo en las sesiones que hagan falta (ver «La central», junto al orquestador).
// «pestana» es la pestaña donde vive («Central» si no se dice); el menú «Sesión nueva» la abre aunque no esté activa.
const PERFIL_BASE = { nombre: '', responsables: [], pestanas_con_clientes: [], carpeta_recetas: '', carpeta_plantillas: '', orden_recetas: [], remote_control: '', central: null };
function perfil() {
  try { return Object.assign({}, PERFIL_BASE, JSON.parse(fs.readFileSync(ARCHIVO_PERFIL, 'utf8'))); } catch (e) { return Object.assign({}, PERFIL_BASE); }
}
const quien = () => perfil().nombre || 'quien usa Chocosys';
const carpetaRecetasPropias = () => perfil().carpeta_recetas || path.join(DATOS, 'recetas');
const carpetaPlantillasPropias = () => perfil().carpeta_plantillas || path.join(DATOS, 'plantillas');
// Edición propia del instalador (sprint 18): trae una semilla con perfil, recetas y plantillas. Se copia a los datos
// la primera vez, solo si no hay perfil; nunca pisa lo que ya existe.
function sembrarDatos() {
  const semilla = path.join(process.resourcesPath || '', 'datos-semilla');
  if (!app.isPackaged || !fs.existsSync(semilla) || fs.existsSync(ARCHIVO_PERFIL)) return;
  try {
    fs.cpSync(semilla, DATOS, { recursive: true, force: false, errorOnExist: false });
    registrar('datos sembrados desde la edición propia');
  } catch (e) { registrar('no se pudieron sembrar los datos', e.message); }
}

// ── Revisar instalación (sprint 18, P1): lo que Chocosys necesita y un botón para lo que falte ──
const ARCHIVO_CLAUDE_JSON = path.join(app.getPath('home'), '.claude.json');
const RUTA_MCP = () => deFuera('mcp', 'chocosys-mcp.js');
function mcpConectado() {
  try {
    const m = (JSON.parse(fs.readFileSync(ARCHIVO_CLAUDE_JSON, 'utf8')).mcpServers || {}).chocosys;
    return !!m && (m.args || []).some((a) => path.resolve(a) === path.resolve(RUTA_MCP()));
  } catch (e) { return false; }
}
ipcMain.handle('instalacion:revisar', () => {
  const nodeExe = buscar('node', 'C:\\Program Files\\nodejs\\node.exe');
  let version = '';
  if (claudeExe) { try { version = execFileSync(claudeExe, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 8000 }).trim(); } catch (e) { /* sin versión */ } }
  const conCarpeta = espacios.some((e) => e.carpeta && fs.existsSync(e.carpeta));
  return {
    empaquetada: app.isPackaged,
    claude: { ok: !!claudeExe, dice: claudeExe ? 'Instalado' + (version ? ': ' + version : '') : 'No lo encontré en este computador.' },
    node: { ok: !!nodeExe, dice: nodeExe ? 'Instalado.' : 'Lo usan los avisos de estado y la línea de modelo. Sin él, las terminales funcionan igual.' },
    mcp: { ok: mcpConectado(), dice: mcpConectado() ? 'Conectado.' : 'Para que una sesión pueda abrir otras y la orquesta funcione. Escribe en tu configuración de Claude Code.' },
    sala: { ok: fs.existsSync(path.join(app.getPath('home'), '.claude', 'skills', 'sala-directiva', 'SKILL.md')), dice: 'La «Segunda opinión» usa la skill sala-directiva (en ~\\.claude\\skills). Sin ella, el resto funciona igual.' },
    pestana: { ok: conCarpeta, dice: conCarpeta ? 'Tienes una pestaña con su carpeta.' : 'Crea una pestaña y elige su carpeta de trabajo (con «+» arriba).' }
  };
});
// Conectar el MCP lo pide la persona con un clic: escribe en su configuración de Claude Code (--scope user).
ipcMain.handle('instalacion:conectar-mcp', () => {
  const nodeExe = buscar('node', 'C:\\Program Files\\nodejs\\node.exe');
  if (!claudeExe || !nodeExe) return { ok: false, motivo: 'Falta Claude Code o Node.js.' };
  try {
    try { execFileSync(claudeExe, ['mcp', 'remove', '--scope', 'user', 'chocosys'], { windowsHide: true, timeout: 20000, stdio: 'ignore' }); } catch (e) { /* no estaba */ }
    execFileSync(claudeExe, ['mcp', 'add', '--scope', 'user', 'chocosys', '--', nodeExe, RUTA_MCP()], { windowsHide: true, timeout: 20000, encoding: 'utf8' });
    registrar('mcp conectado', RUTA_MCP());
    return { ok: mcpConectado() };
  } catch (e) { return { ok: false, motivo: e.message.slice(0, 200) }; }
});
ipcMain.handle('instalacion:abrir', (e, que) => {
  const urls = { node: 'https://nodejs.org/es/download', claude: 'https://code.claude.com/docs/en/setup' };
  if (urls[que]) shell.openExternal(urls[que]);
});

// Recetas y plantillas propias, y las variables de las recetas ({nombre}, {salas}, {skill_sala}). Se llama al abrir.
function configurarLoPropio() {
  configurarFlujos({
    recetas: carpetaRecetasPropias(),
    variables: { nombre: quien(), salas: carpetaSalas(), skill_sala: path.join(app.getPath('home'), '.claude', 'skills', 'sala-directiva') },
    acciones: listaAcciones
  });
  require('./crm/crm').configurarPlantillas(carpetaPlantillasPropias());
}

let ventana = null;
let puerto = 0;
let seleccionada = null;
let claudeExe = null;
const sesiones = new Map();
const procesos = new Map();

// Registro de diagnóstico: %APPDATA%\consola-agentes\registro.txt (sin el texto de las sesiones).
// Pasados 5 MB, el registro se rota a registro.1.txt (se guarda solo uno anterior).
let registroLineas = 0;
function registrar(...partes) {
  const archivo = path.join(DATOS, 'registro.txt');
  try {
    if (++registroLineas % 200 === 1 && fs.existsSync(archivo) && fs.statSync(archivo).size > 5 * 1024 * 1024) {
      fs.renameSync(archivo, path.join(DATOS, 'registro.1.txt'));
    }
    fs.appendFileSync(archivo, new Date().toISOString() + ' ' + partes.join(' ') + '\n', 'utf8');
  } catch (e) { /* sin registro */ }
}

function buscar(programa, respaldo) {
  try {
    const salida = execFileSync('where.exe', [programa], { encoding: 'utf8', windowsHide: true });
    // Solo .exe: Node 26 no lanza un .cmd sin shell (EINVAL) y con shell un salto de línea en un argumento corta la orden.
    const primera = salida.split(/\r?\n/).find((l) => l.trim() && /\.exe$/i.test(l.trim()));
    if (primera) return primera.trim();
  } catch (e) { /* no está en el PATH */ }
  return respaldo && fs.existsSync(respaldo) ? respaldo : null;
}

// Los hooks entran por --settings en cada sesión: la configuración global de Claude no se toca.
function escribirHooks(nodeExe) {
  const n = nodeExe.replace(/\\/g, '/');
  const h = deFuera('hook.js').replace(/\\/g, '/');
  const orden = (evento, extra) => Object.assign({ type: 'command', command: `"${n}" "${h}" ${evento}`, timeout: 5 }, extra);
  const hooks = {
    SessionStart: [{ hooks: [orden('SessionStart')] }],
    UserPromptSubmit: [{ hooks: [orden('UserPromptSubmit')] }],
    PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [orden('PreToolUse')] }],
    // Corre en cada herramienta: en segundo plano, para que Claude no espere a que arranque node.exe.
    PostToolUse: [{ matcher: '*', hooks: [orden('PostToolUse', { async: true })] }],
    Notification: [{ hooks: [orden('Notification')] }],
    Stop: [{ hooks: [orden('Stop')] }],
    SubagentStart: [{ hooks: [orden('SubagentStart', { async: true })] }],
    SubagentStop: [{ hooks: [orden('SubagentStop', { async: true })] }]
  };
  // La statusLine (sprint 15) da modelo, esfuerzo, contexto, costo y uso del plan, y solo corre cuando algo cambia.
  const statusLine = { type: 'command', command: `"${n}" "${deFuera('linea.js').replace(/\\/g, '/')}"`, padding: 0 };
  fs.writeFileSync(ARCHIVO_HOOKS, JSON.stringify({ hooks, statusLine }, null, 2), 'utf8');
}

// Si la consola se abrió desde otra sesión de Claude, cada proceso nuevo debe ser independiente:
// con estas marcas heredadas, Claude no guarda la conversación y después no se puede retomar.
function entornoLimpio(extra) {
  const entorno = Object.assign({}, process.env, extra || {});
  delete entorno.ELECTRON_RUN_AS_NODE;
  for (const clave of ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SESSION_ID']) {
    delete entorno[clave];
  }
  return entorno;
}

// Modelo y esfuerzo de una etapa: le pregunta a Haiku con la skill clasificar-complejidad.
// El veredicto se guarda por clave (la tarea sin la carpeta): no se vuelve a preguntar.
// Si algo falla, Opus en xhigh: ante la duda, el modelo que no se equivoca por falta de juicio.
const DUDA = { modelo: 'opus', esfuerzo: 'xhigh', regla: 'duda', motivo: 'No se pudo clasificar; ante la duda, Opus.' };
function clasificar(clave, tarea) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(ARCHIVO_CLASIFICACIONES, 'utf8')); } catch (e) { /* vacío */ }
  if (cache[clave]) return Promise.resolve(cache[clave]);
  let rubrica = '';
  try { rubrica = fs.readFileSync(SKILL_COMPLEJIDAD, 'utf8').replace(/^---[\s\S]*?---\s*/, ''); } catch (e) { return Promise.resolve(DUDA); }
  if (!claudeExe) return Promise.resolve(DUDA);
  const pregunta = `${rubrica}\n\n---\n\nAplica la skill de arriba a esta tarea y responde solo el JSON del paso 4.\n\nTAREA:\n${tarea}\n`;
  return new Promise((resolver) => {
    const proceso = require('child_process').spawn(claudeExe, ['-p', '--model', MODELOS.haiku, '--effort', 'low', ...(mcpPorSesion() ? ['--strict-mcp-config'] : [])], {
      cwd: DATOS, env: entornoLimpio(), windowsHide: true
    });
    let salida = '';
    const tope = setTimeout(() => { try { proceso.kill(); } catch (e) { /* ya cerró */ } }, 90000);
    proceso.stdout.on('data', (c) => { salida += c; });
    proceso.on('error', () => { clearTimeout(tope); resolver(DUDA); });
    proceso.on('close', () => {
      clearTimeout(tope);
      let v = null;
      try { v = JSON.parse((salida.match(/\{[\s\S]*\}/) || [''])[0]); } catch (e) { v = null; }
      if (!v || !v.modelo) { registrar('clasificación sin JSON', clave); resolver(DUDA); return; }
      const modelo = /haiku/i.test(v.modelo) ? 'haiku' : 'opus';
      const veredicto = {
        modelo,
        esfuerzo: ESFUERZOS.includes(v.esfuerzo) ? v.esfuerzo : ESFUERZO_POR_DEFECTO[modelo],
        regla: String(v.regla || '').slice(0, 20),
        motivo: String(v.motivo || '').slice(0, 240)
      };
      cache[clave] = veredicto;
      try { fs.writeFileSync(ARCHIVO_CLASIFICACIONES, JSON.stringify(cache, null, 2), 'utf8'); } catch (e) { /* sin caché */ }
      resolver(veredicto);
    });
    proceso.stdin.end(pregunta);
  });
}

// Espacios: cada uno agrupa sus sesiones y flujos en su propio lienzo (PRD-03).
let espacios = [];
let espacioActual = null;
const espacioPorId = (id) => espacios.find((e) => e.id === id) || null;
const nombreEspacio = (id) => (espacioPorId(id) || {}).nombre || null;
// Sprint 25 (H1, D2): sin nombre ya no nace «General»; «entorno» es el nombre de un entorno de entornos.json o vacío.
function nuevoEspacio(nombre, carpeta, entorno) {
  const limpio = String(nombre || '').trim().slice(0, 40);
  const e = { id: 'e' + crypto.randomBytes(4).toString('hex'), nombre: limpio || `Espacio ${espacios.length + 1}`, carpeta: carpeta || '', vista: null };
  if (entorno) e.entorno = String(entorno);
  espacios.push(e);
  return e;
}
// Sprint 25 (H1, D3): la pestaña de lo que llega sin una. En orden: la del entorno pedido; la que ya tiene esa misma
// carpeta; la del entorno cuya carpeta contiene a esta (la más honda: «Sistema» contiene a todas); si no, una pestaña
// nueva con el último tramo de la carpeta. Una pestaña de entorno que falta se crea con la carpeta del entorno.
const rutaComparable = (c) => (c ? path.resolve(String(c)).replace(/[\\/]+$/, '').toLowerCase() : '');
function espacioPara(carpeta, entorno) {
  const entornos = leerEntornos();
  const deEntorno = (ent) => espacios.find((x) => (x.entorno || '').toLowerCase() === ent.nombre.toLowerCase())
    || espacios.find((x) => x.nombre.toLowerCase() === ent.nombre.toLowerCase())
    || nuevoEspacio(ent.nombre, ent.existe ? ent.carpeta : '', ent.nombre);
  const pedido = entorno ? entornos.find((x) => x.nombre.toLowerCase() === String(entorno).toLowerCase()) : null;
  if (pedido) return deEntorno(pedido);
  const c = rutaComparable(carpeta);
  if (c) {
    const igual = espacios.find((x) => rutaComparable(x.carpeta) === c);
    if (igual) return igual;
    const dentro = entornos.filter((x) => { const r = rutaComparable(x.carpeta); return r && (c === r || c.startsWith(r + path.sep)); })
      .sort((a, b) => rutaComparable(b.carpeta).length - rutaComparable(a.carpeta).length)[0];
    if (dentro) return deEntorno(dentro);
  }
  return nuevoEspacio(carpeta ? path.basename(path.resolve(String(carpeta))) : '', carpeta ? String(carpeta) : '');
}

// estado.json se escribe primero en un temporal y después se renombra (un corte a mitad no lo deja roto),
// y la versión anterior queda en estado.anterior.json. Si el principal no se puede leer, se usa el anterior.
const ARCHIVO_ESTADO_ANTERIOR = ARCHIVO_ESTADO.replace(/\.json$/, '.anterior.json');
function leerEstado() {
  for (const archivo of [ARCHIVO_ESTADO, ARCHIVO_ESTADO_ANTERIOR]) {
    try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); }
    catch (e) { if (fs.existsSync(archivo)) registrar('estado ilegible', path.basename(archivo), e.message); }
  }
  return null;
}
function cargarEstado() {
  const datos = leerEstado();
  if (datos) {
    // «antes» guarda el estado para la que siga viva en el dueño de terminales (reconectarVivas).
    for (const s of datos.sesiones || []) sesiones.set(s.id, Object.assign({}, s, { estado: 'pausa', viva: false, mensaje: '', subagentes: [], antes: { estado: s.estado, mensaje: s.mensaje } }));
    motor.importar(datos.flujos);
    espacios = Array.isArray(datos.espacios) ? datos.espacios : [];
    espacioActual = datos.espacioActual || null;
  }
  // Sprint 25 (H1): cero pestañas es válido (la ventana muestra el Inicio); ya no se crea «General».
  if (!espacioPorId(espacioActual)) espacioActual = espacios.length ? espacios[0].id : null;
  // Lo que quedó sin espacio válido cae en la pestaña de su carpeta (D3), que se crea si falta.
  for (const s of sesiones.values()) if (!espacioPorId(s.espacio)) s.espacio = espacioPara(s.carpeta).id;
  for (const f of motor.todos()) if (!espacioPorId(f.espacio)) f.espacio = espacioPara(f.carpeta).id;
  // Una sesión de flujo vive en la pestaña de su flujo (antes del 22-10-2026 caía en la que estuviera a la vista).
  for (const s of sesiones.values()) { const f = s.flujo && motor.obtener(s.flujo); if (f && f.espacio && s.espacio !== f.espacio) s.espacio = f.espacio; }
  // Los flujos que ya venían completos no se vuelven a anotar en el log.md (sprint 20, H5).
  sembrarFlujosVistos();
}

let guardadoPendiente = null;
function guardarYa() {
  clearTimeout(guardadoPendiente);
  guardadoPendiente = null;
  try {
    const lista = [...sesiones.values()].map((s) => Object.assign(publica(s), { sessionId: s.sessionId, instruccion: s.instruccion || '' }, s.conversacion ? { conversacion: s.conversacion } : {}, s.guiaEntorno ? { guiaEntorno: s.guiaEntorno } : {}, s.turnos ? { turnos: s.turnos } : {}, s.entrevista ? { entrevista: s.entrevista } : {}));
    const texto = JSON.stringify({ sesiones: lista, flujos: motor.guardable(), espacios, espacioActual }, null, 2);
    const temporal = ARCHIVO_ESTADO + '.tmp';
    fs.writeFileSync(temporal, texto, 'utf8');
    if (fs.existsSync(ARCHIVO_ESTADO)) fs.copyFileSync(ARCHIVO_ESTADO, ARCHIVO_ESTADO_ANTERIOR);
    fs.renameSync(temporal, ARCHIVO_ESTADO);
  } catch (e) { registrar('no se pudo guardar el estado', e.message); }
}
function guardar() {
  clearTimeout(guardadoPendiente);
  guardadoPendiente = setTimeout(guardarYa, 300);
}

// Tras /clear o /resume Claude Code sigue en otra conversación: «conversacion» es la vigente y sessionId, la que lleva
// el proceso en su línea de comando (por ella lo reconoce recursos).
const conversacionDe = (s) => s.conversacion || s.sessionId;
// Dos sesiones con el mismo identificador partirían con la misma línea de comando, y cerrar una cerraría a la otra.
const laTieneOtra = (s, id) => [...sesiones.values()].some((x) => x !== s && (x.sessionId === id || x.conversacion === id));

function publica(s) {
  return {
    id: s.id, nombre: s.nombre, carpeta: s.carpeta, estado: s.estado, viva: s.viva,
    iniciada: s.iniciada, mensaje: s.mensaje || '', ultimo: s.ultimo || '', cambio: s.cambio, creada: s.creada,
    flujo: s.flujo || null, etapa: s.etapa, traspaso: s.traspaso || '', soloLectura: !!s.soloLectura, web: !!s.web, listo: !!s.listo,
    modelo: s.modelo || '', esfuerzo: s.esfuerzo || '', espacio: s.espacio || null, pos: s.pos || null,
    subagentes: s.subagentes || [], linea: s.linea || null, cambioPendiente: s.cambioPendiente || null,
    coordinador: s.coordinador || null, orquesta: s.orquesta || null, fija: !!s.fija,
    central: !!s.central, enlaces: s.enlaces || [], mcp: s.mcp || []
  };
}

function enviar(canal, datos) {
  if (ventana && !ventana.isDestroyed()) ventana.webContents.send(canal, datos);
}

// Salida reciente de cada sesión (29-10-2026, ficha 05): al recargar la interfaz la terminal nace vacía y Claude Code no
// redibuja lo que ya había mostrado. Se guarda lo último (SALIDA_MAX) y se repone cuando la página termina de cargar;
// mientras carga, lo que llega solo se guarda (si no, se perdía o se duplicaba con la reposición).
// shortcut: el corte puede dejar media secuencia de control al comienzo; se recorta hasta el primer salto de línea.
const SALIDA_MAX = 200 * 1024;
const salidaReciente = new Map();
let ventanaLista = false;
function datosPty(id, datos) {
  let t = (salidaReciente.get(id) || '') + datos;
  if (t.length > SALIDA_MAX * 1.25) {
    t = t.slice(-SALIDA_MAX);
    const i = t.indexOf('\n');
    if (i >= 0 && i < 4096) t = t.slice(i + 1);
  }
  salidaReciente.set(id, t);
  if (ventanaLista) enviar('pty:datos', { id, datos });
}
function reponerSalidas() {
  ventanaLista = true;
  for (const [id, datos] of salidaReciente) if (sesiones.has(id) && datos) enviar('pty:datos', { id, datos });
}

// El uso del plan (5 horas y semana) es de la cuenta, no de una sesión: se guarda el último que llegó de cualquiera.
let plan = { cinco: null, semana: null };
function difundir() {
  enviar('sesiones', { sesiones: [...sesiones.values()].map(publica), flujos: motor.exportar(), espacios, espacioActual, plan });
}

function escribirEn(id, texto) {
  const p = procesos.get(id);
  if (!p) { registrar('no se pudo escribir: sesión cerrada', id); return false; }
  p.write(texto);
  // Enter aparte: si llega pegado al texto, Claude lo toma como parte de lo pegado.
  setTimeout(() => { if (procesos.has(id)) p.write('\r'); }, 200);
  return true;
}

function mostrarVentana() {
  if (!ventana) return;
  if (ventana.isMinimized()) ventana.restore();
  ventana.show();
  ventana.focus();
}
function notificar(titulo, cuerpo, aElegir) {
  if (ventana && !ventana.isFocused()) ventana.flashFrame(true);
  if (!Notification.isSupported()) return;
  const aviso = new Notification({ title: titulo, body: cuerpo });
  aviso.on('click', () => { mostrarVentana(); enviar('seleccionar', aElegir); });
  aviso.show();
}

// Primero lo que cuelga de su claude.exe (servidores MCP, scripts, cálculos) y después claude.exe, en la misma orden «k»:
// matar solo claude.exe dejaba esos procesos vivos y sin dueño (prueba del 02-11-2026), y desde el 03-11-2026 la terminal
// sale sola cuando «k» termina, así que una sesión reabierta (cambio de modelo) nunca cae bajo un «k» atrasado. Si «k» no
// alcanza a empezar en 15 s se cancela y la terminal se cierra igual; si empezó, su propio tope de 20 s lo corta.
// conservar: 'ocupados' (lo que gasta CPU queda vivo), [] (corta todo) o la lista de preguntarCierre.
// El tope de 15 s es solo para cambiar el modelo (conTope): al cerrar se espera siempre el turno, porque con muchas
// sesiones (quitar una sala) las «k» en fila se cancelaban y sus MCP quedaban huérfanos (auditoría 13-11-2026, 13).
function matarConArbol(s, p, conservar = 'ocupados', conTope = false) {
  const matar = () => { try { p.kill(); } catch (e) { /* ya cerró */ } };
  if (!s || !s.sessionId) { matar(); return; }
  const senal = {};
  const tope = conTope ? setTimeout(() => { if (!senal.empezo) { senal.cancelada = true; matar(); } }, 15000) : null;
  recursos.cerrarArbol(s.sessionId, conservar, senal).then((r) => registrar('árbol cerrado', s.id, r.raices, r.cerrados, r.nombres, r.quedan ? 'quedan vivos: ' + r.quedan : ''))
    .catch((e) => registrar('árbol sin cerrar', s.id, e.message)).finally(() => { clearTimeout(tope); matar(); });
}

// Decisión de quien usa la app (03-11-2026): si la sesión tiene un cálculo vivo (algo suyo gasta CPU), cerrarla o cambiarle el modelo
// pregunta antes, con «Cancelar» por defecto. Devuelve qué conservar ([] corta todo) o null si se canceló.
const describirCalculo = (v) => v.map((p) => `${p.nombre} (${String(Math.round(p.nucleos * 10) / 10).replace('.', ',')} núcleos)`).join(', ');
async function preguntarCierre(s, accion) {
  let vivos = [];
  try { vivos = (await recursos.calculoVivo([s.sessionId])).get(s.sessionId) || []; } catch (e) { registrar('cálculo vivo sin leer', s.id, e.message); }
  if (!vivos.length) return [];
  const modelo = accion === 'modelo';
  const o = { type: 'warning', title: 'Chocosys', noLink: true, defaultId: 0, cancelId: 0,
    buttons: ['Cancelar', modelo ? 'Cambiar el modelo y cortar el cálculo' : 'Cerrar y cortar el cálculo', modelo ? 'Cambiar el modelo y dejar el cálculo corriendo' : 'Cerrar la sesión y dejar el cálculo corriendo'],
    message: `«${s.nombre}» tiene un cálculo corriendo: ${describirCalculo(vivos)}.`,
    detail: 'Cortarlo lo cierra a medias. Si lo dejas corriendo, sigue solo y el panel de recursos lo muestra como resto de esta sesión, para cerrarlo cuando termine.' };
  const r = await (ventana ? dialog.showMessageBox(ventana, o) : dialog.showMessageBox(o));
  registrar('cálculo vivo', s.id, accion, ['cancelado', 'cortar', 'dejar'][r.response], describirCalculo(vivos));
  if (r.response === 2) for (const p of vivos) recuerdoRecursos.set(p.pid + ':' + p.inicio, { id: s.id, nombre: s.nombre });
  return r.response === 1 ? [] : r.response === 2 ? vivos : null;
}

// Cerrar una sesión: su proceso y su registro. La usan el motor, «Quitar» un flujo y la × de la ventana. Sin «conservar»
// (motor, flujos, borrar un espacio) deja vivo lo que esté gastando CPU: nunca corta un cálculo sin preguntar.
function cerrarSesion(id, conservar = 'ocupados') {
  const p = procesos.get(id);
  const s = sesiones.get(id);
  if (p) matarConArbol(s, p, conservar);
  procesos.delete(id);
  sesiones.delete(id);
  salidaReciente.delete(id);
  if (seleccionada === id) seleccionada = null;
  for (const x of sesiones.values()) if (x.enlaces && x.enlaces.includes(id)) x.enlaces = x.enlaces.filter((e) => e !== id);
}

const motor = crearMotor({
  sesiones,
  nuevaSesion: (carpeta, instruccion, extra) => nuevaSesion(carpeta, instruccion, extra),
  abrir: (id) => abrirAlMedir(id, 120, 32),
  escribir: escribirEn,
  cambio: () => { difundir(); guardar(); revisarFlujosCompletos(); },
  avisarPuerta: (f, it) => notificar(`${f.nombre}: una puerta espera tu OK`, it.nombre, 'p:' + f.id),
  clasificar: (clave, tarea) => clasificar(clave, tarea),
  cerrarSesiones: (ids) => { for (const id of ids || []) cerrarSesion(id); },
  registrar
});

function cambiarEstado(s, estado, mensaje) {
  const antes = s.estado;
  s.estado = estado;
  if (mensaje !== undefined) s.mensaje = mensaje;
  if (antes !== estado) s.cambio = Date.now();
  difundir();
  guardar();
  if (estado === 'necesita' && antes !== 'necesita') avisar(s);
}

function avisar(s) {
  const aLaVista = ventana && ventana.isFocused() && seleccionada === s.id;
  if (aLaVista) return;
  notificar(`${s.nombre} te necesita`, s.mensaje || 'Espera tu respuesta', s.id);
}

function recortar(texto, largo) {
  if (typeof texto !== 'string') return '';
  const limpio = texto.replace(/\s+/g, ' ').trim();
  return limpio.length > largo ? limpio.slice(0, largo - 1) + '…' : limpio;
}

function esAvisoDeTarea(prompt) {
  return typeof prompt === 'string' && prompt.trimStart().startsWith('<task-notification>');
}

function traducir(mensaje) {
  const m = typeof mensaje === 'string' ? mensaje : '';
  const uso = m.match(/needs your permission to use (.+)$/i);
  if (uso) return recortar('Pide permiso para usar ' + uso[1], 140);
  if (/needs your permission/i.test(m)) return 'Pide permiso';
  if (/needs your attention/i.test(m)) return 'Necesita tu atención';
  return recortar(m, 140) || 'Te necesita';
}

function alHook(m) {
  // La statusLine llega seguido: no va al registro.
  // PostToolUse llega por cada herramienta de cada sesión: no se anota (escritura síncrona; AUDITORIA-2 H4, 03-11-2026).
  if (m.evento !== 'Linea' && m.evento !== 'PostToolUse') registrar('hook', m.evento, m.panel, (m.datos && m.datos.notification_type) || '');
  const s = sesiones.get(m.panel);
  if (!s) return;
  const d = m.datos || {};
  if (m.evento === 'Linea') {
    const l = { modelo: String(d.modelo || ''), esfuerzo: String(d.esfuerzo || ''), contexto: typeof d.contexto === 'number' ? Math.round(d.contexto) : null, costo: typeof d.costo === 'number' ? d.costo : null };
    const nuevoPlan = { cinco: d.cinco || plan.cinco, semana: d.semana || plan.semana };
    const cambio = JSON.stringify(l) !== JSON.stringify(s.linea || null) || JSON.stringify(nuevoPlan) !== JSON.stringify(plan);
    s.linea = l;
    // El costo del turno que acaba de terminar llega acá, después del Stop: completa la fila que espera (T-A92).
    if (s.corridaPendiente && l.costo != null) s.corridaPendiente.costoFin = l.costo;
    plan = nuevoPlan;
    if (cambio) difundir();
    return;
  }
  // El registro de la sesión (para la lista «trabajando» y los subagentes): lo dice cualquier aviso de la sesión madre, no los de sus subagentes.
  if (d.transcript_path && !d.agent_id) s.transcript = d.transcript_path;
  // PostToolUse llega en segundo plano y puede caer después de un /clear con la conversación anterior: no cuenta.
  if (!d.agent_id && m.evento !== 'PostToolUse' && recursos.UUID.test(d.session_id) && d.session_id !== conversacionDe(s) && !laTieneOtra(s, d.session_id)) {
    s.conversacion = d.session_id;
    registrar('conversación', s.id, d.session_id, d.source || '');
    guardar();
  }
  // Para saber si una sesión de una orquesta se trabó: cualquier aviso cuenta como movimiento.
  s.actividad = Date.now();
  s.avisadaTrabada = false;
  switch (m.evento) {
    case 'SubagentStart':
      if (!d.agent_id) break;
      s.subagentes = (s.subagentes || []).filter((x) => x.id !== d.agent_id);
      s.subagentes.push({ id: d.agent_id, tipo: d.agent_type || 'agente', tarea: '', inicio: Date.now(), fin: 0, estado: 'trabajando', ultimo: '' });
      difundir();
      break;
    case 'SubagentStop': {
      const x = (s.subagentes || []).find((a) => a.id === d.agent_id);
      if (!x) break;
      x.estado = 'volvio';
      x.fin = Date.now();
      x.ultimo = recortar(d.last_assistant_message, 200);
      difundir();
      break;
    }
    case 'SessionStart':
      if (['startup', 'resume', 'clear', undefined].includes(d.source)) cambiarEstado(s, 'pausa', '');
      break;
    case 'UserPromptSubmit':
      // En un flujo, lo útil de ver es la tarea, no el contexto que se repite en todas las etapas.
      // El turno que abre Claude Code cuando vuelve un subagente en segundo plano trae `<task-notification>` como
      // prompt: no es una orden de quien usa la app, así que la última orden sigue siendo la de antes (arreglo T-A96).
      if (!esAvisoDeTarea(d.prompt)) {
        s.ultimo = recortar(typeof d.prompt === 'string' && d.prompt.includes('— Tu tarea: ') ? d.prompt.split('— Tu tarea: ').pop() : d.prompt, 120);
      }
      s.listo = false;
      // Los que volvieron hace más de 10 minutos salen. No antes: cuando un subagente en segundo plano termina, Claude Code
      // abre un turno para avisarlo, y borrarlo ahí escondería justo el «volvió». Como mucho, los 8 más nuevos.
      s.subagentes = (s.subagentes || []).filter((x) => x.estado === 'trabajando' || Date.now() - x.fin < 10 * 60 * 1000).slice(-8);
      escribirCorrida(s);
      s.inicioTurno = Date.now();
      s.costoInicio = s.linea && s.linea.costo != null ? s.linea.costo : null;
      cambiarEstado(s, 'trabajando', '');
      // Una coordinadora que guardó avisos mientras esperaba a quien usa la app los recibe ahora (T-A97); Claude Code los encola.
      if (s.avisosPendientes && s.avisosPendientes.length) setTimeout(() => soltarAvisos(s), 300);
      break;
    case 'PostToolUse':
      // Llega en segundo plano y puede caer después del Stop; un turno nuevo parte con UserPromptSubmit.
      if (s.estado !== 'trabajando' && s.estado !== 'termino') cambiarEstado(s, 'trabajando', '');
      break;
    case 'PreToolUse':
      // Solo la pregunta de la sesión misma: la de un subagente interno de Claude Code no llega a la terminal (prueba
      // del sprint 16: la sesión quedaba en «te necesita» sin preguntar nada).
      if (d.agent_id) break;
      cambiarEstado(s, 'necesita', 'Te hace una pregunta');
      if (s.coordinador) avisarCoordinadora(s, 'espera una respuesta (hizo una pregunta en su terminal)');
      break;
    case 'Notification':
      // «Esperando tu respuesta» después de terminar no es una alarma: ya está en Terminó.
      if (d.notification_type === 'idle_prompt' || /waiting for your input/i.test(d.message || '')) return;
      // Una pregunta ya avisó con su propio texto; el aviso genérico que llega después no la pisa.
      if (s.estado === 'necesita' && s.mensaje === 'Te hace una pregunta') return;
      // Una sesión de una orquesta que pide permiso también se lo dice a su coordinadora, una vez (T-A97, observación 2).
      if (s.coordinador && s.estado !== 'necesita') { cambiarEstado(s, 'necesita', traducir(d.message)); avisarCoordinadora(s, 'espera un permiso en su terminal'); break; }
      cambiarEstado(s, 'necesita', traducir(d.message));
      break;
    case 'Stop':
      // Un Stop recuperado por el vigilante trae la hora del cierre: la fila mide hasta ahí, no la espera (T-C93).
      s.cierreTurno = typeof d.cierre === 'number' ? d.cierre : 0;
      registrarCorrida(s);
      // Turnos trabajados: al cerrarla, una sesión con al menos uno se anota en el log.md de su entorno (sprint 20, H5).
      s.turnos = (s.turnos || 0) + 1;
      cambiarEstado(s, 'termino', '');
      if (s.coordinador) { const r = registroDe(s); avisarCoordinadora(s, 'terminó: «' + recortar(((r && colaDe(r)) || {}).dijo, 160) + '»'); }
      if (s.flujo) motor.alTerminar(s);
      // Un cambio de modelo pedido mientras trabajaba se aplica ahora, que quedó quieta.
      // Los avisos que una coordinadora guardó mientras esperaba a quien usa la app salen ahora que quedó quieta (T-A97). Si además
      // cambia de modelo, después de que vuelva a abrir.
      if (s.avisosPendientes && s.avisosPendientes.length) setTimeout(() => soltarAvisos(s), s.cambioPendiente ? 6000 : 300);
      if (s.cambioPendiente) { const c = s.cambioPendiente; s.cambioPendiente = null; setTimeout(() => cambiarModeloPreguntando(s, c.modelo, c.esfuerzo), 1200); }
      break;
  }
}

function iniciarServidor() {
  return new Promise((resolver) => {
    const servidor = http.createServer((req, res) => {
      // /mcp/<acción>: lo que pide el servidor MCP de Chocosys (mcp/chocosys-mcp.js), con el mismo token.
      if (req.method === 'POST' && req.url.startsWith('/mcp/') && req.headers['x-consola-token'] === TOKEN) {
        let cuerpo = '';
        req.on('data', (c) => { cuerpo += c; if (cuerpo.length > 2000000) req.destroy(); });
        req.on('end', async () => {
          let respuesta;
          try { respuesta = { ok: true, datos: await atenderMcp(req.url.slice(5), cuerpo ? JSON.parse(cuerpo) : {}) }; }
          catch (err) { respuesta = { ok: false, error: err.message }; }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(respuesta));
        });
        return;
      }
      if (req.method !== 'POST' || req.url !== '/estado' || req.headers['x-consola-token'] !== TOKEN) {
        res.writeHead(404);
        res.end();
        return;
      }
      let cuerpo = '';
      req.on('data', (c) => { cuerpo += c; if (cuerpo.length > 100000) req.destroy(); });
      req.on('end', () => {
        res.writeHead(204);
        res.end();
        try { alHook(JSON.parse(cuerpo)); } catch (e) { /* hook mal formado: se ignora */ }
      });
    });
    servidor.listen(0, '127.0.0.1', () => resolver(servidor.address().port));
  });
}

// ── Terminales: las tiene terminales.js, aparte, para que reiniciar la consola no corte a las sesiones (sprint 12) ──
// Un tubo por carpeta de datos: la consola de prueba (--datos) tiene su propio dueño de terminales.
const TUBO = '\\\\.\\pipe\\chocosys-terminales-' + crypto.createHash('sha1').update(DATOS.toLowerCase()).digest('hex').slice(0, 12);
let tubo = null;
const pendientes = [];
let vivasAlConectar = [];
let conectando = false;

// Si el dueño de terminales murió, la próxima orden lo lanza de nuevo.
function aTerminales(m) {
  if (tubo) { tubo.write(JSON.stringify(m) + '\n'); return; }
  pendientes.push(m);
  if (!conectando) conectarTerminales();
}

// Lo mismo que ofrecía la PTY de node-pty, pero cada orden viaja por el tubo.
function terminalRemota(id) {
  return {
    alDato: () => {}, alSalir: () => {},
    onData(fn) { this.alDato = fn; },
    onExit(fn) { this.alSalir = fn; },
    write(datos) { aTerminales({ tipo: 'escribir', id, datos }); },
    resize(cols, rows) { aTerminales({ tipo: 'tamano', id, cols, rows }); },
    kill() { aTerminales({ tipo: 'matar', id }); }
  };
}

function lanzarTerminales() {
  const h = spawn(process.execPath, [deFuera('terminales.js'), TUBO], {
    detached: true, stdio: 'ignore', windowsHide: true, cwd: deFuera(), env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' })
  });
  // Si no arranca (una ruta que no existe, por ejemplo), se anota y la consola sigue: sin esto, el error la cerraba.
  h.on('error', (e) => registrar('no arrancó el dueño de terminales', e.message));
  h.unref();
  registrar('terminales lanzadas', h.pid);
}

// Se conecta al dueño de las terminales (lo lanza si no está) y devuelve su pid.
function conectarTerminales() {
  conectando = true;
  return new Promise((listo) => {
    const resolver = (pid) => { conectando = false; listo(pid); };
    let intentos = 0;
    const intentar = () => {
      const sock = net.connect(TUBO);
      let resto = '';
      sock.setEncoding('utf8');
      sock.on('data', (c) => {
        resto += c;
        let i;
        while ((i = resto.indexOf('\n')) >= 0) {
          const linea = resto.slice(0, i);
          resto = resto.slice(i + 1);
          let m;
          try { m = JSON.parse(linea); } catch (e) { continue; }
          if (m.tipo === 'hola') {
            tubo = sock;
            vivasAlConectar = m.terminales || [];
            pidDueno = m.pid || 0;
            registrar('terminales conectadas', m.pid, 'vivas', vivasAlConectar.length);
            for (const p of pendientes.splice(0)) aTerminales(p);
            resolver(m.pid);
            continue;
          }
          const p = procesos.get(m.id);
          if (!p) continue;
          if (m.tipo === 'datos') p.alDato(m.datos);
          else if (m.tipo === 'salida') {
            if (m.error) datosPty(m.id, `\r\n\x1b[33mNo se pudo abrir Claude Code: ${m.error}\x1b[0m\r\n`);
            p.alSalir({ exitCode: m.codigo });
          }
        }
      });
      sock.on('error', () => {
        if (tubo === sock) return;
        if (intentos++ === 0) lanzarTerminales();
        if (intentos < 60) setTimeout(intentar, 250);
        else { registrar('sin dueño de terminales'); resolver(0); }
      });
      sock.on('close', () => {
        if (tubo !== sock) return;
        tubo = null;
        registrar('se cortó el tubo de terminales');
        for (const p of [...procesos.values()]) p.alSalir({ exitCode: -1 });
      });
    };
    intentar();
  });
}

// Las terminales que siguieron vivas mientras la consola estaba cerrada vuelven a su ventana, con el estado de antes.
function reconectarVivas() {
  for (const t of vivasAlConectar) {
    const s = sesiones.get(t.id);
    if (!s) { aTerminales({ tipo: 'matar', id: t.id }); continue; }
    const proceso = terminalRemota(t.id);
    procesos.set(t.id, proceso);
    s.viva = true;
    s.iniciada = true;
    s.reconectada = true;
    vigilar(s, t.id, proceso, true, 0);
    cambiarEstado(s, (s.antes && s.antes.estado) || 'pausa', (s.antes && s.antes.mensaje) || '');
    registrar('pty reconectada', t.id, `${t.cols}x${t.rows}`);
  }
}

// Una sesión que abre la consola (flujo, MCP, CRM) la abre primero la ventana con el tamaño medido: nacer más ancha que
// la ventana descuadra lo que Claude ya dibujó (27 de 51 nacían en 120x32, 21-10-2026). Si no está a la vista, parte igual.
function abrirAlMedir(id, cols, rows) {
  setTimeout(() => abrir(id, cols, rows), 1500);
}

// ── Lite (sprints\lite-04-11-2026): servidores MCP por sesión ──
// perfil.json → «mcp_por_sesion»: { activo, entornos: { "<entorno>": ["chrome", "methodic"…] }, catalogo: { "<nombre>": {…} } }.
// Apagado o sin el bloque, la sesión parte como siempre (todo lo de ~\.claude.json, plugins y conectores de claude.ai).
// Encendido: --strict-mcp-config con chocosys, lo de su entorno y lo que se le sumó a la sesión («mcp»); «todo» la deja
// como siempre, y así vuelven Gmail y Docs de claude.ai, que no se pueden poner en un --mcp-config.
const MCP_EXTRAS = ['rea', 'whatsapp', 'methodic', 'effectcraft', 'chrome', 'todo'];
const mcpPorSesion = () => { const m = perfil().mcp_por_sesion; return m && m.activo ? m : null; };
let nodeMcp = null;
function catalogoMcp(m) {
  let cj = {};
  try { cj = JSON.parse(fs.readFileSync(ARCHIVO_CLAUDE_JSON, 'utf8')); } catch (e) { /* sin ~\.claude.json: solo el catálogo del perfil */ }
  const deProyectos = Object.values(cj.projects || {}).map((p) => (p && p.mcpServers) || {});
  if (!nodeMcp) nodeMcp = buscar('node', 'C:\\Program Files\\nodejs\\node.exe') || 'node';
  // chocosys siempre el de este programa: en una copia de prueba, su propio MCP.
  return Object.assign({}, ...deProyectos, cj.mcpServers || {}, m.catalogo || {}, { chocosys: { type: 'stdio', command: nodeMcp, args: [RUTA_MCP()], env: {} } });
}
function argsMcp(s) {
  const m = mcpPorSesion();
  const extra = s.mcp || [];
  if (!m || extra.includes('todo')) return [];
  // El entorno de su pestaña; si la pestaña no es de un entorno con perfil, el de su carpeta (el más hondo).
  const porCarpeta = leerEntornos().filter((x) => obsidian.dentroDe(s.carpeta, x.carpeta)).sort((a, b) => b.carpeta.length - a.carpeta.length).map((x) => x.nombre);
  const candidatos = [entornoDeEspacio(s.espacio), ...porCarpeta].map((x) => String(x).toLowerCase());
  const deEntorno = candidatos.map((c) => Object.entries(m.entornos || {}).find(([n]) => n.toLowerCase() === c)).find(Boolean);
  const nombres = new Set(['chocosys', ...(deEntorno ? deEntorno[1] : []), ...extra]);
  const chrome = nombres.delete('chrome');
  const cat = catalogoMcp(m);
  const servidores = {};
  for (const n of nombres) if (cat[n]) servidores[n] = cat[n]; else registrar('mcp: no está en el catálogo', n);
  const archivo = path.join(DATOS, 'mcp', Object.keys(servidores).sort().join('+') + '.json');
  try {
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.writeFileSync(archivo, JSON.stringify({ mcpServers: servidores }, null, 1), 'utf8');
  } catch (e) { registrar('mcp: sin perfil, parte con todo', e.message); return []; }
  registrar('mcp por sesión', s.id, Object.keys(servidores).join('+') + (chrome ? ' +chrome' : ''));
  return ['--strict-mcp-config', '--mcp-config', archivo, chrome ? '--chrome' : '--no-chrome'];
}
ipcMain.handle('sesion:mcp', (e, id, lista) => {
  const s = sesiones.get(id);
  if (!s) return { ok: false };
  s.mcp = [].concat(lista || []).filter((x) => MCP_EXTRAS.includes(x));
  guardar();
  difundir();
  return { ok: true, rige: procesos.has(id) ? 'al retomar' : 'al abrir' };
});

function abrir(id, cols, rows) {
  const s = sesiones.get(id);
  if (!s || procesos.has(id)) return;
  if (!claudeExe) {
    datosPty(id, '\r\n\x1b[33mNo encontré claude.exe en el PATH.\x1b[0m\r\n');
    return;
  }
  const retomando = !!s.iniciada;
  if (retomando) s.sessionId = conversacionDe(s);
  const args = retomando ? ['--resume', s.sessionId] : ['--session-id', s.sessionId];
  args.push('--settings', ARCHIVO_HOOKS);
  // Lite: con el perfil MCP encendido, solo los servidores de su perfil. Va antes del «--»: --mcp-config acepta varios valores.
  args.push(...argsMcp(s));
  // Modelo y esfuerzo de la etapa (skill clasificar-complejidad); una sesión suelta usa los de quien usa la app.
  if (s.modelo && MODELOS[s.modelo]) args.push('--model', MODELOS[s.modelo]);
  if (s.esfuerzo && ESFUERZOS.includes(s.esfuerzo)) args.push('--effort', s.esfuerzo);
  // Solo lectura (auditores): sin editar archivos existentes. Write queda para su propio informe.
  if (s.soloLectura) args.push('--disallowedTools', 'Edit', 'NotebookEdit');
  // Con internet (etapa «web: true», sprint 10): buscar y leer páginas sin quedar esperando un permiso. Solo eso: no envía ni sube nada.
  if (s.web) args.push('--allowedTools', 'WebSearch', 'WebFetch');
  // Remote Control desde que parte, sin escribir /remote-control (22-10-2026, pedido de quien usa la app): se sigue desde el
  // celular o claude.ai/code con el nombre de la sesión. Las de flujos solo con «todas»: una sala abre seis o más.
  const rc = perfil().remote_control;
  // La central siempre: es la que se usa desde el celular.
  if (s.central || rc === 'todas' || (rc === 'sueltas' && !s.flujo)) args.push('--remote-control', String(s.nombre || '').replace(/^-+/, '') || 'chocosys'); // sin «-» al inicio: un nombre no puede ser una opción de claude.exe
  // «--» cierra las opciones: sin él, --disallowedTools (que acepta una lista) se tragaba la instrucción como si fuera
  // otra herramienta, y la sesión de solo lectura partía sin tarea (sprint 7, 20-10-2026: la sala quedaba esperando).
  // Sprint 20, H4 (D5): la guía del entorno va como system prompt agregado, sin gastar un turno; retomar no la repite.
  // El papel de la central y la nota de equipo de una sesión a cargo van en cada apertura, con los enlaces de ese momento.
  const sistema = [fraseSobreMi(), !retomando && s.guiaEntorno ? obsidian.fraseGuia(s.guiaEntorno) : '', s.central ? instruccionCentral() : (s.coordinador ? notaEquipo(s) : '')].filter(Boolean).join('\n\n');
  if (sistema) args.push('--append-system-prompt', sistema);
  if (!retomando && s.instruccion) { args.push('--', s.instruccion); s.instruccion = ''; }
  // En una consola de prueba (--datos), el MCP de sus sesiones tiene que hablarle a ESTA consola, no a la de uso diario.
  const entorno = entornoLimpio(Object.assign({ CONSOLA_PANEL: id, CONSOLA_CONEXION: ARCHIVO_CONEXION }, datosPrueba ? { CHOCOSYS_DATOS: path.dirname(DATOS) } : {}));
  const proceso = terminalRemota(id);
  aTerminales({ tipo: 'abrir', id, archivo: claudeExe, args, opciones: {
    // useConptyDll: el ConPTY que trae node-pty (el de Windows Terminal), no el de Windows. El de Windows redibuja la
    // pantalla entera y se come la salida sincronizada de Claude Code: parpadeo, lag y dictado cortado (21-10-2026).
    name: 'xterm-256color', cols: (s.tam && s.tam.cols) || cols || 100, rows: (s.tam && s.tam.rows) || rows || 30, cwd: s.carpeta, env: entorno, useConpty: true, useConptyDll: true
  } });
  registrar('pty abierta', id, retomando ? 'retomando' : 'nueva', `${(s.tam && s.tam.cols) || cols}x${(s.tam && s.tam.rows) || rows}`);
  procesos.set(id, proceso);
  s.iniciada = true;
  s.viva = true;
  cambiarEstado(s, 'pausa', '');
  vigilar(s, id, proceso, retomando, Date.now());
}

// Lo que llega de una terminal, sea recién abierta o encontrada viva al reabrir la consola.
function vigilar(s, id, proceso, retomando, inicio) {
  // La pregunta «¿confías en esta carpeta?» llega antes que cualquier hook. Se reconoce por su
  // texto (una sola pantalla conocida) para que la sesión suba a «te necesita»; la respuesta es tuya.
  let primerDato = true;
  let pantalla = '';
  let vigilar = !retomando;
  proceso.onData((datos) => {
    if (primerDato) { primerDato = false; registrar('pty primer dato', id); }
    datosPty(id, datos);
    if (!vigilar || s.confianzaAvisada) return;
    // Sin secuencias de control ni espacios: la terminal a veces separa palabras moviendo el cursor.
    pantalla = (pantalla + datos.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\s+/g, '')).slice(-4000);
    if (/trustthisfolder/i.test(pantalla)) {
      vigilar = false;
      s.confianzaAvisada = true;
      cambiarEstado(s, 'necesita', 'Pregunta si confías en esta carpeta');
    }
  });
  proceso.onExit(({ exitCode }) => {
    registrar('pty cerrada', id, 'código', exitCode);
    procesos.delete(id);
    s.viva = false;
    // Cambio de modelo: se retoma la misma conversación con el modelo y el esfuerzo nuevos, del tamaño que tenía.
    if (s.reabrir) {
      s.reabrir = false;
      datosPty(id, '\x1bc\x1b[90mRetomando con ' + (s.modelo || '') + ' ' + (s.esfuerzo || '') + '…\x1b[0m\r\n');
      abrir(id, (s.tam && s.tam.cols) || 120, (s.tam && s.tam.rows) || 32);
      return;
    }
    let aviso = 'Sesión cerrada';
    // Retomar una sesión que nunca recibió un mensaje falla al tiro: la próxima vez parte de cero.
    if (retomando && exitCode !== 0 && Date.now() - inicio < 5000) {
      s.iniciada = false;
      aviso = 'No había conversación que retomar';
    }
    datosPty(id, `\r\n\x1b[90m[${aviso} · código ${exitCode}]\x1b[0m\r\n`);
    cambiarEstado(s, 'pausa', aviso);
  });
}

async function elegirCarpeta(titulo, base) {
  const opciones = { title: titulo, properties: ['openDirectory'] };
  if (typeof base === 'string' && base && fs.existsSync(base)) opciones.defaultPath = base;
  const r = await dialog.showOpenDialog(ventana, opciones);
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
}

async function nuevaSesion(carpeta, instruccion, extra) {
  const destino = carpeta || await elegirCarpeta('Carpeta del trabajo');
  if (!destino) return null;
  const id = crypto.randomBytes(6).toString('hex');
  const s = {
    id, nombre: path.basename(destino), carpeta: destino, sessionId: crypto.randomUUID(),
    iniciada: false, viva: false, estado: 'pausa', mensaje: '', ultimo: '', creada: Date.now(), cambio: Date.now(),
    instruccion: instruccion || '', espacio: espacioActual, pos: null
  };
  if (extra) Object.assign(s, extra);
  // Sprint 25 (H1, D3): sin pestaña a la vista (o con una que ya no existe), la sesión cae en la de su carpeta.
  if (!espacioPorId(s.espacio)) s.espacio = espacioPara(destino).id;
  if (!espacioPorId(espacioActual)) espacioActual = s.espacio;
  // Sprint 20, H4: la sesión suelta (ventana o MCP, nunca un flujo) guarda la carpeta de la guía de su entorno, si toca.
  if (s.conGuia) {
    delete s.conGuia;
    const guia = obsidian.guiaParaSesion(destino, espacioPorId(s.espacio), entornosConGuia());
    if (guia) s.guiaEntorno = guia;
  }
  sesiones.set(id, s);
  guardar();
  difundir();
  return publica(s);
}

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 560,
    backgroundColor: '#0b0a09',
    title: 'Chocosys',
    titleBarStyle: 'hidden',
    // Transparente: el resplandor del fondo sigue detrás de los botones de la ventana.
    titleBarOverlay: { color: '#00000000', symbolColor: '#b8ad9f', height: 52 },
    // Desde el código el icono no viene del .exe: se le pasa (build/ no va en el paquete; ahí manda el del instalador).
    ...(app.isPackaged ? {} : { icon: path.join(__dirname, 'build', 'icon.png') }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  ventana.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { edicion: edicion.NOMBRE } });
  // Ninguna página ajena con el API de la app: un enlace de la terminal (OSC 8) abría una ventana con el preload, y soltar
  // un archivo encima navegaba a él. Solo se carga la interfaz propia.
  const propia = require('url').pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
  ventana.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ventana.webContents.on('will-navigate', (e, url) => { if (url.split('?')[0] !== propia) e.preventDefault(); });
  // Recarga (Ctrl+Shift+F5, interfaz_recargar): mientras la página carga la salida solo se guarda; al terminar se repone.
  ventanaLista = false;
  ventana.webContents.on('did-start-loading', () => { ventanaLista = false; });
  ventana.webContents.on('did-finish-load', reponerSalidas);
  ventana.webContents.on('did-fail-load', () => { ventanaLista = true; });
  ventana.on('focus', () => ventana.flashFrame(false));
  ventana.webContents.on('console-message', (e) => {
    const nivel = e.level !== undefined ? e.level : '';
    if (nivel === 'error' || nivel === 'warning' || nivel === 3 || nivel === 2) registrar('ventana', String(nivel), e.message || '');
  });
  ventana.webContents.on('render-process-gone', (e, d) => registrar('ventana cayó', d.reason));
  // Sin menú: sus atajos (Ctrl+R recarga, Ctrl+W cierra) le quitarían teclas a Claude Code.
  ventana.removeMenu();
  ventana.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !input.control || !input.shift) return;
    const tecla = input.key.toLowerCase();
    if (tecla === 'i') ventana.webContents.toggleDevTools();
    if (input.key === 'F5') ventana.webContents.reload();
  });
}

// ── MCP: lo que una sesión de Claude puede hacer con la consola abierta ──
// Ver, ordenar, abrir sesiones, crear y editar recetas, lanzar flujos y personalizar la interfaz.
// Aprobar una puerta NO está: las puertas son de quien usa la app (incidente del 17-10-2026).
// ── CRM (sprint 3) ─────────────────────────────────────────────────────────
// La base no vive con el código. crm.json (junto al estado) dice dónde está y, si se quiere, desde qué base vieja
// migrar la primera vez: { "base": "C:\\...\\chocosys-crm.db", "migrar_desde": "C:\\...\\crm.db" }.
// Sin crm.json, la base queda en los datos de la app y nace con datos de prueba ficticios.
const ARCHIVO_CRM = path.join(DATOS, 'crm.json');
// Varios CRM (sprint 4, idea de quien usa la app del 20-10-2026): uno por proyecto o cliente, cada uno en su carpeta dentro
// de «carpeta_crms» (por defecto, los datos de la app), con su crm.db, sus documentos y su crm-nombre.json. El de
// «base» (si está en crm.json) es el principal. Ninguno vive con el código.
const crms = new Map();          // ruta de la base -> CRM abierto
let crmActual = null;            // nombre del CRM a la vista
// Un crm.json ilegible no se pisa: antes se leía como {} y al guardar solo «actual» se perdían base y carpetas.
function cfgCrm() {
  if (!fs.existsSync(ARCHIVO_CRM)) return {};
  try { return JSON.parse(fs.readFileSync(ARCHIVO_CRM, 'utf8')); } catch (e) { registrar('crm.json ilegible', e.message); return { _ilegible: true }; }
}
function guardarCfgCrm(cfg) {
  if (cfg._ilegible) { registrar('crm.json ilegible: no se escribe encima; arréglalo a mano'); return; }
  try { fs.writeFileSync(ARCHIVO_CRM + '.tmp', JSON.stringify(cfg, null, 2), 'utf8'); fs.renameSync(ARCHIVO_CRM + '.tmp', ARCHIVO_CRM); } catch (e) { registrar('crm.json sin guardar', e.message); }
}
const carpetaCrms = (cfg) => cfg.carpeta_crms || path.join(DATOS, 'crms');
const slugCrm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
function listaCrms() {
  const cfg = cfgCrm();
  const lista = [{ nombre: cfg.nombre_base || 'Principal', ruta: cfg.base || path.join(DATOS, 'crm', 'crm.db'), principal: true }];
  const raiz = carpetaCrms(cfg);
  let dirs = [];
  try { dirs = fs.readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch (e) { /* aún no hay otros */ }
  for (const d of dirs) {
    const ruta = path.join(raiz, d.name, 'crm.db');
    if (!fs.existsSync(ruta)) continue;
    let nombre = d.name;
    try { nombre = JSON.parse(fs.readFileSync(path.join(raiz, d.name, 'crm-nombre.json'), 'utf8')).nombre || d.name; } catch (e) { /* el nombre de la carpeta */ }
    lista.push({ nombre, ruta, carpeta: path.join(raiz, d.name) });
  }
  return lista;
}
function abrirCrm(nombre) {
  const cfg = cfgCrm();
  const lista = listaCrms();
  const elegido = lista.find((x) => x.nombre === (nombre || crmActual || cfg.actual)) || lista[0];
  crmActual = elegido.nombre;
  if (crms.has(elegido.ruta)) return crms.get(elegido.ruta);
  const c = require('./crm/crm').abrir(elegido.ruta);
  if (elegido.principal) {
    if (cfg.migrar_desde && fs.existsSync(cfg.migrar_desde) && !c.config('migrado_desde')) registrar('crm migrado', JSON.stringify(c.migrarDesde(cfg.migrar_desde, perfil().empresa_interna)));
    // Sin crm.json (otro computador, una prueba): el principal nace con datos ficticios y lo dice.
    if (c.modo() === 'vacía' && !cfg.base && c.sembrarPrueba()) registrar('crm con datos de prueba', elegido.ruta);
  }
  crms.set(elegido.ruta, c);
  registrar('crm abierto', elegido.nombre, c.modo());
  return c;
}
function crearCrm(nombre, autor) {
  const limpio = String(nombre || '').trim().slice(0, 60);
  const slug = slugCrm(limpio);
  if (!slug) throw new Error('Falta el nombre del CRM.');
  if (listaCrms().some((x) => x.nombre.toLowerCase() === limpio.toLowerCase())) throw new Error(`Ya existe un CRM llamado «${limpio}».`);
  const carpeta = path.join(carpetaCrms(cfgCrm()), slug);
  if (fs.existsSync(path.join(carpeta, 'crm.db'))) throw new Error('Ya existe la carpeta ' + carpeta);
  fs.mkdirSync(carpeta, { recursive: true });
  fs.writeFileSync(path.join(carpeta, 'crm-nombre.json'), JSON.stringify({ nombre: limpio, creado: new Date().toISOString(), por: autor || quien() }, null, 2), 'utf8');
  // La base se crea acá: sin crm.db la carpeta no cuenta como CRM.
  const ruta = path.join(carpeta, 'crm.db');
  const c = require('./crm/crm').abrir(ruta);
  c.config('modo', 'real');
  crms.set(ruta, c);
  elegirCrm(limpio);
  registrar('crm creado', limpio, carpeta);
  return { nombre: limpio, carpeta };
}
function elegirCrm(nombre) {
  if (!listaCrms().some((x) => x.nombre === nombre)) throw new Error('No hay un CRM llamado ' + nombre);
  crmActual = nombre;
  const cfg = cfgCrm(); cfg.actual = nombre; guardarCfgCrm(cfg);
  enviar('crm', null);
  return nombre;
}
// Cada escritura avisa a la ventana para que se repinte (el historial guarda quién la hizo).
function crmEscribe(fn) { const r = fn(abrirCrm()); enviar('crm', null); return r; }
// La carpeta de un negocio tiene que ser una carpeta: «carpeta: …\factura.bat» quedaba lista para correr con un clic.
function crmCarpeta(n) {
  if (!n || !n.carpeta) return null;
  if (path.isAbsolute(n.carpeta)) return esCarpeta(n.carpeta) ? n.carpeta : null;
  const raiz = abrirCrm().config('carpeta_trabajos');
  const ruta = raiz ? path.join(raiz, n.carpeta) : null;
  return ruta && esCarpeta(ruta) ? ruta : null;
}
function esCarpeta(ruta) { try { return fs.statSync(ruta).isDirectory(); } catch (e) { return false; } }
// «Abrir» nunca ejecuta: shell.openPath corre un .exe, .bat o acceso directo; esos se muestran en su carpeta.
const EJECUTABLE = /\.(exe|bat|cmd|com|lnk|url|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msp|scr|pif|cpl|jar|reg|appref-ms)$/i;
function abrirSinEjecutar(ruta) {
  if (EJECUTABLE.test(ruta) && !esCarpeta(ruta)) { shell.showItemInFolder(ruta); return Promise.resolve(''); }
  return shell.openPath(ruta);
}

const ARCHIVO_CONEXION = path.join(DATOS, 'conexion.json');
const ARCHIVO_PERSONAL = path.join(DATOS, 'personal.css');
function buscarSesion(ref) {
  const r = String(ref || '').trim().toLowerCase();
  if (!r) throw new Error('Falta la sesión (id o nombre).');
  const lista = [...sesiones.values()];
  const s = lista.find((x) => x.id === r) || lista.find((x) => x.nombre.toLowerCase() === r) || lista.find((x) => x.nombre.toLowerCase().startsWith(r));
  if (!s) throw new Error(`No hay una sesión «${ref}». Usa «estado» para ver las que hay.`);
  return s;
}
function buscarEspacio(ref) {
  const r = String(ref || '').trim().toLowerCase();
  return espacios.find((e) => e.id === r || e.nombre.toLowerCase() === r) || null;
}
function validarReceta(id, texto) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error('El id de la receta va en kebab-minúscula (ej. «revision-semanal»).');
  const r = yaml.load(texto);
  if (!r || typeof r !== 'object') throw new Error('La receta no es un YAML con campos.');
  if (!r.nombre) throw new Error('Falta «nombre».');
  if (!Array.isArray(r.etapas) || !r.etapas.length) throw new Error('Falta la lista «etapas».');
  r.etapas.forEach((e, i) => {
    if (e && e.puerta !== undefined) return;
    if (e && e.accion !== undefined) revisarEtapaConAccion(r.etapas, i, texto);
    else if (!e || !e.nombre || !e.instruccion) throw new Error(`La etapa ${i + 1} necesita «nombre» e «instruccion» (o ser una «puerta» o una «accion»).`);
    if (e.agentes !== undefined && !(Number(e.agentes) >= 1 && Number(e.agentes) <= MAX_AGENTES)) throw new Error(`La etapa ${i + 1}: «agentes» va de 1 a ${MAX_AGENTES}.`);
    if (e.modelo !== undefined && !MODELOS_RECETA.includes(String(e.modelo).toLowerCase())) throw new Error(`La etapa ${i + 1}: «modelo» es ${MODELOS_RECETA.join(', ')} (nunca fable).`);
    // Sprint 27, H3: el tope de palabras es un entero de 50 a 5.000; tope_archivo y tope_detalle solo con tope.
    if (e.tope_palabras !== undefined && !(Number.isInteger(Number(e.tope_palabras)) && Number(e.tope_palabras) >= TOPE_MIN && Number(e.tope_palabras) <= TOPE_MAX)) throw new Error(`La etapa ${i + 1}: «tope_palabras» es un número entero de ${TOPE_MIN} a ${TOPE_MAX}.`);
    if ((e.tope_archivo !== undefined || e.tope_detalle !== undefined) && e.tope_palabras === undefined) throw new Error(`La etapa ${i + 1}: «tope_archivo» y «tope_detalle» van con «tope_palabras».`);
  });
  if (r.origen !== undefined && !ORIGENES.includes(String(r.origen).toLowerCase())) throw new Error(`«origen» es ${ORIGENES.join(', ')}.`);
  return r;
}
// Sprint 23 (H1): las acciones estándar, las del programa con las de <datos>\acciones\ encima.
function listaAcciones() { return accionesEstandar.leerAcciones(DATOS, __dirname); }
// La línea donde parte la etapa i («- » al nivel de la lista «etapas:»), para que el error diga dónde. null si no se halla.
function lineaDeEtapa(texto, i) {
  const lineas = String(texto || '').split(/\r?\n/);
  const k = lineas.findIndex((l) => /^etapas\s*:/.test(l));
  if (k < 0) return null;
  let sangria = null;
  let n = -1;
  for (let j = k + 1; j < lineas.length; j++) {
    const l = lineas[j];
    if (/^[^\s#-]/.test(l)) break;
    const m = l.match(/^(\s*)-(\s|$)/);
    if (!m) continue;
    if (sangria === null) sangria = m[1].length;
    if (m[1].length === sangria && ++n === i) return j + 1;
  }
  return null;
}
// Sprint 23 (H2, D4): una etapa «accion: <id>» no lleva instrucción (la arma la acción al lanzar). La acción tiene que
// existir, sus parámetros tienen que ser suyos y con valores que sirvan (un obligatorio vacío se pide al lanzar), y si
// sale del computador, justo antes va una puerta «critica: true». El error lleva la línea donde parte la etapa.
function revisarEtapaConAccion(etapas, i, texto) {
  const e = etapas[i];
  const linea = lineaDeEtapa(texto, i);
  const falla = (msg) => { const err = new Error(`La etapa ${i + 1}${linea ? ' (línea ' + linea + ')' : ''}: ${msg}`); err.linea = linea; throw err; };
  if (e.instruccion !== undefined) falla('con «accion» la instrucción la arma la acción; lo que quieras sumar va en el parámetro «ademas».');
  if (e.paralelo || (e.agentes !== undefined && Number(e.agentes) !== 1)) falla('una etapa con «accion» corre con un solo agente.');
  if (e.parametros !== undefined && e.parametros !== null && (typeof e.parametros !== 'object' || Array.isArray(e.parametros))) falla('«parametros» va como nombre: valor, uno por línea.');
  let a;
  try { a = accionesEstandar.buscar(listaAcciones(), e.accion); } catch (err) { falla(err.message); }
  const rev = accionesEstandar.validarParametros(a, e.parametros || {}, null, { enReceta: true });
  if (rev.errores.length) falla(rev.errores.join(' '));
  const previa = etapas[i - 1];
  if (a.sale && !(previa && previa.puerta !== undefined && previa.critica === true)) {
    falla(`«${a.nombre}» sale del computador: justo antes necesita una puerta con «critica: true», para que nada salga sin que lo apruebes.`);
  }
}
// El guardado de recetas, solo desde la ventana (editor de propuestas, sprint 21). El MCP ya no guarda recetas: una sesión
// podía reescribir una receta sin sus puertas y lanzarla; ahora solo propone (receta_proponer) y la persona guarda.
// extra: { origen, nacio_de, entrevista } se escriben como campos de arriba de la receta, reemplazando los que tuviera.
function guardarReceta(id, texto, extra, quien) {
  id = String(id || '').trim();
  texto = String(texto || '').replace(/\r?\n/g, '\n');
  const campos = Object.entries(extra || {}).filter(([k, v]) => ['origen', 'nacio_de', 'entrevista'].includes(k) && v);
  if (campos.length) {
    for (const [k] of campos) texto = texto.replace(new RegExp(`^${k}:.*(\\n|$)`, 'm'), '');
    const lineas = campos.map(([k, v]) => `${k}: ${JSON.stringify(String(v))}`).join('\n');
    // Junto a «nombre:» si está en una sola línea; si va en bloque («>», «|») o vacía, al principio.
    const nombreEnLinea = /^nombre:[ \t]*[^\s>|#].*$/m;
    texto = nombreEnLinea.test(texto) ? texto.replace(nombreEnLinea, (m) => m + '\n' + lineas) : lineas + '\n' + texto;
  }
  validarReceta(id, texto);
  // Se guarda entre las propias (en los datos de quien usa Chocosys), nunca dentro del programa.
  fs.mkdirSync(carpetaRecetas(), { recursive: true });
  const archivo = path.join(carpetaRecetas(), id + '.yaml');
  // Retirar no es borrar: la versión anterior queda en _archivo con la fecha.
  const reemplazo = fs.existsSync(archivo);
  if (reemplazo) {
    const archivoViejo = path.join(carpetaRecetas(), '_archivo');
    fs.mkdirSync(archivoViejo, { recursive: true });
    const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(archivo, path.join(archivoViejo, `${id}-${sello}.yaml`));
  }
  fs.writeFileSync(archivo, texto, 'utf8');
  registrar('receta guardada por ' + (quien || 'mcp'), id);
  return { guardada: id, archivo, reemplazo };
}
// Para el editor: valida mientras se escribe y devuelve lo que pinta la vista previa, o el error con su línea.
function revisarReceta(id, texto) {
  id = String(id || '').trim();
  try {
    validarReceta(id, String(texto || ''));
    const receta = interpretarReceta(id, texto);
    return { ok: true, receta, existe: fs.existsSync(path.join(carpetaRecetas(), id + '.yaml')) };
  } catch (e) {
    return { ok: false, error: e.reason || e.message, linea: e.mark ? e.mark.line + 1 : (e.linea || null) };
  }
}
function resumenFlujo(f) {
  return {
    id: f.id, nombre: f.nombre, receta: f.receta, carpeta: f.carpeta, estado: f.estado, simulacro: f.simulacro,
    espacio: nombreEspacio(f.espacio),
    items: f.items.map((it, i) => ({ n: i, tipo: it.tipo, nombre: it.nombre, estado: it.estado, agentes: it.agentes, modelo: it.modelo || it.modeloConfig,
      sesiones: it.sesiones, falta: it.falta, inicio: it.inicio, fin: it.fin, topes: it.topes }))
  };
}

async function atenderMcp(accion, d) {
  registrar('mcp', accion);
  if (!edicion.herramienta(accion)) throw new Error(`Esta edición de Chocosys (${edicion.NOMBRE}) no lleva «${accion}».`);
  // Una sesión a cargo de una coordinadora (o de la central) no arma el equipo: eso lo decide quien la tiene a cargo.
  const yo = d.desde ? sesiones.get(String(d.desde)) : null;
  if (yo && yo.coordinador && ['sesion_nueva', 'sesion_cerrar', 'sesion_enlazar', 'espacio_borrar', 'programar', 'programada_quitar', 'programada_correr'].includes(accion)) {
    throw new Error(`Eso lo decide «${nombreDe(yo.coordinador)}». Pídeselo en tu respuesta final: Chocosys se la lleva cuando termines.`);
  }
  switch (accion) {
    case 'estado':
      return {
        espacioActual: nombreEspacio(espacioActual),
        espacios: espacios.map((e) => ({ id: e.id, nombre: e.nombre, carpeta: e.carpeta })),
        sesiones: [...sesiones.values()].map((s) => Object.assign(publica(s), { espacio: nombreEspacio(s.espacio), pos: undefined })),
        flujos: motor.exportar().map(resumenFlujo)
      };
    // Lo mismo que ofrece el menú «Sesión nueva» de la ventana: los entornos, las pestañas con carpeta y dónde hay
    // sesiones abiertas. Sirve para elegir «entorno» o «carpeta» de sesion_nueva sin adivinar rutas.
    // Solo lectura: actuar sobre procesos queda en la ventana, como las puertas.
    case 'recursos': return resumenRecursos(await detalleRecursos());
    case 'lugares': {
      const ents = leerEntornos();
      const pestanaDe = (n) => espacios.find((x) => (x.entorno || x.nombre).toLowerCase() === n.toLowerCase());
      const abiertas = new Map();
      for (const s of sesiones.values()) {
        if (!s.carpeta) continue;
        const a = abiertas.get(rutaComparable(s.carpeta)) || { carpeta: s.carpeta, sesiones: 0 };
        a.sesiones++;
        abiertas.set(rutaComparable(s.carpeta), a);
      }
      return {
        pestana_actual: nombreEspacio(espacioActual),
        entornos: ents.map((x) => ({ nombre: x.nombre, carpeta: x.carpeta, existe: x.existe, pestana: (pestanaDe(x.nombre) || {}).nombre || null })),
        pestanas: espacios.filter((e) => e.carpeta).map((e) => ({ nombre: e.nombre, carpeta: e.carpeta, entorno: e.entorno || null })),
        con_sesiones: [...abiertas.values()],
        modelos: Object.keys(MODELOS), esfuerzos: ESFUERZOS
      };
    }
    case 'sesion_nueva': {
      // Con «entorno» y sin carpeta, la sesión parte en la carpeta del entorno y cae en su pestaña (como en la ventana).
      const ent = d.entorno ? leerEntornos().find((x) => x.nombre.toLowerCase() === String(d.entorno).trim().toLowerCase()) : null;
      if (d.entorno && !ent) throw new Error(`No hay un entorno «${d.entorno}». Usa «lugares» para ver los que hay.`);
      const carpeta = String(d.carpeta || (ent && ent.existe ? ent.carpeta : '')).trim();
      if (!carpeta) throw new Error(ent ? `El entorno «${ent.nombre}» no tiene carpeta que exista: da «carpeta».` : 'Falta «carpeta» o «entorno».');
      if (!fs.existsSync(carpeta)) throw new Error('La carpeta no existe: ' + carpeta);
      // La pide una coordinadora (sprint 16): la sesión queda a su cargo, con tope, y su modelo según el contexto (L1).
      // En un entorno «libre» (el Centro de control) la sesión nace suelta: no queda a cargo de quien la pide.
      const libre = (ent && ent.libre) || leerEntornos().some((x) => x.libre && rutaComparable(x.carpeta) === rutaComparable(carpeta));
      const pide = d.desde ? sesiones.get(String(d.desde)) : null;
      const coord = pide && !libre ? pide : null;
      const deOrquesta = !!(coord && coord.orquesta);
      // El tope cuenta también las que la central abrió sueltas en un entorno libre (03-11-2026).
      if (pide && pide.orquesta && [...sesiones.values()].filter((x) => (x.coordinador === pide.id || x.abiertaPor === pide.id) && ocupaCupo(x)).length >= topeDe(pide)) {
        const n = topeDe(pide);
        registrar('tope de sesiones', pide.id, n);
        if (pide.central) enviar('aviso', `La central llegó a su tope (${n} trabajando a la vez): abre la siguiente cuando termine una. Se cambia en perfil.json, «central.tope».`);
        throw new Error(`Tope de ${n} sesiones trabajando a la vez. Espera a que termine una (Chocosys te avisa) o dale la tarea a una que ya terminó, con sesion_ordenar.`);
      }
      // Con quiénes podrá hablar desde que nace: solo sesiones a cargo de la misma coordinadora.
      const con = [].concat(d.con || []).map(buscarSesion);
      if (con.some((x) => !coord || x.coordinador !== coord.id)) throw new Error('«con» acepta solo sesiones a tu cargo.');
      // Las de la central caen en la pestaña de su carpeta o entorno, no en la de la central.
      const esp = d.espacio ? (buscarEspacio(d.espacio) || nuevoEspacio(String(d.espacio))) : (ent ? espacioPara(carpeta, ent.nombre) : (coord && coord.central ? espacioPara(carpeta) : null));
      const extra = Object.assign({}, d.nombre ? { nombre: String(d.nombre).slice(0, 60) } : {}, esp ? { espacio: esp.id } : {});
      if (deOrquesta) {
        const m = elegirModelo(String(d.instruccion || ''), { espacio: esp ? esp.nombre : nombreEspacio(coord.espacio), elecciones: leerElecciones(), conClientes: perfil().pestanas_con_clientes });
        // La central puede fijar el modelo y el esfuerzo de las que abre; «auto» (o nada) deja que Chocosys elija.
        const cfg = coord.central ? (perfil().central || {}) : {};
        Object.assign(extra, { coordinador: coord.id, modelo: MODELOS[cfg.modelo_sesiones] ? cfg.modelo_sesiones : m.modelo, esfuerzo: ESFUERZOS.includes(cfg.esfuerzo_sesiones) ? cfg.esfuerzo_sesiones : m.esfuerzo, espacio: extra.espacio || coord.espacio });
      } else if (pide && pide.orquesta) extra.abiertaPor = pide.id;
      if (MODELOS[d.modelo]) extra.modelo = d.modelo;
      if (ESFUERZOS.includes(d.esfuerzo)) extra.esfuerzo = d.esfuerzo;
      // Lite: servidores MCP que se suman a los de su entorno («rea», «methodic», «chrome», «todo»…).
      if (d.mcp) extra.mcp = [].concat(d.mcp).filter((x) => MCP_EXTRAS.includes(x));
      extra.conGuia = true;
      const s = await nuevaSesion(carpeta, String(d.instruccion || ''), extra);
      // Antes de abrir: la nota de equipo de su system prompt ya nombra sus enlaces. A las otras se les avisa.
      for (const x of con) enlazar(sesiones.get(s.id), x, false, true);
      abrirAlMedir(s.id, 120, 32);
      // Las sesiones de una orquesta no se llevan la vista: Quien usa la app sigue mirando a la coordinadora.
      if (!deOrquesta) enviar('seleccionar', s.id);
      return { id: s.id, nombre: s.nombre, modelo: s.modelo || '', esfuerzo: s.esfuerzo || '', con: con.map((x) => x.nombre) };
    }
    // La coordinadora (o quien usa Chocosys) enlaza dos sesiones a su cargo para que se hablen; sin enlace no se hablan.
    case 'sesion_enlazar': {
      const s = buscarSesion(d.sesion);
      const otras = [].concat(d.con || []).map(buscarSesion);
      if (!otras.length) throw new Error('Falta «con»: la sesión o la lista de sesiones.');
      for (const x of [s, ...otras]) {
        if (!x.coordinador) throw new Error(`«${x.nombre}» no está a cargo de una coordinadora: las sueltas no se enlazan.`);
        if (x.coordinador !== s.coordinador || (yo && x.coordinador !== yo.id)) throw new Error(`«${x.nombre}» no está a tu cargo.`);
      }
      for (const x of otras) if (x.id !== s.id) enlazar(s, x, !!d.quitar, false);
      guardar(); difundir();
      return { sesion: s.nombre, enlaces: (s.enlaces || []).map(nombreDe) };
    }
    case 'sesion_leer': {
      const s = buscarSesion(d.sesion);
      puedeHablar(yo, s, 'leerla');
      const r = registroDe(s);
      const cola = (r && colaDe(r)) || {};
      return {
        id: s.id, nombre: s.nombre, estado: s.estado, mensaje: s.mensaje || '', carpeta: s.carpeta, espacio: nombreEspacio(s.espacio),
        ultimaOrden: s.ultimo || '', haciendo: cola.hace || '', modelo: (s.linea && s.linea.modelo) || s.modelo || '',
        subagentes: (s.subagentes || []).map((x) => ({ tipo: x.tipo, tarea: x.tarea, estado: x.estado })),
        ultimoMensaje: r ? ultimoTexto(r) : ''
      };
    }
    case 'sesion_ordenar': {
      const s = buscarSesion(d.sesion);
      puedeHablar(yo, s, 'escribirle');
      // Sin caracteres de control (Ctrl+C cortaría su tarea) y siempre con quién la manda delante: así «/clear», «/exit» o
      // «!» nunca quedan al comienzo de la línea como comandos de Claude Code. La que recibe sabe a quién contestarle.
      let texto = String(d.texto || '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!texto) throw new Error('Falta el texto.');
      texto = `${yo ? `[de «${yo.nombre}»]` : '[MCP]'} ${texto}`;
      // Con una pregunta o un permiso abiertos, el Enter de la orden elegiría la primera opción sin quien usa la app (T-A97).
      if (s.estado === 'necesita') throw new Error(`«${s.nombre}» está esperando que ${quien()} le responda en su terminal. No se le escribe hasta que responda; vuelve a mandarle la orden cuando termine.`);
      if (!escribirEn(s.id, texto)) throw new Error(`«${s.nombre}» está cerrada: hay que retomarla primero.`);
      if (yo && yo.coordinador) registrar('enlace: mensaje', yo.id, s.id);
      return { enviada: s.nombre };
    }
    case 'sesion_renombrar': {
      const s = buscarSesion(d.sesion);
      if (yo && yo.coordinador && s.id !== yo.id) throw new Error('Solo puedes renombrarte a ti misma.');
      s.nombre = String(d.nombre || '').trim().slice(0, 60) || s.nombre;
      guardar(); difundir();
      return { id: s.id, nombre: s.nombre };
    }
    // Lo mismo que la × de una sesión: mata su terminal y la quita (queda anotada en el log.md de su entorno). Nunca la
    // que lo pide, una de flujo (se cierra al quitar el flujo) ni una que espera respuesta; una que trabaja, solo con «forzar».
    case 'sesion_cerrar': {
      let lista;
      if (d.sesion) lista = [...new Set([].concat(d.sesion).map(buscarSesion))];
      else if (d.quietas) {
        const e = d.espacio ? buscarEspacio(d.espacio) : null;
        if (d.espacio && !e) throw new Error('No hay un espacio con ese nombre.');
        lista = [...sesiones.values()].filter((s) => (!e || s.espacio === e.id) && !s.flujo && !s.central && s.id !== String(d.desde || '') && s.estado !== 'trabajando' && s.estado !== 'necesita');
      } else throw new Error('Falta «sesion» (id, nombre o lista) o «quietas: true».');
      const cerradas = [], noCerradas = [];
      // Decisión de quien usa la app (03-11-2026): la central nunca cierra una sesión con un cálculo vivo, salvo «forzar» por orden suya.
      const vivos = d.forzar ? new Map() : await recursos.calculoVivo(lista.map((s) => s.sessionId)).catch(() => new Map());
      for (const s of lista) {
        let motivo = '';
        if (d.desde && s.id === String(d.desde)) motivo = 'es la sesión que lo pide: no se cierra a sí misma';
        else if (s.central) motivo = `es la central: la cierra ${quien()} en la ventana`;
        else if (s.flujo) motivo = 'es de un flujo: se cierra al quitar el flujo en la ventana';
        else if (s.estado === 'necesita') motivo = `espera que ${quien()} le responda en su terminal`;
        else if (s.estado === 'trabajando' && !d.forzar) motivo = 'está trabajando: espera a que termine (forzar: true solo si ' + quien() + ' lo pidió)';
        else if (vivos.has(s.sessionId)) motivo = `tiene un cálculo vivo (${describirCalculo(vivos.get(s.sessionId))}): cerrarla lo cortaría. Déjala abierta y avísale a ${quien()}; forzar: true solo si ${quien()} lo ordenó explícitamente`;
        if (motivo) { noCerradas.push({ sesion: s.nombre, motivo }); continue; }
        anotarSesionCerrada(s);
        cerrarSesion(s.id, d.forzar ? [] : 'ocupados');
        cerradas.push(s.nombre);
      }
      if (cerradas.length) { guardar(); difundir(); }
      if (!cerradas.length && noCerradas.length) throw new Error('No se cerró nada: ' + noCerradas.map((x) => `«${x.sesion}» ${x.motivo}`).join('; ') + '.');
      return { cerradas, no_cerradas: noCerradas };
    }
    case 'programadas':
      return prog.leer().map(resumenProgramada);
    case 'programar': {
      const lista = prog.leer();
      const existe = d.id ? prog.buscar(lista, d.id) : null;
      if (d.id && !existe) throw new Error(`No hay una tarea programada «${d.id}». Usa «programadas» para ver las que hay.`);
      const t = programadas.validar(d, existe);
      // Lo que nombra tiene que existir hoy; si después desaparece, la tarea avisa al no correr.
      if (t.tipo === 'receta' && !leerRecetas().some((r) => r.id === t.receta && !r.error)) throw new Error('No hay una receta válida «' + t.receta + '».');
      if (t.entorno && !leerEntornos().some((x) => x.nombre.toLowerCase() === t.entorno.toLowerCase())) throw new Error(`No hay un entorno «${t.entorno}». Usa «lugares».`);
      if (t.carpeta && !fs.existsSync(t.carpeta)) throw new Error('La carpeta no existe: ' + t.carpeta);
      if (t.sesion) buscarSesion(t.sesion);
      if (t.tipo === 'orden' && !t.sesion && !centralViva() && !(perfil().central || {}).activa) throw new Error('Sin «sesion», la orden va a la central, y no hay una abierta ni activa (perfil.json, «central.activa»).');
      if (existe) lista[lista.indexOf(existe)] = t; else lista.push(t);
      prog.guardar(lista);
      registrar('programada guardada', t.id, t.cuando || t.en);
      return resumenProgramada(t);
    }
    case 'programada_quitar': {
      const lista = prog.leer();
      const t = prog.buscar(lista, d.tarea);
      if (!t) throw new Error(`No hay una tarea programada «${d.tarea}».`);
      prog.retirar(t);
      prog.guardar(lista.filter((x) => x !== t));
      return { quitada: t.nombre };
    }
    // Para probar una tarea sin esperar su hora: corre ahora y anota el resultado.
    case 'programada_correr': {
      const t = prog.buscar(prog.leer(), d.tarea);
      if (!t) throw new Error(`No hay una tarea programada «${d.tarea}».`);
      const ultima = { clave: 'a mano ' + programadas.clave(new Date()), hora: new Date().toISOString() };
      try { ultima.resultado = await correrProgramada(t, null); ultima.ok = true; }
      catch (e) { ultima.resultado = 'sin correr: ' + e.message; ultima.ok = false; }
      anotarProgramada(t.id, ultima, false);
      if (!ultima.ok) throw new Error(ultima.resultado);
      return { tarea: t.nombre, resultado: ultima.resultado };
    }
    case 'espacio_nuevo': {
      const e = nuevoEspacio(d.nombre, String(d.carpeta || ''));
      guardar(); difundir();
      return e;
    }
    case 'espacio_elegir': {
      const e = buscarEspacio(d.espacio);
      if (!e) throw new Error('No hay un espacio con ese nombre.');
      espacioActual = e.id; guardar(); difundir(); enviar('espacio', e.id);
      return { espacio: e.nombre };
    }
    // Lo mismo que renombrar la pestaña en la ventana (espacio:renombrar), sin repetir un nombre que ya existe.
    case 'espacio_renombrar': {
      const e = buscarEspacio(d.espacio);
      if (!e) throw new Error('No hay un espacio con ese nombre.');
      const nombre = String(d.nombre || '').trim().slice(0, 40);
      if (!nombre) throw new Error('Falta «nombre»: el nombre nuevo.');
      const otra = buscarEspacio(nombre);
      if (otra && otra !== e) throw new Error(`Ya hay un espacio «${otra.nombre}».`);
      const antes = e.nombre;
      e.nombre = nombre;
      registrar('espacio renombrado', e.id, antes, nombre);
      guardar(); difundir();
      const cfg = perfil().central;
      const central = [...sesiones.values()].some((s) => s.central && s.espacio === e.id) && cfg && cfg.activa;
      const pestana = cfg && (String(cfg.pestana || '').trim() || 'Central');
      return { antes, nombre, aviso: central && pestana !== nombre ? `Tiene la central: al iniciar, Chocosys la deja en «${pestana}» (perfil.json, «central.pestana»).` : undefined };
    }
    // Lo mismo que la × de la pestaña. Sin «cerrar», sus sesiones y flujos pasan a otro espacio; con «cerrar», se
    // cierran, pero nunca una sesión trabajando o esperando respuesta, un flujo sin terminar ni la sesión que lo pide.
    case 'espacio_borrar': {
      const e = buscarEspacio(d.espacio);
      if (!e) throw new Error('No hay un espacio con ese nombre.');
      const suyas = [...sesiones.values()].filter((s) => s.espacio === e.id);
      const susFlujos = motor.todos().filter((f) => f.espacio === e.id);
      let cerradas = 0;
      if (d.cerrar) {
        if (d.desde && suyas.some((s) => s.id === String(d.desde))) throw new Error(`La sesión que lo pide está en «${e.nombre}»: no se cierra a sí misma. Pídelo desde otra pestaña.`);
        if (suyas.some((s) => s.central)) throw new Error(`«${e.nombre}» tiene la central: la cierra ${quien()} en la ventana.`);
        const ocupadas = suyas.filter((s) => s.estado === 'trabajando' || s.estado === 'necesita');
        if (ocupadas.length) throw new Error(`No se cierra «${e.nombre}»: ${ocupadas.map((s) => `«${s.nombre}» (${s.estado})`).join(', ')}. Espera a que terminen o ciérralas en la ventana.`);
        const abiertos = susFlujos.filter((f) => f.estado !== 'completo');
        if (abiertos.length) throw new Error(`No se cierra «${e.nombre}»: tiene flujos sin terminar (${abiertos.map((f) => f.nombre).join(', ')}). Quítalos en la ventana.`);
        for (const f of susFlujos) for (const id of motor.quitar(f.id)) { cerrarSesion(id); cerradas++; }
        for (const s of suyas.filter((x) => !x.flujo && sesiones.has(x.id))) { anotarSesionCerrada(s); cerrarSesion(s.id); cerradas++; }
      }
      const r = borrarEspacio(e.id);
      if (!r) throw new Error(`No se pudo borrar «${e.nombre}»: es el último espacio y todavía tiene sesiones o flujos. Usa «cerrar: true».`);
      if (espacioActual) enviar('espacio', espacioActual); else enviar('modo', 'inicio');
      const destino = typeof r === 'string' ? espacios.find((x) => x.id === r) : null;
      return { borrado: e.nombre, cerradas, flujos_quitados: d.cerrar ? susFlujos.length : 0, pasados_a: !d.cerrar && (suyas.length || susFlujos.length) && destino ? destino.nombre : null };
    }
    case 'recetas':
      return leerRecetas().map((r) => ({ id: r.id, nombre: r.nombre, descripcion: r.descripcion, grupo: r.grupo, espacio: r.espacio, carpeta: r.carpeta, origen: r.origen, entrevista: r.entrevista || undefined,
        etapas: r.etapas.map((e) => (e.tipo === 'puerta' ? `puerta: ${e.nombre}${e.critica ? ' (crítica)' : ''}${e.elegir ? ' (elegir)' : ''}` : `${e.nombre}${e.agentes > 1 ? ' ×' + e.agentes : ''}${e.accion ? ` [accion: ${e.accion}${e.sale ? ', sale' : ''}; parametros: ${JSON.stringify(e.parametros || {})}]` : ''}`)), error: !!r.error }));
    case 'receta_leer': {
      // Solo nombres de receta (kebab-minúscula): con «..\» se podía leer cualquier .yaml del disco.
      if (!/^[a-z0-9][a-z0-9-]*$/.test(String(d.id || ''))) throw new Error('El id de una receta va en kebab-minúscula: ' + d.id);
      const receta = leerRecetas().find((r) => r.id === String(d.id));
      if (!receta) throw new Error('No existe la receta ' + d.id);
      return { id: d.id, yaml: fs.readFileSync(receta.ruta, 'utf8'), propia: receta.propia };
    }
    case 'receta_proponer': {
      // Sprint 21 (H2, D4): la sesión propone y nada se guarda entre las recetas. El borrador espera en propuestas\
      // hasta que quien usa Chocosys lo vea, lo corrija y lo guarde (o lo descarte) desde la ventana.
      const id = String(d.id || '').trim();
      const texto = String(d.yaml || '').replace(/\r?\n/g, '\n');
      const rev = revisarReceta(id, texto);
      if (!rev.ok) throw new Error(`La receta no pasa la validación${rev.linea ? ' (línea ' + rev.linea + ')' : ''}: ${String(rev.error).replace(/[.\s]*$/, '.')} Corrígela y vuelve a llamar a receta_proponer.`);
      // El porqué llega como lista (una línea por etapa, en orden) o como { nombre de etapa o número: texto }.
      const p = d.porque || {};
      const porque = rev.receta.etapas.map((e, i) => String((Array.isArray(p) ? p[i] : (p[e.nombre] || p[i] || p[i + 1])) || '').trim().slice(0, 400));
      const ses = d.desde ? sesiones.get(String(d.desde)) : null;
      const carpeta = path.join(DATOS, 'propuestas');
      fs.mkdirSync(carpeta, { recursive: true });
      const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const base = path.join(carpeta, `${id}-${sello}`);
      const ficha = { id, sello, yaml: base + '.yaml', porque, resumen: String(d.resumen || '').trim().slice(0, 600),
        sesion: ses ? { id: ses.id, nombre: ses.nombre, carpeta: ses.carpeta } : null, creada: new Date().toISOString(), existe: rev.existe };
      fs.writeFileSync(base + '.yaml', texto, 'utf8');
      fs.writeFileSync(base + '.json', JSON.stringify(ficha, null, 2), 'utf8');
      registrar('receta propuesta', id, ses ? ses.nombre : 'sin sesión');
      enviar('propuesta', Object.assign({}, ficha, { borrador: path.basename(base), texto, receta: rev.receta }));
      return { propuesta: id, borrador: base + '.yaml', existe: rev.existe,
        aviso: 'Quedó como borrador, no entre las recetas: se revisa, corrige y guarda en la ventana de Chocosys.' + (rev.existe ? ' Ya hay una receta con ese id: guardarla la reemplaza (la anterior queda archivada).' : '') };
    }
    case 'flujo_lanzar': {
      const receta = leerRecetas().find((r) => r.id === String(d.receta || ''));
      if (!receta || receta.error) throw new Error('No hay una receta válida con ese id: ' + d.receta);
      const carpeta = String(d.carpeta || receta.carpeta || '').trim();
      if (!carpeta || !fs.existsSync(carpeta)) throw new Error('Falta la carpeta del trabajo o no existe: ' + carpeta);
      const simulacro = d.simulacro !== false;
      // Por el MCP, el flujo cae en su espacio sin cambiar lo que quien usa la app está mirando.
      // modelos: { índice de etapa: 'haiku' | 'opus' } (para probar barato); las demás, como dice la receta.
      // parametros (sprint 23): { índice de etapa con acción: { parámetro: valor } }, pisan los de la receta en esta corrida.
      const f = await lanzarReceta(receta, carpeta, { simulacro, agentes: d.agentes || {}, modelos: d.modelos || {}, parametros: d.parametros || {} }, false);
      registrar('flujo lanzado por mcp', f.id, receta.id, simulacro ? 'simulacro' : 'real');
      return resumenFlujo(f);
    }
    case 'puerta_ver': {
      const f = motor.exportar().find((x) => x.id === d.flujo || x.nombre.toLowerCase().includes(String(d.flujo || '').toLowerCase()));
      if (!f) throw new Error('No hay un flujo así.');
      if (f.estado !== 'puerta') return { flujo: f.nombre, estado: f.estado, nota: 'No está detenido en una puerta.' };
      return { flujo: f.nombre, puerta: f.items[f.actual].nombre, nota: `La aprueba ${quien()} en la ventana; por acá solo se lee.`,
        archivos: motor.traspasosPuerta(f.id).map((a) => ({ ruta: a.ruta, texto: a.texto })) };
    }
    case 'interfaz_vista':
      if (!['inicio', 'lienzo', 'bandeja', 'flujo', 'crm'].includes(d.vista)) throw new Error('La vista es inicio, lienzo, bandeja, flujo o crm.');
      enviar('modo', d.vista);
      return { vista: d.vista };
    case 'interfaz_seleccionar': {
      const s = buscarSesion(d.sesion);
      enviar('seleccionar', s.id);
      return { seleccionada: s.nombre };
    }
    case 'interfaz_estilo': {
      // CSS propio encima del tema Brasa, sin tocar styles.css. Vacío = vuelve al tema de fábrica.
      const css = String(d.css || '');
      fs.writeFileSync(ARCHIVO_PERSONAL, css, 'utf8');
      enviar('personal', css);
      return { archivo: ARCHIVO_PERSONAL, caracteres: css.length };
    }
    case 'interfaz_estilo_leer':
      return { archivo: ARCHIVO_PERSONAL, css: fs.existsSync(ARCHIVO_PERSONAL) ? fs.readFileSync(ARCHIVO_PERSONAL, 'utf8') : '' };
    case 'interfaz_captura': {
      if (!ventana || ventana.isDestroyed()) throw new Error('La ventana no está abierta.');
      const img = await ventana.webContents.capturePage();
      const archivo = path.join(DATOS, 'captura.png');
      fs.writeFileSync(archivo, img.toPNG());
      return { archivo, ancho: img.getSize().width, alto: img.getSize().height };
    }
    case 'interfaz_recargar':
      // Recarga solo la interfaz (renderer): las sesiones siguen vivas en el proceso principal.
      if (!ventana || ventana.isDestroyed()) throw new Error('La ventana no está abierta.');
      setTimeout(() => ventana.webContents.reload(), 150);
      return { recargada: true, nota: 'Los cambios en main.js o flujos.js necesitan cerrar y abrir la app (eso lo hace ' + quien() + ').' };
    case 'registro': {
      const lineas = Math.max(1, Math.min(400, Number(d.lineas) || 60));
      const texto = fs.existsSync(path.join(DATOS, 'registro.txt')) ? fs.readFileSync(path.join(DATOS, 'registro.txt'), 'utf8') : '';
      return { lineas: texto.trim().split(/\r?\n/).slice(-lineas) };
    }
    // CRM: un agente entra solo cuando hace falta; lo que escribe queda en el historial como «mcp».
    case 'crm_hoy':
      return { modo: abrirCrm().modo(), tarjetas: abrirCrm().hoy(d.entorno ? { entorno: String(d.entorno) } : {}, crmCarpeta) };
    case 'crm_requisitos': {
      const c = abrirCrm();
      const n = c.negocio(Number(d.id));
      if (!n) throw new Error('No existe el negocio ' + d.id);
      return { negocio: n.nombre, etapa: n.etapa, ...c.requisitos(n.id, crmCarpeta(n)) };
    }
    case 'crm_lista':
      return { actual: crmActual || abrirCrm() && crmActual, crms: listaCrms().map((x) => ({ nombre: x.nombre, principal: !!x.principal, carpeta: x.carpeta || path.dirname(x.ruta) })) };
    case 'crm_crear':
      return crearCrm(String(d.nombre || ''), 'mcp');
    case 'crm_elegir':
      return { actual: elegirCrm(String(d.nombre || '')) };
    case 'crm_aplicar': {
      if (d.crm) abrirCrm(String(d.crm));
      const r = crmEscribe((c) => c.aplicarPlantilla(String(d.plantilla || ''), d.entorno ? String(d.entorno) : null, 'mcp'));
      return { crm: crmActual, ...r };
    }
    case 'crm_plantillas':
      return abrirCrm().plantillas().map((p) => ({ id: p.id, nombre: p.nombre, embudo: p.embudo, etapas: p.etapas.map((x) => x.nombre), descripcion: p.descripcion }));
    case 'crm_negocios':
      return abrirCrm().negocios(d.entorno ? { entorno: String(d.entorno) } : {}).map((n) => ({ id: n.id, nombre: n.nombre, entorno: n.entorno, empresa: n.empresa, etapa: n.etapa, monto: n.monto, moneda: n.moneda, probabilidad: n.probabilidad, probabilidad_pisada: n.probabilidad_pisada, ponderado: n.ponderado, proxima: n.proxima, carpeta: n.carpeta }));
    case 'crm_negocio': {
      const n = fichaCrm(Number(d.id));
      if (!n) throw new Error('No existe el negocio ' + d.id);
      return n;
    }
    // Sprint 7: la sala directiva. Llevar a la sala y leer su veredicto; dejarlo en el negocio es un clic de quien usa la app.
    case 'sala_llevar': {
      // Por defecto en simulacro; la prueba barata no tiene puerta ni hace nada irreversible, así que parte de verdad.
      // Las exprés (opinión, plan, investigación) no tienen puerta: llevarASala las corre de verdad. Las otras, en simulacro.
      const r = await llevarASala(Object.assign({}, d, { simulacro: d.simulacro === undefined ? d.version !== 'prueba' : d.simulacro !== false }), 'mcp', false);
      // Que se vea: la ventana pasa a la vista Flujo, donde está el kanban con los asientos trabajando.
      enviar('modo', 'flujo');
      return r;
    }
    case 'sala_opiniones':
      return opinionesSala(Number(d.limite) || 30);
    case 'sala_ver': {
      const f = motor.exportar().find((x) => x.id === d.flujo || x.nombre.toLowerCase().includes(String(d.flujo || '').toLowerCase()));
      if (!f || !f.sala) throw new Error('No hay una sala con ese flujo: ' + d.flujo);
      return veredictoSala(f.id);
    }
    case 'crm_actividad_hecha':
      crmEscribe((c) => c.completarActividad(Number(d.id), d.hecha !== false, 'mcp'));
      return { id: Number(d.id), hecha: d.hecha !== false };
    // Sprint 6: solicitudes, proyectos, carpetas y el TRABAJO.md de cada negocio.
    case 'crm_solicitud':
      return crmEscribe((c) => c.crearSolicitud(Object.assign({}, d), 'mcp', crmActual));
    case 'crm_proyectos':
      return abrirCrm().proyectos();
    case 'crm_proyecto_nuevo':
      return crmEscribe((c) => c.crearProyecto(Object.assign({}, d), 'mcp'));
    case 'crm_carpetas':
      return d.raiz_proyectos !== undefined || d.raices ? crmEscribe((c) => c.carpetas({ raiz_proyectos: d.raiz_proyectos, raices: d.raices })) : abrirCrm().carpetas();
    case 'crm_trabajo': {
      const c = abrirCrm();
      const n = c.negocio(Number(d.negocio_id));
      if (!n) throw new Error('No existe el negocio ' + d.negocio_id);
      const ruta = c.escribirSeccion(n.id, String(d.seccion || ''), String(d.texto || ''), 'mcp', crmCarpeta(n));
      enviar('crm', null);
      return { escrito: ruta, seccion: d.seccion };
    }
    case 'crm_actividad_nueva':
      if (!d.que) throw new Error('Falta «que»: qué hay que hacer.');
      return { id: crmEscribe((c) => c.crearActividad({ negocio_id: d.negocio_id ? Number(d.negocio_id) : null, tipo: d.tipo, que: d.que, responsable: d.responsable, vence: d.vence }, 'mcp')) };
    case 'crm_mover': {
      const faltaba = crmEscribe((c) => c.moverEtapa(Number(d.negocio_id), String(d.etapa || ''), 'mcp', crmCarpeta(c.negocio(Number(d.negocio_id)))));
      return { movido: Number(d.negocio_id), etapa: d.etapa, faltaba };
    }
    // Sprint 9 (21-10-2026): la base de clientes sin abrir un negocio, y un negocio que ya existe con su cliente y su carpeta.
    case 'crm_empresa':
      return crmEscribe((c) => c.guardarEmpresa(Object.assign({}, d), 'mcp'));
    case 'crm_empresas': {
      const c = abrirCrm();
      const contactos = c.contactos();
      return c.empresas().filter((e) => !d.tipo || e.tipo === d.tipo).map((e) => ({ id: e.id, nombre: e.nombre, rut: e.rut, tipo: e.tipo, rubro: e.rubro, ciudad: e.ciudad, notas: e.notas,
        contactos: contactos.filter((x) => x.empresa_id === e.id).map((x) => ({ id: x.id, nombre: x.nombre, cargo: x.cargo, correo: x.correo, telefono: x.telefono })) }));
    }
    case 'crm_negocio_cambiar': {
      // El monto y la moneda no se cambian por acá: la plata la decide quien usa la app en la ventana.
      // Sprint 26 (D7): la probabilidad tampoco; se lee en crm_negocios y crm_negocio, y se pisa en la ficha.
      const PERMITIDOS = ['nombre', 'empresa_id', 'contacto_id', 'carpeta', 'cierre_esperado', 'tipo', 'origen', 'proyecto_id'];
      const DEL_USUARIO = ['monto', 'moneda', 'probabilidad'].filter((k) => Object.prototype.hasOwnProperty.call(d.cambios || {}, k));
      const noSe = DEL_USUARIO.length ? ' ' + DEL_USUARIO.join(', ') + ' no se cambia por acá: lo decide ' + (perfil().nombre || 'el usuario') + ' en la ficha del negocio, en la ventana.' : '';
      const cambios = Object.fromEntries(Object.entries(d.cambios || {}).filter(([k]) => PERMITIDOS.includes(k)));
      if (!Object.keys(cambios).length) throw new Error('Nada que cambiar.' + noSe + ' Se puede: ' + PERMITIDOS.join(', ') + '.');
      crmEscribe((c) => c.cambiarNegocio(Number(d.id), cambios, 'mcp'));
      const n = abrirCrm().negocio(Number(d.id));
      return { id: n.id, nombre: n.nombre, empresa: n.empresa, contacto: n.contacto, carpeta: n.carpeta, cambiado: Object.keys(cambios), ...(noSe ? { no_cambiado: DEL_USUARIO, motivo: noSe.trim() } : {}) };
    }
    default:
      throw new Error('Acción desconocida: ' + accion);
  }
}

ipcMain.handle('personal:css', () => (fs.existsSync(ARCHIVO_PERSONAL) ? fs.readFileSync(ARCHIVO_PERSONAL, 'utf8') : ''));

ipcMain.handle('fuentes:leer', () => tipografia.leer(DATOS, __dirname));

ipcMain.handle('sesiones:lista', () => ({ sesiones: [...sesiones.values()].map(publica), flujos: motor.exportar(), espacios, espacioActual }));

// Espacios y posiciones en el lienzo (PRD-03).
// Los entornos (Empresa, Consultora…) son pestañas con su carpeta. La lista vive en entornos.json junto al estado,
// no en el código: [{ "nombre": "Empresa", "carpeta": "C:\\…\\empresa" }, …]. Sin ese archivo no hay entornos.
// «libre: true» (27-10-2026, el Centro de control): una sesión de ese entorno nunca queda a cargo de nadie, aunque la
// abra la central o una coordinadora, así que abre, cierra, enlaza y programa como la central.
const ARCHIVO_ENTORNOS = path.join(DATOS, 'entornos.json');
function leerEntornos() {
  try {
    const lista = JSON.parse(fs.readFileSync(ARCHIVO_ENTORNOS, 'utf8'));
    return (Array.isArray(lista) ? lista : []).filter((x) => x && x.nombre).map((x) => Object.assign({ nombre: String(x.nombre), carpeta: String(x.carpeta || ''), existe: !!x.carpeta && fs.existsSync(x.carpeta) }, x.guia ? { guia: String(x.guia) } : {}, x.libre ? { libre: true } : {}));
  } catch (err) { return []; }
}
// Obsidian opcional (sprint 20): cada entorno suma su guía (index.md), la bóveda donde vive y la última línea de su
// log.md. Sin obsidian.json las bóvedas vienen vacías y solo se ve lo de antes. Una Chocosys de prueba lee primero el
// obsidian.json de sus datos, para probar sin depender de la Obsidian del computador.
const obsidian = require('./obsidian');
const bovedasObsidian = () => obsidian.leerBovedas([datosPrueba ? path.join(DATOS, 'obsidian.json') : '', process.env.APPDATA ? path.join(process.env.APPDATA, 'obsidian', 'obsidian.json') : '']);
const entornosConGuia = () => obsidian.completarEntornos(leerEntornos(), bovedasObsidian());
ipcMain.handle('entornos:lista', () => entornosConGuia());
// Abre un archivo (o la guía del entorno con ese nombre) en Obsidian, solo si está dentro de una bóveda (D3). En una
// Chocosys de prueba no abre nada: devuelve la dirección y la anota en el registro (D6).
ipcMain.handle('obsidian:abrir', async (e, destino) => {
  const ent = entornosConGuia().find((x) => x.nombre.toLowerCase() === String(destino || '').toLowerCase());
  const bovedas = bovedasObsidian();
  // T-A100: un entorno sin guía en una bóveda se nombra en el error (antes decía «falta la ruta»).
  const r = !(ent && !ent.obsidian) ? obsidian.direccionPara(ent ? ent.guia : destino, bovedas)
    : { error: bovedas.length ? `el entorno ${ent.nombre} no tiene guía dentro de una bóveda de Obsidian` : 'no hay Obsidian en este computador' };
  if (r.error) { registrar('obsidian: no se abre', String(destino || ''), r.error); return { ok: false, error: r.error }; }
  if (datosPrueba) { registrar('obsidian (prueba, no se abre)', r.url); return { ok: true, url: r.url, prueba: true }; }
  try { await shell.openExternal(r.url); } catch (err) { registrar('obsidian: no se pudo abrir', err.message); return { ok: false, error: err.message }; }
  registrar('obsidian abierto', r.url);
  return { ok: true, url: r.url };
});
// H5 (sprint 20): lo que deja una sesión, un flujo o una sala, anotado en el log.md de su entorno (D4, D7 y D11). Solo
// entornos con la guía dentro de una bóveda; nunca un simulacro. Una Chocosys de prueba solo escribe dentro de la
// carpeta temporal del sistema, para que ninguna prueba toque el log.md real de un entorno. Si falla, solo se registra.
function anotarEntorno(ent, que, donde) {
  if (!ent) return;
  const dir = path.dirname(ent.guia);
  if (datosPrueba && !obsidian.dentroDe(dir, require('os').tmpdir())) { registrar('log.md (prueba, fuera de TEMP: no se anota)', dir, que); return; }
  const r = obsidian.anotarEnLog(dir, que, donde);
  registrar(r.ok ? 'log.md anotado' : 'log.md sin anotar', dir, r.ok ? r.linea : r.error);
}
const entornoDeEspacio = (id) => { const e = espacioPorId(id); return e ? (e.entorno || e.nombre) : ''; };
// Sesión suelta que se cierra con la × después de trabajar (las de un flujo las anota su flujo).
function anotarSesionCerrada(s) {
  if (!s || s.flujo || (s.turnos || 0) < obsidian.MIN_TURNOS_PARA_ANOTAR) return;
  try {
    const ent = obsidian.entornoConGuia(entornoDeEspacio(s.espacio), entornosConGuia());
    const orden = s.ultimo && !String(s.ultimo).startsWith('<') ? ': «' + obsidian.unaLinea(s.ultimo, 100) + '»' : '';
    // T-A100: una sesión nombrada por su orden no repite la orden en la línea (el nombre es su comienzo, con «…»).
    const raiz = recortar(String(s.nombre || ''), 200).replace(/…$/, '');
    const repite = orden && raiz && recortar(String(s.ultimo), 100000).startsWith(raiz);
    const quien = repite ? 'sesión' : `sesión «${s.nombre}»`;
    anotarEntorno(ent, `${quien} cerrada tras ${s.turnos} ${s.turnos === 1 ? 'turno' : 'turnos'}${orden}`, s.carpeta || '');
  } catch (err) { registrar('log.md: sesión sin anotar', err.message); }
}
// Un flujo se anota una vez, cuando pasa a «completo» en esta corrida. Los que ya venían completos al cargar se siembran
// antes, para no repetirlos en cada arranque.
const estadoFlujoVisto = new Map();
let flujosSembrados = false;
function sembrarFlujosVistos() { for (const f of motor.todos()) estadoFlujoVisto.set(f.id, f.estado); flujosSembrados = true; }
function revisarFlujosCompletos() {
  if (!flujosSembrados) return;
  for (const f of motor.todos()) {
    const antes = estadoFlujoVisto.get(f.id);
    estadoFlujoVisto.set(f.id, f.estado);
    if (f.estado === 'completo' && antes !== 'completo' && !f.simulacro) anotarFlujo(f);
  }
}
// D11: la sala y la segunda opinión se anotan al completarse su flujo con el veredicto, en el entorno del negocio (no al
// apretar «Dejar como nota», que es opcional). Un flujo cualquiera, en el entorno de su receta o, si no, de su pestaña.
function anotarFlujo(f) {
  try {
    const entornos = entornosConGuia();
    if (f.sala) {
      let negocio = null;
      if (f.sala.negocio_id) { try { negocio = crmSinMover(f.sala.crm).negocio(Number(f.sala.negocio_id)); } catch (e) { negocio = null; } }
      const ent = negocio && obsidian.entornoConGuia(negocio.entorno, entornos);
      if (ent) {
        let s = {};
        try { s = JSON.parse(fs.readFileSync(path.join(f.sala.carpeta, 'sala.json'), 'utf8')); } catch (e) { /* sin sala.json */ }
        const j = leerVeredicto(f.sala.carpeta).veredicto;
        const etiqueta = s.profundidad && PROFUNDIDAD_SALA[s.profundidad] ? 'segunda opinión (' + PROFUNDIDAD_SALA[s.profundidad].nombre + ')' : `sala directiva (${f.sala.version || 'sala'})`;
        anotarEntorno(ent, `${etiqueta} sobre «${negocio.nombre}»: ${j ? (j.veredicto || '?') + ' (' + (j.puntaje ?? '?') + '/10)' : 'sin VEREDICTO.json'}`, f.sala.carpeta);
        return;
      }
    }
    const receta = leerRecetas().find((r) => r.id === f.receta);
    const ent = (receta && obsidian.entornoDeCarpeta(receta.entorno, entornos)) || obsidian.entornoConGuia(entornoDeEspacio(f.espacio), entornos);
    const nEtapas = f.items.filter((it) => it.tipo !== 'puerta').length;
    anotarEntorno(ent, `flujo «${f.nombre}» completo (${nEtapas} ${nEtapas === 1 ? 'etapa' : 'etapas'})`, f.carpeta);
  } catch (err) { registrar('log.md: flujo sin anotar', f.id, err.message); }
}
// Abrir un entorno: su pestaña si ya existe (por nombre); si no, se crea con su carpeta.
ipcMain.handle('entorno:abrir', (e, nombre) => {
  const ent = leerEntornos().find((x) => x.nombre.toLowerCase() === String(nombre || '').toLowerCase());
  if (!ent) return null;
  let esp = buscarEspacio(ent.nombre);
  if (!esp) esp = nuevoEspacio(ent.nombre, ent.existe ? ent.carpeta : '');
  else if (!esp.carpeta && ent.existe) esp.carpeta = ent.carpeta;
  espacioActual = esp.id;
  guardar();
  difundir();
  return esp.id;
});
ipcMain.handle('espacio:nuevo', (e, nombre) => {
  const nuevo = nuevoEspacio(nombre);
  espacioActual = nuevo.id;
  guardar();
  difundir();
  return nuevo;
});
// Borrar un espacio no cierra nada: sus sesiones y flujos pasan a otro espacio. Devuelve el id de la pestaña que
// queda a la vista, o null si no se borró.
// Sprint 25 (H1): el último también se borra, pero solo vacío (la ventana cierra antes lo suyo con «Cerrar N y
// borrar»: no hay a dónde pasarlo). Entonces devuelve { actual: null } y la ventana queda en el Inicio.
ipcMain.handle('espacio:borrar', (e, id) => borrarEspacio(id));
function borrarEspacio(id) {
  const i = espacios.findIndex((x) => x.id === id);
  if (i < 0) return null;
  if (espacios.length === 1) {
    const ocupado = [...sesiones.values()].some((s) => s.espacio === id) || motor.todos().some((f) => f.espacio === id);
    if (ocupado) return null;
    espacios.splice(i, 1);
    espacioActual = null;
    registrar('espacio borrado', id, 'era el último');
    guardar();
    difundir();
    return { actual: null };
  }
  const destino = espacios[i === 0 ? 1 : 0];
  for (const s of sesiones.values()) if (s.espacio === id) { s.espacio = destino.id; s.pos = null; }
  for (const f of motor.todos()) if (f.espacio === id) { f.espacio = destino.id; f.pos = null; }
  espacios.splice(i, 1);
  if (espacioActual === id) espacioActual = destino.id;
  registrar('espacio borrado', id, 'contenido a', destino.id);
  guardar();
  difundir();
  return destino.id;
}
// Un flujo de una receta con «espacio» cae en ese espacio (se crea si no existe).
function espacioPorNombre(nombre) {
  if (!nombre) return null;
  return espacios.find((x) => x.nombre.toLowerCase() === nombre.toLowerCase()) || nuevoEspacio(nombre);
}
// Lanzar una receta en su espacio. Desde la ventana, la vista se va a ese espacio; desde el MCP, no.
function lanzarReceta(receta, carpeta, ajustes, irAlEspacio) {
  // Sprint 23: un parámetro que falta o una acción que no existe se dicen antes de crear una pestaña (lanza Error).
  armarAcciones(receta, ajustes && ajustes.parametros);
  // Sprint 25 (D3): sin «espacio:» en la receta y sin pestaña a la vista, el flujo cae en la pestaña de su carpeta.
  const esp = espacioPorNombre(receta.espacio) || espacioPorId(espacioActual) || espacioPara(carpeta || receta.carpeta);
  if (irAlEspacio) espacioActual = esp.id;
  return motor.lanzar(receta, carpeta, Object.assign({}, ajustes, { espacio: esp.id }));
}
ipcMain.handle('espacio:actual', (e, id) => {
  if (espacioPorId(id)) { espacioActual = id; guardar(); difundir(); }
});
ipcMain.handle('espacio:renombrar', (e, id, nombre) => {
  const x = espacioPorId(id);
  if (x && typeof nombre === 'string' && nombre.trim()) { x.nombre = nombre.trim().slice(0, 40); guardar(); difundir(); }
});
ipcMain.handle('espacio:vista', (e, id, vista) => {
  const x = espacioPorId(id);
  if (x && vista) { x.vista = { x: Number(vista.x) || 0, y: Number(vista.y) || 0, zoom: Number(vista.zoom) || 1 }; guardar(); }
});
// La carpeta del espacio: donde abre las sesiones nuevas de la barra de comando. Se pregunta una vez.
ipcMain.handle('espacio:carpeta', async (e, id, cambiar) => {
  const x = espacioPorId(id);
  if (!x) return null;
  if (x.carpeta && fs.existsSync(x.carpeta) && !cambiar) return x.carpeta;
  const carpeta = await elegirCarpeta(`Carpeta del espacio «${x.nombre}»`);
  if (!carpeta) return null;
  x.carpeta = carpeta;
  guardar();
  difundir();
  return x.carpeta;
});
// fija (sprint 17): la ventana se movió o estiró a mano y el mosaico la deja donde está hasta «Ordenar».
ipcMain.handle('sesion:posicion', (e, id, pos, fija) => {
  const s = sesiones.get(id);
  if (s && pos) { s.pos = { x: Math.round(pos.x), y: Math.round(pos.y), w: Math.round(pos.w), h: Math.round(pos.h) }; if (typeof fija === 'boolean') s.fija = fija; guardar(); }
});
ipcMain.handle('flujo:posicion', (e, fid, pos) => {
  const f = motor.obtener(fid);
  if (f && pos) { f.pos = { x: Math.round(pos.x), y: Math.round(pos.y) }; guardar(); }
});
ipcMain.handle('orden:enviar', (e, id, texto) => escribirEn(id, String(texto || '').replace(/\s+/g, ' ').trim()));
ipcMain.handle('recetas:lista', () => leerRecetas());
// Sprint 21: el editor de propuestas valida mientras se escribe y guarda con guardarReceta.
ipcMain.handle('recetas:validar', (e, id, texto) => revisarReceta(id, texto));
ipcMain.handle('recetas:guardar', (e, id, texto, extra) => {
  let r;
  try { r = Object.assign({ ok: true }, guardarReceta(id, texto, extra, 'ventana')); } catch (err) { return { ok: false, error: err.reason || err.message, linea: err.mark ? err.mark.line + 1 : null }; }
  // Guardada desde una propuesta (sprint 21, H4): el borrador ya no está pendiente y pasa a propuestas\_archivo\.
  if (extra && extra.borrador) r.archivada = archivarPropuesta(extra.borrador, id);
  return r;
});
// Sprint 21 (H4): los borradores que dejó receta_proponer. Pendiente = el .yaml sigue en propuestas\ (no en _archivo).
// Se nombran «<id>-<sello>»; solo ese nombre viaja desde la ventana, así nada fuera de propuestas\ se puede mover.
const BORRADOR = /^[a-z0-9][a-z0-9-]*-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;
function carpetaPropuestas() { return path.join(DATOS, 'propuestas'); }
function propuestasPendientes() {
  const carpeta = carpetaPropuestas();
  if (!fs.existsSync(carpeta)) return [];
  // La más nueva primero: el sello son los últimos 19 caracteres del nombre.
  const sello = (n) => n.slice(-24, -5);
  return fs.readdirSync(carpeta).filter((n) => n.endsWith('.yaml') && BORRADOR.test(n.slice(0, -5))).sort((a, b) => sello(b).localeCompare(sello(a))).map((n) => {
    const base = n.slice(0, -5);
    let ficha = {};
    try { ficha = JSON.parse(fs.readFileSync(path.join(carpeta, base + '.json'), 'utf8')); } catch (err) { /* sin ficha: sale con lo mínimo */ }
    const texto = fs.readFileSync(path.join(carpeta, n), 'utf8');
    const id = ficha.id || base.replace(/-\d{4}-\d{2}-\d{2}T[\d-]+$/, '');
    // Se revisa de nuevo: la receta pudo guardarse por otro lado (cambia «existe») o el borrador editarse a mano.
    const rev = revisarReceta(id, texto);
    return Object.assign({}, ficha, { id, borrador: base, texto, receta: rev.ok ? rev.receta : null, existe: !!rev.existe, error: rev.ok ? null : rev.error });
  });
}
// Retirar no es borrar: el .yaml y su .json pasan a propuestas\_archivo\; con «guardada» la ficha anota con qué id.
function archivarPropuesta(base, guardadaComo) {
  base = String(base || '');
  if (!BORRADOR.test(base)) return false;
  const carpeta = carpetaPropuestas();
  const destino = path.join(carpeta, '_archivo');
  fs.mkdirSync(destino, { recursive: true });
  let movido = false;
  for (const ext of ['.yaml', '.json']) {
    const desde = path.join(carpeta, base + ext);
    if (!fs.existsSync(desde)) continue;
    if (ext === '.json') {
      try {
        const ficha = JSON.parse(fs.readFileSync(desde, 'utf8'));
        Object.assign(ficha, guardadaComo ? { guardada: guardadaComo } : { descartada: true }, { cerrada: new Date().toISOString() });
        fs.writeFileSync(desde, JSON.stringify(ficha, null, 2), 'utf8');
      } catch (err) { /* la ficha rota se mueve igual */ }
    }
    fs.renameSync(desde, path.join(destino, base + ext));
    movido = true;
  }
  if (movido) registrar(guardadaComo ? 'propuesta guardada' : 'propuesta descartada', base);
  return movido;
}
ipcMain.handle('propuestas:lista', () => propuestasPendientes());
ipcMain.handle('propuestas:descartar', (e, base) => archivarPropuesta(base, null));
// Sprint 21 (H1): «Hacer flujo» le escribe a la sesión la orden fija para que proponga su receta con receta_proponer.
// Manda la copia de los datos si existe (se personaliza sin tocar el programa). Solo con la sesión quieta: trabajando,
// la orden se encolaría; con una pregunta abierta, el texto respondería la pregunta.
function ordenHacerFlujo() {
  const propia = path.join(DATOS, 'orden-hacer-flujo.md');
  const archivo = fs.existsSync(propia) ? propia : path.join(__dirname, 'config', 'orden-hacer-flujo.md');
  return fs.readFileSync(archivo, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
}
ipcMain.handle('sesion:hacer-flujo', (e, id) => {
  const s = sesiones.get(id);
  if (!s) return { ok: false, motivo: 'no-existe' };
  if (!procesos.has(id)) return { ok: false, motivo: 'cerrada' };
  if (s.estado === 'trabajando') return { ok: false, motivo: 'trabajando' };
  if (s.estado === 'necesita') return { ok: false, motivo: 'pregunta' };
  let orden;
  try { orden = ordenHacerFlujo(); } catch (err) { registrar('hacer flujo: no se pudo leer la orden', err.message); return { ok: false, motivo: 'sin-orden' }; }
  if (!orden || !escribirEn(id, orden)) return { ok: false, motivo: 'cerrada' };
  registrar('hacer flujo', s.nombre);
  return { ok: true };
});
ipcMain.handle('carpeta:elegir', (e, base) => elegirCarpeta('Carpeta del trabajo', base));
ipcMain.handle('flujo:lanzar', async (e, recetaId, carpeta, ajustes) => {
  const receta = leerRecetas().find((r) => r.id === recetaId);
  if (!receta || receta.error || !carpeta || !fs.existsSync(carpeta)) return null;
  return lanzarReceta(receta, carpeta, ajustes, true);
});
ipcMain.handle('carpeta:abrir', (e, ruta) => { if (ruta && fs.existsSync(ruta)) abrirSinEjecutar(ruta); });
// CRM: desde la ventana escribe quien usa la app (cuando entre otra persona, por su propia vista y con su nombre).
const AUTOR_VENTANA = perfil().nombre || 'ventana';
ipcMain.handle('crm:resumen', (e, entorno) => {
  const c = abrirCrm();
  const embudo = c.embudoDe(entorno || null);
  return { modo: c.modo(), ruta: c.ruta, crm: crmActual, crms: listaCrms().map((x) => x.nombre), embudo, embudos: c.embudos(), etapas: c.etapas(embudo), todasEtapas: c.etapas(), plantilla: c.config('plantilla:' + embudo), empresas: c.empresas(), contactos: c.contactos(),
    proyectos: c.proyectos(), carpetas: c.carpetas(), origenes: c.ORIGENES };
});
ipcMain.handle('crm:elegir', (e, nombre) => elegirCrm(String(nombre || '')));
ipcMain.handle('crm:nuevo', (e, nombre) => crearCrm(nombre, AUTOR_VENTANA));
// «Impulsar con IA»: una sesión de Claude Code en la carpeta de los CRM. Lo primero que pregunta es el nombre del
// proyecto; después crea el CRM y lo configura con las herramientas crm_* del MCP de Chocosys, aplicando solo con OK.
// Las instrucciones del asistente no van en el chat: van en el CLAUDE.md de la carpeta de los CRM (Claude Code lo lee
// solo). Así el chat parte con un saludo corto. Si ya hay un asistente vivo en esta pestaña, se reusa (un clic = uno).
const NOMBRE_ASISTENTE = 'crm · asistente';
const saludoDefinir = (n) => `Hola. Quiero definir el encargo «${n.nombre}» (negocio ${n.id} del CRM «${crmActual}»): qué hay que entregar, a quién, para cuándo y cómo lo seguimos.`;
ipcMain.handle('crm:impulsar', async (e, entorno, nuevo, negocioId) => {
  const vivo = [...sesiones.values()].find((s) => s.nombre === NOMBRE_ASISTENTE && s.espacio === espacioActual && (s.viva || !s.iniciada));
  // «Definir con IA» con un asistente ya abierto: se le pasa el encargo como una orden más (se encola si trabaja).
  if (vivo && negocioId) { const n = abrirCrm().negocio(Number(negocioId)); if (n) escribirEn(vivo.id, saludoDefinir(n)); }
  if (vivo) return { id: vivo.id, reusada: true };
  const raiz = carpetaCrms(cfgCrm());
  fs.mkdirSync(raiz, { recursive: true });
  const perfil = fs.readFileSync(path.join(__dirname, 'crm', 'asistente', 'CLAUDE.md'), 'utf8');
  const destino = path.join(raiz, 'CLAUDE.md');
  if (!fs.existsSync(destino) || fs.readFileSync(destino, 'utf8') !== perfil) fs.writeFileSync(destino, perfil, 'utf8');
  abrirCrm();
  // Desde «Agregar CRM» ya se sabe que es uno nuevo: el asistente pide nombre y negocio de una vez.
  const definir = negocioId ? abrirCrm().negocio(Number(negocioId)) : null;
  const saludo = definir ? saludoDefinir(definir)
    : nuevo ? 'Hola. Quiero armar un CRM nuevo.'
      : `Hola. Está abierto el CRM «${crmActual}»${entorno ? ` en la pestaña ${entorno}` : ''}. Quiero configurarlo o armar otro.`;
  const s = await nuevaSesion(raiz, saludo, { nombre: NOMBRE_ASISTENTE, espacio: espacioActual });
  abrirAlMedir(s.id, 90, 26);
  return { id: s.id, carpeta: raiz };
});
ipcMain.handle('crm:negocios', (e, filtro) => abrirCrm().negocios(filtro || {}));
ipcMain.handle('crm:negocio', (e, id) => fichaCrm(Number(id)));
// La ficha completa: antes de mostrarla se lee la plata de sus archivos (solo si cambiaron desde la última vez).
function fichaCrm(id) {
  const c = abrirCrm();
  const n0 = c.negocio(id);
  if (!n0) return null;
  const carpetaAbs = crmCarpeta(n0);
  try { c.leerPlata(id, carpetaAbs); } catch (err) { registrar('plata sin leer', n0.nombre, err.message); }
  const n = c.negocio(id);
  n.carpetaAbs = carpetaAbs;
  n.requisitos = c.requisitos(n.id, carpetaAbs);
  n.conPlata = !!c.config('plata:' + n.embudo);
  return n;
}
// ── Sala directiva (sprint 7) ──────────────────────────────────────────────
// «Llevar a la sala» arma la carpeta de la corrida (la decisión, el contexto del negocio y los perfiles de los asientos)
// y lanza la receta. Los asientos solo leen y escriben su tarjeta ahí. La puerta antes del veredicto la aprueba quien usa la app,
// y el veredicto queda en el negocio recién cuando él aprieta «Dejar como nota».
const SKILL_SALA = path.join(require('os').homedir(), '.claude', 'skills', 'sala-directiva');
// Desde el sprint 11 (21-10-2026), el directorio vive en app\config\directorio.json y se relee en cada uso (cargarConfigSala):
// asesores, cuartetos por tema y profundidades se cambian editando ese archivo, sin reiniciar. Lo de abajo es el respaldo si
// el archivo falta o está mal escrito (los mismos valores del sprint 10).
let ASIENTOS_SALA = { caja: 'Caja', comercial: 'Comercial', operacion: 'Operación', metodo: 'Método', 'tu-tiempo': 'Tu tiempo', legal: 'Legal' };
let MARCO_SALA = { caja: 'con el marco de Buffett', comercial: 'con el marco de Hormozi', operacion: 'con el marco de Goldratt', metodo: 'con el marco de Wickman', 'tu-tiempo': 'con el marco de Martell', legal: 'marco propio (ley chilena)' };
// Los 4 de la versión rápida según el tema (skill sala-directiva): cada cuarteto trae al menos dos pares que chocan.
let TEMAS_SALA = { plata: ['caja', 'comercial', 'operacion', 'tu-tiempo'], cliente: ['comercial', 'operacion', 'legal', 'caja'],
  legal: ['legal', 'metodo', 'comercial', 'caja'], operacion: ['operacion', 'metodo', 'caja', 'tu-tiempo'], personal: ['tu-tiempo', 'caja', 'metodo', 'comercial'] };
let RECETA_SALA = { rapida: 'sala-rapida', completa: 'sala-directiva', prueba: 'prueba-sala', expres: 'sala-expres', investigacion: 'sala-investigada' };
let PROFUNDIDAD_POR_DEFECTO = 'plan';
// «Segunda opinión» (sprint 10, 21-10-2026): la profundidad elige la receta y le dice a la sala qué entregar. Por defecto, «plan».
let PROFUNDIDAD_SALA = {
  opinion: { version: 'expres', nombre: 'Opinión', pide: 'Opinión sobre una idea precisa: veredicto, por qué, la disidencia y como máximo 2 pasos. VEREDICTO.md de hasta 350 palabras.' },
  plan: { version: 'expres', nombre: 'Opinión y plan de acción', pide: 'Opinión y un plan de acción de 3 a 6 pasos con dueño y fecha, la prueba más barata y cuándo matar la idea.' },
  investigacion: { version: 'investigacion', nombre: 'Con investigación en internet', pide: 'Investigar en internet antes de opinar (INVESTIGACION.md con cada dato, su fuente, su fecha y su confiabilidad), y después opinión y plan de acción con las fuentes usadas.' },
  debate: { version: 'rapida', nombre: 'Debate del directorio', pide: 'La versión rápida del método: 4 asientos en sesiones aparte, 2 rondas y una puerta antes del veredicto.' },
  completo: { version: 'completa', nombre: 'Directorio completo', pide: 'La versión completa del método: los 6 asientos, 3 rondas y una puerta antes del veredicto.' }
};
// Las exprés no tienen puerta ni hacen nada irreversible: corren de verdad, nunca en simulacro (así su veredicto se puede anotar).
let SALA_SIN_PUERTA = ['expres', 'investigacion', 'prueba'];
// T-A91 (22-10-2026): en la instalada, app\config\ queda dentro de app.asar (se lee, no se edita). Lo personalizable
// se lee de <DATOS>\config\ si hay copia ahí; si no, del programa. La copia nace al apretar «Abrir» en la instalada.
const CONFIG_PROPIA = path.join(DATOS, 'config');
const archivoConfig = (nombre) => { const propia = path.join(CONFIG_PROPIA, nombre); return fs.existsSync(propia) ? propia : path.join(__dirname, 'config', nombre); };
// Lo que abre «Abrir»: corriendo desde la carpeta, el archivo del programa (como siempre); en la instalada, la copia.
function configEditable(nombre) {
  const propia = path.join(CONFIG_PROPIA, nombre);
  if (!app.isPackaged || fs.existsSync(propia)) return archivoConfig(nombre);
  fs.mkdirSync(CONFIG_PROPIA, { recursive: true });
  fs.writeFileSync(propia, fs.readFileSync(path.join(__dirname, 'config', nombre)));   // readFileSync sí lee dentro del asar
  registrar('copia personalizable creada', propia);
  return propia;
}
let configSala = null;   // lo último que se leyó bien, para la ventana (formularios de la ficha y del panel)
// Relee directorio.json. Si está mal escrito, deja lo que había y lo anota: un error de tipeo no apaga la segunda opinión.
function cargarConfigSala() {
  try {
    const j = JSON.parse(fs.readFileSync(archivoConfig('directorio.json'), 'utf8').replace(/^﻿/, ''));
    if (!Array.isArray(j.asientos) || j.asientos.length < 2 || !Array.isArray(j.temas) || !Array.isArray(j.profundidades) || !j.profundidades.length)
      throw new Error('le faltan asientos, temas o profundidades');
    const ids = new Set(j.asientos.map((a) => String(a.id)));
    for (const t of j.temas) for (const a of t.asientos || []) if (!ids.has(a)) throw new Error(`el tema «${t.id}» nombra un asiento que no existe: ${a}`);
    const recetas = Object.assign({}, RECETA_SALA, j.recetas || {});
    for (const p of j.profundidades) if (!recetas[p.version]) throw new Error(`la profundidad «${p.id}» usa una versión sin receta: ${p.version}`);
    ASIENTOS_SALA = Object.fromEntries(j.asientos.map((a) => [String(a.id), String(a.nombre)]));
    MARCO_SALA = Object.fromEntries(j.asientos.map((a) => [String(a.id), String(a.marco || '')]));
    TEMAS_SALA = Object.fromEntries(j.temas.map((t) => [String(t.id), (t.asientos || []).map(String)]));
    RECETA_SALA = recetas;
    PROFUNDIDAD_SALA = Object.fromEntries(j.profundidades.map((p) => [String(p.id), { version: String(p.version), nombre: String(p.nombre), pide: String(p.pide || ''), ayuda: String(p.ayuda || '') }]));
    PROFUNDIDAD_POR_DEFECTO = PROFUNDIDAD_SALA[j.profundidad_por_defecto] ? j.profundidad_por_defecto : Object.keys(PROFUNDIDAD_SALA)[0];
    if (Array.isArray(j.sin_puerta)) SALA_SIN_PUERTA = j.sin_puerta.map(String);
    configSala = { asientos: j.asientos.map((a) => [String(a.id), String(a.nombre), String(a.pregunta || '')]), temas: j.temas.map((t) => [String(t.id), String(t.nombre || t.id), (t.asientos || []).map(String)]),
      profundidades: j.profundidades.map((p) => [String(p.id), String(p.nombre), String(p.ayuda || ''), SALA_SIN_PUERTA.includes(String(p.version)), String(p.version)]),
      por_defecto: PROFUNDIDAD_POR_DEFECTO, error: null };
  } catch (e) {
    const ruta = archivoConfig('directorio.json');   // T-A101: el aviso nombra el archivo que falló (la copia de los datos o el de la app)
    registrar('directorio.json no se pudo leer', ruta + ': ' + e.message);
    // Si nunca se leyó bien, la ventana recibe los valores de respaldo de arriba.
    const base = configSala && configSala.asientos ? configSala : { asientos: Object.entries(ASIENTOS_SALA).map(([id, n]) => [id, n, '']),
      temas: Object.entries(TEMAS_SALA).map(([id, a]) => [id, id.charAt(0).toUpperCase() + id.slice(1), a]),
      profundidades: Object.entries(PROFUNDIDAD_SALA).map(([id, p]) => [id, p.nombre, p.ayuda || '', SALA_SIN_PUERTA.includes(p.version), p.version]), por_defecto: PROFUNDIDAD_POR_DEFECTO };
    configSala = Object.assign({}, base, { error: ruta + ': ' + e.message, ruta });
  }
  return configSala;
}
const carpetaSalas = () => cfgCrm().carpeta_salas || path.join(DATOS, 'salas');
// Escribir en el CRM de una sala sin cambiar el que quien usa la app está mirando.
function crmSinMover(nombre) { const antes = crmActual; const c = abrirCrm(nombre); crmActual = antes; return c; }
const dma = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : iso || '—');
const pesos = (v, m) => (v === null || v === undefined ? '—' : (m === 'USD' ? 'USD ' + Number(v).toFixed(2) : '$' + Math.round(v).toLocaleString('es-CL')));

// Lo que la sala sabe del negocio: datos, plata con su origen, actividades, historial y el TRABAJO.md. Solo lo que
// ya está en el CRM y en su carpeta; nada de afuera.
function contextoSala(n, archivos, c) {
  const l = ['# Contexto de la decisión', ''];
  if (!n) l.push('La decisión no viene de un negocio del CRM.', '');
  else {
    l.push('## El negocio', '', '| | |', '|---|---|', `| **Negocio** | ${n.nombre} (n.° ${n.id}) |`, `| **Etapa** | ${n.etapa} (embudo ${n.embudo}) |`,
      `| **Cliente** | ${n.empresa ? n.empresa + (n.empresa_tipo === 'interno' ? ' (interno)' : '') : '—'}${n.contacto ? ' · ' + n.contacto : ''} |`,
      `| **Tipo** | ${n.tipo || '—'} |`, `| **Proyecto** | ${n.proyecto || '—'} |`, `| **Para cuándo** | ${dma(n.cierre_esperado)} |`,
      `| **Monto esperado** | ${pesos(n.monto, n.moneda)} |`, `| **Carpeta** | ${n.carpetaAbs || n.carpeta || '—'} |`, '');
    const k = n.control;
    l.push('## Plata (leída de los archivos)', '');
    if (k && (k.costo !== null || k.venta !== null || (k.fuentes || []).length)) {
      l.push(`- Costo: ${pesos(k.costo, k.moneda)}${Object.entries(k.otras || {}).map(([m, v]) => ' + ' + pesos(v, m)).join('')}`, `- Venta: ${pesos(k.venta, k.moneda)}`);
      for (const f of k.fuentes || []) if (f.que !== 'error') l.push(`- ${f.que}: ${pesos(f.valor, f.moneda)} · ${path.basename(f.archivo)}, celda ${f.celda} de «${f.hoja}»`);
    } else l.push('- Sin plata leída de archivos.');
    l.push('', '## Actividades pendientes', '');
    const pend = (n.actividades || []).filter((a) => !a.hecha);
    l.push(...(pend.length ? pend.map((a) => `- ${a.tipo}: ${a.que}${a.responsable ? ' · ' + a.responsable : ''}${a.vence ? ' · vence ' + dma(a.vence) : ''}`) : ['- Ninguna.']));
    l.push('', '## Hechas y notas (las últimas 10)', '');
    l.push(...(n.actividades || []).filter((a) => a.hecha).slice(-10).map((a) => `- ${a.tipo}: ${a.que}`));
    l.push('', '## Historial (los últimos 15 cambios)', '');
    l.push(...(n.historial || []).slice(0, 15).map((h) => `- ${dma(h.cuando)} · ${h.autor} · ${h.accion} ${h.campo || ''}: ${h.antes ?? '—'} → ${h.despues ?? '—'}`));
    const extras = [];
    if (n.carpetaAbs) extras.push(path.join(n.carpetaAbs, 'TRABAJO.md'));
    if (n.proyecto_id) { const p = c.proyectos().find((x) => x.id === n.proyecto_id); if (p && p.carpeta) extras.push(path.join(p.carpeta, 'PROYECTO.md')); }
    archivos = [...extras, ...(archivos || [])];
  }
  // Archivos de texto que se pasan enteros (el TRABAJO.md, el PROYECTO.md o los que se indiquen): como máximo 4.
  for (const ruta of [...new Set(archivos || [])].slice(0, 4)) {
    if (!/\.(md|txt)$/i.test(ruta) || !fs.existsSync(ruta)) continue;
    let texto = fs.readFileSync(ruta, 'utf8').replace(/^﻿/, '');
    if (texto.length > 12000) texto = texto.slice(0, 12000) + '\n\n*(recortado a 12.000 caracteres)*';
    l.push('', `## Archivo: ${ruta}`, '', texto.replace(/^#/gm, '###'));
  }
  return l.join('\r\n') + '\r\n';
}

async function llevarASala(d, autor, irAlEspacio) {
  const decision = String(d.decision || '').trim();
  if (!decision) throw new Error('Falta la decisión: qué hay que decidir.');
  cargarConfigSala();
  // La profundidad manda; «version» queda para quien la pida directo (prueba, rápida o completa). Sin ninguna, la por defecto.
  const prof = PROFUNDIDAD_SALA[d.profundidad] ? d.profundidad : (RECETA_SALA[d.version] ? null : PROFUNDIDAD_POR_DEFECTO);
  const version = prof ? PROFUNDIDAD_SALA[prof].version : d.version;
  let asientos = (Array.isArray(d.asientos) ? d.asientos : []).filter((a) => ASIENTOS_SALA[a]);
  if (!asientos.length) asientos = version === 'completa' ? Object.keys(ASIENTOS_SALA) : (TEMAS_SALA[d.tema] || TEMAS_SALA.operacion);
  asientos = [...new Set(asientos)].slice(0, version === 'prueba' ? 2 : MAX_AGENTES);
  if (asientos.length < 2) throw new Error('La sala necesita al menos dos asientos que choquen.');
  // Un asesor nuevo de directorio.json necesita su perfil en la skill: sin él, la sala no sabe qué defiende. Se revisa antes
  // de crear la carpeta de la corrida, para no dejar una a medias.
  const sinPerfil = asientos.filter((a) => !fs.existsSync(path.join(SKILL_SALA, 'perfiles', a + '.md')));
  if (sinPerfil.length) throw new Error('Falta el perfil de ' + sinPerfil.map((a) => `${ASIENTOS_SALA[a]} (perfiles\\${a}.md en la skill sala-directiva)`).join(', ') + '.');
  const receta = leerRecetas().find((r) => r.id === RECETA_SALA[version]);
  if (!receta || receta.error) throw new Error('No está la receta ' + RECETA_SALA[version]);
  abrirCrm();
  const crmNombre = crmActual;
  const c = crmSinMover(crmNombre);
  const n = d.negocio_id ? fichaCrm(Number(d.negocio_id)) : null;
  if (d.negocio_id && !n) throw new Error('No existe el negocio ' + d.negocio_id);
  const ahora = new Date();
  const dd = (x) => String(x).padStart(2, '0');
  const sello = `${ahora.getFullYear()}-${dd(ahora.getMonth() + 1)}-${dd(ahora.getDate())}-${dd(ahora.getHours())}${dd(ahora.getMinutes())}`;
  const carpeta = path.join(carpetaSalas(), slugCrm(crmNombre) || 'crm', `${sello}_${n ? n.id + '-' : ''}${slugCrm(n ? n.nombre : decision).slice(0, 30)}`);
  fs.mkdirSync(path.join(carpeta, 'perfiles'), { recursive: true });
  const cuando = `${dd(ahora.getDate())}-${dd(ahora.getMonth() + 1)}-${ahora.getFullYear()} ${dd(ahora.getHours())}:${dd(ahora.getMinutes())}`;
  fs.writeFileSync(path.join(carpeta, 'DECISION.md'), ['# La decisión', '', decision, '',
    d.inclinacion ? '## Hacia dónde se inclina ' + quien() + '\n\n' + String(d.inclinacion).trim() + '\n' : '',
    prof ? `## Profundidad pedida: ${PROFUNDIDAD_SALA[prof].nombre}\n\n${PROFUNDIDAD_SALA[prof].pide}\n` : '',
    `- Pedida el ${cuando} por ${autor}, versión ${version}${prof ? ', profundidad ' + prof : ''}${d.tema ? ', tema ' + d.tema : ''}.`, ''].join('\r\n'), 'utf8');
  // El contexto libre que escribió quien usa la app (texto, enlaces) va al final, tal cual.
  const libre = String(d.contexto || '').trim();
  fs.writeFileSync(path.join(carpeta, 'CONTEXTO.md'), contextoSala(n, (d.archivos || []).map(String), c)
    + (libre ? '\r\n## Lo que agregó ' + quien() + '\r\n\r\n' + libre.slice(0, 8000) + '\r\n' : ''), 'utf8');
  asientos.forEach((a, i) => fs.copyFileSync(path.join(SKILL_SALA, 'perfiles', a + '.md'), path.join(carpeta, 'perfiles', `${i + 1}.md`)));
  fs.writeFileSync(path.join(carpeta, 'ASIENTOS.md'), ['# Los asientos de esta sala', '',
    ...asientos.map((a, i) => `${i + 1}. **${ASIENTOS_SALA[a]}** · ${MARCO_SALA[a]} (perfiles/${i + 1}.md)`), ''].join('\r\n'), 'utf8');
  // Cada etapa en paralelo lleva tantos agentes como asientos; en la prueba barata todo va en Haiku.
  const agentes = {}, modelos = {};
  receta.etapas.forEach((e, i) => { if (e.tipo === 'etapa' && e.paralelo) agentes[i] = asientos.length; if (e.tipo === 'etapa' && d.modelo === 'haiku') modelos[i] = 'haiku'; });
  const sala = { carpeta, crm: crmNombre, negocio_id: n ? n.id : null, negocio: n ? n.nombre : null, version, decision: decision.slice(0, 200) };
  const simulacro = SALA_SIN_PUERTA.includes(version) ? false : !!d.simulacro;
  const f = await lanzarReceta(receta, carpeta, { simulacro, agentes, modelos, nombres: asientos.map((a) => ASIENTOS_SALA[a]), sala }, irAlEspacio);
  // Trazabilidad (sprint 10): qué receta, con qué modelo y si tuvo internet; las sesiones y los tiempos se anotan al leer la lista.
  const etapas = receta.etapas.filter((e) => e.tipo === 'etapa');
  fs.writeFileSync(path.join(carpeta, 'sala.json'), JSON.stringify(Object.assign({}, sala, { profundidad: prof, receta: receta.id, asientos, flujo: f.id,
    creado: ahora.toISOString(), pedida_por: autor, simulacro, web: etapas.some((e) => e.web),
    modelos: etapas.map((e, i) => modelos[receta.etapas.indexOf(e)] || e.modeloConfig), sesiones: [], fin: null, registrado: null }), null, 2), 'utf8');
  if (n) {
    const id = c.crearActividad({ negocio_id: n.id, tipo: 'nota', que: `Segunda opinión pedida (${prof ? PROFUNDIDAD_SALA[prof].nombre : version}): ${decision.slice(0, 160)}` }, autor);
    c.completarActividad(id, true, autor);
    enviar('crm', null);
  }
  registrar('sala lanzada', f.id, version, prof || '-', asientos.join(','), carpeta);
  return { flujo: f.id, carpeta, version, profundidad: prof, asientos: asientos.map((a) => ASIENTOS_SALA[a]) };
}

// El VEREDICTO.json de una carpeta de sala. Acepta el JSON aunque venga envuelto en un bloque de código.
function leerVeredicto(carpeta) {
  const ruta = path.join(carpeta, 'VEREDICTO.json');
  if (!fs.existsSync(ruta)) return { veredicto: null };
  const texto = fs.readFileSync(ruta, 'utf8').replace(/^﻿/, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return { veredicto: JSON.parse(texto) }; } catch (e) { return { veredicto: null, error: 'El VEREDICTO.json no es un JSON válido: ' + e.message }; }
}
// Solo carpetas de corridas de la sala: nada de abrir o anotar rutas de otro lado.
function carpetaDeSala(carpeta) {
  const raiz = path.resolve(carpetaSalas()) + path.sep;
  const abs = path.resolve(String(carpeta || ''));
  if (!abs.startsWith(raiz) || !fs.existsSync(path.join(abs, 'sala.json'))) throw new Error('Esa carpeta no es de una opinión del directorio.');
  return abs;
}

// Los archivos de una sala que la ventana muestra y deja abrir (VEREDICTO-DETALLE.md desde el sprint 27: lo que el
// veredicto mandó fuera al pasarse de su tope).
const ARCHIVOS_SALA = ['VEREDICTO.md', 'VEREDICTO-DETALLE.md', 'DELIBERACION.md', 'INVESTIGACION.md'];

// «Opiniones del directorio» (sprint 10): cada corrida con su veredicto y su rastro (receta, modelo, sesiones, tiempos,
// internet y fuentes). Las sesiones y el fin se copian a sala.json al terminar, para que el rastro quede aunque se quite el flujo.
function opinionesSala(limite) {
  cargarConfigSala();
  const raiz = carpetaSalas();
  const lista = [];
  if (!fs.existsSync(raiz)) return lista;
  for (const dCrm of fs.readdirSync(raiz, { withFileTypes: true }).filter((x) => x.isDirectory() && !x.name.startsWith('_'))) {
    for (const dRun of fs.readdirSync(path.join(raiz, dCrm.name), { withFileTypes: true }).filter((x) => x.isDirectory())) {
      const carpeta = path.join(raiz, dCrm.name, dRun.name);
      let s;
      try { s = JSON.parse(fs.readFileSync(path.join(carpeta, 'sala.json'), 'utf8')); } catch (e) { continue; }
      const f = s.flujo ? motor.obtener(s.flujo) : null;
      if (f) {
        const ses = f.items.filter((it) => it.tipo === 'etapa').flatMap((it) => it.sesiones || []).map((id) => sesiones.get(id)).filter(Boolean)
          .map((x) => ({ id: x.id, nombre: x.nombre, modelo: x.modelo || '', web: !!x.web }));
        const fin = f.estado === 'completo' ? Math.max(...f.items.map((it) => it.fin || 0)) : null;
        if (ses.length !== (s.sesiones || []).length || (fin && !s.fin)) {
          s.sesiones = ses.length ? ses : s.sesiones;
          if (fin && !s.fin) s.fin = new Date(fin).toISOString();
          try { fs.writeFileSync(path.join(carpeta, 'sala.json'), JSON.stringify(s, null, 2), 'utf8'); } catch (e) { /* el rastro es documentación */ }
        }
      }
      const v = leerVeredicto(carpeta);
      const j = v.veredicto;
      lista.push({ carpeta, crm: s.crm, creado: s.creado, fin: s.fin || null, decision: s.decision, version: s.version, profundidad: s.profundidad || null,
        profundidad_nombre: s.profundidad && PROFUNDIDAD_SALA[s.profundidad] ? PROFUNDIDAD_SALA[s.profundidad].nombre : s.version,
        negocio: s.negocio, negocio_id: s.negocio_id, registrado: s.registrado || null, receta: s.receta || RECETA_SALA[s.version] || null,
        web: !!s.web, modelos: s.modelos || [], sesiones: (s.sesiones || []).map((x) => Object.assign({}, x, { viva: sesiones.has(x.id) })),
        estado: f ? f.estado : (j ? 'completo' : 'sin flujo'), simulacro: f ? !!f.simulacro : !!s.simulacro,
        veredicto: j ? { etiqueta: j.veredicto || null, puntaje: j.puntaje ?? null, ganadora: j.ganadora || null, decision: j.decision || null } : null,
        error: v.error || null,
        archivos: ARCHIVOS_SALA.filter((a) => fs.existsSync(path.join(carpeta, a))) });
    }
  }
  return lista.sort((a, b) => String(b.creado).localeCompare(String(a.creado))).slice(0, limite || 30);
}

// Anotar un veredicto en un negocio: la nota, el documento y la sección del TRABAJO.md. Una vez por opinión.
function anotarVeredicto(carpeta, negocioId, autor) {
  cargarConfigSala();
  carpeta = carpetaDeSala(carpeta);
  const archivo = path.join(carpeta, 'sala.json');
  const s = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  if (s.registrado) throw new Error('Esta opinión ya quedó en un negocio el ' + s.registrado + '.');
  const v = leerVeredicto(carpeta);
  if (!v.veredicto) throw new Error(v.error || 'Esta opinión todavía no tiene veredicto.');
  const id = Number(negocioId || s.negocio_id);
  if (!id) throw new Error('Elige a qué negocio va.');
  const c = crmSinMover(s.crm);
  const n = c.negocio(id);
  if (!n) throw new Error('El negocio ya no existe en el CRM ' + s.crm + '.');
  const j = v.veredicto;
  const etiqueta = s.profundidad && PROFUNDIDAD_SALA[s.profundidad] ? 'Segunda opinión · ' + PROFUNDIDAD_SALA[s.profundidad].nombre : `Sala directiva (${s.version})`;
  const nota = c.crearActividad({ negocio_id: n.id, tipo: 'nota', que: `${etiqueta} · ${j.veredicto || '?'} · ${j.puntaje ?? '?'}/10 · ${(j.condiciones || []).length} condiciones · ${String(j.decision || s.decision).slice(0, 120)}` }, autor);
  c.completarActividad(nota, true, autor);
  const md = path.join(carpeta, 'VEREDICTO.md');
  if (fs.existsSync(md)) c.registrarDocumento(n.id, { tipo: 'Veredicto de la sala', nombre: 'VEREDICTO.md', ruta: md }, autor);
  // En el TRABAJO.md, si el negocio tiene carpeta: el último veredicto, corto. Es documentación; si falla, sigue.
  const carpetaAbs = crmCarpeta(n);
  if (carpetaAbs) {
    try {
      c.escribirSeccion(n.id, 'Sala directiva', [`**${j.veredicto}** (${j.puntaje ?? '?'}/10) el ${dma(new Date().toISOString())}: ${j.decision || ''}`, '',
        ...(j.condiciones || []).map((x) => `- Condición: ${x}`), ...(j.disidencia || []).map((x) => `- Disidencia: ${x}`), '', `Detalle: \`${md}\`.`].join('\r\n'), autor, carpetaAbs);
    } catch (e) { registrar('sala sin sección en TRABAJO.md', e.message); }
  }
  s.registrado = dma(new Date().toISOString());
  if (!s.negocio_id) { s.negocio_id = n.id; s.negocio = n.nombre; }
  fs.writeFileSync(archivo, JSON.stringify(s, null, 2), 'utf8');
  enviar('crm', null);
  registrar('sala registrada', carpeta, n.id);
  return { negocio: n.nombre, nota };
}

// El veredicto de una sala, leído de su carpeta. Acepta el JSON aunque venga envuelto en un bloque de código.
function veredictoSala(fid) {
  const f = motor.obtener(fid);
  if (!f || !f.sala) return null;
  let sala = {};
  try { sala = JSON.parse(fs.readFileSync(path.join(f.sala.carpeta, 'sala.json'), 'utf8')); } catch (e) { /* sin sala.json */ }
  const base = { estado: f.estado, simulacro: !!f.simulacro, carpeta: f.sala.carpeta, negocio: f.sala.negocio, negocio_id: f.sala.negocio_id, version: f.sala.version, registrado: sala.registrado || null };
  return Object.assign(base, leerVeredicto(f.sala.carpeta));
}

// «Dejar como nota en el negocio»: solo con el flujo completo, sin simulacro y una sola vez. Lo hace el clic de quien usa la app.
function registrarSala(fid, autor) {
  const v = veredictoSala(fid);
  if (!v) throw new Error('No es una sala.');
  if (v.estado !== 'completo' || v.simulacro) throw new Error('La sala todavía no tiene veredicto aprobado.');
  if (!v.veredicto) throw new Error(v.error || 'Falta el VEREDICTO.json.');
  if (v.registrado) throw new Error('Este veredicto ya quedó en el negocio el ' + v.registrado + '.');
  if (!v.negocio_id) throw new Error('Esta sala no vino de un negocio del CRM.');
  return anotarVeredicto(v.carpeta, v.negocio_id, autor);
}
ipcMain.handle('crm:sala', (e, id, d) => llevarASala(Object.assign({}, d, { negocio_id: id }), AUTOR_VENTANA, true));
ipcMain.handle('sala:veredicto', (e, fid) => veredictoSala(String(fid)));
ipcMain.handle('sala:registrar', (e, fid) => { const r = registrarSala(String(fid), AUTOR_VENTANA); difundir(); return r; });
// «Segunda opinión» desde la barra (sprint 10): se pide sin cambiar de vista; la lista muestra cuándo termina.
ipcMain.handle('sala:pedir', (e, d) => llevarASala(Object.assign({}, d), AUTOR_VENTANA, false));
ipcMain.handle('sala:opiniones', () => opinionesSala(30));
// Sprint 11: los formularios de la ventana leen el directorio del archivo, no del código.
ipcMain.handle('sala:config', () => cargarConfigSala());
// El índice del tutorial (sprint 11): se relee en cada apertura, así que editar tutorial.json vale sin reiniciar.
ipcMain.handle('tutorial:indice', () => {
  const ruta = archivoConfig('tutorial.json');   // T-A101: el aviso nombra el archivo que falló
  try { return JSON.parse(fs.readFileSync(ruta, 'utf8').replace(/^﻿/, '')); }
  catch (e) { registrar('tutorial.json no se pudo leer', ruta + ': ' + e.message); return { error: e.message, ruta }; }
});
// «Cómo personalizar»: abre el archivo o la carpeta de una clave de esta lista cerrada, nunca una ruta que mande la ventana.
const PERSONALIZAR = {
  recetas: () => carpetaRecetas(), plantillas: () => carpetaPlantillasPropias(), directorio: () => configEditable('directorio.json'),
  asesores: () => path.join(SKILL_SALA, 'perfiles'), metodo: () => path.join(SKILL_SALA, 'SKILL.md'), estilo: () => ARCHIVO_PERSONAL,
  entornos: () => ARCHIVO_ENTORNOS, tutorial: () => configEditable('tutorial.json'), salas: () => carpetaSalas()
};
// Devuelve { ruta } si abrió, o { error } en palabras: antes respondía true aunque shell.openPath fallara.
ipcMain.handle('config:abrir', async (e, clave) => {
  if (typeof clave !== 'string' || !Object.hasOwn(PERSONALIZAR, clave)) return { error: 'No conozco esa clave: ' + clave };
  let ruta;
  try { ruta = PERSONALIZAR[clave](); } catch (err) { registrar('config:abrir', clave, err.message); return { error: 'No pude preparar el archivo: ' + err.message }; }
  // El CSS personal y entornos.json pueden no existir todavía: se abre su carpeta.
  const destino = fs.existsSync(ruta) ? ruta : path.dirname(ruta);
  const fallo = await shell.openPath(destino);
  if (fallo) { registrar('config:abrir no pudo abrir', destino, fallo); return { error: 'No pude abrir ' + destino + ': ' + fallo }; }
  return { ruta: destino };
});
ipcMain.handle('sala:anotar', (e, carpeta, negocioId) => { const r = anotarVeredicto(carpeta, negocioId, AUTOR_VENTANA); difundir(); return r; });
ipcMain.handle('sala:abrir', (e, carpeta, archivo) => {
  const abs = carpetaDeSala(carpeta);
  const nombre = ARCHIVOS_SALA.includes(archivo) ? archivo : null;
  abrirSinEjecutar(nombre && fs.existsSync(path.join(abs, nombre)) ? path.join(abs, nombre) : abs);
  return true;
});

// Abrir un archivo del que salió la plata: solo uno de la lista de fuentes de ese negocio.
ipcMain.handle('crm:abrir_fuente', (e, negocioId, i) => {
  const n = abrirCrm().negocio(Number(negocioId));
  const f = n && n.control && n.control.fuentes[Number(i)];
  if (f && f.archivo && fs.existsSync(f.archivo)) { abrirSinEjecutar(f.archivo); return true; }
  return false;
});
ipcMain.handle('crm:solicitud', (e, d) => crmEscribe((c) => c.crearSolicitud(Object.assign({}, d), AUTOR_VENTANA, crmActual)));
ipcMain.handle('crm:proyectos', () => abrirCrm().proyectos());
ipcMain.handle('crm:proyecto_nuevo', (e, d) => crmEscribe((c) => c.crearProyecto(Object.assign({}, d), AUTOR_VENTANA)));
ipcMain.handle('crm:crear_carpeta', (e, id) => crmEscribe((c) => c.crearCarpeta(Number(id), null, AUTOR_VENTANA)));
// Dónde nacen las carpetas: la raíz de los proyectos y, por embudo, la de cada tipo. Se elige con el diálogo.
ipcMain.handle('crm:carpetas', () => abrirCrm().carpetas());
ipcMain.handle('crm:carpeta_raiz', async (e, embudo, tipo) => {
  const r = await dialog.showOpenDialog(ventana, { title: embudo ? `Dónde nacen las carpetas de «${tipo === '*' ? 'todo ' + embudo : tipo}»` : 'Dónde nacen los proyectos', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  return crmEscribe((c) => {
    if (!embudo) return c.carpetas({ raiz_proyectos: r.filePaths[0] });
    const raices = c.carpetas().raices[embudo] || {};
    raices[tipo || '*'] = r.filePaths[0];
    return c.carpetas({ raices: { [embudo]: raices } });
  });
});
ipcMain.handle('crm:hoy', (e, filtro) => abrirCrm().hoy(filtro || {}, crmCarpeta));
// Mover devuelve lo que le faltaba a la etapa nueva (no lo impide: queda anotado en el historial).
ipcMain.handle('crm:mover', (e, id, etapa) => crmEscribe((c) => c.moverEtapa(Number(id), etapa, AUTOR_VENTANA, crmCarpeta(c.negocio(Number(id))))));
ipcMain.handle('crm:cuestionario', () => abrirCrm().cuestionario());
ipcMain.handle('crm:recomendar', (e, respuestas) => abrirCrm().recomendar(respuestas || {}));
ipcMain.handle('crm:aplicar', (e, id, entorno) => crmEscribe((c) => c.aplicarPlantilla(String(id), entorno || null, AUTOR_VENTANA)));
// Subir documentos: se copian a la carpeta del negocio (o, si no tiene, a documentos\<id>\ junto a la base, fuera
// del código) y queda su ficha en la base con el tipo elegido.
ipcMain.handle('crm:subir', async (e, id, tipo, sub) => {
  const c = abrirCrm();
  const n = c.negocio(Number(id));
  if (!n) return null;
  const r = await dialog.showOpenDialog(ventana, { title: `Subir documento a «${n.nombre}»`, properties: ['openFile', 'multiSelections'] });
  if (r.canceled || !r.filePaths.length) return null;
  // Una subcarpeta que ya existe en la del negocio (lo que llegó con la solicitud va a 01-LO-QUE-LLEGO).
  const base = crmCarpeta(n);
  const conSub = base && sub && !/[\\/]|\.\./.test(sub) && fs.existsSync(path.join(base, sub)) ? path.join(base, sub) : null;
  const destino = conSub || base || path.join(path.dirname(c.ruta), 'documentos', String(n.id));
  fs.mkdirSync(destino, { recursive: true });
  const subidos = [];
  for (const origen of r.filePaths) {
    let nombre = path.basename(origen);
    let final = path.join(destino, nombre);
    if (path.resolve(origen) !== path.resolve(final)) {
      for (let k = 2; fs.existsSync(final); k++) { const ext = path.extname(nombre); final = path.join(destino, `${path.basename(nombre, ext)} (${k})${ext}`); }
      fs.copyFileSync(origen, final);
      nombre = path.basename(final);
    }
    c.registrarDocumento(n.id, { tipo: tipo || null, nombre, ruta: final }, AUTOR_VENTANA);
    subidos.push(nombre);
  }
  enviar('crm', null);
  return { subidos, destino };
});
ipcMain.handle('crm:abrir_doc', (e, negocioId, docId) => {
  const d = abrirCrm().documentos(Number(negocioId)).find((x) => x.id === Number(docId));
  if (d && fs.existsSync(d.ruta)) { abrirSinEjecutar(d.ruta); return true; }
  return false;
});
ipcMain.handle('crm:negocio_cambiar', (e, id, cambios) => crmEscribe((c) => c.cambiarNegocio(Number(id), cambios, AUTOR_VENTANA)));
// Sprint 26 (H6): el % de una etapa, desde Configurar → Etapas. Solo la base de este CRM; la plantilla en disco no se toca.
ipcMain.handle('crm:etapa_probabilidad', (e, etapaId, valor) => crmEscribe((c) => c.cambiarProbabilidadEtapa(Number(etapaId), valor, AUTOR_VENTANA)));
ipcMain.handle('crm:actividad_nueva', (e, d) => crmEscribe((c) => c.crearActividad(d, AUTOR_VENTANA)));
ipcMain.handle('crm:actividad_hecha', (e, id, hecha) => crmEscribe((c) => c.completarActividad(Number(id), hecha, AUTOR_VENTANA)));
ipcMain.handle('crm:carpeta', (e, id) => { const ruta = crmCarpeta(abrirCrm().negocio(Number(id))); if (ruta) abrirSinEjecutar(ruta); return !!ruta; });
ipcMain.handle('crm:exportar', async (e, objeto) => {
  const r = await dialog.showSaveDialog(ventana, { title: 'Exportar ' + objeto, defaultPath: `crm-${objeto}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, '﻿' + abrirCrm().exportarCSV(objeto), 'utf8');
  return r.filePath;
});
ipcMain.handle('flujo:aprobar', (e, fid, origen, eleccion) => motor.aprobar(fid, String(origen || ''), eleccion || null));
ipcMain.handle('flujo:traspasos', (e, fid) => motor.traspasosPuerta(fid));
ipcMain.handle('flujo:cambios', (e, fid, texto) => motor.pedirCambios(fid, String(texto || '')));
ipcMain.handle('flujo:seguir', (e, fid) => motor.seguirIgual(fid));
ipcMain.handle('flujo:repetir', (e, fid) => motor.repetirEnOpus(fid));
ipcMain.handle('flujo:quitar', (e, fid) => {
  for (const id of motor.quitar(fid)) cerrarSesion(id);
  guardar();
  difundir();
});
// Una sesión que nace de la barra de comando se llama como su orden, no como su carpeta.
ipcMain.handle('sesion:nueva', (e, carpeta, instruccion, opciones) => {
  const extra = instruccion ? { nombre: recortar(instruccion, 34) } : {};
  // Modelo y esfuerzo elegidos en la barra de comando (sprint 15, L1).
  const o = opciones || {};
  if (MODELOS[o.modelo]) extra.modelo = o.modelo;
  if (ESFUERZOS.includes(o.esfuerzo)) extra.esfuerzo = o.esfuerzo;
  // Sesión suelta: si su pestaña es la de un entorno, lee su guía (sprint 20, H4).
  extra.conGuia = true;
  return nuevaSesion(carpeta, instruccion, extra);
});
ipcMain.handle('sesion:renombrar', (e, id, nombre) => {
  const s = sesiones.get(id);
  if (s && typeof nombre === 'string' && nombre.trim()) { s.nombre = nombre.trim().slice(0, 60); guardar(); difundir(); }
});
ipcMain.handle('sesion:cerrar', async (e, id) => {
  const s = sesiones.get(id);
  const conservar = s && procesos.has(id) ? await preguntarCierre(s, 'cerrar') : [];
  // Cancelado: la ventana ya la había sacado de la lista; difundir la devuelve.
  if (!conservar || !sesiones.has(id)) { difundir(); return { ok: false }; }
  anotarSesionCerrada(s);
  cerrarSesion(id, conservar);
  guardar();
  difundir();
});
ipcMain.on('sesion:foco', (e, id) => {
  seleccionada = id;
  const s = sesiones.get(id);
  // Como en Wave: «terminó» es una novedad sin ver; al mirarla, pasa a pausa.
  if (s && s.estado === 'termino') cambiarEstado(s, 'pausa', '');
});
// ── Ojear (sprint 14): qué dice y qué hace cada sesión y cada subagente, leído del final de su registro ──
// Solo los últimos 96 KB y solo si el archivo cambió: con la lista «trabajando» y los cuadros cerrados no se lee nada.
// El pensamiento no se muestra porque Claude Code lo guarda cifrado (solo su firma).
const CARPETA_PROYECTOS = path.join(app.getPath('home'), '.claude', 'projects');
const lecturas = new Map();
function accion(c) {
  const e = c.input || {};
  const sobre = e.file_path || e.path || e.pattern || e.command || e.url || e.query || e.description || '';
  return recortar(c.name + (sobre ? ' · ' + String(sobre) : ''), 120);
}
// Lee solo lo nuevo (sprint 15, idea de OpenHarness): guarda hasta qué byte leyó y lo que dijo e hizo hasta ahí. La
// primera vez lee los últimos 96 KB; si el archivo se achicó (otra sesión, /clear), vuelve a empezar desde el final.
// desdeElInicio (sprint 17): para un subagente, que suele ser chico, se lee entero y se suman herramientas y tokens
// escritos (cada mensaje una vez, por su id: Claude Code repite el mismo uso en cada bloque del mensaje).
function colaDe(archivo, desdeElInicio) {
  let st;
  try { st = fs.statSync(archivo); } catch (e) { return null; }
  let l = lecturas.get(archivo);
  if (l && l.offset === st.size) return l.datos;
  if (!l || st.size < l.offset) {
    const entero = desdeElInicio && st.size < 4 * 1024 * 1024;
    l = { offset: entero ? 0 : Math.max(0, st.size - 96 * 1024), resto: '', datos: { dijo: '', hace: '', modelo: '', herramientas: 0, tokens: 0 }, recortado: !entero, vistos: new Set() };
  }
  const b = Buffer.alloc(st.size - l.offset);
  const fd = fs.openSync(archivo, 'r');
  try { fs.readSync(fd, b, 0, b.length, l.offset); } finally { fs.closeSync(fd); }
  l.offset = st.size;
  const lineas = (l.resto + b.toString('utf8')).split('\n');
  l.resto = lineas.pop();
  // Al partir a mitad de archivo, la primera línea viene cortada.
  if (l.recortado) { lineas.shift(); l.recortado = false; }
  for (const linea of lineas) {
    let j;
    try { j = JSON.parse(linea); } catch (e) { continue; }
    if (j.type !== 'assistant' || !j.message || !Array.isArray(j.message.content)) continue;
    if (j.message.model) l.datos.modelo = j.message.model;
    if (j.message.id && !l.vistos.has(j.message.id)) { l.vistos.add(j.message.id); l.datos.tokens += (j.message.usage && j.message.usage.output_tokens) || 0; }
    for (const c of j.message.content) {
      if (c.type === 'text' && c.text.trim()) l.datos.dijo = recortar(c.text, 200);
      if (c.type === 'tool_use') { l.datos.hace = accion(c); l.datos.herramientas++; }
    }
  }
  l.datos = Object.assign({}, l.datos);
  lecturas.set(archivo, l);
  return l.datos;
}
function registroDe(s) {
  if (s.transcript && fs.existsSync(s.transcript)) return s.transcript;
  if (!s.sessionId || !s.iniciada) return null;
  try {
    for (const d of fs.readdirSync(CARPETA_PROYECTOS)) {
      const f = path.join(CARPETA_PROYECTOS, d, conversacionDe(s) + '.jsonl');
      if (fs.existsSync(f)) return (s.transcript = f);
    }
  } catch (e) { /* sin carpeta de proyectos */ }
  return null;
}
function ojear() {
  return [...sesiones.values()].filter((s) => s.iniciada).map((s) => {
    const r = registroDe(s);
    const carpetaSub = r ? path.join(r.replace(/\.jsonl$/, ''), 'subagents') : '';
    const subagentes = (s.subagentes || []).map((x) => {
      if (!carpetaSub) return x;
      const base = path.join(carpetaSub, 'agent-' + x.id);
      // La tarea la escribe Claude Code en la ficha del subagente; se lee una vez.
      if (!x.tarea) { try { const m = JSON.parse(fs.readFileSync(base + '.meta.json', 'utf8')); x.tarea = recortar(m.description, 80); if (m.agentType) x.tipo = m.agentType; } catch (e) { /* aún no está */ } }
      return Object.assign({}, x, colaDe(base + '.jsonl', true) || {});
    });
    return Object.assign({ id: s.id, subagentes }, (r && colaDe(r)) || {});
  });
}
ipcMain.handle('ojear', () => ojear());

// El último mensaje completo de una sesión (para sesion_leer): el final del registro, hasta 8.000 caracteres.
function ultimoTexto(archivo) {
  let st;
  try { st = fs.statSync(archivo); } catch (e) { return ''; }
  const desde = Math.max(0, st.size - 256 * 1024);
  const b = Buffer.alloc(st.size - desde);
  const fd = fs.openSync(archivo, 'r');
  try { fs.readSync(fd, b, 0, b.length, desde); } finally { fs.closeSync(fd); }
  const lineas = b.toString('utf8').split('\n');
  for (let i = lineas.length - 1; i >= 0; i--) {
    let j;
    try { j = JSON.parse(lineas[i]); } catch (e) { continue; }
    if (j.type !== 'assistant' || !j.message || !Array.isArray(j.message.content)) continue;
    const texto = j.message.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    if (texto) return texto.length > 8000 ? texto.slice(0, 8000) + '…' : texto;
  }
  return '';
}

// ── El orquestador (sprint 16): una coordinadora reparte un objetivo entre sesiones y Chocosys la despierta por eventos ──
const TOPE_ORQUESTA = 4;
const aCargoDe = (id) => [...sesiones.values()].filter((x) => x.coordinador === id);
// Cuenta para el tope (arreglo T-A97): la que trabaja, la que espera a quien usa la app y la recién creada que todavía no parte su
// primer turno (nace en «pausa» con `viva: false` y la terminal abre 1,5 s después). No cuenta la que terminó, aunque
// Quien usa la app ya la haya mirado (al mirarla, «terminó» pasa a «pausa»).
const NUEVA_SIN_TURNO_MS = 30 * 1000;
const ocupaCupo = (x) => x.estado === 'trabajando' || x.estado === 'necesita' ||
  (x.estado === 'pausa' && !x.turnos && !x.inicioTurno && Date.now() - (x.creada || 0) < NUEVA_SIN_TURNO_MS);
function instruccionCoordinadora(objetivo, asignadas, informe) {
  const yo = quien();
  return [
    'Eres la coordinadora de una orquesta de Chocosys: repartes un objetivo entre sesiones de Claude Code, les sigues el paso y le informas a ' + yo + '.',
    '(1) Separar o juntar: separa solo partes que no dependen entre sí; lo que es un mismo hilo va en una sola sesión, para que no pierda el contexto; si una parte necesita el resultado de otra, dásela cuando la primera termine. Si el objetivo cabe en una sola sesión, hazlo con una. Máximo ' + TOPE_ORQUESTA + ' sesiones trabajando a la vez.',
    '(2) Crea cada sesión con sesion_nueva del MCP chocosys: carpeta absoluta del trabajo; una instrucción completa que se entienda sola (qué entra, qué sale y dónde dejarlo); un nombre corto; y espacio = la pestaña del proyecto si es otro. Chocosys le elige el modelo según su tarea.',
    asignadas.length ? '(2b) ' + yo + ' ya te asignó estas sesiones: ' + asignadas.map((s) => '«' + s.nombre + '»').join(', ') + '. Dales su parte con sesion_ordenar.' : '',
    '(3) Después de repartir, termina tu turno y espera: no revises a cada rato. Chocosys te escribe una línea que empieza con [Chocosys] cuando una de tus sesiones termina, te pregunta algo o lleva 10 minutos sin moverse.',
    '(4) Cuando te llegue, lee el detalle con sesion_leer, decide el paso siguiente (sesion_ordenar a esa sesión, o una sesión nueva) y anota el avance en ' + informe + ' con estas secciones: Objetivo, Sesiones (cuál hace qué y dónde deja su resultado), Avance (fecha y hora, qué se hizo, dónde quedó), Falta y Resultado.',
    '(5) Nada irreversible: no envíes correos, no publiques, no emitas correlativos, no subas entregas ni apruebes puertas, ni le pidas a una sesión que lo haga. Eso, y cualquier decisión que el objetivo no resuelva, se lo preguntas a ' + yo + ' con AskUserQuestion.',
    '(6) Al terminar todo: el resultado junto en el informe y un resumen de cinco líneas para ' + yo + '.',
    '— Tu tarea: ' + objetivo
  ].filter(Boolean).join(' ');
}
ipcMain.handle('orquesta:nueva', async (e, objetivo, ids) => {
  const meta = String(objetivo || '').replace(/\s+/g, ' ').trim();
  if (!meta) return { error: 'Falta el objetivo: «orquesta: qué quieres lograr».' };
  const esp = espacioPorId(espacioActual);
  const carpeta = esp && esp.carpeta;
  if (!carpeta || !fs.existsSync(carpeta)) return { error: 'Elige la carpeta de esta pestaña: ahí queda el informe de la orquesta.' };
  const asignadas = (Array.isArray(ids) ? ids : []).map((id) => sesiones.get(id)).filter(Boolean);
  const slug = meta.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'orquesta';
  const informe = path.join(carpeta, `INFORME-${new Date().toISOString().slice(0, 10)}-${slug}.md`);
  const s = await nuevaSesion(carpeta, instruccionCoordinadora(meta, asignadas, informe), {
    nombre: 'coordinadora · ' + recortar(meta, 26), modelo: 'opus', esfuerzo: 'xhigh', orquesta: { objetivo: recortar(meta, 300), informe }
  });
  for (const x of asignadas) x.coordinador = s.id;
  guardar();
  difundir();
  return publica(s);
});
// Chocosys le avisa a la coordinadora con una línea corta, sin que ella revise a cada rato.
// Con la coordinadora en «te necesita» (una pregunta o un permiso abiertos en su terminal) no se escribe nada: el Enter del
// aviso elegiría la primera opción sin quien usa la app (arreglo T-A97). El aviso se guarda y sale en su siguiente turno o al terminar.
function avisarCoordinadora(s, que) {
  const c = sesiones.get(s.coordinador);
  if (!c || !procesos.has(c.id)) { registrar('orquesta: coordinadora cerrada', s.coordinador || ''); return; }
  avisarSesion(c, `[Chocosys] «${s.nombre}» ${que}. Detalle con sesion_leer «${s.nombre}».`, s.id + ' ' + que.split(':')[0]);
}
function avisarSesion(c, linea, motivo) {
  if (!c || !procesos.has(c.id)) return;
  if (c.estado === 'necesita') {
    c.avisosPendientes = (c.avisosPendientes || []).concat(linea);
    registrar('orquesta: aviso guardado (espera a ' + quien() + ')', c.id, motivo);
    return;
  }
  registrar('orquesta: aviso', c.id, motivo);
  escribirEn(c.id, linea);
}

// ── La central (25-10-2026, pedido de quien usa la app): una coordinadora que no se cierra ──
// Con «central.activa» en perfil.json, Chocosys la abre al iniciar (o la retoma), con Remote Control para usarla desde el
// celular. Abre las sesiones que estime, sin el tope de 4 de una orquesta (el suyo es «central.tope», de 1 a 12).
// Sus sesiones no se hablan entre sí salvo que ella las enlace (sesion_enlazar), y solo con las enlazadas.
// De fábrica 3 (03-11-2026, antes 8): una sesión trabajando con sus MCP pesa cerca de 1 GB, y en un PC de 16 GB con el
// navegador abierto la cuarta ya lleva la RAM al umbral de 85 %; además cada una gasta el mismo plan en paralelo.
const TOPE_CENTRAL = 3;
const nombreDe = (id) => (sesiones.get(id) || {}).nombre || id;
const topeCentral = () => { const n = Number((perfil().central || {}).tope); return Number.isInteger(n) && n >= 1 && n <= 12 ? n : TOPE_CENTRAL; };
const topeDe = (c) => (c && c.central ? topeCentral() : TOPE_ORQUESTA);
// Una sesión a cargo de una coordinadora habla solo con ella y con sus enlaces. Las sueltas y la ventana, con todas.
function puedeHablar(yo, s, que) {
  if (!yo || !yo.coordinador || s.id === yo.id || s.id === yo.coordinador || (yo.enlaces || []).includes(s.id)) return;
  throw new Error(`No estás enlazada con «${s.nombre}»: no puedes ${que}. Si la necesitas, dilo en tu respuesta final y «${nombreDe(yo.coordinador)}» decide.`);
}
// Enlace en los dos sentidos. Al nacer, la nueva ya lo lee en su nota de equipo; avisar, solo a la otra. Quitar no avisa:
// desde ahí puedeHablar la frena.
function enlazar(a, b, quitar, alNacer) {
  const poner = (x, y) => { x.enlaces = (x.enlaces || []).filter((i) => i !== y.id).concat(quitar ? [] : [y.id]); };
  poner(a, b); poner(b, a);
  registrar(quitar ? 'enlace quitado' : 'enlace', a.id, b.id);
  if (quitar) return;
  const aviso = (x, y) => avisarSesion(x, `[Chocosys] Ahora puedes hablar con «${y.nombre}» (sesion_leer para ver lo último que dijo, sesion_ordenar para escribirle). Úsalo solo si lo necesitas para tu parte.`, 'enlace ' + y.id);
  aviso(b, a);
  if (!alNacer) aviso(a, b);
}
// Lo que sabe una sesión a cargo de una coordinadora: va en su system prompt, con los enlaces del momento en que abre.
function notaEquipo(s) {
  const c = nombreDe(s.coordinador);
  const enl = (s.enlaces || []).map((i) => '«' + nombreDe(i) + '»');
  return [
    `Trabajas en Chocosys a cargo de «${c}», que reparte el trabajo y lee tu respuesta final: termina cada turno con lo que hiciste, dónde quedó y qué falta.`,
    enl.length
      ? `Puedes hablar con estas sesiones, y solo con ellas: ${enl.join(', ')} (MCP chocosys: sesion_leer para ver lo último que dijeron, sesion_ordenar para escribirles; les llega como [de «${s.nombre}»]). Hazlo solo cuando necesites algo de ellas para tu parte, no para contar avances.`
      : `No hablas con otras sesiones. Si necesitas algo que otra está haciendo, dilo en tu respuesta final y «${c}» decide.`,
    'No abres ni cierras sesiones: eso lo decide quien te tiene a cargo.'
  ].join(' ');
}
function instruccionCentral() {
  const yo = quien();
  return [
    `Eres la central de Chocosys: la sesión que queda siempre abierta, con Remote Control, para que ${yo} te pida trabajo desde aquí o desde el celular.`,
    '(1) Lo corto lo haces tú (una pregunta, ver un estado, un arreglo chico). Abres sesiones solo cuando el trabajo es largo, es de otro entorno o tiene partes independientes que conviene correr en paralelo: una por hilo de trabajo, nunca una por paso. Si una parte necesita el resultado de otra, va después, no en paralelo.',
    `(2) Para abrir: «lugares» del MCP chocosys te da los entornos y las carpetas; después sesion_nueva con entorno o carpeta, una instrucción completa que se entienda sola (qué entra, qué sale y dónde dejarlo) y un nombre corto. Chocosys le elige el modelo si no lo das. Máximo ${topeDe({ central: true })} trabajando a la vez.`,
    '(3) Tus sesiones no se hablan entre sí. Enlaza dos (sesion_enlazar, o «con» al crearla) solo cuando una necesita algo de la otra mientras las dos trabajan; si basta con el resultado final, pásaselo tú con sesion_ordenar cuando la primera termine. Quita el enlace cuando ya no haga falta.',
    '(4) Después de repartir, termina tu turno: Chocosys te escribe una línea [Chocosys] cuando una sesión termina, te pregunta algo o lleva 10 minutos sin moverse. Lee con sesion_leer y decide el paso siguiente.',
    `(5) Cuando un encargo termina, dale a ${yo} un resumen de cinco líneas (qué se hizo, dónde quedó, qué falta) y cierra con sesion_cerrar las sesiones quietas o terminadas que ya no se van a usar. Si una tiene un cálculo vivo (procesos suyos gastando CPU, como CPLEX o Python), sesion_cerrar no la cierra y te dice por qué: déjala abierta y avísale a ${yo}. «forzar: true» solo cuando ${yo} te lo ordene explícitamente.`,
    `(6) Nada irreversible: no envíes correos, no publiques, no emitas correlativos, no subas entregas ni apruebes puertas, ni le pidas a una sesión que lo haga. Eso, y cualquier decisión que el pedido no resuelva, se lo preguntas a ${yo}.`,
    `(7) Lo que se repite o va a una hora («todos los lunes», «mañana a las 9»): «programar». Antes de guardarla, dile a ${yo} la hora en palabras. Una línea que empieza con [Programada «…»] es una de esas tareas que llegó a su hora: hazla como cualquier pedido.`
  ].join(' ');
}
// ── Tareas programadas (25-10-2026): crons como los de Hermes, dentro de Chocosys ──
// programadas.js entiende las horas; acá se ejecutan. Cada 20 s se mira si a alguna le toca este minuto. Al abrir, una
// que tocaba mientras Chocosys estaba cerrada corre una vez (si es de las últimas 24 horas y no dice «saltar»).
const programadas = require('./programadas');
const prog = programadas.crear(path.join(DATOS, 'programadas.json'));
const centralViva = () => [...sesiones.values()].find((s) => s.central) || null;
async function correrProgramada(t, atrasada) {
  const marca = `[Programada «${t.nombre}»${atrasada ? ', atrasada de las ' + atrasada.slice(11) : ''}]`;
  if (t.tipo === 'orden') {
    const s = t.sesion ? buscarSesion(t.sesion) : centralViva();
    if (!s) throw new Error('no hay central (perfil.json, «central.activa») ni una sesión indicada');
    if (!procesos.has(s.id)) throw new Error(`«${s.nombre}» está cerrada`);
    // Si espera a quien usa Chocosys, la orden se guarda y sale cuando responda (avisarSesion).
    avisarSesion(s, `${marca} ${t.texto}`, 'programada ' + t.id);
    return `orden a «${s.nombre}»`;
  }
  if (t.tipo === 'sesion') {
    const ent = t.entorno ? leerEntornos().find((x) => x.nombre.toLowerCase() === t.entorno.toLowerCase()) : null;
    const carpeta = t.carpeta || (ent && ent.existe ? ent.carpeta : '');
    if (!carpeta || !fs.existsSync(carpeta)) throw new Error('la carpeta no existe: ' + (carpeta || t.entorno));
    // Con la central viva, la sesión queda a su cargo: la central se entera cuando termina.
    const c = centralViva();
    const extra = { nombre: t.nombre, conGuia: true, espacio: espacioPara(carpeta, ent ? ent.nombre : '').id };
    if (c && procesos.has(c.id)) extra.coordinador = c.id;
    if (MODELOS[t.modelo]) extra.modelo = t.modelo;
    if (ESFUERZOS.includes(t.esfuerzo)) extra.esfuerzo = t.esfuerzo;
    const s = await nuevaSesion(carpeta, `${marca} ${t.texto}`, extra);
    abrirAlMedir(s.id, 120, 32);
    return `sesión «${s.nombre}» abierta`;
  }
  const receta = leerRecetas().find((r) => r.id === t.receta);
  if (!receta || receta.error) throw new Error('no hay una receta válida «' + t.receta + '»');
  const carpeta = t.carpeta || receta.carpeta || '';
  if (!carpeta || !fs.existsSync(carpeta)) throw new Error('falta la carpeta del trabajo o no existe: ' + carpeta);
  const f = await lanzarReceta(receta, carpeta, { simulacro: t.simulacro !== false }, false);
  return `flujo «${f.nombre}» lanzado${t.simulacro !== false ? ' en simulacro' : ''}`;
}
// Anota el resultado releyendo la lista: entre medio, el MCP pudo cambiarla.
function anotarProgramada(id, ultima, apagar) {
  const lista = prog.leer();
  const t = lista.find((x) => x.id === id);
  if (!t) return;
  t.ultima = ultima;
  if (apagar) t.activa = false;
  prog.guardar(lista);
}
async function revisarProgramadas(alAbrir) {
  // Las lite no llevan tareas programadas, pero comparten la carpeta de datos con la completa: no corren las de ella.
  if (!edicion.herramienta('programar')) return;
  const ahora = new Date();
  const lista = prog.leer();
  const tocan = [];
  for (const t of lista) {
    if (!t.activa) continue;
    try {
      let k = null, atrasada = null;
      if (alAbrir) {
        const desde = new Date(Math.max(new Date((t.ultima && t.ultima.hora) || t.creada).getTime(), ahora.getTime() - programadas.MAX_ATRASO_MS));
        const f = programadas.ultimaEntre(t, desde, ahora);
        if (f) { k = programadas.clave(f); atrasada = k; }
      } else if (t.en ? programadas.clave(programadas.fechaUna(t.en)) === programadas.clave(ahora) : programadas.calza(programadas.interpretar(t.cuando), ahora)) {
        k = programadas.clave(ahora);
      }
      if (!k || (t.ultima && t.ultima.clave === k)) continue;
      t.ultima = { clave: k, hora: ahora.toISOString(), resultado: 'corriendo', ok: null };
      if (atrasada && t.atrasada === 'saltar') { t.ultima.resultado = 'saltada: Chocosys estaba cerrada a su hora'; t.ultima.ok = true; continue; }
      tocan.push({ t, atrasada });
    } catch (e) { registrar('programada ilegible', t.id, e.message); }
  }
  if (!tocan.length && !alAbrir) return;
  prog.guardar(lista);
  for (const { t, atrasada } of tocan) {
    let ultima;
    try { ultima = Object.assign({}, t.ultima, { resultado: await correrProgramada(t, atrasada), ok: true }); }
    catch (e) { ultima = Object.assign({}, t.ultima, { resultado: 'sin correr: ' + e.message, ok: false }); notificar(`Programada sin correr: ${t.nombre}`, e.message, null); }
    registrar('programada', t.id, ultima.resultado);
    anotarProgramada(t.id, ultima, !!t.en);
  }
}
setInterval(() => { revisarProgramadas(false).catch((e) => registrar('programadas', e.message)); }, 20 * 1000);
const resumenProgramada = (t) => {
  let prox = null;
  try { prox = t.activa ? programadas.proxima(t, new Date()) : null; } catch (e) { /* ilegible */ }
  return Object.assign({}, t, { proxima: prox ? programadas.clave(prox) : null });
};

// forzar (27-10-2026): la opción de la central en el menú «Sesión nueva» la abre aunque «central.activa» sea false.
async function asegurarCentral(forzar) {
  // Con un perfil sin «central», el menú la abre igual con los valores de fábrica; sola al iniciar, solo con «activa».
  const cfg = perfil().central || (forzar ? {} : null);
  if (!cfg || !(cfg.activa || forzar)) return null;
  const pestana = String(cfg.pestana || '').trim().slice(0, 40) || 'Central';
  let c = centralViva();
  if (c) ponerCentralEn(c, pestana);
  else {
    const carpeta = cfg.carpeta && fs.existsSync(cfg.carpeta) ? cfg.carpeta : app.getPath('home');
    const esp = buscarEspacio(pestana) || nuevoEspacio(pestana, carpeta);
    const p = await nuevaSesion(carpeta, '', {
      nombre: String(cfg.nombre || 'central').slice(0, 60), espacio: esp.id, central: true, orquesta: { objetivo: 'central' },
      modelo: MODELOS[cfg.modelo] ? cfg.modelo : 'opus', esfuerzo: ESFUERZOS.includes(cfg.esfuerzo) ? cfg.esfuerzo : 'high'
    });
    c = sesiones.get(p.id);
    registrar('central creada', c.id, carpeta);
  }
  if (!procesos.has(c.id)) { abrirAlMedir(c.id, 120, 32); registrar('central abierta', c.id); }
  return c;
}
// La central queda en la pestaña de «central.pestana» (27-10-2026: «Central» pasó a «Centro de control»). Su pestaña
// propia se renombra en vez de abrir otra; si ya hay una con ese nombre, se muda ahí y la vieja, si quedó vacía, se borra.
// Una pestaña de entorno no se renombra: la central sale de ella.
function ponerCentralEn(c, pestana) {
  const e = espacioPorId(c.espacio);
  if (e && e.nombre === pestana) return;
  const otra = buscarEspacio(pestana);
  const deEntorno = e && (e.entorno || leerEntornos().some((x) => x.nombre.toLowerCase() === e.nombre.toLowerCase()));
  if (otra && otra !== e) {
    c.espacio = otra.id; c.pos = null;
    const vacia = e && ![...sesiones.values()].some((s) => s.espacio === e.id) && !motor.todos().some((f) => f.espacio === e.id);
    if (vacia && !deEntorno) borrarEspacio(e.id);
  } else if (e && (otra === e || !deEntorno)) e.nombre = pestana;
  else { c.espacio = nuevoEspacio(pestana, c.carpeta).id; c.pos = null; }
  registrar('central: pestaña', pestana);
  guardar();
  difundir();
}
// «Centro de control» del menú «Sesión nueva»: lleva a la central viva (la reabre si su terminal está cerrada) o la crea.
// Nunca abre una segunda. Con «central.activa» en false la abre igual; solo no se abre sola al iniciar.
ipcMain.handle('central:abrir', async () => {
  const c = await asegurarCentral(true);
  if (!c) return null;
  espacioActual = c.espacio;
  guardar();
  difundir();
  return { sesion: publica(c), espacio: c.espacio, activa: !!(perfil().central || {}).activa };
});
// Los avisos guardados salen juntos, en una sola orden, cuando la coordinadora ya no espera a quien usa la app.
function soltarAvisos(c) {
  if (!c.avisosPendientes || !c.avisosPendientes.length || c.estado === 'necesita' || !procesos.has(c.id)) return;
  const lineas = c.avisosPendientes;
  c.avisosPendientes = [];
  registrar('orquesta: avisos guardados enviados', c.id, lineas.length);
  escribirEn(c.id, lineas.join(' '));
}
// Trabada: trabajando 10 minutos sin ningún aviso de Claude Code. Se revisa una vez por minuto, solo en las de una orquesta.
setInterval(() => {
  for (const s of sesiones.values()) {
    if (!s.coordinador || s.estado !== 'trabajando' || s.avisadaTrabada) continue;
    if (Date.now() - (s.actividad || s.cambio || Date.now()) > 10 * 60 * 1000) { s.avisadaTrabada = true; avisarCoordinadora(s, 'lleva 10 minutos sin moverse'); }
  }
}, 60 * 1000);

// Stop perdido (T-C16b): si el hook Stop de una sesión de flujo muere (con poca memoria node.exe sale con «VirtualAlloc
// failed»), la sesión queda «trabajando» y el flujo no sigue nunca. Cada 30 s se mira el registro de las sesiones de flujo
// que trabajan: si su último mensaje es el cierre del turno de Claude Code y es de hace más de 20 s, cuenta como el Stop.
// El hook Stop no es async: cuando el cierre ya está escrito, el aviso real ya llegó o ya se perdió.
const ESPERA_STOP_PERDIDO = 20 * 1000;
// La hora (ms) del cierre del turno con que termina el registro, o null si lo último es de un turno abierto.
// P3 (04-11-2026): si el registro no cambió de tamaño ni de fecha desde la vuelta anterior, la respuesta es la misma y no
// se relee (antes eran hasta 512 KB por sesión cada 30 s). No es por evento: un vigía de archivos en Windows junta o
// pierde avisos, y esta revisión existe justamente para el aviso perdido.
const finesLeidos = new Map(); // archivo → { size, mtimeMs, t }
function finDeTurno(archivo) {
  let st;
  try { st = fs.statSync(archivo); } catch (e) { finesLeidos.delete(archivo); return null; }
  const antes = finesLeidos.get(archivo);
  if (antes && antes.size === st.size && antes.mtimeMs === st.mtimeMs) return antes.t;
  const t = leerFinDeTurno(archivo, st);
  finesLeidos.set(archivo, { size: st.size, mtimeMs: st.mtimeMs, t });
  return t;
}
function leerFinDeTurno(archivo, st) {
  const desde = Math.max(0, st.size - 512 * 1024);
  const b = Buffer.alloc(st.size - desde);
  const fd = fs.openSync(archivo, 'r');
  try { fs.readSync(fd, b, 0, b.length, desde); } finally { fs.closeSync(fd); }
  const lineas = b.toString('utf8').split('\n');
  for (let i = lineas.length - 1; i >= 0; i--) {
    let j;
    try { j = JSON.parse(lineas[i]); } catch (e) { continue; }
    if (j.type === 'user' || j.type === 'assistant') return null;
    if (j.type === 'system' && (j.subtype === 'turn_duration' || j.subtype === 'stop_hook_summary')) {
      const t = Date.parse(j.timestamp);
      return Number.isFinite(t) ? t : null;
    }
  }
  return null;
}
setInterval(() => {
  const vigentes = new Set();
  for (const s of sesiones.values()) {
    if (!s.flujo || s.estado !== 'trabajando') continue;
    const r = registroDe(s);
    vigentes.add(r);
    let t = null;
    try { t = r && finDeTurno(r); } catch (e) { t = null; }
    // El cierre tiene que ser de este turno (después de su UserPromptSubmit), no del anterior.
    if (!t || t < (s.inicioTurno || 0) || Date.now() - t < ESPERA_STOP_PERDIDO) continue;
    registrar('stop recuperado', s.id, s.flujo, s.etapa, Math.round((Date.now() - t) / 1000) + ' s');
    alHook({ panel: s.id, evento: 'Stop', datos: { cierre: t } });
  }
  for (const k of finesLeidos.keys()) if (!vigentes.has(k)) finesLeidos.delete(k);
}, 30 * 1000);

// ── Qué usas (sprint 14, H7): cuántas veces se usa cada botón, atajo y tipo de orden, para decidir qué priorizar ──
// Queda en uso.json junto al estado; no sale del computador.
const ARCHIVO_USO = path.join(DATOS, 'uso.json');
let uso = null;
let usoPendiente = null;
function leerUso() {
  if (!uso) { try { uso = JSON.parse(fs.readFileSync(ARCHIVO_USO, 'utf8')); } catch (e) { uso = { desde: new Date().toISOString().slice(0, 10), veces: {} }; } }
  return uso;
}
ipcMain.on('uso', (e, clave) => {
  if (typeof clave !== 'string' || !clave || clave.length > 80) return;
  const u = leerUso();
  u.veces[clave] = (u.veces[clave] || 0) + 1;
  clearTimeout(usoPendiente);
  usoPendiente = setTimeout(() => { try { fs.writeFileSync(ARCHIVO_USO, JSON.stringify(u, null, 1), 'utf8'); } catch (err) { registrar('no se pudo guardar el uso', err.message); } }, 2000);
});
ipcMain.handle('uso:leer', () => leerUso());
// Exportar para compartir (05-11-2026): solo cuentas por botón, atajo y tipo de orden. Sin textos, sin nombres de sesiones
// ni carpetas, sin costos. La persona elige dónde guardarlo y lo envía ella; Chocosys no manda nada por su cuenta.
ipcMain.handle('uso:exportar', async (e, nunca) => {
  const u = leerUso();
  const hoy = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(ventana, { title: 'Exportar qué usas', defaultPath: `chocosys-uso-${hoy}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return null;
  const salida = {
    formato: 'chocosys-uso-1', exportado: hoy, desde: u.desde, version: app.getVersion(),
    veces: u.veces || {}, nunca: Array.isArray(nunca) ? nunca.filter((x) => typeof x === 'string').slice(0, 200) : []
  };
  fs.writeFileSync(r.filePath, JSON.stringify(salida, null, 1), 'utf8');
  return r.filePath;
});

// ── Modelo y esfuerzo (sprint 15) ──
// Registro de corridas: una fila por turno, para los benchmarks propios («qué modelo usar en qué tipo de tarea»).
const ARCHIVO_CORRIDAS = path.join(DATOS, 'corridas.jsonl');
// La statusLine trae el costo del turno DESPUÉS del Stop (agrupa cambios cada 300 ms): escrita en el Stop, la fila salía
// siempre con costo 0 (verificación de D, 22-10-2026). Ahora la fila espera ESPERA_COSTO_CORRIDA y toma el último costo
// que llegó en ese rato (alHook, «Linea»). Si antes parte otro turno o se cambia el modelo, se escribe con lo que tiene.
const ESPERA_COSTO_CORRIDA = 1500;
function registrarCorrida(s) {
  if (!s.inicioTurno) return;
  escribirCorrida(s);
  const l = s.linea || {};
  const fin = s.cierreTurno && s.cierreTurno >= s.inicioTurno ? s.cierreTurno : Date.now();
  s.cierreTurno = 0;
  const p = {
    fila: {
      fecha: new Date().toISOString(), sesion: s.nombre, espacio: nombreEspacio(s.espacio), tarea: recortar(s.ultimo, 120),
      modelo: l.modelo || s.modelo || '', esfuerzo: l.esfuerzo || s.esfuerzo || '', segundos: Math.round((fin - s.inicioTurno) / 1000)
    },
    subagentes: (s.subagentes || []).length, costoInicio: s.costoInicio, costoFin: l.costo
  };
  p.reloj = setTimeout(() => escribirCorrida(s), ESPERA_COSTO_CORRIDA);
  s.corridaPendiente = p;
  s.inicioTurno = 0;
}
function escribirCorrida(s) {
  const p = s.corridaPendiente;
  if (!p) return;
  s.corridaPendiente = null;
  clearTimeout(p.reloj);
  const costo = p.costoFin != null && p.costoInicio != null ? Math.round((p.costoFin - p.costoInicio) * 10000) / 10000 : null;
  const fila = { ...p.fila, costo, subagentes: p.subagentes };
  fs.appendFile(ARCHIVO_CORRIDAS, JSON.stringify(fila) + '\n', 'utf8', () => {});
}

// Cambiar modelo y esfuerzo: la sesión quieta se cierra y se retoma al tiro con --resume, --model y --effort, que valen
// solo para ella. No se escribe /model: Claude Code lo guarda como predeterminado en ~\.claude\settings.json (prueba del
// 21-10-2026: «saved as your default for new sessions»), y Chocosys no toca la configuración global. Nunca encima de una
// tarea: si trabaja o está a mitad de turno esperando a quien usa la app («te necesita»: permiso o pregunta abierta), espera a que
// termine; cerrarla ahí perdía la pregunta (verificación de D, 22-10-2026).
function aplicarModelo(s, modelo, esfuerzo, conservar) {
  const p = procesos.get(s.id);
  if (!p) return;
  if (MODELOS[modelo]) s.modelo = modelo;
  if (ESFUERZOS.includes(esfuerzo)) s.esfuerzo = esfuerzo;
  s.reabrir = true;
  escribirCorrida(s);
  s.linea = null;
  registrar('modelo cambiado', s.id, s.modelo || '', s.esfuerzo || '');
  // Se reabre al salir el PTY, o sea después de cerrar el árbol: el claude.exe nuevo no alcanza a caer.
  matarConArbol(s, p, conservar, true);
}
ipcMain.handle('modelo:cambiar', (e, id, modelo, esfuerzo) => {
  const s = sesiones.get(id);
  if (!s || !procesos.has(id)) return { ok: false, motivo: 'La sesión está cerrada: retómala primero.' };
  if (s.estado === 'trabajando' || s.estado === 'necesita') { s.cambioPendiente = { modelo, esfuerzo }; difundir(); return { ok: true, espera: true, necesita: s.estado === 'necesita' }; }
  return cambiarModeloPreguntando(s, modelo, esfuerzo);
});
// Cambiar el modelo cierra el árbol de la sesión: con un cálculo vivo, primero la pregunta (decisión de quien usa la app, 03-11-2026).
async function cambiarModeloPreguntando(s, modelo, esfuerzo) {
  const conservar = await preguntarCierre(s, 'modelo');
  if (!conservar) return { ok: false, motivo: 'No se cambió el modelo: el cálculo sigue corriendo.' };
  aplicarModelo(s, modelo, esfuerzo, conservar);
  return { ok: true };
}
// L1: sugerencia al instante, con las reglas, la pestaña y lo que quien usa la app eligió antes (elecciones.json).
const ARCHIVO_ELECCIONES = path.join(DATOS, 'elecciones.json');
let elecciones = null;
function leerElecciones() {
  if (!elecciones) { try { elecciones = JSON.parse(fs.readFileSync(ARCHIVO_ELECCIONES, 'utf8')); } catch (e) { elecciones = []; } }
  return elecciones;
}
ipcMain.handle('modelo:sugerir', (e, texto) => elegirModelo(texto, { espacio: nombreEspacio(espacioActual), elecciones: leerElecciones(), conClientes: perfil().pestanas_con_clientes }));
// Lo que la ventana necesita del perfil (sprint 18): nombre, responsables del CRM y el orden de los grupos de recetas.
ipcMain.handle('perfil', () => {
  const p = perfil();
  const c = p.central ? { nombre: String(p.central.nombre || 'Central'), activa: !!p.central.activa } : null;
  return { nombre: p.nombre, responsables: p.responsables, orden_recetas: p.orden_recetas, central: c, mcp_por_sesion: !!mcpPorSesion() };
});

// ── Créditos, «sobre mí» y reporte de fallos (13-11-2026) ──
// Todo vive en DATOS, en este computador. Nada sale solo: el «sobre mí» va a Claude solo si la persona lo elige, y el
// reporte se guarda en una carpeta para que ella lo mande a mano.
const ARCHIVO_MARCAS = path.join(DATOS, 'marcas.json');
const ARCHIVO_SOBRE_MI = path.join(DATOS, 'sobre-mi.json');
const leerJson = (archivo, base) => { try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch (e) { return base; } };
const guardarJson = (archivo, datos) => fs.writeFileSync(archivo, JSON.stringify(datos, null, 2), 'utf8');
const leerConfig = (nombre) => { try { return fs.readFileSync(path.join(__dirname, 'config', nombre), 'utf8'); } catch (e) { return ''; } };
const contacto = () => { try { return JSON.parse(leerConfig('contacto.json')); } catch (e) { return {}; } };
// Lo que cada sesión nueva recibe al comenzar, solo con «usar_en_sesiones» (lo marca la persona en la ventana).
function fraseSobreMi() {
  const s = leerJson(ARCHIVO_SOBRE_MI, null);
  if (!s || !s.usar_en_sesiones) return '';
  const l = [s.nombre && `Se llama (o le dicen) ${s.nombre}.`, s.dedica && `Se dedica a: ${s.dedica}.`, s.quiere && `Quiere usar Chocosys para: ${s.quiere}.`].filter(Boolean);
  return l.length ? 'Sobre quien usa Chocosys (lo escribió en la app y lo puede cambiar o borrar): ' + l.join(' ') : '';
}
ipcMain.handle('bienvenida:marcas', () => leerJson(ARCHIVO_MARCAS, {}));
ipcMain.handle('bienvenida:marcar', (e, clave) => {
  if (!['creditos_vistos', 'sobre_mi_preguntado'].includes(clave)) return false;
  const m = leerJson(ARCHIVO_MARCAS, {});
  m[clave] = new Date().toISOString().slice(0, 10);
  guardarJson(ARCHIVO_MARCAS, m);
  return true;
});
ipcMain.handle('creditos:leer', () => ({ texto: leerConfig('creditos.md'), version: app.getVersion(), instagram: contacto().instagram || '', enlace: contacto().instagram_enlace || '' }));
ipcMain.handle('sobremi:leer', () => leerJson(ARCHIVO_SOBRE_MI, null));
ipcMain.handle('sobremi:guardar', (e, d) => {
  const s = { actualizado: new Date().toISOString().slice(0, 10), usar_en_sesiones: !!(d && d.usar_en_sesiones) };
  for (const k of ['nombre', 'dedica', 'quiere']) s[k] = String((d && d[k]) || '').trim().slice(0, 300);
  guardarJson(ARCHIVO_SOBRE_MI, s);
  return s;
});
ipcMain.handle('sobremi:borrar', () => { try { fs.unlinkSync(ARCHIVO_SOBRE_MI); } catch (e) { /* no había */ } return true; });
// La captura se toma antes de abrir el diálogo (para que no salga el diálogo) y queda en memoria hasta guardar o cancelar.
let capturaReporte = null;
ipcMain.handle('reporte:capturar', async () => {
  capturaReporte = null;
  if (!ventana || ventana.isDestroyed()) return null;
  capturaReporte = await ventana.webContents.capturePage();
  return capturaReporte.resize({ width: 640 }).toDataURL();
});
ipcMain.handle('reporte:previa', (e, d) => {
  const archivo = path.join(DATOS, 'registro.txt');
  const registro = d && d.conRegistro && fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8').trim().split(/\r?\n/).slice(-40).join('\n') : '';
  return reporte.armar({
    version: app.getVersion(), electron: process.versions.electron, windows: require('os').release(),
    capturas: d && d.conCaptura && capturaReporte ? 1 : 0, paso: d && d.paso, esperaba: d && d.esperaba, pasos: d && d.pasos, registro
  });
});
ipcMain.handle('reporte:guardar', (e, texto, conCaptura) => {
  // Con segundos: con minutos, un segundo reporte en el mismo minuto pisaba reporte.md y dejaba la captura vieja.
  const sello = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const carpeta = path.join(DATOS, 'reportes', sello);
  fs.mkdirSync(carpeta, { recursive: true });
  // Se tacha otra vez: la persona pudo escribir un dato en la vista previa.
  const limpio = reporte.tachar(String(texto || ''));
  fs.writeFileSync(path.join(carpeta, 'reporte.md'), limpio, 'utf8');
  if (conCaptura && capturaReporte) fs.writeFileSync(path.join(carpeta, 'captura-1.png'), capturaReporte.toPNG());
  capturaReporte = null;
  clipboard.writeText(limpio);
  shell.openPath(carpeta);
  registrar('reporte de fallo guardado (no se envía solo)');
  return { carpeta, instagram: contacto().instagram || '' };
});
ipcMain.handle('reporte:cancelar', () => { capturaReporte = null; return true; });
ipcMain.on('modelo:eleccion', (e, texto, modelo, esfuerzo) => {
  if (!MODELOS[modelo] || !ESFUERZOS.includes(esfuerzo)) return;
  const lista = leerElecciones();
  lista.push({ palabras: [...palabrasDe(texto)], espacio: nombreEspacio(espacioActual), modelo, esfuerzo, texto: recortar(texto, 60), fecha: new Date().toISOString().slice(0, 10) });
  elecciones = lista.slice(-200);
  try { fs.writeFileSync(ARCHIVO_ELECCIONES, JSON.stringify(elecciones, null, 1), 'utf8'); } catch (err) { registrar('no se pudo guardar la elección', err.message); }
});

ipcMain.on('pty:abrir', (e, id, cols, rows) => abrir(id, cols, rows));
ipcMain.on('pty:escribir', (e, id, datos) => { const p = procesos.get(id); if (p) p.write(datos); });
ipcMain.on('pty:tamano', (e, id, cols, rows) => {
  if (!(cols > 0 && rows > 0)) return;
  const s = sesiones.get(id);
  // Se guarda aunque el PTY todavía no exista: abrir() lo abre con este tamaño y no con el 120x32 de abrirAlMedir.
  if (s) s.tam = { cols, rows };
  const p = procesos.get(id);
  if (!p) return;
  // Recién reconectada, la ventana está en blanco: un cambio de tamaño de ida y vuelta hace que Claude la redibuje.
  if (s && s.reconectada) {
    s.reconectada = false;
    p.resize(Math.max(cols - 1, 2), rows);
    setTimeout(() => p.resize(cols, rows), 80);
    return;
  }
  p.resize(cols, rows);
});
ipcMain.handle('portapapeles:escribir', (e, texto) => { clipboard.writeText(String(texto)); });
// Dónde guarda Claude Code la conversación de cada sesión, para que una sesión nueva pueda leerla y juntar el
// trabajo de varias: ~\.claude\projects\<carpeta con todo lo que no es letra o número cambiado por «-»>\<sessionId>.jsonl.
ipcMain.handle('sesion:transcripciones', (e, ids) => (Array.isArray(ids) ? ids : []).map((id) => {
  const s = sesiones.get(id);
  if (!s) return null;
  const carpetaProyecto = path.join(app.getPath('home'), '.claude', 'projects', String(s.carpeta || '').replace(/[^A-Za-z0-9]/g, '-'));
  const ruta = path.join(carpetaProyecto, conversacionDe(s) + '.jsonl');
  return { id, nombre: s.nombre, carpeta: s.carpeta, ruta, existe: fs.existsSync(ruta), carpetaProyecto };
}).filter(Boolean));

app.setName('Chocosys');
app.setAppUserModelId('cl.camilomerino.chocosys');

// Una sola consola a la vez: la segunda trae la primera al frente y termina ahí mismo. Antes solo llamaba
// a app.quit(), que no corta el arranque: la segunda podía alcanzar a cerrar los claude.exe vivos de la
// primera (cerrarHuerfanas) y pisar hooks.json y conexion.json.
const esLaPrimera = app.requestSingleInstanceLock();
if (!esLaPrimera) { app.quit(); }
app.on('second-instance', mostrarVentana);

// Si la consola anterior se cerró a la fuerza, sus claude.exe siguen vivos sin ventana.
// Se reconocen por el archivo de hooks de la consola en su línea de comando; ninguna otra sesión se toca.
// Se espera a que termine antes de abrir sesiones nuevas, para no cerrar ninguna de las nuevas.
// Las del dueño de terminales (su pid) no son huérfanas: siguen vivas a propósito.
function cerrarHuerfanas(dueno) {
  const orden = `Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object { $_.CommandLine -like '*${ARCHIVO_HOOKS.replace(/'/g, "''")}*' -and $_.ParentProcessId -ne ${Number(dueno) || 0} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }`;
  return new Promise((resolver) => {
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', orden], { windowsHide: true, timeout: 15000 }, (err, salida) => {
      const ids = String(salida || '').trim();
      if (ids) registrar('huérfanas cerradas', ids.replace(/\s+/g, ','));
      resolver();
    });
  });
}

// ── Recursos del PC (PRD-05) ──
// Totales cada 2 s, sin lanzar nada (módulo os); con la ventana oculta o minimizada, cada 10 s, solo para poder avisar (D1).
// La foto de procesos (un PowerShell vivo) se pide solo con el panel abierto, al saltar una alerta y desde el MCP (D2).
let pidDueno = 0, pasoRecursos = 0;
const recuerdoRecursos = new Map();
setInterval(() => {
  const oculta = !ventana || !ventana.isVisible() || ventana.isMinimized();
  if (oculta && pasoRecursos++ % 5) return;
  const nueva = recursos.medirTotales(Date.now(), !oculta);
  if (nueva) avisarRecursos(nueva).catch((e) => registrar('recursos', e.message));
}, 2000);

async function avisarRecursos(a) {
  const d = await detalleRecursos();
  const top = [...d.grupos].sort((x, y) => (a.tipo === 'ram' ? y.mb - x.mb : y.nucleos - x.nucleos))[0];
  a.culpable = top ? top.nombre + (a.tipo === 'ram' ? ` (${(top.mb / 1024).toFixed(1)} GB)` : ` (${top.nucleos.toFixed(1)} núcleos)`) : '';
  registrar('recursos alerta', a.tipo, a.valor, a.culpable);
  if (!ventana || !ventana.isFocused()) notificar(a.tipo === 'ram' ? `RAM al ${a.valor} %` : `CPU al ${a.valor} % hace más de 30 s`, a.culpable ? 'Lo que más usa: ' + a.culpable + '. Clic: ver el detalle en Chocosys.' : 'Clic: ver el detalle en Chocosys.');
}

async function detalleRecursos() {
  const f = await recursos.foto();
  const propios = [process.pid, pidDueno, recursos.pidPs(), ...app.getAppMetrics().map((m) => m.pid)].filter(Boolean);
  const lista = [...sesiones.values()].map((s) => ({ id: s.id, nombre: s.nombre, sessionId: s.sessionId, estado: s.estado, cambio: s.cambio, viva: !!s.viva, espacio: nombreEspacio(s.espacio), central: !!s.central, flujo: s.flujo || null }));
  const ctx = { sesionWin: f.sesionWin, propios, sesiones: lista, recuerdo: recuerdoRecursos, ahora: f.ahora, cpuEquipo: recursos.cpuMedia(30) };
  const grupos = recursos.agrupar(f.procesos, ctx);
  const vivas = lista.filter((s) => s.viva);
  return { totales: recursos.totales(), grupos, costo: recursos.costoPropio(f.procesos),
    sesiones: { vivas: vivas.length, trabajando: vivas.filter((s) => s.estado === 'trabajando').length } };
}

// Lo que viaja a la ventana y al MCP: los grupos más pesados y todas las sesiones (aunque estén quietas), cada uno con
// sus 6 procesos más pesados, sin la lista entera. Peso: 1 núcleo cuenta como 1 GB.
function resumenRecursos(d, cuantos = 10) {
  const r1 = (x) => Math.round(x * 10) / 10;
  const orden = [...d.grupos].sort((a, b) => b.nucleos * 1024 + b.mb - (a.nucleos * 1024 + a.mb));
  return Object.assign({}, d, {
    grupos: orden.filter((g, i) => i < cuantos || g.tipo === 'sesion' || g.tipo === 'cerrada').map((g) => Object.assign({}, g, {
      mb: Math.round(g.mb), nucleos: r1(g.nucleos),
      procesos: g.procesos.slice(0, 6).map((p) => ({ pid: p.pid, inicio: p.inicio, nombre: p.nombre, mb: Math.round(p.mb), nucleos: r1(p.media30 != null ? p.media30 : p.nucleos || 0), huerfano: p.huerfano, cmd: (p.cmd || '').slice(0, 160) }))
    }))
  });
}

recursos.configurar({ umbral: perfil().recursos });

ipcMain.handle('recursos:leer', () => recursos.totales());
ipcMain.handle('recursos:detalle', async () => resumenRecursos(await detalleRecursos()));

app.whenReady().then(async () => {
  if (!esLaPrimera) return;
  fs.mkdirSync(DATOS, { recursive: true });
  await cerrarHuerfanas(await conectarTerminales());
  claudeExe = buscar('claude', path.join(app.getPath('home'), '.local', 'bin', 'claude.exe'));
  const nodeExe = buscar('node', 'C:\\Program Files\\nodejs\\node.exe');
  if (nodeExe) escribirHooks(nodeExe);
  puerto = await iniciarServidor();
  // El MCP lee de acá dónde y con qué token hablarle a esta consola (cambia en cada apertura).
  try { fs.writeFileSync(ARCHIVO_CONEXION, JSON.stringify({ puerto, token: TOKEN, pid: process.pid, abierta: new Date().toISOString() }), 'utf8'); } catch (e) { registrar('sin conexion.json', e.message); }
  sembrarDatos();
  configurarLoPropio();
  cargarEstado();
  reconectarVivas();
  crearVentana();
  // Después de reconectar: si la central sigue viva en el dueño de terminales, no se abre otra.
  asegurarCentral().catch((e) => registrar('central sin abrir', e.message));
  // Las atrasadas, cuando la central ya tuvo tiempo de abrir (una orden escrita antes de que Claude Code parta se pierde).
  setTimeout(() => { revisarProgramadas(true).catch((e) => registrar('programadas al abrir', e.message)); }, 30 * 1000);
  // Para pruebas (y para los flujos): electron . --abrir="C:\carpeta" --instruccion="texto"
  const opcion = (nombre) => {
    const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
    return a ? a.slice(nombre.length + 3) : null;
  };
  const carpetaInicial = opcion('abrir');
  const flujoInicial = opcion('flujo');
  if (carpetaInicial && flujoInicial && fs.existsSync(carpetaInicial)) {
    ventana.webContents.once('did-finish-load', async () => {
      const receta = leerRecetas().find((r) => r.id === flujoInicial);
      if (!receta) return;
      const f = await lanzarReceta(receta, carpetaInicial, { simulacro: process.argv.includes('--simulacro') }, true);
      const primera = f.items[f.actual] && f.items[f.actual].sesiones[0];
      if (primera) setTimeout(() => enviar('seleccionar', primera), 800);
    });
  } else if (carpetaInicial && fs.existsSync(carpetaInicial)) {
    ventana.webContents.once('did-finish-load', async () => {
      const s = await nuevaSesion(carpetaInicial, opcion('instruccion'));
      setTimeout(() => enviar('seleccionar', s.id), 600);
    });
  }
  if (!nodeExe) {
    dialog.showErrorBox('Falta Node.js', 'Los estados de las sesiones necesitan node.exe en el PATH. Las terminales funcionan igual.');
  }
});

app.on('before-quit', () => {
  recursos.parar();
  if (!esLaPrimera) return;
  // Lo de los últimos 300 ms también queda guardado.
  if (guardadoPendiente) guardarYa();
  if (usoPendiente && uso) { clearTimeout(usoPendiente); try { fs.writeFileSync(ARCHIVO_USO, JSON.stringify(uso, null, 1), 'utf8'); } catch (e) { /* sin uso */ } }
  // Las terminales no se cierran: siguen en terminales.js y vuelven al reabrir. Sin consola por 10 minutos, se cierran.
  // Sin consola abierta, el MCP responde «Chocosys no está abierta» en vez de intentar un puerto muerto.
  try { if (JSON.parse(fs.readFileSync(ARCHIVO_CONEXION, 'utf8')).pid === process.pid) fs.unlinkSync(ARCHIVO_CONEXION); } catch (e) { /* no estaba */ }
});

app.on('window-all-closed', () => app.quit());
