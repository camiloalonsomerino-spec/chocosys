// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Prueba del lector de procesos de macOS (procesos-unix.js) sin un Mac: una foto de procesos armada a mano y process.kill
// cambiado por un registro. Corre en cualquier sistema: node scripts/probar-unix.js
const assert = require('assert');
const u = require('../procesos-unix');

let pasan = 0;
const ok = (c, m) => { assert.ok(c, m); pasan++; };
const igual = (a, b, m) => { assert.deepStrictEqual(a, b, m); pasan++; };

// Tiempos de CPU de ps.
igual(u.msCpu('0:01.23'), 1230, 'macOS m:ss.cc');
igual(u.msCpu('123:45.67'), 7425670, 'macOS con más de 60 min');
igual(u.msCpu('1-02:03:04'), 93784000, 'Linux con días');
igual(u.msCpu('00:00:01'), 1000, 'Linux hh:mm:ss');

// Lectura de ps (formato de macOS, con día de un dígito y rutas con espacios).
const a = [
  '    1     0     0   9000   1:00.00 Sun Nov  1 09:00:00 2026     /sbin/launchd',
  '  210   100   501  51200   0:03.10 Sun Nov 15 10:00:01 2026     /Users/ana/.local/share/claude/versions/2.1.3',
  '  500   210   501  80000   0:09.00 Sun Nov 15 10:00:05 2026     /Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].join('\n');
const b = ['    1 /sbin/launchd', '  210 /Users/ana/.local/bin/claude --session-id 11111111-2222-3333-4444-555555555555 --settings /x/hooks.json',
  '  500 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --flag'].join('\n');
const foto = u.parsear(a, b);
igual(foto.length, 3, 'lee las tres filas');
igual(foto[1].nombre, 'claude', 'el claude nativo se reconoce por su línea de comando');
igual(foto[1].bytes, 51200 * 1024, 'rss en KB');
igual(foto[2].nombre, 'Google Chrome', 'nombre con espacios');
ok(foto[1].inicio > foto[0].inicio && foto[2].inicio - foto[1].inicio === 4000, 'lstart a ms');
ok(u._protegido(foto[2]) && u._protegido(foto[0]) && !u._protegido(foto[1]), 'apps y sistema protegidos; claude no');

// Una sesión con su árbol: claude 200 → node 300 (MCP) → python 400; Chrome 500 (protegido) con un hijo 501; Chrome
// headless 600 (de una prueba, se cierra); 700 dice colgar de 200 pero nació antes (otro proceso con el número reusado).
const S = '11111111-2222-3333-4444-555555555555';
const p = (pid, ppid, inicio, nombre, comm, cmd, ms = 0, uid = 501) => ({ pid, ppid, uid, bytes: 1024, ms, inicio, comm, cmd: cmd || comm, nombre });
function arbolFalso(msPython = 0) {
  return [
    p(1, 0, 1000, 'launchd', '/sbin/launchd', '', 0, 4242),
    p(100, 1, 2000, 'Chocosys', '/Applications/Chocosys.app/Contents/MacOS/Chocosys'),
    p(200, 100, 3000, 'claude', '/u/claude', `/u/claude --session-id ${S} --settings /d/hooks.json`),
    p(300, 200, 4000, 'node', '/opt/homebrew/bin/node', '/opt/homebrew/bin/node mcp.js'),
    p(400, 300, 5000, 'python3', '/usr/bin/python3', '/usr/bin/python3 calculo.py', msPython),
    p(500, 200, 6000, 'Google Chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    p(501, 500, 6500, 'Google Chrome Helper', '/Applications/Google Chrome.app/Contents/Frameworks/Helper'),
    p(600, 200, 7000, 'Google Chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless'),
    p(700, 200, 2500, 'node', '/opt/homebrew/bin/node')
  ];
}
const matados = [];
const killOriginal = process.kill;
process.kill = (pid) => { matados.push(pid); };

(async () => {
  try {
    u._fijarLector(async () => arbolFalso());
    let r = await u.pedir(`k ${S} -`);
    igual(matados.sort((x, y) => x - y), [200, 300, 400, 600], 'corta todo lo suyo, deja Chrome, su hijo y el número reusado');
    igual(r.raices, 1, 'una raíz');
    igual(r.cerrados, 4, 'cuatro cerrados');

    matados.length = 0;
    r = await u.pedir(`k ${S} 400:5000`);
    igual(matados.sort((x, y) => x - y), [200, 600], 'conserva python y su padre node; cierra el resto');
    igual(r.quedan, 'node python3', 'informa lo que queda');

    // «ocupados»: python gasta 1 núcleo entre las dos fotos.
    matados.length = 0;
    let vuelta = 0;
    u._fijarLector(async () => arbolFalso(vuelta++ === 0 ? 0 : 1500));
    r = await u.pedir(`k ${S} ocupados`);
    igual(matados.sort((x, y) => x - y), [200, 600], 'lo que gasta CPU queda vivo');

    // Verificación antes de cerrar: si node 300 se reinició (otra hora de inicio) entre las fotos, no se toca.
    matados.length = 0;
    vuelta = 0;
    const lector2 = async () => { const f = arbolFalso(); if (vuelta++ > 0) f.find((w) => w.pid === 300).inicio = 9999; return f; };
    u._fijarLector(lector2);
    await u.pedir(`k ${S} ocupados`);
    ok(!matados.includes(300), 'no cierra un proceso que cambió de hora de inicio');

    // «c»: cálculo vivo de la sesión.
    vuelta = 0;
    u._fijarLector(async () => arbolFalso(vuelta++ === 0 ? 0 : 1500));
    r = await u.pedir(`c ${S}`);
    igual(r.c.length, 1, 'un cálculo vivo');
    igual([r.c[0][0], r.c[0][1], r.c[0][3]], [S, 400, 'python3'], 'es el python de la sesión');

    // «p» y «a»: el mismo formato que el PowerShell.
    u._fijarLector(async () => arbolFalso());
    r = await u.pedir('p');
    ok(Array.isArray(r.p) && r.p.every((x) => x.length === 5), '«p» trae [pid, nombre, bytes, sesión, ms]');
    igual(r.p.find((x) => x[0] === 1)[4], -1, 'sin CPU de otro usuario');
    r = await u.pedir('u 300');
    igual(r.a, [[300, 200, 4000, '/opt/homebrew/bin/node mcp.js']], '«u» de un proceso con su línea de comando');

    // Una señal cancelada no hace nada.
    await assert.rejects(u.pedir(`k ${S} -`, { cancelada: true }));
    pasan++;

    // GPU de ioreg (salida recortada de un Mac con Apple Silicon).
    const ioreg = `+-o AGXAcceleratorG13X  <class AGXAcceleratorG13X, id 0x1000, registered>
    {
      "model" = "Apple M1"
      "PerformanceStatistics" = {"In use system memory"=734003200,"Device Utilization %"=17,"Renderer Utilization %"=12}
    }`;
    igual(u.gpuDeIoreg(ioreg), [['Apple M1', 17, 734003200, 'integrada']], 'GPU de Apple Silicon');
    igual(u.gpuDeIoreg('nada'), null, 'sin GPU legible');

    // RAM de macOS con vm_stat (17-11-2026): activas + fijas + comprimidas, por el tamaño de página que trae.
    const { leerVmStat } = require('../recursos');
    const vm = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                                2837.\nPages active:                            100000.\nPages inactive:                          105103.\nPages wired down:                         50000.\nPages occupied by compressor:            50000.\n';
    igual(leerVmStat(vm), Math.min(200000 * 16384, require('os').totalmem()), 'RAM usada desde vm_stat');
    igual(leerVmStat('nada'), null, 'vm_stat ilegible');

    // LANG desde el idioma del sistema (abierta desde el Dock). En Windows no hace nada.
    if (process.platform !== 'win32') {
      const fs = require('fs');
      const path = require('path');
      const { completarIdioma } = require('../plataforma');
      const loc = fs.mkdtempSync(path.join(require('os').tmpdir(), 'probar-locale-'));
      for (const n of ['en_US.UTF-8', 'es_ES.UTF-8', 'es_MX.UTF-8', 'es_ES']) fs.mkdirSync(path.join(loc, n));
      const antes = process.env.LANG;
      const con = (idioma) => { delete process.env.LANG; return completarIdioma(idioma, loc); };
      try {
        igual(con('es-MX'), 'es_MX.UTF-8', 'idioma y región exactos');
        igual(con('es-CL'), 'es_ES.UTF-8', 'sin es_CL: la misma lengua en otra región');
        igual(con('ja-JP'), 'en_US.UTF-8', 'sin la lengua: en_US');
        igual(con(''), 'en_US.UTF-8', 'sin idioma del sistema');
        process.env.LANG = 'fr_FR.UTF-8';
        igual(completarIdioma('es-CL', loc), 'fr_FR.UTF-8', 'si LANG ya viene, no se toca');
      } finally {
        if (antes === undefined) delete process.env.LANG; else process.env.LANG = antes;
        fs.rmSync(loc, { recursive: true, force: true });
      }
    }

    console.log(`probar-unix: ${pasan} de ${pasan} pasan`);
  } finally { process.kill = killOriginal; }
})().catch((e) => { process.kill = killOriginal; console.error('FALLA:', e.message); process.exit(1); });
