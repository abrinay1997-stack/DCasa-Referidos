/**
 * Las reglas del dinero del programa, probadas una a una.
 *
 * Todo lo que se prueba aquí es puro, así que no hace falta base ni servidor:
 * entra un número y unas reglas, sale un número. Y es exactamente la misma
 * función que usa la pantalla de la vendedora para decir «esta compra le da 340
 * puntos» y el servidor para escribirlos. Si alguna vez dejaran de ser la
 * misma, la vendedora quedaría desmentida delante del cliente.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseDeCompra,
  comoDolares,
  comoPuntos,
  faltanPara,
  faltaParaAcreditar,
  faltaParaReferir,
  FaltaConfigurar,
  puntosDeCompra,
  saldo,
  type Reglas,
} from '../compartido/puntos.ts';

/** Unas reglas completas, para probar la aritmética. No son las de D'CASA. */
function reglas(cambios: Partial<Reglas['acumulacion']> = {}): Reglas {
  return {
    version: 1,
    moneda: 'USD',
    acumulacion: {
      puntosPorDolar: 1,
      baseDeCalculo: 'total',
      itbmsPorcentaje: 7,
      redondeo: 'abajo',
      compraMinimaCentavos: null,
      puntosMaximosPorCompra: null,
      ...cambios,
    },
    bienvenida: { puntos: null },
    referido: {
      niveles: 1,
      vestaCon: 'primera-compra-verificada',
      puntosAlPadrino: null,
      puntosAlAhijado: null,
      topeDeAhijadosPorPadrino: null,
      topeDePuntosPorPadrinoAlMes: null,
    },
    canje: { vigenciaDelCodigoHoras: 72, saldoMinimoParaCanjear: null },
    vencimiento: { meses: null },
    cumpleanos: { puntos: null },
  };
}

// ---------------------------------------------------------------------------
// Lo que impide acreditar con la economía a medio definir
// ---------------------------------------------------------------------------

test('sin puntosPorDolar, no acredita: LANZA en vez de devolver cero', () => {
  const r = reglas({ puntosPorDolar: null });

  // Lo importante es que no devuelva 0. Un cero se suma sin protestar y deja
  // la compra registrada dando nada, que es el fallo silencioso que nadie
  // descubre hasta que un cliente reclama en el mostrador.
  assert.throws(() => puntosDeCompra(10000, r), FaltaConfigurar);
  assert.equal(faltaParaAcreditar(r).length, 1);
  assert.match(faltaParaAcreditar(r)[0]!, /puntosPorDolar/);
});

test('sin baseDeCalculo decidida, no acredita', () => {
  const r = reglas({ baseDeCalculo: 'PENDIENTE' });
  assert.throws(() => puntosDeCompra(10000, r), FaltaConfigurar);
  assert.match(faltaParaAcreditar(r)[0]!, /baseDeCalculo/);
});

test('con la economía puesta, no falta nada', () => {
  assert.deepEqual(faltaParaAcreditar(reglas()), []);
});

test('sin puntosAlPadrino, no se puede pagar un referido', () => {
  assert.equal(faltaParaReferir(reglas()).length, 1);
});

// ---------------------------------------------------------------------------
// La base: total o subtotal sin ITBMS
// ---------------------------------------------------------------------------

test('con baseDeCalculo total, la base es lo que pagó el cliente', () => {
  assert.equal(baseDeCompra(10700, reglas({ baseDeCalculo: 'total' })), 10700);
});

test('con baseDeCalculo subtotal, se le saca el ITBMS incluido', () => {
  // $107.00 con un 7 % incluido son exactamente $100.00. Y tiene que dar
  // 10000 clavado, no 9999: la aritmética va en enteros de centavos de
  // principio a fin.
  assert.equal(baseDeCompra(10700, reglas({ baseDeCalculo: 'subtotal' })), 10000);
});

test('la diferencia entre total y subtotal es la pregunta abierta del ITBMS', () => {
  const sobreTotal = puntosDeCompra(107000, reglas({ baseDeCalculo: 'total' }));
  const sobreSubtotal = puntosDeCompra(107000, reglas({ baseDeCalculo: 'subtotal' }));

  // Sobre $1,070 de venta, la diferencia es del 6.5 %. A mil compras eso es un
  // premio entero regalado o negado, y por eso baseDeCalculo bloquea el
  // programa hasta que Marcial la responda.
  assert.equal(sobreTotal, 1070);
  assert.equal(sobreSubtotal, 1000);
});

test('un monto que no son centavos enteros y positivos no se acepta', () => {
  assert.throws(() => baseDeCompra(0, reglas()), RangeError);
  assert.throws(() => baseDeCompra(-500, reglas()), RangeError);
  assert.throws(() => baseDeCompra(99.5, reglas()), RangeError);
});

// ---------------------------------------------------------------------------
// El redondeo, que siempre va hacia abajo
// ---------------------------------------------------------------------------

test('redondea hacia abajo, nunca hacia arriba', () => {
  const r = reglas({ puntosPorDolar: 1 });

  // $49.99 es la cama más barata de D'CASA. A 1 punto por dólar son 49
  // puntos, no 50: hacia arriba se regala una fracción en cada venta, y a mil
  // ventas eso es dinero de verdad.
  assert.equal(puntosDeCompra(4999, r), 49);
  assert.equal(puntosDeCompra(9999, r), 99);
  assert.equal(puntosDeCompra(1, r), 0);
  assert.equal(puntosDeCompra(100, r), 1);
});

