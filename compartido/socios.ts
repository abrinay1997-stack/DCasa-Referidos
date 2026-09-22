/**
 * Qué es un socio y qué viaja por el cable.
 *
 * Vive fuera del Worker y fuera de las pantallas por lo mismo que `puntos.ts`:
 * las reglas de qué PIN vale y de cómo se lee un código tienen que ser LAS
 * MISMAS en los dos lados. Si la pantalla acepta un PIN que el servidor
 * rechaza, el socio ve «guardando…» y luego un error que no entiende, de pie en
 * el mostrador con la vendedora esperando.
 *
 * Todo lo de aquí es puro. La criptografía —derivar el PIN, firmar la sesión—
 * vive en `worker/sesion.ts`, porque eso sí solo puede pasar en el servidor.
 */

// ---------------------------------------------------------------------------
// El código del socio
// ---------------------------------------------------------------------------

/**
 * El alfabeto de los códigos: 31 caracteres, sin ninguna pareja que se
 * confunda.
 *
 * Fuera van `O` y `0`, `I`, `1` y `L`. No es purismo: este código se lee en voz
 * alta en una tienda con ruido, se teclea desde un teléfono con la pantalla
 * rayada, y se copia a mano de un papel. Cada pareja ambigua que se deja dentro
 * es una vendedora diciendo «¿es o de oso o cero?» varias veces al día.
 *
 * 31 caracteres en 6 posiciones son 887 millones de combinaciones. Para una
 * tienda que va a tener miles de socios, la probabilidad de un choque es
 * despreciable — y aun así el alta lo comprueba contra la base y reintenta,
 * porque «despreciable» no es «imposible» y el que choque se lleva el error.
 */
export const ALFABETO_CODIGO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Lo que va delante. Hace obvio de quién es un código suelto en un papel. */
export const PREFIJO_CODIGO = 'DCA';

export const LARGO_CODIGO = 6;

/**
 * Un código a partir de bytes al azar.
 *
 * Toma los bytes en vez de pedirlos para poder probarse: el que llama trae
 * `crypto.getRandomValues`, y la prueba trae una secuencia conocida.
 *
 * El sesgo del módulo aquí no importa —31 no divide a 256, así que los primeros
 * caracteres del alfabeto salen un pelo más— pero esto no protege nada: el
 * código es un identificador público que se comparte por WhatsApp a propósito,
 * no un secreto. Lo que protege una cuenta es el PIN.
 */
export function codigoDesdeBytes(bytes: Uint8Array): string {
  if (bytes.length < LARGO_CODIGO) {
    throw new RangeError(`Hacen falta ${LARGO_CODIGO} bytes para un código.`);
  }
  let codigo = PREFIJO_CODIGO;
  for (let i = 0; i < LARGO_CODIGO; i += 1) {
    codigo += ALFABETO_CODIGO[bytes[i]! % ALFABETO_CODIGO.length];
  }
  return codigo;
}

/**
 * Normaliza un código tal como lo escribió una persona.
 *
 * `dca-7k2m9p` → `DCA7K2M9P`. Quita espacios y guiones y sube a mayúsculas,
 * porque quien lo copia de un papel pone guiones donde le parece y quien lo
 * teclea en un móvil arrastra el autocorrector de minúsculas.
 */
export function codigoNormal(valor: string | null | undefined): string {
  return (valor ?? '').replace(/[\s-]/g, '').toUpperCase();
}

export function esCodigoValido(valor: string | null | undefined): boolean {
  const codigo = codigoNormal(valor);
  if (codigo.length !== PREFIJO_CODIGO.length + LARGO_CODIGO) return false;
  if (!codigo.startsWith(PREFIJO_CODIGO)) return false;
  return [...codigo.slice(PREFIJO_CODIGO.length)].every((c) => ALFABETO_CODIGO.includes(c));
}

// ---------------------------------------------------------------------------
// El PIN
// ---------------------------------------------------------------------------

export const LARGO_PIN = 6;

/**
 * Seis dígitos y no cuatro.
 *
 * Cuatro son diez mil combinaciones. Esto protege puntos canjeables por
 * muebles, y diez mil combinaciones se agotan solas. Seis son un millón, que
 * con el candado de intentos y el límite por IP delante ya no se agotan.
 */
export type ProblemaPin =
  | 'largo'
  | 'no-son-digitos'
  | 'repetidos'
  | 'secuencia'
  | 'es-el-telefono';

export const EXPLICACION_PIN: Record<ProblemaPin, string> = {
  largo: `Tu PIN son ${LARGO_PIN} números.`,
  'no-son-digitos': 'El PIN son solo números, sin letras ni espacios.',
  repetidos: 'Ese PIN es muy fácil de adivinar. Usa números distintos.',
  secuencia: 'Ese PIN es muy fácil de adivinar. Evita los números seguidos.',
  'es-el-telefono': 'No uses parte de tu número de celular: es lo primero que alguien probaría.',
};

/**
 * Qué le pasa a este PIN, o `null` si está bien.
 *
 * Se rechazan los tres patrones que de verdad se usan. No es una lista de
 * contraseñas prohibidas: es que `000000`, `123456` y el propio teléfono
 * cubren la enorme mayoría de lo que elige alguien a quien le acaban de pedir
 * seis dígitos con la vendedora esperando.
 */
