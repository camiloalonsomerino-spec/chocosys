// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Arma el instalador de Chocosys para Windows (sprint 18; foto y comparación desde T-A93, 22-10-2026) o para macOS.
//   node scripts/instalador.js         edición pública: antes de armar, revisa que nada del paquete nombre a nadie ni
//                                      lleve rutas de un computador, y se detiene si encuentra algo.
//   node scripts/instalador.js --mio   edición propia: lleva además una semilla con el perfil, las recetas y las
//                                      plantillas de quien la arma, que se copia a sus datos la primera vez que abre.
//   --salida <carpeta>                 deja el instalador ahí en vez de consola-agentes\dist\ (para probar sin pisarlo).
//   --mac [--arm64] [--x64] [--adhoc]  arma el .dmg de macOS. Solo en un Mac (o en GitHub Actions, .github/workflows/mac.yml):
//                                      node-pty necesita su binario de macOS y el .dmg sale de hdiutil. --adhoc firma sin cuenta
//                                      de desarrollador de Apple; con CSC_LINK firma de verdad y con APPLE_ID, APPLE_TEAM_ID y
//                                      APPLE_APP_SPECIFIC_PASSWORD además notariza.
//   node scripts/instalador.js --revisar  solo revisa (sin armar) lo que miraría la edición pública.
//   node scripts/instalador.js --verificar <app.asar> [<carpeta>]
//                                      solo compara un app.asar armado con una carpeta (por defecto, app\).
// Nunca arma desde app\: copia app\ a una foto en TEMP, espera a que la copia calce con la fuente, arma desde la foto y,
// al terminar, compara cada archivo del app.asar con la foto. Si uno no calza, sale con código 1. Así un archivo que
// otro editaba mientras se armaba no deja un app.asar corrido (T-D03: la app abría en negro y el script salía con 0).

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const APP = path.join(__dirname, '..');
const MIO = process.argv.includes('--mio');
const MAC = process.argv.includes('--mac');
// Dónde guarda Chocosys los datos de quien arma (perfil.json): %APPDATA% en Windows, Application Support en macOS.
const carpetaDatos = () => path.join(process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), 'AppData', 'Roaming')), 'consola-agentes');
// Como build.files: scripts, build y dist solo en la raíz; node_modules y _archivo a cualquier profundidad.
const FUERA = /^(scripts|build|dist)([\\/]|$)|(^|[\\/])(node_modules|_archivo)([\\/]|$)/;
// Lo que no puede viajar en la edición pública: rutas de una carpeta de usuario y correos, más los nombres que quien
// arma anota en su perfil.json («revision_publica»: ["Nombre", "Cliente"…]). Así la lista de nombres no viaja en el programa.
const DATOS_PROPIOS = carpetaDatos();
function nombresPropios() {
  const archivo = path.join(DATOS_PROPIOS, 'perfil.json');
  // Sin perfil.json (en GitHub Actions nunca hay) se revisan rutas y correos, pero no nombres: se dice, no se calla.
  if (!fs.existsSync(archivo)) { console.warn(`Sin ${archivo}: la revisión no busca nombres propios, solo rutas y correos.`); return []; }
  try {
    // Cada nombre es texto literal: «S.A. (Chile» no es una expresión válida y antes vaciaba la revisión entera.
    return (JSON.parse(fs.readFileSync(archivo, 'utf8')).revision_publica || []).map((n) => new RegExp(String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  } catch (e) {
    // Falla cerrada: sin la lista, la revisión diría «limpia» sin haber buscado ningún nombre.
    console.error(`No se pudo leer «revision_publica» de ${archivo} (${e.message}). Arréglalo y vuelve a correr.`);
    process.exit(1);
  }
}
// También rutas de Mac y Linux (/Users/<nombre>/ y /home/<nombre>/), para la edición que se arma en un Mac.
const PROHIBIDO = [/[A-Z]:\\\\?Users\\\\?[^\\'"\s%<]/i, /\/(Users|home)\/[^/\s'"$<{]+\//, /[\w.+-]+@(?!ejemplo\.)[\w-]+\.[a-z]{2,}/i].concat(nombresPropios());
// Los únicos archivos con datos del autor a propósito: su contacto público y el texto de los créditos.
const DEL_AUTOR = /^config[\\/](contacto\.json|creditos\.md)$/;
// Lo que no se copia a la foto: node_modules va por junction (pesa y nadie lo edita), el resto no viaja.
const NO_VA_A_LA_FOTO = /^(node_modules|dist)([\\/]|$)|(^|[\\/])_archivo([\\/]|$)|\.log$/i;
// Cuántas veces se recopia lo que cambió mientras se copiaba, antes de rendirse.
const VUELTAS_FOTO = 5;

function argumento(nombre) {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : null;
}

function archivos(base, dir = base, lista = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, e.name);
    if (FUERA.test(path.relative(base, ruta) + path.sep) || e.name === 'package-lock.json') continue;
    if (e.isDirectory()) archivos(base, ruta, lista); else lista.push(ruta);
  }
  return lista;
}
// Los comentarios del código pueden nombrar al autor; los textos que ve una persona o una sesión, no.
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/\s.*$/, '')).join('\n');

