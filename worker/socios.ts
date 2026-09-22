/**
 * El alta, la entrada y la ficha del socio.
 *
 * Las dos operaciones delicadas del programa están aquí, y las dos lo son por
 * la misma razón: ocurren con una persona de pie en el mostrador y una
 * vendedora esperando.
 *
 *   · `registrar()` tiene que ser rápida y no puede fallar por un detalle.
 *   · `entrar()` tiene que ser lenta a propósito y no puede filtrar nada.
 */

import { ErrorPeticion, cuerpoJson } from './http';
import type { Env } from './entorno';
import {
  bloqueoTras,
  cookieSesion,
  cuantoQueda,
  emitirSesion,
  guardarPin,
  pinCoincide,
  pinTemporal,
  sigueBloqueada,
  type PinGuardado,
} from './sesion';
import { sentenciaAsiento } from './movimientos';
import { leerReglas } from './reglas';
import {
  codigoDesdeBytes,
  codigoNormal,
  comoBreve,
  cumpleValido,
  esCodigoValido,
  EXPLICACION_PIN,
  problemaDelPin,
  telefonoValido,
  VERSION_TERMINOS,
  type DatosAlta,
  type Socio,
  type SocioBreve,
} from '../compartido/socios';
import { correoNormal, pareceCorreo, sinTildes, soloDigitos, whatsappNormal } from '../compartido/texto';
import { choco, columnaDelChoque } from '../compartido/choques';

/** La fila, tal como sale de la base. */
interface Fila {
  codigo: string;
  nombre: string;
  apellido: string;
  telefono: string;
  telefono_normal: string;
  cedula: string;
  correo: string;
  cumple: string;
  estado: string;
  pin_hash: string;
  pin_salt: string;
  pin_iteraciones: number;
  pin_cambiado_en: string;
  pin_temporal: number;
  intentos_fallidos: number;
  bloqueado_hasta: string | null;
  referido_por: string | null;
  /** Cuándo se le pagó a quien lo trajo. El sello que impide pagar dos veces. */
  referido_pagado_en: string | null;
  creado_en: string;
  eliminado_en: string | null;
}

function comoSocio(fila: Fila): Socio {
  return {
    codigo: fila.codigo,
    nombre: fila.nombre,
    apellido: fila.apellido,
    telefono: fila.telefono,
    cedula: fila.cedula,
    correo: fila.correo,
    cumple: fila.cumple,
    estado: fila.estado === 'suspendido' ? 'suspendido' : 'activo',
    pinTemporal: fila.pin_temporal === 1,
    referidoPor: fila.referido_por,
    creadoEn: fila.creado_en,
  };
}

const COLUMNAS = `codigo, nombre, apellido, telefono, telefono_normal, cedula, correo, cumple,
  estado, pin_hash, pin_salt, pin_iteraciones, pin_cambiado_en, pin_temporal,
  intentos_fallidos, bloqueado_hasta, referido_por, referido_pagado_en,
  creado_en, eliminado_en`;

export async function porCodigo(base: D1Database, codigo: string): Promise<Fila | null> {
  return base
    .prepare(`SELECT ${COLUMNAS} FROM socios WHERE codigo = ? AND eliminado_en IS NULL`)
    .bind(codigo)
    .first<Fila>();
}

async function porTelefono(base: D1Database, telefonoNormal: string): Promise<Fila | null> {
  return base
    .prepare(`SELECT ${COLUMNAS} FROM socios WHERE telefono_normal = ?`)
    .bind(telefonoNormal)
    .first<Fila>();
}

// ---------------------------------------------------------------------------
// El alta
// ---------------------------------------------------------------------------

/**
 * Da de alta a un socio y abre su sesión.
 *
 * `creadoPor` es `'qr'` cuando se registró él solo desde el teléfono, o el
 * correo de la vendedora cuando lo dio de alta en el mostrador. Se guarda
 * porque saber cuántas altas entran solas y cuántas las empuja el equipo es lo
 * que dice si el QR está funcionando.
 */
