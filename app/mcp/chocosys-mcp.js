#!/usr/bin/env node
// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Servidor MCP de Chocosys (stdio, sin dependencias). Cada herramienta le pide a la consola abierta,
// por su servidor local, que haga algo: leer el estado, abrir u ordenar sesiones, crear y editar
// recetas, lanzar flujos y personalizar la interfaz. El puerto y el token están en
// %APPDATA%\consola-agentes\conexion.json y cambian cada vez que se abre la app.
// Aprobar una puerta no existe acá: las puertas las aprueba en la ventana quien usa Chocosys.

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
// Cada lite deja fuera lo que no lleva (edicion.js); main.js lo rechaza igual si llega.
const edicion = require('../edicion');

// CHOCOSYS_DATOS apunta a una consola de prueba abierta con --datos (la carpeta que contiene consola-agentes).
// En macOS la app guarda sus datos en ~/Library/Application Support (app.getPath('appData')), y ahí no hay %APPDATA%.
const DATOS = path.join(process.env.CHOCOSYS_DATOS || process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), 'AppData', 'Roaming')), 'consola-agentes');
const VERSION = '0.1.0';
// Quién usa esta Chocosys (sprint 18): su nombre sale de perfil.json, en sus datos, no del programa.
const NOMBRE = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATOS, 'perfil.json'), 'utf8')).nombre || ''; } catch (e) { return ''; } })() || 'quien usa Chocosys';

const INSTRUCCIONES = [
  'Chocosys es la consola de agentes de ' + NOMBRE + ' (Electron): sesiones de Claude Code en terminales reales, agrupadas en espacios, y flujos (recetas YAML con etapas y puertas).',
  'Reglas: (1) las puertas las aprueba ' + NOMBRE + ' en la ventana; por acá solo se leen con puerta_ver. (2) Una receta que emite algo (correlativos, envíos, entregas) se lanza siempre en simulacro.',
  '(3) Antes de ordenarle algo a una sesión, mira su estado con «estado»: si está trabajando, la orden se encola detrás de lo que hace.',
  '(4) Para cambiar cómo se ve: interfaz_estilo (CSS encima del tema Brasa, reversible) y interfaz_captura para mirar el resultado. Para cambios de código, edita app/renderer y usa interfaz_recargar; main.js y flujos.js necesitan que ' + NOMBRE + ' cierre y abra la app.',
  '(5) Recetas: kebab-minúscula; cada etapa con nombre e instruccion; puertas con «puerta: texto» (critica: true si lo que sigue no se deshace; elegir: true si la puerta despliega una lista numerada para marcar). Modelos: auto, haiku u opus. Cada receta lleva «entorno:» (un entorno de entornos.json) y trabaja en carpetas reales: «carpeta:» si es siempre la misma, «buscar_en:» si cambia en cada corrida.',
  '(6) Dónde abrir una sesión: «lugares». Una sesión a cargo de una coordinadora (o de la central, la que Chocosys abre al iniciar) no abre ni cierra sesiones y habla solo con quien la tiene a cargo y con las que esta le enlazó. (7) Tareas que se repiten o a una hora: «programar» (crons de Chocosys); antes de guardar, dile a ' + NOMBRE + ' la hora en palabras.'
].join(' ');

