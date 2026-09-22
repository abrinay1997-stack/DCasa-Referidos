-- La ficha del cliente: el socio deja de ser solo «el del programa de puntos».
--
-- ---------------------------------------------------------------------------
-- LA DECISIÓN: UNA SOLA FICHA, Y EL PROGRAMA ES UNA CASILLA
--
-- La pregunta era si un cliente y un socio son la misma cosa. La respuesta que
-- implementa esta migración es que **son la misma ficha en dos momentos**.
--
-- Todo el que compra en D'CASA tiene una ficha aquí. La ficha guarda quién es
-- y todo lo que compró. Estar EN EL PROGRAMA —tener un PIN, ver los puntos
-- desde el teléfono, invitar gente— es un estado de esa ficha, no otro
-- registro.
--
-- La alternativa era una tabla `clientes` aparte. Se descartó por una razón
-- concreta y cara: en el momento en que hay dos tablas, alguien tiene que
-- responder «¿este cliente es aquel socio?» cada vez que llega una venta. Esa
-- pregunta no tiene respuesta fiable —el hub de B&S tiene una escalera de
-- cuatro peldaños y aun así pregunta antes de unir— y cada vez que se responde
-- mal, los puntos de una persona quedan partidos entre dos fichas.
--
-- Con una sola ficha y una sola llave —el celular, que ya tiene índice único—
-- esa pregunta no existe.
--
-- ---------------------------------------------------------------------------
-- UNA FICHA PUEDE NO TENER PIN, Y ESO ES UN CLIENTE
--
-- Hasta hoy, crear una ficha exigía un PIN: solo existía el camino del QR.
-- Ahora una venta en el mostrador crea la ficha de alguien que no quiso —o no
-- pudo, o tenía prisa— entrar al programa en ese momento. Esa ficha lleva
-- `pin_hash = ''`.
--
-- Vacío NO es un PIN débil: `pin_hash` guarda 32 bytes en base64, así que la
-- cadena vacía no es el resultado de derivar nada y no puede coincidir con
-- ninguna comprobación. Aun así, `worker/sesion.ts` exige ficha reclamada
-- antes de comparar, y `herramientas/verificar.mjs` vigila que siga exigiéndolo.
--
-- La columna no lleva un CHECK que lo imponga porque añadirlo obliga a
-- reconstruir `socios` entera, y hay cuatro claves foráneas apuntando aquí
-- —compras, movimientos, canjes y el propio referido_por—. La invariante vive
-- en el código, en el verificador y en las pruebas; el coste de la otra opción
-- era un rebuild de tabla viva a cambio de repetir algo que ya está vigilado.
--
-- ---------------------------------------------------------------------------
-- LOS PUNTOS CORREN AUNQUE LA FICHA NO ESTÉ RECLAMADA
--
-- Una venta a una ficha sin PIN acredita sus puntos igual. Quedan esperando.
--
-- No es un detalle técnico, es lo que cambia la conversación en el mostrador:
-- en vez de «¿quiere registrarse en nuestro programa?» —a lo que casi todo el
-- mundo dice que no— la vendedora dice «tiene $18.40 en puntos esperándolo,
-- escanee aquí para reclamarlos». Lo segundo se acepta y lo primero no.
--
-- Con dos consecuencias que el sistema respeta:
--
--   · El pasivo del programa se reporta PARTIDO en dos: lo reclamado y lo que
--     espera. Mezclarlos daría una deuda inflada con dinero que quizá nadie
--     reclame nunca.
--   · Una ficha sin reclamar NO ha aceptado nada. `terminos_version` se queda
--     en 0 y nadie le escribe: los datos que dio son los de su factura, y la
--     Ley 81 de 2019 no convierte una venta en un permiso para hacer mercadeo.
--     El consentimiento se pide cuando reclama la ficha, no antes.
-- ---------------------------------------------------------------------------

-- Dónde se entrega. En una mueblería no es un adorno del listado: es la mitad
-- de la venta, y hoy vive en un cuaderno.
ALTER TABLE socios ADD COLUMN direccion TEXT NOT NULL DEFAULT '';

-- Lo que la vendedora necesita recordar de esta persona y no cabe en ninguna
-- otra columna. «Compra para la casa de playa», «prefiere que la llamen por la
-- tarde».
ALTER TABLE socios ADD COLUMN notas TEXT NOT NULL DEFAULT '';

-- Quién la atiende. Decide a quién preguntarle por ella, y es lo que hace que
-- el reporte por vendedora sirva para algo más que contar puntos.
ALTER TABLE socios ADD COLUMN atendido_por TEXT NOT NULL DEFAULT '';

-- El nombre completo sin tildes ni mayúsculas. Es lo que ordena la libreta
-- —ordenar por `nombre` a secas pondría «Ávila» detrás de «Zapata»— y por
-- donde busca el buscador.
--
-- El relleno de abajo es APROXIMADO: SQLite no sabe quitar tildes, así que las
-- fichas que ya existen quedan con su nombre en minúsculas pero con tildes. El
-- Worker escribe la buena en cada alta y en cada edición, así que cada ficha se
-- corrige sola la primera vez que alguien la toca. Se aceptó porque el coste de
-- la alternativa —una tabla de traducción de acentos en SQL— es mayor que el de
-- que unas pocas fichas viejas se ordenen un renglón más abajo de lo que toca.
ALTER TABLE socios ADD COLUMN nombre_normal TEXT NOT NULL DEFAULT '';
UPDATE socios SET nombre_normal = lower(trim(nombre || ' ' || apellido));

-- La libreta se abre en orden alfabético, y la papelera es la otra mitad de
-- todas sus consultas. El índice que ya había ordena por fecha de alta, que es
-- lo que quiere el reporte y no lo que quiere la libreta.
CREATE INDEX socios_libreta ON socios (eliminado_en, nombre_normal);

-- «Las fichas que atiende Fulana» y «las que no atiende nadie» son las dos
-- consultas que hace el reparto de clientes.
CREATE INDEX socios_atendido ON socios (atendido_por) WHERE atendido_por <> '';
