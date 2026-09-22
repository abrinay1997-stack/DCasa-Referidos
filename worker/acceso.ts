/**
 * Quién está entrando POR LA ZONA DEL EQUIPO, según Cloudflare Access.
 *
 * COPIADO de abrinay1997-stack/PanaClaw-WorkSpace → worker/acceso.ts, con una
 * sola diferencia: aquí Access solo cubre `/panel/`. La zona pública —la app
 * del socio— no pasa por aquí y tiene su propia sesión, en `sesion.ts`, porque
 * un cliente que escanea un QR en la tienda no tiene ni va a tener un correo
 * autorizado.
 *
 * Access pone delante de `/panel/` una pantalla de correo y código, y a cada
 * petición que deja pasar le añade un token firmado. Aquí se comprueba esa
 * firma.
 *
 * Comprobarla —y no limitarse a leer la cabecera `Cf-Access-Authenticated-
 * User-Email`, que sería una línea— importa porque esa cabecera es texto que
 * cualquiera puede escribir. Si un día el Worker queda alcanzable por una
 * ruta que no pasa por Access (el subdominio `workers.dev`, una prueba, un
 * dominio nuevo mal configurado), leerla a secas convierte «quién eres» en un
 * campo que rellena quien llama. Verificando la firma, un token que no viene
 * de Access no vale nada.
 *
 * Y de aquí sale el correo que se escribe en `compras.vendedor`, en
 * `movimientos.autor` y en quién reinició un PIN. Si el navegador pudiera
 * enviarlo, esa auditoría no valdría nada.
 */

/** Las claves públicas de Access, tal como las publica el equipo. */
interface Jwks {
  keys: (JsonWebKey & { kid: string })[];
}

/**
 * Claves ya importadas, indexadas por `kid`.
 *
 * Vive en memoria del aislado y sobrevive entre peticiones. Access rota las
 * claves cada seis semanas, y `TTL_CLAVES` obliga a volver a pedirlas mucho
 * antes de eso; si el `kid` que llega no está, se refrescan igual sin esperar
 * al vencimiento.
 */
let cache: { expiraEn: number; claves: Map<string, CryptoKey> } | null = null;

const TTL_CLAVES = 60 * 60 * 1000; // Una hora.

export interface ConfigAcceso {
  /** `algo.cloudflareaccess.com` */
  dominio: string;
  /** El «Application Audience (AUD) Tag» de la aplicación en Access. */
  aud: string;
}

/**
 * La forma que tienen los dos datos de Access, y la única declaración de esa
 * forma en todo el repositorio.
 *
 * Existen porque un valor con la forma equivocada NO se nota al desplegar: el
 * Worker arranca, la portada se sirve, Access deja pasar a la persona —su
 * sesión está perfectamente bien— y solo entonces, al comparar, el token se
 * rechaza. Lo que se ve es «la sesión caducó» en bucle, que manda a recargar,
 * que es justo lo que no puede arreglarlo. Un dato mal copiado se convierte
 * así en una avería sin síntoma legible.
 *
 * `herramientas/verificar.mjs` LEE ESTAS DOS EXPRESIONES de este archivo y las
 * aplica a `wrangler.jsonc` antes de construir, para que el valor equivocado
 * no llegue nunca a desplegarse. No las dupliques allí: si cambian aquí,
 * cambian en los dos sitios a la vez.
 */
export const FORMA_DOMINIO = /^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/;

/**
 * La etiqueta AUD son 64 caracteres hexadecimales —Cloudflare la genera como
 * un SHA-256—. Los identificadores de 32 que salen en el panel (el de la
 * cuenta, el de la zona, el del Worker) NO son ésta, y son los que se copian
 * por error: están a un clic de distancia y se parecen lo suficiente.
 */
export const FORMA_AUD = /^[0-9a-f]{64}$/;

/**
 * Qué le falta a la puerta, en una lista vacía cuando no le falta nada.
 *
 * Devuelve texto ya redactado y sin ningún valor configurado dentro: esto se
 * pinta en una página que se sirve antes de saber quién mira.
 */
export function revisarPuerta(config: { dominio?: string; aud?: string }): string[] {
  const problemas: string[] = [];

  const revisar = (nombre: string, valor: string | undefined, forma: RegExp, esperado: string) => {
    if (!valor || valor === 'PENDIENTE') {
      problemas.push(`Falta ${nombre}: sigue sin poner.`);
    } else if (!forma.test(valor)) {
      problemas.push(
        `${nombre} no tiene la forma de ${esperado} ` +
          `(el valor puesto tiene ${valor.length} caracteres).`,
      );
    }
  };

  revisar(
    'ACCESO_DOMINIO',
    config.dominio,
    FORMA_DOMINIO,
    'un dominio de equipo, «algo.cloudflareaccess.com»',
  );
  revisar('ACCESO_AUD', config.aud, FORMA_AUD, 'una etiqueta AUD, 64 caracteres hexadecimales');

  return problemas;
}

/**
 * Por qué no se dejó pasar, y —lo que importa— qué puede hacer quien llama.
 *
 * Las dos mitades piden cosas distintas y durante un tiempo se contestaron
 * igual, que es como se pierde una tarde:
 *
 *   · `sesion` — el token llegó pero ya no sirve. Recargar vuelve a entrar.
 *   · `puerta` — la puerta está mal puesta o no está delante. Recargar no
 *     arregla nada, por muchas veces que se pulse; hay que tocar la
 *     configuración.
 */
export type MotivoSinAcceso = 'sesion' | 'puerta';