const HERRAMIENTAS = [
  { name: 'estado', description: 'Espacios, sesiones (estado, último mensaje, carpeta) y flujos (etapas, puertas, tiempos) de la consola abierta.', inputSchema: { type: 'object', properties: {} } },
  { name: 'recursos', description: 'Uso de CPU y RAM del PC ahora (con los últimos 5 minutos y la alerta vigente), lo que más consume agrupado por sesión de Chocosys y por programa, y cuántas sesiones trabajan. Solo lectura: sirve para decidir antes de abrir una sesión pesada. Una sesión se cierra con sesion_cerrar.', inputSchema: { type: 'object', properties: {} } },
  { name: 'lugares', description: 'Dónde se puede abrir una sesión, como el menú «Sesión nueva» de la ventana: los entornos (con su carpeta, si existe y su pestaña), las pestañas con carpeta, las carpetas con sesiones abiertas, y los modelos y esfuerzos que acepta sesion_nueva.', inputSchema: { type: 'object', properties: {} } },
  { name: 'sesion_nueva', description: 'Abre una sesión nueva de Claude Code en una carpeta o en un entorno (mira las opciones con «lugares»), con una instrucción inicial opcional.', inputSchema: { type: 'object', properties: {
    carpeta: { type: 'string', description: 'Ruta absoluta de la carpeta del trabajo (por defecto, la del entorno)' }, entorno: { type: 'string', description: 'Nombre de un entorno de «lugares»: su carpeta si no se da otra, y su pestaña si no se da espacio' },
    instruccion: { type: 'string' }, nombre: { type: 'string', description: 'Nombre visible (por defecto, el de la carpeta)' }, espacio: { type: 'string', description: 'Nombre del espacio; se crea si no existe' },
    modelo: { type: 'string', enum: ['haiku', 'sonnet', 'opus'], description: 'Opcional; por defecto el de Claude Code' }, esfuerzo: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'], description: 'Opcional' },
    con: { type: 'array', items: { type: 'string' }, description: 'Solo para una coordinadora o la central: sesiones a tu cargo con las que la nueva podrá hablar desde que nace. Por defecto, con ninguna' },
    mcp: { type: 'array', items: { type: 'string', enum: ['rea', 'whatsapp', 'methodic', 'effectcraft', 'chrome', 'todo'] }, description: 'Con el perfil MCP por sesión encendido: servidores que se suman a los de su entorno (chocosys siempre). «todo» la abre con todos, también Gmail y Docs de claude.ai. Sin perfil encendido no hace nada' } } } },
  { name: 'sesion_enlazar', description: 'Para una coordinadora o la central: enlaza (o desenlaza con quitar: true) sesiones a tu cargo para que se hablen con sesion_leer y sesion_ordenar. Sin enlace, una sesión a cargo habla solo con quien la tiene a cargo. Enlaza solo cuando una necesita algo de la otra mientras las dos trabajan.', inputSchema: { type: 'object', properties: {
    sesion: { type: 'string', description: 'Id o nombre' }, con: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'La otra sesión, o una lista' }, quitar: { type: 'boolean' } }, required: ['sesion', 'con'] } },
  { name: 'sesion_cerrar', description: 'Cierra sesiones y sus terminales, como la × de la ventana. Una, varias (lista) o «quietas: true» (todas las que no trabajan ni esperan respuesta, de un espacio o de todos). Nunca cierra la sesión que lo pide, una de flujo (se cierra al quitar el flujo en la ventana) ni una que espera que ' + NOMBRE + ' le responda. Tampoco una con un cálculo vivo (procesos suyos gastando CPU): la deja abierta y dice por qué. Una que está trabajando o tiene un cálculo vivo, solo con «forzar: true» y si ' + NOMBRE + ' lo ordenó explícitamente (corta el cálculo).', inputSchema: { type: 'object', properties: {
    sesion: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Id o nombre, o lista de ellos' }, quietas: { type: 'boolean', description: 'En vez de «sesion»: todas las que están en pausa o terminaron' },
    espacio: { type: 'string', description: 'Con «quietas»: solo las de este espacio' }, forzar: { type: 'boolean', description: 'Cierra también una que está trabajando o tiene un cálculo vivo, y lo corta. Solo por orden explícita' } } } },
  { name: 'sesion_leer', description: 'Lo que dijo e hizo una sesión: su estado, la última orden que recibió, la herramienta que usa, su modelo, sus subagentes y su último mensaje completo (hasta 8.000 caracteres). Para una coordinadora: léela cuando Chocosys te avise que terminó.', inputSchema: { type: 'object', properties: { sesion: { type: 'string', description: 'Id o nombre de la sesión' } }, required: ['sesion'] } },
  { name: 'sesion_ordenar', description: 'Le escribe a una sesión viva (como @nombre: en la barra de comando). Una sesión a cargo de una coordinadora solo le escribe a ella y a sus enlaces, y le llega como [de «su nombre»].', inputSchema: { type: 'object', properties: { sesion: { type: 'string', description: 'Id o nombre de la sesión' }, texto: { type: 'string' } }, required: ['sesion', 'texto'] } },
  { name: 'sesion_renombrar', description: 'Cambia el nombre visible de una sesión.', inputSchema: { type: 'object', properties: { sesion: { type: 'string' }, nombre: { type: 'string' } }, required: ['sesion', 'nombre'] } },
  { name: 'programadas', description: 'Las tareas programadas (crons de Chocosys): cuándo tocan, qué hacen, la próxima vez y cómo salió la última.', inputSchema: { type: 'object', properties: {} } },
  { name: 'programar', description: 'Crea una tarea programada, o la reemplaza entera si das su id. Corre mientras Chocosys está abierta; si estaba cerrada a su hora, corre una vez al abrir (si fue en las últimas 24 horas y atrasada no es «saltar»). Tres tipos: «orden» le escribe el texto a la central (o a «sesion»); «sesion» abre una sesión nueva con el texto como instrucción, en carpeta o entorno (con la central viva, queda a su cargo); «receta» lanza un flujo, en simulacro salvo simulacro: false, que solo va si ' + NOMBRE + ' lo pidió. Pásale a ' + NOMBRE + ' la hora en palabras antes de guardarla.', inputSchema: { type: 'object', properties: {
    id: { type: 'string', description: 'Solo para reemplazar una que existe' }, nombre: { type: 'string', description: 'Corto: qué hace' },
    cuando: { type: 'string', description: 'Se repite: cron de 5 campos en hora local (minuto hora día-del-mes mes día-de-la-semana). «30 7 * * 1-5» = lunes a viernes 7:30; «0 9 * * 1» = lunes 9:00; «0 */2 * * *» = cada 2 horas; «0 18 1 * *» = el 1 de cada mes a las 18:00' },
    en: { type: 'string', description: 'Una sola vez, en vez de cuando: «AAAA-MM-DD HH:MM», hora local' },
    tipo: { type: 'string', enum: ['orden', 'sesion', 'receta'] }, texto: { type: 'string', description: 'La orden o la instrucción, completa y que se entienda sola (qué revisar, qué dejar y dónde)' },
    sesion: { type: 'string', description: 'tipo orden: a quién, si no es la central' }, carpeta: { type: 'string' }, entorno: { type: 'string', description: 'tipo sesion: un entorno de «lugares»' },
    receta: { type: 'string', description: 'tipo receta: su id' }, simulacro: { type: 'boolean', default: true },
    modelo: { type: 'string', enum: ['haiku', 'sonnet', 'opus'] }, esfuerzo: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] },
    atrasada: { type: 'string', enum: ['correr', 'saltar'], default: 'correr' }, activa: { type: 'boolean', default: true } }, required: ['nombre', 'tipo'] } },
  { name: 'programada_quitar', description: 'Quita una tarea programada (queda anotada en programadas-retiradas.jsonl).', inputSchema: { type: 'object', properties: { tarea: { type: 'string', description: 'Id o nombre' } }, required: ['tarea'] } },
  { name: 'programada_correr', description: 'Corre una tarea programada ahora, sin esperar su hora, para probarla.', inputSchema: { type: 'object', properties: { tarea: { type: 'string', description: 'Id o nombre' } }, required: ['tarea'] } },
  { name: 'espacio_nuevo', description: 'Crea un espacio (un lienzo propio), con carpeta opcional para la barra de comando.', inputSchema: { type: 'object', properties: { nombre: { type: 'string' }, carpeta: { type: 'string' } }, required: ['nombre'] } },
  { name: 'espacio_renombrar', description: 'Cambia el nombre de un espacio (una pestaña), como renombrarla en la ventana. Se niega si ya hay otro con ese nombre. La pestaña de la central vuelve al iniciar al nombre de perfil.json («central.pestana»).', inputSchema: { type: 'object', properties: { espacio: { type: 'string', description: 'Id o nombre actual' }, nombre: { type: 'string', description: 'Nombre nuevo (hasta 40 caracteres)' } }, required: ['espacio', 'nombre'] } },
  { name: 'espacio_elegir', description: 'Cambia la ventana al espacio indicado.', inputSchema: { type: 'object', properties: { espacio: { type: 'string', description: 'Id o nombre' } }, required: ['espacio'] } },
  { name: 'espacio_borrar', description: 'Borra un espacio (una pestaña), como su ×. Sin «cerrar», sus sesiones y flujos pasan a otro espacio. Con «cerrar: true», se cierran sus sesiones y se quitan sus flujos terminados; se niega si alguna sesión está trabajando o esperando respuesta, si hay un flujo sin terminar o si la sesión que lo pide está en ese espacio.', inputSchema: { type: 'object', properties: { espacio: { type: 'string', description: 'Id o nombre' }, cerrar: { type: 'boolean', description: 'true cierra sus sesiones y quita sus flujos; por defecto pasan a otro espacio' } }, required: ['espacio'] } },
  { name: 'recetas', description: 'Lista las recetas de flujo con sus etapas y puertas.', inputSchema: { type: 'object', properties: {} } },
  { name: 'receta_leer', description: 'Devuelve el YAML de una receta.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'receta_proponer', description: 'Propone una receta de flujo armada a partir de lo que se hizo en esta sesión. No la guarda entre las recetas: Chocosys la valida (con la misma regla con que la ventana guarda), deja un borrador y la abre en la ventana para que ' + NOMBRE + ' la vea, corrija y guarde. Si el YAML no pasa, vuelve el error en palabras: corrígelo y llama de nuevo.', inputSchema: { type: 'object', properties: {
    id: { type: 'string', description: 'Id sugerido, en kebab-minúscula' }, yaml: { type: 'string', description: 'La receta completa (nombre, entorno, carpeta o buscar_en, etapas y puertas)' },
    porque: { type: 'array', items: { type: 'string' }, description: 'Una línea por etapa y por puerta, en el mismo orden: por qué está (qué se hizo en la conversación que la justifica)' },
    resumen: { type: 'string', description: 'Opcional: en una o dos frases, qué trabajo de la conversación se convierte en flujo' } }, required: ['id', 'yaml'] } },
  { name: 'flujo_lanzar', description: 'Lanza un flujo desde una receta. Por defecto en simulacro (termina en la primera puerta). simulacro:false solo si la receta no emite nada irreversible o ' + NOMBRE + ' lo pidió.', inputSchema: { type: 'object', properties: { receta: { type: 'string' }, carpeta: { type: 'string', description: 'Carpeta del trabajo (por defecto, la de la receta)' }, simulacro: { type: 'boolean', default: true }, agentes: { type: 'object', description: 'Opcional: {índice de etapa paralela: n de agentes}' }, modelos: { type: 'object', description: 'Opcional: {índice de etapa: haiku u opus}, para probar barato' }, parametros: { type: 'object', description: 'Opcional: {índice de etapa con acción: {parámetro: valor}}; pisan los de la receta solo en esta corrida. Una puerta crítica se detiene siempre' } }, required: ['receta'] } },
  { name: 'sala_llevar', description: 'Segunda opinión del directorio (sala directiva): asesores propios que se confrontan sobre una decisión, idea o proyecto y entregan un veredicto. Arma la carpeta de la corrida (la decisión, el contexto del negocio si se da negocio_id, el contexto libre y los perfiles) y lanza la receta según la profundidad: «opinion», «plan» (por defecto) e «investigacion» corren en una sola sesión, sin puerta, y la de investigación busca en internet; «debate» (la rápida, 11 sesiones Opus) y «completo» (22, solo si ' + NOMBRE + ' la pide) van en simulacro hasta su puerta. La opinión queda en la lista de opiniones (sala_opiniones); anotarla en un negocio lo hace ' + NOMBRE + ' desde la ventana.', inputSchema: { type: 'object', properties: {
    decision: { type: 'string', description: 'Qué hay que decidir u opinar, en una o dos frases' }, negocio_id: { type: 'number', description: 'Opcional: el negocio del CRM a la vista' },
    profundidad: { type: 'string', enum: ['opinion', 'plan', 'investigacion', 'debate', 'completo'], default: 'plan', description: 'Qué tan a fondo: opinión de una idea precisa, con plan de acción, con investigación en internet, debate en sesiones aparte o directorio completo' },
    contexto: { type: 'string', description: 'Opcional: texto o enlaces que la sala debe tener en cuenta' },
    version: { type: 'string', enum: ['rapida', 'completa', 'prueba'], description: 'Solo si no se da profundidad (compatibilidad con el sprint 7)' }, tema: { type: 'string', enum: ['plata', 'cliente', 'legal', 'operacion', 'personal'], description: 'Elige los 4 asientos de la rápida' },
    asientos: { type: 'array', items: { type: 'string', enum: ['caja', 'comercial', 'operacion', 'metodo', 'tu-tiempo', 'legal'] }, description: 'Opcional: en vez del tema' },
    inclinacion: { type: 'string', description: 'Opcional: hacia dónde se inclina ' + NOMBRE + ' y por qué' }, archivos: { type: 'array', items: { type: 'string' }, description: 'Opcional: rutas de .md o .txt que la sala debe leer (máximo 4 con los del negocio)' },
    modelo: { type: 'string', enum: ['haiku'], description: 'Opcional: todo en Haiku, para probar el circuito' }, simulacro: { type: 'boolean', default: true } }, required: ['decision'] } },
  { name: 'sala_opiniones', description: 'Segunda opinión: las opiniones del directorio, de la más nueva a la más vieja, con su veredicto y su rastro (receta, profundidad, modelo, sesiones, tiempos, si usó internet y qué archivos dejó).', inputSchema: { type: 'object', properties: { limite: { type: 'number', default: 30 } } } },
  { name: 'sala_ver', description: 'Sala directiva: el estado y el veredicto (JSON) de una sala, por el id o el nombre de su flujo. No aprueba nada.', inputSchema: { type: 'object', properties: { flujo: { type: 'string' } }, required: ['flujo'] } },
  { name: 'puerta_ver', description: 'Muestra lo que espera en la puerta de un flujo (los archivos que dejó la etapa anterior). No aprueba.', inputSchema: { type: 'object', properties: { flujo: { type: 'string', description: 'Id del flujo o parte de su nombre' } }, required: ['flujo'] } },
  { name: 'interfaz_vista', description: 'Cambia la vista: inicio (bandeja de hoy), lienzo, bandeja, flujo (kanban) o crm (negocios).', inputSchema: { type: 'object', properties: { vista: { type: 'string', enum: ['inicio', 'lienzo', 'bandeja', 'flujo', 'crm'] } }, required: ['vista'] } },
  { name: 'interfaz_seleccionar', description: 'Pone el foco en una sesión.', inputSchema: { type: 'object', properties: { sesion: { type: 'string' } }, required: ['sesion'] } },
  { name: 'interfaz_estilo', description: 'Reemplaza el CSS personal que va encima del tema Brasa y se aplica al tiro. Texto vacío = tema de fábrica. Lee primero el actual con interfaz_estilo_leer para no perderlo.', inputSchema: { type: 'object', properties: { css: { type: 'string' } }, required: ['css'] } },
  { name: 'interfaz_estilo_leer', description: 'Devuelve el CSS personal actual.', inputSchema: { type: 'object', properties: {} } },
  { name: 'interfaz_captura', description: 'Captura la ventana de Chocosys y la devuelve como imagen.', inputSchema: { type: 'object', properties: {} } },
  { name: 'interfaz_recargar', description: 'Recarga solo la interfaz (para ver cambios en app/renderer). Las sesiones siguen vivas.', inputSchema: { type: 'object', properties: {} } },
  { name: 'registro', description: 'Últimas líneas del registro de diagnóstico de la consola.', inputSchema: { type: 'object', properties: { lineas: { type: 'number', default: 60 } } } },
  { name: 'crm_hoy', description: 'CRM: lo que requiere atención hoy según las reglas (actividades vencidas, negocios quietos, sin próxima acción).', inputSchema: { type: 'object', properties: { entorno: { type: 'string', description: 'El nombre de la pestaña o empresa (opcional)' } } } },
  { name: 'crm_negocios', description: 'CRM: los negocios (trabajos) con su etapa, cliente, monto, probabilidad de cerrar (la que vale: ganado 100, perdido 0; si no, la puesta a mano o la de la etapa), ponderado (monto × probabilidad / 100) y próxima acción.', inputSchema: { type: 'object', properties: { entorno: { type: 'string' } } } },
  { name: 'crm_negocio', description: 'CRM: la ficha de un negocio con sus actividades, su historial y su plata (costo, venta y de qué archivo, hoja y celda salió cada número; probabilidad, probabilidad_pisada, etapa_probabilidad y ponderado).', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
  { name: 'crm_empresa', description: 'CRM: crea o actualiza una empresa (cliente, proveedor…) con sus contactos, sin abrir un negocio. No duplica: reconoce la empresa por su RUT o su nombre exacto, y el contacto por su correo o su nombre en la misma empresa. Con «id», solo actualiza. Queda en el historial como «mcp».', inputSchema: { type: 'object', properties: {
    id: { type: 'number', description: 'Para actualizar una empresa que ya existe' }, nombre: { type: 'string' }, rut: { type: 'string' }, tipo: { type: 'string', description: 'cliente · proveedor · prospecto · interno…' },
    rubro: { type: 'string' }, ciudad: { type: 'string' }, notas: { type: 'string' },
    contactos: { type: 'array', items: { type: 'object', properties: { nombre: { type: 'string' }, cargo: { type: 'string' }, correo: { type: 'string' }, telefono: { type: 'string' }, notas: { type: 'string' } }, required: ['nombre'] } } } } },
  { name: 'crm_empresas', description: 'CRM: las empresas con sus contactos (opcional: solo un tipo, como «cliente»).', inputSchema: { type: 'object', properties: { tipo: { type: 'string' } } } },
  { name: 'crm_negocio_cambiar', description: 'CRM: cambia datos de un negocio que ya existe: nombre, empresa_id, contacto_id, carpeta, cierre_esperado (AAAA-MM-DD), tipo, origen o proyecto_id. El monto, la moneda y la probabilidad no: esos los cambia ' + NOMBRE + ' en la ventana. Queda en el historial como «mcp».', inputSchema: { type: 'object', properties: {
    id: { type: 'number' }, cambios: { type: 'object', properties: { nombre: { type: 'string' }, empresa_id: { type: 'number' }, contacto_id: { type: 'number' }, carpeta: { type: 'string' },
      cierre_esperado: { type: 'string' }, tipo: { type: 'string' }, origen: { type: 'string' }, proyecto_id: { type: 'number' } } } }, required: ['id', 'cambios'] } },
  { name: 'crm_solicitud', description: 'CRM: crea una solicitud (un negocio en la primera etapa de su embudo) con su cliente (existente, nuevo o interno), contacto, lo pedido y la tarea de responderla; si el CRM sabe dónde, crea su carpeta con TRABAJO.md. Queda en el historial como «mcp».', inputSchema: { type: 'object', properties: {
    nombre: { type: 'string', description: 'Qué se pide, corto (será el nombre del negocio)' }, detalle: { type: 'string' }, embudo: { type: 'string', description: 'Trabajos, Encargos…' },
    tipo: { type: 'string', description: 'web · cotización · contrato · otro (decide la carpeta)' }, proyecto_id: { type: 'number' }, interno: { type: 'boolean', description: 'El cliente es el mismo negocio' },
    empresa_id: { type: 'number' }, empresa_nueva: { type: 'string' }, contacto: { type: 'object', properties: { nombre: { type: 'string' }, cargo: { type: 'string' }, correo: { type: 'string' }, telefono: { type: 'string' } } },
    cierre_esperado: { type: 'string', description: 'AAAA-MM-DD' }, responsable: { type: 'string' }, entorno: { type: 'string' }, monto: { type: 'number' }, moneda: { type: 'string' } }, required: ['nombre'] } },
  { name: 'crm_proyectos', description: 'CRM: los proyectos grandes (agrupan negocios que comparten papelería, imágenes y marca) con su carpeta.', inputSchema: { type: 'object', properties: {} } },
  { name: 'crm_proyecto_nuevo', description: 'CRM: crea un proyecto grande con su carpeta (PROYECTO.md, _compartido\\ y encargos\\) en la raíz de proyectos del CRM. Solo con el OK de ' + NOMBRE + '.', inputSchema: { type: 'object', properties: { nombre: { type: 'string' }, entorno: { type: 'string' }, notas: { type: 'string' } }, required: ['nombre'] } },
  { name: 'crm_carpetas', description: 'CRM: dónde nacen las carpetas (raíz de proyectos y, por embudo, la raíz de cada tipo de negocio, «*» = el resto). Sin datos, solo las lee; con datos, las cambia (solo con el OK de ' + NOMBRE + ').', inputSchema: { type: 'object', properties: { raiz_proyectos: { type: 'string' }, raices: { type: 'object', description: '{ embudo: { tipo: ruta, "*": ruta } }' } } } },
  { name: 'crm_trabajo', description: 'CRM: escribe una sección del TRABAJO.md de un negocio (la reemplaza entera o la agrega al final). Es el único archivo que se puede escribir así. Para «Qué hay que entregar» al definir un encargo.', inputSchema: { type: 'object', properties: { negocio_id: { type: 'number' }, seccion: { type: 'string', description: 'Título de la sección, sin ##' }, texto: { type: 'string', description: 'Markdown' } }, required: ['negocio_id', 'seccion', 'texto'] } },
  { name: 'crm_actividad_nueva', description: 'CRM: anota una próxima acción (tarea, llamada, correo, reunión o nota) con su responsable y, si hay, su fecha. Queda en el historial como «mcp».', inputSchema: { type: 'object', properties: { negocio_id: { type: 'number' }, tipo: { type: 'string', enum: ['tarea', 'llamada', 'correo', 'reunión', 'nota'] }, que: { type: 'string' }, responsable: { type: 'string' }, vence: { type: 'string', description: 'AAAA-MM-DD, opcional' } }, required: ['que'] } },
  { name: 'crm_actividad_hecha', description: 'CRM: marca una actividad como hecha (o la reabre con hecha: false). El id sale de crm_negocio. Queda en el historial como «mcp».', inputSchema: { type: 'object', properties: { id: { type: 'number' }, hecha: { type: 'boolean', default: true } }, required: ['id'] } },
  { name: 'crm_lista', description: 'CRM: los CRM que hay (uno por proyecto o empresa) y cuál está a la vista. Las demás herramientas crm_* trabajan sobre el que está a la vista.', inputSchema: { type: 'object', properties: {} } },
  { name: 'crm_crear', description: 'CRM: crea un CRM nuevo con su carpeta (fuera del código) y lo deja a la vista. Pregúntale antes a ' + NOMBRE + ' el nombre.', inputSchema: { type: 'object', properties: { nombre: { type: 'string', description: 'Nombre del proyecto o empresa' } }, required: ['nombre'] } },
  { name: 'crm_elegir', description: 'CRM: pone a la vista otro CRM por su nombre.', inputSchema: { type: 'object', properties: { nombre: { type: 'string' } }, required: ['nombre'] } },
  { name: 'crm_aplicar', description: 'CRM: aplica una plantilla al CRM a la vista (crea su embudo, requisitos y reglas). Solo con el OK de ' + NOMBRE + '. Queda en el historial como «mcp».', inputSchema: { type: 'object', properties: { plantilla: { type: 'string', description: 'id de la plantilla' }, entorno: { type: 'string', description: 'opcional: el entorno que pasa a usar ese embudo' }, crm: { type: 'string', description: 'opcional: nombre del CRM' } }, required: ['plantilla'] } },
  { name: 'crm_requisitos', description: 'CRM: qué pide la etapa actual de un negocio y la siguiente (datos, documentos subidos o reconocidos en su carpeta, actividades al día), y qué falta.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
  { name: 'crm_plantillas', description: 'CRM: las plantillas de embudo disponibles (proyectos y servicios, ventas a empresas, embudo digital, consultoría, encargos).', inputSchema: { type: 'object', properties: {} } },
  { name: 'crm_mover', description: 'CRM: mueve un negocio a otra etapa de SU embudo (las de crm_negocio o crm_requisitos; en «Trabajos»: Solicitud, Cotización, OC, Terreno, Entrega, Cobro, Ganado, Perdido). Una etapa de otro embudo se rechaza. Queda en el historial como «mcp».', inputSchema: { type: 'object', properties: { negocio_id: { type: 'number' }, etapa: { type: 'string' } }, required: ['negocio_id', 'etapa'] } }
].filter((x) => edicion.herramienta(x.name));

function conexion() {
  try { return JSON.parse(fs.readFileSync(path.join(DATOS, 'conexion.json'), 'utf8')); }
  catch (e) { throw new Error('Chocosys no está abierta (no hay conexion.json). Pídele a ' + NOMBRE + ' que la abra.'); }
}

function pedir(accion, datos) {
  const c = conexion();
  // Desde qué sesión de Chocosys se pide (sprint 16): así una coordinadora queda dueña de las sesiones que crea.
  const cuerpo = JSON.stringify(Object.assign({}, datos || {}, process.env.CONSOLA_PANEL ? { desde: process.env.CONSOLA_PANEL } : {}));
  return new Promise((resolver, rechazar) => {
    const req = http.request({ host: '127.0.0.1', port: c.puerto, path: '/mcp/' + accion, method: 'POST', timeout: 30000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo), 'x-consola-token': c.token } }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (t) => { texto += t; });
      res.on('end', () => {
        if (res.statusCode !== 200) { rechazar(new Error('La consola respondió ' + res.statusCode + ' (¿una versión anterior de Chocosys? ciérrala y ábrela de nuevo).')); return; }
        try { const r = JSON.parse(texto); if (r.ok) resolver(r.datos); else rechazar(new Error(r.error)); }
        catch (e) { rechazar(new Error('Respuesta ilegible de la consola.')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('La consola no respondió en 30 s.')));
    req.on('error', (e) => rechazar(new Error(e.code === 'ECONNREFUSED' ? 'Chocosys no está abierta (el puerto no responde).' : e.message)));
    req.end(cuerpo);
  });
}

async function llamar(nombre, args) {
  if (!HERRAMIENTAS.find((h) => h.name === nombre)) throw new Error('Herramienta desconocida: ' + nombre);
  const datos = await pedir(nombre, args || {});
  if (nombre === 'interfaz_captura') {
    const png = fs.readFileSync(datos.archivo).toString('base64');
    return [{ type: 'image', data: png, mimeType: 'image/png' }, { type: 'text', text: `Captura de ${datos.ancho}×${datos.alto} guardada en ${datos.archivo}` }];
  }
  return [{ type: 'text', text: JSON.stringify(datos, null, 2) }];
}

function responder(id, resultado, error) {
  const m = { jsonrpc: '2.0', id };
  if (error) m.error = error; else m.result = resultado;
  process.stdout.write(JSON.stringify(m) + '\n');
}

async function atender(m) {
  if (m.id === undefined || m.id === null) return; // notificación
  try {
    switch (m.method) {
      case 'initialize':
        responder(m.id, { protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18', capabilities: { tools: {} },
          serverInfo: { name: 'chocosys', version: VERSION }, instructions: INSTRUCCIONES });
        return;
      case 'ping': responder(m.id, {}); return;
      case 'tools/list': responder(m.id, { tools: HERRAMIENTAS }); return;
      case 'tools/call':
        try { responder(m.id, { content: await llamar(m.params.name, m.params.arguments) }); }
        catch (e) { responder(m.id, { content: [{ type: 'text', text: e.message }], isError: true }); }
        return;
      default:
        responder(m.id, null, { code: -32601, message: 'Método no soportado: ' + m.method });
    }
  } catch (e) {
    responder(m.id, null, { code: -32603, message: e.message });
  }
}

let resto = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (trozo) => {
  resto += trozo;
  let i;
  while ((i = resto.indexOf('\n')) >= 0) {
    const linea = resto.slice(0, i).trim();
    resto = resto.slice(i + 1);
    if (!linea) continue;
    let m;
    try { m = JSON.parse(linea); } catch (e) { continue; }
    atender(m);
  }
});
process.stdin.on('end', () => process.exit(0));