export async function registrar(
  base: D1Database,
  peticion: Request,
  env: Env,
  creadoPor = 'qr',
): Promise<{ socio: Socio; cookie: string }> {
  const datos = await cuerpoJson<DatosAlta>(peticion);

  if (!datos.acepta) {
    throw new ErrorPeticion(
      400,
      'invalida',
      'Para entrar al programa hay que aceptar los términos.',
    );
  }

  const nombre = (datos.nombre ?? '').trim();
  if (!nombre) throw new ErrorPeticion(400, 'invalida', 'Nos falta tu nombre.');

  const telefono = (datos.telefono ?? '').trim();
  const telNormal = whatsappNormal(telefono);
  if (!telefonoValido(telNormal)) {
    throw new ErrorPeticion(
      400,
      'invalida',
      'Ese número de celular no parece de Panamá. Son 8 números, como 6026-1919.',
    );
  }

  const problema = problemaDelPin(datos.pin, telNormal);
  if (problema) throw new ErrorPeticion(400, 'invalida', EXPLICACION_PIN[problema]);

  if (!cumpleValido(datos.cumple)) {
    throw new ErrorPeticion(400, 'invalida', 'Esa fecha de cumpleaños no existe.');
  }

  // El correo es opcional, pero uno mal escrito es peor que ninguno: se guarda,
  // nadie lo vuelve a mirar, y el día que haga falta escribirle rebota.
  const correo = (datos.correo ?? '').trim();
  if (correo && !pareceCorreo(correo)) {
    throw new ErrorPeticion(400, 'invalida', 'Ese correo no parece un correo. Revísalo o déjalo vacío.');
  }

  // ¿Ya está? Se mira ANTES de derivar el PIN, que tarda.
  const existente = await porTelefono(base, telNormal);
  if (existente) {
    // ---------------------------------------------------------------------
    // LA FICHA SIN RECLAMAR: ESTO NO ES UN ALTA, ES RECLAMARLA
    //
    // Esta persona ya compró en la tienda, así que tiene ficha y tiene puntos,
    // y lo que está haciendo ahora es entrar al programa. Decirle «ese número
    // ya tiene cuenta, entra con tu PIN» sería mandarla a usar un PIN que no
    // existe, y dejar sus puntos donde nadie los alcanza — que es tanto como
    // no tener programa.
    //
    // Reclamar CONSERVA su código, sus compras y sus puntos. Solo escribe lo
    // que faltaba: el PIN y el consentimiento.
    // ---------------------------------------------------------------------
    if (!existente.eliminado_en && !existente.pin_hash) {
      return reclamar(base, existente, datos, creadoPor, env);
    }

    if (existente.eliminado_en) {
      // Restaurarlo aquí sería dejar que cualquiera con su número reviva una
      // cuenta retirada y se quede con sus puntos. Lo hace una vendedora, con
      // la persona delante.
      throw new ErrorPeticion(
        409,
        'repetida',
        'Ese número tuvo una cuenta que está retirada. Pasa por la tienda y te la ' +
          'volvemos a activar.',
      );
    }
    throw new ErrorPeticion(
      409,
      'repetida',
      'Ese número ya tiene cuenta. Entra con tu PIN, o pídenos que te lo reiniciemos.',
    );
  }

  // El padrino. Un código que no existe NO impide el alta: quien está en el
  // mostrador con la vendedora esperando no puede quedarse fuera porque su
  // cuñado le pasó mal el código.
  let padrino: string | null = null;
  if (datos.referido) {
    const codigo = codigoNormal(datos.referido);
    if (esCodigoValido(codigo)) {
      const fila = await porCodigo(base, codigo);
      if (fila && fila.estado === 'activo') padrino = fila.codigo;
    }
  }

  const pin = await guardarPin(datos.pin, env);
  const ahora = new Date().toISOString();
  const reglas = leerReglas();
  const bienvenida = reglas.bienvenida.puntos;

  // Hasta cinco intentos por si un código sale repetido. Con 887 millones de
  // combinaciones no va a pasar, pero «no va a pasar» le toca a alguien alguna
  // vez, y a ése le tocaría el error.
  for (let intento = 0; intento < 5; intento += 1) {
    const codigo = codigoDesdeBytes(crypto.getRandomValues(new Uint8Array(6)));

    const sentencias: D1PreparedStatement[] = [
      base
        .prepare(
          `INSERT INTO socios
             (codigo, nombre, apellido, telefono, telefono_normal, cedula, cedula_digitos,
              correo, correo_normal, cumple, nombre_normal, pin_hash, pin_salt, pin_iteraciones,
              pin_cambiado_en, referido_por, referido_en, terminos_version,
              terminos_aceptados_en, creado_en, creado_por, actualizado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          codigo,
          nombre,
          (datos.apellido ?? '').trim(),
          telefono,
          telNormal,
          (datos.cedula ?? '').trim(),
          soloDigitos(datos.cedula),
          correo,
          correoNormal(correo),
          (datos.cumple ?? '').trim(),
          sinTildes(`${nombre} ${(datos.apellido ?? '').trim()}`),
          pin.hash,
          pin.sal,
          pin.iteraciones,
          ahora,
          padrino,
          padrino ? ahora : null,
          VERSION_TERMINOS,
          ahora,
          ahora,
          creadoPor,
          ahora,
        ),
    ];

    // El regalo de bienvenida va en el MISMO batch que el alta. Un socio sin su
    // asiento de bienvenida es un estado que no puede existir, y la única forma
    // de que no exista es que las dos escrituras viajen juntas.
    //
    // Si `bienvenida.puntos` sigue sin definirse en datos/puntos.json, no hay
    // asiento y no es un error: es que todavía no se ha decidido regalar nada.
    if (bienvenida !== null && bienvenida > 0) {
      sentencias.push(
        sentenciaAsiento(base, {
          socioCodigo: codigo,
          tipo: 'bienvenida',
          puntos: bienvenida,
          autor: 'sistema',
          ocurridoEn: ahora,
        }),
      );
    }

    try {
      await base.batch(sentencias);
    } catch (error) {
      // El código repetido se reintenta con otro. Los otros dos choques son
      // una carrera con un alta simultánea —el SELECT de arriba dijo que no
      // estaba, y entre ese momento y éste llegó— y sí se le cuentan a quien
      // llama, con el mensaje que le sirve.
      //
      // Se compara contra la COLUMNA y no contra el nombre del índice, porque
      // es lo que SQLite dice: «UNIQUE constraint failed: socios.telefono_normal».
      // Ver compartido/choques.ts.
      const columna = columnaDelChoque(error);
      if (columna === 'socios.codigo' || String(error).includes('PRIMARY KEY')) continue;

      if (choco(error, 'socios.telefono_normal')) {
        throw new ErrorPeticion(409, 'repetida', 'Ese número ya tiene cuenta. Entra con tu PIN.');
      }
      if (choco(error, 'socios.cedula_digitos')) {
        throw new ErrorPeticion(409, 'repetida', 'Esa cédula ya está en otra cuenta.');
      }
      throw error;
    }

    const fila = await porCodigo(base, codigo);
    if (!fila) throw new ErrorPeticion(500, 'fallo', 'El alta no se guardó. Vuelve a intentarlo.');

    return {
      socio: comoSocio(fila),
      // La cookie entera, con HttpOnly, Secure y SameSite. Devolver aquí el token
      // pelado dejaría que el enrutador lo pusiera en `Set-Cookie` tal cual, sin
      // ninguna de las tres marcas — y una sesión legible por JavaScript se va
      // con la primera inyección que se cuele en la app del socio.
      cookie: cookieSesion(await emitirSesion(codigo, ahora, env)),
    };
  }

  throw new ErrorPeticion(500, 'fallo', 'No se pudo asignar un código. Vuelve a intentarlo.');
}

/**
 * Reclamar una ficha que ya existía: quien compró entra al programa.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ PIDE EL CÓDIGO DEL COMPROBANTE CUANDO HAY PUNTOS
 *
 * Sin esa comprobación, cualquiera que supiera el celular de otra persona
 * podría reclamar su ficha y quedarse con sus puntos. No hace falta adivinar
 * nada: basta con conocer el número de un vecino que compra en D'CASA.
 *
 * El código de la ficha —`DCA…`— va impreso en cada comprobante de venta, así
 * que quien de verdad hizo la compra lo tiene en la mano. Es el segundo dato, y
 * es el que convierte «sé tu número» en «estuve en esa compra».
 *
 * Solo se pide cuando hay algo que proteger. Una ficha sin puntos no tiene nada
 * que robar, y exigirle el papel a alguien que no gana nada con reclamarla solo
 * serviría para que no lo hiciera.
 *
 * EL PRECIO DE ESTO, dicho en voz alta: la respuesta deja ver que ese celular
 * tiene ficha con puntos en D'CASA. Es un dato menor —quien ve a alguien salir
 * de la tienda ya lo sabe— y se cambia por impedir que le quiten el dinero. Si
 * algún día se quiere cerrar también esa rendija, el camino es un código por
 * SMS, no callar aquí.
 *
 * Y si perdió el comprobante no se queda fuera: pasa por la tienda y una
 * vendedora se lo dice con él delante, que es la misma comprobación por otra
 * vía.
 */
async function reclamar(
  base: D1Database,
  ficha: Fila,
  datos: DatosAlta,
  desde: string,
  env: Env,
): Promise<{ socio: Socio; cookie: string }> {
  const saldo = await base
    .prepare(`SELECT COALESCE(SUM(puntos), 0) AS saldo FROM movimientos WHERE socio_codigo = ?`)
    .bind(ficha.codigo)
    .first<{ saldo: number }>();

  if ((saldo?.saldo ?? 0) > 0) {
    const dado = codigoNormal(datos.codigo ?? '');
    if (dado !== ficha.codigo) {
      throw new ErrorPeticion(
        409,
        'invalida',
        'Ya tienes compras registradas con ese número, así que tus puntos te esperan. ' +
          'Para reclamarlos escribe el código que aparece en tu comprobante, o pasa por ' +
          'la tienda y te ayudamos.',
        'codigo',
      );
    }
  }

  if (ficha.estado === 'suspendido') {
    throw new ErrorPeticion(
      403,
      'suspendida',
      'Esa ficha está suspendida. Escríbenos por WhatsApp y lo revisamos.',
    );
  }

  const pin = await guardarPin(datos.pin, env);
  const ahora = new Date().toISOString();

  // Rellena huecos y NO pisa nada. El apellido que la vendedora escribió
  // mirando la cédula vale más que el que se teclea de prisa en un teléfono, y
  // quien reclama no tiene por qué volver a dar lo que ya dio.
  const soloSiFalta = (nuevo: string | undefined, viejo: string) =>
    viejo.trim() ? viejo : (nuevo ?? '').trim();

  const correo = soloSiFalta(datos.correo, ficha.correo);
  if (correo && !pareceCorreo(correo)) {
    throw new ErrorPeticion(400, 'invalida', 'Ese correo no parece un correo. Revísalo o déjalo vacío.');
  }

  const apellido = soloSiFalta(datos.apellido, ficha.apellido);
  const cumple = soloSiFalta(datos.cumple, ficha.cumple);

  await base
    .prepare(
      `UPDATE socios
          SET pin_hash = ?, pin_salt = ?, pin_iteraciones = ?, pin_cambiado_en = ?,
              pin_temporal = 0, intentos_fallidos = 0, bloqueado_hasta = NULL,
              apellido = ?, nombre_normal = ?, correo = ?, correo_normal = ?, cumple = ?,
              terminos_version = ?, terminos_aceptados_en = ?, actualizado_en = ?
        WHERE codigo = ? AND pin_hash = ''`,
    )
    .bind(
      pin.hash,
      pin.sal,
      pin.iteraciones,
      ahora,
      apellido,
      sinTildes(`${ficha.nombre} ${apellido}`),
      correo,
      correoNormal(correo),
      cumple,
      VERSION_TERMINOS,
      ahora,
      ahora,
      ficha.codigo,
    )
    .run();

  console.log(`Ficha ${ficha.codigo} reclamada desde ${desde}.`);

  const fresca = await porCodigo(base, ficha.codigo);
  if (!fresca || !fresca.pin_hash) {
    // El `WHERE pin_hash = ''` no escribió: otra petición reclamó la ficha en
    // el mismo instante. Quien pierda la carrera no se lleva una sesión de una
    // cuenta cuyo PIN no puso.
    throw new ErrorPeticion(409, 'repetida', 'Esa cuenta se acaba de activar. Entra con tu PIN.');
  }

  return {
    socio: comoSocio(fresca),
    cookie: cookieSesion(await emitirSesion(fresca.codigo, fresca.pin_cambiado_en, env)),
  };
}

// ---------------------------------------------------------------------------
// La entrada
// ---------------------------------------------------------------------------

/**
 * Entrar con celular y PIN.
 *
 * ---------------------------------------------------------------------------
 * LA RESPUESTA ES LA MISMA TANTO SI EL NÚMERO NO EXISTE COMO SI EL PIN ESTÁ MAL
 *
 * Distinguirlas convierte este formulario en un buscador de quién es cliente de
 * D'CASA: se teclean números hasta que uno deja de decir «no existe», y ya se
 * sabe quién compra aquí. Con una lista de números de La Chorrera eso es una
 * tarde de trabajo.
 *
 * Por eso hay UN solo mensaje, y por eso cuando el número no existe igualmente
 * se deriva un PIN contra datos de mentira: sin eso, la respuesta llega en 2 ms
 * cuando el número no existe y en 300 ms cuando existe, y el reloj cuenta lo
 * que el mensaje calla.
 * ---------------------------------------------------------------------------
 */
export async function entrar(
  base: D1Database,
  peticion: Request,
  env: Env,
): Promise<{ socio: Socio; cookie: string }> {
  const datos = await cuerpoJson<{ telefono?: string; pin?: string }>(peticion);
  const telNormal = whatsappNormal(datos.telefono);
  const pin = (datos.pin ?? '').trim();

  const noCuadra = () =>
    new ErrorPeticion(401, 'sin-sesion', 'Ese número y ese PIN no coinciden. Prueba otra vez.');

  const fila = telNormal ? await porTelefono(base, telNormal) : null;

  if (!fila || fila.eliminado_en) {
    await derivarEnVano(pin, env);
    throw noCuadra();
  }

  // UNA FICHA SIN RECLAMAR NO PUEDE ENTRAR, y se le responde exactamente lo
  // mismo que a un número que no existe. Decirle «esa ficha todavía no tiene
  // PIN» convertiría esta pantalla en un detector de clientes de D'CASA: se
  // teclean números y se ve cuáles contestan distinto.
  //
  // Se deriva en vano antes de rechazar, por lo mismo que arriba: sin eso, la
  // respuesta llega en 2 ms para la ficha sin PIN y en 300 ms para la que sí lo
  // tiene, y el reloj cuenta lo que el mensaje calla.
  if (!fila.pin_hash) {
    await derivarEnVano(pin, env);
    throw noCuadra();
  }

  const ahora = new Date();

  if (sigueBloqueada(fila.bloqueado_hasta, ahora)) {
    throw new ErrorPeticion(
      429,
      'bloqueada',
      `Por seguridad bloqueamos tu cuenta un rato. Prueba en ${cuantoQueda(fila.bloqueado_hasta!, ahora)}, ` +
        `o escríbenos por WhatsApp y te ayudamos.`,
    );
  }

  const guardado: PinGuardado = {
    hash: fila.pin_hash,
    sal: fila.pin_salt,
    iteraciones: fila.pin_iteraciones,
  };

  if (!(await pinCoincide(pin, guardado, env))) {
    const fallos = fila.intentos_fallidos + 1;
    await base
      .prepare(`UPDATE socios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE codigo = ?`)
      .bind(fallos, bloqueoTras(fallos, ahora), fila.codigo)
      .run();
    throw noCuadra();
  }

  // Suspender a alguien tiene que echarlo, pero se comprueba DESPUÉS del PIN:
  // antes, el mensaje «tu cuenta está suspendida» le diría a cualquiera que
  // teclee ese número que la cuenta existe.
  if (fila.estado === 'suspendido') {
    throw new ErrorPeticion(
      403,
      'suspendida',
      'Tu cuenta está suspendida. Escríbenos por WhatsApp y lo revisamos.',
    );
  }

  if (fila.intentos_fallidos !== 0 || fila.bloqueado_hasta) {
    await base
      .prepare(`UPDATE socios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE codigo = ?`)
      .bind(fila.codigo)
      .run();
  }

  return {
    socio: comoSocio(fila),
    cookie: cookieSesion(await emitirSesion(fila.codigo, fila.pin_cambiado_en, env)),
  };
}

/**
 * Derivar contra nada, para que el reloj no delate.
 *
 * Se usan una sal fija y el mismo número de vueltas que una cuenta real: lo que
 * importa no es el resultado —se tira— sino que tardar lo mismo.
 */
async function derivarEnVano(pin: string, env: Env): Promise<void> {
  await pinCoincide(pin || '000000', SEÑUELO, env);
}

const SEÑUELO: PinGuardado = {
  hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  sal: 'AAAAAAAAAAAAAAAAAAAAAA==',
  iteraciones: 210_000,
};

// ---------------------------------------------------------------------------
// Quién está pidiendo
// ---------------------------------------------------------------------------

/**
 * El socio de una sesión, comprobado contra la base en CADA petición.
 *
 * No basta con que el token esté bien firmado. Se relee la fila porque entre
 * que se emitió la cookie y ahora pueden haber pasado noventa días, y en
 * noventa días a alguien lo suspenden, lo retiran, o le reinician el PIN
 * porque perdió el teléfono.
 */
export async function socioDeLaSesion(
  base: D1Database,
  codigo: string,
  pinCambiadoEn: string,
): Promise<Fila> {
  const fila = await porCodigo(base, codigo);

  if (!fila) {
    throw new ErrorPeticion(401, 'sin-sesion', 'Tu sesión se cerró. Vuelve a entrar con tu PIN.');
  }

  // La revocación. Cambiar o reiniciar el PIN invalida todas las sesiones
  // abiertas al instante, sin tabla de sesiones que mantener: el teléfono
  // perdido queda fuera en cuanto una vendedora reinicia el PIN.
  if (fila.pin_cambiado_en !== pinCambiadoEn) {
    throw new ErrorPeticion(
      401,
      'sin-sesion',
      'Tu PIN cambió, así que cerramos las sesiones abiertas. Entra con el nuevo.',
    );
  }

  if (fila.estado === 'suspendido') {
    throw new ErrorPeticion(
      403,
      'suspendida',
      'Tu cuenta está suspendida. Escríbenos por WhatsApp y lo revisamos.',
    );
  }

  return fila;
}

export function comoSocioPublico(fila: Fila): Socio {
  return comoSocio(fila);
}

// ---------------------------------------------------------------------------
// El padrino, para la pantalla de alta
// ---------------------------------------------------------------------------

/**
 * Resuelve un código de referido a un nombre, y a nada más.
 *
 * Devuelve nombre e inicial. Si devolviera la ficha, cualquiera con un código a
 * mano tendría el teléfono y la cédula de quien lo repartió — y estos códigos
 * se reparten por WhatsApp a propósito.
 *
 * Es la única ruta pública sin sesión que toca la base, así que responde igual
 * ante un código que no existe y uno mal escrito: `null`, sin explicar cuál de
 * las dos cosas pasó.
 */
export async function padrinoDe(base: D1Database, codigo: string): Promise<SocioBreve | null> {
  const limpio = codigoNormal(codigo);
  if (!esCodigoValido(limpio)) return null;

  const fila = await base
    .prepare(
      `SELECT codigo, nombre, apellido FROM socios
        WHERE codigo = ? AND eliminado_en IS NULL AND estado = 'activo'`,
    )
    .bind(limpio)
    .first<{ codigo: string; nombre: string; apellido: string }>();

  return fila ? comoBreve(fila) : null;
}

// ---------------------------------------------------------------------------
// Lo que hace una vendedora desde el panel
// ---------------------------------------------------------------------------

/**
 * Reinicia el PIN de alguien que lo olvidó.
 *
 * Devuelve un PIN temporal UNA SOLA VEZ, para que la vendedora se lo dicte con
 * el socio delante. No se guarda en claro en ningún sitio y no se puede volver
 * a consultar: si se pierde, se genera otro.
 *
 * Marca `pin_temporal`, así que el socio tendrá que elegir uno suyo antes de
 * poder hacer nada. Sin eso, el PIN que la vendedora dijo en voz alta en el
 * mostrador se queda puesto para siempre.
 *
 * Y mueve `pin_cambiado_en`, lo que invalida TODAS las sesiones abiertas al
 * instante. Eso es lo que hace útil este botón cuando alguien pierde el
 * teléfono: el teléfono perdido queda fuera en el acto.
 */
export async function reiniciarPin(
  base: D1Database,
  codigo: string,
  env: Env,
  quien: string,
): Promise<{ pin: string }> {
  const fila = await porCodigo(base, codigo);
  if (!fila) throw new ErrorPeticion(404, 'no-encontrada', 'Ese socio no existe.');

  // UNA FICHA SIN RECLAMAR NO TIENE PIN QUE REINICIAR, y ponerle uno desde aquí
  // la metería en el programa sin que nadie haya aceptado los términos. El
  // consentimiento lo da la persona, no la vendedora en su nombre.
  //
  // El mensaje trae el código de la ficha a propósito: es el dato que a esa
  // persona le falta para reclamarla desde el QR si perdió su comprobante, y
  // dárselo con ella delante es la misma comprobación que hace el papel.
  if (!fila.pin_hash) {
    throw new ErrorPeticion(
      409,
      'invalida',
      'Esa ficha todavía no está en el programa: no tiene PIN que reiniciar. ' +
        'Que escanee el QR y la reclame; el código que le van a pedir es este.',
      fila.codigo,
    );
  }

  const pin = pinTemporal();
  const guardado = await guardarPin(pin, env);
  const ahora = new Date().toISOString();

  await base
    .prepare(
      `UPDATE socios
          SET pin_hash = ?, pin_salt = ?, pin_iteraciones = ?, pin_cambiado_en = ?,
              pin_temporal = 1, intentos_fallidos = 0, bloqueado_hasta = NULL,
              actualizado_en = ?
        WHERE codigo = ?`,
    )
    .bind(guardado.hash, guardado.sal, guardado.iteraciones, ahora, ahora, codigo)
    .run();

  console.log(`PIN reiniciado para ${codigo} por ${quien}`);
  return { pin };
}

/**
 * El socio elige un PIN suyo.
 *
 * Pide el actual, salvo cuando el que tiene es temporal: ahí el socio no lo
 * eligió —se lo dictaron— y exigírselo sería pedirle que recuerde algo que
 * acaba de oír una vez.
 */
export async function cambiarPin(
  base: D1Database,
  fila: Fila,
  peticion: Request,
  env: Env,
): Promise<{ cookie: string }> {
  const datos = await cuerpoJson<{ actual?: string; nuevo?: string }>(peticion);

  if (fila.pin_temporal !== 1) {
    const actual = (datos.actual ?? '').trim();
    const guardado: PinGuardado = {
      hash: fila.pin_hash,
      sal: fila.pin_salt,
      iteraciones: fila.pin_iteraciones,
    };
    if (!(await pinCoincide(actual, guardado, env))) {
      throw new ErrorPeticion(401, 'sin-sesion', 'Ese no es tu PIN de ahora.');
    }
  }

  const problema = problemaDelPin(datos.nuevo, fila.telefono_normal);
  if (problema) throw new ErrorPeticion(400, 'invalida', EXPLICACION_PIN[problema]);

  const guardado = await guardarPin(datos.nuevo!, env);
  const ahora = new Date().toISOString();

  await base
    .prepare(
      `UPDATE socios
          SET pin_hash = ?, pin_salt = ?, pin_iteraciones = ?, pin_cambiado_en = ?,
              pin_temporal = 0, intentos_fallidos = 0, bloqueado_hasta = NULL,
              actualizado_en = ?
        WHERE codigo = ?`,
    )
    .bind(guardado.hash, guardado.sal, guardado.iteraciones, ahora, ahora, fila.codigo)
    .run();

  // Cambiar el PIN cierra las demás sesiones —es el mecanismo de revocación—,
  // así que hay que reemitir la de quien lo está cambiando. Si no, el socio
  // se echaría a sí mismo al guardar.
  return { cookie: cookieSesion(await emitirSesion(fila.codigo, ahora, env)) };
}

/** Quita el candado de intentos fallidos, cuando el socio llama. */
export async function desbloquear(base: D1Database, codigo: string): Promise<{ listo: true }> {
  const hecho = await base
    .prepare(
      `UPDATE socios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE codigo = ?`,
    )
    .bind(codigo)
    .run();
  if (!hecho.meta.changes) throw new ErrorPeticion(404, 'no-encontrada', 'Ese socio no existe.');
  return { listo: true };
}

/** Suspender o reactivar una cuenta. */
export async function cambiarEstado(
  base: D1Database,
  codigo: string,
  peticion: Request,
): Promise<{ estado: string }> {
  const datos = await cuerpoJson<{ estado?: string }>(peticion);
  const estado = datos.estado === 'suspendido' ? 'suspendido' : 'activo';

  const hecho = await base
    .prepare(`UPDATE socios SET estado = ?, actualizado_en = ? WHERE codigo = ?`)
    .bind(estado, new Date().toISOString(), codigo)
    .run();
  if (!hecho.meta.changes) throw new ErrorPeticion(404, 'no-encontrada', 'Ese socio no existe.');
  return { estado };
}

export type { Fila };
