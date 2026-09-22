-- EL LIBRO MAYOR. Es la única verdad sobre los puntos de cualquier socio.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ `socios` NO TIENE UNA COLUMNA `saldo`
--
-- Es la misma decisión que la ausencia de una columna `total` en las propuestas
-- de PanaClaw, y por la misma razón.
--
-- Una columna `saldo` es el sitio más barato del mundo para que el número se
-- despegue del libro que lo explica. En cuanto existe, cualquier consulta
-- futura la usa sin preguntar de qué está hecha, y el día que una actualización
-- falle a medias —o que alguien escriba un asiento sin acordarse de sumar— el
-- socio ve un número que ninguna fila justifica. Nadie mira una base de datos,
-- así que eso no se descubre: se descubre en el mostrador, con una vendedora
-- que no puede explicarle al cliente de dónde sale su saldo.
--
-- El saldo es SUM(puntos) de esta tabla, y no existe en ningún otro sitio. A la
-- escala de esta tienda —miles de filas, no millones— la suma es gratis. Si
-- algún día deja de serlo, la respuesta es una vista materializada que se
-- recalcula DESDE AQUÍ, nunca una columna que se escribe a mano.
--
-- `herramientas/verificar.mjs` comprueba que ninguna migración añada una
-- columna `saldo`, y para el build si aparece. La invariante se defiende
-- mecánicamente, no con buena voluntad.
--
-- POR QUÉ NADA SE EDITA NI SE BORRA
--
-- Un asiento es inmutable. Corregir una compra mal registrada NO es un UPDATE:
-- es un asiento de tipo 'reverso' que apunta al original con la misma cifra en
-- negativo. Así la cuenta del socio cuenta su propia historia, los errores
-- incluidos, y la suma sigue cuadrando en todo momento. Un libro que se puede
-- editar no es un libro, es un borrador.
--
-- Y el socio lee esa historia en su app. Que pueda ver por qué le quitaron
-- puntos, con el motivo escrito, es lo que hace que el programa sea creíble:
-- es la regla de marca «di qué no incluye» aplicada a un saldo.
-- ---------------------------------------------------------------------------

CREATE TABLE movimientos (
  id             TEXT PRIMARY KEY,
  socio_codigo   TEXT NOT NULL REFERENCES socios(codigo),
  ocurrido_en    TEXT NOT NULL,

  tipo           TEXT NOT NULL CHECK (tipo IN (
                   'bienvenida',   -- el alta del socio
                   'compra',       -- su propia compra
                   'referido',     -- la primera compra de alguien que él trajo
                   'canje',        -- pidió un premio (negativo)
                   'ajuste',       -- corrección manual de una vendedora
                   'reverso',      -- anula otro asiento
                   'cumpleanos',   -- regalo de cumpleaños
                   'vencimiento'   -- puntos caducados (negativo)
                 )),

  -- Positivo suma, negativo resta. Nunca cero: un asiento de cero es ruido que
  -- ensucia la bitácora que lee el socio sin decirle nada.
  puntos         INTEGER NOT NULL CHECK (puntos <> 0),

  -- De dónde viene. En la fase 1 estas tres referencias apuntan a tablas que
  -- todavía no existen, así que se declaran sin FOREIGN KEY y la integridad la
  -- pone la migración 0004, cuando `compras` y `canjes` estén creadas.
  compra_id      TEXT,
  canje_id       TEXT,
  -- En un asiento 'referido': quién hizo la compra que lo generó. Es lo que
  -- permite enseñarle al padrino «ganaste 150 puntos por la compra de Ana».
  origen_socio   TEXT REFERENCES socios(codigo),
  -- En un asiento 'reverso': qué asiento anula.
  reversa_a      TEXT REFERENCES movimientos(id),

  -- Obligatorio en 'ajuste' y en 'reverso'. Se le enseña al socio tal cual, así
  -- que se escribe pensando en que lo va a leer él, no en que lo lea un auditor.
  motivo         TEXT NOT NULL DEFAULT '',

  -- El correo del token de Cloudflare Access, o 'sistema' para lo automático.
  -- NUNCA del cuerpo de la petición: si el navegador lo pudiera enviar, esta
  -- columna no valdría nada como auditoría.
  autor          TEXT NOT NULL,

  -- Cuándo caducan estos puntos. NULL mientras el vencimiento esté apagado en
  -- `datos/puntos.json`, que es como nace el programa.
  vence_en       TEXT
);

-- La bitácora del socio, que es la consulta más frecuente de toda la app.
CREATE INDEX movimientos_socio ON movimientos (socio_codigo, ocurrido_en DESC);
CREATE INDEX movimientos_tipo ON movimientos (tipo, ocurrido_en);
CREATE INDEX movimientos_vence ON movimientos (vence_en) WHERE vence_en IS NOT NULL;
CREATE INDEX movimientos_origen ON movimientos (origen_socio) WHERE origen_socio IS NOT NULL;

-- Un reverso anula UN asiento, y una sola vez. Sin esto, dos anulaciones
-- seguidas de la misma compra restan los puntos dos veces.
CREATE UNIQUE INDEX movimientos_reversa ON movimientos (reversa_a) WHERE reversa_a IS NOT NULL;
