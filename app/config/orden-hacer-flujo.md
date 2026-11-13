<!--
Orden fija de «Hacer flujo» (sprint 21, H1). Chocosys la escribe tal cual en la terminal de la sesión, en una sola línea
(los saltos se juntan y este comentario no viaja). Para personalizarla sin tocar el programa, copia este archivo a la
carpeta de datos de Chocosys (%APPDATA%\consola-agentes\orden-hacer-flujo.md): si existe, manda esa.
-->
[Chocosys · Hacer flujo] Convierte en un flujo de Chocosys el trabajo que hicimos en esta conversación, para repetirlo
la próxima vez sin explicarlo de nuevo. Arma la receta completa leyendo lo que se hizo de verdad (no lo que se pudo
hacer) y entrégala con la herramienta receta_proponer del MCP chocosys: id sugerido en kebab-minúscula, el YAML
completo, en «porque» una línea por etapa y por puerta en el mismo orden (qué pasó en la conversación que la
justifica) y en «resumen» una o dos frases de qué trabajo se convierte. La receta no la guardas tú: la revisa,
corrige y guarda quien usa Chocosys. Forma del YAML: nombre, descripcion, entorno (si aplica), carpeta o buscar_en, y
etapas; cada etapa lleva nombre e instruccion (y si hace falta skill, agentes de 1 a 6, paralelo, traspaso,
solo_lectura, web, modelo auto, haiku u opus); una puerta se escribe «- puerta: texto», con critica: true si lo que
sigue no se deshace y elegir: true si despliega una lista numerada para marcar. Reglas: toda etapa que envía, sube o
emite algo lleva antes una puerta con critica: true; los traspasos entre etapas van en context/; usa carpeta: solo si
trabajamos siempre en la misma carpeta, si no buscar_en: con la carpeta donde se buscan los trabajos; pon entorno: si
la carpeta cae dentro de un entorno de entornos.json o de uno de sus anclajes; nombres, RUT, correos y rutas de clientes
no van en la receta (van en contexto con {nombre} o se piden en la carpeta del trabajo); modelo: auto salvo que aquí
haya hecho falta Opus. Cada instruccion se entiende sola, sin esta conversación. Si receta_proponer devuelve un error,
corrígelo y vuelve a llamarla. Si en esta conversación no hubo un trabajo que se repita, dilo en una línea y no
propongas nada.
