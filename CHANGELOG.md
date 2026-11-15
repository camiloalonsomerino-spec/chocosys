*Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)*

# Cambios

Las fechas van en formato DD-MM-AAAA. Este repositorio parte con un solo commit (13-11-2026); lo anterior viene del
historial de desarrollo y de las fichas de actualización, contado sin datos de nadie.

## 0.23.0 · 15-11-2026

- **Mi plan:** al primer inicio (y en ☰ › Mi plan) se elige la suscripción de Claude Code: Pro, Max 5x, Max 20x, API o
  sin límites. Cada plan fija cuántas sesiones trabajan a la vez, el modelo y esfuerzo de una sesión nueva, el modelo y
  esfuerzo máximos (en Pro, una etapa que pide Opus corre en Sonnet), los agentes por etapa de un flujo, las tareas
  programadas y si se puede usar la Segunda opinión. Todo se puede subir a conciencia; el diálogo dice qué quedó sobre lo
  de fábrica. Sobre el tope, abrir una sesión desde la ventana pregunta; el MCP no puede pasarlo. Sin plan elegido, la
  app sigue como antes. Se guarda en `perfil.json`, «plan». Prueba: `scripts/probar-plan.js`.
- **macOS (sin probar en un Mac):** capa de plataforma (`plataforma.js`) para buscar programas, el PATH del shell de
  login, el tubo de terminales como socket Unix, la barra con los semáforos y los atajos con Cmd; lector de procesos con
  `ps` e `ioreg` (`procesos-unix.js`, mismas órdenes que el PowerShell); `.dmg` con `npm run instalador -- --mac` en un
  Mac o con `.github/workflows/mac.yml`. Windows queda igual. Prueba: `scripts/probar-unix.js`. Guía: `docs/mac.md`.
- **Seguridad:** el socket de las terminales nace solo para su dueño (0600); del PATH se aceptan solo carpetas
  absolutas; un flujo pedido por el MCP respeta el tope del plan; las acciones del flujo de GitHub van fijadas por hash.
  Tras una revisión independiente: fuera de Windows y macOS el socket va en `XDG_RUNTIME_DIR` (no en `/tmp`); un plan
  llamado «constructor» o «__proto__» ya no salta los topes; la revisión pública del instalador también busca rutas
  `/Users/…` y `/home/…`; `disable-library-validation` va solo en la firma ad-hoc. Nuevo `SECURITY.md` (reporte privado).
  **Pendiente (media):** el dueño de las terminales corre con `ELECTRON_RUN_AS_NODE`, así que el binario firmado acepta
  ese modo; en macOS otro programa del mismo usuario podría usar los permisos de privacidad que se le dieron a Chocosys.
  El arreglo (apagar el fusible `RunAsNode`) cambia cómo parte ese proceso y se hará cuando se pueda probar en un Mac.

## 0.22.0 · 15-11-2026

- **Fuentes propias:** `%APPDATA%\consola-agentes\fuentes\fuentes.json` elige la fuente de los títulos, de la interfaz
  y de la terminal. Cada familia es una carpeta con sus archivos (`.woff2`, `.woff`, `.ttf` u `.otf`), en esa carpeta o
  en `app/fuentes/`; sin carpeta, se usa la instalada en Windows. La terminal solo acepta monoespaciadas. Una fuente que
  no está, un nombre con caracteres raros o un `fuentes.json` roto dejan la de fábrica y avisan. Trae Barlow, Libre
  Baskerville y Geist Mono (SIL OFL 1.1, con su licencia). Guía: `docs/fuentes.md`. Prueba: `npm run probar`.
- **Terminal:** al volver a una pestaña ya no se crea de nuevo el dibujo por GPU de cada terminal (lo conservan hasta 6);
  el cambio bajó de 30 a 80 ms por terminal a menos de 1 ms. Si cambia la escala de pantalla, se crea de nuevo.
- **Terminal:** interlineado 1,1 (33 filas donde cabían 30); el fondo bajo la última fila ya no queda negro puro; con
  una ventana agrandada, la mascota va en la barra y el título de la pestaña se oculta.
- **Sesiones:** tras `/clear` o `/resume` se anota la conversación vigente (llega en cada aviso del hook) y es la que se
  retoma al abrir de nuevo la app o al cambiar el modelo. Una sesión no anota una conversación que ya tiene otra.
- **Cerrar sesiones:** el tope de 15 s para cerrar el árbol de procesos rige solo al cambiar el modelo. Al cerrar
  muchas sesiones juntas, las órdenes que no alcanzaban a empezar se cancelaban y dejaban servidores MCP vivos.

## 0.21.0 · 13-11-2026 (primera versión pública)

- **Créditos** la primera vez que se abre la app (después, en ☰ › Acerca de). El texto vive en `app/config/creditos.md`.
- **Sobre mí:** nombre o apodo, a qué se dedica y qué quiere hacer con la app. Opcional, editable y borrable, guardado
  solo en `%APPDATA%\consola-agentes\sobre-mi.json`. Si la persona lo elige, cada sesión nueva parte con ese contexto.
- **Reportar un fallo:** reporte con formato fijo, captura y registro, con rutas, correos, RUT, teléfonos y claves
  tachados; vista previa y confirmación; se guarda en una carpeta y lo envía la persona. Prueba:
  `node app/scripts/probar-reporte.js`.
