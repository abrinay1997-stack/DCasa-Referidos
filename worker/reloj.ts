/**
 * Qué día es en La Chorrera.
 *
 * El Worker corre en UTC. Panamá está siempre en UTC-5 y no cambia de hora en
 * todo el año —no hay horario de verano desde 2006— así que la conversión es
 * una resta y no necesita tabla de zonas horarias.
 *
 * Importa más de lo que parece. A las 7 de la tarde de un martes en la tienda,
 * en UTC ya es miércoles. Sin esto:
 *
 *   · el comprobante de una venta del sábado por la tarde llevaría la fecha del
 *     domingo, y el cliente que lo compare con su factura fiscal verá dos días
 *     distintos para la misma compra;
 *   · el regalo de cumpleaños de alguien caería la tarde anterior;
 *   · y el consecutivo saltaría al año siguiente cinco horas antes de tiempo,
 *     la noche del 31 de diciembre.
 */

/** Panamá, todo el año. */
const DESFASE_HORAS = -5;

function enPanama(instante = new Date()): Date {
  return new Date(instante.getTime() + DESFASE_HORAS * 60 * 60 * 1000);
}

/** `2026-09-22`, el día que es en Panamá ahora mismo. */
export function hoyEnPanama(instante = new Date()): string {
  return enPanama(instante).toISOString().slice(0, 10);
}

/** `09-22`, el día y mes que es en Panamá. Lo que compara el cumpleaños. */
export function diaYMesEnPanama(instante = new Date()): string {
  return enPanama(instante).toISOString().slice(5, 10);
}

/**
 * El día que era EN PANAMÁ cuando ocurrió algo que se guardó en UTC.
 *
 * Es lo que hay que usar para enseñar la fecha de cualquier cosa guardada con
 * `new Date().toISOString()`. Recortar los diez primeros caracteres de ese ISO
 * —`slice(0, 10)`— es lo que hacía que una venta del sábado a las 7:30 de la
 * tarde saliera como domingo en el historial, en la ficha del cliente y en los
 * reportes, mientras el comprobante impreso decía sábado. Dos fechas para la
 * misma venta, en un documento cuyo trabajo es poder cruzarse contra la
 * factura fiscal.
 */
export function diaEnPanama(iso: string): string {
  return hoyEnPanama(new Date(iso));
}

/** El año que corre en Panamá. Lo que numera el consecutivo. */
export function anioEnPanama(instante = new Date()): string {
  return enPanama(instante).toISOString().slice(0, 4);
}
