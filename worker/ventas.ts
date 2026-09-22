/**
 * Las ventas: emitir el comprobante, y de paso todo lo demás.
 *
 * ---------------------------------------------------------------------------
 * UNA SOLA OPERACIÓN, TODO O NADA
 *
 * Emitir una venta escribe hasta cinco cosas: la ficha del cliente si no
 * existía, la venta, la compra que la explica, el asiento de puntos y —si esa
 * persona vino invitada y es su primera compra— los dos asientos del referido.
 *
 * Van TODAS en el mismo `batch`, que en D1 es una transacción. Cualquier
 * subconjunto de esas escrituras sin las demás es un estado que no puede
 * existir: una venta sin compra no acredita puntos, unos puntos sin venta no se
 * pueden explicar, y una ficha creada a medias deja a un cliente sin su
 * historial. La única forma de que no existan es que viajen juntas.
 *
 * La excepción es el número del comprobante, que se gasta ANTES del batch. Ver
 * `siguienteNumero`.
 *
 * ---------------------------------------------------------------------------
 * EL COMPROBANTE NO ES UNA FACTURA FISCAL
 *
 * Ver la cabecera de `migraciones/0006_ventas.sql`. Aquí eso se traduce en una
 * regla: `facturaFiscal` es obligatorio. El comprobante acompaña a la factura
 * de la tienda, no la sustituye.
 */

import { ErrorPeticion, cuerpoJson } from './http';
import { sentenciaAsiento, sentenciaReverso } from './movimientos';
import { comoRespuesta, faltaParaCompras, REGLAS } from './reglas';
import { baseDeCompra, puntosDeCompra } from '../compartido/puntos';
import { facturaNormal } from '../compartido/compras';
import { choco } from '../compartido/choques';
import { formatoNumeroVenta, totalesDe, VentaInvalida } from '../compartido/ventas';
import type { DatosVenta, LineaVenta, TotalesVenta } from '../compartido/ventas';
import * as referidos from './referidos';
import * as canjes from './canjes';
import { fichaDeVenta, sentenciasDeFichaNueva, type ClienteDeVenta } from './clientes';
import { diaEnPanama, hoyEnPanama } from './reloj';

/** Lo que se guarda dentro de `ventas.documento`, y lo que se reimprime. */
export interface DocumentoVenta {
  numero: string;
  /** La fecha que se imprime, en hora de Panamá. */
  fecha: string;
  emitidaEn: string;
  vendedora: string;
  facturaFiscal: string;
  /**
   * El cliente TAL COMO ESTABA ESE DÍA.
   *
   * Es una foto, no un enlace. El enlace también existe —`socio_codigo`— y los
   * dos conviven a propósito: el comprobante dice lo que decía cuando el
   * cliente se lo llevó, y la ficha dice lo que es hoy. Corregir un apellido
   * mal escrito no puede reescribir un papel que ya está en manos de alguien.
   */
  cliente: {
    codigo: string;
    nombre: string;
    apellido: string;
    telefono: string;
    cedula: string;
    correo: string;
    direccion: string;
  };
  lineas: LineaVenta[];
  totales: TotalesVenta;
  itbmsPorcentaje: number;
  /** Los premios que pagaron parte de esta venta. */
  canjes: { codigo: string; premio: string; valorCentavos: number }[];
  notas: string;
  /** Cuántos puntos dio, y cuánto saldo le quedó. Para imprimirlo debajo. */
  puntos: number;
  saldoDespues: number;
}

export interface VentaEmitida {
  numero: string;
  documento: DocumentoVenta;
  /** Si esta venta estrenó a alguien que vino invitado. */
  referido: { alPadrino: number; alAhijado: number } | null;
  /** Si la ficha del cliente se creó con esta venta. */
  fichaNueva: boolean;
}

// ---------------------------------------------------------------------------
// El número
// ---------------------------------------------------------------------------

