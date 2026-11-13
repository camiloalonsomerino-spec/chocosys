// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';

// Elige modelo y esfuerzo para una orden de la barra de comando, al instante y sin IA (sprint 15, L1).
// Aplica las reglas de la skill clasificar-complejidad (O1 a O7 mandan a Opus; Haiku solo si cumple H1 a H4) sobre el
// texto, los casos ya decididos de esa skill, la pestaña donde se lanza y las correcciones de quien usa la app: si cambió el modelo
// de una orden parecida en la misma pestaña, se sugiere lo que eligió. Ante la duda, Opus xhigh; nunca Fable.

const REGLAS_O = [
  ['O1', /\b(env[ií]a\w*|manda\w*|correo|mail|public\w+|emit\w+|correlativo|orden(es)? de compra|OC\b|pag[ao]\w*|borr\w+|elimin\w+|firm[ae]\w*)/i, 'deja algo que no se deshace'],
  ['O2', /\b(cotiz\w*|cost(o|ea|ear)\w*|presupuesto|precio\w*|calcul\w*|nota (final|del)|monto\w*|margen|recargo|cifra\w*|flujo de caja|VAN\b|TIR\b|UF\b|USD\b|pesos)|\$\s?\d|\d+\s?%/i, 'produce o decide cifras que alguien va a usar'],
  ['O3', /\b(audit\w*|revis\w*|verific\w*|control(a|ar|en)\b|chequ\w+|corrig\w*)/i, 'revisa o verifica el trabajo de otro'],
  ['O4', /\b(compar\w*|decid\w*|elig\w*|eleg\w*|diseñ\w*|prop[oó]n\w*|redact\w*|carta|informe|analiz\w*|evalu\w*|interpret\w*|plano|norma|estrategia|recomiend\w*|opin\w*|qu[eé] conviene|escrib\w* (a|al|para) (un|una|el|la|los|las)? ?(cliente|proveedor|profe\w*|socio|jefe|equipo))/i, 'pide juicio: comparar, decidir, diseñar o escribir para un tercero'],
  ['O5', /\b(c[oó]digo|script\w*|program\w*|funci[oó]n|bug|depur\w*|implement\w*|refactor\w*|javascript|python|sql|html|css|electron|chocosys|sprint)\b/i, 'escribe o depura código'],
  ['O7', /\b(tod[oa]s? (los|las) (archivos|documentos|carpetas|correos|cotizaciones)|carpeta completa|el proyecto completo|de punta a punta|investig\w*|recopil\w*|busca\w* en (internet|la web|la red)|lee todo)/i, 'necesita leer mucho']
];
const MECANICA = /\b(renombr\w*|muev\w*|mover|list(a|ar)\b|convert\w*|copi(a|ar)\b|resum\w* (este|el|ese) archivo|extra\w* con|clasific\w* (las )?cotizaciones|transcrib\w*|cuent(a|ar) (los|las)|formate\w*|ordena (los|las) archivos)/i;
const CONCRETA = /\.[a-z0-9]{2,4}\b|[a-z]:\\|\/|«[^»]+»|"[^"]+"|\bcarpeta\b/i;
const VARIAS = /\b(tod[oa]s|cada|varios|varias|y luego|despu[eé]s)\b/i;
const AMBIGUA = /^(arregla|ve|mira|haz|revisa)\s+(lo|eso|esto)\b|\blo (de|que hablamos)\b/i;
const ACOTADO = /\b(r[uú]brica|seg[uú]n (la|el) (regla|criterio|formato)|con el criterio)\b/i;
const CASOS = [
  [/^orquest\w*\b/i, 'opus', 'xhigh', 'O4', 'la coordinadora reparte y decide']
];
// Palabras de O2 y O4 que pueden ser solo el nombre de lo que se mueve o se ordena, no lo que se pide hacer.
const SOLO_OBJETO = ['O2', 'O4'];
const OBJETOS = /^(cotizaci[oó]n(es)?|informes?|cartas?|planos?|normas?|presupuestos?)$/i;
function soloNombraObjeto(texto, patron) {
  const todas = [...texto.matchAll(new RegExp(patron.source, patron.flags.replace('g', '') + 'g'))].map((m) => m[0].trim());
  return todas.length > 0 && todas.every((p) => OBJETOS.test(p));
}
const VACIAS = new Set('para como esta este esto esos esas sobre desde hasta entre donde cuando porque pero tambien muy todo todos todas cada hace haces quiero puedes favor'.split(' '));