- La revisión de instalación sale después de los créditos y del «sobre mí», no encima.
- `npm run instalador -- --revisar` revisa sin armar. La lista de nombres que no pueden viajar sale del `perfil.json` de
  quien arma (`revision_publica`) y ya no va escrita en el programa.
- Ejemplos y datos de prueba del CRM y del tutorial, inventados y neutros.
- Licencia PolyForm Noncommercial 1.0.0 y línea de aviso en cada archivo propio.
- **Ediciones lite:** `lite/terminales` (sesiones, espacios, lienzo, bandeja y recursos) y `lite/flujos` (lo mismo más
  flujos y el MCP). Usan el código de `app/`; `app/edicion.js` decide qué se esconde y qué rechaza el MCP.
- **Logo:** una C naranja, como icono de la ventana y del instalador y en los créditos (`assets/logo/`).
- Créditos con el texto del autor, su Instagram (botón «?», enlace para copiar; la app no abre el navegador) y el logo.
- **Seguridad:** la ventana ya no abre páginas ajenas ni navega a un archivo soltado encima (tenían acceso a las funciones
  de la app); el MCP ya no guarda recetas (`receta_guardar` sale: una sesión podía quitarle las puertas a una receta); con
  una puerta a la vista se apaga el CSS personal, que podía estirar un «Aprobar» invisible sobre toda la ventana; un
  nombre de sesión que empieza con «-» ya no se vuelve opción de Claude Code; `sesion_ordenar` quita caracteres de control
  y antepone quién manda la orden; «Abrir» muestra en su carpeta un `.exe`, `.bat` o acceso directo en vez de correrlo.
- **Arreglos:** el revisor del instalador falla cerrado si `perfil.json` no se lee y toma cada nombre como texto literal; la
  vista previa del reporte se invalida al cambiar el formulario; «la contraseña nunca se guarda» ya no se tacha; dos
  reportes en el mismo minuto no se pisan; el usuario «ana» no se tacha dentro de «mañana»; los diálogos retienen el foco;
  un `crm.json` ilegible no se pisa; con `claude.cmd` (Claude Code por npm) se busca el `.exe`; el CSV del CRM sale con
  «;» y sin fórmulas.

## Limpieza · 04-11-2026

- Salen funciones con poco uso: el panel «Ojear» (lo que mostraba pasó a la lista «trabajando»), el chip «Recetas»,
  «Abrir 2 · 3 · 4», «Ir a una sesión», tres herramientas del MCP del CRM, la entrevista al crear un flujo y el
  optimizador de recursos (el monitor sigue).
- Con la ventana oculta, las animaciones quedan en pausa, los relojes no trabajan y no se pide la GPU.
- Perfil MCP por sesión (apagado de fábrica): cada sesión puede partir solo con los servidores MCP que necesita.

## 0.20.0 · 03-11-2026

- **Recursos del PC:** pastilla «CPU · RAM · GPU» en la barra y panel con lo que consume cada sesión (últimos 5 minutos,
  una línea por adaptador de video). Cerrar una sesión cierra también lo que lanzó (sus servidores MCP quedaban vivos).
- La central parte con un tope de 3 sesiones a la vez, ajustable en `perfil.json` (`central.tope`), igual que el modelo
  y el esfuerzo de las sesiones y los umbrales de alerta de RAM y CPU.
- **Terminal trabada y texto encimado:** se corrigieron el tamaño de la terminal, el repintado y la última fila cortada.

## Arreglos de terminal y barra · 29-10-2026 (entraron en la 0.20.0)

- La barra de arriba ya no pasa bajo los botones de minimizar, maximizar y cerrar con la ventana a media pantalla.
- Terminal negra al abrir una pestaña con varias terminales: la terminal reintenta medirse y se repinta al mostrarse.
- Terminal de Claude Code con restos de texto y columna angosta: xterm parte en 120x32, el tamaño se guarda antes de que
  exista la terminal y, al recargar la interfaz, cada terminal recupera su contenido reciente.
- Estos arreglos se repartieron como parches para copias instaladas; desde esta versión pública basta con instalar la
  nueva.

## 0.19.0 · 25-10-2026

- **La central:** una sesión permanente que reparte el trabajo en otras sesiones, con Remote Control.
- **Tareas programadas** dentro de Chocosys y herramientas del MCP para abrir, cerrar y enlazar sesiones.

## 0.18.0 · octubre de 2026

- **Instalador para Windows** con dos ediciones: la pública (revisa que no lleve datos de nadie) y la propia (trae el
  perfil, las recetas y las plantillas de quien la arma).
- Nada personal dentro del programa: nombres y rutas de cada persona viven en su `perfil.json`.

## Desarrollo inicial · 17-10-2026 al 22-10-2026

- 17-10-2026: primera versión. Claude Code en terminales reales, bandeja de lo que te necesita, flujos con puertas y el
  lienzo Brasa (espacios, ventanas que se mueven y estiran, barra de comando).
- 18-10-2026: MCP `chocosys`, puertas para elegir de una lista y vista Flujo en kanban.
- 20-10-2026: temas Brasa, Gris y Blanco; la barra que le habla a varias sesiones y junta su trabajo; Inicio; CRM con
  plantillas de embudo, requisitos por etapa y documentos; la sala directiva (segunda opinión).
- 21-10-2026: segunda opinión con profundidad e investigación en internet; asesores, temas y tutorial editables desde
  archivos de texto.
- 22-10-2026: «Hacer flujo» desde una sesión, Obsidian opcional, acciones estándar y probabilidad por etapa en el CRM.
