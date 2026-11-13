// Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)
'use strict';
// Créditos (solo la primera vez y desde «Acerca de»), «Sobre mí» y «Reportar un fallo» (13-11-2026).
// Usa h() y $() de app.js. Nada de esto envía datos: el reporte se guarda y lo manda la persona.

const bApi = window.consola;

// Un diálogo con el mismo armazón que el lanzador. Devuelve una promesa que se cumple al cerrarlo.
function dialogo({ titulo, nota, cuerpo, pie }) {
  let resolver;
  const fin = new Promise((r) => { resolver = r; });
  const caja = h('div', { class: 'modal dialogo-simple' },
    h('div', { class: 'modal-fondo', onclick: () => cerrar() }),
    h('section', { class: 'modal-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
      h('header', { class: 'modal-cabeza' }, h('h1', { class: 'modal-titulo' }, titulo), nota ? h('span', { class: 'modal-nota' }, nota) : null),
      h('div', { class: 'dialogo-cuerpo' }, cuerpo),
      h('footer', { class: 'modal-pie' }, pie)));
  const alTeclear = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); cerrar(); return; }
    if (e.key !== 'Tab') return;
    // Retiene el foco: Tab no sale del diálogo a los botones de atrás; de la última vuelve a la primera y al revés.
    const f = [...caja.querySelectorAll('button:not([disabled]), input, textarea')].filter((x) => !x.closest('[hidden]'));
    const i = f.indexOf(document.activeElement);
    if (f.length && (i < 0 || (e.shiftKey ? i === 0 : i === f.length - 1))) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
  };
  function cerrar(valor) {
    document.removeEventListener('keydown', alTeclear, true);
    caja.remove();
    resolver(valor);
  }
  document.addEventListener('keydown', alTeclear, true);
  document.body.append(caja);
  (caja.querySelector('input, textarea') || caja.querySelector('.boton.principal') || caja.querySelector('button')).focus();
  return { fin, cerrar, caja };
}

const boton = (texto, onclick, clase = '') => h('button', { type: 'button', class: 'boton ' + clase, onclick }, texto);
const casilla = (texto, marcada) => {
  const input = h('input', { type: 'checkbox' });
  input.checked = !!marcada;
  return { input, el: h('label', { class: 'casilla-simple' }, input, h('span', {}, texto)) };
};
const campoTexto = (rotulo, valor, ejemplo, largo) => {
  const input = h(largo ? 'textarea' : 'input', { class: 'entrada-simple', placeholder: ejemplo, maxlength: largo ? 2000 : 300, rows: largo ? 3 : null });
  input.value = valor || '';
  return { input, el: h('label', { class: 'campo' }, h('span', { class: 'rotulo' }, rotulo), input) };
};

