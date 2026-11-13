-- CRM de Chocosys (sprint 3, 20-10-2026). El modelo de cualquier CRM básico (HubSpot, Pipedrive, Zoho, Odoo):
-- empresas, contactos, negocios en un embudo de etapas, actividades e historial. Lo explica crm\ESQUEMA.md.
-- Las etapas, los tipos de actividad y las reglas de «qué requiere atención hoy» son filas, no código.

CREATE TABLE IF NOT EXISTS empresa (            -- company / organization
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  rut TEXT,
  tipo TEXT NOT NULL DEFAULT 'cliente',         -- cliente · proveedor · otro
  rubro TEXT, ciudad TEXT, notas TEXT,
  creado TEXT NOT NULL, actualizado TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacto (           -- contact / person (dato personal: solo lo necesario, Ley 21.719)
  id INTEGER PRIMARY KEY,
  empresa_id INTEGER REFERENCES empresa(id) ON DELETE SET NULL,
  nombre TEXT NOT NULL,
  cargo TEXT, correo TEXT, telefono TEXT, notas TEXT,
  creado TEXT NOT NULL, actualizado TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS etapa (              -- pipeline stage
  id INTEGER PRIMARY KEY,
  embudo TEXT NOT NULL DEFAULT 'Trabajos',      -- pipeline
  nombre TEXT NOT NULL,
  orden INTEGER NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'abierta',         -- abierta · ganada · perdida
  probabilidad INTEGER,                         -- deal probability (sprint 26): 0 a 100; vacía = la etapa no pondera
  UNIQUE (embudo, nombre)
);

CREATE TABLE IF NOT EXISTS negocio (            -- deal / opportunity: cada trabajo es un negocio
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  entorno TEXT,                                 -- de quién es el negocio: la empresa, la consultora…
  empresa_id INTEGER REFERENCES empresa(id) ON DELETE SET NULL,    -- el cliente
  contacto_id INTEGER REFERENCES contacto(id) ON DELETE SET NULL,
  etapa_id INTEGER NOT NULL REFERENCES etapa(id),
  monto REAL, moneda TEXT DEFAULT 'CLP',        -- monto esperado; la plata real se lee del libro de control
  carpeta TEXT,                                 -- la carpeta AAAA-MM_proyecto del trabajo
  cierre_esperado TEXT,
  creado TEXT NOT NULL, actualizado TEXT NOT NULL,
  etapa_desde TEXT NOT NULL,                    -- desde cuándo está en su etapa actual (para «quieto hace N días»)
  tipo TEXT,                                    -- deal type (sprint 6): web · cotización · contrato · otro; decide su carpeta
  proyecto_id INTEGER REFERENCES proyecto(id) ON DELETE SET NULL,  -- el proyecto grande al que pertenece (sprint 6)
  origen TEXT,                                  -- lead source (sprint 6): por dónde llegó
  probabilidad INTEGER                          -- sprint 26: la pisada a mano (0 a 100); vacía = sigue a la de su etapa.
                                                -- El ponderado (monto × probabilidad / 100) se calcula al leer, no se guarda
);

-- Sprint 6 (20-10-2026): un proyecto grande agrupa negocios y encargos que comparten papelería, imágenes y marca.
CREATE TABLE IF NOT EXISTS proyecto (           -- project
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  entorno TEXT,
  carpeta TEXT,                                 -- con PROYECTO.md, _compartido\ y encargos\
  estado TEXT NOT NULL DEFAULT 'activo',        -- activo · cerrado
  notas TEXT,
  creado TEXT NOT NULL, actualizado TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actividad (          -- activity / task: la próxima acción y a quién le toca
  id INTEGER PRIMARY KEY,
  negocio_id INTEGER REFERENCES negocio(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'tarea',           -- tarea · llamada · correo · reunión · nota
  que TEXT NOT NULL,
  responsable TEXT,                             -- una persona · cliente · proveedor · un agente…
  vence TEXT,                                   -- opcional: no todo tiene plazo
  hecha INTEGER NOT NULL DEFAULT 0,
  hecha_el TEXT,
  creado TEXT NOT NULL, actualizado TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS historial (          -- audit log: todo cambio, de quien sea
  id INTEGER PRIMARY KEY,
  cuando TEXT NOT NULL,
  autor TEXT NOT NULL,                          -- el nombre del perfil · mcp:<sesión> · migración · sistema
  objeto TEXT NOT NULL, objeto_id INTEGER NOT NULL,
  accion TEXT NOT NULL,                         -- crear · cambiar · borrar
  campo TEXT, antes TEXT, despues TEXT
);

CREATE TABLE IF NOT EXISTS regla (              -- qué requiere atención hoy (editable)
  id INTEGER PRIMARY KEY,
  rotulo TEXT NOT NULL,
  condicion TEXT NOT NULL,                      -- actividad_vencida · vence_pronto · etapa_quieta · sin_proxima_accion · sin_plazo_estancada
  etapa TEXT,                                   -- para etapa_quieta
  dias INTEGER NOT NULL DEFAULT 0,
  activa INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS control (            -- la plata, leída del libro de control o de las OC (nunca tecleada)
  negocio_id INTEGER PRIMARY KEY REFERENCES negocio(id) ON DELETE CASCADE,
  archivo TEXT, huella TEXT, leido TEXT,
  moneda TEXT, costo REAL, venta REAL,
  fuentes TEXT                                  -- JSON: de qué archivo, hoja y celda salió cada número (sprint 6)
);

CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT);

-- Sprint 4 (20-10-2026): lo que pide cada etapa y los documentos de cada negocio.
CREATE TABLE IF NOT EXISTS requisito (          -- required properties / checklist por etapa
  id INTEGER PRIMARY KEY,
  etapa_id INTEGER NOT NULL REFERENCES etapa(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,                           -- dato · documento · actividades_al_dia
  clave TEXT NOT NULL,                          -- dato: campo del negocio (monto, empresa_id…); documento: su tipo (OC, Factura…)
  texto TEXT NOT NULL,                          -- cómo se muestra: «Orden de compra del cliente»
  patron TEXT                                   -- documento: cómo reconocerlo por nombre en la carpeta (expresión regular, opcional)
);

CREATE TABLE IF NOT EXISTS documento (          -- attachments: el archivo vive en la carpeta del negocio, acá solo la ficha
  id INTEGER PRIMARY KEY,
  negocio_id INTEGER NOT NULL REFERENCES negocio(id) ON DELETE CASCADE,
  tipo TEXT,                                    -- calza con requisito.clave cuando es un documento pedido
  nombre TEXT NOT NULL, ruta TEXT NOT NULL,
  subido TEXT NOT NULL, autor TEXT
);

CREATE INDEX IF NOT EXISTS actividad_pendiente ON actividad(hecha, vence);
CREATE INDEX IF NOT EXISTS historial_objeto ON historial(objeto, objeto_id);
