/**
 * El libro mayor: cómo se escribe un asiento y cómo se lee un saldo.
 *
 * ---------------------------------------------------------------------------
 * NO HAY COLUMNA `saldo`, Y ESTE ARCHIVO ES LA RAZÓN DE QUE NO HAGA FALTA
 *
 * `saldoDe()` es una suma sobre esta tabla, y es la ÚNICA forma de saber
 * cuántos puntos tiene alguien. A la escala de esta tienda —miles de filas, no
 * millones— cuesta menos que la consulta que la envuelve.
 *
 * Si algún día deja de costar poco, la respuesta es una vista materializada que
 * se recalcula desde aquí, nunca una columna que se escribe a mano. Ver la
 * cabecera de `migraciones/0002_movimientos.sql`.
 *
 * NADA SE EDITA Y NADA SE BORRA. Corregir es `revertir()`, que escribe un
 * asiento contrario apuntando al original. La bitácora que lee el socio en su
 * app cuenta la historia entera, los errores incluidos.
 * ---------------------------------------------------------------------------
 */

import { ErrorPeticion } from './http';

export type TipoMovimiento =
  | 'bienvenida'
  | 'compra'
  | 'referido'
  | 'canje'
  | 'ajuste'
  | 'reverso'
  | 'cumpleanos'
  | 'vencimiento';

export interface Asiento {
  socioCodigo: string;
  tipo: TipoMovimiento;
  puntos: number;
  motivo?: string;
  autor: string;
  compraId?: string | null;
  canjeId?: string | null;
  origenSocio?: string | null;
  reversaA?: string | null;
  ocurridoEn?: string;
}

export interface MovimientoLeido {
  id: string;
  ocurridoEn: string;
  tipo: TipoMovimiento;
  puntos: number;
  motivo: string;
  origenSocio: string | null;
  compraId: string | null;
  canjeId: string | null;
}

/**
 * Prepara la sentencia de un asiento, sin ejecutarla.
 *
 * Devuelve la sentencia en vez de correrla para que quien llama la meta en el
 * MISMO `batch` que el resto de su operación. Un alta que crea el socio pero se
 * queda sin su asiento de bienvenida, o una compra que se registra sin acreditar
 * puntos, son estados que no pueden existir — y la única forma de que no existan
 * es que las dos escrituras viajen juntas.
 */
export function sentenciaAsiento(base: D1Database, asiento: Asiento): D1PreparedStatement {
  if (!Number.isInteger(asiento.puntos) || asiento.puntos === 0) {
    // Un asiento de cero no es inofensivo: ensucia la bitácora que lee el socio
    // con una línea que no le dice nada.
    throw new ErrorPeticion(500, 'fallo', 'Un asiento no puede ser de cero puntos.');
  }
  if ((asiento.tipo === 'ajuste' || asiento.tipo === 'reverso') && !asiento.motivo?.trim()) {
    // El socio lee este motivo. Un ajuste sin explicación es un número que le
    // cambió solo, y eso es lo que hace que un programa de puntos deje de ser
    // creíble.
    throw new ErrorPeticion(400, 'invalida', 'Un ajuste o un reverso necesita un motivo escrito.');
  }

  return base
    .prepare(
      `INSERT INTO movimientos
         (id, socio_codigo, ocurrido_en, tipo, puntos, compra_id, canje_id,
          origen_socio, reversa_a, motivo, autor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      asiento.socioCodigo,
      asiento.ocurridoEn ?? new Date().toISOString(),
      asiento.tipo,
      asiento.puntos,
      asiento.compraId ?? null,
      asiento.canjeId ?? null,
      asiento.origenSocio ?? null,
      asiento.reversaA ?? null,
      asiento.motivo ?? '',
      asiento.autor,
    );
}

/** El saldo de un socio: la suma de su libro y nada más. */
export async function saldoDe(base: D1Database, codigo: string): Promise<number> {
  const fila = await base
    .prepare(`SELECT COALESCE(SUM(puntos), 0) AS saldo FROM movimientos WHERE socio_codigo = ?`)
    .bind(codigo)
    .first<{ saldo: number }>();
  return fila?.saldo ?? 0;
}

/** La bitácora, más reciente arriba. */
export async function bitacoraDe(
  base: D1Database,
  codigo: string,
  desde = 0,
  cuantas = 50,
): Promise<{ filas: MovimientoLeido[]; total: number }> {
  const limite = Math.min(Math.max(cuantas, 1), 100);

  // Las dos consultas en un solo viaje: la página y su cuenta tienen que salir
  // del mismo estado de la base, o el «mostrando 50 de 47» aparece solo.
  const resultados = await base.batch<Record<string, unknown>>([
    base
      .prepare(
        `SELECT id, ocurrido_en, tipo, puntos, motivo, origen_socio, compra_id, canje_id
           FROM movimientos WHERE socio_codigo = ?
          ORDER BY ocurrido_en DESC, rowid DESC LIMIT ? OFFSET ?`,
      )
      .bind(codigo, limite, Math.max(desde, 0)),
    base.prepare(`SELECT COUNT(*) AS total FROM movimientos WHERE socio_codigo = ?`).bind(codigo),
  ]);

  const pagina = resultados[0]?.results ?? [];
  const total = (resultados[1]?.results?.[0] as { total?: number } | undefined)?.total ?? 0;

  return {
    filas: pagina.map((f) => ({
      id: f.id as string,
      ocurridoEn: f.ocurrido_en as string,
      tipo: f.tipo as TipoMovimiento,
      puntos: f.puntos as number,
      motivo: (f.motivo as string) ?? '',
      origenSocio: (f.origen_socio as string) ?? null,
      compraId: (f.compra_id as string) ?? null,
      canjeId: (f.canje_id as string) ?? null,
    })),
    total,
  };
}

/**
 * Anula un asiento con otro contrario.
 *
 * El índice único sobre `reversa_a` impide revertir dos veces el mismo asiento,
 * y lo impide la base y no este código: dos anulaciones de la misma compra
 * lanzadas a la vez llegarían las dos hasta aquí y restarían los puntos dos
 * veces. Cuando la base lo rechaza, se traduce a un mensaje que se entiende.
 */
export function sentenciaReverso(
  base: D1Database,
  original: { id: string; socioCodigo: string; puntos: number },
  motivo: string,
  autor: string,
): D1PreparedStatement {
  return sentenciaAsiento(base, {
    socioCodigo: original.socioCodigo,
    tipo: 'reverso',
    puntos: -original.puntos,
    reversaA: original.id,
    motivo,
    autor,
  });
}
