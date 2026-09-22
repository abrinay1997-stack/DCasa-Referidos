-- Las compras que suman puntos.
--
-- Las registra una vendedora desde el panel, con el cliente delante: busca al
-- socio, teclea el número de factura y el monto, y los puntos caen al instante.
-- No se toca el sistema de facturación de la tienda — aquí solo se anota que
-- esa factura existió y por cuánto.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ SE GUARDAN LOS PUNTOS Y LA BASE, SI SE PODRÍAN RECALCULAR
--
-- Porque dentro de un año las reglas serán otras.
--
-- Si `puntos` se recalculara al leer, el día que D'CASA pase de 1 punto por
-- dólar a 2, todas las compras viejas empezarían a decir el doble de lo que
-- dijeron, y el libro mayor —que sí guarda lo que se acreditó— dejaría de
-- cuadrar con las compras que lo explican. Nadie podría responder «¿por qué
-- esta compra me dio 340?».
--
-- Se congelan los tres: la base sobre la que se calculó, los puntos que salieron
-- y la VERSIÓN de las reglas que se usó. Con eso, cualquier compra se puede
-- explicar años después sin adivinar.
-- ---------------------------------------------------------------------------

CREATE TABLE compras (
  id               TEXT PRIMARY KEY,
  socio_codigo     TEXT NOT NULL REFERENCES socios(codigo),

  -- El número de factura de la tienda, tal como lo teclea la vendedora.
  factura          TEXT NOT NULL,
  -- El mismo, sin guiones ni espacios ni ceros de relleno delante. Es la
  -- columna con la que se compara: «F-001234», «f 001234» y «1234» son la
  -- misma factura, y si no se normalizara, cargarla tres veces escrito de tres
  -- formas daría tres veces los puntos.
  factura_normal   TEXT NOT NULL,

  -- Lo que pagó el cliente, completo, en centavos enteros.
  monto_centavos   INTEGER NOT NULL CHECK (monto_centavos > 0),
  -- Sobre cuánto se calcularon los puntos. Distinto de `monto_centavos` si el
  -- ITBMS no cuenta. Ver la cabecera.
  base_centavos    INTEGER NOT NULL CHECK (base_centavos > 0),
  -- Los puntos que generó, congelados.
  puntos           INTEGER NOT NULL CHECK (puntos >= 0),
  -- Con qué versión de datos/puntos.json se calcularon.
  reglas_version   INTEGER NOT NULL,

  registrada_en    TEXT NOT NULL,
  -- El correo del token de Cloudflare Access. NUNCA del cuerpo de la petición:
  -- si el navegador lo pudiera enviar, esta columna no valdría nada como
  -- auditoría, y es la que hace visible el fraude interno.
  vendedor         TEXT NOT NULL,
  notas            TEXT NOT NULL DEFAULT '',

  -- Una compra mal registrada no se edita ni se borra: se anula, y el libro
  -- mayor recibe un asiento contrario. Ver migraciones/0002.
  anulada_en       TEXT,
  anulada_por      TEXT,
  anulada_motivo   TEXT NOT NULL DEFAULT ''
);

-- Una factura, una carga.
--
-- Es la segunda defensa antifraude del programa, después del teléfono único.
-- Sin ella, la misma factura de $800 se registra en tres cuentas distintas y
-- nadie lo nota: el papel se queda en manos del cliente, no del sistema.
--
-- Alcanza también a las anuladas, a propósito: volver a cargar una factura que
-- se anuló tiene que ser una decisión consciente —restaurarla— y no un segundo
-- registro que duplica los puntos.
CREATE UNIQUE INDEX compras_factura ON compras (factura_normal);

CREATE INDEX compras_socio ON compras (socio_codigo, registrada_en DESC);
-- El reporte antifraude: cuántos puntos emite cada vendedora por semana. Si una
-- emite el triple que las otras, aquí se ve.
CREATE INDEX compras_vendedor ON compras (vendedor, registrada_en);