// Las reglas se comparan contra la orden sin tildes (la ñ se queda): `\w` sin la bandera `u` no toma «á», y
// «compáralas» o «calcúlales» se escapaban de O2 y O4 (verificación de D, 22-10-2026, T-A102).
const sinTildes = (texto) => String(texto).normalize('NFD').replace(/[nN]̃/g, (m) => m.normalize('NFC')).replace(/[̀-ͯ]/g, '');
// La palabra que disparó la regla, tal como quien usa la app la escribió (sin tildes mide lo mismo si llegó en NFC).
function palabraDe(t, s, patron) {
  const m = s.match(patron);
  if (!m) return '';
  return s.length === t.length ? t.substr(m.index, m[0].length) : m[0];
}

const palabras = (texto) => new Set(String(texto).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9ñ]+/).filter((p) => p.length >= 4 && !VACIAS.has(p)));
function parecido(a, b) {
  let comun = 0;
  for (const p of a) if (b.has(p)) comun++;
  return comun / Math.max(1, a.size + b.size - comun);
}

// texto: la orden. contexto: { espacio: nombre de la pestaña, elecciones: [{ palabras, espacio, modelo, esfuerzo, texto }] }
function elegir(texto, contexto) {
  const t = String(texto || '').trim();
  const c = contexto || {};
  // Lo que quien usa la app eligió para una orden parecida en la misma pestaña manda sobre las reglas.
  const mias = palabras(t);
  let mejor = null;
  for (const e of c.elecciones || []) {
    if (e.espacio !== c.espacio) continue;
    const p = parecido(mias, new Set(e.palabras));
    if (p >= 0.5 && (!mejor || p > mejor.p)) mejor = { p, e };
  }
  if (mejor) return { modelo: mejor.e.modelo, esfuerzo: mejor.e.esfuerzo, regla: 'tuya', motivo: `para «${mejor.e.texto}» elegiste esto en ${c.espacio}` };
  const s = sinTildes(t);
  for (const [patron, modelo, esfuerzo, regla, motivo] of CASOS) if (patron.test(s)) return { modelo, esfuerzo, regla, motivo };
  // En una orden mecánica sobre algo concreto, O2 y O4 no cuentan si solo nombran el objeto («los archivos de
  // cotizaciones», «el archivo informe.pdf»): eso no pide cifras ni juicio (verificación de D, 22-10-2026, T-A92).
  const mecanicaConcreta = MECANICA.test(s) && CONCRETA.test(s);
  const disparadas = REGLAS_O.filter(([id, patron]) => patron.test(s) && !(mecanicaConcreta && SOLO_OBJETO.includes(id) && soloNombraObjeto(s, patron)));
  // Pestañas donde una cifra o un envío llega a un cliente o un proveedor (perfil.json: pestanas_con_clientes).
  const conClientes = (c.conClientes || []).some((n) => String(n).toLowerCase() === String(c.espacio || '').toLowerCase());
  if (disparadas.length) {
    const ids = disparadas.map(([id]) => id);
    let esfuerzo = 'xhigh';
    // Auditar algo que no se deshace: max (paso 3 de la skill). Juicio con el criterio escrito: high.
    if (ids.includes('O1') && ids.includes('O3')) esfuerzo = 'max';
    else if (ACOTADO.test(s) && !ids.includes('O1')) esfuerzo = 'high';
    const [id, , motivo] = disparadas[0];
    const extra = conClientes && (ids.includes('O1') || ids.includes('O2')) ? ` (en ${c.espacio}, una cifra o un envío llega a un cliente o un proveedor)` : '';
    return { modelo: 'opus', esfuerzo, regla: ids.join('+'), motivo: motivo + extra, palabra: palabraDe(t, s, disparadas[0][1]) };
  }
  if (t.split(/\s+/).length < 4 || AMBIGUA.test(s)) return { modelo: 'opus', esfuerzo: 'xhigh', regla: 'O6', motivo: 'es corta o ambigua: le puede faltar información' };
  if (mecanicaConcreta) {
    return { modelo: 'haiku', esfuerzo: VARIAS.test(s) ? 'medium' : 'low', regla: 'H1-H4', motivo: 'es mecánica, dice sobre qué trabaja y se puede repetir sin daño', palabra: palabraDe(t, s, MECANICA) };
  }
  if (MECANICA.test(s)) return { modelo: 'opus', esfuerzo: 'xhigh', regla: 'duda', motivo: 'parece mecánica, pero no dice sobre qué archivo o carpeta (falta H4)' };
  return { modelo: 'opus', esfuerzo: 'xhigh', regla: 'duda', motivo: 'ninguna regla la deja en Haiku: ante la duda, Opus' };
}

module.exports = { elegir, palabras };
