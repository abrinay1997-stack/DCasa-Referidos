/**
 * Las reglas de identidad del socio.
 *
 * Son puras a propósito: la pantalla y el servidor tienen que decidir lo mismo
 * sobre qué PIN vale y cómo se lee un código. Si la pantalla acepta un PIN que
 * el servidor rechaza, el socio ve «guardando…» y luego un error que no
 * entiende, de pie en el mostrador con la vendedora esperando.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALFABETO_CODIGO,
  codigoDesdeBytes,
  codigoNormal,
  comoBreve,
  cumpleValido,
  esCodigoValido,
  nombreVisible,
  pinValido,
  problemaDelPin,
  telefonoValido,
} from '../compartido/socios.ts';
import { facturaNormal as facturaNormalSync } from '../compartido/compras.ts';

// ---------------------------------------------------------------------------
// El código
// ---------------------------------------------------------------------------

test('el alfabeto no tiene ninguna pareja que se confunda', () => {
  // Este código se lee en voz alta en una tienda con ruido y se teclea desde
  // una pantalla rayada. Cada pareja ambigua es una vendedora preguntando
  // «¿es o de oso o cero?» varias veces al día.
  for (const ambiguo of ['O', '0', 'I', '1', 'L']) {
    assert.ok(!ALFABETO_CODIGO.includes(ambiguo), `${ambiguo} no debería estar en el alfabeto`);
  }
  assert.equal(new Set(ALFABETO_CODIGO).size, ALFABETO_CODIGO.length, 'sin repetidos');
});

test('un código sale con su prefijo y su largo', () => {
  const codigo = codigoDesdeBytes(new Uint8Array([0, 1, 2, 3, 4, 5]));
  assert.equal(codigo, 'DCA234567');
  assert.ok(esCodigoValido(codigo));
});

test('bytes distintos dan códigos distintos', () => {
  const a = codigoDesdeBytes(new Uint8Array([10, 20, 30, 40, 50, 60]));
  const b = codigoDesdeBytes(new Uint8Array([60, 50, 40, 30, 20, 10]));
  assert.notEqual(a, b);
});

test('el código se lee como lo escribe una persona', () => {
  // Quien lo copia de un papel pone guiones donde le parece, y quien lo teclea
  // en un móvil arrastra el autocorrector de minúsculas.
  assert.equal(codigoNormal('dca-234567'), 'DCA234567');
  assert.equal(codigoNormal('DCA 234 567'), 'DCA234567');
  assert.ok(esCodigoValido('dca-234567'));
});

test('se rechaza lo que no es un código', () => {
  assert.ok(!esCodigoValido(''));
  assert.ok(!esCodigoValido('DCA23456'), 'un carácter de menos');
  assert.ok(!esCodigoValido('DCA2345678'), 'uno de más');
  assert.ok(!esCodigoValido('XYZ234567'), 'otro prefijo');
  assert.ok(!esCodigoValido('DCA234O67'), 'lleva una letra que no está en el alfabeto');
});

// ---------------------------------------------------------------------------
// El PIN
// ---------------------------------------------------------------------------

test('un PIN corriente vale', () => {
  assert.ok(pinValido('418209'));
  assert.equal(problemaDelPin('418209'), null);
});

test('seis dígitos, ni cinco ni siete', () => {
  assert.equal(problemaDelPin('12345'), 'largo');
  assert.equal(problemaDelPin('4182094'), 'largo');
  assert.equal(problemaDelPin(''), 'largo');
});

test('solo números', () => {
  assert.equal(problemaDelPin('4182a9'), 'no-son-digitos');
  assert.equal(problemaDelPin('41 209'), 'no-son-digitos');
});

test('se rechazan los repetidos y las secuencias', () => {
  // Son lo que elige alguien a quien le acaban de pedir seis dígitos con la
  // vendedora esperando.
  assert.equal(problemaDelPin('000000'), 'repetidos');
  assert.equal(problemaDelPin('777777'), 'repetidos');
  assert.equal(problemaDelPin('123456'), 'secuencia');
  assert.equal(problemaDelPin('654321'), 'secuencia');
  assert.equal(problemaDelPin('456789'), 'secuencia');
});

test('no se puede usar un tramo del propio celular', () => {
  // Es lo primero que probaría cualquiera, porque el celular es justo con lo
  // que se entra.
  const telefono = '60261919';
  assert.equal(problemaDelPin('602619', telefono), 'es-el-telefono');
  assert.equal(problemaDelPin('026191', telefono), 'es-el-telefono');
  assert.equal(problemaDelPin('261919', telefono), 'es-el-telefono');
  assert.equal(problemaDelPin('418209', telefono), null, 'uno que no sale del número sí vale');
});

// ---------------------------------------------------------------------------
// El celular
// ---------------------------------------------------------------------------

test('un celular panameño son ocho dígitos con prefijo conocido', () => {
  assert.ok(telefonoValido('60261919'), 'móvil');
  assert.ok(telefonoValido('23456789'), 'fijo');
  assert.ok(!telefonoValido('6026191'), 'siete dígitos');
  assert.ok(!telefonoValido('602619199'), 'nueve');
  assert.ok(!telefonoValido('80261919'), 'no empieza por un prefijo de Panamá');
  assert.ok(!telefonoValido(''), 'vacío');
});

// ---------------------------------------------------------------------------
// Lo que se enseña de otra persona
// ---------------------------------------------------------------------------

test('de un tercero solo salen el nombre y la inicial', () => {
  // Estos códigos se reparten por WhatsApp a propósito. Si el código devolviera
  // la ficha, cualquiera con uno a mano tendría el teléfono de quien lo
  // repartió.
  const breve = comoBreve({ codigo: 'DCA234567', nombre: 'María', apellido: 'González' });
  assert.deepEqual(breve, { codigo: 'DCA234567', nombre: 'María', inicial: 'G.' });
  assert.equal(nombreVisible(breve), 'María G.');

  const sinApellido = comoBreve({ codigo: 'DCA234567', nombre: 'Marcial', apellido: '' });
  assert.equal(sinApellido.inicial, '');
  assert.equal(nombreVisible(sinApellido), 'Marcial');
});

// ---------------------------------------------------------------------------
// El cumpleaños
// ---------------------------------------------------------------------------

test('el cumpleaños es MM-DD, y es opcional', () => {
  assert.ok(cumpleValido(''), 'vacío vale: es opcional');
  assert.ok(cumpleValido('03-15'));
  assert.ok(cumpleValido('02-29'), 'quien nació en bisiesto tiene su regalo igual');
  assert.ok(!cumpleValido('13-01'), 'no hay mes 13');
  assert.ok(!cumpleValido('02-30'));
  assert.ok(!cumpleValido('1990-03-15'), 'el año no se guarda');
  assert.ok(!cumpleValido('3-15'), 'con dos dígitos siempre');
});

// ---------------------------------------------------------------------------
// La factura
// ---------------------------------------------------------------------------

test('la misma factura escrita de varias formas es una sola', async () => {
  const { facturaNormal } = await import('../compartido/compras.ts');

  // Sin esto, cargarla tres veces escrita de tres formas daría tres veces los
  // puntos: para SQLite serían tres cadenas distintas y el índice único no se
  // enteraría.
  const esperado = facturaNormal('F-001234');
  assert.equal(facturaNormal('f 001234'), esperado);
  assert.equal(facturaNormal('F001234'), esperado);
  assert.equal(facturaNormal('F/001234'), esperado);
  assert.equal(facturaNormal('  F-00-1234  '), esperado);
});

test('los ceros de relleno se caen, pero los de dentro no', () => {
  // El talonario imprime los ceros y la vendedora no siempre los teclea.
  assert.equal(facturaNormalSync('F000123'), 'F123');
  assert.equal(facturaNormalSync('000123'), '123');
  // Éste es el que rompería una normalización ingenua: el cero va DENTRO del
  // número, no delante.
  assert.equal(facturaNormalSync('F1000'), 'F1000');
  assert.equal(facturaNormalSync('1020'), '1020');
});

test('facturas distintas siguen siendo distintas', () => {
  assert.notEqual(facturaNormalSync('F-1234'), facturaNormalSync('F-1235'));
  assert.notEqual(facturaNormalSync('A-100'), facturaNormalSync('B-100'));
});

// ---------------------------------------------------------------------------
// El candado contra fuerza bruta
// ---------------------------------------------------------------------------

test('el candado cierra en dos escalones', async () => {
  const { bloqueoTras, sigueBloqueada } = await import('../compartido/candado.ts');
  const ahora = new Date('2026-09-22T12:00:00Z');

  // Quien se equivocó de verdad acierta en los primeros intentos.
  assert.equal(bloqueoTras(1, ahora), null);
  assert.equal(bloqueoTras(4, ahora), null);

  // A los cinco, un cuarto de hora.
  const corto = bloqueoTras(5, ahora)!;
  assert.equal(corto, '2026-09-22T12:15:00.000Z');
  assert.ok(sigueBloqueada(corto, ahora));
  assert.ok(!sigueBloqueada(corto, new Date('2026-09-22T12:16:00Z')));

  // A los diez, un día entero: a un millón de combinaciones, eso convierte el
  // ataque en cosa de siglos.
  assert.equal(bloqueoTras(10, ahora), '2026-09-23T12:00:00.000Z');
  assert.equal(bloqueoTras(50, ahora), '2026-09-23T12:00:00.000Z', 'no sigue creciendo');

  assert.equal(sigueBloqueada(null, ahora), false, 'sin bloqueo no hay bloqueo');
});

test('lo que queda se dice en palabras que se entienden', async () => {
  const { cuantoQueda } = await import('../compartido/candado.ts');
  const ahora = new Date('2026-09-22T12:00:00Z');
  assert.equal(cuantoQueda('2026-09-22T12:15:00Z', ahora), '15 minutos');
  assert.equal(cuantoQueda('2026-09-22T12:00:30Z', ahora), 'un minuto');
  assert.equal(cuantoQueda('2026-09-23T12:00:00Z', ahora), '24 horas');
});

// ---------------------------------------------------------------------------
// Los choques de unicidad
// ---------------------------------------------------------------------------

test('se reconoce qué columna se chocó', async () => {
  const { choco, columnaDelChoque } = await import('../compartido/choques.ts');

  // Éste es el mensaje LITERAL que devuelve D1, copiado de un registro real.
  // SQLite nombra la COLUMNA, no el índice — comparar contra `compras_factura`
  // no encuentra nada, y el rechazo sale como un 500 genérico que hace que la
  // vendedora vuelva a intentarlo en vez de mirar el número de factura.
  const real = new Error(
    'D1_ERROR: UNIQUE constraint failed: compras.factura_normal: SQLITE_CONSTRAINT ' +
      '(extended: SQLITE_CONSTRAINT_UNIQUE)',
  );
  assert.equal(columnaDelChoque(real), 'compras.factura_normal');
  assert.ok(choco(real, 'compras.factura_normal'));
  assert.ok(!choco(real, 'socios.telefono_normal'), 'no confunde una columna con otra');

  assert.equal(
    columnaDelChoque(new Error('UNIQUE constraint failed: socios.telefono_normal')),
    'socios.telefono_normal',
  );

  // Lo que no es un choque de unicidad no se disfraza de uno.
  assert.equal(columnaDelChoque(new Error('no such table: premios')), null);
  assert.equal(columnaDelChoque(null), null);
  assert.equal(columnaDelChoque('vaya'), null);
});

test('el choque se lee aunque venga envuelto en una causa', async () => {
  const { columnaDelChoque } = await import('../compartido/choques.ts');
  // D1 envuelve el error de SQLite, y a veces el detalle solo está en `cause`.
  const envuelto = new Error('D1_ERROR', {
    cause: new Error('UNIQUE constraint failed: compras.factura_normal'),
  });
  assert.equal(columnaDelChoque(envuelto), 'compras.factura_normal');
});
