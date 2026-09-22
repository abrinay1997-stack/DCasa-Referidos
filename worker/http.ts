/**
 * Cómo responde la API, y cómo se rechaza una petición.
 *
 * Está aparte del enrutador porque las dos zonas —la del socio y la del
 * equipo— tienen que rechazar igual: la pantalla decide qué ofrecer mirando el
 * `codigo` y no le importa cuál de las dos lo emitió.
 */

import type { CodigoError, ErrorApi } from '../compartido/api';
import { CABECERAS_SEGURIDAD } from '../compartido/seguridad';

/**
 * Un rechazo con su código y su mensaje ya en español.
 *
 * Se lanza desde cualquier profundidad y la única captura, la de `fetch`, lo
 * convierte en respuesta. Así ninguna función intermedia tiene que ir
 * devolviendo errores hacia arriba a mano.
 */
export class ErrorPeticion extends Error {
  constructor(
    readonly http: number,
    readonly codigo: CodigoError,
    mensaje: string,
    /** Dato suelto que la pantalla necesita para ofrecer una salida. */
    readonly detalle?: string,
  ) {
    super(mensaje);
    this.name = 'ErrorPeticion';
  }
}

export function json(datos: unknown, estado = 200): Response {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Lo que va aquí dentro son los datos y los puntos de personas reales:
      // que no lo guarde ninguna caché intermedia ni quede en el disco de
      // nadie.
      'Cache-Control': 'no-store',
    },
  });
}

export function fallo(
  estado: number,
  codigo: CodigoError,
  mensaje: string,
  detalle?: string,
): Response {
  const cuerpo: ErrorApi = detalle ? { codigo, mensaje, detalle } : { codigo, mensaje };
  return json(cuerpo, estado);
}

/** Lee el cuerpo como JSON, o rechaza con un mensaje que se puede enseñar. */
export async function cuerpoJson<T>(peticion: Request): Promise<T> {
  try {
    return (await peticion.json()) as T;
  } catch {
    throw new ErrorPeticion(400, 'invalida', 'No se entendió lo que se envió.');
  }
}

/**
 * Las cabeceras de seguridad, para lo que genera el Worker.
 *
 * Los archivos estáticos NO pasan por aquí: los sirve el borde y sus cabeceras
 * salen de `publico/_headers`, que `scripts/construir.mjs` escribe con esta
 * misma lista. Ver `compartido/seguridad.ts` para el porqué.
 */
export function cabecerasSeguridad(): Record<string, string> {
  return { ...CABECERAS_SEGURIDAD };
}