// ── Créditos ──
async function mostrarCreditos(primeraVez) {
  const { texto, version, instagram, enlace } = await bApi.bienvenida.creditos();
  // creditos.md: «# » es un título, una línea vacía separa párrafos y un bloque de líneas «- » es una lista.
  const bloques = texto.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean).map((p) => {
    if (p.startsWith('# ')) return h('h2', { class: 'creditos-titulo' }, p.slice(2));
    const lineas = p.split(/\r?\n/).map((l) => l.trim());
    if (lineas.every((l) => l.startsWith('- '))) return h('ul', { class: 'creditos-lista' }, lineas.map((l) => h('li', {}, l.slice(2))));
    return h('p', {}, lineas.join(' '));
  });
  // «?»: cómo escribirle al autor. El enlace va como texto para copiar: la app no abre el navegador sola.
  const conContacto = instagram && !/^\{\{/.test(instagram);
  const copiado = h('span', { class: 'modal-resumen', role: 'status' });
  const campoEnlace = h('input', { class: 'entrada-simple', readonly: true, 'aria-label': 'Enlace a Instagram, para copiar', onfocus: (e) => e.target.select() });
  campoEnlace.value = enlace || '';
  const contacto = h('div', { class: 'creditos-contacto', hidden: true },
    h('p', {}, '¿Quieres escribirme? Instagram: ', h('strong', {}, instagram)),
    h('div', { class: 'creditos-enlace' }, campoEnlace,
      boton('Copiar', () => navigator.clipboard.writeText(campoEnlace.value).then(() => { copiado.textContent = 'Enlace copiado.'; }, () => { campoEnlace.select(); copiado.textContent = 'Cópialo con Ctrl+C.'; })), copiado));
  const ayuda = conContacto ? boton('?', () => {
    contacto.hidden = !contacto.hidden;
    ayuda.setAttribute('aria-expanded', String(!contacto.hidden));
    if (!contacto.hidden) campoEnlace.focus();
  }) : null;
  if (ayuda) { ayuda.setAttribute('aria-label', 'Cómo escribirme'); ayuda.setAttribute('aria-expanded', 'false'); ayuda.title = 'Cómo escribirme'; }
  const d = dialogo({
    titulo: 'Créditos',
    nota: `Versión ${version} · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro`,
    cuerpo: [h('img', { class: 'creditos-logo', src: 'logo-c.png', alt: '' }), ...bloques, contacto,
      h('p', { class: 'creditos-licencia' }, 'Licencia PolyForm Noncommercial 1.0.0: puedes usarla, estudiarla y cambiarla sin fines comerciales.')],
    pie: [h('span', { class: 'modal-resumen' }, primeraVez ? 'Esto sale solo esta vez. Vuelve a verlo en ☰ › Acerca de.' : ''), ayuda, boton('Empezar', () => d.cerrar(), 'principal')]
  });
  await d.fin;
  if (primeraVez) await bApi.bienvenida.marcar('creditos_vistos');
}

// ── Sobre mí ──
async function mostrarSobreMi(primeraVez) {
  const s = (await bApi.bienvenida.sobreMi()) || {};
  const nombre = campoTexto('Tu nombre o apodo (opcional)', s.nombre, 'Cómo quieres que te llamen');
  const dedica = campoTexto('A qué te dedicas (opcional)', s.dedica, 'Por ejemplo: estudio, trabajo en ventas, programo');
  const quiere = campoTexto('Qué quieres hacer con Chocosys (opcional)', s.quiere, 'Por ejemplo: ordenar mis proyectos con Claude', true);
  const estado = h('span', { class: 'modal-resumen' });
  const datos = (usar) => ({ nombre: nombre.input.value, dedica: dedica.input.value, quiere: quiere.input.value, usar_en_sesiones: usar });
  const guardar = async (usar) => { await bApi.bienvenida.guardarSobreMi(datos(usar)); d.cerrar(); };
  const d = dialogo({
    titulo: 'Sobre mí',
    nota: 'Todo es opcional y lo cambias cuando quieras desde ☰ › Sobre mí.',
    cuerpo: [nombre.el, dedica.el, quiere.el,
      h('p', { class: 'dialogo-aviso' }, 'Se guarda solo en este computador (sobre-mi.json, en la carpeta de datos de Chocosys). Chocosys no lo envía a nadie. ',
        'Si eliges usarlo en tus sesiones, cada sesión nueva de Claude Code parte sabiéndolo: viaja a Claude junto con la conversación, igual que lo que escribes en la terminal.'),
      s.actualizado ? h('p', { class: 'dialogo-aviso' }, `Última vez que lo guardaste: ${s.actualizado}. Ahora ${s.usar_en_sesiones ? 'sí' : 'no'} se usa en tus sesiones.`) : null],
    pie: [estado,
      s.actualizado ? boton('Borrar lo guardado', async () => { await bApi.bienvenida.borrarSobreMi(); d.cerrar(); }, 'peligro') : null,
      boton(primeraVez ? 'Ahora no' : 'Cancelar', () => d.cerrar()),
      boton('Guardar solo aquí', () => guardar(false)),
      boton('Guardar y usar en mis sesiones', () => guardar(true))]
  });
  await d.fin;
  if (primeraVez) await bApi.bienvenida.marcar('sobre_mi_preguntado');
}

// ── Reportar un fallo ──
async function reportarFallo() {
  // La captura va antes del diálogo, para que muestre la pantalla del fallo y no el formulario.
  // Espera a que se cierre el menú (con setTimeout: requestAnimationFrame no corre con la ventana tapada).
  await new Promise((r) => setTimeout(r, 120));
  const imagen = await bApi.reporte.capturar().catch(() => null);
  const paso = campoTexto('Qué pasó', '', 'Lo que viste, con tus palabras', true);
  const esperaba = campoTexto('Qué esperabas que pasara', '', 'Lo que tendría que haber hecho la app', true);
  const pasos = campoTexto('Pasos para repetirlo', '', '1. Abrí… 2. Hice clic en… 3. Pasó…', true);
  const conCaptura = casilla('Incluir esta captura de la ventana', !!imagen);
  const conRegistro = casilla('Incluir las últimas 40 líneas del registro de diagnóstico (no trae el texto de tus sesiones)', true);
  const previa = h('textarea', { class: 'entrada-simple reporte-previa', rows: 12, 'aria-label': 'Vista previa del reporte, editable' });
  const zonaPrevia = h('div', { class: 'reporte-zona', hidden: true },
    h('span', { class: 'rotulo' }, 'Vista previa (puedes corregirla)'), previa,
    h('p', { class: 'dialogo-aviso' }, 'Chocosys ya tachó rutas, nombre de usuario y del equipo, correos, RUT, teléfonos y claves. ',
      'La captura no se tacha sola: mírala antes y quítala si muestra algo tuyo.'));
  const estado = h('span', { class: 'modal-resumen' });
  const verPrevia = boton('Ver vista previa', async () => {
    previa.value = await bApi.reporte.previa({ paso: paso.input.value, esperaba: esperaba.input.value, pasos: pasos.input.value, conCaptura: conCaptura.input.checked, conRegistro: conRegistro.input.checked });
    zonaPrevia.hidden = false;
    guardar.disabled = false;
    estado.textContent = 'Revisa el texto. Nada se envía: al guardar queda en una carpeta tuya.';
    previa.focus();
  }, 'principal');
  const guardar = boton('Guardar reporte', async () => {
    const r = await bApi.reporte.guardar(previa.value, conCaptura.input.checked);
    d.cerrar(true);
    mostrarReporteGuardado(r);
  }, 'brasa-boton');
  guardar.disabled = true;
  // Un cambio en el formulario deja vieja la vista previa: hay que volver a verla antes de guardar.
  for (const c of [paso, esperaba, pasos, conCaptura, conRegistro]) {
    c.input.addEventListener(c.input.type === 'checkbox' ? 'change' : 'input', () => {
      if (guardar.disabled) return;
      guardar.disabled = true;
      estado.textContent = 'Cambiaste el formulario: vuelve a ver la vista previa antes de guardar.';
    });
  }
  const d = dialogo({
    titulo: 'Reportar un fallo',
    nota: 'Armas el reporte aquí, lo revisas y lo envías tú. Chocosys no envía nada.',
    cuerpo: [paso.el, esperaba.el, pasos.el,
      imagen ? h('img', { class: 'reporte-miniatura', src: imagen, alt: 'Captura de la ventana de Chocosys tomada al abrir este formulario' }) : h('p', { class: 'dialogo-aviso' }, 'No se pudo tomar la captura: puedes adjuntar una tuya al enviar.'),
      conCaptura.el, conRegistro.el, zonaPrevia],
    pie: [estado, boton('Cancelar', () => d.cerrar()), verPrevia, guardar]
  });
  if (!(await d.fin)) bApi.reporte.cancelar();
}

async function mostrarReporteGuardado({ carpeta, instagram }) {
  const sinArroba = !instagram || /^\{\{/.test(instagram);
  const d = dialogo({
    titulo: 'Reporte guardado',
    nota: 'Se abrió la carpeta y el texto quedó copiado.',
    cuerpo: [
      h('p', {}, 'Carpeta: ', h('code', {}, carpeta)),
      sinArroba
        ? h('p', {}, 'Esta copia todavía no tiene el Instagram del autor (config/contacto.json). Puedes abrir un issue con la plantilla «Reporte de fallo» del repositorio.')
        : h('p', {}, 'Envíalo tú por mensaje directo de Instagram a ', h('strong', {}, instagram), ': pega el texto y adjunta captura-1.png como imagen.'),
      h('p', { class: 'dialogo-aviso' }, 'El autor no abre enlaces, ZIP, ejecutables ni otros adjuntos: solo texto e imágenes. Si prefieres GitHub, usa la plantilla de issue del repositorio.')],
    pie: [boton('Listo', () => d.cerrar(), 'principal')]
  });
}

$('#acerca-de').addEventListener('click', () => mostrarCreditos(false));
$('#sobre-mi').addEventListener('click', () => mostrarSobreMi(false));
$('#reportar-fallo').addEventListener('click', () => reportarFallo());

// Al abrir: los créditos la primera vez y, después, la pregunta del «sobre mí» (también una sola vez).
(async () => {
  try {
    const m = await bApi.bienvenida.marcas();
    if (!m.creditos_vistos) await mostrarCreditos(true);
    if (!m.sobre_mi_preguntado) await mostrarSobreMi(true);
  } catch (e) { console.warn('bienvenida:', e.message); }
  // Después, la revisión de instalación de app.js (antes partía sola a los 1,5 s y tapaba los créditos).
  setTimeout(() => abrirBienvenida(true), 600);
})();
