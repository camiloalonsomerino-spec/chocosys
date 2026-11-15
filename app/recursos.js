// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Recursos del PC (PRD-05): los totales salen del módulo os (sin lanzar nada) y los procesos de UN PowerShell que queda
// vivo mientras se le pide algo. agrupar() no toca el sistema. El optimizador (sugerir, bajar prioridades, cerrar restos y el
// modo automático) salió el 04-11-2026: está en _archivo\limpieza-04-11-2026\.

const os = require('os');
const { spawn } = require('child_process');

const UMBRAL = { ram: 85, ramSeg: 10, cpu: 90, cpuSeg: 30, critico: 95 };
const HISTORIA_MS = 5 * 60 * 1000;
const PADRES_CADA_MS = 15000;
const PS_OCIOSO_MS = 2 * 60 * 1000;

// ── Totales ──
// GPU: una por adaptador (hay equipos con dos: NVIDIA con VRAM dedicada e Intel con memoria compartida). Cada una = [nombre, % máximo
// de sus motores 3D, Compute, Copy, VideoDecode y VideoEncode, bytes de memoria (dedicada, o compartida si es integrada), tipo].
// La pide medirTotales cada 10 s: la historia guarda la más ocupada como cuarta columna y historiaGpu el % de cada una; sin
// ninguna (null) reintenta cada 5 min. Con la ventana oculta no se pide (P4, 04-11-2026): el PowerShell se cierra a los
// 2 min sin preguntas y esos minutos quedan sin GPU en la historia; al volver a verse, la mide en la vuelta siguiente.
let gpu, gpuEn = 0, gpuLeyendo = false;
const historiaGpu = [];        // [t, { nombre: % }]
function leerGpu(ahora) {
  if (gpuLeyendo || ahora - gpuEn < (gpu === null ? 300000 : 10000)) return;
  gpuEn = ahora; gpuLeyendo = true;
  pedirPs('g').then((r) => { gpu = r.g && r.g.length ? r.g.map(([nombre, pct, mem, tipo]) => ({ nombre, pct, memGB: mem / 2 ** 30, tipo })) : null; }, () => { /* se reintenta en 10 s */ }).then(() => { gpuLeyendo = false; });
}

let tiemposAntes = null;
const historia = [];
let alerta = null;

function sumarTiempos() {
  let ocupado = 0, total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    const todo = t.user + t.nice + t.sys + t.idle + t.irq;
    total += todo;
    ocupado += todo - t.idle;
  }
  return { ocupado, total };
}

// Devuelve la alerta nueva si empezó un episodio (para avisar una vez), o null.
function medirTotales(ahora = Date.now(), conGpu = true) {
  const t0 = process.cpuUsage();
  const t = sumarTiempos();
  const cpu = tiemposAntes && t.total > tiemposAntes.total ? (100 * (t.ocupado - tiemposAntes.ocupado)) / (t.total - tiemposAntes.total) : null;
  tiemposAntes = t;
  const ram = (100 * (os.totalmem() - os.freemem())) / os.totalmem();
  if (conGpu) leerGpu(ahora);
  const g = conGpu ? gpu : null;
  if (cpu != null) {
    historia.push([ahora, Math.round(cpu), Math.round(ram), g ? Math.max(...g.map((x) => x.pct)) : null]);
    historiaGpu.push([ahora, g ? Object.fromEntries(g.map((x) => [x.nombre, x.pct])) : null]);
  }
  while (historia.length && historia[0][0] < ahora - HISTORIA_MS) historia.shift();
  while (historiaGpu.length && historiaGpu[0][0] < ahora - HISTORIA_MS) historiaGpu.shift();
  const antes = alerta;
  alerta = evaluarAlerta(historia, ahora, antes);
  gastoPrincipal(t0);
  return alerta && (!antes || antes.tipo !== alerta.tipo) ? alerta : null;
}

// Sostenida: todas las muestras de la ventana pasan el umbral y la ventana cubre el tiempo pedido.
function sostenida(hist, ahora, col, umbral, seg) {
  const desde = ahora - seg * 1000;
  const tramo = hist.filter((m) => m[0] >= desde - 2500);
  if (!tramo.length || tramo[0][0] > desde + 2500) return null;
  return tramo.every((m) => m[col] >= umbral) ? Math.round(tramo.reduce((a, m) => a + m[col], 0) / tramo.length) : null;
}