function revisar(base) {
  const hallazgos = [];
  for (const f of archivos(base)) {
    if (!/\.(js|json|ya?ml|md|html|css|sql|ps1)$/i.test(f) || DEL_AUTOR.test(path.relative(base, f))) continue;
    let t = fs.readFileSync(f, 'utf8');
    if (/\.(js|css)$/i.test(f)) t = sinComentarios(t);
    t.split('\n').forEach((l, i) => { for (const p of PROHIBIDO) if (p.test(l)) hallazgos.push(`${path.relative(base, f)}:${i + 1}: ${l.trim().slice(0, 110)}`); });
  }
  return hallazgos;
}

const huella = (archivo) => crypto.createHash('sha256').update(fs.readFileSync(archivo)).digest('hex');

// Rutas relativas de los archivos que van a la foto (sin node_modules, dist ni _archivo).
function archivosDeFoto(base, dir = base, lista = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, e.name);
    const rel = path.relative(base, ruta);
    if (NO_VA_A_LA_FOTO.test(rel)) continue;
    if (e.isDirectory()) archivosDeFoto(base, ruta, lista); else if (e.isFile()) lista.push(rel);
  }
  return lista;
}

// Copia app\ a una carpeta de TEMP y la recopia hasta que cada archivo calce con la fuente.
function sacarFoto() {
  const sello = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const foto = path.join(os.tmpdir(), `chocosys-foto-${sello}`);
  fs.mkdirSync(foto, { recursive: true });
  for (let vuelta = 1; vuelta <= VUELTAS_FOTO; vuelta++) {
    const fuente = archivosDeFoto(APP);
    const distintos = fuente.filter((rel) => {
      const copia = path.join(foto, rel);
      return !fs.existsSync(copia) || huella(copia) !== huella(path.join(APP, rel));
    });
    if (!distintos.length) {
      // Lo que se borró en la fuente mientras se copiaba tampoco va.
      for (const rel of archivosDeFoto(foto)) if (!fuente.includes(rel)) fs.rmSync(path.join(foto, rel));
      fs.symlinkSync(path.join(APP, 'node_modules'), path.join(foto, 'node_modules'), 'junction');
      console.log(`Foto de app\\ en ${foto} (${fuente.length} archivos, vuelta ${vuelta}).`);
      return foto;
    }
    if (vuelta > 1) console.log(`Foto, vuelta ${vuelta}: ${distintos.length} archivos cambiaron mientras se copiaba.`);
    for (const rel of distintos) {
      fs.mkdirSync(path.dirname(path.join(foto, rel)), { recursive: true });
      fs.copyFileSync(path.join(APP, rel), path.join(foto, rel));
    }
  }
  console.error(`La foto de app\\ no se estabilizó en ${VUELTAS_FOTO} vueltas: alguien está editando. Arma cuando nadie edite. La foto queda en ${foto}.`);
  process.exit(1);
}

function borrarFoto(foto) {
  // Nunca borrar recursivo si el junction sigue ahí: borraría el node_modules de app\.
  if (!soltarEnlace(foto)) { console.log(`La foto queda en ${foto} (no se pudo soltar su node_modules).`); return; }
  fs.rmSync(foto, { recursive: true, force: true });
}

// Suelta el junction node_modules de la foto. Devuelve true si ya no está.
function soltarEnlace(foto) {
  const enlace = path.join(foto, 'node_modules');
  try { fs.unlinkSync(enlace); } catch { try { fs.rmdirSync(enlace); } catch { /* sin junction */ } }
  return !fs.existsSync(enlace);
}

// Cuando el armado falla, la foto queda para revisarla, pero sin el junction: así borrarla a mano no vacía app\node_modules.
function dejarFoto(foto) {
  return soltarEnlace(foto)
    ? `La foto queda en ${foto} (sin su node_modules: se puede borrar entera).`
    : `La foto queda en ${foto} CON un junction node_modules hacia app\\node_modules: suéltalo con «cmd /c rmdir "${path.join(foto, 'node_modules')}"» antes de borrarla.`;
}

