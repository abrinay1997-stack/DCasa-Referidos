/**
 * Las reglas del programa, y la aritmética que las aplica.
 *
 * Todo lo de aquí es PURO: entra un número y unas reglas, sale un número. No
 * toca la base, no lee la hora, no depende de Cloudflare. Por eso se puede
 * probar entero y por eso la misma función calcula los puntos en la pantalla
 * de la vendedora («esta compra le da 340 puntos») y en el servidor que los
 * escribe. Si fueran dos funciones, un día dirían cosas distintas y la
 * vendedora quedaría desmentida delante del cliente.
 *
 * NINGUNA CIFRA ESTÁ ESCRITA AQUÍ. Todas vienen de `datos/puntos.json`, que es
 * la única fuente. Si falta un valor, estas funciones lo dicen; no lo suponen.
 */

/** Sobre qué monto se calculan los puntos. */
export type BaseDeCalculo = 'total' | 'subtotal' | 'PENDIENTE';

export interface ReglasAcumulacion {
  puntosPorDolar: number | null;
  baseDeCalculo: BaseDeCalculo;
  itbmsPorcentaje: number;
  redondeo: 'abajo';
  compraMinimaCentavos: number | null;
  puntosMaximosPorCompra: number | null;
}

export interface ReglasReferido {
  niveles: number;
  vestaCon: 'primera-compra-verificada';
  puntosAlPadrino: number | null;
  puntosAlAhijado: number | null;
  topeDeAhijadosPorPadrino: number | null;
  topeDePuntosPorPadrinoAlMes: number | null;
}

export interface Reglas {
  version: number;
  moneda: string;
  acumulacion: ReglasAcumulacion;
  bienvenida: { puntos: number | null };
  referido: ReglasReferido;
  canje: { vigenciaDelCodigoHoras: number; saldoMinimoParaCanjear: number | null };
  vencimiento: { meses: number | null };
  cumpleanos: { puntos: number | null };
}

/**
 * Lo que impide que el programa acredite puntos con la economía a medio
 * definir.
 *
 * Se lanza —y no se devuelve un cero— a propósito. Un cero se suma sin
 * protestar y deja la compra registrada dando nada, que es exactamente el
 * fallo silencioso que nadie descubre hasta que un cliente reclama. Esto
 * revienta arriba, el Worker lo convierte en un 503 con el nombre del campo
 * que falta, y la vendedora lee qué hay que configurar.
 */
export class FaltaConfigurar extends Error {
  /** El campo de `datos/puntos.json` que hay que rellenar. */
  readonly campo: string;

  // El campo se declara y se asigna a mano, en vez de con una propiedad de
  // parámetro (`constructor(readonly campo: string)`). Es más largo y es a
  // propósito: `node --test` ejecuta este archivo quitando los tipos sin
  // compilarlo, y ese modo no admite propiedades de parámetro. Escribirlo así
  // deja que todo `compartido/` se pruebe sin empaquetador, que es lo que hace
  // que estas reglas se prueben de verdad en vez de «cuando alguien monte el
  // arnés».
  constructor(campo: string, mensaje: string) {
    super(mensaje);
    this.name = 'FaltaConfigurar';
    this.campo = campo;
  }
}

/** Qué le falta a `datos/puntos.json` para poder acreditar una compra. */
export function faltaParaAcreditar(reglas: Reglas): string[] {
  const falta: string[] = [];
  const a = reglas.acumulacion;

  if (a.puntosPorDolar === null) {
    falta.push('acumulacion.puntosPorDolar: falta definir cuántos puntos da cada dólar.');
  } else if (!(a.puntosPorDolar > 0)) {
    falta.push('acumulacion.puntosPorDolar tiene que ser mayor que cero.');
  }

  if (a.baseDeCalculo !== 'total' && a.baseDeCalculo !== 'subtotal') {
    falta.push(
      'acumulacion.baseDeCalculo: falta decidir si los puntos se calculan sobre el total ' +
        'que pagó el cliente o sobre el subtotal sin ITBMS.',
    );
  }

  return falta;
}