/**
 * Gasta un número del consecutivo del año y lo devuelve.
 *
 * `ON CONFLICT ... RETURNING` es una sola sentencia, así que dos vendedoras que
 * emitan el mismo sábado no pueden llevarse el mismo número: SQLite serializa
 * la escritura y cada una ve el contador ya incrementado por la otra.
 *
 * Si el guardado posterior falla, el número queda gastado y la numeración salta
 * uno. Es el error correcto de los dos posibles: un hueco se explica, dos
 * clientes con el mismo comprobante en la mano no. Y como esto no es un
 * documento fiscal, un hueco tampoco le debe una explicación a la DGI.
 *
 * Por eso mismo se gasta LO ÚLTIMO, después de haber comprobado todo lo que se
 * podía comprobar: así los huecos son los de las carreras de verdad y no los de
 * una factura repetida que se podía haber visto antes.
 */
async function siguienteNumero(base: D1Database, fecha: string): Promise<string> {
  // El año sale de la fecha del documento, que va en hora de Panamá. El reloj
  // del servidor está en UTC, y a las 7 de la tarde del 31 de diciembre en
  // La Chorrera, en UTC ya es enero.
  const anio = /^\d{4}/.exec(fecha)?.[0] ?? String(new Date().getUTCFullYear());

  const fila = await base
    .prepare(
      `INSERT INTO consecutivos (anio, valor) VALUES (?, 1)
       ON CONFLICT(anio) DO UPDATE SET valor = valor + 1
       RETURNING valor`,
    )
    .bind(anio)
    .first<{ valor: number }>();

  if (!fila) throw new Error('El consecutivo de ventas no devolvió valor.');
  return formatoNumeroVenta(anio, fila.valor);
}

// ---------------------------------------------------------------------------
// Emitir
// ---------------------------------------------------------------------------

interface CuerpoEmitir {
  cliente?: ClienteDeVenta;
  facturaFiscal?: string;
  lineas?: LineaVenta[];
  descuentoCentavos?: number;
  /**
   * Los códigos de premio que el cliente trae en la mano.
   *
   * Viene el CÓDIGO, nunca el importe: lo que vale cada premio lo pone el
   * catálogo, no quien teclea. Ver `canjes.cobrarEnVenta`.
   */
  canjes?: string[];
  notas?: string;
}

