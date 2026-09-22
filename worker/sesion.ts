/**
 * La identidad del socio: su PIN, su sesión y el candado.
 *
 * ---------------------------------------------------------------------------
 * ESTO NO ES CLOUDFLARE ACCESS, Y NO PUEDE SERLO
 *
 * El equipo entra por Access (`acceso.ts`): correo autorizado, token firmado
 * por Cloudflare, cero código nuestro decidiendo quién es quién.
 *
 * El socio no puede. Es un cliente que escaneó un QR en una mueblería de La
 * Chorrera; no tiene un correo autorizado ni lo va a tener. Así que esta parte
 * la escribimos nosotros, y por eso está escrita con más cuidado que ninguna
 * otra del repositorio: es la única puerta del sistema que no vigila nadie más.
 * ---------------------------------------------------------------------------
 */

import { ErrorPeticion } from './http';
import type { Env } from './entorno';
import { LARGO_PIN } from '../compartido/socios';

// El candado es política, no criptografía: la pantalla también tiene que saber
// cuánto le queda al socio. Vive en `compartido/candado.ts` y se reexporta aquí
// para que quien ya importaba de este módulo no tenga que cambiar.
export { bloqueoTras, cuantoQueda, ESCALONES, sigueBloqueada } from '../compartido/candado';

// ---------------------------------------------------------------------------
// El PIN
// ---------------------------------------------------------------------------

/**
 * Cuántas vueltas da PBKDF2.
 *
 * Se guarda POR SOCIO en `socios.pin_iteraciones`, no como constante global,
 * para poder subirlo cuando los teléfonos y los atacantes sean más rápidos y
 * volver a derivar el PIN de cada uno en su siguiente acceso correcto — en vez
 * de dejar fuera a todo el mundo de golpe el día que se cambie el número.
 */
export const ITERACIONES = 210_000;

const LARGO_SAL = 16;
const LARGO_CLAVE = 32;

/**
 * Deriva el PIN.
 *
 * LA PIMIENTA ES LA MITAD DE ESTO. Un PIN son seis dígitos: un millón de
 * combinaciones. Contra un volcado de la base robado, un millón de
 * combinaciones por PBKDF2 se agota en minutos con una tarjeta gráfica, sal o
 * no sal — la sal impide atacar a todos a la vez, no impide atacar a uno.
 *
 * `PIMIENTA_PIN` es un secreto del Worker y no está en la base. Quien se lleve
 * la base y no el secreto no tiene nada que atacar: le falta un trozo de la
 * entrada de cada derivación.
 */