export function problemaDelPin(
  pin: string | null | undefined,
  telefonoNormal = '',
): ProblemaPin | null {
  const valor = (pin ?? '').trim();

  if (valor.length !== LARGO_PIN) return 'largo';
  if (!/^\d+$/.test(valor)) return 'no-son-digitos';

  // `000000`, `777777`.
  if (new Set(valor).size === 1) return 'repetidos';

  // `123456` y `654321`, y cualquier tramo seguido hacia arriba o hacia abajo.
  const digitos = [...valor].map(Number);
  const subeUno = digitos.every((d, i) => i === 0 || d === digitos[i - 1]! + 1);
  const bajaUno = digitos.every((d, i) => i === 0 || d === digitos[i - 1]! - 1);
  if (subeUno || bajaUno) return 'secuencia';

  // Cualquier tramo de seis del propio celular. Un número panameño son ocho
  // dígitos, así que hay tres tramos posibles y los tres son adivinables por
  // cualquiera que tenga el número — que es justo con lo que se entra.
  if (telefonoNormal.length >= LARGO_PIN) {
    for (let i = 0; i + LARGO_PIN <= telefonoNormal.length; i += 1) {
      if (telefonoNormal.slice(i, i + LARGO_PIN) === valor) return 'es-el-telefono';
    }
  }

  return null;
}

export function pinValido(pin: string | null | undefined, telefonoNormal = ''): boolean {
  return problemaDelPin(pin, telefonoNormal) === null;
}

// ---------------------------------------------------------------------------
// El socio
// ---------------------------------------------------------------------------

export type EstadoSocio = 'activo' | 'suspendido';

/** Lo que el socio ve de sí mismo. Nunca incluye nada del PIN. */
export interface Socio {
  codigo: string;
  nombre: string;
  apellido: string;
  telefono: string;
  cedula: string;
  correo: string;
  /** `MM-DD`, sin el año. */
  cumple: string;
  estado: EstadoSocio;
  /** Si tiene que elegir un PIN nuevo antes de poder hacer nada. */
  pinTemporal: boolean;
  /** El código de quien lo trajo, si alguien lo trajo. */
  referidoPor: string | null;
  creadoEn: string;
}

/**
 * Lo que se enseña de OTRA persona: el padrino al registrarse, o la lista de a
 * quién has traído.
 *
 * Nombre y la inicial del apellido, y se acabó. Si el código de referido
 * devolviera la ficha entera, cualquiera con un código a mano tendría el
 * teléfono y la cédula de quien lo repartió — y esos códigos se reparten por
 * WhatsApp a propósito.
 */
export interface SocioBreve {
  codigo: string;
  nombre: string;
  /** Solo la inicial, con su punto: `G.` */
  inicial: string;
}

export function comoBreve(socio: { codigo: string; nombre: string; apellido: string }): SocioBreve {
  const apellido = socio.apellido.trim();
  return {
    codigo: socio.codigo,
    nombre: socio.nombre.trim(),
    inicial: apellido ? `${apellido[0]!.toUpperCase()}.` : '',
  };
}

/** Cómo se saluda a alguien: «María G.», o «María» si no dio apellido. */
export function nombreVisible(socio: SocioBreve): string {
  return socio.inicial ? `${socio.nombre} ${socio.inicial}` : socio.nombre;
}

// ---------------------------------------------------------------------------
// Lo que llega del alta
// ---------------------------------------------------------------------------

export interface DatosAlta {
  nombre: string;
  apellido?: string;
  telefono: string;
  pin: string;
  cumple?: string;
  cedula?: string;
  correo?: string;
  /** El código del QR, si vino por uno. */
  referido?: string;
  /** La casilla del consentimiento. Sin esto no hay alta. */
  acepta: boolean;
}

/** La versión de los términos que se está aceptando hoy. */
export const VERSION_TERMINOS = 1;

/**
 * Un `MM-DD` válido, o vacío.
 *
 * Se acepta el 29 de febrero: aquí no hay año contra el que comprobarlo, y
 * quien nació ese día tiene tanto derecho a su regalo como los demás.
 */
export function cumpleValido(valor: string | null | undefined): boolean {
  const v = (valor ?? '').trim();
  if (!v) return true;
  const partes = /^(\d{2})-(\d{2})$/.exec(v);
  if (!partes) return false;
  const mes = Number(partes[1]);
  const dia = Number(partes[2]);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  return dia <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]!;
}

/**
 * Un celular panameño: ocho dígitos.
 *
 * Los móviles empiezan por 6, los fijos por 2, 3, 4, 5 o 7. Se aceptan los dos
 * —hay quien va a dar el número de la casa— pero no cualquier cosa de ocho
 * dígitos, porque el celular es la llave de la cuenta y un dígito de más
 * tecleado crea una cuenta a la que su dueño no puede entrar.
 */
export function telefonoValido(telefonoNormal: string): boolean {
  return /^[234567]\d{7}$/.test(telefonoNormal);
}