/** Qué le falta para poder pagar un referido. */
export function faltaParaReferir(reglas: Reglas): string[] {
  const falta: string[] = [];
  if (reglas.referido.puntosAlPadrino === null) {
    falta.push('referido.puntosAlPadrino: falta definir cuánto gana quien trae a alguien.');
  }
  return falta;
}

/**
 * Sobre cuánto se calculan los puntos de una compra.
 *
 * Con `baseDeCalculo: 'total'` es lo que pagó el cliente, tal cual. Con
 * `'subtotal'` se le saca el ITBMS que viene incluido en el precio.
 *
 * La aritmética va en enteros de centavos de principio a fin. `10700` con un
 * 7 % incluido da exactamente `10000`, y no `9999.999…` redondeado a mano más
 * tarde: `monto * 100 / (100 + itbms)` mantiene la división en enteros hasta el
 * último paso, que es el único sitio donde se redondea.
 */
export function baseDeCompra(montoCentavos: number, reglas: Reglas): number {
  const a = reglas.acumulacion;

  if (!Number.isInteger(montoCentavos) || montoCentavos <= 0) {
    throw new RangeError('El monto de una compra va en centavos enteros y mayores que cero.');
  }

  if (a.baseDeCalculo === 'total') return montoCentavos;

  if (a.baseDeCalculo === 'subtotal') {
    return Math.round((montoCentavos * 100) / (100 + a.itbmsPorcentaje));
  }

  throw new FaltaConfigurar(
    'acumulacion.baseDeCalculo',
    'No se puede calcular la base de una compra: falta decidir en datos/puntos.json si ' +
      'los puntos salen del total o del subtotal sin ITBMS.',
  );
}

/**
 * Cuántos puntos da una compra.
 *
 * Redondea SIEMPRE hacia abajo. Hacia arriba regala una fracción de punto en
 * cada venta, y a mil ventas eso es dinero de verdad; hacia abajo el socio
 * nunca ve menos de lo que calculó en la cabeza.
 */
export function puntosDeCompra(montoCentavos: number, reglas: Reglas): number {
  const falta = faltaParaAcreditar(reglas);
  if (falta.length) throw new FaltaConfigurar('acumulacion', falta.join(' '));

  const a = reglas.acumulacion;

  if (a.compraMinimaCentavos !== null && montoCentavos < a.compraMinimaCentavos) return 0;

  const base = baseDeCompra(montoCentavos, reglas);
  const puntos = Math.floor((base * a.puntosPorDolar!) / 100);

  if (a.puntosMaximosPorCompra !== null && puntos > a.puntosMaximosPorCompra) {
    return a.puntosMaximosPorCompra;
  }
  return puntos;
}

/**
 * El saldo de un socio: la suma de su libro mayor, y nada más.
 *
 * No hay ninguna columna `saldo` en la base, y esta función es la única forma
 * de saber cuántos puntos tiene alguien. Ver la cabecera de
 * `migraciones/0002_movimientos.sql` para el porqué.
 */
export function saldo(asientos: readonly { puntos: number }[]): number {
  let total = 0;
  for (const asiento of asientos) total += asiento.puntos;
  return total;
}

/** Cuántos puntos le faltan para un premio. Cero si ya le alcanza. */
export function faltanPara(saldoActual: number, puntosDelPremio: number): number {
  return Math.max(0, puntosDelPremio - saldoActual);
}

/**
 * Un importe en centavos, escrito como lo lee una persona en Panamá.
 *
 * `107000` → `$1,070.00`. Nunca se formatea dividiendo por 100 en coma
 * flotante: se parte la cadena de dígitos, que no tiene error de redondeo.
 */
export function comoDolares(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const enteros = Math.floor(Math.abs(centavos) / 100);
  const resto = String(Math.abs(centavos) % 100).padStart(2, '0');
  return `${signo}$${enteros.toLocaleString('en-US')}.${resto}`;
}

/** `1250` → `1,250`. Los puntos no llevan decimales nunca. */
export function comoPuntos(puntos: number): string {
  return puntos.toLocaleString('en-US');
}
