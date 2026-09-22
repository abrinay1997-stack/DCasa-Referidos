-- Las ventas: el comprobante con sus artículos, y lo que lo une a los puntos.
--
-- ---------------------------------------------------------------------------
-- ESTO NO ES UNA FACTURA FISCAL, Y NO PUEDE SERLO
--
-- En Panamá una factura la emite un equipo fiscal autorizado o un proveedor de
-- facturación electrónica habilitado por la DGI. Este sistema no es ninguna de
-- las dos cosas y no va a fingir que lo es: un papel que parece una factura y
-- no lo es le crea a D'CASA un problema con la DGI, no se lo resuelve.
--
-- Lo que esto es: **el comprobante de la venta**. Guarda qué se vendió, a
-- quién, por cuánto y quién la hizo; se imprime y se manda por WhatsApp; y
-- lleva escrito EL NÚMERO DE LA FACTURA FISCAL que sí emitió el equipo de la
-- tienda. La factura es de la DGI; el historial del cliente es de D'CASA.
--
-- Por eso `factura_fiscal` es obligatorio y único: es la misma defensa
-- antifraude que ya tenía `compras.factura_normal` —una factura, una carga— y
-- el ancla que permite cuadrar este historial contra la contabilidad de verdad.
--
-- ---------------------------------------------------------------------------
-- EL DOCUMENTO ES LA FUENTE DE VERDAD
--
-- `documento` es el JSON completo de la venta: las líneas con su descripción,
-- su cantidad y su precio, los totales, y una FOTO de los datos del cliente tal
-- como estaban ese día. De ahí se reimprime un comprobante idéntico al que se
-- entregó, aunque la ficha se haya corregido diez veces desde entonces.
--
-- Las demás columnas son copias planas de datos que ya están dentro del JSON, y
-- existen solo para listar, buscar y sumar sin abrirlo. Las calcula el Worker
-- con las mismas funciones que usa la pantalla (`compartido/ventas.ts`), no el
-- navegador que envía: así el total del listado no puede discrepar del total
-- del comprobante que el cliente tiene en la mano.
--
-- La foto del cliente dentro del documento y el enlace a su ficha conviven a
-- propósito, y es la regla del hub de B&S: **la ficha manda y el documento toma
-- prestado**. El documento dice lo que decía ese día; la ficha dice lo que es
-- hoy. Ninguno de los dos pisa al otro.
--
-- ---------------------------------------------------------------------------
-- EL DINERO, EN CENTAVOS ENTEROS
--
-- Igual que en `compras` y por lo mismo: `19.99 * 100` en coma flotante da
-- 1998.9999999999998, y eso aquí es dinero de un cliente.
--
-- Se guardan los tres importes por separado —subtotal, ITBMS y total— aunque
-- el tercero sea la suma de los dos primeros. No es redundancia por descuido:
-- el día que un artículo lleve una tasa distinta, o que una venta lleve algo
-- exento, el total seguirá siendo el que se cobró y no habrá que recalcularlo
-- con las reglas de otro año. Se congela lo que se cobró, como se congelan los
-- puntos en `compras`.
-- ---------------------------------------------------------------------------

CREATE TABLE ventas (
  -- 'VTA-2026-0001'. Lo asigna el servidor, nunca el navegador, y se reinicia
  -- cada enero: la numeración de un año no sigue contando en el siguiente.
  numero            TEXT PRIMARY KEY,

  -- La ficha del cliente. SIEMPRE hay una: emitir una venta crea la ficha si no
  -- existía. Una venta sin cliente es una venta que dentro de un mes nadie sabe
  -- de quién fue.
  socio_codigo      TEXT NOT NULL REFERENCES socios(codigo),

  -- El número que imprimió el equipo fiscal de la tienda, tal como lo teclea la
  -- vendedora, y el mismo sin guiones ni ceros de relleno para comparar.
  factura_fiscal    TEXT NOT NULL,
  factura_normal    TEXT NOT NULL,

  -- Instante real de emisión. Es el que ordena el historial.
  emitida_en        TEXT NOT NULL,
  -- El correo del token de Cloudflare Access. Nunca del cuerpo de la petición.
  vendedora         TEXT NOT NULL,

  -- Copias planas para listar y sumar. Todo en centavos enteros.
  subtotal_centavos INTEGER NOT NULL CHECK (subtotal_centavos >= 0),
  itbms_centavos    INTEGER NOT NULL CHECK (itbms_centavos >= 0),
  total_centavos    INTEGER NOT NULL CHECK (total_centavos > 0),
  unidades          INTEGER NOT NULL CHECK (unidades > 0),

  -- La compra que esta venta generó, que es la que acreditó los puntos. Es el
  -- hilo entre la facturación y el programa: con él, la ficha del cliente
  -- responde «esta venta le dio 1,070 puntos» sin adivinar.
  compra_id         TEXT REFERENCES compras(id),
  -- Los puntos que dio, copiados para no tener que abrir la compra al listar.
  puntos            INTEGER NOT NULL DEFAULT 0 CHECK (puntos >= 0),

  documento         TEXT NOT NULL,

  -- Una venta mal emitida no se edita ni se borra: se anula, y la compra que
  -- colgaba de ella se anula con ella en el mismo batch, y el libro mayor
  -- recibe su asiento contrario. El comprobante que el cliente tiene en la mano
  -- no se puede deshacer, así que el sistema tampoco finge que sí.
  anulada_en        TEXT,
  anulada_por       TEXT,
  anulada_motivo    TEXT NOT NULL DEFAULT ''
);

-- Una factura fiscal, una venta. Alcanza también a las anuladas, a propósito:
-- volver a emitir sobre una factura anulada tiene que ser una decisión
-- consciente y no un segundo registro que duplica los puntos.
CREATE UNIQUE INDEX ventas_factura ON ventas (factura_normal);

-- El historial se abre siempre por lo último emitido.
CREATE INDEX ventas_por_emision ON ventas (emitida_en DESC);
-- «Qué le hemos vendido a este cliente» es lo que pregunta su ficha cada vez
-- que alguien la abre.
CREATE INDEX ventas_por_cliente ON ventas (socio_codigo, emitida_en DESC);
-- El reporte por vendedora, ahora también en dinero y no solo en puntos.
CREATE INDEX ventas_por_vendedora ON ventas (vendedora, emitida_en);

-- El consecutivo de ventas, un contador por año.
--
-- Vive en la base y no en el navegador por lo mismo que en el hub de B&S: con
-- dos vendedoras facturando el mismo sábado, un contador local reparte el
-- mismo número a dos clientes y nadie se entera hasta que los dos enseñan su
-- comprobante.
CREATE TABLE consecutivos (
  anio  TEXT PRIMARY KEY,
  valor INTEGER NOT NULL
);
