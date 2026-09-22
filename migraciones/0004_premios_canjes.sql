-- Los premios y los canjes: por dónde SALEN los puntos.
--
-- Hasta aquí el programa solo sabía acreditar. Esto cierra el ciclo: el socio
-- pide un premio desde su teléfono, le sale un código, lo enseña en la tienda y
-- una vendedora se lo entrega.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ LOS PREMIOS VIVEN EN LA BASE Y NO EN datos/*.json
--
-- Porque Marcial los va a cambiar sin avisar a nadie, y no va a abrir un pull
-- request para subir un premio de 2.000 a 2.500 puntos.
--
-- Las REGLAS del programa —cuántos puntos da un dólar, cuánto gana un padrino—
-- sí viven en `datos/puntos.json`: son decisiones que cambian poco y que, si
-- cambian, tienen que quedar en el historial de git con quién y cuándo. El
-- catálogo es otra cosa: es inventario, cambia con la temporada, y su sitio es
-- una tabla.
-- ---------------------------------------------------------------------------

CREATE TABLE premios (
  id             TEXT PRIMARY KEY,
  nombre         TEXT NOT NULL,
  descripcion    TEXT NOT NULL DEFAULT '',

  -- `descuento` se aplica sobre una compra nueva; `producto` se entrega y ya.
  -- La diferencia importa en el mostrador: un descuento obliga al socio a
  -- volver y comprar otra vez, que es medio punto del programa.
  tipo           TEXT NOT NULL DEFAULT 'descuento'
                   CHECK (tipo IN ('descuento', 'producto')),

  puntos         INTEGER NOT NULL CHECK (puntos > 0),

  -- ---------------------------------------------------------------------
  -- LOS DOS IMPORTES, Y NO UNO
  --
  -- `valor_centavos` es lo que el socio cree que recibe. `costo_centavos` es
  -- lo que de verdad le cuesta a D'CASA.
  --
  -- En un descuento de $5 los dos son 500 y da igual. En un producto NO: un
  -- artículo que se vende a $30 y cuyo costo nacionalizado es $11 se puede
  -- ofrecer como premio de 2.000 puntos —el socio percibe $30 de valor por
  -- $20 de puntos— mientras a la tienda le cuesta $11.
  --
  -- Guardarlos separados es lo único que permite responder «¿cuánto nos ha
  -- costado el programa?» sin volver a abrir el inventario producto por
  -- producto. Sin esta columna, el informe solo sabría decir cuántos puntos
  -- salieron, que no es lo mismo que cuánto dinero.
  -- ---------------------------------------------------------------------
  valor_centavos INTEGER NOT NULL DEFAULT 0 CHECK (valor_centavos >= 0),
  costo_centavos INTEGER NOT NULL DEFAULT 0 CHECK (costo_centavos >= 0),

  -- NULL = sin límite. 0 = agotado, y deja de ofrecerse solo.
  stock          INTEGER,

  imagen         TEXT NOT NULL DEFAULT '',
  activo         INTEGER NOT NULL DEFAULT 1,
  orden          INTEGER NOT NULL DEFAULT 0,

  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE INDEX premios_vitrina ON premios (activo, orden, puntos);


-- ---------------------------------------------------------------------------
-- LOS CANJES, Y POR QUÉ LOS PUNTOS SE DESCUENTAN AL PEDIR
--
-- El socio pide el premio desde su casa y tiene 72 horas para pasar por la
-- tienda. Si los puntos se descontaran al ENTREGAR, en esas 72 horas podría
-- pedir tres premios con saldo para uno, y los tres le saldrían con código.
-- El primero que llegara al mostrador se lo llevaría; los otros dos serían dos
-- clientes con un código en la mano al que la tienda tendría que decir que no.
--
-- Se descuentan al pedir, como una reserva. Si el código vence o se cancela, el
-- libro mayor recibe un asiento contrario y los puntos vuelven enteros.
--
-- LO QUE SE CONGELA AL PEDIR
--
-- El nombre, los puntos y los dos importes se copian a esta tabla. Si mañana
-- el premio sube a 2.500 puntos, quien lo pidió a 2.000 lo recibe a 2.000: eso
-- fue lo que se le dijo. Y el informe de costo sigue cuadrando aunque el
-- catálogo haya cambiado diez veces.
-- ---------------------------------------------------------------------------

CREATE TABLE canjes (
  id             TEXT PRIMARY KEY,

  -- Lo que el socio enseña y la vendedora teclea. Seis caracteres del mismo
  -- alfabeto sin ambigüedades que los códigos de socio: alguien lo va a leer
  -- en voz alta desde una pantalla rayada.
  codigo         TEXT NOT NULL UNIQUE,

  socio_codigo   TEXT NOT NULL REFERENCES socios(codigo),

  premio_id      TEXT NOT NULL REFERENCES premios(id),
  premio_nombre  TEXT NOT NULL,
  premio_tipo    TEXT NOT NULL DEFAULT 'descuento',
  puntos         INTEGER NOT NULL CHECK (puntos > 0),
  valor_centavos INTEGER NOT NULL DEFAULT 0,
  costo_centavos INTEGER NOT NULL DEFAULT 0,

  estado         TEXT NOT NULL DEFAULT 'solicitado'
                   CHECK (estado IN ('solicitado', 'entregado', 'vencido', 'cancelado')),

  solicitado_en  TEXT NOT NULL,
  expira_en      TEXT NOT NULL,
  entregado_en   TEXT,
  entregado_por  TEXT,
  cerrado_en     TEXT,
  cerrado_motivo TEXT NOT NULL DEFAULT ''
);

CREATE INDEX canjes_socio ON canjes (socio_codigo, solicitado_en DESC);
-- La consulta del trabajo que vence los códigos, y la lista del panel.
CREATE INDEX canjes_pendientes ON canjes (estado, expira_en);


-- ---------------------------------------------------------------------------
-- LA ESCALERA DE DESCUENTOS
--
-- Cinco premios para arrancar, y ninguno toca el inventario: son descuentos
-- puros, derivados de la equivalencia ya decidida de 100 puntos = $1.
--
-- Se siembran aquí para que el programa tenga algo que ofrecer el primer día.
-- Marcial los edita, los desactiva o añade productos desde el panel; esto es un
-- punto de partida, no una decisión cerrada.
--
-- Deliberadamente NO hay premios de producto todavía: elegirlos bien exige
-- mirar el inventario producto por producto —costo nacionalizado contra precio
-- y stock— y decidir cuáles se pueden regalar sin comerse el margen. Eso es una
-- conversación con números delante, no un INSERT.
-- ---------------------------------------------------------------------------

INSERT INTO premios
  (id, nombre, descripcion, tipo, puntos, valor_centavos, costo_centavos, orden, creado_en, actualizado_en)
VALUES
  ('desc-5',   '$5 de descuento',   'Se aplica en tu próxima compra.', 'descuento',   500,   500,   500, 1, '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z'),
  ('desc-10',  '$10 de descuento',  'Se aplica en tu próxima compra.', 'descuento',  1000,  1000,  1000, 2, '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z'),
  ('desc-25',  '$25 de descuento',  'Se aplica en tu próxima compra.', 'descuento',  2500,  2500,  2500, 3, '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z'),
  ('desc-50',  '$50 de descuento',  'Se aplica en tu próxima compra.', 'descuento',  5000,  5000,  5000, 4, '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z'),
  ('desc-100', '$100 de descuento', 'Se aplica en tu próxima compra.', 'descuento', 10000, 10000, 10000, 5, '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z');
