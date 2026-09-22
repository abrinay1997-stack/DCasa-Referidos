/**
 * Los números que Marcial necesita para dirigir el programa.
 *
 * ---------------------------------------------------------------------------
 * LA CIFRA QUE MANDA ES EL PASIVO
 *
 * Un programa de puntos es una deuda. Cada punto acreditado es una promesa de
 * descuento que la tienda tendrá que pagar algún día, y el error clásico es
 * mirar solo cuántos se entregaron —que se siente gratis— sin mirar cuántos
 * siguen vivos esperando a ser canjeados.
 *
 * Por eso el número grande de esta pantalla no es «cuántos puntos dimos»: es
 * `puntosVivos` y su equivalente en dólares. Es lo que el programa debe hoy.
 *
 * Y los dos flujos brutos se enseñan APARTE, no escondidos detrás del neto:
 * quien solo ve el saldo no sabe si viene de poca actividad o de mucha
 * actividad muy canjeada, y son negocios distintos.
 * ---------------------------------------------------------------------------
 */

import { REGLAS } from './reglas';

/** Cuántos centavos vale un punto, según la escalera de premios sembrada. */
const CENTAVOS_POR_PUNTO = 1;

export interface Resumen {
  /** Lo que el programa debe hoy. */
  puntosVivos: number;
  pasivoCentavos: number;

  /**
   * El pasivo, PARTIDO EN DOS.
   *
   * `reclamados` son los puntos de quien entró al programa: esa gente tiene la
   * app, ve su saldo y va a canjearlo. Es deuda con fecha.
   *
   * `esperando` son los de quien compró y todavía no reclamó su ficha. Puede
   * que nunca la reclame, y entonces ese dinero no sale de la caja nunca.
   * Sumarlos en una sola cifra daría una deuda inflada con dinero que quizá
   * nadie pida — y peor, escondería la única cifra que dice si el QR está
   * funcionando: cuando `esperando` baja mientras `reclamados` sube, la gente
   * está entrando al programa.
   */
  reclamados: { puntos: number; centavos: number; socios: number };
  esperando: { puntos: number; centavos: number; socios: number };

  /** De dónde salieron los puntos, en bruto. */
  ganados: { compras: number; referidos: number; otros: number; total: number };

  /** Premios ya entregados: puntos que salieron de verdad y lo que costaron. */
  entregados: { cuantos: number; puntos: number; costoCentavos: number };

  /** Pedidos y sin recoger: puntos reservados que aún pueden volver. */
  pendientes: { cuantos: number; puntos: number };

  socios: { total: number; conCompra: number; porReferido: number };
}