test('la aritmética aguanta importes grandes sin coma flotante', () => {
  const r = reglas({ puntosPorDolar: 3 });
  assert.equal(puntosDeCompra(999999, r), 29999);
  assert.equal(puntosDeCompra(100000000, r), 3000000);
});

test('una tasa fraccionaria sigue redondeando hacia abajo', () => {
  const r = reglas({ puntosPorDolar: 0.5 });
  assert.equal(puntosDeCompra(10000, r), 50);
  assert.equal(puntosDeCompra(10099, r), 50);
});

// ---------------------------------------------------------------------------
// Los dos topes
// ---------------------------------------------------------------------------

test('por debajo de la compra mínima no da puntos, y no es un error', () => {
  const r = reglas({ compraMinimaCentavos: 2000 });
  assert.equal(puntosDeCompra(1999, r), 0);
  assert.equal(puntosDeCompra(2000, r), 20);
});

test('el tope por compra corta donde dice', () => {
  // Existe para que un error de tecleo —$4,999.00 escrito como $499900.00— no
  // acredite una fortuna antes de que nadie lo vea.
  const r = reglas({ puntosMaximosPorCompra: 5000 });
  assert.equal(puntosDeCompra(49990000, r), 5000);
  assert.equal(puntosDeCompra(400000, r), 4000);
});

// ---------------------------------------------------------------------------
// El libro mayor
// ---------------------------------------------------------------------------

test('el saldo es la suma del libro mayor y nada más', () => {
  assert.equal(saldo([]), 0);
  assert.equal(saldo([{ puntos: 340 }, { puntos: 150 }, { puntos: -200 }]), 290);
});

test('un reverso deja el saldo igual que antes del asiento que anula', () => {
  const antes = [{ puntos: 500 }];
  const conCompra = [...antes, { puntos: 340 }];
  const conReverso = [...conCompra, { puntos: -340 }];

  assert.equal(saldo(conCompra), 840);
  assert.equal(saldo(conReverso), saldo(antes));
});

test('faltanPara nunca devuelve un número negativo', () => {
  assert.equal(faltanPara(800, 1000), 200);
  assert.equal(faltanPara(1000, 1000), 0);
  assert.equal(faltanPara(1500, 1000), 0);
});

// ---------------------------------------------------------------------------
// Cómo se escriben los números
// ---------------------------------------------------------------------------

test('los importes se escriben sin error de redondeo', () => {
  assert.equal(comoDolares(4999), '$49.99');
  assert.equal(comoDolares(107000), '$1,070.00');
  assert.equal(comoDolares(5), '$0.05');
  assert.equal(comoDolares(100), '$1.00');
  assert.equal(comoDolares(-2550), '-$25.50');
});

test('los puntos no llevan decimales', () => {
  assert.equal(comoPuntos(1250), '1,250');
  assert.equal(comoPuntos(0), '0');
});

// ---------------------------------------------------------------------------
// La economía que se decidió de verdad
// ---------------------------------------------------------------------------

test('las reglas de D’CASA, contra datos/puntos.json', async () => {
  const { default: reales } = await import('../datos/puntos.json', { with: { type: 'json' } });
  const r = reales as unknown as Reglas;

  // Esto NO es duplicar la configuración: es fijar por escrito lo que se
  // decidió, para que un cambio accidental —un cero de más, una coma movida—
  // no pase por las pruebas sin que nadie lo mire. Si la economía cambia a
  // propósito, esta prueba se cambia a propósito.
  assert.equal(r.acumulacion.puntosPorDolar, 1, '1 punto por dólar');
  assert.equal(r.acumulacion.baseDeCalculo, 'total', 'sobre el total, ITBMS incluido');
  assert.equal(r.acumulacion.compraMinimaCentavos, 2000, 'compra mínima de $20');
  assert.equal(r.bienvenida.puntos, 0, 'nada por registrarse');
  assert.equal(r.referido.puntosAlPadrino, 500);
  assert.equal(r.referido.puntosAlAhijado, 250);
  assert.equal(r.canje.saldoMinimoParaCanjear, 500);
  assert.equal(r.vencimiento.meses, null, 'los puntos no vencen');

  // La cifra que costó la pregunta abierta desde agosto.
  assert.equal(puntosDeCompra(107000, r), 1070, '$1,070 dan 1,070 puntos, no 1,000');

  // El 1 % de recompensa, comprobado sobre una venta redonda.
  assert.equal(puntosDeCompra(100000, r), 1000, '$1,000 dan 1,000 puntos = $10 al canjear');

  // La compra mínima.
  assert.equal(puntosDeCompra(1999, r), 0, '$19.99 no llega al mínimo');
  assert.equal(puntosDeCompra(2000, r), 20, '$20 sí');

  // El freno contra el error de tecleo: $4,999.00 escrito como 499900.
  assert.equal(
    puntosDeCompra(49990000, r),
    r.acumulacion.puntosMaximosPorCompra,
    'un monto absurdo se recorta en el tope',
  );
});

test('el tope mensual del padrino da para diez referidos', async () => {
  const { default: reales } = await import('../datos/puntos.json', { with: { type: 'json' } });
  const r = reales as unknown as Reglas;

  const tope = r.referido.topeDePuntosPorPadrinoAlMes!;
  const porReferido = r.referido.puntosAlPadrino!;

  assert.equal(tope / porReferido, 10, 'diez referidos cobrables al mes');
  // $50 mensuales es lo máximo que una sola persona puede sacar en bonos.
  assert.equal((tope / 100).toFixed(2), '50.00');
});
