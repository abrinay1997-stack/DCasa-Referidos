/**
 * La economía del programa, tal como la lee el Worker.
 *
 * `datos/puntos.json` se importa y queda dentro del paquete que se publica: no
 * se lee de disco ni se pide por red, así que no hay ningún momento en el que
 * el Worker esté en pie sin saber sus propias reglas.
 *
 * Cambiar una cifra es cambiar ese archivo y volver a desplegar — que es
 * exactamente lo que se quiere. Una economía que se pudiera editar en caliente
 * sin pasar por el repositorio sería una economía sin historial de quién la
 * cambió ni cuándo, y aquí cada cifra es dinero.
 */

import crudo from '../datos/puntos.json';
import { ErrorPeticion } from './http';
import {
  faltaParaAcreditar,
  faltaParaReferir,
  FaltaConfigurar,
  type Reglas,
} from '../compartido/puntos';

export const REGLAS = crudo as unknown as Reglas;

/** Lo mismo, como función, para quien prefiera leerlo así. */
export function leerReglas(): Reglas {
  return REGLAS;
}

/**
 * Convierte un `FaltaConfigurar` en la respuesta que toca.
 *
 * 503 y no 400: el que no puede cumplir es el servidor, y quien llama no puede
 * hacer nada distinto para que funcione. El mensaje nombra el campo, para que
 * quien lo lea —una vendedora en el mostrador— sepa que esto se arregla en el
 * repositorio y no volviendo a intentarlo.
 */
export function comoRespuesta(error: unknown): never {
  if (error instanceof FaltaConfigurar) {
    throw new ErrorPeticion(
      503,
      'falta-configurar',
      `Todavía no podemos hacer eso: falta definir la regla en el programa. ${error.message}`,
      error.campo,
    );
  }
  throw error;
}

/** Si se pueden acreditar puntos por una compra. Vacío cuando sí. */
export function faltaParaCompras(): string[] {
  return faltaParaAcreditar(REGLAS);
}

/** Si se puede pagar un referido. Vacío cuando sí. */
export function faltaParaReferidos(): string[] {
  return faltaParaReferir(REGLAS);
}

/**
 * Para que sepa la pantalla qué ofrecer y qué esconder.
 *
 * La app del socio no enseña «Invita y gana» mientras no se pueda pagar un
 * referido: prometer una recompensa que el sistema no puede acreditar es peor
 * que no ofrecerla, y este programa se vende entero sobre que las cuentas
 * cuadran.
 */
export function queEstaEncendido(): {
  compras: boolean;
  referidos: boolean;
  bienvenida: boolean;
  cumpleanos: boolean;
  vencimiento: boolean;
} {
  return {
    compras: faltaParaCompras().length === 0,
    referidos: faltaParaReferidos().length === 0,
    bienvenida: REGLAS.bienvenida.puntos !== null && REGLAS.bienvenida.puntos > 0,
    cumpleanos: REGLAS.cumpleanos.puntos !== null && REGLAS.cumpleanos.puntos > 0,
    vencimiento: REGLAS.vencimiento.meses !== null,
  };
}
