/**
 * El candado contra fuerza bruta: cuándo se cierra una cuenta y por cuánto.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTO ES POLÍTICA Y NO CRIPTOGRAFÍA
 *
 * Derivar un PIN solo puede pasar en el servidor, y por eso vive en
 * `worker/sesion.ts`. Decidir que a los cinco fallos se espera un cuarto de
 * hora, no: es una regla que la PANTALLA también tiene que saber, porque es
 * ella la que le dice al socio cuánto le queda y si tiene sentido volver a
 * intentarlo o escribir por WhatsApp.
 *
 * Y siendo pura se puede probar entera sin levantar nada, que es lo que hace
 * que se pruebe de verdad en vez de «cuando alguien monte el arnés».
 * ---------------------------------------------------------------------------
 */

/**
 * Cuántos fallos antes de cerrar, y por cuánto.
 *
 * Dos escalones, y el segundo es el que importa. Quien se equivocó de verdad
 * acierta en los primeros intentos o espera un cuarto de hora — molesto, no
 * grave. Quien está probando llega a diez y se come un día entero, y a un
 * millón de combinaciones eso convierte el ataque en cosa de siglos.
 *
 * Esto es la MITAD de la defensa. La otra es una regla de Rate Limiting de
 * Cloudflare sobre `/api/socio/entrar`, porque este candado es por cuenta y no
 * ve a quien prueba `123456` contra diez mil teléfonos distintos.
 */
export const ESCALONES = [
  { fallos: 5, minutos: 15 },
  { fallos: 10, minutos: 60 * 24 },
] as const;

/** Hasta cuándo queda bloqueada tras este fallo, o `null` si todavía no. */
export function bloqueoTras(fallos: number, ahora: Date): string | null {
  let minutos = 0;
  for (const escalon of ESCALONES) if (fallos >= escalon.fallos) minutos = escalon.minutos;
  if (!minutos) return null;
  return new Date(ahora.getTime() + minutos * 60_000).toISOString();
}

export function sigueBloqueada(bloqueadoHasta: string | null, ahora: Date): boolean {
  return bloqueadoHasta !== null && new Date(bloqueadoHasta) > ahora;
}

/**
 * Cuánto le queda, en palabras.
 *
 * Redondea hacia arriba: decir «2 minutos» cuando faltan 2 y medio hace que
 * vuelva a intentarlo antes de tiempo, se coma otro fallo, y acabe pensando que
 * el candado está roto.
 */
export function cuantoQueda(bloqueadoHasta: string, ahora: Date): string {
  const minutos = Math.ceil((new Date(bloqueadoHasta).getTime() - ahora.getTime()) / 60_000);
  if (minutos <= 1) return 'un minuto';
  if (minutos < 60) return `${minutos} minutos`;
  const horas = Math.ceil(minutos / 60);
  return horas === 1 ? 'una hora' : `${horas} horas`;
}