async function derivar(
  pin: string,
  sal: Uint8Array,
  iteraciones: number,
  pimienta: string,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${pin}${pimienta}`),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: sal as BufferSource, iterations: iteraciones, hash: 'SHA-256' },
    material,
    LARGO_CLAVE * 8,
  );
  return new Uint8Array(bits);
}

export interface PinGuardado {
  hash: string;
  sal: string;
  iteraciones: number;
}

/** Prepara un PIN nuevo para guardarlo. */
export async function guardarPin(pin: string, env: Env): Promise<PinGuardado> {
  const sal = crypto.getRandomValues(new Uint8Array(LARGO_SAL));
  const clave = await derivar(pin, sal, ITERACIONES, env.PIMIENTA_PIN);
  return { hash: aBase64(clave), sal: aBase64(sal), iteraciones: ITERACIONES };
}

/**
 * Si el PIN es el que está guardado.
 *
 * La comparación es en tiempo constante. Con `===` sobre cadenas, el tiempo que
 * tarda en decir que no depende de cuántos caracteres acertó, y eso se mide: un
 * atacante paciente reconstruye el hash byte a byte en vez de probar un millón
 * de PIN. Aquí se recorren SIEMPRE los 32 bytes y se acumula la diferencia.
 */
export async function pinCoincide(pin: string, guardado: PinGuardado, env: Env): Promise<boolean> {
  // UNA FICHA SIN RECLAMAR NO TIENE PIN, y aquí eso se responde «no» y no con
  // una excepción. Su `pin_hash` es la cadena vacía (ver `0005_ficha.sql`), que
  // no es el resultado de derivar nada y no puede coincidir con nada — pero
  // `iteraciones = 0` hace que PBKDF2 lance, y lanzar aquí convertía un intento
  // de entrar en un 500 en vez de en el «no coinciden» de siempre.
  //
  // No se deriva en vano dentro de este `if` porque quien llama ya lo hace: el
  // camino de `entrar()` lo decide antes, para que el reloj no diga lo que el
  // mensaje calla.
  if (!guardado.hash || !guardado.iteraciones) return false;

  const esperado = deBase64(guardado.hash);
  const calculado = await derivar(pin, deBase64(guardado.sal), guardado.iteraciones, env.PIMIENTA_PIN);

  if (esperado.length !== calculado.length) return false;
  let diferencia = 0;
  for (let i = 0; i < esperado.length; i += 1) diferencia |= esperado[i]! ^ calculado[i]!;
  return diferencia === 0;
}

/**
 * ¿Se puede derivar un PIN AQUÍ, en la máquina donde esto está corriendo?
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE ESTA FUNCIÓN
 *
 * Derivar un PIN es lo único que hace este sistema que puede funcionar en la
 * máquina del que programa y fallar en la de Cloudflare. Todo lo demás —leer
 * la base, componer una respuesta, firmar una cookie— se comporta igual en las
 * dos. PBKDF2 no: la plataforma le pone límites propios que el runtime local
 * no tiene, y cuando los pasa, lanza.
 *
 * Eso pasó, y costó una tarde averiguarlo: el dueño llenó el formulario de
 * registro de su propia app y recibió «Algo falló de nuestro lado». Las mismas
 * peticiones, byte a byte, funcionaban en local. Ninguna prueba del
 * repositorio podía haberlo visto, porque ninguna corre donde falla.
 *
 * Así que ahora se puede preguntar desde fuera, y el sondeo lo pregunta en
 * cada despliegue. Un `/api/salud` que diga «en pie» mientras nadie puede
 * entrar ni registrarse es un `/api/salud` que miente.
 *
 * Cuesta lo que cuesta una entrada de verdad, así que NO va en la respuesta
 * corriente de salud: se pide a propósito.
 * ---------------------------------------------------------------------------
 */
export async function derivacionEnPie(
  env: Env,
): Promise<{ ok: boolean; vueltas: number; motivo?: string }> {
  try {
    await derivar('000000', new Uint8Array(LARGO_SAL), ITERACIONES, env.PIMIENTA_PIN ?? '');
    return { ok: true, vueltas: ITERACIONES };
  } catch (error) {
    // El mensaje de la plataforma, tal cual. No lleva nada secreto —ni el PIN,
    // ni la pimienta, ni datos de nadie— y es lo ÚNICO que dice qué hacer.
    // Sin él, quien mire esto solo sabe que algo falla.
    return {
      ok: false,
      vueltas: ITERACIONES,
      motivo: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

/** Un PIN temporal para dictar en el mostrador, sin patrones adivinables. */
export function pinTemporal(): string {
  // Se rechaza y se vuelve a tirar en vez de arreglar el número a mano: cambiar
  // un dígito «para que no sean todos iguales» mete un sesgo que no se ve.
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(LARGO_PIN));
    const pin = [...bytes].map((b) => b % 10).join('');
    if (new Set(pin).size === 1) continue;
    const d = [...pin].map(Number);
    if (d.every((x, i) => i === 0 || x === d[i - 1]! + 1)) continue;
    if (d.every((x, i) => i === 0 || x === d[i - 1]! - 1)) continue;
    return pin;
  }
}

// ---------------------------------------------------------------------------
// La sesión
// ---------------------------------------------------------------------------

export const COOKIE_SESION = 'sesion_socio';

/**
 * Noventa días.
 *
 * Es mucho, y es a propósito. Este señor compra un colchón cada dos años;
 * pedirle el PIN en cada visita es la forma más rápida de que deje de abrir la
 * app, y una app de puntos que nadie abre no tiene puntos que proteger. Lo que
 * de verdad cierra una sesión no es el reloj: es cambiar el PIN, que las
 * invalida todas al instante.
 */
const DIAS_SESION = 90;

interface Cargamento {
  /** El código del socio. */
  c: string;
  /** Cuándo caduca, en segundos. */
  x: number;
  /**
   * Cuándo se cambió el PIN por última vez.
   *
   * ES EL MECANISMO DE REVOCACIÓN, y por eso viaja dentro del token. Al
   * comprobar la sesión se contrasta con lo que dice la fila: si no coinciden,
   * el PIN cambió después de emitirse esta sesión y la sesión ya no vale.
   *
   * Sin esto haría falta una tabla de sesiones que mantener, limpiar y
   * consultar en cada petición. Con esto, reiniciar el PIN de alguien que
   * perdió el teléfono echa a ese teléfono de inmediato, gratis.
   */
  p: string;
}

/** Firma un token para la cookie. */
export async function emitirSesion(
  codigo: string,
  pinCambiadoEn: string,
  env: Env,
  ahora = new Date(),
): Promise<string> {
  const cargamento: Cargamento = {
    c: codigo,
    x: Math.floor(ahora.getTime() / 1000) + DIAS_SESION * 24 * 60 * 60,
    p: pinCambiadoEn,
  };
  const cuerpo = aBase64Url(new TextEncoder().encode(JSON.stringify(cargamento)));
  return `${cuerpo}.${aBase64Url(await firmar(cuerpo, env))}`;
}

/**
 * Lee un token y devuelve a quién dice pertenecer, o lanza.
 *
 * NO comprueba que el socio exista, ni que esté activo, ni que el PIN no haya
 * cambiado: eso exige mirar la base y lo hace quien llama. Aquí solo se
 * responde a «¿lo firmamos nosotros y sigue vigente?».
 */
export async function leerSesion(token: string, env: Env, ahora = new Date()): Promise<Cargamento> {
  const punto = token.lastIndexOf('.');
  if (punto < 1) throw sinSesion();

  const cuerpo = token.slice(0, punto);
  const firma = deBase64Url(token.slice(punto + 1));
  const esperada = await firmar(cuerpo, env);

  // En tiempo constante, por lo mismo que el PIN.
  if (firma.length !== esperada.length) throw sinSesion();
  let diferencia = 0;
  for (let i = 0; i < firma.length; i += 1) diferencia |= firma[i]! ^ esperada[i]!;
  if (diferencia !== 0) throw sinSesion();

  let cargamento: Cargamento;
  try {
    cargamento = JSON.parse(new TextDecoder().decode(deBase64Url(cuerpo))) as Cargamento;
  } catch {
    throw sinSesion();
  }

  if (typeof cargamento.x !== 'number' || cargamento.x * 1000 <= ahora.getTime()) throw sinSesion();
  if (typeof cargamento.c !== 'string' || !cargamento.c) throw sinSesion();

  return cargamento;
}

function sinSesion(): ErrorPeticion {
  return new ErrorPeticion(401, 'sin-sesion', 'Tu sesión se cerró. Vuelve a entrar con tu PIN.');
}

async function firmar(texto: string, env: Env): Promise<Uint8Array> {
  const clave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SECRETO_SESION),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(texto)));
}

/**
 * La cookie, con las tres marcas que importan.
 *
 * `HttpOnly` para que ningún script pueda leerla —si un día se cuela una
 * inyección en la app del socio, la sesión no se va con ella—. `Secure` para
 * que no viaje en claro. `SameSite=Lax` para que un sitio ajeno no pueda hacer
 * peticiones a la API con la sesión del socio puesta.
 */
export function cookieSesion(token: string): string {
  const segundos = DIAS_SESION * 24 * 60 * 60;
  return `${COOKIE_SESION}=${token}; Path=/; Max-Age=${segundos}; HttpOnly; Secure; SameSite=Lax`;
}

export function cookieBorrada(): string {
  return `${COOKIE_SESION}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function cookieDe(peticion: Request, nombre: string): string | null {
  const crudo = peticion.headers.get('Cookie');
  if (!crudo) return null;
  for (const trozo of crudo.split(';')) {
    const igual = trozo.indexOf('=');
    if (igual < 0) continue;
    if (trozo.slice(0, igual).trim() === nombre) return trozo.slice(igual + 1).trim();
  }
  return null;
}

// ---------------------------------------------------------------------------

function aBase64(bytes: Uint8Array): string {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function deBase64(texto: string): Uint8Array {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function aBase64Url(bytes: Uint8Array): string {
  return aBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64Url(texto: string): Uint8Array {
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  const relleno = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  return deBase64(base64 + relleno);
}
