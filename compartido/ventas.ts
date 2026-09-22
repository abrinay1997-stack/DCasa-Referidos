/**
 * Qué es una venta, y cómo se suma el dinero de una.
 *
 * Vive fuera del Worker y fuera de las pantallas por lo mismo que `puntos.ts`:
 * la pantalla enseña el total ANTES de emitir y el servidor lo vuelve a
 * calcular al guardarlo. Si fueran dos cuentas distintas, un día dirían cosas
 * distintas y la que ganaría sería la del servidor —con la vendedora ya
 * habiendo dicho otra cifra en voz alta, con el cliente delante—.
 *
 * Todo lo de aquí es puro: ni base de datos, ni red, ni reloj. Se prueba entero.
 *
 * ---------------------------------------------------------------------------
 * EL DINERO, EN CENTAVOS ENTEROS, SIEMPRE
 *
 * Ni un `number` con decimales en todo el archivo. `19.99 * 100` da
 * 1998.9999999999998 en coma flotante, y aquí eso es el dinero de un cliente.
 * El ITBMS también se calcula con enteros: `(base * 7 + 50) / 100` truncado es
 * redondeo al medio hacia arriba sin pasar nunca por un decimal.
 *
 * ---------------------------------------------------------------------------
 * LOS PRECIOS SE TECLEAN SIN ITBMS
 *
 * Es como se arma una factura en Panamá: precio unitario, subtotal, ITBMS
 * aparte, total. La pantalla enseña el total con impuesto mientras se teclea,
 * así que nadie tiene que hacer la cuenta de cabeza para saber qué va a cobrar.
 */

/** El ITBMS de Panamá, en porcentaje entero. Sale de `datos/puntos.json`. */
export interface ReglasVenta {
  itbmsPorcentaje: number;
}

/** Una línea del comprobante. */
export interface LineaVenta {
  descripcion: string;
  cantidad: number;
  /** Precio de UNA unidad, sin ITBMS, en centavos enteros. */
  precioCentavos: number;
}

/** Lo que la pantalla manda para emitir. */
export interface DatosVenta {
  lineas: LineaVenta[];
  /** Lo que se rebajó, sobre el bruto y antes del ITBMS. En una mueblería se
   *  negocia en el mostrador, así que existe. */
  descuentoCentavos: number;
  notas: string;
}

/**
 * Lo que suma una venta.
 *
 * Los tres importes se guardan por separado aunque el último sea la suma de los
 * otros dos. Aquí sumarlos SÍ es correcto —subtotal e ITBMS son la misma
 * moneda, del mismo cobro, del mismo día— a diferencia de lo que pasa en
 * PanaClaw entre un pago único y uno mensual, que son dos cosas y no se suman
 * jamás.
 */
export interface TotalesVenta {
  /** Lo que suman las líneas, antes del descuento. */
  brutoCentavos: number;
  descuentoCentavos: number;
  /** Bruto menos descuento. Es la base del ITBMS. */
  subtotalCentavos: number;
  itbmsCentavos: number;
  totalCentavos: number;
  /** Cuántas unidades salieron de la tienda. */
  unidades: number;
}

/** Lo que no se acepta de una venta, con el porqué escrito para la pantalla. */
export class VentaInvalida extends Error {
  readonly campo: string;

  constructor(campo: string, mensaje: string) {
    super(mensaje);
    this.name = 'VentaInvalida';
    this.campo = campo;
  }
}

/** Ni una línea vacía ni doscientas: un comprobante de mueblería cabe aquí. */
export const MAXIMO_LINEAS = 60;
/** Nadie vende diez mil unidades del mismo sofá en una venta. */
export const MAXIMO_CANTIDAD = 9_999;
/** Un millón de dólares en una línea es un dedo de más, no una venta. */
export const MAXIMO_PRECIO_CENTAVOS = 100_000_000;
export const MAXIMO_DESCRIPCION = 120;

/**
 * El ITBMS de una base, en centavos enteros.
 *
 * `(base * tasa + 50) / 100` truncado es redondeo al medio hacia arriba hecho
 * solo con enteros. Sobre $1,000 de base al 7 % da 7,000 centavos exactos; sobre
 * $19.99 —1,999 centavos— da 1999 * 7 = 13,993, más 50 son 14,043, y truncado a
 * centenas, 140: $1.40, que es lo que cobra cualquier caja del país.
 */
