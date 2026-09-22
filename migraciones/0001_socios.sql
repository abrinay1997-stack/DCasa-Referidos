-- La libreta de socios del programa de fidelidad de D'CASA.
--
-- Un socio es una persona que compró alguna vez en la tienda y que decidió
-- entrar al programa escaneando el QR. No es un usuario con cuenta de correo:
-- es alguien con un celular panameño y un PIN de seis dígitos, que entra desde
-- el teléfono estando de pie en el mostrador.
--
-- ---------------------------------------------------------------------------
-- CÓMO SE RECONOCE A UN SOCIO
--
-- Por su celular, y por nada más. `telefono_normal` son los ocho dígitos del
-- número nacional, sin el +507, normalizados con `whatsappNormal()` de
-- `compartido/texto.ts`: para la base, `+507 6026-1919` y `60261919` son la
-- misma persona. Ese índice único es la defensa antifraude más importante de
-- todo el programa: sin él, cualquiera abre cinco cuentas y se refiere a sí
-- mismo.
--
-- El `codigo` NO sirve para reconocer a nadie —cuando alguien llega, todavía no
-- tiene— sino para nombrarlo, enlazarlo y, sobre todo, para que lo comparta.
-- ---------------------------------------------------------------------------

CREATE TABLE socios (
  -- 'DCA' + 6 caracteres de un alfabeto sin ambigüedades (sin O/0, sin I/1/L).
  -- Es a la vez su identificador y su código de referido.
  --
  -- ALEATORIO Y NO CORRELATIVO, a propósito. Un código correlativo publica
  -- cuántos socios tiene el programa cada vez que alguien comparte el suyo por
  -- WhatsApp, y 'DCA-000007' le dice a ese socio que es el séptimo de la
  -- historia. Ninguna de las dos cosas le sirve a nadie, y las dos cuestan.
  codigo             TEXT PRIMARY KEY,

  nombre             TEXT NOT NULL,
  apellido           TEXT NOT NULL DEFAULT '',

  -- Tal como lo tecleó, con sus guiones y sus espacios.
  telefono           TEXT NOT NULL,
  -- Los ocho dígitos nacionales. Es la columna con la que se compara y con la
  -- que se entra.
  telefono_normal    TEXT NOT NULL,

  cedula             TEXT NOT NULL DEFAULT '',
  cedula_digitos     TEXT NOT NULL DEFAULT '',
  correo             TEXT NOT NULL DEFAULT '',
  correo_normal      TEXT NOT NULL DEFAULT '',

  -- Solo 'MM-DD'. El año de nacimiento no hace falta para felicitar a alguien
  -- y es un dato personal más que custodiar sin ganar nada a cambio.
  cumple             TEXT NOT NULL DEFAULT '',

  -- El PIN, derivado con PBKDF2-SHA256 y una sal por socio. Antes de derivar
  -- se le concatena `PIMIENTA_PIN`, que es un secreto del Worker y vive fuera
  -- de esta base: un volcado robado sin la pimienta no se puede atacar por
  -- fuerza bruta, y seis dígitos se rompen en segundos sin ella.
  --
  -- `pin_iteraciones` se guarda por socio para poder subir el coste en el
  -- futuro y volver a derivar al siguiente acceso correcto, sin dejar fuera a
  -- nadie de golpe.
  pin_hash           TEXT NOT NULL,
  pin_salt           TEXT NOT NULL,
  pin_iteraciones    INTEGER NOT NULL,
  pin_cambiado_en    TEXT NOT NULL,

  -- Cuando una vendedora reinicia el PIN, el socio tiene que elegir uno nuevo
  -- antes de ver nada. Sin esto, el PIN temporal que la vendedora dictó en voz
  -- alta en el mostrador se queda puesto para siempre.
  pin_temporal       INTEGER NOT NULL DEFAULT 0,

  -- El candado contra fuerza bruta. A los 5 fallos, 15 minutos; a los 10, 24
  -- horas. Es la mitad de la defensa: la otra es una regla de Rate Limiting de
  -- Cloudflare sobre /api/socio/entrar, porque este candado no ve al atacante
  -- que prueba '123456' contra diez mil teléfonos distintos.
  intentos_fallidos  INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta    TEXT,

  -- Quién lo trajo.
  --
  -- SE ESCRIBE UNA VEZ, AL DARSE DE ALTA, Y NO SE TOCA NUNCA MÁS. Ni el socio
  -- ni una vendedora pueden cambiar de padrino después. Si se pudiera, bastaría
  -- con esperar a que alguien compre mucho para reclamarlo como referido.
  referido_por       TEXT REFERENCES socios(codigo),
  referido_en        TEXT,
  -- Cuándo se le pagó al padrino. Es lo que impide pagar dos veces, incluso si
  -- la primera compra se anula y se vuelve a registrar.
  referido_pagado_en TEXT,

  estado             TEXT NOT NULL DEFAULT 'activo'
                       CHECK (estado IN ('activo', 'suspendido')),

  -- El consentimiento del alta, guardado con la versión aceptada. Lo pide la
  -- Ley 81 de 2019 de Protección de Datos Personales de Panamá, y además hace
  -- falta para saber a quién hay que volver a pedírselo cuando los términos
  -- cambien.
  terminos_version     INTEGER NOT NULL DEFAULT 0,
  terminos_aceptados_en TEXT,

  creado_en          TEXT NOT NULL,
  -- 'qr' si se dio de alta él solo, o el correo de la vendedora que lo dio de
  -- alta en el mostrador.
  creado_por         TEXT NOT NULL DEFAULT 'qr',
  actualizado_en     TEXT NOT NULL,

  -- La papelera, en dos tiempos, igual que en los otros dos hubs y por lo
  -- mismo: retirar a alguien tiene que poder deshacerse.
  eliminado_en       TEXT,
  eliminado_por      TEXT,

  -- Nadie es su propio padrino. La base lo impone en vez de confiar en que el
  -- código se acuerde de comprobarlo.
  CHECK (referido_por IS NULL OR referido_por <> codigo)
);

-- Un teléfono, un socio.
--
-- Alcanza también a los de la papelera, a propósito: quien vuelve tiene que
-- encontrarse con «está retirado, ¿lo restauro?» y no con una cuenta nueva y
-- sus puntos viejos perdidos en la anterior.
CREATE UNIQUE INDEX socios_telefono ON socios (telefono_normal);

-- Parcial, porque la cédula es opcional y la mayoría no la va a dar en el
-- mostrador.
CREATE UNIQUE INDEX socios_cedula
  ON socios (cedula_digitos) WHERE cedula_digitos <> '';

CREATE INDEX socios_referido_por ON socios (referido_por) WHERE referido_por IS NOT NULL;
CREATE INDEX socios_papelera ON socios (eliminado_en, creado_en);
CREATE INDEX socios_cumple ON socios (cumple) WHERE cumple <> '';