// Histéresis: una alerta en curso sigue hasta bajar 3 puntos del umbral (sin eso, en el borde avisaba cada minuto).
function evaluarAlerta(hist, ahora, antes) {
  const u = hist[hist.length - 1];
  if (antes && u && u[antes.tipo === 'ram' ? 2 : 1] >= UMBRAL[antes.tipo] - 3) return Object.assign({}, antes, { valor: u[antes.tipo === 'ram' ? 2 : 1], nivel: u[antes.tipo === 'ram' ? 2 : 1] >= UMBRAL.critico ? 'critico' : 'alto' });
  const ram = sostenida(hist, ahora, 2, UMBRAL.ram, UMBRAL.ramSeg);
  if (ram != null) return { tipo: 'ram', valor: ram, nivel: ram >= UMBRAL.critico ? 'critico' : 'alto' };
  const cpu = sostenida(hist, ahora, 1, UMBRAL.cpu, UMBRAL.cpuSeg);
  if (cpu != null) return { tipo: 'cpu', valor: cpu, nivel: cpu >= UMBRAL.critico ? 'critico' : 'alto' };
  return null;
}

// Promedio de CPU del equipo en los últimos «seg» segundos (lo usan las reglas: «el PC está saturado»).
function cpuMedia(seg) {
  const desde = Date.now() - seg * 1000;
  const tramo = historia.filter((m) => m[0] >= desde);
  return tramo.length ? tramo.reduce((a, m) => a + m[1], 0) / tramo.length : 0;
}

function totales() {
  const u = historia[historia.length - 1];
  return {
    cpu: u ? u[1] : null, ram: u ? u[2] : Math.round((100 * (os.totalmem() - os.freemem())) / os.totalmem()),
    ramUsadaGB: (os.totalmem() - os.freemem()) / 2 ** 30, ramTotalGB: os.totalmem() / 2 ** 30, nucleos: os.cpus().length,
    gpu, historiaGpu: historiaGpu.slice(), historia: historia.slice(), alerta, umbral: UMBRAL
  };
}

