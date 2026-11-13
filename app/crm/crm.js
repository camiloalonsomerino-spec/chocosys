// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// CRM de Chocosys (sprint 3, 20-10-2026). Lo más básico y trazable: empresas, contactos, negocios en un embudo,
// actividades (la próxima acción y a quién le toca) e historial de todo cambio. Lo que se considera «requiere
// atención hoy» son reglas guardadas en la base. Sin IA: los agentes entran por el MCP solo cuando hacen falta.
//
// La base no vive con el código. Sin base real, arranca con datos de prueba ficticios y lo dice (config.modo).

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const libro = require('./libro');

// Las etapas de una base nueva: las mismas de la plantilla «proyectos-servicios», que se aplica al abrir.
// [nombre, orden, tipo, probabilidad] (la probabilidad, sprint 26: hasta la cotización, la de cerrar; desde la OC, la de cobrar).
const ETAPAS = [
  ['Solicitud', 10, 'abierta', 10], ['Cotización', 20, 'abierta', 30], ['OC', 30, 'abierta', 90], ['Terreno', 40, 'abierta', 95],
  ['Entrega', 50, 'abierta', 95], ['Cobro', 60, 'abierta', 95], ['Ganado', 70, 'ganada', 100], ['Perdido', 80, 'perdida', 0]
];
// Las reglas del CRM operacional (15, del 09-09-2026), traducidas a este modelo; las de facturas, equipos y tickets
// no tienen objeto acá y no se traen.
const REGLAS = [
  ['Actividad vencida', 'actividad_vencida', null, 0, 10],
  ['Vence esta semana', 'vence_pronto', null, 7, 20],
  ['Solicitud sin cotizar', 'etapa_quieta', 'Solicitud', 4, 30],
  ['Cotización sin respuesta', 'etapa_quieta', 'Cotización', 5, 40],
  ['OC sin arrancar', 'etapa_quieta', 'OC', 3, 50],
  ['Entregado sin cobrar', 'etapa_quieta', 'Entrega', 10, 60],
  ['Cobro pendiente', 'etapa_quieta', 'Cobro', 15, 70],
  ['Sin próxima acción', 'sin_proxima_accion', null, 0, 80],
  ['Tarea sin plazo estancada', 'sin_plazo_estancada', null, 14, 90]
];
const TIPOS_ACTIVIDAD = ['tarea', 'llamada', 'correo', 'reunión', 'nota'];

const ahora = () => new Date().toISOString();
const dosDig = (n) => String(n).padStart(2, '0');
const fechaLocal = (d) => `${d.getFullYear()}-${dosDig(d.getMonth() + 1)}-${dosDig(d.getDate())}`;
const diasDesde = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0);