// Compara cada archivo del app.asar (fuera de node_modules, que electron-builder poda) con la carpeta, y que nada de
// la carpeta que debía viajar falte en el asar. Devuelve las diferencias en palabras.
function verificar(archivoAsar, base) {
  const asar = require('@electron/asar');
  const diferencias = [];
  const enAsar = new Set();
  for (const entrada of asar.listPackage(archivoAsar, { isPack: false })) {
    const rel = entrada.replace(/^[\\/]+/, '');
    if (/^node_modules([\\/]|$)/.test(rel)) continue;
    const info = asar.statFile(archivoAsar, rel, false);
    if (info.files || info.link) continue;
    enAsar.add(path.normalize(rel));
    const local = path.join(base, rel);
    if (!fs.existsSync(local)) { diferencias.push(`${rel}: está en el asar y no en la carpeta`); continue; }
    const dentro = asar.extractFile(archivoAsar, rel);
    const fuera = fs.readFileSync(local);
    if (rel === 'package.json') {
      // electron-builder reescribe el package.json (le saca build, scripts y devDependencies): se comparan los campos
      // con que la app arranca.
      const a = JSON.parse(dentro.toString('utf8')), b = JSON.parse(fuera.toString('utf8'));
      const campos = ['name', 'productName', 'version', 'main'];
      if (campos.some((c) => a[c] !== b[c]) || JSON.stringify(a.dependencies || {}) !== JSON.stringify(b.dependencies || {})) diferencias.push(`${rel}: distinto en ${campos.join(', ')} o dependencies`);
      continue;
    }
    if (!dentro.equals(fuera)) diferencias.push(`${rel}: distinto (asar ${dentro.length} bytes, carpeta ${fuera.length})`);
  }
  for (const f of archivos(base)) {
    const rel = path.normalize(path.relative(base, f));
    // electron-builder no lleva los archivos ocultos (.gitignore) ni los registros.
    if (/\.log$/i.test(rel) || path.basename(rel).startsWith('.')) continue;
    if (!enAsar.has(rel)) diferencias.push(`${rel}: falta en el asar`);
  }
  return { diferencias, revisados: enAsar.size };
}

function informarVerificacion(archivoAsar, base) {
  const { diferencias, revisados } = verificar(archivoAsar, base);
  if (diferencias.length) {
    console.error(`El app.asar no calza con ${base}: ${diferencias.length} diferencias en ${revisados} archivos.\n` + diferencias.slice(0, 40).join('\n'));
    return false;
  }
  console.log(`El app.asar calza con ${base}: ${revisados} archivos iguales byte a byte.`);
  return true;
}

// Solo comparar (para probar o revisar un instalador ya armado).
if (process.argv.includes('--verificar')) {
  const archivoAsar = argumento('--verificar');
  const i = process.argv.indexOf('--verificar');
  const base = path.resolve(process.argv[i + 2] && !process.argv[i + 2].startsWith('--') ? process.argv[i + 2] : APP);
  if (!archivoAsar || !fs.existsSync(archivoAsar)) { console.error('Uso: node scripts/instalador.js --verificar <app.asar> [<carpeta>]'); process.exit(2); }
  process.exit(informarVerificacion(path.resolve(archivoAsar), base) ? 0 : 1);
}

// Solo revisar, sin armar: lo mismo que mira la edición pública (sirve antes de un pull request).
if (process.argv.includes('--revisar')) {
  const h = revisar(APP);
  console.log(h.length ? `${h.length} líneas nombran a alguien o llevan una ruta de un computador:\n` + h.join('\n') : 'Revisión pública: limpia.');
  process.exit(h.length ? 1 : 0);
}

if (MAC && process.platform !== 'darwin') {
  console.error('La edición de macOS se arma en un Mac o en GitHub Actions (.github/workflows/mac.yml): desde Windows faltan el binario de node-pty para macOS, hdiutil para el .dmg y codesign para firmar.');
  process.exit(2);
}
const SALIDA = path.resolve(argumento('--salida') || path.join(APP, '..', 'dist'));
const FOTO = sacarFoto();

const hallazgos = revisar(FOTO);
if (hallazgos.length && !MIO) {
  console.error(`La edición pública no se arma: ${hallazgos.length} líneas nombran a alguien o llevan una ruta de este computador.\n` + hallazgos.slice(0, 40).join('\n'));
  borrarFoto(FOTO);
  process.exit(1);
}
console.log(MIO ? 'Edición propia.' : 'Revisión pública: limpia.');

