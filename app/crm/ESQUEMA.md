*Chocosys · proyecto sin fines comerciales, solo recreativo · repositorio sin fines de lucro · licencia PolyForm Noncommercial 1.0.0 (ver AVISO.md)*

# CRM de Chocosys · el esquema

- **Primario:** [README de Chocosys](<../../README.md>) · [Sprint 3](<../../sprints/sprint-03/SPRINT-03.md>)
- **Creado:** 20-10-2026

El modelo de cualquier CRM básico (HubSpot, Pipedrive, Zoho, Odoo), con nombres en español y su equivalente
en inglés. Si sabes usar uno de esos, sabes usar este. Si eres una IA y te piden personalizarlo, todo lo que
cambia el comportamiento está en filas de la base, no en el código: etapas, tipos de actividad y reglas.

## Los objetos

| Tabla | En inglés | Para qué | Campos que importan |
|---|---|---|---|
| `empresa` | company / organization | Clientes y proveedores | `nombre`, `rut`, `tipo` (cliente · proveedor · otro), `rubro`, `ciudad` |
| `contacto` | contact / person | Las personas de cada empresa | `empresa_id`, `nombre`, `cargo`, `correo`, `telefono` |
| `etapa` | pipeline stage | Los pasos del embudo | `embudo`, `nombre`, `orden`, `tipo` (abierta · ganada · perdida), `probabilidad` (0 a 100, sprint 26) |
| `negocio` | deal / opportunity | Cada trabajo | `nombre`, `entorno` (la empresa, la consultora…), `empresa_id`, `contacto_id`, `etapa_id`, `monto`, `moneda`, `probabilidad` (la pisada; vacía = sigue a la etapa), `carpeta`, `cierre_esperado`, `etapa_desde` |
| `actividad` | activity / task | La próxima acción y a quién le toca | `negocio_id`, `tipo` (tarea · llamada · correo · reunión · nota), `que`, `responsable`, `vence` (opcional), `hecha` |
| `historial` | audit log | Todo cambio, de quien sea | `cuando`, `autor`, `objeto`, `objeto_id`, `accion`, `campo`, `antes`, `despues` |
| `regla` | workflow rule | Qué requiere atención hoy | `rotulo`, `condicion`, `etapa`, `dias`, `activa`, `orden` |
| `control` | — | La plata, leída del `CONTROL-COMPRA-VENTA_*.xlsx` | `archivo`, `huella`, `leido`, `moneda`, `costo`, `venta` |
| `requisito` | required properties | Lo que pide cada etapa (sprint 4) | `etapa_id`, `tipo` (dato · documento · actividades_al_dia), `clave`, `texto`, `patron` |
| `documento` | attachments | La ficha de cada archivo subido; el archivo vive en la carpeta del negocio | `negocio_id`, `tipo`, `nombre`, `ruta`, `subido`, `autor` |
| `config` | settings | Ajustes sueltos | `modo` (prueba · real), `carpeta_trabajos`, `migrado_desde`, `embudo:<entorno>`, `plantilla:<embudo>` |

## Plantillas y cuestionario (sprint 4)

- **Plantillas** en `crm\plantillas\*.json`: `embudo`, `etapas` (cada una con `tipo` y `requisitos`), `reglas` y
  `perfil` (qué respuestas del cuestionario calzan, con sus puntos y su razón). Hay cuatro: proyectos y servicios
  técnicos, ventas a empresas, embudo digital y suscripciones, consultoría. Para crear otra, se copia una.
- **Cuestionario** en `crm\cuestionario.json`: 8 preguntas con sus opciones. La recomendación suma los puntos del
  perfil de cada plantilla y muestra el porcentaje de calce y las razones; no usa IA.
- **Aplicar** una plantilla crea o actualiza su embudo, reemplaza sus requisitos, suma las reglas que falten y, si
  se indica, hace que un entorno use ese embudo. Los negocios no se mueven.
- **Requisitos:** un dato cumple si el campo del negocio tiene valor; un documento, si hay uno subido con ese tipo
  o un archivo en la carpeta del negocio cuyo nombre calza con `patron`; `actividades_al_dia`, si no hay
  pendientes. Mover a una etapa con faltantes no se bloquea: queda anotado en el historial.

## Varios CRM (sprint 4)