export async function emitir(
  base: D1Database,
  peticion: Request,
  vendedora: string,
): Promise<VentaEmitida> {
  const falta = faltaParaCompras();
  if (falta.length) {
    throw new ErrorPeticion(
      503,
      'falta-configurar',
      `Todavía no se pueden emitir ventas: ${falta.join(' ')}`,
      'datos/puntos.json',
    );
  }

  const datos = await cuerpoJson<CuerpoEmitir>(peticion);

  const facturaFiscal = (datos.facturaFiscal ?? '').trim();
  if (!facturaFiscal) {
    throw new ErrorPeticion(
      400,
      'invalida',
      'Falta el número de la factura fiscal. El comprobante acompaña a la factura, no la sustituye.',
    );
  }
  const normal = facturaNormal(facturaFiscal);

  const pedidos = Array.isArray(datos.canjes) ? datos.canjes : [];

  // La factura repetida se mira ANTES de gastar un número. Es el rechazo más
  // probable de todos —la vendedora teclea el número de la venta anterior— y no
  // tiene por qué dejar un hueco en la numeración.
  const repetida = await base
    .prepare(`SELECT numero, socio_codigo, emitida_en FROM ventas WHERE factura_normal = ?`)
    .bind(normal)
    .first<{ numero: string; socio_codigo: string; emitida_en: string }>();
  if (repetida) {
    throw new ErrorPeticion(
      409,
      'repetida',
      'Esa factura ya tiene comprobante. Si es otra venta, revisa el número.',
      `Es el ${repetida.numero}, del ${diaEnPanama(repetida.emitida_en)}.`,
    );
  }

  // La ficha del cliente: la que ya existe, o una nueva sin PIN.
  const ficha = await fichaDeVenta(base, datos.cliente);

  if (ficha.estado === 'suspendido') {
    throw new ErrorPeticion(
      403,
      'suspendida',
      'Esa ficha está suspendida. No se le puede emitir hasta que se reactive.',
    );
  }

  const ahora = new Date().toISOString();
  const fecha = hoyEnPanama();
  const compraId = crypto.randomUUID();

  // El número se gasta AQUÍ y no al final: los premios que se cobran abajo lo
  // llevan escrito, y una venta sin número no puede sellarlos. Todo lo que se
  // podía rechazar sin gastar número —la factura repetida, el cliente, las
  // líneas— ya se rechazó antes.
  const numero = await siguienteNumero(base, fecha);

  // Los premios que el cliente trae. El importe lo pone el catálogo.
  const cobrados = await canjes.cobrarEnVenta(base, pedidos, ficha.codigo, numero, ahora, vendedora);
  const canjeCentavos = cobrados.reduce((suma, c) => suma + c.valorCentavos, 0);

  // Los totales, con la MISMA función que la pantalla usó para enseñarlos.
  const venta: DatosVenta = {
    lineas: Array.isArray(datos.lineas) ? datos.lineas : [],
    descuentoCentavos: datos.descuentoCentavos ?? 0,
    canjeCentavos,
    notas: (datos.notas ?? '').trim(),
  };

  let totales: TotalesVenta;
  try {
    totales = totalesDe(venta, { itbmsPorcentaje: REGLAS.acumulacion.itbmsPorcentaje });
  } catch (error) {
    if (error instanceof VentaInvalida) {
      throw new ErrorPeticion(400, 'invalida', error.message, error.campo);
    }
    throw error;
  }

  let baseCentavos: number;
  let puntos: number;
  try {
    baseCentavos = baseDeCompra(totales.totalCentavos, REGLAS);
    puntos = puntosDeCompra(totales.totalCentavos, REGLAS);
  } catch (error) {
    return comoRespuesta(error);
  }

  const sentencias: D1PreparedStatement[] = [];

  // 1. La ficha, si hay que crearla.
  if (ficha.nueva) sentencias.push(...sentenciasDeFichaNueva(base, ficha, ahora, vendedora));

  // 2. La compra. Es la que acredita: el programa de puntos no sabe de ventas,
  //    sabe de compras, y así sigue siendo. La venta la explica, no la sustituye.
  sentencias.push(
    base
      .prepare(
        `INSERT INTO compras
           (id, socio_codigo, factura, factura_normal, monto_centavos, base_centavos,
            puntos, reglas_version, registrada_en, vendedor, notas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        compraId,
        ficha.codigo,
        facturaFiscal,
        normal,
        totales.totalCentavos,
        baseCentavos,
        puntos,
        REGLAS.version,
        ahora,
        vendedora,
        venta.notas,
      ),
  );

  // 3. Los puntos. Una venta por debajo de la compra mínima da cero y se emite
  //    igual: es una venta pequeña, no un error.
  if (puntos > 0) {
    sentencias.push(
      sentenciaAsiento(base, {
        socioCodigo: ficha.codigo,
        tipo: 'compra',
        puntos,
        compraId,
        autor: vendedora,
        ocurridoEn: ahora,
      }),
    );
  }

  // 4. El referido, si esta es la primera compra de alguien que vino invitado.
  //    Se decide ANTES de insertar la compra: «ninguna compra previa» tiene que
  //    significar que la de ahora es la primera.
  const referido = await referidos.alRegistrarCompra(
    base,
    {
      codigo: ficha.codigo,
      nombre: ficha.nombre,
      referido_por: ficha.referidoPor,
      referido_pagado_en: ficha.referidoPagadoEn,
    },
    puntos,
    ahora,
    vendedora,
    compraId,
  );
  sentencias.push(...referido.sentencias);

  // 5. La venta. Va la última para que el documento pueda llevar dentro el
  //    saldo que quedó, que es lo que el cliente lee en su comprobante.
  const saldoAntes = await saldoDe(base, ficha.codigo);
  const saldoDespues =
    saldoAntes + puntos + (referido.pagado && referido.pagado.alAhijado ? referido.pagado.alAhijado : 0);

  const documento: DocumentoVenta = {
    numero,
    fecha,
    emitidaEn: ahora,
    vendedora,
    facturaFiscal,
    cliente: {
      codigo: ficha.codigo,
      nombre: ficha.nombre,
      apellido: ficha.apellido,
      telefono: ficha.telefono,
      cedula: ficha.cedula,
      correo: ficha.correo,
      direccion: ficha.direccion,
    },
    lineas: venta.lineas.map((l) => ({
      descripcion: l.descripcion.trim(),
      cantidad: l.cantidad,
      precioCentavos: l.precioCentavos,
    })),
    totales,
    itbmsPorcentaje: REGLAS.acumulacion.itbmsPorcentaje,
    // Qué premios pagaron parte de esta venta. Va en el documento para que el
    // comprobante reimpreso los siga diciendo, aunque el catálogo cambie.
    canjes: cobrados.map((c) => ({
      codigo: c.codigo,
      premio: c.premio,
      valorCentavos: c.valorCentavos,
    })),
    notas: venta.notas,
    puntos,
    saldoDespues,
  };

  sentencias.push(
    base
      .prepare(
        `INSERT INTO ventas
           (numero, socio_codigo, factura_fiscal, factura_normal, emitida_en, vendedora,
            subtotal_centavos, itbms_centavos, total_centavos, unidades,
            descuento_centavos, canje_centavos, compra_id, puntos, documento)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        numero,
        ficha.codigo,
        facturaFiscal,
        normal,
        ahora,
        vendedora,
        totales.subtotalCentavos,
        totales.itbmsCentavos,
        totales.totalCentavos,
        totales.unidades,
        totales.descuentoCentavos,
        totales.canjeCentavos,
        compraId,
        puntos,
        JSON.stringify(documento),
      ),
  );

  // Los premios se marcan entregados EN ESTE MISMO BATCH. Si uno ya lo cobró
  // otra vendedora, su `WHERE estado = 'solicitado'` no cambia nada y D1
  // deshace la venta entera: mejor repetir la venta que regalar el premio dos
  // veces.
  sentencias.push(...cobrados.map((c) => c.sentencia));

  try {
    await base.batch(sentencias);
  } catch (error) {
    // Dos vendedoras con la misma factura a la vez: la primera pasó la
    // comprobación de arriba y esta llega aquí. La columna, no el índice.
    if (choco(error, 'ventas.factura_normal') || choco(error, 'compras.factura_normal')) {
      throw new ErrorPeticion(
        409,
        'repetida',
        'Esa factura ya tiene comprobante. Si es otra venta, revisa el número.',
      );
    }
    if (choco(error, 'socios.telefono_normal')) {
      throw new ErrorPeticion(
        409,
        'repetida',
        'Ese celular ya tiene ficha. Búscala por el número y emite sobre ella.',
      );
    }
    if (choco(error, 'socios.cedula_digitos')) {
      throw new ErrorPeticion(
        409,
        'repetida',
        'Esa cédula ya tiene ficha. Búscala por la cédula y emite sobre ella.',
      );
    }
    throw error;
  }

  return {
    numero,
    documento,
    referido: referido.pagado
      ? { alPadrino: referido.pagado.alPadrino, alAhijado: referido.pagado.alAhijado }
      : null,
    fichaNueva: ficha.nueva,
  };
}