export function itbmsDe(baseCentavos: number, reglas: ReglasVenta): number {
  const tasa = reglas.itbmsPorcentaje;
  if (!Number.isInteger(tasa) || tasa < 0 || tasa > 100) {
    throw new VentaInvalida('itbms', 'El porcentaje de ITBMS no es válido.');
  }
  return Math.floor((baseCentavos * tasa + 50) / 100);
}

/** Una línea, revisada. Devuelve lo que suma. */
function revisarLinea(linea: LineaVenta, cual: number): number {
  const donde = `lineas.${cual}`;

  const descripcion = (linea?.descripcion ?? '').trim();
  if (!descripcion) {
    throw new VentaInvalida(`${donde}.descripcion`, `A la línea ${cual + 1} le falta qué se vendió.`);
  }
  if (descripcion.length > MAXIMO_DESCRIPCION) {
    throw new VentaInvalida(
      `${donde}.descripcion`,
      `La línea ${cual + 1} es demasiado larga: ${MAXIMO_DESCRIPCION} caracteres como mucho.`,
    );
  }

  const cantidad = linea?.cantidad;
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAXIMO_CANTIDAD) {
    throw new VentaInvalida(`${donde}.cantidad`, `La cantidad de la línea ${cual + 1} no es válida.`);
  }

  const precio = linea?.precioCentavos;
  // Cero SÍ vale: un artículo incluido sin cargo es parte de la venta y tiene
  // que salir escrito en el comprobante. Lo que no vale es negativo — eso es un
  // descuento, y el descuento tiene su propio campo donde se ve.
  if (!Number.isInteger(precio) || precio < 0 || precio > MAXIMO_PRECIO_CENTAVOS) {
    throw new VentaInvalida(`${donde}.precioCentavos`, `El precio de la línea ${cual + 1} no es válido.`);
  }

  return cantidad * precio;
}

/**
 * Los totales de una venta, o el porqué de que no se pueda emitir.
 *
 * Es LA misma función que llama la pantalla mientras se teclea y el Worker al
 * guardar. Ver la cabecera.
 */
export function totalesDe(datos: DatosVenta, reglas: ReglasVenta): TotalesVenta {
  const lineas = Array.isArray(datos?.lineas) ? datos.lineas : [];

  if (!lineas.length) throw new VentaInvalida('lineas', 'La venta no tiene ni una línea.');
  if (lineas.length > MAXIMO_LINEAS) {
    throw new VentaInvalida('lineas', `Son demasiadas líneas: ${MAXIMO_LINEAS} como mucho.`);
  }

  let brutoCentavos = 0;
  let unidades = 0;
  for (let i = 0; i < lineas.length; i += 1) {
    brutoCentavos += revisarLinea(lineas[i]!, i);
    unidades += lineas[i]!.cantidad;
  }

  const descuentoCentavos = datos?.descuentoCentavos ?? 0;
  if (!Number.isInteger(descuentoCentavos) || descuentoCentavos < 0) {
    throw new VentaInvalida('descuentoCentavos', 'El descuento no es válido.');
  }
  // Un descuento mayor que la venta deja un total negativo, que no es una
  // venta: es una devolución, y una devolución se hace anulando.
  if (descuentoCentavos > brutoCentavos) {
    throw new VentaInvalida('descuentoCentavos', 'El descuento es mayor que la venta.');
  }

  const subtotalCentavos = brutoCentavos - descuentoCentavos;
  const itbmsCentavos = itbmsDe(subtotalCentavos, reglas);
  const totalCentavos = subtotalCentavos + itbmsCentavos;

  // Una venta de cero no es una venta. Puede salir de regalar todas las líneas
  // o de descontar el cien por ciento, y en los dos casos lo que hay es un
  // regalo: no lleva comprobante de venta ni suma puntos.
  if (totalCentavos <= 0) {
    throw new VentaInvalida('lineas', 'La venta suma cero. Revisa los precios o el descuento.');
  }

  return { brutoCentavos, descuentoCentavos, subtotalCentavos, itbmsCentavos, totalCentavos, unidades };
}

// ---------------------------------------------------------------------------
// El número del comprobante
// ---------------------------------------------------------------------------

/** `VTA-2026-0007`. Con el año delante porque el contador se reinicia en enero. */
export function formatoNumeroVenta(anio: string, valor: number): string {
  return `VTA-${anio}-${String(valor).padStart(4, '0')}`;
}

/**
 * El número de factura fiscal se normaliza con `facturaNormal()`, que vive en
 * `compartido/compras.ts` y NO se reexporta desde aquí: `ventas` y `compras`
 * comparan el mismo número y tienen que estar de acuerdo sobre qué significa
 * «la misma factura», así que hay una sola función y se importa de su sitio.
 */
