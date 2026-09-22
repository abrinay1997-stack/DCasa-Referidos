/**
 * Los referidos: cuándo se pagan y cuánto.
 *
 * ---------------------------------------------------------------------------
 * SE PAGAN CON LA PRIMERA COMPRA, NUNCA AL REGISTRARSE
 *
 * Es la decisión antifraude central del programa. Pagar por el alta convierte
 * la forma más rentable de usar el sistema en inventarse personas: cinco
 * teléfonos prestados, cinco cuentas, cinco bonos, cero ventas.
 *
 * Pagando con la primera compra verificada, para cobrar un referido alguien
 * tiene que haber pasado por la tienda y haber dejado dinero. El fraude deja de
 * ser gratis.
 * ---------------------------------------------------------------------------
 */

import { REGLAS } from './reglas';
import { sentenciaAsiento, sentenciaReverso } from './movimientos';

/** Por qué no se pagó, cuando no se paga. Se guarda en el registro del panel. */
export type MotivoSinPagar =
  | 'sin-padrino'
  | 'ya-pagado'
  | 'no-califica'
  | 'no-es-la-primera'
  | 'padrino-no-vale'
  | 'tope-de-ahijados'
  | 'tope-del-mes'
  | 'sin-configurar';

export const EXPLICACION: Record<MotivoSinPagar, string> = {
  'sin-padrino': 'Nadie lo trajo.',
  'ya-pagado': 'Su referido ya se pagó antes.',
  'no-califica': 'Esta compra no llegó al mínimo para dar puntos.',
  'no-es-la-primera': 'No es su primera compra.',
  'padrino-no-vale': 'Quien lo trajo ya no tiene cuenta activa.',
  'tope-de-ahijados': 'Quien lo trajo llegó a su tope de referidos.',
  'tope-del-mes': 'Quien lo trajo llegó a su tope de este mes.',
  'sin-configurar': 'Falta definir cuánto gana quien trae a alguien.',
};

export interface Resultado {
  /** Las sentencias que hay que meter en el MISMO batch que la compra. */
  sentencias: D1PreparedStatement[];
  /** Qué se pagó, para poder decírselo a la vendedora. */
  pagado: { padrino: string; alPadrino: number; alAhijado: number } | null;
  /** Si no se pagó, por qué. */
  motivo: MotivoSinPagar | null;
}

const NADA: Resultado = { sentencias: [], pagado: null, motivo: null };

/**
 * Decide si esta compra dispara el pago de un referido, y prepara los asientos.
 *
 * NO EJECUTA NADA. Devuelve sentencias para que quien llama las meta en el
 * mismo `batch` que la fila de la compra: unos puntos de referido acreditados
 * sin la compra que los explica, o una compra que debía pagar un referido y no
 * lo hizo, son estados que no pueden existir.
 *
 * Y un tope alcanzado NUNCA hace fallar la venta. La compra se registra igual y
 * el motivo queda dicho: la vendedora tiene una cola delante y el programa no
 * puede ser lo que la detiene.
 */