// La configuración de package.json (de la foto) con la salida fija: desde la foto, «../dist» caería en TEMP.
const base = JSON.parse(fs.readFileSync(path.join(FOTO, 'package.json'), 'utf8')).build;
const config = Object.assign({}, base, { directories: Object.assign({}, base.directories, { output: SALIDA }) });
if (MIO) {
  // La semilla: el perfil sin las rutas de este computador, y las recetas y plantillas propias.
  const datos = carpetaDatos();
  const perfil = JSON.parse(fs.readFileSync(path.join(datos, 'perfil.json'), 'utf8'));
  // Fuera del proyecto, para que nunca termine por error dentro de la edición pública.
  const semilla = path.join(os.tmpdir(), 'chocosys-datos-semilla');
  fs.rmSync(semilla, { recursive: true, force: true });
  fs.mkdirSync(semilla, { recursive: true });
  const recetas = perfil.carpeta_recetas || path.join(datos, 'recetas');
  const plantillas = perfil.carpeta_plantillas || path.join(datos, 'plantillas');
  if (fs.existsSync(recetas)) fs.cpSync(recetas, path.join(semilla, 'recetas'), { recursive: true, filter: (s) => !/[\\/]_archivo([\\/]|$)/.test(s) });
  if (fs.existsSync(plantillas)) fs.cpSync(plantillas, path.join(semilla, 'plantillas'), { recursive: true });
  delete perfil.carpeta_recetas;
  delete perfil.carpeta_plantillas;
  fs.writeFileSync(path.join(semilla, 'perfil.json'), JSON.stringify(perfil, null, 2), 'utf8');
  config.extraResources = [{ from: semilla, to: 'datos-semilla' }];
  config.nsis = Object.assign({}, base.nsis, { artifactName: 'Chocosys-instalador-propio-${version}.exe' });
  config.dmg = Object.assign({}, base.dmg, { artifactName: 'Chocosys-propio-${version}-${arch}.dmg' });
}
// Firma ad-hoc: sin ella macOS da por dañada una app arm64 cuya firma de Electron quedó rota al armarla.
// Solo la ad-hoc lleva disable-library-validation (entitlements.adhoc.plist); la de desarrollador no lo necesita.
if (MAC && process.argv.includes('--adhoc')) config.mac = Object.assign({}, base.mac, { identity: '-', entitlements: 'build/entitlements.adhoc.plist', entitlementsInherit: 'build/entitlements.adhoc.plist' });
// Por la línea de comandos no toma la configuración entera: va en un archivo aparte.
const archivoConfig = path.join(os.tmpdir(), MIO ? 'chocosys-config-propia.json' : 'chocosys-config-publica.json');
fs.writeFileSync(archivoConfig, JSON.stringify(config, null, 2), 'utf8');
const args = MAC
  ? ['electron-builder', '--mac', 'dmg', ...['--arm64', '--x64'].filter((a) => process.argv.includes(a)), '--publish', 'never', '--config', archivoConfig]
  : ['electron-builder', '--win', 'nsis', '--config', archivoConfig];
try {
  execSync('npx ' + args.map((a) => (/[\s"{}[\]]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' '), { cwd: FOTO, stdio: 'inherit' });
} catch {
  // «Array buffer allocation failed» o «UNKNOWN: read» = falta memoria (muchas sesiones abiertas): cerrar algunas y repetir.
  console.error(`electron-builder no terminó. ${dejarFoto(FOTO)}`);
  process.exit(1);
}

const armados = MAC
  ? ['mac-arm64', 'mac'].map((d) => path.join(SALIDA, d, 'Chocosys.app', 'Contents', 'Resources', 'app.asar')).filter((a) => fs.existsSync(a))
  : [path.join(SALIDA, 'win-unpacked', 'resources', 'app.asar')].filter((a) => fs.existsSync(a));
if (!armados.length) { console.error(`No apareció el app.asar en ${SALIDA}: el armado no terminó bien. ${dejarFoto(FOTO)}`); process.exit(1); }
for (const armado of armados) {
  if (!informarVerificacion(armado, FOTO)) {
    console.error(`No uses este instalador. ${dejarFoto(FOTO)}`);
    process.exit(1);
  }
}
borrarFoto(FOTO);
console.log(`Listo: el instalador quedó en ${SALIDA}.`);
