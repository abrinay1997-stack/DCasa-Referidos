-- El canje se aplica EN la venta, y queda escrito cuál.
--
-- ---------------------------------------------------------------------------
-- EL AGUJERO QUE ESTO CIERRA
--
-- Hasta ahora los premios y las ventas vivían en dos mundos que no se hablaban.
-- Un socio canjeaba «$10 de descuento», le salía un código, lo enseñaba en la
-- tienda, y la vendedora... tecleaba 10.00 a mano en el campo de descuento de
-- la venta. Eso dejaba cuatro problemas a la vez:
--
--   · Nadie podía demostrar después que ese descuento fue un canje y no una
--     rebaja de mostrador. Para el historial eran indistinguibles.
--   · El mismo código se podía aplicar en dos ventas, o entregarse sin
--     aplicarse, o aplicarse sin entregarse. Los puntos salían del saldo al
--     PEDIR el premio, así que el descuento de más no descuadraba nada
--     visible: simplemente se regalaba dinero.
--   · Se podía teclear un importe distinto del que valía el premio.
--   · Y la venta no sabía qué parte de su descuento era dinero de puntos, que
--     es justo lo que hay que separar para saber cuánto cuesta el programa.
--
-- Ahora el código del premio se teclea en la venta, el servidor lo cobra, lo
-- marca entregado en el MISMO batch, y el enlace queda por los dos lados.
-- ---------------------------------------------------------------------------

-- En qué venta se aplicó. NULL en los canjes entregados a mano, que siguen
-- siendo válidos: un premio puede ser un producto que se entrega sin venta.
ALTER TABLE canjes ADD COLUMN venta_numero TEXT REFERENCES ventas(numero);

-- «¿Qué canjes se aplicaron en esta venta?» es lo que pregunta el comprobante
-- al reimprimirse y el reporte al sumar lo que cuesta el programa.
CREATE INDEX canjes_por_venta ON canjes (venta_numero) WHERE venta_numero IS NOT NULL;

-- Cuánto del descuento de una venta es dinero de puntos.
--
-- Se guarda aparte de `descuento` —el de negociación— porque son dos cosas
-- distintas que el dueño necesita ver separadas: una es margen que se cede
-- para cerrar la venta, y la otra es el programa de puntos pagándose solo.
-- Sumarlas en una cifra hace imposible responder «¿cuánto me costó el programa
-- este mes?» sin volver a abrir venta por venta.
ALTER TABLE ventas ADD COLUMN canje_centavos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ventas ADD COLUMN descuento_centavos INTEGER NOT NULL DEFAULT 0;
