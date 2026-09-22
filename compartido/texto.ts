/**
 * Cómo se normaliza un dato antes de compararlo.
 *
 * COPIADO TAL CUAL de abrinay1997-stack/PanaClaw-WorkSpace → compartido/texto.ts.
 * No lo reescribas: si algún día hay que corregir una de estas funciones, se
 * corrige en los dos repositorios a la vez. Son las mismas reglas de Panamá.
 *
 * Vive fuera de las pantallas y fuera del Worker porque los dos tienen que
 * responder igual: si el alta decide que `6123-4567` y `+507 61234567` son la
 * misma persona y el panel decide que no, se acaban creando dos cuentas del
 * mismo socio y los puntos quedan partidos entre las dos.
 *
 * Ninguna de estas funciones toca lo que se guarda. Lo que se guarda es lo que
 * escribió la persona, con sus guiones y sus tildes; esto es solo para comparar
 * y para ordenar.
 */

/** `155-2148-99 DV 12` → `155214899 12`. Vacío si no hay ningún dígito. */
export function soloDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

/** `  Ávila, S.A. ` → `avila, s.a.`. Para comparar y para ordenar. */
export function sinTildes(valor: string | null | undefined): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * `  Ventas@Cliente.COM ` → `ventas@cliente.com`.
 *
 * Solo minúsculas y espacios: la parte de antes de la arroba sí distingue
 * mayúsculas según la norma, pero ningún proveedor de correo del mundo real las
 * trata como distintas, y suponer que sí crearía dos fichas del mismo cliente
 * por haber tecleado la inicial en mayúscula.
 */
export function correoNormal(valor: string | null | undefined): string {
  return (valor ?? '').trim().toLowerCase();
}

/** Si eso parece una dirección de correo. La misma comprobación que el Worker. */
export function pareceCorreo(valor: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((valor ?? '').trim());
}

/**
 * Un número de WhatsApp, dejado en algo que se pueda comparar.
 *
 * En Panamá el mismo número se escribe de cuatro formas —`6123-4567`,
 * `61234567`, `+507 6123 4567`, `507 6123-4567`— y las cuatro son la misma
 * persona. Se comparan solo los últimos ocho dígitos, que es el número
 * nacional: así el prefijo del país, escrito o no, deja de partir en dos la
 * ficha de un cliente.
 *
 * Ocho y no todos los dígitos porque un número extranjero más largo se
 * compararía consigo mismo igual —sus últimos ocho también coinciden— y el
 * riesgo de que dos clientes distintos compartan los ocho finales es mucho
 * menor que la certeza de duplicar fichas por un `+507`.
 */
export function whatsappNormal(valor: string | null | undefined): string {
  const digitos = soloDigitos(valor);
  return digitos.length > 8 ? digitos.slice(-8) : digitos;
}
