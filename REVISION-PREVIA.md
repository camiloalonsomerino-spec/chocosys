*Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)*

# Revisión previa a publicar (13-11-2026)

- **Qué es:** la revisión de esta copia antes de subirla a un repositorio público. No nombra lo que se sacó: el detalle
  con nombres quedó fuera del repositorio, en la carpeta de trabajo privada del autor.
- **Estado:** copia lista con un commit local. **Nada se subió**: falta la orden del autor.

## La regla

Del repositorio sale todo lo que sea del autor o de lo que hace, salvo el texto de créditos (quién es, a qué se dedica en
una frase general y para qué es Chocosys). Nada de proyectos, empresas, clientes, estudios, rutas, ejemplos con sus
datos, recetas ni plantillas propias, capturas de su trabajo ni historial con mensajes que lo nombren. Ejemplos y
documentación usan datos inventados y neutros. Por eso el repositorio parte con **un solo commit**, sin el historial de
desarrollo.

## Qué se revisó

| Se buscó | Encontrado | Qué se hizo |
|---|---|---|
| Nombre del autor, de una empresa y de personas en el código | 55 cambios en 13 archivos de `app/`, casi todos comentarios («pedido de…», «decisión de…») | Pasan a «quien usa la app» o a ejemplos neutros |
| Nombres de clientes, una empresa y personas | 1 empresa, 1 persona y 3 clientes, en comentarios, ejemplos y en la lista del revisor del instalador | Fuera; el revisor lee esa lista del `perfil.json` de quien arma (`revision_publica`) |
| Rutas de un computador (carpeta de usuario y de su taller) | En comentarios, en una instrucción del MCP y en la orden «Hacer flujo» | Cambiadas por rutas neutras (`entornos.json`) |
| Ejemplos ligados a su trabajo | Datos de prueba del CRM, ejemplos del tutorial y del CRM, reglas del clasificador por sus skills, un veto de la sala atado a sus estudios | Datos inventados y neutros; las reglas de skills propias, fuera |
| Correos, teléfonos, RUT, tokens y claves | Ninguno real (los RUT y el correo de prueba son ficticios: `76.000.00x`, `contacto@ejemplo.cl`) | Sin cambios |
| Fichas de actualización | 9 fichas que contaban el envío de parches a otras personas, con rutas y nombres | No se publican; su contenido técnico pasó a `CHANGELOG.md` |
| Paquetes `.zip`, capturas, videos y `datos-prueba` | 2 `.zip` de parches con rutas propias; capturas y videos en carpetas internas | Nada de eso entra; `.gitignore` deja fuera `*.zip`, videos, `datos-prueba/` y `reportes/` |
| Recetas y plantillas propias | Viven fuera de `app/` | No entran; solo las de ejemplo del programa |
| Documentos internos (hoja de ruta, PRD, sprints, auditorías, referencias, diseño) | Llenos de trabajo propio | No entran |
| Historial de commits | 12 commits con mensajes de trabajo interno | No se publica: commit inicial nuevo, con autor y correo `noreply` de GitHub |

Barrido final (13-11-2026) con las mismas búsquedas, en todo el repositorio: el nombre del autor queda en `LICENSE`, en
la línea de licencia del README (derechos de autor) y en los créditos aprobados (`app/config/creditos.md`); su Instagram
público en `contacto.json`, README, CONTRIBUTING y las plantillas de issue; el identificador de la app
(`cl.camilomerino.chocosys`). No queda ningún marcador por llenar.
Los PNG e ICO no llevan metadatos. `node app/scripts/instalador.js --revisar`: limpia.

## Qué se agregó

- Créditos la primera vez, «Sobre mí» y «Reportar un fallo» (detalle en `CHANGELOG.md`, versión 0.21.0).
- `LICENSE` (PolyForm Noncommercial 1.0.0), `AVISO.md`, `CONTRIBUTING.md`, plantillas de issue y de pull request
  y `.gitignore`. Por ahora no hay forma de aportar: el repositorio no lleva botón de aporte.
- La línea de aviso en 34 archivos propios con `herramientas/aviso-legal.js` (probado: aplicar y quitar deja cada archivo
  idéntico byte a byte; respeta el BOM de los `.ps1`).

## Datos personales (Ley 21.719)

- El «sobre mí» es opcional, editable y borrable; queda en el computador de la persona. Solo viaja a Claude si ella elige
  «Guardar y usar en mis sesiones» (las dos opciones se ofrecen con el mismo peso; ninguna viene marcada).
- El reporte de fallos tacha rutas, usuario y equipo, correos, RUT, teléfonos y claves antes de mostrarse; la persona ve
  la vista previa, puede corregirla y confirma; la app no envía nada. La captura no se tacha sola y la ventana lo avisa.
- Quien recibe un reporte por mensaje directo pasa a tratar esos datos: el README compromete usarlos solo para arreglar el
  fallo y borrarlos cuando el arreglo sale. Compromiso aprobado por el autor el 13-11-2026.

## Cómo se probó (13-11-2026)

En una copia aparte (`electron . --datos=<carpeta temporal>`), sin tocar la Chocosys en uso:

- La app abre; los créditos salen primero, después el «sobre mí» y después la revisión de instalación.
- `marcas.json` guarda `creditos_vistos` y `sobre_mi_preguntado`; al reabrir no vuelven a salir.
- Una sesión real (Haiku) abierta tras guardar el «sobre mí» respondió con el nombre y la dedicación escritos en él.
- El reporte armó la vista previa tachada, guardó `reporte.md` y `captura-1.png`, y el texto guardado no traía ninguno de
  los datos de prueba.
- `node app/scripts/probar-reporte.js`: 6 de 6.
- Las tres ediciones (completa, `lite/terminales` y `lite/flujos`), por depuración remota y sin clics por coordenadas:
  créditos con el texto aprobado, el «?» con el enlace para copiar, foco retenido en los diálogos, lo que cada edición
  esconde y lo que su MCP rechaza, la vista previa del reporte que se invalida al cambiar el formulario, y los arreglos de
  seguridad en ejecución (ni ventanas nuevas ni navegar fuera de la interfaz, `receta_guardar` rechazado, CSS personal
  apagado con una puerta a la vista, `crm.json` ilegible intacto). Completa 31 de 31; cada lite, 30 de 30.
- El revisor del instalador sale con error si `perfil.json` está roto, y un nombre como «S.A. (Chile» ya no lo vacía.

## Lo que falta

- Probar `npm install` desde cero en otro computador: en esta prueba se usaron las dependencias ya instaladas.
