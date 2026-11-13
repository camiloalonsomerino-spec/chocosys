*Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)*

# Versiones lite

La ruta principal del repositorio es la app completa (`app/`). Estas dos ediciones usan el mismo código, con menos partes:

| Carpeta | Qué lleva | Qué deja fuera |
|---|---|---|
| `lite/terminales/` | Sesiones en terminales reales, espacios, lienzo y bandeja, barra de comando, recursos del PC, créditos, «sobre mí» y reporte de fallos | Flujos, CRM, segunda opinión, tareas programadas, el Inicio y el MCP |
| `lite/flujos/` | Todo lo de `terminales`, más flujos (recetas con etapas y puertas) y el MCP | CRM, segunda opinión, tareas programadas y el Inicio |

## Cómo se abren

Con las dependencias de `app/` ya instaladas (`cd app && npm install`):

```
cd lite/terminales
npm start
```

(o `lite/flujos`). Para probar sin tocar tu Chocosys de uso diario: `npm start -- --datos="<carpeta temporal>"`.

## Cómo están armadas

Sin copiar el código. Cada carpeta lleva un `package.json` chico y un `arranque.js` que fija la edición
(`CHOCOSYS_EDICION=terminales` o `flujos`) y carga `../../app/main.js`. `app/edicion.js` dice qué herramientas del MCP
van en cada una; la ventana esconde los botones y atajos de lo que no va y el MCP rechaza lo demás. Así un arreglo en
`app/` llega a las tres ediciones, y los créditos, el «sobre mí» y el reporte de fallos son iguales en todas.

Las tres comparten la carpeta de datos (`%APPDATA%\consola-agentes\`): una lite no corre las tareas programadas que se
hayan creado desde la completa.
