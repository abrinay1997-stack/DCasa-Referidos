/**
 * La aritmética de una venta, caso por caso.
 *
 * Es la misma función que la pantalla usa para enseñar el total mientras la
 * vendedora teclea y el servidor para guardarlo. Lo que se prueba aquí es que
 * no se pueda cobrar un centavo distinto del que se dijo en voz alta.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatoNumeroVenta,
  itbmsDe,
  totalesDe,
  VentaInvalida,
  type DatosVenta,
  type LineaVenta,
} from '../compartido/ventas.ts';

const PANAMA = { itbmsPorcentaje: 7 };

const linea = (cambios: Partial<LineaVenta> = {}): LineaVenta => ({
  descripcion: 'Juego de sala 3-2-1',
  cantidad: 1,
  precioCentavos: 100_000,
  ...cambios,
});

const venta = (cambios: Partial<DatosVenta> = {}): DatosVenta => ({
  lineas: [linea()],
  descuentoCentavos: 0,
  notas: '',
  ...cambios,
});

// --- El ITBMS ---------------------------------------------------------------

test('el ITBMS de $1,000 al 7 % son $70 exactos', () => {
  assert.equal(itbmsDe(100_000, PANAMA), 7_000);
});

test('el ITBMS se redondea al centavo, hacia arriba en el medio', () => {
  // 1,999 * 7 = 13,993 → 139.93 centavos → 140.
  assert.equal(itbmsDe(1_999, PANAMA), 140);
  // 50 * 7 = 350 → 3.5 centavos → 4, no 3.
  assert.equal(itbmsDe(50, PANAMA), 4);
});

test('el ITBMS de cero es cero, y no una décima', () => {
  assert.equal(itbmsDe(0, PANAMA), 0);
});

test('una tasa que no es un porcentaje entero se rechaza', () => {
  assert.throws(() => itbmsDe(100, { itbmsPorcentaje: 7.5 }), VentaInvalida);
  assert.throws(() => itbmsDe(100, { itbmsPorcentaje: -1 }), VentaInvalida);
});

// --- Los totales ------------------------------------------------------------

test('una línea de $1,000 sale a $1,070 con impuesto', () => {
  const t = totalesDe(venta(), PANAMA);
  assert.equal(t.brutoCentavos, 100_000);
  assert.equal(t.subtotalCentavos, 100_000);
  assert.equal(t.itbmsCentavos, 7_000);
  assert.equal(t.totalCentavos, 107_000);
  assert.equal(t.unidades, 1);
});

test('varias líneas suman, y las unidades también', () => {
  const t = totalesDe(
    venta({
      lineas: [
        linea({ descripcion: 'Silla', cantidad: 4, precioCentavos: 5_000 }),
        linea({ descripcion: 'Mesa', cantidad: 1, precioCentavos: 30_000 }),
      ],
    }),
    PANAMA,
  );
  assert.equal(t.brutoCentavos, 50_000);
  assert.equal(t.unidades, 5);
  assert.equal(t.totalCentavos, 53_500);
});

test('el descuento baja el subtotal, y por tanto también el impuesto', () => {
  const t = totalesDe(venta({ descuentoCentavos: 10_000 }), PANAMA);
  assert.equal(t.subtotalCentavos, 90_000);
  assert.equal(t.itbmsCentavos, 6_300, 'el ITBMS se cobra sobre lo que de verdad se cobró');
  assert.equal(t.totalCentavos, 96_300);
});

test('una línea regalada vale cero y sale escrita igual', () => {
  const t = totalesDe(
    venta({
      lineas: [linea(), linea({ descripcion: 'Cojines de cortesía', cantidad: 2, precioCentavos: 0 })],
    }),
    PANAMA,
  );
  assert.equal(t.totalCentavos, 107_000);
  assert.equal(t.unidades, 3, 'las unidades regaladas también salieron de la tienda');
});

// --- Lo que no se acepta ----------------------------------------------------

test('una venta sin líneas no es una venta', () => {
  assert.throws(() => totalesDe(venta({ lineas: [] }), PANAMA), VentaInvalida);
});

test('una línea sin descripción dice qué línea es', () => {
  const fallo = (() => {
    try {
      totalesDe(venta({ lineas: [linea(), linea({ descripcion: '   ' })] }), PANAMA);
    } catch (e) {
      return e as VentaInvalida;
    }
    return null;
  })();
  assert.ok(fallo instanceof VentaInvalida);
  assert.equal(fallo.campo, 'lineas.1.descripcion');
  assert.match(fallo.message, /línea 2/, 'la vendedora tiene que saber cuál corregir');
});

test('una cantidad que no es un entero positivo se rechaza', () => {
  for (const cantidad of [0, -1, 1.5, NaN]) {
    assert.throws(() => totalesDe(venta({ lineas: [linea({ cantidad })] }), PANAMA), VentaInvalida);
  }
});

test('un precio negativo se rechaza: un descuento tiene su propio campo', () => {
  assert.throws(
    () => totalesDe(venta({ lineas: [linea({ precioCentavos: -100 })] }), PANAMA),
    VentaInvalida,
  );
});

test('un descuento mayor que la venta se rechaza', () => {
  assert.throws(() => totalesDe(venta({ descuentoCentavos: 100_001 }), PANAMA), VentaInvalida);
});

test('una venta que suma cero se rechaza: eso es un regalo, no una venta', () => {
  assert.throws(
    () => totalesDe(venta({ lineas: [linea({ precioCentavos: 0 })] }), PANAMA),
    VentaInvalida,
  );
  assert.throws(() => totalesDe(venta({ descuentoCentavos: 100_000 }), PANAMA), VentaInvalida);
});

test('el dinero nunca pasa por coma flotante', () => {
  // $19.99 por tres. Multiplicar 19.99 por 100 en coma flotante da
  // 1998.9999999999998, y de ahí salen los centavos perdidos.
  const t = totalesDe(
    venta({ lineas: [linea({ cantidad: 3, precioCentavos: 1_999 })] }),
    PANAMA,
  );
  assert.equal(t.brutoCentavos, 5_997);
  assert.equal(t.itbmsCentavos, 420);
  assert.equal(t.totalCentavos, 6_417);
  assert.ok(Number.isInteger(t.totalCentavos));
});

// --- El número --------------------------------------------------------------

test('el número del comprobante lleva el año y cuatro dígitos', () => {
  assert.equal(formatoNumeroVenta('2026', 7), 'VTA-2026-0007');
  assert.equal(formatoNumeroVenta('2026', 1_234), 'VTA-2026-1234');
});