async function saldoDe(base: D1Database, codigo: string): Promise<number> {
  const fila = await base
    .prepare(`SELECT COALESCE(SUM(puntos), 0) AS saldo FROM movimientos WHERE socio_codigo = ?`)
    .bind(codigo)
    .first<{ saldo: number }>();
  return fila?.saldo ?? 0;
}

// ---------------------------------------------------------------------------
// Leer
// ---------------------------------------------------------------------------

export interface VentaEnLista {
  numero: string;
  fecha: string;
  emitidaEn: string;
  vendedora: string;
  facturaFiscal: string;
  clienteCodigo: string;
  clienteNombre: string;
  totalCentavos: number;
  unidades: number;
  puntos: number;
  anulada: boolean;
  anuladaMotivo: string;
}

export const VENTAS_POR_PAGINA = 25;

/**
 * El historial. Busca por número de comprobante, por factura fiscal, por
 * código de cliente y por nombre — que son las cuatro cosas que alguien tiene
 * a mano cuando viene a preguntar por una venta.
 */
export async function listar(
  base: D1Database,
  opciones: { texto?: string; cliente?: string; pagina?: number; anuladas?: boolean } = {},
): Promise<{ ventas: VentaEnLista[]; cuantas: number; pagina: number; porPagina: number }> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (!opciones.anuladas) condiciones.push('v.anulada_en IS NULL');

  if (opciones.cliente) {
    condiciones.push('v.socio_codigo = ?');
    valores.push(opciones.cliente.trim().toUpperCase());
  }

  const texto = (opciones.texto ?? '').trim();
  if (texto) {
    const like = `%${texto.toLowerCase()}%`;
    const digitos = texto.replace(/\D/g, '');
    condiciones.push(
      `(lower(v.numero) LIKE ? OR lower(v.factura_fiscal) LIKE ? OR lower(v.socio_codigo) LIKE ?
        OR s.nombre_normal LIKE ?` +
        (digitos ? ` OR s.telefono_normal LIKE ?` : '') +
        `)`,
    );
    valores.push(like, like, like, like);
    if (digitos) valores.push(`%${digitos}%`);
  }

  const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const pagina = Math.max(1, Math.floor(opciones.pagina ?? 1));
  const desde = (pagina - 1) * VENTAS_POR_PAGINA;

  const cuenta = await base
    .prepare(`SELECT COUNT(*) AS n FROM ventas v JOIN socios s ON s.codigo = v.socio_codigo ${donde}`)
    .bind(...valores)
    .first<{ n: number }>();

  const { results } = await base
    .prepare(
      `SELECT v.numero, v.emitida_en, v.vendedora, v.factura_fiscal, v.socio_codigo,
              v.total_centavos, v.unidades, v.puntos, v.anulada_en, v.anulada_motivo,
              s.nombre, s.apellido
         FROM ventas v JOIN socios s ON s.codigo = v.socio_codigo
         ${donde}
        ORDER BY v.emitida_en DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(...valores, VENTAS_POR_PAGINA, desde)
    .all<Record<string, unknown>>();

  const ventas = (results ?? []).map((f) => ({
    numero: f.numero as string,
    // En hora de Panamá, para que el historial diga el mismo día que el papel.
    fecha: diaEnPanama(f.emitida_en as string),
    emitidaEn: f.emitida_en as string,
    vendedora: f.vendedora as string,
    facturaFiscal: f.factura_fiscal as string,
    clienteCodigo: f.socio_codigo as string,
    clienteNombre: `${f.nombre as string} ${(f.apellido as string) ?? ''}`.trim(),
    totalCentavos: f.total_centavos as number,
    unidades: f.unidades as number,
    puntos: f.puntos as number,
    anulada: Boolean(f.anulada_en),
    anuladaMotivo: (f.anulada_motivo as string) ?? '',
  }));

  return { ventas, cuantas: cuenta?.n ?? 0, pagina, porPagina: VENTAS_POR_PAGINA };
}

/** Un comprobante entero, para reimprimirlo tal como se entregó. */
export async function porNumero(base: D1Database, numero: string) {
  const fila = await base
    .prepare(
      `SELECT numero, documento, anulada_en, anulada_por, anulada_motivo, compra_id
         FROM ventas WHERE numero = ?`,
    )
    .bind(numero.trim().toUpperCase())
    .first<{
      numero: string;
      documento: string;
      anulada_en: string | null;
      anulada_por: string | null;
      anulada_motivo: string;
      compra_id: string | null;
    }>();

  if (!fila) throw new ErrorPeticion(404, 'no-encontrada', 'Ese comprobante no existe.');

  return {
    numero: fila.numero,
    documento: JSON.parse(fila.documento) as DocumentoVenta,
    anulada: Boolean(fila.anulada_en),
    anuladaEn: fila.anulada_en,
    anuladaPor: fila.anulada_por,
    anuladaMotivo: fila.anulada_motivo,
    compraId: fila.compra_id,
  };
}

// ---------------------------------------------------------------------------
// Anular
// ---------------------------------------------------------------------------

/**
 * Anula una venta, y con ella la compra y los puntos que generó.
 *
 * Las tres cosas en el mismo batch, por lo mismo que al emitir: una venta
 * anulada cuyos puntos siguen vivos es un saldo que nadie puede explicar.
 *
 * No borra nada. El comprobante sigue ahí, marcado, porque el cliente tiene su
 * copia en la mano y el sistema no puede fingir que aquello no pasó.
 */
export async function anular(
  base: D1Database,
  numero: string,
  peticion: Request,
  quien: string,
): Promise<{ numero: string; puntosDevueltos: number }> {
  const datos = await cuerpoJson<{ motivo?: string }>(peticion);
  const motivo = (datos.motivo ?? '').trim();
  if (!motivo) {
    throw new ErrorPeticion(
      400,
      'invalida',
      'Escribe por qué se anula: el cliente lo va a leer en su cuenta.',
    );
  }

  const venta = await base
    .prepare(
      `SELECT numero, socio_codigo, compra_id, puntos, anulada_en
         FROM ventas WHERE numero = ?`,
    )
    .bind(numero.trim().toUpperCase())
    .first<{
      numero: string;
      socio_codigo: string;
      compra_id: string | null;
      puntos: number;
      anulada_en: string | null;
    }>();

  if (!venta) throw new ErrorPeticion(404, 'no-encontrada', 'Ese comprobante no existe.');
  if (venta.anulada_en) throw new ErrorPeticion(409, 'repetida', 'Ese comprobante ya estaba anulado.');

  const ahora = new Date().toISOString();
  const sentencias: D1PreparedStatement[] = [
    base
      .prepare(
        `UPDATE ventas SET anulada_en = ?, anulada_por = ?, anulada_motivo = ?
          WHERE numero = ? AND anulada_en IS NULL`,
      )
      .bind(ahora, quien, motivo, venta.numero),
  ];

  if (venta.compra_id) {
    sentencias.push(
      base
        .prepare(
          `UPDATE compras SET anulada_en = ?, anulada_por = ?, anulada_motivo = ?
            WHERE id = ? AND anulada_en IS NULL`,
        )
        .bind(ahora, quien, motivo, venta.compra_id),
    );

    if (venta.puntos > 0) {
      const asiento = await base
        .prepare(`SELECT id FROM movimientos WHERE compra_id = ? AND tipo = 'compra'`)
        .bind(venta.compra_id)
        .first<{ id: string }>();

      if (asiento) {
        sentencias.push(
          sentenciaReverso(
            base,
            { id: asiento.id, socioCodigo: venta.socio_codigo, puntos: venta.puntos },
            `Comprobante ${venta.numero} anulado: ${motivo}`,
            quien,
          ),
        );
      }
    }

    // Y el referido que esta venta pudo haber disparado. Ver
    // `referidos.deshacerPorCompra`: sin esto, anular dejaba $7.50 en puntos
    // regalados y quemaba el referido real del cliente para siempre.
    sentencias.push(
      ...(await referidos.deshacerPorCompra(
        base,
        venta.compra_id,
        venta.socio_codigo,
        `comprobante ${venta.numero}`,
        quien,
      )),
    );
  }

  await base.batch(sentencias);
  return { numero: venta.numero, puntosDevueltos: venta.puntos };
}

/** Las ventas de un cliente, lo último arriba. Alimenta su ficha. */
export async function deCliente(base: D1Database, codigo: string, cuantas = 30) {
  const { results } = await base
    .prepare(
      `SELECT numero, emitida_en, factura_fiscal, total_centavos, unidades, puntos,
              vendedora, anulada_en, anulada_motivo
         FROM ventas WHERE socio_codigo = ?
        ORDER BY emitida_en DESC LIMIT ?`,
    )
    .bind(codigo, Math.min(Math.max(cuantas, 1), 100))
    .all<Record<string, unknown>>();

  return (results ?? []).map((f) => ({
    numero: f.numero as string,
    emitidaEn: f.emitida_en as string,
    facturaFiscal: f.factura_fiscal as string,
    totalCentavos: f.total_centavos as number,
    unidades: f.unidades as number,
    puntos: f.puntos as number,
    vendedora: f.vendedora as string,
    anulada: Boolean(f.anulada_en),
    anuladaMotivo: (f.anulada_motivo as string) ?? '',
  }));
}
