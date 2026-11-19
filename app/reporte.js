// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';
// Reporte de fallos (13-11-2026). Arma un texto con formato fijo y le tacha lo que identifica a alguien o abre algo
// (rutas, usuario y equipo, correos, RUT, teléfonos, claves). No envía nada: lo guarda y lo manda la persona, a mano.
const os = require('os');

const escapar = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function tachar(texto, quien = {}) {
  const usuario = quien.usuario ?? os.userInfo().username;
  const equipo = quien.equipo ?? os.hostname();
  let t = String(texto)
    // Rutas de Windows y de Git Bash enteras: el nombre de una carpeta también puede nombrar a un cliente.
    // Tras un espacio la ruta sigue si la palabra siguiente trae otro separador («Cliente Uno\x.md»).
    // La unidad no va pegada a otra letra: si no, el «s:/» de «https://» se tomaba por ruta y la URL se perdía.
    .replace(/(?<![A-Za-z])[A-Za-z]:[\\/](?:[^\s"'<>|*?]|\s(?=[^\s"'<>|]*[\\/]))*/g, '<ruta>')
    .replace(/(^|[\s"'(=])\/[a-z]\/(?:[^\s"'<>|]|\s(?=[^\s"'<>|]*\/))*/gim, '$1<ruta>')
    // macOS y Linux (17-11-2026): las carpetas de usuario, volúmenes y temporales, enteras y con la misma regla de espacios.
    .replace(/(^|[\s"'(=])(?:\/(?:Users|home|Volumes|private|var\/folders)\/|~\/)(?:[^\s"'<>|]|\s(?=[^\s"'<>|]*\/))*/gm, '$1<ruta>')
    .replace(/\\\\[^\s"'<>|]+/g, '<ruta>')
    .replace(/%[A-Z]+%[\\/][^\s"'<>|]*/gi, '<ruta>')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<correo>')
    .replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, '<rut>')
    .replace(/(\+?56)?[\s-]?9[\s-]?\d{4}[\s-]?\d{4}\b/g, '<teléfono>')
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, '<clave>')
    .replace(/\b(ghp|gho|ghu|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{10,}/g, '<clave>')
    // Solo con «:» o «=» tras la palabra: «la contraseña nunca se guarda» es prosa y queda como está.
    .replace(/\b(token|clave|password|contraseña|secret|api[_-]?key|authorization)(["'\s]*[:=]["'\s]*)(bearer\s+)?[^\s"',;]{4,}/gi, '$1$2<clave>')
    .replace(/\b[a-f0-9]{24,}\b/gi, '<clave>')
    .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, '<clave>');
  // shortcut: un usuario o equipo de menos de 3 letras no se tacha (taparía letras sueltas); si molesta, tachar a mano en la vista previa.
  for (const [nombre, por] of [[usuario, '<usuario>'], [equipo, '<equipo>']]) {
    // Límites con \p{L} y no \b: \b no ve las letras con tilde, y el usuario «ana» se tachaba dentro de «mañana».
    if (nombre && String(nombre).length >= 3) t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escapar(nombre)}(?![\\p{L}\\p{N}_])`, 'giu'), por);
  }
  return t;
}

const hoy = () => { const d = new Date(); return [d.getDate(), d.getMonth() + 1].map((n) => String(n).padStart(2, '0')).join('-') + '-' + d.getFullYear(); };

// El mismo formato que la plantilla de issue «Reporte de fallo» del repositorio.
function armar(d) {
  const bloque = (titulo, texto) => `## ${titulo}\n\n${String(texto || '').trim() || '(sin escribir)'}\n`;
  return tachar([
    `# Reporte de fallo · Chocosys ${d.version}`,
    '',
    `- Fecha: ${hoy()}`,
    `- Versión: Chocosys ${d.version} · Electron ${d.electron} · ${d.sistema || 'Windows ' + d.windows}`,
    `- Capturas: ${d.capturas ? d.capturas + ' (captura-1.png)' : 'ninguna'}`,
    '',
    bloque('Qué pasó', d.paso),
    bloque('Qué esperabas', d.esperaba),
    bloque('Pasos para repetirlo', d.pasos),
    d.registro ? `## Registro (últimas líneas, tachado)\n\n\`\`\`\n${d.registro}\n\`\`\`\n` : '## Registro\n\n(no incluido)\n'
  ].join('\n'), d.quien);
}

module.exports = { tachar, armar };
