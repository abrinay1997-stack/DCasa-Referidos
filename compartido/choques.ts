/**
 * Qué columna se chocó, cuando la base rechaza un INSERT.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTO EXISTE Y POR QUÉ SE PRUEBA
 *
 * Los índices únicos de este programa son las defensas antifraude: un teléfono
 * un socio, una factura una carga. Cuando saltan, quien llama tiene que recibir
 * un 409 con un mensaje que se entienda —«esa factura ya se cargó»— y no un 500
 * genérico.
 *
 * Para distinguir cuál saltó hay que leer el mensaje de SQLite, y ahí está la
 * trampa que costó este archivo: SQLite nombra la COLUMNA, no el índice.
 *
 *     UNIQUE constraint failed: compras.factura_normal
 *
 * El código original comparaba contra el nombre del índice (`compras_factura`),
 * que nunca aparece. El resultado era que el rechazo funcionaba —la base no
 * escribía nada, que es lo importante— pero se contestaba 500 «Algo falló de
 * nuestro lado», y una vendedora leyendo eso vuelve a intentarlo en vez de
 * mirar el número de factura.
 *
 * Lo cazó la prueba de extremo a extremo. Sin ella habría llegado a la tienda,
 * porque por el camino normal no se ve: antes de insertar se comprueba con un
 * SELECT, y el choque de verdad solo ocurre en la carrera entre dos registros
 * simultáneos. Que es justo cuando menos falta hace un 500.
 * ---------------------------------------------------------------------------
 */

/**
 * `tabla.columna` del choque, o `null` si el error no es de unicidad.
 *
 * Devuelve la primera columna cuando el índice es de varias: para decidir qué
 * mensaje enseñar basta con saber cuál es el índice, y el primero lo identifica.
 */
export function columnaDelChoque(error: unknown): string | null {
  const texto = error instanceof Error ? `${error.message} ${String(error.cause ?? '')}` : String(error);
  const hallado = /UNIQUE constraint failed:\s*([A-Za-z0-9_]+\.[A-Za-z0-9_]+)/.exec(texto);
  return hallado ? hallado[1]! : null;
}

/** Si el choque fue contra esta columna concreta. */
export function choco(error: unknown, columna: string): boolean {
  return columnaDelChoque(error) === columna;
}