export async function resumen(base: D1Database): Promise<Resumen> {
  const [vivos, porTipo, canjeados, pendientes, socios, partido] = await Promise.all([
    base
      .prepare(`SELECT COALESCE(SUM(puntos), 0) AS v FROM movimientos`)
      .first<{ v: number }>(),

    base
      .prepare(
        `SELECT tipo, COALESCE(SUM(puntos), 0) AS p FROM movimientos
          WHERE puntos > 0 GROUP BY tipo`,
      )
      .all<{ tipo: string; p: number }>(),

    base
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(puntos), 0) AS p,
                COALESCE(SUM(costo_centavos), 0) AS costo
           FROM canjes WHERE estado = 'entregado'`,
      )
      .first<{ c: number; p: number; costo: number }>(),

    base
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(puntos), 0) AS p
           FROM canjes WHERE estado = 'solicitado'`,
      )
      .first<{ c: number; p: number }>(),

    base
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN EXISTS (
             SELECT 1 FROM compras k WHERE k.socio_codigo = s.codigo AND k.anulada_en IS NULL
           ) THEN 1 ELSE 0 END), 0) AS conCompra,
           COALESCE(SUM(CASE WHEN referido_por IS NOT NULL THEN 1 ELSE 0 END), 0) AS porReferido
         FROM socios s WHERE s.eliminado_en IS NULL`,
      )
      .first<{ total: number; conCompra: number; porReferido: number }>(),

    // El saldo de cada ficha, agrupado por si tiene PIN o no. Se suma por
    // socio y luego se agrupa, y no al revés: `SUM` sobre el join daría lo
    // mismo aquí, pero contar CUÁNTAS fichas hay en cada grupo exige el
    // agrupado por ficha primero.
    base
      .prepare(
        `SELECT reclamada, COUNT(*) AS fichas, COALESCE(SUM(saldo), 0) AS puntos
           FROM (
             SELECT s.codigo,
                    CASE WHEN s.pin_hash <> '' THEN 1 ELSE 0 END AS reclamada,
                    COALESCE((SELECT SUM(m.puntos) FROM movimientos m
                               WHERE m.socio_codigo = s.codigo), 0) AS saldo
               FROM socios s WHERE s.eliminado_en IS NULL
           )
          WHERE saldo > 0
          GROUP BY reclamada`,
      )
      .all<{ reclamada: number; fichas: number; puntos: number }>(),
  ]);

  const de = (tipo: string) =>
    (porTipo.results ?? []).find((f) => f.tipo === tipo)?.p ?? 0;

  // `reverso` positivo es una devolución de canje: no es un punto ganado, así
  // que no entra en ninguno de los tres cubos. Se ve en el saldo vivo, que es
  // donde tiene que verse.
  const compras = de('compra');
  const referidos = de('referido');
  const otros = de('bienvenida') + de('cumpleanos') + de('ajuste');

  const puntosVivos = vivos?.v ?? 0;

  const grupo = (reclamada: number) => {
    const f = (partido.results ?? []).find((x) => x.reclamada === reclamada);
    return {
      puntos: f?.puntos ?? 0,
      centavos: (f?.puntos ?? 0) * CENTAVOS_POR_PUNTO,
      socios: f?.fichas ?? 0,
    };
  };

  return {
    puntosVivos,
    pasivoCentavos: puntosVivos * CENTAVOS_POR_PUNTO,
    reclamados: grupo(1),
    esperando: grupo(0),
    ganados: { compras, referidos, otros, total: compras + referidos + otros },
    entregados: {
      cuantos: canjeados?.c ?? 0,
      puntos: canjeados?.p ?? 0,
      costoCentavos: canjeados?.costo ?? 0,
    },
    pendientes: { cuantos: pendientes?.c ?? 0, puntos: pendientes?.p ?? 0 },
    socios: {
      total: socios?.total ?? 0,
      conCompra: socios?.conCompra ?? 0,
      porReferido: socios?.porReferido ?? 0,
    },
  };
}

/**
 * Cuánto registra cada vendedora, en los últimos 30 días.
 *
 * ESTE ES EL REPORTE ANTIFRAUDE, y es el único sitio del sistema donde se
 * mira al equipo. No hace falta acusar a nadie: si una vendedora emite el
 * triple de puntos que las otras con el mismo número de ventas, se ve de un
 * vistazo y se pregunta.
 *
 * Por eso `compras.vendedor` sale del token firmado de Cloudflare Access y
 * nunca del cuerpo de la petición: si el navegador lo pudiera enviar, esta
 * columna no valdría nada.
 */
export async function porVendedora(base: D1Database) {
  const desde = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  const { results } = await base
    .prepare(
      `SELECT vendedor,
              COUNT(*) AS compras,
              COALESCE(SUM(monto_centavos), 0) AS monto,
              COALESCE(SUM(puntos), 0) AS puntos
         FROM compras
        WHERE registrada_en >= ? AND anulada_en IS NULL
        GROUP BY vendedor ORDER BY puntos DESC`,
    )
    .bind(desde)
    .all<{ vendedor: string; compras: number; monto: number; puntos: number }>();

  return (results ?? []).map((f) => ({
    vendedora: f.vendedor,
    compras: f.compras,
    montoCentavos: f.monto,
    puntos: f.puntos,
  }));
}

/**
 * Altas por semana, las últimas ocho.
 *
 * Con cuántas vinieron por referido, que es la única forma de saber si el
 * programa se está contando solo o si cada alta la tiene que empujar el equipo.
 */
export async function altasPorSemana(base: D1Database) {
  const desde = new Date(Date.now() - 8 * 7 * 24 * 3600_000).toISOString();

  const { results } = await base
    .prepare(
      `SELECT strftime('%Y-%W', creado_en) AS semana,
              COUNT(*) AS altas,
              COALESCE(SUM(CASE WHEN referido_por IS NOT NULL THEN 1 ELSE 0 END), 0) AS porReferido,
              MIN(date(creado_en)) AS desde
         FROM socios
        WHERE creado_en >= ? AND eliminado_en IS NULL
        GROUP BY semana ORDER BY semana`,
    )
    .bind(desde)
    .all<{ semana: string; altas: number; porReferido: number; desde: string }>();

  return results ?? [];
}

/** Quién trae más gente. Solo los referidos que ya compraron cuentan. */
export async function quienTraeMas(base: D1Database) {
  const { results } = await base
    .prepare(
      `SELECT p.codigo, p.nombre, p.apellido,
              COUNT(*) AS traidos,
              COALESCE(SUM(CASE WHEN a.referido_pagado_en IS NOT NULL THEN 1 ELSE 0 END), 0) AS compraron
         FROM socios a JOIN socios p ON p.codigo = a.referido_por
        WHERE a.eliminado_en IS NULL AND p.eliminado_en IS NULL
        GROUP BY p.codigo ORDER BY compraron DESC, traidos DESC LIMIT 10`,
    )
    .all<{ codigo: string; nombre: string; apellido: string; traidos: number; compraron: number }>();

  return (results ?? []).map((f) => ({
    codigo: f.codigo,
    nombre: `${f.nombre} ${f.apellido}`.trim(),
    traidos: f.traidos,
    compraron: f.compraron,
  }));
}

/** Qué premios se piden. Dice cuáles sobran del catálogo y cuáles faltan. */
export async function premiosMasPedidos(base: D1Database) {
  const { results } = await base
    .prepare(
      `SELECT premio_nombre AS nombre,
              COUNT(*) AS pedidos,
              COALESCE(SUM(CASE WHEN estado = 'entregado' THEN 1 ELSE 0 END), 0) AS entregados,
              COALESCE(SUM(CASE WHEN estado = 'vencido' THEN 1 ELSE 0 END), 0) AS vencidos
         FROM canjes GROUP BY premio_id ORDER BY pedidos DESC LIMIT 10`,
    )
    .all<{ nombre: string; pedidos: number; entregados: number; vencidos: number }>();

  return results ?? [];
}

/** Lo que la pantalla pide de una vez. */
export async function todo(base: D1Database) {
  const [general, vendedoras, altas, padrinos, premios] = await Promise.all([
    resumen(base),
    porVendedora(base),
    altasPorSemana(base),
    quienTraeMas(base),
    premiosMasPedidos(base),
  ]);
  return {
    general,
    vendedoras,
    altas,
    padrinos,
    premios,
    reglas: {
      puntosPorDolar: REGLAS.acumulacion.puntosPorDolar,
      centavosPorPunto: CENTAVOS_POR_PUNTO,
    },
  };
}