export async function alRegistrarCompra(
  base: D1Database,
  comprador: { codigo: string; nombre: string; referido_por: string | null; referido_pagado_en: string | null },
  /** Los puntos que dio ESTA compra. Cero significa que no llegó al mínimo. */
  puntosDeLaCompra: number,
  ahora: string,
  autor: string,
  /**
   * La compra que dispara el pago.
   *
   * Los dos asientos del referido la llevan escrita, y NO es decorativo: es lo
   * único que permite deshacerlos si esa compra se anula. Sin este enlace, una
   * venta anulada se llevaba sus propios puntos y dejaba los $7.50 del referido
   * regalados, porque nadie sabía de qué compra habían salido.
   */
  compraId: string,
): Promise<Resultado> {
  if (!comprador.referido_por) return { ...NADA, motivo: 'sin-padrino' };

  // ---------------------------------------------------------------------
  // UNA COMPRA QUE NO DIO PUNTOS NO ESTRENA A NADIE
  //
  // Con la compra mínima en $20, una venta de $19.99 da cero puntos. Sin esta
  // condición, esa venta disparaba igualmente el pago del referido: 500 al
  // padrino y 250 al ahijado, $7.50 en bonos por una compra de diecinueve
  // dólares con noventa y nueve.
  //
  // Es exactamente el fraude que la compra mínima existe para evitar, y la
  // prueba de extremo a extremo lo cazó: el mínimo frenaba los puntos de la
  // compra pero no los del referido, que son veinticinco veces más grandes.
  //
  // Se mira `puntos` y no el monto a propósito: cualquier motivo futuro por el
  // que una compra no acredite nada tampoco debe estrenar a nadie.
  // ---------------------------------------------------------------------
  if (puntosDeLaCompra <= 0) return { ...NADA, motivo: 'no-califica' };

  // El sello es lo que impide pagar dos veces. Al ANULAR la compra que lo puso
  // sí se limpia —ver `deshacerPorCompra`— porque si no, la primera compra de
  // verdad de esa persona no pagaría a nadie: la anulada se habría llevado el
  // derecho por delante.
  if (comprador.referido_pagado_en) return { ...NADA, motivo: 'ya-pagado' };

  const { puntosAlPadrino, puntosAlAhijado, topeDeAhijadosPorPadrino, topeDePuntosPorPadrinoAlMes } =
    REGLAS.referido;

  if (puntosAlPadrino === null) return { ...NADA, motivo: 'sin-configurar' };

  // ¿Es su primera compra que cuenta? Se pregunta ANTES de insertar la de
  // ahora, así que «ninguna» significa que la de ahora es la primera.
  //
  // Dos exclusiones, y las dos importan:
  //
  //   · Las ANULADAS no cuentan: una compra que se deshizo no estrena a nadie.
  //   · Las de CERO PUNTOS tampoco. Si contaran, una venta de $19.99 hecha
  //     antes que la de verdad quemaría el referido del padrino para siempre:
  //     la primera no pagaría por no llegar al mínimo, y la segunda no pagaría
  //     por «no ser la primera». El padrino se quedaría sin su bono sin que
  //     nadie pudiera explicarle por qué.
  const previas = await base
    .prepare(
      `SELECT COUNT(*) AS cuantas FROM compras
        WHERE socio_codigo = ? AND anulada_en IS NULL AND puntos > 0`,
    )
    .bind(comprador.codigo)
    .first<{ cuantas: number }>();

  if ((previas?.cuantas ?? 0) > 0) return { ...NADA, motivo: 'no-es-la-primera' };

  const padrino = await base
    .prepare(
      `SELECT codigo FROM socios
        WHERE codigo = ? AND eliminado_en IS NULL AND estado = 'activo'`,
    )
    .bind(comprador.referido_por)
    .first<{ codigo: string }>();

  if (!padrino) return { ...NADA, motivo: 'padrino-no-vale' };

  // Cuántos referidos lleva cobrados el padrino, en total y este mes.
  //
  // Se cuentan solo los asientos con `origen_socio`, que es lo que distingue
  // «me pagaron porque alguien que traje compró» de «me dieron un bono por
  // venir invitado». Los dos son de tipo 'referido' y sin esta condición el
  // bono de bienvenida de alguien contaría como si hubiera traído a una
  // persona, y le gastaría un hueco de su tope sin haber traído a nadie.
  const desdeElMes = `${ahora.slice(0, 7)}-01T00:00:00.000Z`;

  const cuenta = await base
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN ocurrido_en >= ? THEN puntos ELSE 0 END), 0) AS delMes
       FROM movimientos
        WHERE socio_codigo = ? AND tipo = 'referido' AND origen_socio IS NOT NULL`,
    )
    .bind(desdeElMes, padrino.codigo)
    .first<{ total: number; delMes: number }>();

  const total = cuenta?.total ?? 0;
  const delMes = cuenta?.delMes ?? 0;

  if (topeDeAhijadosPorPadrino !== null && total >= topeDeAhijadosPorPadrino) {
    return { ...NADA, motivo: 'tope-de-ahijados' };
  }
  if (
    topeDePuntosPorPadrinoAlMes !== null &&
    delMes + puntosAlPadrino > topeDePuntosPorPadrinoAlMes
  ) {
    return { ...NADA, motivo: 'tope-del-mes' };
  }

  const sentencias: D1PreparedStatement[] = [
    sentenciaAsiento(base, {
      socioCodigo: padrino.codigo,
      tipo: 'referido',
      puntos: puntosAlPadrino,
      // `origen_socio` es lo que hace contable este asiento, y de paso lo que
      // permite enseñarle al padrino de quién vino cada bono.
      origenSocio: comprador.codigo,
      compraId,
      motivo: `Primera compra de ${comprador.nombre}`,
      autor,
      ocurridoEn: ahora,
    }),
  ];

  if (puntosAlAhijado !== null && puntosAlAhijado > 0) {
    sentencias.push(
      sentenciaAsiento(base, {
        socioCodigo: comprador.codigo,
        tipo: 'referido',
        puntos: puntosAlAhijado,
        // SIN `origen_socio`, a propósito: ver arriba.
        compraId,
        motivo: 'Bono por venir invitado',
        autor,
        ocurridoEn: ahora,
      }),
    );
  }

  // El sello. Va en el mismo batch que los asientos: si se escribiera aparte y
  // fallara, el referido se podría cobrar otra vez.
  sentencias.push(
    base
      .prepare(`UPDATE socios SET referido_pagado_en = ? WHERE codigo = ?`)
      .bind(ahora, comprador.codigo),
  );

  return {
    sentencias,
    pagado: {
      padrino: padrino.codigo,
      alPadrino: puntosAlPadrino,
      alAhijado: puntosAlAhijado ?? 0,
    },
    motivo: null,
  };
}

/** A quién ha traído un socio, y cuánto ganó con cada uno. */
export async function deSocio(base: D1Database, codigo: string) {
  const { results } = await base
    .prepare(
      `SELECT s.nombre, s.apellido, s.creado_en, s.referido_pagado_en,
              (SELECT m.puntos FROM movimientos m
                WHERE m.socio_codigo = ? AND m.tipo = 'referido' AND m.origen_socio = s.codigo
                LIMIT 1) AS puntos
         FROM socios s
        WHERE s.referido_por = ? AND s.eliminado_en IS NULL
        ORDER BY s.creado_en DESC LIMIT 50`,
    )
    .bind(codigo, codigo)
    .all<{
      nombre: string;
      apellido: string;
      creado_en: string;
      referido_pagado_en: string | null;
      puntos: number | null;
    }>();

  return (results ?? []).map((f) => ({
    // Solo el nombre y la inicial, igual que en todo lo demás: el padrino no
    // tiene por qué ver el teléfono de quien trajo.
    nombre: f.apellido ? `${f.nombre} ${f.apellido[0]!.toUpperCase()}.` : f.nombre,
    desde: f.creado_en,
    compro: Boolean(f.referido_pagado_en),
    puntos: f.puntos ?? 0,
  }));
}

/**
 * Deshace el pago de referido que disparó una compra, al anularla.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTO TIENE QUE EXISTIR
 *
 * Sin esto, anular una venta dejaba los puntos del referido en pie. Medido
 * sobre el sistema en marcha: una venta de $1,070 a un invitado pagaba 500 al
 * padrino y 250 al ahijado; al anularla, la compra devolvía sus 1,070 puntos y
 * los 750 del referido se quedaban donde estaban.
 *
 * Eso son dos problemas a la vez, y el segundo es peor que el primero:
 *
 *   1. UN FRAUDE REPETIBLE. Emitir una venta a nombre de un conocido, cobrar
 *      los $7.50 en puntos y anularla. Cincuenta veces, que es el tope de
 *      ahijados, son $375 en premios por ventas que nunca ocurrieron.
 *
 *   2. UN CLIENTE PERJUDICADO EN SILENCIO. El sello `referido_pagado_en`
 *      quedaba puesto, así que la PRIMERA COMPRA DE VERDAD de esa persona ya
 *      no pagaba a nadie. El padrino se quedaba sin su bono y nadie podía
 *      explicarle por qué: comprobado que la segunda venta, real, devolvía
 *      `referido: null`.
 *
 * Se devuelven sentencias y no se ejecutan, para que entren en el MISMO batch
 * que la anulación. Unos puntos de referido revertidos sin la venta anulada que
 * los explica —o al revés— son estados que no pueden existir.
 *
 * Las compras anteriores a este cambio no tienen sus asientos de referido
 * enlazados, así que para ellas esto no encuentra nada y no hace nada. Es lo
 * correcto: inventar de qué compra salió un asiento viejo sería peor que
 * dejarlo.
 */
export async function deshacerPorCompra(
  base: D1Database,
  compraId: string,
  compradorCodigo: string,
  motivo: string,
  autor: string,
): Promise<D1PreparedStatement[]> {
  const { results } = await base
    .prepare(
      `SELECT id, socio_codigo, puntos FROM movimientos
        WHERE compra_id = ? AND tipo = 'referido'`,
    )
    .bind(compraId)
    .all<{ id: string; socio_codigo: string; puntos: number }>();

  const asientos = results ?? [];
  if (!asientos.length) return [];

  const sentencias = asientos.map((a) =>
    sentenciaReverso(
      base,
      { id: a.id, socioCodigo: a.socio_codigo, puntos: a.puntos },
      `Se anuló la compra que lo generó: ${motivo}`,
      autor,
    ),
  );

  // Y se suelta el sello, para que la primera compra de verdad sí pague.
  sentencias.push(
    base
      .prepare(`UPDATE socios SET referido_pagado_en = NULL WHERE codigo = ?`)
      .bind(compradorCodigo),
  );

  return sentencias;
}
