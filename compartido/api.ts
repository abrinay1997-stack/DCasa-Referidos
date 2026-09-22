/**
 * Cómo responde la API y cómo rechaza.
 *
 * Vive en `compartido/` y no en el Worker porque las pantallas deciden qué
 * ofrecer mirando el `codigo` del error, no su texto. El texto es para la
 * persona; el código, para el programa. Si el código viviera solo en el
 * servidor, cada pantalla acabaría comparando cadenas en español para saber si
 * ofrecer «volver a entrar» o «avisa a una vendedora».
 */

/** Por qué se rechazó. La pantalla decide qué ofrecer según esto. */
export type CodigoError =
  /** El cuerpo o los parámetros no valen. */
  | 'invalida'
  /** No hay sesión, o caducó. Volver a entrar lo arregla. */
  | 'sin-sesion'
  /** Hay sesión, pero no para esto. */
  | 'sin-permiso'
  /** La cuenta está bloqueada por intentos fallidos. */
  | 'bloqueada'
  /** La cuenta está suspendida. Recargar no lo arregla. */
  | 'suspendida'
  /** No existe. */
  | 'no-encontrada'
  /** Ya existe algo que lo impide: un teléfono repetido, una factura cargada. */
  | 'repetida'
  /** No hay puntos suficientes. */
  | 'sin-saldo'
  /** Falta configurar algo en `datos/puntos.json`. Lo arregla el repositorio. */
  | 'falta-configurar'
  /** La puerta de Cloudflare Access está mal puesta. Recargar no lo arregla. */
  | 'puerta-mal-puesta'
  /** Cualquier otra cosa. */
  | 'fallo';

export interface ErrorApi {
  codigo: CodigoError;
  /**
   * Ya redactado en español y en la voz de la marca, listo para enseñárselo a
   * quien llama sin retocarlo. Los errores también son de marca: no se dice
   * «credenciales inválidas», se dice «Ese número y ese PIN no coinciden».
   */
  mensaje: string;
  /** Un dato suelto que la pantalla necesita para ofrecer la salida. */
  detalle?: string;
}

export function esErrorApi(valor: unknown): valor is ErrorApi {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    typeof (valor as ErrorApi).codigo === 'string' &&
    typeof (valor as ErrorApi).mensaje === 'string'
  );
}

/** Una página de resultados. Misma forma en todos los listados del panel. */
export interface Pagina<T> {
  filas: T[];
  total: number;
  desde: number;
  /** Cuántas caben en una página. El servidor decide el máximo. */
  cuantas: number;
}