Uno por proyecto o empresa. Cada uno es una carpeta dentro de `carpeta_crms` (en `crm.json`; por defecto, los
datos de la app) con `crm.db`, `crm-nombre.json` y `documentos\`. El de `base` en `crm.json` es el principal.
«Impulsar con IA» abre Claude Code en `carpeta_crms`: pregunta el nombre, crea el CRM y lo configura con las
herramientas `crm_*` del MCP de Chocosys.

## Sprint 6 (20-10-2026): plata, solicitudes, proyectos y carpetas

**Objetos y columnas nuevas** (una base vieja las recibe sola al abrirse, sin perder datos):

| Tabla o columna | En inglés | Para qué |
|---|---|---|
| `proyecto` | project | Un proyecto grande agrupa negocios que comparten papelería, imágenes y marca. Columnas: `nombre`, `entorno`, `carpeta`, `estado` (activo · cerrado), `notas` |
| `negocio.proyecto_id` | — | El proyecto al que pertenece |
| `negocio.tipo` | deal type | web · cotización · contrato · otro (los tipos los da la plantilla); decide dónde nace su carpeta |
| `negocio.origen` | lead source | Por dónde llegó: Directo o referido · Cliente existente · Interno · Correo · Teléfono o WhatsApp · Formulario web · Licitación · Redes · Otro |
| `empresa.tipo = 'interno'` | — | El cliente es el mismo negocio (un encargo interno) |
| `control.fuentes` | — | JSON: de qué archivo, hoja y celda salió cada número de la plata |

**La plata** (`crm.js`, `leerPlata`, con el lector sin dependencias `crm\libro.js`): la plantilla del embudo dice
dónde mirar en su clave `plata` (se guarda en `config` como `plata:<embudo>`):

```json
"plata": {
  "libro": { "patron": "^CONTROL-COMPRA-VENTA_.*\\.xlsx$", "carpeta_aparte": "3-COSTOS-NO-COMPARTIR",
    "costo": { "hoja": "POR PROVEEDOR", "etiqueta": "TOTAL" }, "venta": { "hoja": "BASE COTIZACIÓN", "etiqueta": "TOTAL NETO" } },
  "compras": { "carpeta": "04-ORDENES-DE-COMPRA", "patron": "^OC-.*\\.xlsx$", "etiqueta": "NETO" }
}
```

- Se lee **por etiqueta, no por coordenada**: la celda que dice «TOTAL NETO» y el primer número a su derecha (si se
  repite, la de más abajo). Excel guarda el valor calculado de cada fórmula: no hace falta Excel.
- Costo: el libro de control del trabajo (en su carpeta o, si no está, en `carpeta_aparte` con el mes y una palabra
  del trabajo); si no hay libro, la suma de las OC **separada por moneda** (una OC en dólares no se suma a pesos).
- Venta: la del libro. Si no hay, la ficha muestra el monto esperado y lo dice.
- Se guarda con la huella de los archivos y se vuelve a leer solo si cambian; cada cambio deja su línea en el historial.
- La ficha muestra el **recargo sobre el costo** y, al lado, el **margen real sobre la venta**, cada uno con su nombre.

**Carpetas** (configuración de cada CRM, en la ventana: Configurar → Carpetas, o con `crm_carpetas`):

- `raiz_proyectos`: dónde nace cada proyecto (`PROYECTO.md`, `_compartido\papeleria|imagenes|marca`, `encargos\`).
- `raices:<embudo>`: `{ tipo: ruta, "*": ruta }`, dónde nace la carpeta de cada tipo de negocio («*» = el resto).
- `carpeta:<embudo>`: las subcarpetas con que nace cada negocio (la da la plantilla, clave `carpeta.estructura`).
- Un negocio de un proyecto nace en `<proyecto>\encargos\AAAA-MM_nombre`; si no, en la raíz de su tipo. Siempre con
  su `TRABAJO.md` (qué se pidió, qué hay que entregar, envíos y entregas).

**La solicitud** (`crearSolicitud`): cliente existente, nuevo o interno; contacto (si su correo ya existe, es esa
persona: correo exacto, nunca parecido); negocio en la primera etapa; una nota con lo pedido; la tarea «Revisar la
solicitud y definir qué hay que entregar»; y su carpeta. Ventana: «+ Solicitud». MCP: `crm_solicitud`.

**«Definir con IA»** abre el asistente con el negocio cargado: pregunta lo que falta, propone el plan y, con OK, deja
las actividades y la sección «Qué hay que entregar» del `TRABAJO.md` (`crm_trabajo`, el único archivo que escribe).

## Sprint 26 (22-10-2026): probabilidad por etapa y monto ponderado

| Columna o dato | En inglés (HubSpot · Pipedrive · Odoo) | Para qué |
|---|---|---|
| `etapa.probabilidad` | Deal stage probability · Stage probability · `crm.stage` (Odoo la calcula) | El % de partida de cada etapa, de 0 a 100. Lo escribe la plantilla al aplicarse (clave `probabilidad` de cada etapa del JSON) |
| `negocio.probabilidad` | Deal probability · Probability · `probability` | La pisada a mano. Vacía = sigue a la de la etapa |
| `ponderado` (no es columna) | Weighted amount · Weighted value · `prorated_revenue` | Monto × probabilidad / 100, **calculado al leer** (`conProbabilidad` en `crm.js`); nunca se guarda, así no se desincroniza |

- **La probabilidad que vale:** etapa ganada → 100; perdida → 0 (aunque esté pisada); si no, la pisada o, si no hay,
  la de la etapa. Una etapa sin % no pondera: el tablero dice «sin %».
- **Pisarla** se hace en la ficha del negocio («Plata»); deja su línea en el historial. **Cambiar de etapa borra la
  pisada** con su línea («70 → la de la etapa, al pasar a OC»).
- **El MCP la lee** (`crm_negocios`, `crm_negocio` traen `probabilidad`, `probabilidad_pisada` y `ponderado`) **pero
  no la cambia**, igual que el monto: lo decide quien usa la ventana.
- **El tablero** suma bajo cada columna el monto y el ponderado **por moneda** (CLP, UF y USD no se suman entre sí) y,
  arriba, «Por cerrar, ponderado» (solo etapas abiertas) y «Ganado» aparte. `pronostico({ entorno, embudo })` en
  `crm.js` hace la misma cuenta por otro camino.
- **Un embudo aplicado antes del sprint** recibe una vez los % de su plantilla, solo en las etapas vacías (marca
  `config` `probabilidades:<embudo>`).
- **El CSV de negocios** trae las columnas `probabilidad` y `ponderado`.
- Valores de partida de cada plantilla y el porqué: `sprints\sprint-26\SPRINT-26.md`, decisión D8.

## Las reglas de «requiere atención hoy»

Cada fila activa de `regla` produce tarjetas. Condiciones que entiende el motor (`crm.js`, función `hoy`):

| `condicion` | Qué marca | Usa |
|---|---|---|
| `actividad_vencida` | Actividades no hechas con fecha pasada | — |
| `vence_pronto` | Actividades que vencen dentro de `dias` | `dias` |
| `etapa_quieta` | Negocios que llevan `dias` o más en la etapa `etapa` | `etapa`, `dias` |
| `sin_proxima_accion` | Negocios abiertos sin ninguna actividad pendiente | — |
| `sin_plazo_estancada` | Actividades sin fecha creadas hace `dias` o más | `dias` |

Para cambiar el criterio se edita la fila (por ejemplo, `Cotización sin respuesta` de 5 a 3 días); para apagar
una regla, `activa = 0`.

## Trazabilidad

- Toda escritura pasa por `crm.js` y deja una línea en `historial` con su autor: el nombre del perfil (la ventana), `mcp`
  (un agente por el MCP de Chocosys), `migración` o `prueba`.
- La plata no se teclea: se lee del libro de control o de las OC del negocio, con fecha, huella y la celda de origen.
- Exporta CSV de negocios, empresas, contactos y actividades con columnas estándar (ventana del CRM → Exportar CSV).
  El de negocios trae `probabilidad` y `ponderado` desde el sprint 26.

## Dónde viven los datos

- **El código no lleva datos.** La base la indica `crm.json`, junto al estado de la app
  (`%APPDATA%\consola-agentes\crm.json`): `{ "base": "…\\crm.db", "migrar_desde": "…" }`.
- Sin `crm.json`, la base nace en los datos de la app con **datos de prueba ficticios** y la ventana lo dice.
- Los datos reales viven en la carpeta de datos de quien usa Chocosys y no salen del equipo.

## Lo que viene

- Acceso de otra persona (por ejemplo, por Tailscale) con usuario y contraseña, solo a su empresa.
- De la investigación de CRM públicos (`consola-agentes\referencias\crm-publicos\`): motivo de pérdida, `cerrado_el`, estado y vencimiento de documentos, renovación de contratos, campos del
  formulario definidos por la plantilla, e importar CSV de HubSpot o Pipedrive con la tabla de equivalencias.
