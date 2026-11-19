*Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)*

# Chocosys en macOS (en prueba)

Desde la 0.23.0 (15-11-2026) el código corre en macOS. La 0.23.1 se probó en un Mac real el 17-11-2026 (macOS 13.1,
Apple M1): abre sesiones, reconecta tras Cmd+Q, el MCP funciona y los fusibles van apagados. Lo que falta probar está
abajo. Si lo pruebas, cuéntanos qué pasó con la plantilla «Reporte de fallo» del repositorio.

## Cómo conseguir el instalador

No hay un `.dmg` publicado todavía. Dos formas de armarlo:

- **En un Mac:** `cd app`, `npm ci` y `npm run instalador -- --mac --adhoc`. El `.dmg` queda en `dist/`.
- **En GitHub:** pestaña Actions › «Instalador de macOS» › *Run workflow* (en tu copia del repositorio). Arma el `.dmg`
  para Apple Silicon (arm64) y para Intel (x64) en un Mac de GitHub y lo deja como artefacto de la corrida.

Desde Windows no se puede armar: falta el binario de la terminal para macOS, `hdiutil` y `codesign`.

## Requisitos

**Node.js** instalado (nodejs.org o Homebrew). Lo usan las terminales, los hooks, la línea de estado y el MCP. Sin él,
cada sesión lo avisa en su terminal.

## La primera vez que lo abras

Sin una cuenta de Apple Developer, el `.dmg` sale con firma *ad-hoc* y macOS lo bloquea la primera vez. Para abrirlo:
Ajustes del Sistema › Privacidad y seguridad › «Abrir igualmente». Con cuenta (y los secretos `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` y `APPLE_TEAM_ID` en el repositorio) sale firmado y
notarizado, sin cambiar código.

Desde la 0.23.1 no hace falta nada más. Con la 0.23.0, si las sesiones no abren:
`xattr -dr com.apple.quarantine /Applications/Chocosys.app`.

## Qué cambia respecto de Windows

| En Windows | En macOS |
|---|---|
| Datos en `%APPDATA%\consola-agentes\` | Datos en `~/Library/Application Support/consola-agentes/` |
| Atajos con `Ctrl+Shift` | Atajos con `Cmd+Shift` (`Ctrl` sigue siendo de Claude Code; `Cmd+Shift+3` y `4` son capturas de macOS) |
| Pestaña N con Alt+1 a 9 | Pestaña N con Cmd+1 a 9 (Option+número escribe caracteres) |
| Ctrl+C con selección copia; Ctrl+V pega | Copiar y pegar con Cmd+C y Cmd+V; Ctrl+C interrumpe y Ctrl+V pega una imagen en Claude Code |
| Botones de la ventana a la derecha | Semáforos a la izquierda |
| Procesos y GPU con PowerShell | Procesos con `ps`, GPU con `ioreg` |

Chocosys busca `claude` y `node` en el PATH de tu terminal (aunque la abras desde el Dock) y en `~/.local/bin`,
`/opt/homebrew/bin` y `/usr/local/bin`.

## Qué falta probar en un Mac (18-11-2026)

1. Atajos con teclado real: Option+1, 2 y 3 en la terminal y en la barra (Cmd+Shift+K), Cmd+1 y Cmd+2, Ctrl+C con
   selección (interrumpe), Cmd+C y Cmd+V, y Ctrl+V con una captura (`[Image #1]`).
2. El flujo completo del `.dmg`: bajarlo, aprobarlo en Ajustes › Privacidad y seguridad y abrir desde `/Applications`
   (el arreglo de la cuarentena se probó con el atributo puesto a mano).
3. El binario Intel (`--mac --x64`). Linux.
4. El dueño de las terminales con un Node de Homebrew o de nodejs.org (se probó con un Node portátil).
5. La RAM de `vm_stat` (70 %) contra «Memoria usada» del Monitor de Actividad.
6. Observaciones abiertas: la primera orden por MCP a una carpeta nueva la come el diálogo de confianza de Claude Code;
   la terminal se ve vacía justo después de reconectar; tras un cierre forzado reconectó a 53x22.