export class SinAcceso extends Error {
  constructor(
    readonly motivo: MotivoSinAcceso,
    mensaje: string,
    /**
     * Si el motivo se le puede enseñar a quien llama.
     *
     * Solo donde llegar hasta ahí exigió traer un token con la forma completa,
     * y donde el texto no nombra ningún valor configurado. Lo de antes —que la
     * petición llegó sin token— se calla: eso solo pasa cuando Access no está
     * delante de esta dirección, y es precisamente lo que no se le cuenta a
     * quien acaba de encontrarla abierta.
     */
    readonly decible = false,
  ) {
    super(mensaje);
  }
}

/**
 * Devuelve el correo de quien hace la petición, o lanza `SinAcceso`.
 *
 * El token llega en la cabecera `Cf-Access-Jwt-Assertion`; cuando la petición
 * la hace el navegador desde la propia página, viaja además como la cookie
 * `CF_Authorization`, que es la que se usa si la cabecera no está.
 */
export async function identificar(
  peticion: Request,
  config: ConfigAcceso,
): Promise<string> {
  const token =
    peticion.headers.get('Cf-Access-Jwt-Assertion') ?? cookie(peticion, 'CF_Authorization');

  if (!token) throw new SinAcceso('puerta', 'La petición no trae token de Access.');

  const [cabecera, cuerpo, firma] = token.split('.');
  if (!cabecera || !cuerpo || !firma) {
    throw new SinAcceso('sesion', 'El token no tiene tres partes.');
  }

  const { kid, alg } = leerJson<{ kid?: string; alg?: string }>(cabecera);
  if (alg !== 'RS256') throw new SinAcceso('sesion', `Algoritmo inesperado: ${alg}`);
  if (!kid) throw new SinAcceso('sesion', 'El token no dice con qué clave se firmó.');

  const clave = await claveDe(kid, config.dominio);
  const valida = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    clave,
    base64url(firma),
    new TextEncoder().encode(`${cabecera}.${cuerpo}`),
  );
  if (!valida) throw new SinAcceso('sesion', 'La firma del token no cuadra.');

  const datos = leerJson<{
    aud?: string | string[];
    iss?: string;
    exp?: number;
    email?: string;
  }>(cuerpo);

  const audiencias = Array.isArray(datos.aud) ? datos.aud : datos.aud ? [datos.aud] : [];
  if (!audiencias.includes(config.aud)) {
    // Un token válido de otra aplicación del mismo equipo. Firma correcta,
    // aplicación equivocada: sin esta comprobación, quien tenga acceso a
    // cualquier otra herramienta protegida entraría también aquí.
    throw new SinAcceso(
      'puerta',
      'El token es de otra aplicación: el AUD que trae no es el que tiene puesto el hub.',
      true,
    );
  }

  if (datos.iss !== `https://${config.dominio}`) {
    throw new SinAcceso(
      'puerta',
      'El token lo emitió otro equipo de Access: el dominio que tiene puesto el hub no es ' +
        'el que firmó.',
      true,
    );
  }

  if (typeof datos.exp !== 'number' || datos.exp * 1000 <= Date.now()) {
    throw new SinAcceso('sesion', 'El token está vencido.');
  }

  if (!datos.email) throw new SinAcceso('sesion', 'El token no trae correo.');

  return datos.email.toLowerCase();
}

async function claveDe(kid: string, dominio: string): Promise<CryptoKey> {
  const vigente = cache && cache.expiraEn > Date.now() ? cache.claves : null;
  const conocida = vigente?.get(kid);
  if (conocida) return conocida;

  // O no hay caché, o está vencida, o llegó un `kid` nuevo porque Access acaba
  // de rotar las claves. En los tres casos toca volver a pedirlas.
  const claves = await descargarClaves(dominio);
  cache = { expiraEn: Date.now() + TTL_CLAVES, claves };

  const clave = claves.get(kid);
  if (!clave) {
    throw new SinAcceso(
      'puerta',
      'El token se firmó con una clave que este equipo de Access no publica.',
      true,
    );
  }
  return clave;
}

async function descargarClaves(dominio: string): Promise<Map<string, CryptoKey>> {
  const respuesta = await fetch(`https://${dominio}/cdn-cgi/access/certs`);
  if (!respuesta.ok) {
    throw new SinAcceso(
      'puerta',
      `No se pudieron leer las claves de Access (${respuesta.status}).`,
    );
  }

  const { keys } = (await respuesta.json()) as Jwks;
  const claves = new Map<string, CryptoKey>();

  for (const jwk of keys ?? []) {
    if (!jwk.kid) continue;
    claves.set(
      jwk.kid,
      await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    );
  }

  if (claves.size === 0) throw new SinAcceso('puerta', 'Access no devolvió ninguna clave.');
  return claves;
}

function cookie(peticion: Request, nombre: string): string | null {
  const crudo = peticion.headers.get('Cookie');
  if (!crudo) return null;

  for (const trozo of crudo.split(';')) {
    const igual = trozo.indexOf('=');
    if (igual < 0) continue;
    if (trozo.slice(0, igual).trim() === nombre) return trozo.slice(igual + 1).trim();
  }
  return null;
}

function leerJson<T>(parte: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(base64url(parte))) as T;
  } catch {
    throw new SinAcceso('sesion', 'El token no es JSON válido.');
  }
}

/** base64url → bytes. El JWT no lleva relleno y cambia dos caracteres. */
function base64url(texto: string): Uint8Array {
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  const relleno = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binario = atob(base64 + relleno);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
