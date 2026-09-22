/**
 * Registrar una compra, que es la operación más usada del sistema.
 *
 * Ocurre con el cliente delante y una cola detrás. Todo lo de aquí está pensado
 * para que la vendedora no tenga que decidir nada: busca, teclea dos datos, ve
 * cuántos puntos van a caer ANTES de confirmar, y confirma.
 */

import { ErrorPeticion, cuerpoJson } from './http';
import { sentenciaAsiento, sentenciaReverso } from './movimientos';
import { comoRespuesta, faltaParaCompras, REGLAS } from './reglas';
import { baseDeCompra, puntosDeCompra } from '../compartido/puntos';
import { porCodigo } from './socios';
import { facturaNormal } from '../compartido/compras';
import { choco } from '../compartido/choques';

export interface Calculo {
  montoCentavos: number;
  baseCentavos: number;
  puntos: number;
  /** El saldo del socio si esto se confirma. */
  saldoDespues: number;
}

/**
 * Cuántos puntos daría esta compra, sin escribir nada.
 *
 * Es lo que alimenta el «esta compra le da 340 puntos» que la vendedora ve
 * antes de confirmar, y usa LA MISMA función que después los escribe. Si fueran
 * dos, un día dirían cosas distintas y la vendedora quedaría desmentida delante
 * del cliente.
 */
export function calcular(montoCentavos: number, saldoActual: number): Calculo {
  try {
    const baseCentavos = baseDeCompra(montoCentavos, REGLAS);
    const puntos = puntosDeCompra(montoCentavos, REGLAS);
    return { montoCentavos, baseCentavos, puntos, saldoDespues: saldoActual + puntos };
  } catch (error) {
    return comoRespuesta(error);
  }
}

/** Lee y valida el monto que llega de la pantalla. */
export function montoDesde(valor: unknown): number {
  const centavos = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isInteger(centavos) || centavos <= 0) {
    throw new ErrorPeticion(400, 'invalida', 'El monto de la compra no es válido.');
  }
  // Un millón de dólares en una mueblería de La Chorrera es un dedo de más en el
  // teclado, no una venta. El tope duro está aquí y el configurable, en
  // `puntosMaximosPorCompra` de datos/puntos.json.
  if (centavos > 100_000_000) {
    throw new ErrorPeticion(400, 'invalida', 'Ese monto es demasiado grande. Revísalo.');
  }
  return centavos;
}

export interface CompraRegistrada {
  id: string;
  factura: string;
  montoCentavos: number;
  puntos: number;
  saldoNuevo: number;
}

/**
 * Registra la compra y acredita los puntos, en una sola operación.
 *
 * La fila de `compras` y el asiento del libro mayor van en el MISMO `batch`.
 * Una compra registrada que no acreditó puntos, o unos puntos acreditados sin
 * compra que los explique, son estados que no pueden existir — y la única forma
 * de que no existan es que las dos escrituras viajen juntas.
 *
 * El referido NO se paga aquí todavía: llega en la fase 3, y cuando llegue se
 * mete en este mismo batch por la misma razón.
 */