function abrir(rutaBase) {
  fs.mkdirSync(path.dirname(rutaBase), { recursive: true });
  const nueva = !fs.existsSync(rutaBase);
  const db = new DatabaseSync(rutaBase);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(fs.readFileSync(path.join(__dirname, 'esquema.sql'), 'utf8'));
  // Columnas que llegaron después (sprint 6): se agregan a una base ya creada sin tocar sus datos.
  const tieneColumna = (tabla, col) => !!db.prepare(`SELECT 1 AS x FROM pragma_table_info('${tabla}') WHERE name = ?`).get(col);
  if (!tieneColumna('control', 'fuentes')) db.exec('ALTER TABLE control ADD COLUMN fuentes TEXT');
  if (!tieneColumna('negocio', 'tipo')) db.exec('ALTER TABLE negocio ADD COLUMN tipo TEXT');
  if (!tieneColumna('negocio', 'proyecto_id')) db.exec('ALTER TABLE negocio ADD COLUMN proyecto_id INTEGER REFERENCES proyecto(id) ON DELETE SET NULL');
  if (!tieneColumna('negocio', 'origen')) db.exec('ALTER TABLE negocio ADD COLUMN origen TEXT');
  // Sprint 26: la probabilidad de la etapa (la escribe su plantilla) y la pisada a mano en el negocio.
  if (!tieneColumna('etapa', 'probabilidad')) db.exec('ALTER TABLE etapa ADD COLUMN probabilidad INTEGER');
  if (!tieneColumna('negocio', 'probabilidad')) db.exec('ALTER TABLE negocio ADD COLUMN probabilidad INTEGER');

  const uno = (sql, ...p) => db.prepare(sql).get(...p);
  const todos = (sql, ...p) => db.prepare(sql).all(...p);
  const correr = (sql, ...p) => db.prepare(sql).run(...p);
  const config = (clave, valor) => {
    if (valor === undefined) { const r = uno('SELECT valor FROM config WHERE clave = ?', clave); return r ? r.valor : null; }
    correr('INSERT INTO config(clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor', clave, String(valor));
  };
  const anotar = (autor, objeto, id, accion, campo, antes, despues) => correr(
    'INSERT INTO historial(cuando, autor, objeto, objeto_id, accion, campo, antes, despues) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ahora(), autor || 'sistema', objeto, id, accion, campo || null,
    antes === undefined || antes === null ? null : String(antes), despues === undefined || despues === null ? null : String(despues));

  if (!uno('SELECT 1 AS x FROM etapa')) for (const [n, o, t, p] of ETAPAS) correr('INSERT INTO etapa(embudo, nombre, orden, tipo, probabilidad) VALUES (?, ?, ?, ?, ?)', 'Trabajos', n, o, t, p);
  if (!uno('SELECT 1 AS x FROM regla')) for (const [r, c, e, d, o] of REGLAS) correr('INSERT INTO regla(rotulo, condicion, etapa, dias, orden) VALUES (?, ?, ?, ?, ?)', r, c, e, d, o);
  if (nueva) config('creada', ahora());

  // ── Embudos: cada entorno usa uno (config «embudo:<entorno>»); sin elegir, el de Trabajos ──
  const EMBUDO_POR_DEFECTO = 'Trabajos';
  const embudos = () => todos('SELECT embudo AS nombre, COUNT(*) AS etapas FROM etapa GROUP BY embudo ORDER BY MIN(id)').map((x) => x.nombre);
  const embudoDe = (entorno) => (entorno && config('embudo:' + entorno)) || EMBUDO_POR_DEFECTO;
  // Una etapa por nombre se busca dentro de un embudo (dos embudos pueden tener «Ganado»).
  const etapaPorNombre = (nombre, embudo) => uno('SELECT * FROM etapa WHERE lower(nombre) = lower(?) AND embudo = ?', String(nombre || ''), embudo || EMBUDO_POR_DEFECTO)
    || (embudo ? null : uno('SELECT * FROM etapa WHERE lower(nombre) = lower(?) ORDER BY id LIMIT 1', String(nombre || '')));
  const etapaDe = (x, embudo) => (typeof x === 'number' ? uno('SELECT * FROM etapa WHERE id = ?', x) : etapaPorNombre(x, embudo));

  // ── Escrituras: cada una deja su línea en el historial ──────────────────
  function crearEmpresa(d, autor) {
    const t = ahora();
    const r = correr('INSERT INTO empresa(nombre, rut, tipo, rubro, ciudad, notas, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      String(d.nombre).trim(), d.rut || null, d.tipo || 'cliente', d.rubro || null, d.ciudad || null, d.notas || null, t, t);
    anotar(autor, 'empresa', Number(r.lastInsertRowid), 'crear', 'nombre', null, d.nombre);
    return Number(r.lastInsertRowid);
  }
  function crearContacto(d, autor) {
    const t = ahora();
    const r = correr('INSERT INTO contacto(empresa_id, nombre, cargo, correo, telefono, notas, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      d.empresa_id || null, String(d.nombre).trim(), d.cargo || null, d.correo || null, d.telefono || null, d.notas || null, t, t);
    anotar(autor, 'contacto', Number(r.lastInsertRowid), 'crear', 'nombre', null, d.nombre);
    return Number(r.lastInsertRowid);
  }
  // Sprint 9 (21-10-2026): cargar clientes desde el MCP sin abrir un negocio. Una empresa se reconoce por su RUT o por su
  // nombre exacto, y un contacto por su correo exacto o por su nombre dentro de la misma empresa: así no se duplican.
  const CAMPOS_EMPRESA = ['nombre', 'rut', 'tipo', 'rubro', 'ciudad', 'notas'];
  const soloRut = (x) => String(x || '').replace(/[^0-9kK]/g, '').toLowerCase();
  function cambiarEmpresa(id, cambios, autor) {
    const e = uno('SELECT * FROM empresa WHERE id = ?', id);
    if (!e) throw new Error('No existe la empresa ' + id);
    for (const [campo, valor] of Object.entries(cambios || {})) {
      if (!CAMPOS_EMPRESA.includes(campo) || valor === undefined || e[campo] === valor) continue;
      correr(`UPDATE empresa SET ${campo} = ?, actualizado = ? WHERE id = ?`, valor === '' ? null : valor, ahora(), id);
      anotar(autor, 'empresa', id, 'cambiar', campo, e[campo], valor);
    }
  }
  function guardarEmpresa(d, autor) {
    if (!d.id && !String(d.nombre || '').trim()) throw new Error('Falta el nombre de la empresa.');
    db.exec('BEGIN');
    try {
      let id = d.id ? Number(d.id) : null;
      if (id && !uno('SELECT 1 AS x FROM empresa WHERE id = ?', id)) throw new Error('No existe la empresa ' + id);
      if (!id && soloRut(d.rut)) { const ya = todos('SELECT id, rut FROM empresa').find((x) => soloRut(x.rut) === soloRut(d.rut)); if (ya) id = ya.id; }
      if (!id) { const ya = uno('SELECT id FROM empresa WHERE lower(trim(nombre)) = lower(trim(?))', String(d.nombre)); if (ya) id = ya.id; }
      const nueva = !id;
      // Con «id» se actualiza lo que venga. Si la empresa se reconoció sola (RUT o nombre), solo se llenan sus campos vacíos:
      // un parecido no pisa un dato que ya estaba.
      const antes = nueva ? null : uno('SELECT * FROM empresa WHERE id = ?', id);
      const vale = (k) => d[k] !== undefined && d[k] !== null && (d.id || antes[k] === null || antes[k] === '');
      if (nueva) id = crearEmpresa(d, autor);
      else cambiarEmpresa(id, Object.fromEntries(CAMPOS_EMPRESA.filter(vale).map((k) => [k, d[k]])), autor);
      const contactosOk = [];
      for (const c of d.contactos || []) {
        if (!String(c.nombre || '').trim()) continue;
        const correo = String(c.correo || '').trim().toLowerCase();
        const ya = (correo && uno('SELECT id FROM contacto WHERE lower(trim(correo)) = ?', correo))
          || uno('SELECT id FROM contacto WHERE empresa_id = ? AND lower(trim(nombre)) = lower(trim(?))', id, String(c.nombre));
        contactosOk.push(ya ? { id: ya.id, nombre: c.nombre, nuevo: false }
          : { id: crearContacto(Object.assign({}, c, { empresa_id: id }), autor), nombre: c.nombre, nuevo: true });
      }
      db.exec('COMMIT');
      return { empresa_id: id, nueva, contactos: contactosOk };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function crearNegocio(d, autor) {
    const embudo = d.embudo || embudoDe(d.entorno);
    const e = d.etapa ? etapaDe(d.etapa, embudo) || etapaDe(d.etapa) : uno('SELECT * FROM etapa WHERE embudo = ? ORDER BY orden LIMIT 1', embudo);
    if (!e) throw new Error(d.etapa ? 'No existe la etapa ' + d.etapa : 'No existe el embudo ' + embudo);
    const t = d.creado || ahora();
    const r = correr(`INSERT INTO negocio(nombre, entorno, empresa_id, contacto_id, etapa_id, monto, moneda, carpeta, cierre_esperado, creado, actualizado, etapa_desde, tipo, proyecto_id, origen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      String(d.nombre).trim(), d.entorno || null, d.empresa_id || null, d.contacto_id || null, e.id,
      d.monto === undefined || d.monto === '' ? null : Number(d.monto), d.moneda || 'CLP', d.carpeta || null, d.cierre_esperado || null, t, t, d.etapa_desde || t,
      d.tipo || null, d.proyecto_id || null, d.origen || null);
    anotar(autor, 'negocio', Number(r.lastInsertRowid), 'crear', 'etapa', null, e.nombre);
    return Number(r.lastInsertRowid);
  }
  const CAMPOS_NEGOCIO = ['nombre', 'entorno', 'empresa_id', 'contacto_id', 'monto', 'moneda', 'carpeta', 'cierre_esperado', 'tipo', 'proyecto_id', 'origen', 'probabilidad'];
  // Por dónde llegó (sprint 6, de SuiteCRM, EspoCRM y Krayin). Una lista corta; «Otro» para lo demás.
  const ORIGENES = ['Directo o referido', 'Cliente existente', 'Interno', 'Correo', 'Teléfono o WhatsApp', 'Formulario web', 'Licitación', 'Redes', 'Otro'];
  // Sprint 26: la probabilidad pisada de un negocio es un entero de 0 a 100, o vacía (vuelve a seguir a su etapa).
  // Texto limpio (sin «%» ni espacios) vacío cuenta como vacío: «` `» y «`%`» no son 0 % (T-C92).
  function probabilidadVacia(valor) {
    return valor === undefined || valor === null || (typeof valor !== 'number' && String(valor).replace('%', '').trim() === '');
  }
  function normalizarProbabilidad(valor) {
    if (probabilidadVacia(valor)) return null;
    const p = typeof valor === 'number' ? valor : Number(String(valor).replace('%', '').replace(',', '.').trim());
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error(`La probabilidad tiene que ser un número de 0 a 100, o vacía para volver a la de la etapa (llegó ${valor}).`);
    return Math.round(p);
  }
  function cambiarNegocio(id, cambios, autor) {
    const n = uno('SELECT * FROM negocio WHERE id = ?', id);
    if (!n) throw new Error('No existe el negocio ' + id);
    for (const [campo, crudo] of Object.entries(cambios || {})) {
      if (!CAMPOS_NEGOCIO.includes(campo)) continue;
      const valor = campo === 'probabilidad' ? normalizarProbabilidad(crudo) : crudo;
      if (n[campo] === valor) continue;
      correr(`UPDATE negocio SET ${campo} = ?, actualizado = ? WHERE id = ?`, valor === '' ? null : valor, ahora(), id);
      anotar(autor, 'negocio', id, 'cambiar', campo, n[campo], campo === 'probabilidad' && valor === null ? 'la de la etapa' : valor);
    }
  }
  // Sprint 26 (H6): el % de una etapa se cambia en la base, sin tocar la plantilla en disco. Vacío = la etapa no pondera
  // (D9). Ganado y perdido no se editan: valen 100 y 0 (D2). La marca «probabilidades:<embudo>» queda puesta para que el
  // relleno desde la plantilla no vuelva a llenar una que se dejó vacía a propósito.
  function cambiarProbabilidadEtapa(etapaId, valor, autor) {
    const e = uno('SELECT * FROM etapa WHERE id = ?', Number(etapaId));
    if (!e) throw new Error('No existe la etapa ' + etapaId);
    if (e.tipo !== 'abierta') throw new Error(`«${e.nombre}» es una etapa cerrada: su probabilidad es ${e.tipo === 'ganada' ? 100 : 0} % y no se cambia.`);
    let p = null;
    if (!probabilidadVacia(valor)) {
      p = typeof valor === 'number' ? valor : Number(String(valor).replace('%', '').replace(',', '.').trim());
      if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error(`La probabilidad de «${e.nombre}» tiene que ser un número de 0 a 100, o vacía (llegó ${valor}).`);
      p = Math.round(p);
    }
    if (!config('probabilidades:' + e.embudo)) config('probabilidades:' + e.embudo, ahora());
    if (e.probabilidad === p) return { id: e.id, nombre: e.nombre, probabilidad: p, cambio: false };
    correr('UPDATE etapa SET probabilidad = ? WHERE id = ?', p, e.id);
    anotar(autor, 'etapa', e.id, 'cambiar', 'probabilidad', e.probabilidad, p === null ? 'sin %' : p);
    return { id: e.id, nombre: e.nombre, probabilidad: p, antes: e.probabilidad, cambio: true };
  }
  // Mover nunca se bloquea: si a la etapa nueva le faltan requisitos, el movimiento queda igual y el historial
  // anota qué faltaba (trazable, sin trabas). Devuelve los faltantes para avisar.
  function moverEtapa(id, etapa, autor, carpetaAbs) {
    const n = uno('SELECT n.*, e.nombre AS etapa, e.embudo AS embudo FROM negocio n JOIN etapa e ON e.id = n.etapa_id WHERE n.id = ?', id);
    if (!n) throw new Error('No existe el negocio ' + id);
    // 05-11-2026: por nombre, solo una etapa de SU embudo. Antes, un nombre que su embudo no tenía caía en la primera
    // etapa con ese nombre de cualquier embudo: el negocio cambiaba de embudo sin aviso y salía del tablero que se miraba.
    const e = etapaDe(etapa, n.embudo);
    if (!e) {
      const suyas = etapas(n.embudo).map((x) => x.nombre).join(', ');
      throw new Error(`«${etapa}» no es una etapa del embudo «${n.embudo}» de este negocio. Sus etapas: ${suyas}.`);
    }
    if (n.etapa_id === e.id) return [];
    const t = ahora();
    correr('UPDATE negocio SET etapa_id = ?, etapa_desde = ?, actualizado = ? WHERE id = ?', e.id, t, t, id);
    anotar(autor, 'negocio', id, 'cambiar', 'etapa', n.etapa, e.nombre);
    // Sprint 26, D3: pasar de etapa es información nueva; la probabilidad pisada se borra y vuelve a seguir a la etapa.
    if (n.probabilidad !== null && n.probabilidad !== undefined) {
      correr('UPDATE negocio SET probabilidad = NULL WHERE id = ?', id);
      anotar(autor, 'negocio', id, 'cambiar', 'probabilidad', n.probabilidad, 'la de la etapa, al pasar a ' + e.nombre);
    }
    // El TRABAJO.md de su carpeta dice la etapa en su encabezado: se mantiene al día (sprint 6; antes quedaba «Pedido»).
    if (carpetaAbs) {
      try {
        const ruta = path.join(carpetaAbs, 'TRABAJO.md');
        if (fs.existsSync(ruta)) {
          const texto = fs.readFileSync(ruta, 'utf8');
          const nuevo = texto.replace(/^\| \*\*Estado\*\* \|.*\|[ \t]*$/m, `| **Estado** | ${e.nombre} (desde el ${fechaDMA(new Date())}) |`);
          if (nuevo !== texto) fs.writeFileSync(ruta, nuevo, 'utf8');
        }
      } catch (err) { /* el archivo es documentación: si no se puede escribir, el movimiento igual vale */ }
    }
    const faltan = revisarEtapa(id, e.id, carpetaAbs).filter((r) => !r.cumple).map((r) => r.texto);
    if (faltan.length) anotar(autor, 'negocio', id, 'cambiar', 'faltaba al pasar', null, faltan.join(' · '));
    return faltan;
  }

  // ── Requisitos por etapa ────────────────────────────────────────────────
  // Lo que una etapa pide para estar bien: datos del negocio, documentos (subidos o reconocidos por nombre en su
  // carpeta) y actividades al día. Cada uno vuelve con cumple y cómo se cumplió.
  const ETIQUETA_DATO = { monto: 'monto', empresa_id: 'cliente', contacto_id: 'contacto', cierre_esperado: 'fecha', carpeta: 'carpeta' };
  function archivosDe(carpeta) {
    const lista = [];
    if (!carpeta || !fs.existsSync(carpeta)) return lista;
    const recorrer = (dir, hondo) => {
      if (hondo > 4 || lista.length > 3000) return;
      let ent = [];
      try { ent = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const x of ent) {
        if (x.name.startsWith('.') || x.name === 'node_modules') continue;
        const ruta = path.join(dir, x.name);
        if (x.isDirectory()) recorrer(ruta, hondo + 1); else lista.push(ruta);
      }
    };
    recorrer(carpeta, 0);
    return lista;
  }
  function revisarEtapa(negocioId, etapaId, carpetaAbs, archivosYa) {
    const n = uno('SELECT * FROM negocio WHERE id = ?', negocioId);
    if (!n) return [];
    const reqs = todos('SELECT * FROM requisito WHERE etapa_id = ? ORDER BY id', etapaId);
    if (!reqs.length) return [];
    const docs = todos('SELECT * FROM documento WHERE negocio_id = ?', negocioId);
    let archivos = archivosYa;
    return reqs.map((r) => {
      if (r.tipo === 'dato') {
        const v = n[r.clave];
        return { texto: r.texto, tipo: r.tipo, cumple: v !== null && v !== undefined && v !== '', como: ETIQUETA_DATO[r.clave] || r.clave };
      }
      if (r.tipo === 'actividades_al_dia') {
        const p = uno('SELECT COUNT(*) AS n FROM actividad WHERE negocio_id = ? AND hecha = 0', negocioId).n;
        return { texto: r.texto, tipo: r.tipo, cumple: p === 0, como: p ? `${p} pendiente${p === 1 ? '' : 's'}` : 'al día' };
      }
      const subido = docs.find((d) => (d.tipo || '').toLowerCase() === r.clave.toLowerCase());
      if (subido) return { texto: r.texto, tipo: r.tipo, clave: r.clave, cumple: true, como: 'subido: ' + subido.nombre };
      if (r.patron && carpetaAbs) {
        if (!archivos) archivos = archivosDe(carpetaAbs);
        let re = null;
        try { re = new RegExp(r.patron, 'i'); } catch (e) { re = null; }
        // El patrón se prueba contra el nombre y contra la ruta dentro de la carpeta: «03-ENTREGADO[\\/]» también vale.
        const hallado = re && archivos.find((a) => re.test(path.basename(a)) || re.test(path.relative(carpetaAbs, a)));
        if (hallado) return { texto: r.texto, tipo: r.tipo, clave: r.clave, cumple: true, como: 'en la carpeta: ' + path.basename(hallado) };
      }
      return { texto: r.texto, tipo: r.tipo, clave: r.clave, cumple: false, como: '' };
    });
  }
  // Para la ficha: lo de la etapa actual y lo que pide la siguiente.
  function requisitos(negocioId, carpetaAbs) {
    const n = uno('SELECT n.etapa_id, e.embudo, e.orden FROM negocio n JOIN etapa e ON e.id = n.etapa_id WHERE n.id = ?', negocioId);
    if (!n) return null;
    const archivos = carpetaAbs ? archivosDe(carpetaAbs) : [];
    const sig = uno("SELECT * FROM etapa WHERE embudo = ? AND orden > ? AND tipo = 'abierta' ORDER BY orden LIMIT 1", n.embudo, n.orden)
      || uno("SELECT * FROM etapa WHERE embudo = ? AND tipo = 'ganada' ORDER BY orden LIMIT 1", n.embudo);
    return {
      actual: revisarEtapa(negocioId, n.etapa_id, carpetaAbs, archivos),
      siguiente: sig && sig.id !== n.etapa_id ? { nombre: sig.nombre, items: revisarEtapa(negocioId, sig.id, carpetaAbs, archivos) } : null,
      tiposDocumento: [...new Set(todos("SELECT r.clave FROM requisito r JOIN etapa e ON e.id = r.etapa_id WHERE r.tipo = 'documento' AND e.embudo = ?", n.embudo).map((x) => x.clave))]
    };
  }

  // ── Documentos: la ficha en la base, el archivo en la carpeta del negocio ─
  const documentos = (negocioId) => todos('SELECT * FROM documento WHERE negocio_id = ? ORDER BY subido DESC', negocioId);
  function registrarDocumento(negocioId, d, autor) {
    const r = correr('INSERT INTO documento(negocio_id, tipo, nombre, ruta, subido, autor) VALUES (?, ?, ?, ?, ?, ?)',
      negocioId, d.tipo || null, d.nombre, d.ruta, ahora(), autor || 'sistema');
    anotar(autor, 'negocio', negocioId, 'cambiar', 'documento', null, (d.tipo ? d.tipo + ': ' : '') + d.nombre);
    correr('UPDATE negocio SET actualizado = ? WHERE id = ?', ahora(), negocioId);
    return Number(r.lastInsertRowid);
  }
  function crearActividad(d, autor) {
    const tipo = TIPOS_ACTIVIDAD.includes(d.tipo) ? d.tipo : 'tarea';
    const t = ahora();
    const r = correr('INSERT INTO actividad(negocio_id, tipo, que, responsable, vence, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?)',
      d.negocio_id || null, tipo, String(d.que).trim(), d.responsable || null, d.vence || null, t, t);
    anotar(autor, 'actividad', Number(r.lastInsertRowid), 'crear', 'que', null, d.que);
    if (d.negocio_id) correr('UPDATE negocio SET actualizado = ? WHERE id = ?', t, d.negocio_id);
    return Number(r.lastInsertRowid);
  }
  function completarActividad(id, hecha, autor) {
    const a = uno('SELECT * FROM actividad WHERE id = ?', id);
    if (!a) throw new Error('No existe la actividad ' + id);
    const v = hecha === false ? 0 : 1;
    if (a.hecha === v) return;
    const t = ahora();
    correr('UPDATE actividad SET hecha = ?, hecha_el = ?, actualizado = ? WHERE id = ?', v, v ? t : null, t, id);
    anotar(autor, 'actividad', id, 'cambiar', 'hecha', a.hecha ? 'sí' : 'no', v ? 'sí' : 'no');
  }

  // ── La plata (sprint 6): costo y venta leídos de los archivos del trabajo, nunca tecleados ──
  // Dónde mirar y qué etiqueta leer lo dice la plantilla del embudo (su «plata»), guardado en config «plata:<embudo>».
  // Costo: el libro de control si hay; si no, la suma de las OC, separada por moneda (una OC en dólares no se suma a
  // pesos). Venta: la del libro. Se guarda con la huella de los archivos y se vuelve a leer solo si cambian.
  const leerJSON = (clave) => { try { return JSON.parse(config(clave) || 'null'); } catch (e) { return null; } };
  const masNuevo = (rutas) => rutas.map((r) => ({ r, t: fs.statSync(r).mtimeMs })).sort((a, b) => b.t - a.t)[0].r;
  const huellaDe = (rutas) => rutas.map((r) => { try { const s = fs.statSync(r); return `${r}|${s.size}|${Math.round(s.mtimeMs)}`; } catch (e) { return r + '|?'; } }).join(';');
  function buscarLibro(cfg, carpetaAbs) {
    let re;
    try { re = new RegExp(cfg.patron, 'i'); } catch (e) { return null; }
    const propios = archivosDe(carpetaAbs).filter((a) => re.test(path.basename(a)) && !path.relative(carpetaAbs, a).split(path.sep).some((p) => p.startsWith('_')));
    if (propios.length) return masNuevo(propios);
    if (!cfg.carpeta_aparte) return null;
    // Subiendo desde la carpeta del trabajo, la primera carpeta con ese nombre (por ejemplo, una carpeta de costos).
    let dir = carpetaAbs, aparte = null;
    for (let i = 0; i < 6 && !aparte; i++) {
      if (fs.existsSync(path.join(dir, cfg.carpeta_aparte))) aparte = path.join(dir, cfg.carpeta_aparte);
      const arriba = path.dirname(dir);
      if (arriba === dir) break;
      dir = arriba;
    }
    if (!aparte) return null;
    // Allá se reconoce por el mes del trabajo y una palabra de su nombre: 2026-07_fittings-hdpe → «2026-07» y «hdpe».
    const base = path.basename(carpetaAbs);
    const mes = (base.match(/^(\d{4}-\d{2})/) || [])[1];
    const palabras = base.replace(/^\d{4}-\d{2}[_-]?/, '').split(/[-_\s]+/).filter((p) => p.length >= 3).map((p) => p.toLowerCase());
    if (!mes || !palabras.length) return null;
    const hallados = fs.readdirSync(aparte).filter((f) => re.test(f) && f.includes(mes) && palabras.some((p) => f.toLowerCase().includes(p))).map((f) => path.join(aparte, f));
    return hallados.length ? masNuevo(hallados) : null;
  }
  function conFuentes(fila) {
    if (!fila) return null;
    let fuentes = [];
    try { fuentes = JSON.parse(fila.fuentes || '[]'); } catch (e) { /* sin fuentes */ }
    const otras = {};
    for (const f of fuentes) if (f.que === 'costo' && f.moneda && f.moneda !== fila.moneda) otras[f.moneda] = (otras[f.moneda] || 0) + f.valor;
    return Object.assign({}, fila, { fuentes, otras });
  }
  const textoPlata = (f) => (f ? `costo ${f.costo === null ? '—' : Math.round(f.costo)} · venta ${f.venta === null ? '—' : Math.round(f.venta)}` : null);
  function leerPlata(negocioId, carpetaAbs) {
    const n = uno('SELECT n.*, e.embudo FROM negocio n JOIN etapa e ON e.id = n.etapa_id WHERE n.id = ?', negocioId);
    if (!n) return null;
    const antes = uno('SELECT * FROM control WHERE negocio_id = ?', negocioId);
    const cfg = leerJSON('plata:' + n.embudo);
    if (!cfg || !carpetaAbs) return conFuentes(antes);
    const lib = cfg.libro && cfg.libro.patron ? buscarLibro(cfg.libro, carpetaAbs) : null;
    let ocs = [];
    if (!lib && cfg.compras && cfg.compras.patron) {
      const dir = path.join(carpetaAbs, cfg.compras.carpeta || '');
      try { const re = new RegExp(cfg.compras.patron, 'i'); ocs = fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f)); } catch (e) { ocs = []; }
    }
    const huella = huellaDe([lib, ...ocs].filter(Boolean));
    if (antes && antes.huella === huella) return conFuentes(antes);

    const fuentes = [];
    const porMoneda = {};
    let venta = null, monedaVenta = null;
    const leerUno = (ruta, fn) => { try { fn(libro.leer(ruta)); } catch (e) { fuentes.push({ que: 'error', archivo: ruta, error: e.message }); } };
    if (lib) leerUno(lib, (b) => {
      const m = libro.monedaDe(b);
      const c = cfg.libro.costo && libro.valorDe(b, cfg.libro.costo);
      if (c) { porMoneda[m] = (porMoneda[m] || 0) + c.valor; fuentes.push({ que: 'costo', archivo: lib, hoja: c.hoja, celda: c.celda, valor: c.valor, moneda: m }); }
      const v = cfg.libro.venta && libro.valorDe(b, cfg.libro.venta);
      if (v) { venta = v.valor; monedaVenta = m; fuentes.push({ que: 'venta', archivo: lib, hoja: v.hoja, celda: v.celda, valor: v.valor, moneda: m }); }
    });
    for (const oc of ocs) leerUno(oc, (b) => {
      const c = libro.valorDe(b, { hoja: cfg.compras.hoja, etiqueta: cfg.compras.etiqueta });
      if (!c) { fuentes.push({ que: 'error', archivo: oc, error: `no tiene «${cfg.compras.etiqueta}»` }); return; }
      const m = libro.monedaDe(b);
      porMoneda[m] = (porMoneda[m] || 0) + c.valor;
      fuentes.push({ que: 'costo', archivo: oc, hoja: c.hoja, celda: c.celda, valor: c.valor, moneda: m });
    });
    // La moneda principal es la del negocio; si no hay nada en esa moneda, la única que haya.
    const monedas = Object.keys(porMoneda);
    const moneda = monedas.includes(n.moneda || 'CLP') || !monedas.length ? (n.moneda || 'CLP') : monedas[0];
    const nueva = { costo: porMoneda[moneda] ?? null, venta: monedaVenta === moneda ? venta : null };
    correr(`INSERT INTO control(negocio_id, archivo, huella, leido, moneda, costo, venta, fuentes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(negocio_id) DO UPDATE SET archivo = excluded.archivo, huella = excluded.huella, leido = excluded.leido, moneda = excluded.moneda,
      costo = excluded.costo, venta = excluded.venta, fuentes = excluded.fuentes`,
      negocioId, lib || (ocs.length ? path.join(carpetaAbs, cfg.compras.carpeta || '') : null), huella, ahora(), moneda, nueva.costo, nueva.venta, JSON.stringify(fuentes));
    if (textoPlata(antes) !== textoPlata(nueva) && (antes || nueva.costo !== null || nueva.venta !== null)) anotar('sistema', 'negocio', negocioId, 'cambiar', 'plata', textoPlata(antes), textoPlata(nueva));
    return conFuentes(uno('SELECT * FROM control WHERE negocio_id = ?', negocioId));
  }

  // ── Proyectos, solicitudes y carpetas (sprint 6) ──────────────────────
  // Un proyecto grande agrupa negocios que comparten papelería, imágenes y marca. Una solicitud crea un negocio en la
  // primera etapa de su embudo y, si el CRM sabe dónde, su carpeta: dentro del proyecto (encargos\) o en la raíz que
  // corresponde a su tipo («raices:<embudo>», por ejemplo web → 6-MARCA-Y-SITIO-WEB\encargos). Todo es configuración.
  const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  const fechaDMA = (d) => `${dosDig(d.getDate())}-${dosDig(d.getMonth() + 1)}-${d.getFullYear()}`;
  const fechaTexto = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4) : iso || '—');
  function carpetaLibre(raiz, nombre) {
    let destino = path.join(raiz, nombre);
    for (let k = 2; fs.existsSync(destino); k++) destino = path.join(raiz, `${nombre}-${k}`);
    return destino;
  }
  const proyectos = () => todos(`SELECT p.*, (SELECT COUNT(*) FROM negocio n WHERE n.proyecto_id = p.id) AS negocios FROM proyecto p ORDER BY p.estado, p.nombre`);
  function crearProyecto(d, autor) {
    const nombre = String(d.nombre || '').trim();
    if (!nombre) throw new Error('Falta el nombre del proyecto.');
    if (uno('SELECT 1 AS x FROM proyecto WHERE lower(nombre) = lower(?)', nombre)) throw new Error(`Ya existe el proyecto «${nombre}».`);
    let carpeta = null;
    const raiz = config('raiz_proyectos');
    if (raiz) {
      carpeta = carpetaLibre(raiz, slug(nombre));
      for (const sub of ['_compartido/papeleria', '_compartido/imagenes', '_compartido/marca', 'encargos']) fs.mkdirSync(path.join(carpeta, sub), { recursive: true });
      fs.writeFileSync(path.join(carpeta, 'PROYECTO.md'), [`# ${nombre}`, '', '| | |', '|---|---|', `| **Estado** | activo |`, `| **Abierto** | ${fechaDMA(new Date())} |`,
        `| **Entorno** | ${d.entorno || '—'} |`, '', '## Qué es', '', d.notas ? String(d.notas).trim() : '*(qué es el proyecto y qué se quiere lograr)*', '',
        '## Lo compartido', '', '`_compartido\\` guarda lo que usan todos sus encargos: papelería, imágenes y marca.', '',
        '## Encargos', '', 'Cada encargo tiene su carpeta en `encargos\\AAAA-MM_nombre\\`, con su `TRABAJO.md`.', ''].join('\r\n'), 'utf8');
    }
    const t = ahora();
    const r = correr('INSERT INTO proyecto(nombre, entorno, carpeta, notas, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?)', nombre, d.entorno || null, carpeta, d.notas || null, t, t);
    anotar(autor, 'proyecto', Number(r.lastInsertRowid), 'crear', 'nombre', null, nombre);
    return { id: Number(r.lastInsertRowid), carpeta };
  }
  // Dónde nace la carpeta de un negocio: en su proyecto, o en la raíz de su tipo, o en la raíz general del embudo («*»).
  function raizDe(n) {
    if (n.proyecto_id) {
      const p = uno('SELECT * FROM proyecto WHERE id = ?', n.proyecto_id);
      if (p && p.carpeta) return path.join(p.carpeta, 'encargos');
    }
    const raices = leerJSON('raices:' + n.embudo) || {};
    return raices[n.tipo || ''] || raices['*'] || null;
  }
  function crearCarpeta(negocioId, d, autor) {
    const n = uno(`SELECT n.*, e.embudo, e.nombre AS etapa, em.nombre AS empresa, em.tipo AS empresa_tipo, c.nombre AS contacto, p.nombre AS proyecto
      FROM negocio n JOIN etapa e ON e.id = n.etapa_id LEFT JOIN empresa em ON em.id = n.empresa_id LEFT JOIN contacto c ON c.id = n.contacto_id
      LEFT JOIN proyecto p ON p.id = n.proyecto_id WHERE n.id = ?`, negocioId);
    if (!n) throw new Error('No existe el negocio ' + negocioId);
    if (n.carpeta) return n.carpeta;
    const raiz = raizDe(n);
    if (!raiz) return null;
    const hoyD = new Date();
    const nombre = `${hoyD.getFullYear()}-${dosDig(hoyD.getMonth() + 1)}_${slug(n.nombre)}`;
    const carpeta = carpetaLibre(raiz, nombre);
    const estructura = leerJSON('carpeta:' + n.embudo) || [];
    for (const sub of estructura) fs.mkdirSync(path.join(carpeta, sub), { recursive: true });
    fs.mkdirSync(carpeta, { recursive: true });
    const pidio = [n.contacto, n.empresa ? n.empresa + (n.empresa_tipo === 'interno' ? ', interno' : '') : null].filter(Boolean).join(' · ') || '—';
    fs.writeFileSync(path.join(carpeta, 'TRABAJO.md'), [`# ${path.basename(carpeta)}`, '', '| | |', '|---|---|',
      `| **Estado** | ${n.etapa} |`, `| **Abierto** | ${fechaDMA(hoyD)} |`, `| **Pidió** | ${pidio} |`, `| **Tipo** | ${n.tipo || '—'} |`,
      `| **Proyecto** | ${n.proyecto || '—'} |`, `| **Para cuándo** | ${fechaTexto(n.cierre_esperado)} |`, '',
      '## Qué se pidió', '', d && d.detalle ? String(d.detalle).trim() : '*(lo que pidieron, con sus palabras)*', '',
      '## Qué hay que entregar', '', '*(los entregables, a quién y para cuándo; «Definir con IA» lo completa contigo)*', '',
      '## Envíos y entregas', '', '| Fecha | Qué | A quién | Cómo |', '|---|---|---|---|', ''].join('\r\n'), 'utf8');
    correr('UPDATE negocio SET carpeta = ?, actualizado = ? WHERE id = ?', carpeta, ahora(), negocioId);
    anotar(autor, 'negocio', negocioId, 'cambiar', 'carpeta', null, carpeta);
    return carpeta;
  }
  // La solicitud: cliente (existente, nuevo o interno), contacto, qué pide y para cuándo → negocio en la primera etapa,
  // una nota con lo pedido, la tarea de responderla y, si se puede, su carpeta. Todo queda en el historial.
  function crearSolicitud(d, autor, nombreCrm) {
    if (!d || !String(d.nombre || '').trim()) throw new Error('Falta qué se pide (el nombre del negocio).');
    let negocioId;
    db.exec('BEGIN');
    try {
      let empresaId = d.empresa_id ? Number(d.empresa_id) : null;
      if (d.interno) {
        const interna = uno("SELECT id FROM empresa WHERE tipo = 'interno' ORDER BY id LIMIT 1");
        empresaId = interna ? interna.id : crearEmpresa({ nombre: nombreCrm || 'Interno', tipo: 'interno' }, autor);
      } else if (!empresaId && d.empresa_nueva && String(d.empresa_nueva).trim()) empresaId = crearEmpresa({ nombre: String(d.empresa_nueva).trim(), tipo: 'cliente' }, autor);
      let contactoId = d.contacto_id ? Number(d.contacto_id) : null;
      // Si el correo ya es de un contacto, es esa persona (correo exacto, nunca parecido: no se pega a otro).
      const correo = d.contacto && String(d.contacto.correo || '').trim().toLowerCase();
      if (!contactoId && correo) { const ya = uno('SELECT id FROM contacto WHERE lower(trim(correo)) = ?', correo); if (ya) contactoId = ya.id; }
      if (!contactoId && d.contacto && String(d.contacto.nombre || '').trim()) {
        contactoId = crearContacto({ empresa_id: empresaId, nombre: String(d.contacto.nombre).trim(), cargo: d.contacto.cargo, correo: d.contacto.correo, telefono: d.contacto.telefono }, autor);
      }
      negocioId = crearNegocio({ nombre: d.nombre, entorno: d.entorno, embudo: d.embudo, tipo: d.tipo, proyecto_id: d.proyecto_id ? Number(d.proyecto_id) : null,
        origen: d.origen || (d.interno ? 'Interno' : null),
        empresa_id: empresaId, contacto_id: contactoId, monto: d.monto, moneda: d.moneda, cierre_esperado: d.cierre_esperado || null, carpeta: d.carpeta || null }, autor);
      if (d.detalle && String(d.detalle).trim()) completarActividad(crearActividad({ negocio_id: negocioId, tipo: 'nota', que: 'Solicitud: ' + String(d.detalle).trim() }, autor), true, autor);
      crearActividad({ negocio_id: negocioId, tipo: 'tarea', que: 'Revisar la solicitud y definir qué hay que entregar', responsable: d.responsable || null }, autor);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    let carpeta = null;
    if (d.crear_carpeta !== false && !d.carpeta) {
      try { carpeta = crearCarpeta(negocioId, d, autor); } catch (e) { anotar(autor, 'negocio', negocioId, 'cambiar', 'carpeta sin crear', null, e.message); }
    }
    return { id: negocioId, carpeta };
  }
  // «Definir con IA» y los envíos escriben en el TRABAJO.md del negocio: una sección se reemplaza entera (o se agrega
  // al final si no está). Solo ese archivo, solo en la carpeta del negocio.
  function escribirSeccion(negocioId, titulo, texto, autor, carpetaAbs) {
    const n = uno('SELECT * FROM negocio WHERE id = ?', negocioId);
    if (!n) throw new Error('No existe el negocio ' + negocioId);
    if (!carpetaAbs) throw new Error('El negocio no tiene carpeta a la vista.');
    const ruta = path.join(carpetaAbs, 'TRABAJO.md');
    if (!fs.existsSync(ruta)) throw new Error('La carpeta del negocio no tiene TRABAJO.md.');
    const t = String(titulo || '').replace(/^#+\s*/, '').trim();
    if (!t) throw new Error('Falta el título de la sección.');
    const original = fs.readFileSync(ruta, 'utf8');
    const lineas = original.split(/\r?\n/);
    const ini = lineas.findIndex((l) => l.trim().toLowerCase() === '## ' + t.toLowerCase());
    const cuerpo = String(texto || '').trim().split(/\r?\n/);
    let nuevas;
    if (ini < 0) nuevas = [...lineas.slice(0, lineas.length - (lineas[lineas.length - 1] === '' ? 1 : 0)), '', '## ' + t, '', ...cuerpo, ''];
    else {
      let fin = lineas.findIndex((l, i) => i > ini && /^## /.test(l));
      if (fin < 0) fin = lineas.length;
      nuevas = [...lineas.slice(0, ini + 1), '', ...cuerpo, '', ...lineas.slice(fin)];
    }
    fs.writeFileSync(ruta, nuevas.join('\r\n'), 'utf8');
    anotar(autor, 'negocio', negocioId, 'cambiar', 'TRABAJO.md', null, '## ' + t);
    return ruta;
  }

  // ── Lecturas ────────────────────────────────────────────────────────────
  const SQL_NEGOCIO = `SELECT n.*, e.nombre AS etapa, e.orden AS etapa_orden, e.tipo AS etapa_tipo, e.embudo AS embudo, e.probabilidad AS etapa_probabilidad, em.nombre AS empresa, em.tipo AS empresa_tipo, c.nombre AS contacto, p.nombre AS proyecto,
      (SELECT COUNT(*) FROM documento d WHERE d.negocio_id = n.id) AS documentos,
      (SELECT COUNT(*) FROM actividad a WHERE a.negocio_id = n.id AND a.hecha = 0) AS pendientes,
      (SELECT a.que || ' · ' || IFNULL(a.responsable, 'sin responsable') FROM actividad a WHERE a.negocio_id = n.id AND a.hecha = 0
        ORDER BY a.vence IS NULL, a.vence, a.id LIMIT 1) AS proxima
    FROM negocio n JOIN etapa e ON e.id = n.etapa_id LEFT JOIN empresa em ON em.id = n.empresa_id LEFT JOIN contacto c ON c.id = n.contacto_id
    LEFT JOIN proyecto p ON p.id = n.proyecto_id`;
  // Sprint 26 (D1, D2): la probabilidad que vale y el ponderado se calculan al leer; nunca se guardan.
  // Ganada vale 100 y perdida 0 aunque esté pisada; si no, la pisada o, si no hay, la de la etapa (puede no haber: D9).
  const redondear2 = (x) => Math.round(x * 100) / 100;
  function conProbabilidad(n) {
    const pisada = n.probabilidad === undefined ? null : n.probabilidad;
    const vale = n.etapa_tipo === 'ganada' ? 100 : n.etapa_tipo === 'perdida' ? 0
      : pisada !== null ? pisada : n.etapa_probabilidad === undefined ? null : n.etapa_probabilidad;
    n.probabilidad_pisada = pisada;
    n.probabilidad = vale;
    n.ponderado = vale === null || n.monto === null || n.monto === undefined ? null : redondear2(n.monto * vale / 100);
    return n;
  }
  const negocios = (filtro = {}) => (filtro.entorno
    ? todos(SQL_NEGOCIO + ' WHERE n.entorno = ? ORDER BY e.orden, n.actualizado DESC', filtro.entorno)
    : todos(SQL_NEGOCIO + ' ORDER BY e.orden, n.actualizado DESC')).map(conProbabilidad);
  function negocio(id) {
    const n0 = uno(SQL_NEGOCIO + ' WHERE n.id = ?', id);
    if (!n0) return null;
    const n = conProbabilidad(n0);
    n.actividades = todos('SELECT * FROM actividad WHERE negocio_id = ? ORDER BY hecha, vence IS NULL, vence, id', id);
    n.historial = todos(`SELECT * FROM historial WHERE (objeto = 'negocio' AND objeto_id = ?)
      OR (objeto = 'actividad' AND objeto_id IN (SELECT id FROM actividad WHERE negocio_id = ?)) ORDER BY cuando DESC, id DESC LIMIT 200`, id, id);
    n.control = conFuentes(uno('SELECT * FROM control WHERE negocio_id = ?', id));
    n.documentosLista = documentos(id);
    return n;
  }
  const etapas = (embudo) => (embudo ? todos('SELECT * FROM etapa WHERE embudo = ? ORDER BY orden', embudo) : todos('SELECT * FROM etapa ORDER BY embudo, orden'));
  const empresas = () => todos('SELECT * FROM empresa ORDER BY nombre');
  const contactos = () => todos('SELECT c.*, e.nombre AS empresa FROM contacto c LEFT JOIN empresa e ON e.id = c.empresa_id ORDER BY c.nombre');
  const reglas = () => todos('SELECT * FROM regla ORDER BY orden');

  // ── Qué requiere atención hoy: cada regla activa devuelve tarjetas ─────
  function hoy(filtro = {}, carpetaDe) {
    const hoyTxt = fechaLocal(new Date());
    const abiertos = negocios(filtro).filter((n) => n.etapa_tipo === 'abierta');
    const ids = new Set(abiertos.map((n) => n.id));
    const pend = todos(`SELECT a.*, n.nombre AS negocio, n.entorno FROM actividad a LEFT JOIN negocio n ON n.id = a.negocio_id WHERE a.hecha = 0`)
      .filter((a) => !filtro.entorno || a.entorno === filtro.entorno);
    const tarjetas = [];
    for (const r of reglas().filter((x) => x.activa)) {
      if (r.condicion === 'actividad_vencida') {
        for (const a of pend.filter((x) => x.vence && x.vence < hoyTxt)) tarjetas.push({ regla: r.rotulo, nivel: 'urgente', negocio_id: a.negocio_id, negocio: a.negocio, actividad_id: a.id, detalle: `${a.que} · venció el ${fechaTexto(a.vence)}${a.responsable ? ' · ' + a.responsable : ''}` });
      } else if (r.condicion === 'vence_pronto') {
        const tope = fechaLocal(new Date(Date.now() + r.dias * 86400000));
        for (const a of pend.filter((x) => x.vence && x.vence >= hoyTxt && x.vence <= tope)) tarjetas.push({ regla: r.rotulo, nivel: 'pronto', negocio_id: a.negocio_id, negocio: a.negocio, actividad_id: a.id, detalle: `${a.que} · vence el ${fechaTexto(a.vence)}${a.responsable ? ' · ' + a.responsable : ''}` });
      } else if (r.condicion === 'etapa_quieta') {
        for (const n of abiertos.filter((x) => x.etapa === r.etapa && diasDesde(x.etapa_desde) >= r.dias)) tarjetas.push({ regla: r.rotulo, nivel: 'quieto', negocio_id: n.id, negocio: n.nombre, detalle: `${diasDesde(n.etapa_desde)} días en ${n.etapa}` });
      } else if (r.condicion === 'sin_proxima_accion') {
        for (const n of abiertos.filter((x) => !x.pendientes)) tarjetas.push({ regla: r.rotulo, nivel: 'quieto', negocio_id: n.id, negocio: n.nombre, detalle: `en ${n.etapa}, nadie tiene la próxima acción` });
      } else if (r.condicion === 'faltan_requisitos') {
        // Negocios en la etapa indicada (abierta o cerrada) a los que les falta algo de lo que esa etapa pide.
        const enEtapa = negocios(filtro).filter((x) => x.etapa === r.etapa);
        for (const n of enEtapa) {
          const faltan = revisarEtapa(n.id, n.etapa_id, carpetaDe ? carpetaDe(n) : null).filter((x) => !x.cumple);
          if (faltan.length) tarjetas.push({ regla: r.rotulo, nivel: 'pronto', negocio_id: n.id, negocio: n.nombre, detalle: 'falta: ' + faltan.map((x) => x.texto).join(' · ') });
        }
      } else if (r.condicion === 'sin_plazo_estancada') {
        for (const a of pend.filter((x) => !x.vence && diasDesde(x.creado) >= r.dias && (!x.negocio_id || ids.has(x.negocio_id)))) tarjetas.push({ regla: r.rotulo, nivel: 'quieto', negocio_id: a.negocio_id, negocio: a.negocio, actividad_id: a.id, detalle: `${a.que} · hace ${diasDesde(a.creado)} días sin plazo` });
      }
    }
    return tarjetas;
  }

  // ── Exportar e importar en CSV con las columnas de un CRM estándar ─────
  const COLUMNAS = {
    empresas: ['id', 'nombre', 'rut', 'tipo', 'rubro', 'ciudad', 'notas'],
    contactos: ['id', 'nombre', 'empresa', 'cargo', 'correo', 'telefono', 'notas'],
    // probabilidad y ponderado (sprint 26): en HubSpot «Deal probability» y «Weighted amount»; el ponderado se calcula al leer.
    negocios: ['id', 'nombre', 'entorno', 'empresa', 'contacto', 'etapa', 'monto', 'moneda', 'probabilidad', 'ponderado', 'carpeta', 'cierre_esperado', 'proxima'],
    actividades: ['id', 'negocio', 'tipo', 'que', 'responsable', 'vence', 'hecha']
  };
  function exportarCSV(objeto) {
    const filas = objeto === 'empresas' ? empresas() : objeto === 'contactos' ? contactos() : objeto === 'negocios' ? negocios()
      : todos('SELECT a.*, n.nombre AS negocio FROM actividad a LEFT JOIN negocio n ON n.id = a.negocio_id ORDER BY a.id');
    const cols = COLUMNAS[objeto];
    if (!cols) throw new Error('Se exporta empresas, contactos, negocios o actividades.');
    // «;» como Excel en español, y un «'» delante de lo que empieza como fórmula (=, +, - o @): una celda no corre nada.
    const celda = (v) => { if (v === null || v === undefined) return ''; let s = String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [cols.join(';'), ...filas.map((f) => cols.map((c) => celda(f[c])).join(';'))].join('\r\n');
  }

  // ── Migración desde el CRM operacional (Python, retirado el 18-10-2026) ─
  const DE_ESTADO = { prospecto: 'Solicitud', visita: 'Solicitud', cotizado: 'Cotización', adjudicado: 'OC', 'en ejecución': 'Terreno',
    entregado: 'Entrega', cobrado: 'Cobro', cerrado: 'Ganado', perdido: 'Perdido' };
  // interna: el nombre de la empresa propia (perfil.json, empresa_interna); sus negocios van a su entorno, el resto a Consultora.
  function migrarDesde(rutaVieja, interna) {
    if (config('migrado_desde')) return { ya: config('migrado_desde') };
    const viejo = new DatabaseSync(rutaVieja, { readOnly: true });
    const esInterna = (n) => !!interna && String(n || '').toLowerCase().includes(String(interna).toLowerCase());
    const duenos = new Map(viejo.prepare('SELECT id, nombre FROM empresa').all().map((e) => [e.id, esInterna(e.nombre) ? interna : 'Consultora']));
    const cuenta = { negocios: 0, actividades: 0, proveedores: 0 };
    db.exec('BEGIN');
    try {
      const deProyecto = new Map();
      for (const p of viejo.prepare('SELECT * FROM proyecto').all()) {
        const id = crearNegocio({ nombre: p.nombre, entorno: duenos.get(p.empresa_id) || null, etapa: DE_ESTADO[p.estado] || 'Solicitud', moneda: p.moneda || 'CLP',
          monto: p.monto_adjudicado ?? p.monto_cotizado ?? undefined, carpeta: p.ruta || null, creado: p.creado || undefined, etapa_desde: p.ultimo_movimiento || p.actualizado || undefined }, 'migración');
        deProyecto.set(p.id, id);
        cuenta.negocios++;
      }
      for (const c of viejo.prepare('SELECT * FROM compromiso').all()) {
        const id = crearActividad({ negocio_id: deProyecto.get(c.proyecto_id), tipo: 'tarea', que: c.titulo || c.tipo, vence: c.fecha || null }, 'migración');
        if (c.estado === 'hecho') completarActividad(id, true, 'migración');
        cuenta.actividades++;
      }
      const vistos = new Set();
      for (const oc of viejo.prepare('SELECT DISTINCT proveedor, rut_proveedor FROM orden_compra WHERE proveedor IS NOT NULL').all()) {
        const clave = (oc.rut_proveedor || oc.proveedor).toLowerCase();
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        crearEmpresa({ nombre: oc.proveedor, rut: oc.rut_proveedor, tipo: 'proveedor' }, 'migración');
        cuenta.proveedores++;
      }
      config('migrado_desde', rutaVieja);
      config('modo', 'real');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; } finally { viejo.close(); }
    return cuenta;
  }

  // ── Datos de prueba ficticios: se usan solo si la base nace vacía y no hay nada que migrar ─
  function sembrarPrueba() {
    if (uno('SELECT 1 AS x FROM negocio')) return false;
    db.exec('BEGIN');
    try {
      const e1 = crearEmpresa({ nombre: 'Panadería La Esquina (ficticia)', rut: '76.000.001-1', rubro: 'alimentos', ciudad: 'Ciudad Ejemplo' }, 'prueba');
      const e2 = crearEmpresa({ nombre: 'Estudio Ejemplo (ficticio)', rut: '76.000.002-K', rubro: 'diseño', ciudad: 'Ciudad Ejemplo' }, 'prueba');
      crearEmpresa({ nombre: 'Imprenta de prueba (ficticia)', rut: '76.000.003-8', tipo: 'proveedor' }, 'prueba');
      const c1 = crearContacto({ empresa_id: e1, nombre: 'Contacto de prueba', cargo: 'Encargada de compras', correo: 'contacto@ejemplo.cl' }, 'prueba');
      const hace = (d) => new Date(Date.now() - d * 86400000).toISOString();
      const n1 = crearNegocio({ nombre: 'Sitio web nuevo (prueba)', entorno: 'General', empresa_id: e1, contacto_id: c1, etapa: 'Cotización', monto: 480000, carpeta: '2026-01_prueba-sitio-web', etapa_desde: hace(8) }, 'prueba');
      crearNegocio({ nombre: 'Catálogo impreso (prueba)', entorno: 'General', empresa_id: e2, etapa: 'Terreno', monto: 1200, moneda: 'USD', carpeta: '2026-01_prueba-catalogo' }, 'prueba');
      crearNegocio({ nombre: 'Logo y tarjetas (prueba)', entorno: 'General', etapa: 'Solicitud', etapa_desde: hace(6) }, 'prueba');
      crearActividad({ negocio_id: n1, tipo: 'llamada', que: 'Llamar para saber si aprobaron la cotización', responsable: 'yo', vence: fechaLocal(new Date(Date.now() - 86400000)) }, 'prueba');
      config('modo', 'prueba');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return true;
  }

  // ── Plantillas y cuestionario (sprint 4): archivos de texto en crm\plantillas\ y crm\cuestionario.json ──
  // Las de serie vienen con el programa; las propias (sprint 18) viven en los datos de quien lo usa y mandan si tienen el
  // mismo id.
  function plantillas() {
    const porId = new Map();
    for (const dir of [path.join(__dirname, 'plantillas'), carpetaPlantillasPropias].filter(Boolean)) {
      let lista = [];
      try { lista = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (e) { continue; }
      for (const f of lista) { try { const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (p && p.id) porId.set(p.id, p); } catch (e) { /* mal escrita */ } }
    }
    return [...porId.values()];
  }
  const cuestionario = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'cuestionario.json'), 'utf8'));
  // Puntaje simple y explicable: cada respuesta que calza con el perfil de una plantilla suma sus puntos y su razón.
  function recomendar(respuestas) {
    const r = respuestas || {};
    const marcada = (p, o) => (Array.isArray(r[p]) ? r[p].includes(o) : r[p] === o);
    return plantillas().map((pl) => {
      const calzan = (pl.perfil || []).filter((x) => marcada(x.p, x.o));
      const max = (pl.perfil || []).reduce((s, x) => s + x.pts, 0) || 1;
      const pts = calzan.reduce((s, x) => s + x.pts, 0);
      return { id: pl.id, nombre: pl.nombre, descripcion: pl.descripcion, inspirado_en: pl.inspirado_en, embudo: pl.embudo,
        etapas: pl.etapas.map((e) => e.nombre), puntos: pts, ajuste: Math.round((pts / max) * 100), razones: calzan.map((x) => x.razon) };
    }).sort((a, b) => b.puntos - a.puntos || b.ajuste - a.ajuste);
  }
  // Aplicar una plantilla: crea o actualiza su embudo (etapas, orden, tipo), reemplaza sus requisitos, suma las reglas
  // que falten y, si se indica un entorno, ese entorno pasa a usar ese embudo. Los negocios no se tocan.
  // Una plantilla a medida (la arma el asistente con quien usa la app) se valida antes de aplicarla: nunca se guarda en archivos.
  const TIPOS_ETAPA = ['abierta', 'ganada', 'perdida'];
  const TIPOS_REQUISITO = ['dato', 'documento', 'actividades_al_dia'];
  // Sprint 26: la probabilidad de una etapa es opcional; si viene, es un número de 0 a 100.
  const tieneProbabilidad = (e) => e && e.probabilidad !== undefined && e.probabilidad !== null && e.probabilidad !== '';
  const probabilidadValida = (p) => p === undefined || p === null || p === ''
    || (typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 100);
  function validarPlantilla(pl) {
    if (!pl || typeof pl !== 'object') throw new Error('La plantilla no es un objeto.');
    if (!pl.embudo || !String(pl.embudo).trim()) throw new Error('Falta el nombre del embudo.');
    if (!Array.isArray(pl.etapas) || pl.etapas.length < 2) throw new Error('El embudo necesita al menos dos etapas.');
    for (const e of pl.etapas) {
      if (!e || !String(e.nombre || '').trim()) throw new Error('Hay una etapa sin nombre.');
      if (e.tipo && !TIPOS_ETAPA.includes(e.tipo)) throw new Error(`La etapa «${e.nombre}» tiene un tipo raro: ${e.tipo}.`);
      if (!probabilidadValida(e.probabilidad)) throw new Error(`La probabilidad de «${e.nombre}» tiene que ser un número de 0 a 100 (llegó ${e.probabilidad}).`);
      for (const q of e.requisitos || []) {
        if (!TIPOS_REQUISITO.includes(q.tipo)) throw new Error(`Un requisito de «${e.nombre}» tiene un tipo raro: ${q.tipo}.`);
        if (!q.texto || !q.clave) throw new Error(`Un requisito de «${e.nombre}» no tiene texto o clave.`);
        if (q.patron) { try { new RegExp(q.patron, 'i'); } catch (err) { throw new Error(`El patrón de «${q.texto}» no es válido.`); } }
      }
    }
    // Opcionales (sprint 6): de dónde se lee la plata y con qué carpetas nace cada negocio.
    for (const p of [pl.plata && pl.plata.libro && pl.plata.libro.patron, pl.plata && pl.plata.compras && pl.plata.compras.patron].filter(Boolean)) {
      try { new RegExp(p, 'i'); } catch (err) { throw new Error(`El patrón «${p}» de la plata no es válido.`); }
    }
    if (pl.carpeta && !Array.isArray(pl.carpeta.estructura)) throw new Error('«carpeta.estructura» tiene que ser una lista de subcarpetas.');
    if (!pl.etapas.some((e) => e.tipo === 'ganada')) throw new Error('Falta una etapa de tipo «ganada» (el cierre bueno).');
    return Object.assign({ id: 'a-medida', nombre: 'A medida · ' + pl.embudo, reglas: [] }, pl);
  }
  function aplicarPlantilla(idOObjeto, entorno, autor) {
    const pl = typeof idOObjeto === 'object' ? validarPlantilla(idOObjeto) : plantillas().find((x) => x.id === idOObjeto);
    if (!pl) throw new Error('No existe la plantilla ' + idOObjeto);
    db.exec('BEGIN');
    try {
      pl.etapas.forEach((e, i) => {
        const orden = (i + 1) * 10;
        let fila = uno('SELECT * FROM etapa WHERE embudo = ? AND lower(nombre) = lower(?)', pl.embudo, e.nombre);
        // La probabilidad (sprint 26) se escribe solo si la plantilla la trae: una plantilla sin ella no borra la que había.
        const prob = tieneProbabilidad(e) && probabilidadValida(e.probabilidad) ? Math.round(e.probabilidad) : null;
        if (fila) {
          correr('UPDATE etapa SET orden = ?, tipo = ? WHERE id = ?', orden, e.tipo || 'abierta', fila.id);
          if (prob !== null && fila.probabilidad !== prob) {
            correr('UPDATE etapa SET probabilidad = ? WHERE id = ?', prob, fila.id);
            anotar(autor, 'etapa', fila.id, 'cambiar', 'probabilidad', fila.probabilidad, prob);
          }
        } else fila = { id: Number(correr('INSERT INTO etapa(embudo, nombre, orden, tipo, probabilidad) VALUES (?, ?, ?, ?, ?)', pl.embudo, e.nombre, orden, e.tipo || 'abierta', prob).lastInsertRowid) };
        correr('DELETE FROM requisito WHERE etapa_id = ?', fila.id);
        for (const q of e.requisitos || []) correr('INSERT INTO requisito(etapa_id, tipo, clave, texto, patron) VALUES (?, ?, ?, ?, ?)', fila.id, q.tipo, q.clave, q.texto, q.patron || null);
      });
      let orden = (uno('SELECT MAX(orden) AS m FROM regla').m || 0);
      for (const g of pl.reglas || []) {
        if (uno('SELECT 1 AS x FROM regla WHERE rotulo = ? AND IFNULL(etapa, \'\') = ?', g.rotulo, g.etapa || '')) continue;
        correr('INSERT INTO regla(rotulo, condicion, etapa, dias, orden) VALUES (?, ?, ?, ?, ?)', g.rotulo, g.condicion, g.etapa || null, g.dias || 0, orden += 10);
      }
      if (entorno) config('embudo:' + entorno, pl.embudo);
      config('plantilla:' + pl.embudo, pl.id);
      if (pl.etapas.some(tieneProbabilidad)) config('probabilidades:' + pl.embudo, ahora());
      guardarExtras(pl);
      anotar(autor, 'config', 0, 'cambiar', 'plantilla' + (entorno ? ' de ' + entorno : ''), null, pl.nombre);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { embudo: pl.embudo, etapas: pl.etapas.length };
  }
  // La plata y la estructura de carpetas de un embudo vienen de su plantilla; las raíces (dónde nacen las carpetas) son
  // de cada CRM y no se pisan.
  function guardarExtras(pl) {
    if (pl.plata) config('plata:' + pl.embudo, JSON.stringify(pl.plata));
    if (pl.carpeta && pl.carpeta.estructura) config('carpeta:' + pl.embudo, JSON.stringify(pl.carpeta.estructura));
    if (pl.carpeta && pl.carpeta.tipos) config('tipos:' + pl.embudo, JSON.stringify(pl.carpeta.tipos));
  }
  // La base que nació antes del sprint 4 tiene el embudo Trabajos sin requisitos: se le aplica su plantilla una vez.
  if (!config('plantilla:Trabajos') && uno("SELECT 1 AS x FROM etapa WHERE embudo = 'Trabajos'")) {
    try { aplicarPlantilla('proyectos-servicios', null, 'sistema'); } catch (e) { /* sin plantillas en disco: sigue igual */ }
  }
  // Un embudo aplicado antes del sprint 6 recibe una vez la plata y las carpetas de su plantilla.
  for (const { clave, valor } of todos("SELECT clave, valor FROM config WHERE clave LIKE 'plantilla:%'")) {
    const embudo = clave.slice('plantilla:'.length);
    const pl = plantillas().find((x) => x.id === valor && x.embudo === embudo);
    if (pl && ((pl.plata && !config('plata:' + embudo)) || (pl.carpeta && !config('carpeta:' + embudo)))) guardarExtras(pl);
    // Sprint 26: un embudo aplicado antes recibe una vez las probabilidades de su plantilla, solo en las etapas que no
    // tienen. La marca «probabilidades:<embudo>» evita volver a llenar una que quien usa la app dejó vacía a propósito.
    if (pl && !config('probabilidades:' + embudo) && pl.etapas.some(tieneProbabilidad)) {
      for (const e of pl.etapas) {
        if (!tieneProbabilidad(e) || !probabilidadValida(e.probabilidad)) continue;
        const fila = uno('SELECT id FROM etapa WHERE embudo = ? AND lower(nombre) = lower(?) AND probabilidad IS NULL', embudo, e.nombre);
        if (!fila) continue;
        correr('UPDATE etapa SET probabilidad = ? WHERE id = ?', Math.round(e.probabilidad), fila.id);
        anotar('migración', 'etapa', fila.id, 'cambiar', 'probabilidad', null, Math.round(e.probabilidad));
      }
      config('probabilidades:' + embudo, ahora());
    }
  }
  // Raíces de carpetas: dónde nacen los proyectos y, por embudo, las carpetas de cada tipo de negocio.
  function carpetas(cambios) {
    if (cambios) {
      if (cambios.raiz_proyectos !== undefined) config('raiz_proyectos', cambios.raiz_proyectos || '');
      for (const [embudo, raices] of Object.entries(cambios.raices || {})) config('raices:' + embudo, JSON.stringify(raices || {}));
    }
    return { raiz_proyectos: config('raiz_proyectos') || null,
      raices: Object.fromEntries(embudos().map((e) => [e, leerJSON('raices:' + e) || {}])),
      tipos: Object.fromEntries(embudos().map((e) => [e, leerJSON('tipos:' + e) || []])),
      estructura: Object.fromEntries(embudos().map((e) => [e, leerJSON('carpeta:' + e) || []])) };
  }

  return {
    ruta: rutaBase, modo: () => config('modo') || 'vacía', config, ORIGENES,
    embudos, embudoDe, plantillas, cuestionario, recomendar, aplicarPlantilla, requisitos, documentos, registrarDocumento,
    etapas, empresas, contactos, negocios, negocio, reglas, hoy,
    crearEmpresa, crearContacto, crearNegocio, cambiarNegocio, cambiarProbabilidadEtapa, moverEtapa, crearActividad, completarActividad,
    guardarEmpresa, cambiarEmpresa,
    leerPlata, proyectos, crearProyecto, crearCarpeta, crearSolicitud, escribirSeccion, carpetas,
    exportarCSV, migrarDesde, sembrarPrueba, cerrar: () => db.close()
  };
}

let carpetaPlantillasPropias = null;
const configurarPlantillas = (dir) => { carpetaPlantillasPropias = dir || null; };
module.exports = { abrir, TIPOS_ACTIVIDAD, configurarPlantillas };
