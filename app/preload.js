// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('consola', {
  lista: () => ipcRenderer.invoke('sesiones:lista'),
  nueva: (carpeta, instruccion, opciones) => ipcRenderer.invoke('sesion:nueva', carpeta, instruccion, opciones),
  perfil: () => ipcRenderer.invoke('perfil'),
  bienvenida: {
    marcas: () => ipcRenderer.invoke('bienvenida:marcas'),
    marcar: (clave) => ipcRenderer.invoke('bienvenida:marcar', clave),
    creditos: () => ipcRenderer.invoke('creditos:leer'),
    sobreMi: () => ipcRenderer.invoke('sobremi:leer'),
    guardarSobreMi: (d) => ipcRenderer.invoke('sobremi:guardar', d),
    borrarSobreMi: () => ipcRenderer.invoke('sobremi:borrar')
  },
  reporte: {
    capturar: () => ipcRenderer.invoke('reporte:capturar'),
    previa: (d) => ipcRenderer.invoke('reporte:previa', d),
    guardar: (texto, conCaptura) => ipcRenderer.invoke('reporte:guardar', texto, conCaptura),
    cancelar: () => ipcRenderer.invoke('reporte:cancelar')
  },
  instalacion: {
    revisar: () => ipcRenderer.invoke('instalacion:revisar'),
    conectarMcp: () => ipcRenderer.invoke('instalacion:conectar-mcp'),
    abrir: (que) => ipcRenderer.invoke('instalacion:abrir', que)
  },
  orquestar: (objetivo, ids) => ipcRenderer.invoke('orquesta:nueva', objetivo, ids),
  cambiarModelo: (id, modelo, esfuerzo) => ipcRenderer.invoke('modelo:cambiar', id, modelo, esfuerzo),
  sesionMcp: (id, lista) => ipcRenderer.invoke('sesion:mcp', id, lista),
  sugerirModelo: (texto) => ipcRenderer.invoke('modelo:sugerir', texto),
  eleccionModelo: (texto, modelo, esfuerzo) => ipcRenderer.send('modelo:eleccion', texto, modelo, esfuerzo),
  renombrar: (id, nombre) => ipcRenderer.invoke('sesion:renombrar', id, nombre),
  cerrar: (id) => ipcRenderer.invoke('sesion:cerrar', id),
  foco: (id) => ipcRenderer.send('sesion:foco', id),
  abrir: (id, cols, rows) => ipcRenderer.send('pty:abrir', id, cols, rows),
  escribir: (id, datos) => ipcRenderer.send('pty:escribir', id, datos),
  tamano: (id, cols, rows) => ipcRenderer.send('pty:tamano', id, cols, rows),
  ojear: () => ipcRenderer.invoke('ojear'),
  // PRD-05: los totales (baratos) y el detalle por proceso (solo con el panel abierto).
  recursos: { leer: () => ipcRenderer.invoke('recursos:leer'), detalle: () => ipcRenderer.invoke('recursos:detalle') },
  uso: (clave) => ipcRenderer.send('uso', clave),
  usoLeer: () => ipcRenderer.invoke('uso:leer'),
  usoExportar: (nunca) => ipcRenderer.invoke('uso:exportar', nunca),
  copiar: (texto) => ipcRenderer.invoke('portapapeles:escribir', texto),
  recetas: () => ipcRenderer.invoke('recetas:lista'),
  // Sprint 21: validar mientras se escribe y guardar una receta desde el editor de propuestas.
  validarReceta: (id, texto) => ipcRenderer.invoke('recetas:validar', id, texto),
  guardarReceta: (id, texto, extra) => ipcRenderer.invoke('recetas:guardar', id, texto, extra),
  hacerFlujo: (id) => ipcRenderer.invoke('sesion:hacer-flujo', id),
  alPropuesta: (fn) => ipcRenderer.on('propuesta', (e, ficha) => fn(ficha)),
  propuestas: () => ipcRenderer.invoke('propuestas:lista'),
  descartarPropuesta: (borrador) => ipcRenderer.invoke('propuestas:descartar', borrador),
  elegirCarpeta: (base) => ipcRenderer.invoke('carpeta:elegir', base),
  abrirCarpeta: (ruta) => ipcRenderer.invoke('carpeta:abrir', ruta),
  lanzar: (receta, carpeta, ajustes) => ipcRenderer.invoke('flujo:lanzar', receta, carpeta, ajustes),
  aprobar: (fid, origen, eleccion) => ipcRenderer.invoke('flujo:aprobar', fid, origen, eleccion),
  traspasos: (fid) => ipcRenderer.invoke('flujo:traspasos', fid),
  pedirCambios: (fid, texto) => ipcRenderer.invoke('flujo:cambios', fid, texto),
  seguirIgual: (fid) => ipcRenderer.invoke('flujo:seguir', fid),
  repetirEnOpus: (fid) => ipcRenderer.invoke('flujo:repetir', fid),
  quitarFlujo: (fid) => ipcRenderer.invoke('flujo:quitar', fid),
  posicionFlujo: (fid, pos) => ipcRenderer.invoke('flujo:posicion', fid, pos),
  posicion: (id, pos, fija) => ipcRenderer.invoke('sesion:posicion', id, pos, fija),
  ordenar: (id, texto) => ipcRenderer.invoke('orden:enviar', id, texto),
  transcripciones: (ids) => ipcRenderer.invoke('sesion:transcripciones', ids),
  entornos: () => ipcRenderer.invoke('entornos:lista'),
  abrirEntorno: (nombre) => ipcRenderer.invoke('entorno:abrir', nombre),
  abrirCentral: () => ipcRenderer.invoke('central:abrir'),
  // Sprint 20: abre la guía de un entorno (por su nombre) o un archivo de una bóveda en Obsidian.
  abrirObsidian: (destino) => ipcRenderer.invoke('obsidian:abrir', destino),
  crm: {
    resumen: (entorno) => ipcRenderer.invoke('crm:resumen', entorno),
    elegir: (nombre) => ipcRenderer.invoke('crm:elegir', nombre),
    nuevo: (nombre) => ipcRenderer.invoke('crm:nuevo', nombre),
    impulsar: (entorno, nuevo, negocioId) => ipcRenderer.invoke('crm:impulsar', entorno, nuevo, negocioId),
    solicitud: (d) => ipcRenderer.invoke('crm:solicitud', d),
    proyectos: () => ipcRenderer.invoke('crm:proyectos'),
    proyectoNuevo: (d) => ipcRenderer.invoke('crm:proyecto_nuevo', d),
    crearCarpeta: (id) => ipcRenderer.invoke('crm:crear_carpeta', id),
    carpetas: () => ipcRenderer.invoke('crm:carpetas'),
    carpetaRaiz: (embudo, tipo) => ipcRenderer.invoke('crm:carpeta_raiz', embudo, tipo),
    abrirFuente: (negocioId, i) => ipcRenderer.invoke('crm:abrir_fuente', negocioId, i),
    sala: (id, d) => ipcRenderer.invoke('crm:sala', id, d),
    cuestionario: () => ipcRenderer.invoke('crm:cuestionario'),
    recomendar: (r) => ipcRenderer.invoke('crm:recomendar', r),
    aplicar: (id, entorno) => ipcRenderer.invoke('crm:aplicar', id, entorno),
    subir: (id, tipo, sub) => ipcRenderer.invoke('crm:subir', id, tipo, sub),
    abrirDoc: (negocioId, docId) => ipcRenderer.invoke('crm:abrir_doc', negocioId, docId),
    negocios: (filtro) => ipcRenderer.invoke('crm:negocios', filtro),
    negocio: (id) => ipcRenderer.invoke('crm:negocio', id),
    hoy: (filtro) => ipcRenderer.invoke('crm:hoy', filtro),
    mover: (id, etapa) => ipcRenderer.invoke('crm:mover', id, etapa),
    cambiar: (id, cambios) => ipcRenderer.invoke('crm:negocio_cambiar', id, cambios),
    etapaProbabilidad: (etapaId, valor) => ipcRenderer.invoke('crm:etapa_probabilidad', etapaId, valor),
    actividadNueva: (d) => ipcRenderer.invoke('crm:actividad_nueva', d),
    actividadHecha: (id, hecha) => ipcRenderer.invoke('crm:actividad_hecha', id, hecha),
    carpeta: (id) => ipcRenderer.invoke('crm:carpeta', id),
    exportar: (objeto) => ipcRenderer.invoke('crm:exportar', objeto),
    alCambiar: (fn) => ipcRenderer.on('crm', () => fn())
  },
  sala: {
    veredicto: (fid) => ipcRenderer.invoke('sala:veredicto', fid),
    registrar: (fid) => ipcRenderer.invoke('sala:registrar', fid),
    // «Segunda opinión» (sprint 10): pedir desde la barra, la lista de opiniones, anotar una en un negocio y abrir sus archivos.
    pedir: (d) => ipcRenderer.invoke('sala:pedir', d),
    opiniones: () => ipcRenderer.invoke('sala:opiniones'),
    anotar: (carpeta, negocioId) => ipcRenderer.invoke('sala:anotar', carpeta, negocioId),
    abrir: (carpeta, archivo) => ipcRenderer.invoke('sala:abrir', carpeta, archivo),
    config: () => ipcRenderer.invoke('sala:config')
  },
  // Sprint 11: el índice del tutorial y los archivos que personalizan Chocosys.
  tutorial: {
    indice: () => ipcRenderer.invoke('tutorial:indice'),
    abrir: (clave) => ipcRenderer.invoke('config:abrir', clave)
  },
  nuevoEspacio: (nombre) => ipcRenderer.invoke('espacio:nuevo', nombre),
  espacioActual: (id) => ipcRenderer.invoke('espacio:actual', id),
  renombrarEspacio: (id, nombre) => ipcRenderer.invoke('espacio:renombrar', id, nombre),
  borrarEspacio: (id) => ipcRenderer.invoke('espacio:borrar', id),
  vistaEspacio: (id, vista) => ipcRenderer.invoke('espacio:vista', id, vista),
  carpetaEspacio: (id, cambiar) => ipcRenderer.invoke('espacio:carpeta', id, cambiar),
  alCambiar: (fn) => ipcRenderer.on('sesiones', (e, datos) => fn(datos)),
  alDatos: (fn) => ipcRenderer.on('pty:datos', (e, m) => fn(m.id, m.datos)),
  alSeleccionar: (fn) => ipcRenderer.on('seleccionar', (e, id) => fn(id)),
  // Desde el MCP: cambiar de vista o de espacio, y el CSS personal encima del tema.
  alModo: (fn) => ipcRenderer.on('modo', (e, modo) => fn(modo)),
  alEspacio: (fn) => ipcRenderer.on('espacio', (e, id) => fn(id)),
  alAviso: (fn) => ipcRenderer.on('aviso', (e, texto) => fn(texto)),
  personal: () => ipcRenderer.invoke('personal:css'),
  fuentes: () => ipcRenderer.invoke('fuentes:leer'),
  alPersonal: (fn) => ipcRenderer.on('personal', (e, css) => fn(css))
});