// ── El PowerShell que lee procesos ──
// «p»: [pid, nombre, bytes en memoria, sesión de Windows, ms de CPU (-1 si no se puede leer)] de todos.
// «a»: [pid, padre, inicio (ms desde 1601: un FILETIME entero no cabe exacto en un número de JavaScript), línea de comando
// solo de los de trabajo] de Win32_Process, más caro: se pide poco.
// «u <pid>»: lo mismo que «a» para uno solo (verificar antes de actuar).
// «c <sessionId>,…»: lo que cuelga de esas sesiones y gasta CPU ahora (0,3 núcleos o más en 1,5 s): un cálculo vivo.
// «k <raíz> <conservar>»: cierra lo que cuelga de la raíz y después la raíz, en la misma orden (reparación del 03-11-2026:
// antes la raíz la cerraba la terminal a los 8 s aunque «k» no hubiera llegado, y un «k» tardío caía sobre la sesión
// reabierta). La raíz es el claude.exe de una sesión (--session-id o --resume con su UUID exacto) o un proceso «pid:inicio».
// Nunca cierra un protegido (Windows o una aplicación de quien usa el PC) ni lo que cuelga de él; «conservar» es «-»,
// «ocupados» (lo que gasta CPU) o una lista «pid:inicio,…»: eso, lo que cuelga de eso y sus padres hasta la raíz quedan vivos.
// El árbol se arma con ParentProcessId, que Windows conserva aunque el padre ya haya muerto; un hijo más viejo que su
// «padre» es de otro proceso que heredó el número y no se toca. Antes de cerrar se vuelve a mirar la hora de inicio.
const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$yo = [Diagnostics.Process]::GetCurrentProcess().SessionId
function esc([string]$t) { if (-not $t) { return '' }; if ($t.Length -gt 400) { $t = $t.Substring(0, 400) }; return ($t -replace '[\x00-\x1f]', ' ').Replace('\', '\\').Replace('"', '\"') }
function fila($w) {
  $f = 0; if ($w.CreationDate) { $f = [long]($w.CreationDate.ToFileTimeUtc() / 10000) }
  $c = ''; if ($w.Name -match '^(claude|python|pythonw|py|node|cplex|oplrun|java|javaw|rscript|julia|cmd|powershell|pwsh|bash)\.exe$') { $c = esc $w.CommandLine }
  return '[' + $w.ProcessId + ',' + $w.ParentProcessId + ',' + $f + ',"' + $c + '"]'
}
$PROT = '^(?:__PROTEGIDOS__)$'
function protegido($w) { return (($w.Name -replace '\.exe$', '') -match $PROT) -and -not ($w.CommandLine -match '--headless') }
function ms($w) { if ($w.CreationDate) { return [long]($w.CreationDate.ToFileTimeUtc() / 10000) }; return 0 }
function todos { return @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine, CreationDate) }
function arbol([string]$q, $todos) {
  $hijos = @{}
  foreach ($w in $todos) { $k = [string]$w.ParentProcessId; if (-not $hijos.ContainsKey($k)) { $hijos[$k] = New-Object Collections.ArrayList }; [void]$hijos[$k].Add($w) }
  if ($q -match '^(\d+):(\d+)$') { $p = [int]$matches[1]; $i = [long]$matches[2]; $raices = @($todos | Where-Object { $_.ProcessId -eq $p -and (ms $_) -eq $i -and -not (protegido $_) }) }
  else { $re = '--(session-id|resume)[ =]"?' + [regex]::Escape($q) + '(?=[" ]|$)'; $raices = @($todos | Where-Object { $_.Name -eq 'claude.exe' -and $_.CommandLine -match $re }) }
  $cola = New-Object Collections.Queue; foreach ($r in $raices) { $cola.Enqueue($r) }
  $desc = New-Object Collections.ArrayList
  while ($cola.Count) {
    $x = $cola.Dequeue()
    foreach ($h in @($hijos[[string]$x.ProcessId])) { if ($h -and $h.ProcessId -ne $x.ProcessId -and (-not $x.CreationDate -or -not $h.CreationDate -or $h.CreationDate -ge $x.CreationDate) -and -not (protegido $h)) { [void]$desc.Add($h); $cola.Enqueue($h) } }
  }
  return @{ raices = $raices; desc = $desc }
}
function ocupados($lista) {
  $a = @{}; foreach ($w in $lista) { try { $a[[string]$w.ProcessId] = (Get-Process -Id $w.ProcessId -ErrorAction Stop).TotalProcessorTime.TotalMilliseconds } catch { } }
  $reloj = [Diagnostics.Stopwatch]::StartNew(); Start-Sleep -Milliseconds 1500
  $r = New-Object Collections.ArrayList
  foreach ($w in $lista) { $k = [string]$w.ProcessId; if (-not $a.ContainsKey($k)) { continue }; try { $n = ((Get-Process -Id $w.ProcessId -ErrorAction Stop).TotalProcessorTime.TotalMilliseconds - $a[$k]) / $reloj.ElapsedMilliseconds; if ($n -ge 0.3) { [void]$r.Add(@($w, $n)) } } catch { } }
  return ,$r
}
# Nombre y memoria dedicada de cada adaptador, por su LUID (el mismo que lleva el nombre de los contadores de GPU).
$adap = @{}
function nombresGpu {
  $r = @{}
  foreach ($d in (Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\DirectX')) {
    $p = Get-ItemProperty $d.PSPath
    if ($p.Description -and $p.AdapterLuid -ne $null) { $v = [long]$p.AdapterLuid; $r[('luid_0x{0:x8}_0x{1:x8}' -f ($v -shr 32), ($v -band 0xffffffff))] = @{ n = [string]$p.Description; d = [long]$p.DedicatedVideoMemory } }
  }
  return $r
}
while (($l = [Console]::In.ReadLine()) -ne $null) {
  $sb = New-Object Text.StringBuilder
  if ($l -eq 'p') {
    [void]$sb.Append('{"s":' + $yo + ',"p":[')
    $c = ''
    foreach ($p in [Diagnostics.Process]::GetProcesses()) {
      $t = -1
      if ($p.SessionId -eq $yo) { try { $t = [long]$p.TotalProcessorTime.TotalMilliseconds } catch { } }
      [void]$sb.Append($c + '[' + $p.Id + ',"' + (esc $p.ProcessName) + '",' + $p.WorkingSet64 + ',' + $p.SessionId + ',' + $t + ']')
      $c = ','
      $p.Dispose()
    }
    [void]$sb.Append(']}')
  } elseif ($l -eq 'a' -or $l.StartsWith('u ')) {
    $filtro = $null; if ($l.StartsWith('u ')) { $filtro = 'ProcessId=' + [int]$l.Substring(2) }
    [void]$sb.Append('{"a":[')
    $c = ''
    foreach ($w in (Get-CimInstance Win32_Process -Filter $filtro -Property ProcessId, ParentProcessId, CreationDate, CommandLine, Name)) { [void]$sb.Append($c + (fila $w)); $c = ',' }
    [void]$sb.Append(']}')
  } elseif ($l.StartsWith('c ')) {
    $t = todos; $de = @{}; $lista = New-Object Collections.ArrayList
    foreach ($id in $l.Substring(2).Split(',')) { foreach ($w in (arbol $id $t).desc) { $de[[string]$w.ProcessId] = $id; [void]$lista.Add($w) } }
    [void]$sb.Append('{"c":[')
    $c = ''
    foreach ($o in (ocupados $lista)) { $w = $o[0]; [void]$sb.Append($c + '["' + $de[[string]$w.ProcessId] + '",' + $w.ProcessId + ',' + (ms $w) + ',"' + (esc $w.Name) + '",' + ([math]::Round($o[1], 2)).ToString([Globalization.CultureInfo]::InvariantCulture) + ']'); $c = ',' }
    [void]$sb.Append(']}')
  } elseif ($l -eq 'g') {
    $pct = @{}; $m = @{}; $ded = @{}; $sh = @{}
    foreach ($e in (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Property Name, UtilizationPercentage)) {
      if ($e.Name -match '(luid_0x[0-9a-f]+_0x[0-9a-f]+)_.*engtype_(3D|Compute|Copy|VideoDecode|VideoEncode)$') { $k = $matches[1].ToLower(); $m[$k + '|' + $matches[2]] += [double]$e.UtilizationPercentage; if (-not $pct.ContainsKey($k)) { $pct[$k] = 0 } }
    }
    foreach ($kk in @($m.Keys)) { $k = $kk.Split('|')[0]; if ($m[$kk] -gt $pct[$k]) { $pct[$k] = $m[$kk] } }
    foreach ($a in (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -Property Name, DedicatedUsage, SharedUsage)) {
      if ($a.Name -match '(luid_0x[0-9a-f]+_0x[0-9a-f]+)_phys') { $k = $matches[1].ToLower(); $ded[$k] += [double]$a.DedicatedUsage; $sh[$k] += [double]$a.SharedUsage }
    }
    if ($pct.Keys | Where-Object { -not $adap.ContainsKey($_) }) { $adap = nombresGpu }
    $c = ''; $r = ''
    foreach ($k in ($pct.Keys | Sort-Object)) {
      $a = $adap[$k]; if (-not $a -or $a.n -match 'Basic Render') { continue }
      $dedicada = $a.d -ge 1GB
      $mem = $sh[$k]; if ($dedicada) { $mem = $ded[$k] }
      $r += $c + '["' + (esc $a.n) + '",' + [math]::Round([math]::Min($pct[$k], 100)) + ',' + [long]$mem + ',"' + $(if ($dedicada) { 'dedicada' } else { 'integrada' }) + '"]'; $c = ','
    }
    if ($r) { [void]$sb.Append('{"g":[' + $r + ']}') } else { [void]$sb.Append('{"g":null}') }
  } elseif ($l.StartsWith('k ')) {
    $partes = $l.Substring(2).Split(' ')
    $t = arbol $partes[0] (todos)
    $guardar = @{}
    if ($partes[1] -eq 'ocupados') { foreach ($o in (ocupados $t.desc)) { $guardar[[string]$o[0].ProcessId + ':' + (ms $o[0])] = 1 } }
    elseif ($partes[1] -and $partes[1] -ne '-') { foreach ($x in $partes[1].Split(',')) { $guardar[$x] = 1 } }
    $porPid = @{}; foreach ($w in $t.desc) { $porPid[[string]$w.ProcessId] = $w }
    $sub = @{}
    foreach ($w in $t.desc) { $k = [string]$w.ProcessId; if ($sub.ContainsKey([string]$w.ParentProcessId) -or $guardar.ContainsKey($k + ':' + (ms $w))) { $sub[$k] = 1 } }
    $quedan = $sub.Clone()
    foreach ($k in @($sub.Keys)) { $x = $porPid[[string]$porPid[$k].ParentProcessId]; while ($x -and -not $quedan.ContainsKey([string]$x.ProcessId)) { $quedan[[string]$x.ProcessId] = 1; $x = $porPid[[string]$x.ParentProcessId] } }
    $n = 0; $nombres = ''; $vivos = ''
    foreach ($x in (@($t.desc) + @($t.raices))) {
      if ($quedan.ContainsKey([string]$x.ProcessId)) { $vivos += ' ' + $x.Name; continue }
      try { $g = Get-Process -Id $x.ProcessId -ErrorAction Stop; if ($x.CreationDate -and [math]::Abs(($g.StartTime - $x.CreationDate).TotalSeconds) -gt 1) { continue }; $g.Kill(); $n++; $nombres += ' ' + $x.Name } catch { }
    }
    [void]$sb.Append('{"raices":' + $t.raices.Count + ',"cerrados":' + $n + ',"nombres":"' + (esc $nombres.Trim()) + '","quedan":"' + (esc $vivos.Trim()) + '"}')
  } else { [void]$sb.Append('{}') }
  [Console]::Out.WriteLine($sb.ToString())
  [Console]::Out.Flush()
}
`;

let ps = null, cola = Promise.resolve(), esperando = null, fallar = null, resto = '', relojOcioso = null;
const enCola = new Map();      // «p» y «a» que esperan turno: una sola de cada una (si PowerShell se atasca, la cola no crece)

function arrancarPs() {
  ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(SCRIPT.replace('__PROTEGIDOS__', PROTEGIDO_RE), 'utf16le').toString('base64')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (c) => {
    resto += c;
    let i;
    while ((i = resto.indexOf('\n')) >= 0) {
      const linea = resto.slice(0, i).trim();
      resto = resto.slice(i + 1);
      if (linea && esperando) esperando(linea);
    }
  });
  const yo = ps;
  // Si el PowerShell muere o no arranca, la pregunta pendiente falla al tiro (antes esperaba sus 20 s).
  const caer = (e) => { if (ps !== yo) return; ps = null; resto = ''; if (fallar) fallar(e); };
  ps.on('exit', () => caer(new Error('el lector de procesos se cerró')));
  ps.on('error', (e) => caer(new Error('el lector de procesos no arrancó: ' + e.message)));
  ps.stdin.on('error', () => { /* lo informa «exit» o «error» */ });
}

function pararPs() { clearTimeout(relojOcioso); if (ps) { try { ps.kill(); } catch (e) { /* ya cerró */ } ps = null; resto = ''; } }

// Una pregunta a la vez; sin preguntas por 2 min, el PowerShell se cierra (no ocupa memoria si nadie mira).
// «senal» (la usa «k»): si al llegar su turno ya está cancelada, no se envía; si empezó, queda marcada.
function pedirPs(orden, senal) {
  // macOS: las mismas órdenes y el mismo JSON, leídos con ps (procesos-unix.js). Sin proceso vivo que cuidar.
  if (process.platform !== 'win32') return require('./procesos-unix').pedir(orden, senal);
  if (enCola.has(orden)) return enCola.get(orden);
  const tarea = cola.then(() => new Promise((ok, mal) => {
    enCola.delete(orden);
    if (senal && senal.cancelada) { mal(new Error('cancelada antes de empezar')); return; }
    if (senal) senal.empezo = true;
    if (!ps) arrancarPs();
    clearTimeout(relojOcioso);
    const fin = () => { clearTimeout(reloj); esperando = null; fallar = null; };
    const reloj = setTimeout(() => { fin(); pararPs(); mal(new Error('el lector de procesos no respondió')); }, 20000);
    fallar = (e) => { fin(); mal(e); };
    esperando = (linea) => {
      fin();
      relojOcioso = setTimeout(pararPs, PS_OCIOSO_MS);
      relojOcioso.unref();
      try { ok(JSON.parse(linea)); } catch (e) { mal(e); }
    };
    try { ps.stdin.write(orden + '\n'); } catch (e) { fallar(e); }
  }));
  if (orden === 'p' || orden === 'a') enCola.set(orden, tarea);
  cola = tarea.catch(() => {});
  return tarea;
}

// ── La foto de procesos ──
const padres = new Map();      // pid → { ppid, inicio, cmd }, de la última lectura de Win32_Process
let padresEn = 0;
const cpuAntes = new Map();    // pid → { ms, t }
const tramos = new Map();      // pid → [[t, núcleos], …] de los últimos 60 s
let sesionWin = null;

async function leerPadres() {
  const r = await pedirPs('a');
  padres.clear();
  for (const [pid, ppid, inicio, cmd] of r.a || []) padres.set(pid, { ppid, inicio, cmd });
  padresEn = Date.now();
}

async function foto() {
  const r = await pedirPs('p');
  const t0 = process.cpuUsage();
  sesionWin = r.s;
  const ahora = Date.now();
  if ((r.p || []).some(([pid]) => !padres.has(pid)) && ahora - padresEn >= PADRES_CADA_MS) await leerPadres();
  const vistos = new Set();
  const lista = (r.p || []).map(([pid, nombre, bytes, sesion, ms]) => {
    vistos.add(pid);
    const a = cpuAntes.get(pid);
    const nucleos = ms >= 0 && a && ahora > a.t && ms >= a.ms ? (ms - a.ms) / (ahora - a.t) : null;
    if (ms >= 0) cpuAntes.set(pid, { ms, t: ahora });
    if (nucleos != null) {
      const tr = tramos.get(pid) || [];
      tr.push([a.t, ahora, nucleos]);
      while (tr.length && tr[0][1] < ahora - 60000) tr.shift();
      tramos.set(pid, tr);
    }
    const pa = padres.get(pid);
    const m = media(tramos.get(pid), ahora, 30000);
    return { pid, nombre, mb: bytes / 2 ** 20, sesionWin: sesion, cpuMs: ms, nucleos, media30: m.nucleos, cubre30: m.cubre,
      ppid: pa ? pa.ppid : undefined, inicio: pa ? pa.inicio : undefined, cmd: pa ? pa.cmd : '' };
  });
  for (const pid of cpuAntes.keys()) if (!vistos.has(pid)) { cpuAntes.delete(pid); tramos.delete(pid); }
  gastoPrincipal(t0);
  return { ahora, sesionWin, procesos: lista };
}

// Núcleos en promedio de los últimos «ms», ponderado por tiempo, y cuántos segundos cubre de verdad.
function media(tr, ahora, ms) {
  const x = (tr || []).filter((m) => m[1] > ahora - ms);
  if (!x.length) return { nucleos: null, cubre: 0 };
  let peso = 0, suma = 0;
  for (const [desde, hasta, n] of x) { peso += hasta - desde; suma += n * (hasta - desde); }
  return { nucleos: peso ? suma / peso : null, cubre: Math.round((ahora - x[0][0]) / 1000) };
}

// ── Agrupar y atribuir (sin tocar el sistema) ──
// ctx: { sesionWin, propios: [pids de Chocosys], sesiones: [{ id, nombre, sessionId, estado, cambio, viva, espacio }], recuerdo: Map }
// La terminal de una sesión es el claude.exe cuya línea de comando lleva su sessionId (--session-id o --resume): exacto,
// sirve con un dueño de terminales viejo y tras reiniciar Chocosys (el pid que informa node-pty con ConPTY llega en 0).
// recuerdo: «pid:inicio» → { id, nombre } de cada proceso que se vio colgando de una sesión (sobrevive a que la sesión se cierre).
const clave = (p) => (p.inicio ? p.pid + ':' + p.inicio : null);

function agrupar(procesos, ctx) {
  const t0 = process.cpuUsage();
  const porPid = new Map(procesos.map((p) => [p.pid, p]));
  const hijos = new Map();
  for (const p of procesos) {
    p.huerfano = false;
    if (p.ppid === undefined || p.ppid === 0 || p.pid <= 4) continue;
    const padre = porPid.get(p.ppid);
    // Un padre que nació después que el hijo es otro proceso con el mismo número: el verdadero ya no existe.
    if (!padre || (padre.inicio && p.inicio && padre.inicio > p.inicio)) { p.huerfano = true; continue; }
    if (!hijos.has(padre.pid)) hijos.set(padre.pid, []);
    hijos.get(padre.pid).push(p);
  }
  const colgar = (raiz, marca) => {
    const pila = [raiz];
    while (pila.length) {
      const x = pila.pop();
      if (x.de) continue;
      x.de = marca;
      for (const h of hijos.get(x.pid) || []) pila.push(h);
    }
  };
  for (const p of procesos) { delete p.de; delete p.raizDe; delete p.recordado; }
  const sesiones = new Map((ctx.sesiones || []).map((s) => [s.id, s]));
  const claudes = procesos.filter((p) => /^claude$/i.test(p.nombre) && p.cmd);
  for (const s of sesiones.values()) {
    if (!s.sessionId) continue;
    for (const raiz of claudes.filter((p) => p.cmd.includes(s.sessionId))) { raiz.raizDe = s.id; colgar(raiz, { sesion: s.id }); }
  }
  for (const pid of ctx.propios || []) { const p = porPid.get(pid); if (p) colgar(p, { chocosys: true }); }
  for (const p of procesos) {
    const k = clave(p);
    if (!k) continue;
    if (p.de && p.de.sesion) { const s = sesiones.get(p.de.sesion); ctx.recuerdo.set(k, { id: s.id, nombre: s.nombre }); }
    else if (!p.de && ctx.recuerdo.has(k)) p.recordado = ctx.recuerdo.get(k);
  }
  // El recuerdo no crece sin fin: se quedan solo los procesos que siguen vivos.
  const vivos = new Set(procesos.map(clave).filter(Boolean));
  for (const k of ctx.recuerdo.keys()) if (!vivos.has(k)) ctx.recuerdo.delete(k);

  const grupos = new Map();
  const grupo = (id, base) => { if (!grupos.has(id)) grupos.set(id, Object.assign({ id, mb: 0, nucleos: 0, n: 0, procesos: [] }, base)); return grupos.get(id); };
  for (const p of procesos) {
    if (p.sesionWin !== ctx.sesionWin) continue;
    let g;
    if (p.de && p.de.sesion) {
      const s = sesiones.get(p.de.sesion);
      g = grupo('s:' + s.id, { tipo: 'sesion', nombre: s.nombre, sesion: s.id, estado: s.estado, cambio: s.cambio, espacio: s.espacio });
    } else if (p.de && p.de.chocosys) g = grupo('chocosys', { tipo: 'chocosys', nombre: 'Chocosys' });
    else if (p.recordado) {
      const s = sesiones.get(p.recordado.id);
      g = grupo('c:' + p.recordado.id, { tipo: 'cerrada', nombre: p.recordado.nombre, sesion: p.recordado.id, viva: !!(s && s.viva) });
    } else { const n = programa(p.nombre); g = grupo('p:' + n, { tipo: 'programa', nombre: n }); }
    g.mb += p.mb;
    g.nucleos += p.media30 != null ? p.media30 : p.nucleos || 0;
    g.n++;
    g.procesos.push(p);
  }
  gastoPrincipal(t0);
  return [...grupos.values()].map((g) => Object.assign(g, { procesos: g.procesos.sort((a, b) => (b.nucleos || 0) - (a.nucleos || 0) || b.mb - a.mb) }));
}

const PROGRAMAS = [[/^chrome$/i, 'Chrome'], [/^msedge/i, 'Edge'], [/^python|^py$/i, 'Python'], [/^node$/i, 'node'], [/^(cplex|oplrun)/i, 'CPLEX'],
  [/^(winword|excel|powerpnt|outlook|olk|onenote)$/i, 'Office'], [/^(ms-)?teams$/i, 'Teams'], [/^code$/i, 'VS Code'], [/^claude$/i, 'Claude Code fuera de esta Chocosys'],
  [/^(svchost|csrss|dwm|lsass|services|wininit|winlogon|smss|system|registry|idle|memcompression|fontdrvhost|sihost|ctfmon|runtimebroker|searchhost|startmenuexperiencehost|textinputhost|shellexperiencehost|explorer|msmpeng|nissrv|securityhealthservice|audiodg|conhost|dllhost|taskhostw|wmiprvse|spoolsv|lsaiso)$/i, 'Windows']];
// Lo que no es un programa conocido va con su propio nombre (Notion, OneDrive…): un «Otros» de 4 GB no dice qué cerrar.
function programa(nombre) { for (const [re, n] of PROGRAMAS) if (re.test(nombre)) return n; return nombre; }

// Lo que gasta el propio monitor, en % del equipo: el PowerShell (su tiempo de CPU, leído en la misma foto) y lo que el
// proceso principal pasa ordenando la foto y los totales (medido alrededor de esas funciones, no todo el proceso).
let principalMs = 0, propioAntes = null, costo = null;
function gastoPrincipal(t0) { const d = process.cpuUsage(t0); principalMs += (d.user + d.system) / 1000; }
function costoPropio(procesos) {
  const ahora = Date.now();
  const yo = ps && procesos.find((p) => p.pid === ps.pid);
  const psMs = yo && yo.cpuMs > 0 ? yo.cpuMs : 0;
  if (propioAntes && propioAntes.psPid === (ps && ps.pid) && ahora - propioAntes.t >= 20000) {
    const ventana = (ahora - propioAntes.t) * os.cpus().length;
    costo = { ps: (100 * (psMs - propioAntes.psMs)) / ventana, principal: (100 * (principalMs - propioAntes.principalMs)) / ventana, segundos: Math.round((ahora - propioAntes.t) / 1000) };
  }
  if (!propioAntes || propioAntes.psPid !== (ps && ps.pid) || ahora - propioAntes.t >= 60000) propioAntes = { t: ahora, psMs, principalMs, psPid: ps && ps.pid };
  return costo;
}

// ── Lo protegido: el PowerShell nunca cierra esto (ni lo que cuelga de ello) al cerrar el árbol de una sesión ──
// Windows y lo que lo sostiene: nunca se toca, aunque pese.
const SISTEMA = new Set(['system', 'idle', 'registry', 'memcompression', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'lsaiso', 'svchost',
  'dwm', 'fontdrvhost', 'sihost', 'ctfmon', 'explorer', 'taskhostw', 'runtimebroker', 'searchhost', 'searchindexer', 'startmenuexperiencehost',
  'shellexperiencehost', 'textinputhost', 'msmpeng', 'nissrv', 'securityhealthservice', 'securityhealthsystray', 'audiodg', 'conhost', 'dllhost',
  'wmiprvse', 'spoolsv', 'openconsole', 'applicationframehost', 'systemsettings', 'lockapp', 'useroobebroker', 'widgets', 'phoneexperiencehost']);
// Aplicaciones de quien usa el PC (D11, 03-11-2026): aunque las haya lanzado una sesión, nunca se cierran ni se tocan,
// ni lo que cuelga de ellas. Un navegador con --headless (el de una prueba automática) no cuenta.
const APLICACIONES = ['excel', 'winword', 'powerpnt', 'outlook', 'olk', 'onenote', 'msaccess', 'mspub', 'visio', 'winproj', 'teams', 'ms-teams',
  'chrome', 'msedge', 'firefox', 'brave', 'opera', 'iexplore', 'msedgewebview2', 'obsidian', 'code', 'notion', 'notepad', 'mspaint', 'photos',
  'snippingtool', 'acrobat', 'acrord32', 'onedrive', 'spotify', 'whatsapp', 'slack', 'discord', 'zoom', 'effectcraft', 'sldworks', 'acad',
  'taskmgr', 'mstsc', 'winrar', '7zfm'];
const PROTEGIDO_RE = [...SISTEMA, ...APLICACIONES].join('|');
// ── Ajustes ──
// d.umbral (03-11-2026): «recursos» de perfil.json; umbral_ram y umbral_cpu enteros de 50 a 95, otro valor deja el de fábrica.
function configurar(d) {
  const u = d.umbral || {}, vale = (v) => Number.isInteger(v) && v >= 50 && v <= 95;
  if (vale(u.umbral_ram)) UMBRAL.ram = u.umbral_ram;
  if (vale(u.umbral_cpu)) UMBRAL.cpu = u.umbral_cpu;
}

// Cerrar una sesión cierra su árbol y su claude.exe (pedido de quien usa la app, 02-11-2026; protegidos y «conservar» desde el
// 03-11-2026): sin esto, matar claude.exe dejaba vivos sus servidores MCP y lo que había lanzado, como huérfanos.
// conservar: 'ocupados' (deja vivo lo que gasta CPU), [] (corta todo) o [{ pid, inicio }]. Solo números y UUID llegan a PowerShell.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function cerrarArbol(sessionId, conservar = 'ocupados', senal) {
  if (!UUID.test(String(sessionId || ''))) return Promise.resolve({ raices: 0, cerrados: 0, nombres: '', quedan: '' });
  const lista = conservar === 'ocupados' ? 'ocupados' : (conservar || []).filter((p) => Number.isFinite(+p.pid) && Number.isFinite(+p.inicio)).map((p) => Math.trunc(p.pid) + ':' + Math.trunc(p.inicio)).join(',') || '-';
  return pedirPs('k ' + sessionId + ' ' + lista, senal);
}
// Cálculo vivo de cada sesión: Map sessionId → [{ pid, inicio, nombre, nucleos }] (solo las que tienen algo).
async function calculoVivo(sessionIds) {
  const ids = [...new Set(sessionIds)].filter((x) => UUID.test(String(x || '')));
  const m = new Map();
  if (!ids.length) return m;
  for (const [id, pid, inicio, nombre, nucleos] of (await pedirPs('c ' + ids.join(','))).c || []) { if (!m.has(id)) m.set(id, []); m.get(id).push({ pid, inicio, nombre, nucleos }); }
  return m;
}

module.exports = { APLICACIONES, UUID, medirTotales, totales, cpuMedia, foto, agrupar, costoPropio, configurar, cerrarArbol, calculoVivo, pidPs: () => (ps ? ps.pid : 0), parar: pararPs };