export async function registrar(
  base: D1Database,
  peticion: Request,
  vendedor: string,
): Promise<CompraRegistrada> {
  const falta = faltaParaCompras();
  if (falta.length) {
    throw new ErrorPeticion(
      503,
      'falta-configurar',
      `Todavía no se pueden registrar compras: ${falta.join(' ')}`,
      'datos/puntos.json',
    );
  }

  const datos = await cuerpoJson<{
    socio?: string;
    factura?: string;
    montoCentavos?: number;
    notas?: string;
  }>(peticion);

  const socio = await porCodigo(base, (datos.socio ?? '').trim().toUpperCase());
  if (!socio) throw new ErrorPeticion(404, 'no-encontrada', 'Ese socio no existe.');
  if (socio.estado === 'suspendido') {
    throw new ErrorPeticion(403, 'suspendida', 'Esa cuenta está suspendida. No se le puede sumar.');
  }

  const factura = (datos.factura ?? '').trim();
  if (!factura) throw new ErrorPeticion(400, 'invalida', 'Falta el número de factura.');
  const normal = facturaNormal(factura);

  const montoCentavos = montoDesde(datos.montoCentavos);

  let baseCentavos: number;
  let puntos: number;
  try {
    baseCentavos = baseDeCompra(montoCentavos, REGLAS);
    puntos = puntosDeCompra(montoCentavos, REGLAS);
  } catch (error) {
    return comoRespuesta(error);
  }

  const id = crypto.randomUUID();
  const ahora = new Date().toISOString();

  const sentencias: D1PreparedStatement[] = [
    base
      .prepare(
        `INSERT INTO compras
           (id, socio_codigo, factura, factura_normal, monto_centavos, base_centavos,
            puntos, reglas_version, registrada_en, vendedor, notas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        socio.codigo,
        factura,
        normal,
        montoCentavos,
        baseCentavos,
        puntos,
        REGLAS.version,
        ahora,
        vendedor,
        (datos.notas ?? '').trim(),
      ),
  ];

  // Una compra por debajo de la mínima se registra igual y da cero puntos. No
  // es un error: es una venta que no llega al umbral, y borrarla del historial
  // dejaría a la vendedora sin saber si la anotó o no.
  if (puntos > 0) {
    sentencias.push(
      sentenciaAsiento(base, {
        socioCodigo: socio.codigo,
        tipo: 'compra',
        puntos,
        compraId: id,
        autor: vendedor,
        ocurridoEn: ahora,
      }),
    );
  }

  try {
    await base.batch(sentencias);
  } catch (error) {
    // La columna, no el índice: SQLite dice «compras.factura_normal».
    if (choco(error, 'compras.factura_normal')) {
      const previa = await base
        .prepare(`SELECT socio_codigo, registrada_en FROM compras WHERE factura_normal = ?`)
        .bind(normal)
        .first<{ socio_codigo: string; registrada_en: string }>();
      throw new ErrorPeticion(
        409,
        'repetida',
        'Esa factura ya se cargó. Si es otra venta, revisa el número.',
        previa ? `Ya está en ${previa.socio_codigo}, el ${previa.registrada_en.slice(0, 10)}.` : undefined,
      );
    }
    throw error;
  }

  const saldo = await base
    .prepare(`SELECT COALESCE(SUM(puntos), 0) AS saldo FROM movimientos WHERE socio_codigo = ?`)
    .bind(socio.codigo)
    .first<{ saldo: number }>();

  return { id, factura, montoCentavos, puntos, saldoNuevo: saldo?.saldo ?? 0 };
}

/**
 * Anula una compra mal registrada.
 *
 * No se edita ni se borra: se marca anulada y el libro mayor recibe un asiento
 * contrario, con el motivo que el socio va a leer en su app. El motivo es
 * obligatorio por eso, no por burocracia.
 */
export async function anular(
  base: D1Database,
  id: string,
  peticion: Request,
  quien: string,
): Promise<{ anulada: string; puntosDevueltos: number }> {
  const datos = await cuerpoJson<{ motivo?: string }>(peticion);
  const motivo = (datos.motivo ?? '').trim();
  if (!motivo) {
    throw new ErrorPeticion(
      400,
      'invalida',
      'Escribe por qué se anula: el socio lo va a leer en su cuenta.',
    );
  }

  const compra = await base
    .prepare(`SELECT id, socio_codigo, puntos, anulada_en FROM compras WHERE id = ?`)
    .bind(id)
    .first<{ id: string; socio_codigo: string; puntos: number; anulada_en: string | null }>();

  if (!compra) throw new ErrorPeticion(404, 'no-encontrada', 'Esa compra no existe.');
  if (compra.anulada_en) {
    throw new ErrorPeticion(409, 'repetida', 'Esa compra ya estaba anulada.');
  }

  const ahora = new Date().toISOString();
  const sentencias: D1PreparedStatement[] = [
    base
      .prepare(
        `UPDATE compras SET anulada_en = ?, anulada_por = ?, anulada_motivo = ?
          WHERE id = ? AND anulada_en IS NULL`,
      )
      .bind(ahora, quien, motivo, id),
  ];

  if (compra.puntos > 0) {
    const asiento = await base
      .prepare(`SELECT id FROM movimientos WHERE compra_id = ? AND tipo = 'compra'`)
      .bind(id)
      .first<{ id: string }>();

    if (asiento) {
      sentencias.push(
        sentenciaReverso(
          base,
          { id: asiento.id, socioCodigo: compra.socio_codigo, puntos: compra.puntos },
          motivo,
          quien,
        ),
      );
    }
  }

  await base.batch(sentencias);
  return { anulada: id, puntosDevueltos: compra.puntos };
}

/** Las compras de un socio, más reciente arriba. Alimenta su ficha. */
export async function deSocio(base: D1Database, codigo: string, cuantas = 30) {
  const { results } = await base
    .prepare(
      `SELECT id, factura, monto_centavos, puntos, registrada_en, vendedor,
              anulada_en, anulada_motivo, notas
         FROM compras WHERE socio_codigo = ?
        ORDER BY registrada_en DESC LIMIT ?`,
    )
    .bind(codigo, Math.min(Math.max(cuantas, 1), 100))
    .all<Record<string, unknown>>();

  return (results ?? []).map((f) => ({
    id: f.id as string,
    factura: f.factura as string,
    montoCentavos: f.monto_centavos as number,
    puntos: f.puntos as number,
    registradaEn: f.registrada_en as string,
    vendedor: f.vendedor as string,
    anulada: Boolean(f.anulada_en),
    anuladaMotivo: (f.anulada_motivo as string) ?? '',
    notas: (f.notas as string) ?? '',
  }));
}
