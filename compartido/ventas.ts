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

/**
 * Qué es cada renglón.
 *
 * LOS TRES VAN AL MISMO 7 %, y no es un descuido. El flete y el armado de lo
 * que uno mismo vende son «servicios accesorios» y entran en la base imponible
 * del ITBMS: el Decreto Ejecutivo 84 de 2005 nombra expresamente la «entrega o
 * entrega a domicilio» y los «gastos de instalación o montaje» entre ellos, se
 * facturen junto con el bien o por separado.
 *
 * La exención del transporte de carga es para quien presta el servicio de
 * transporte como tal, no para la mueblería que reparte lo que vendió. Sacar
 * el flete de la base porque «el transporte está exento» es declarar de menos.
 *
 * El tipo existe para que el comprobante lo diga y para poder sumar aparte lo
 * que la tienda cobra por llevar y armar — no para cambiar la tasa.
 */
export type TipoLinea = 'articulo' | 'flete' | 'armado';

export const NOMBRE_TIPO_LINEA: Record<TipoLinea, string> = {
  articulo: 'Artículo',
  flete: 'Entrega a domicilio',
  armado: 'Armado e instalación',
};

export function esTipoLinea(valor: unknown): valor is TipoLinea {
  return valor === 'articulo' || valor === 'flete' || valor === 'armado';
}

/** Una línea del comprobante. */
export interface LineaVenta {
  descripcion: string;
  cantidad: number;
  /** Precio de UNA unidad, sin ITBMS, en centavos enteros. */
  precioCentavos: number;
  /** Qué clase de renglón es. Si falta, un artículo. */
  tipo?: TipoLinea;
}

/** Lo que la pantalla manda para emitir. */
export interface DatosVenta {
  lineas: LineaVenta[];
  /** Lo que se rebajó negociando, sobre el bruto y antes del ITBMS. En una
   *  mueblería se negocia en el mostrador, así que existe. */
  descuentoCentavos: number;
  /**
   * Lo que el cliente pagó con puntos, ya cobrado de sus premios canjeados.
   *
   * SEPARADO DEL DESCUENTO A PROPÓSITO. Son dos cosas distintas: una es margen
   * que la tienda cede para cerrar la venta, y la otra es el programa de puntos
   * pagándose solo. Mezclarlas en una cifra hace imposible responder «¿cuánto
   * me costó el programa este mes?».
   *
   * La pantalla NO lo teclea: sale de los códigos de premio que se apliquen, y
   * lo calcula el servidor leyendo lo que vale cada premio. Ver
   * `worker/ventas.ts`.
   */
  canjeCentavos: number;
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
  /** Lo que suman las líneas, antes de rebajar nada. */
  brutoCentavos: number;
  descuentoCentavos: number;
  /** Lo pagado con puntos. Ver `DatosVenta.canjeCentavos`. */
  canjeCentavos: number;
  /**
   * Bruto menos el descuento y menos los puntos. ES LA BASE DEL ITBMS.
   *
   * Que el canje reste ANTES del impuesto es una decisión con consecuencia
   * fiscal, y está tomada así por una razón práctica que manda sobre las
   * demás: **la caja fiscal y este comprobante tienen que decir el mismo
   * total**. La vendedora teclea el canje como un descuento en la caja —es lo
   * único que la caja sabe hacer con él— y allí rebaja la base. Si aquí no
   * rebajara, los dos documentos de la misma venta dirían cifras distintas.
   *
   * El Decreto 84 de 2005 respalda el tratamiento: exige que los descuentos y
   * bonificaciones queden reflejados en el documento de venta en la oportunidad
   * del cobro, y el descuento rebaja la base.
   *
   * Es defendible y no es la única postura posible: tratarlo como medio de pago
   * dejaría la base intacta. La diferencia es de 7 centavos por cada dólar
   * canjeado. **Que el contador de D'CASA lo confirme por escrito antes de que
   * esto lleve mucho volumen encima.**
   */
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

  const canjeCentavos = datos?.canjeCentavos ?? 0;
  if (!Number.isInteger(canjeCentavos) || canjeCentavos < 0) {
    throw new VentaInvalida('canjeCentavos', 'El canje no es válido.');
  }

  // Rebajar más de lo que vale la venta deja un total negativo, que no es una
  // venta. Se comprueban JUNTOS: por separado, un descuento del 60 % y un canje
  // del 60 % pasaban los dos y dejaban la venta en negativo.
  if (descuentoCentavos + canjeCentavos > brutoCentavos) {
    throw new VentaInvalida(
      'descuentoCentavos',
      'El descuento y los puntos juntos son más que la venta.',
    );
  }

  const subtotalCentavos = brutoCentavos - descuentoCentavos - canjeCentavos;
  const itbmsCentavos = itbmsDe(subtotalCentavos, reglas);
  const totalCentavos = subtotalCentavos + itbmsCentavos;

  // Una venta de cero no es una venta. Puede salir de regalar todas las líneas
  // o de descontar el cien por ciento, y en los dos casos lo que hay es un
  // regalo: no lleva comprobante de venta ni suma puntos.
  if (totalCentavos <= 0) {
    throw new VentaInvalida('lineas', 'La venta suma cero. Revisa los precios y las rebajas.');
  }

  return {
    brutoCentavos,
    descuentoCentavos,
    canjeCentavos,
    subtotalCentavos,
    itbmsCentavos,
    totalCentavos,
    unidades,
  };
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
