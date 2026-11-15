*Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)*

# Seguridad

## Cómo reportar una vulnerabilidad

Por el reporte privado de GitHub: pestaña **Security › Report a vulnerability** de este repositorio
(https://github.com/camiloalonsomerino-spec/chocosys/security/advisories/new). Solo lo ven el autor y quien reporta.
**No abras un issue público** para una vulnerabilidad.

Describe en texto qué pasa, en qué versión, los pasos para repetirlo y qué podría hacer alguien con eso. Sirven capturas.
Por la regla del autor (ver el [README](README.md)), no se abren enlaces, archivos ZIP, ejecutables ni adjuntos: una
prueba de concepto va como código en el texto del reporte.

Es un proyecto de una persona, sin fines comerciales: no hay plazos garantizados ni recompensas. Cada reporte se lee, se
responde en el mismo reporte y, si se confirma, el arreglo sale en una versión con su línea en el [CHANGELOG](CHANGELOG.md).

## Qué versiones reciben arreglos

Solo la última publicada en `main`. La versión para macOS está en prueba (ver [docs/mac.md](docs/mac.md)).

## Qué interesa especialmente

Chocosys abre sesiones de Claude Code en terminales reales y deja que esas sesiones la manejen por un MCP local. Lo más
delicado:

- Que algo distinto de quien usa la app **apruebe una puerta** de un flujo (el MCP no puede, por diseño).
- Que una sesión, un enlace de la terminal o una página ajena **ejecute un programa** o use el API de la ventana.
- Que otro usuario del mismo equipo **se conecte al dueño de las terminales** (tubería con nombre en Windows, socket
  Unix en macOS) o al servidor local de los hooks.
- Que se **pase el tope del plan** (☰ › Mi plan) sin que quien usa la app lo decida en la ventana.
- Que un reporte de fallo **filtre datos** (rutas, correos, claves) que el tachado debía quitar.

Fuera de alcance: lo que hace Claude Code por sí mismo y los servidores MCP de terceros que cada persona instala.
