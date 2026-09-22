/**
 * Cómo se lee un número de factura.
 *
 * Vive aquí y no en el Worker porque la pantalla de la vendedora tiene que
 * avisar de «esa factura ya se cargó» ANTES de enviar, y para eso tiene que
 * normalizar igual que el servidor. Dos normalizaciones distintas darían un
 * formulario que deja pasar lo que el servidor rechaza — con el cliente
 * delante.
 */

/**
 * Una factura, dejada en algo que se pueda comparar.
 *
 * `F-001234`, `f 001234` y `1234` son la misma factura. Sin esto, cargarla tres
 * veces escrita de tres formas daría tres veces los puntos, y el índice único
 * de la base no se enteraría de nada: para SQLite son tres cadenas distintas.
 *
 * Los ceros de relleno se quitan porque el talonario los imprime y la vendedora
 * no siempre los teclea. Lo que se GUARDA es lo que ella escribió; esto solo
 * sirve para comparar, igual que `whatsappNormal` en `texto.ts`.
 */
export function facturaNormal(valor: string | null | undefined): string {
  const limpia = (valor ?? '').toUpperCase().replace(/[\s\-_./]/g, '');
  // El prefijo de letras se conserva y los ceros que van justo antes del primer
  // dígito se caen: `F000123` → `F123`, pero `F1000` sigue siendo `F1000`.
  return limpia.replace(/^([A-Z]*)0+(?=\d)/, '$1');
}
