*Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)*

# Cómo contribuir

Gracias por querer ayudar. Chocosys es un proyecto sin fines comerciales y este repositorio es sin fines de lucro: las
contribuciones se aceptan bajo la misma licencia ([PolyForm Noncommercial 1.0.0](LICENSE)).

## La regla de seguridad

El autor **no abre enlaces, archivos ZIP, ejecutables ni adjuntos de terceros**. Por eso:

- Todo va por el repositorio: **issues y pull requests con texto y capturas** (imágenes pegadas en GitHub).
- Las contribuciones se leen como texto y código en GitHub. Nada se ejecuta antes de leerlo línea por línea.
- Un issue o un pull request que pida descargar algo, abrir un enlace externo o correr un programa se cierra sin abrirlo.
- No adjuntes `.zip`, `.exe`, `.cmd`, `.ps1` ni instaladores. Si el cambio es código, va en el pull request como diff.

## Reportar un fallo

1. En la app: ☰ › Reportar un fallo. Arma el reporte con formato fijo y tacha rutas, correos y claves.
2. Abre un issue con la plantilla **Reporte de fallo** y pega el texto. La captura va como imagen pegada. Si prefieres no
   hacerlo público, mándalo por mensaje directo de Instagram a [@kmilito_](https://instagram.com/kmilito_).
3. Revisa que la captura no muestre nada tuyo (la app no puede tacharla sola).

## Proponer una idea

Abre un issue con la plantilla **Idea**: qué quieres hacer, cómo lo haces hoy y qué cambiaría en la app.

## Pull requests

- Cambios chicos y de a uno. Explica qué arregla y cómo lo probaste.
- Antes de enviar, corre:
  - `cd app && node scripts/instalador.js --revisar` (que no viajen rutas ni correos);
  - `node scripts/probar-reporte.js` si tocas el reporte de fallos.
- Prueba en una copia aparte: `npx electron . --datos="<carpeta temporal>"`.
- Ejemplos y datos de prueba siempre inventados y neutros. Nada de nombres reales, clientes, rutas de tu computador ni
  correos.
- Textos de la interfaz en español; los incisos van entre paréntesis.
- Los archivos nuevos llevan la línea de aviso: `node herramientas/aviso-legal.js . --aplicar`.

## Qué no se acepta

- Funciones, ramas o carpetas reservadas para algunas personas: todo avance es público para todos.
- Cambios que hagan que la app envíe datos por su cuenta.
- Cambios que permitan aprobar las puertas de un flujo sin que la persona lo haga en la ventana.
