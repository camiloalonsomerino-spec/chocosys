*Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)*

# Chocosys en macOS (en prueba)

Desde la 0.23.0 (15-11-2026) el código de Chocosys corre en macOS, pero **todavía no se ha probado en un Mac real**: se
escribió y se probó en Windows. Si lo pruebas, cuéntanos qué pasó con la plantilla «Reporte de fallo» del repositorio.

## Cómo conseguir el instalador

No hay un `.dmg` publicado todavía. Dos formas de armarlo:

- **En un Mac:** `cd app`, `npm ci` y `npm run instalador -- --mac --adhoc`. El `.dmg` queda en `dist/`.
- **En GitHub:** pestaña Actions › «Instalador de macOS» › *Run workflow* (en tu copia del repositorio). Arma el `.dmg`
  para Apple Silicon (arm64) y para Intel (x64) en un Mac de GitHub y lo deja como artefacto de la corrida.

Desde Windows no se puede armar: falta el binario de la terminal para macOS, `hdiutil` y `codesign`.

## La primera vez que lo abras

Sin una cuenta de Apple Developer, el `.dmg` sale con firma *ad-hoc* y macOS lo bloquea la primera vez. Para abrirlo:
Ajustes del Sistema › Privacidad y seguridad › «Abrir igualmente». Con cuenta (y los secretos `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y `APPLE_TEAM_ID` en el repositorio) sale firmado y
notarizado, sin cambiar código.

## Qué cambia respecto de Windows

| En Windows | En macOS |
|---|---|
| Datos en `%APPDATA%\consola-agentes\` | Datos en `~/Library/Application Support/consola-agentes/` |
| Atajos con `Ctrl+Shift` | Atajos con `Cmd+Shift` (`Ctrl` sigue siendo de Claude Code; `Cmd+Shift+3` y `4` son capturas de macOS) |
| Botones de la ventana a la derecha | Semáforos a la izquierda |
| Procesos y GPU con PowerShell | Procesos con `ps`, GPU con `ioreg` |

Chocosys busca `claude` y `node` en el PATH de tu terminal (aunque la abras desde el Dock) y en `~/.local/bin`,
`/opt/homebrew/bin` y `/usr/local/bin`.

## Qué falta probar en un Mac

1. Que el `.dmg` abra y que ☰ › Revisar instalación encuentre `claude` y `node` abriendo desde el Dock.
2. Que la terminal escriba, cambie de tamaño y que `Ctrl+C`, `Ctrl+L` y `Ctrl+R` lleguen a Claude Code.
3. Copiar y pegar con `Cmd+C` y `Cmd+V` en la terminal y en la barra de órdenes.
4. Cerrar con `Cmd+Q` y reabrir: las sesiones siguen vivas. Forzar el cierre y reabrir: no quedan `claude` repetidos.
5. El panel de recursos (CPU, RAM, GPU y procesos por sesión) y que cerrar una sesión cierre sus servidores MCP.
6. Que la barra de arriba no tape los semáforos, también a 900 px de ancho.
7. Conectar el MCP desde ☰ › Revisar instalación.

Pendiente conocido: los textos de la interfaz siguen diciendo `Ctrl+Shift`, aunque en macOS los atajos van con `Cmd`.
