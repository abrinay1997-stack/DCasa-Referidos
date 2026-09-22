/**
 * La libreta de clientes.
 *
 * ---------------------------------------------------------------------------
 * UN CLIENTE Y UN SOCIO SON LA MISMA FICHA
 *
 * El porqué entero está en la cabecera de `migraciones/0005_ficha.sql`. En una
 * frase: hay una tabla, `socios`, y estar EN EL PROGRAMA es un estado de la
 * ficha, no otro registro. Una ficha con PIN es un socio; una sin PIN es un
 * cliente que todavía no reclamó la suya.
 *
 * Este archivo es la cara «cliente» de esa tabla: buscar, listar, corregir,
 * retirar. La cara «socio» —el PIN, la sesión, el candado— vive en
 * `worker/socios.ts`, y las dos escriben sobre las mismas filas a propósito.
 *
 * ---------------------------------------------------------------------------
 * CÓMO SE RECONOCE A UN CLIENTE
 *
 * Por su celular, igual que a un socio, y por nada más. Es una escalera de un
 * solo peldaño, y eso es una ventaja y no una carencia: el hub de B&S necesita
 * cuatro peldaños y aun así pregunta antes de unir, porque una empresa puede
 * escribir su NIT de dos formas. Aquí la llave es un número de ocho dígitos que
 * la persona se sabe de memoria y que ya tiene índice único en la base.
 *
 * La cédula también es única cuando está, pero NO se usa para reconocer: la
 * mayoría de la gente no la da en el mostrador, y una llave que falta la mitad
 * de las veces no es una llave. Sirve para que la base impida dos fichas con la
 * misma, que es otra cosa.
 */

import { ErrorPeticion, cuerpoJson } from './http';
import { codigoDesdeBytes, esCodigoValido, codigoNormal, telefonoValido } from '../compartido/socios';
import { correoNormal, pareceCorreo, sinTildes, soloDigitos, whatsappNormal } from '../compartido/texto';
import { choco } from '../compartido/choques';
import { cumpleValido } from '../compartido/socios';

/** Lo que la pantalla de venta manda como cliente. */
export interface ClienteDeVenta {
  /** Si la vendedora lo eligió del buscador, esto es lo único que viaja. */
  codigo?: string;
  nombre?: string;
  apellido?: string;
  telefono?: string;
  cedula?: string;
  correo?: string;
  direccion?: string;
  cumple?: string;
  /** El código de quien lo trajo, si la venta lo captura. */
  referido?: string;
}

/** La ficha resuelta para una venta: la que había, o la que habrá. */
export interface FichaResuelta {
  codigo: string;
  nombre: string;
  apellido: string;
  telefono: string;
  telefonoNormal: string;
  cedula: string;
  correo: string;
  direccion: string;
  cumple: string;
  estado: string;
  referidoPor: string | null;
  referidoPagadoEn: string | null;
  /** `true` si no existía y hay que crearla con esta venta. */
  nueva: boolean;
}

const COLUMNAS_FICHA = `codigo, nombre, apellido, telefono, telefono_normal, cedula, cedula_digitos,
  correo, correo_normal, cumple, direccion, notas, atendido_por, estado, pin_hash,
  referido_por, referido_pagado_en, terminos_version, creado_en, creado_por,
  actualizado_en, eliminado_en, eliminado_por`;

interface FilaFicha {
  codigo: string;
  nombre: string;
  apellido: string;
  telefono: string;
  telefono_normal: string;
  cedula: string;
  cedula_digitos: string;
  correo: string;
  correo_normal: string;
  cumple: string;
  direccion: string;
  notas: string;
  atendido_por: string;
  estado: string;
  pin_hash: string;
  referido_por: string | null;
  referido_pagado_en: string | null;
  terminos_version: number;
  creado_en: string;
  creado_por: string;
  actualizado_en: string;
  eliminado_en: string | null;
  eliminado_por: string | null;
}

/** Lo que sale por el cable. `reclamada` es lo que distingue socio de cliente. */
export interface Ficha {
  codigo: string;
  nombre: string;
  apellido: string;
  telefono: string;
  cedula: string;
  correo: string;
  cumple: string;
  direccion: string;
  notas: string;
  atendidoPor: string;
  estado: string;
  /** Tiene PIN: entró al programa y puede ver sus puntos desde el teléfono. */
  reclamada: boolean;
  referidoPor: string | null;
  creadoEn: string;
  creadoPor: string;
  eliminadoEn: string | null;
  eliminadoPor: string | null;
}

export function comoFicha(f: FilaFicha): Ficha {
  return {
    codigo: f.codigo,
    nombre: f.nombre,
    apellido: f.apellido,
    telefono: f.telefono,
    cedula: f.cedula,
    correo: f.correo,
    cumple: f.cumple,
    direccion: f.direccion,
    notas: f.notas,
    atendidoPor: f.atendido_por,
    estado: f.estado,
    reclamada: f.pin_hash !== '',
    referidoPor: f.referido_por,
    creadoEn: f.creado_en,
    creadoPor: f.creado_por,
    eliminadoEn: f.eliminado_en,
    eliminadoPor: f.eliminado_por,
  };
}

async function porCodigoIncluyendoPapelera(
  base: D1Database,
  codigo: string,
): Promise<FilaFicha | null> {
  return base
    .prepare(`SELECT ${COLUMNAS_FICHA} FROM socios WHERE codigo = ?`)
    .bind(codigo)
    .first<FilaFicha>();
}

// ---------------------------------------------------------------------------
// La ficha de una venta
// ---------------------------------------------------------------------------

/**
 * La ficha sobre la que se va a emitir: la que ya existe, o una nueva sin PIN.
 *
 * NO PISA NADA DE UNA FICHA QUE YA ESTÁ. Es la regla que el hub de B&S escribe
 * como «la ficha manda y el documento toma prestado», y aquí importa igual: si
 * la vendedora teclea el correo con una letra de menos mientras factura con
 * prisa, eso no puede sobrescribir el correo bueno que el cliente dio el mes
 * pasado. Lo que la venta trae se guarda en su documento —que es la foto de ese
 * día— y la ficha se corrige desde la ficha, mirándola.
 *
 * La única excepción son los huecos: si la ficha NO TIENE dirección y la venta
 * trae una, se escribe. Rellenar un vacío no pisa nada, y es como una ficha
 * creada de prisa en una venta se va completando sola.
 */
export async function fichaDeVenta(
  base: D1Database,
  cliente: ClienteDeVenta | undefined,
): Promise<FichaResuelta> {
  const datos = cliente ?? {};

  // 1. La eligió del buscador.
  const codigoPedido = codigoNormal(datos.codigo ?? '');
  if (codigoPedido) {
    if (!esCodigoValido(codigoPedido)) {
      throw new ErrorPeticion(400, 'invalida', 'Ese código de cliente no tiene la forma que toca.');
    }
    const fila = await porCodigoIncluyendoPapelera(base, codigoPedido);
    if (!fila) throw new ErrorPeticion(404, 'no-encontrada', 'Ese cliente no existe.');
    if (fila.eliminado_en) {
      throw new ErrorPeticion(
        409,
        'repetida',
        'Esa ficha está en la papelera. Restáurala antes de emitirle una venta.',
      );
    }
    return existente(fila);
  }

  // 2. La teclea entera. El celular es lo único que no puede faltar.
  const telefono = (datos.telefono ?? '').trim();
  const telNormal = whatsappNormal(telefono);
  if (!telefonoValido(telNormal)) {
    throw new ErrorPeticion(
      400,
      'invalida',
      'Falta el celular del cliente, o no parece de Panamá. Son 8 números, como 6026-1919.',
    );
  }

  const yaEstaba = await base
    .prepare(`SELECT ${COLUMNAS_FICHA} FROM socios WHERE telefono_normal = ?`)
    .bind(telNormal)
    .first<FilaFicha>();

  if (yaEstaba) {
    if (yaEstaba.eliminado_en) {
      throw new ErrorPeticion(
        409,
        'repetida',
        'Ese celular tiene una ficha en la papelera. Restáurala y vuelve a emitir.',
        yaEstaba.codigo,
      );
    }
    // Existe: se usa, no se duplica y no se pisa. Ver la cabecera.
    return existente(yaEstaba);
  }

  const nombre = (datos.nombre ?? '').trim();
  if (!nombre) {
    throw new ErrorPeticion(400, 'invalida', 'Falta el nombre del cliente.');
  }

  const correo = (datos.correo ?? '').trim();
  if (correo && !pareceCorreo(correo)) {
    throw new ErrorPeticion(400, 'invalida', 'Ese correo no parece un correo.');
  }
  if (!cumpleValido(datos.cumple)) {
    throw new ErrorPeticion(400, 'invalida', 'Esa fecha de cumpleaños no existe.');
  }

  // Quien lo trajo. Se escribe UNA vez, al crear la ficha, y no se toca nunca
  // más: si se pudiera cambiar después, bastaría con esperar a que alguien
  // compre mucho para reclamarlo como referido.
  let padrino: string | null = null;
  const codigoPadrino = codigoNormal(datos.referido ?? '');
  if (codigoPadrino && esCodigoValido(codigoPadrino)) {
    const fila = await base
      .prepare(`SELECT codigo, estado FROM socios WHERE codigo = ? AND eliminado_en IS NULL`)
      .bind(codigoPadrino)
      .first<{ codigo: string; estado: string }>();
    if (fila && fila.estado === 'activo') padrino = fila.codigo;
  }

  // Un código libre. Con 887 millones de combinaciones el choque es
  // despreciable, y aun así se comprueba: «despreciable» no es «imposible», y
  // al que le toque se lleva el error en mitad de una venta.
  let codigo = '';
  for (let intento = 0; intento < 5; intento += 1) {
    const propuesto = codigoDesdeBytes(crypto.getRandomValues(new Uint8Array(6)));
    const tomado = await base
      .prepare(`SELECT 1 AS hay FROM socios WHERE codigo = ?`)
      .bind(propuesto)
      .first<{ hay: number }>();
    if (!tomado) {
      codigo = propuesto;
      break;
    }
  }
  if (!codigo) {
    throw new ErrorPeticion(500, 'fallo', 'No se pudo asignar un código. Vuelve a intentarlo.');
  }

  return {
    codigo,
    nombre,
    apellido: (datos.apellido ?? '').trim(),
    telefono,
    telefonoNormal: telNormal,
    cedula: (datos.cedula ?? '').trim(),
    correo,
    direccion: (datos.direccion ?? '').trim(),
    cumple: (datos.cumple ?? '').trim(),
    estado: 'activo',
    referidoPor: padrino,
    referidoPagadoEn: null,
    nueva: true,
  };
}

function existente(f: FilaFicha): FichaResuelta {
  return {
    codigo: f.codigo,
    nombre: f.nombre,
    apellido: f.apellido,
    telefono: f.telefono,
    telefonoNormal: f.telefono_normal,
    cedula: f.cedula,
    correo: f.correo,
    direccion: f.direccion,
    cumple: f.cumple,
    estado: f.estado,
    referidoPor: f.referido_por,
    referidoPagadoEn: f.referido_pagado_en,
    nueva: false,
  };
}

/**
 * Las sentencias que crean una ficha nueva desde una venta.
 *
 * SIN PIN, y esa es la decisión de fondo: el cliente no tiene que inventarse
 * uno en el mostrador con gente detrás. Sus puntos empiezan a correr igual y le
 * esperan; los reclama cuando escanee el QR, que es también cuando acepta los
 * términos — por eso `terminos_version` se queda en 0 aquí.
 *
 * Devuelve las sentencias en vez de ejecutarlas para que viajen en el MISMO
 * batch que la venta. Una ficha creada sin su venta, o una venta sin la ficha
 * que la explica, son estados que no pueden existir.
 */
export function sentenciasDeFichaNueva(
  base: D1Database,
  ficha: FichaResuelta,
  ahora: string,
  vendedora: string,
): D1PreparedStatement[] {
  return [
    base
      .prepare(
        `INSERT INTO socios
           (codigo, nombre, apellido, telefono, telefono_normal, cedula, cedula_digitos,
            correo, correo_normal, cumple, direccion, nombre_normal, atendido_por,
            pin_hash, pin_salt, pin_iteraciones, pin_cambiado_en,
            referido_por, referido_en, terminos_version,
            creado_en, creado_por, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', 0, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .bind(
        ficha.codigo,
        ficha.nombre,
        ficha.apellido,
        ficha.telefono,
        ficha.telefonoNormal,
        ficha.cedula,
        soloDigitos(ficha.cedula),
        ficha.correo,
        correoNormal(ficha.correo),
        ficha.cumple,
        ficha.direccion,
        sinTildes(`${ficha.nombre} ${ficha.apellido}`),
        vendedora,
        ahora,
        ficha.referidoPor,
        ficha.referidoPor ? ahora : null,
        ahora,
        vendedora,
        ahora,
      ),
  ];
}

// ---------------------------------------------------------------------------
// La libreta
// ---------------------------------------------------------------------------

export const CLIENTES_POR_PAGINA = 25;

export interface ClienteEnLista {
  codigo: string;
  nombre: string;
  telefono: string;
  correo: string;
  estado: string;
  reclamada: boolean;
  saldo: number;
  compras: number;
  compradoCentavos: number;
  ultimaCompra: string | null;
  creadoEn: string;
  eliminadoEn: string | null;
}

/**
 * El listado, con lo que hace falta para decidir sin abrir la ficha.
 *
 * Trae el saldo y lo comprado, que son las dos cifras por las que se pregunta.
 * Salen de subconsultas y no de columnas guardadas: el saldo es
 * `SUM(movimientos.puntos)` y no existe en ningún otro sitio — es la regla 2 de
 * este repositorio y no se rompe por acelerar un listado de veinticinco filas.
 *
 * EL CELULAR VUELVE ENTERO, a diferencia del buscador del mostrador. Es la
 * diferencia entre reconocer y atender: aquí se viene a llamar al cliente que
 * dejó pendiente una entrega, y para eso hace falta el número. La pantalla
 * queda detrás de Access igual que todo lo demás.
 */
export async function listar(
  base: D1Database,
  opciones: {
    texto?: string;
    estado?: string;
    atendidoPor?: string;
    reclamadas?: 'si' | 'no';
    papelera?: boolean;
    pagina?: number;
  } = {},
): Promise<{
  clientes: ClienteEnLista[];
  cuantos: number;
  pagina: number;
  porPagina: number;
}> {
  const condiciones: string[] = [opciones.papelera ? 's.eliminado_en IS NOT NULL' : 's.eliminado_en IS NULL'];
  const valores: unknown[] = [];

  const texto = (opciones.texto ?? '').trim();
  if (texto) {
    const like = `%${sinTildes(texto)}%`;
    const digitos = soloDigitos(texto);
    condiciones.push(
      `(s.nombre_normal LIKE ? OR lower(s.codigo) = ? OR lower(s.correo_normal) LIKE ?` +
        (digitos ? ` OR s.telefono_normal LIKE ? OR s.cedula_digitos LIKE ?` : '') +
        `)`,
    );
    valores.push(like, texto.toLowerCase(), like);
    if (digitos) valores.push(`%${digitos}%`, `%${digitos}%`);
  }

  if (opciones.estado === 'activo' || opciones.estado === 'suspendido') {
    condiciones.push('s.estado = ?');
    valores.push(opciones.estado);
  }

  if (opciones.atendidoPor) {
    condiciones.push('s.atendido_por = ?');
    valores.push(opciones.atendidoPor);
  }

  if (opciones.reclamadas === 'si') condiciones.push(`s.pin_hash <> ''`);
  if (opciones.reclamadas === 'no') condiciones.push(`s.pin_hash = ''`);

  const donde = `WHERE ${condiciones.join(' AND ')}`;
  const pagina = Math.max(1, Math.floor(opciones.pagina ?? 1));
  const desde = (pagina - 1) * CLIENTES_POR_PAGINA;

  const cuenta = await base
    .prepare(`SELECT COUNT(*) AS n FROM socios s ${donde}`)
    .bind(...valores)
    .first<{ n: number }>();

  const { results } = await base
    .prepare(
      `SELECT s.codigo, s.nombre, s.apellido, s.telefono, s.correo, s.estado, s.pin_hash,
              s.creado_en, s.eliminado_en,
              COALESCE((SELECT SUM(m.puntos) FROM movimientos m
                         WHERE m.socio_codigo = s.codigo), 0) AS saldo,
              COALESCE((SELECT COUNT(*) FROM compras c
                         WHERE c.socio_codigo = s.codigo AND c.anulada_en IS NULL), 0) AS compras,
              COALESCE((SELECT SUM(c.monto_centavos) FROM compras c
                         WHERE c.socio_codigo = s.codigo AND c.anulada_en IS NULL), 0) AS comprado,
              (SELECT MAX(c.registrada_en) FROM compras c
                WHERE c.socio_codigo = s.codigo AND c.anulada_en IS NULL) AS ultima
         FROM socios s
         ${donde}
        ORDER BY s.nombre_normal, s.codigo
        LIMIT ? OFFSET ?`,
    )
    .bind(...valores, CLIENTES_POR_PAGINA, desde)
    .all<Record<string, unknown>>();

  const clientes = (results ?? []).map((f) => ({
    codigo: f.codigo as string,
    nombre: `${f.nombre as string} ${(f.apellido as string) ?? ''}`.trim(),
    telefono: f.telefono as string,
    correo: (f.correo as string) ?? '',
    estado: f.estado as string,
    reclamada: (f.pin_hash as string) !== '',
    saldo: f.saldo as number,
    compras: f.compras as number,
    compradoCentavos: f.comprado as number,
    ultimaCompra: (f.ultima as string) ?? null,
    creadoEn: f.creado_en as string,
    eliminadoEn: (f.eliminado_en as string) ?? null,
  }));

  return { clientes, cuantos: cuenta?.n ?? 0, pagina, porPagina: CLIENTES_POR_PAGINA };
}

// ---------------------------------------------------------------------------
// Corregir
// ---------------------------------------------------------------------------

/**
 * Corrige una ficha.
 *
 * Lo que NO se toca desde aquí, y por qué:
 *
 *   · **El celular.** Es la llave con la que el socio entra y con la que el
 *     sistema lo reconoce. Cambiarlo desde el panel convertiría el panel en una
 *     forma de apoderarse de la cuenta de alguien. Un cambio de número se hace
 *     dando de alta la ficha nueva y trasladando lo que haya, con la persona
 *     delante.
 *   · **Quién lo trajo.** Se escribe una vez y no se toca. Ver `0001_socios.sql`.
 *   · **El PIN.** Tiene su propia operación, que lo reinicia sin llegar a verlo.
 *   · **Los puntos.** Tienen su ajuste, con motivo obligatorio que el socio lee.
 */
export async function corregir(
  base: D1Database,
  codigo: string,
  peticion: Request,
  quien: string,
): Promise<{ cliente: Ficha }> {
  const fila = await porCodigoIncluyendoPapelera(base, codigo);
  if (!fila) throw new ErrorPeticion(404, 'no-encontrada', 'Esa ficha no existe.');
  if (fila.eliminado_en) {
    throw new ErrorPeticion(409, 'repetida', 'Esa ficha está en la papelera. Restáurala primero.');
  }

  const datos = await cuerpoJson<{
    nombre?: string;
    apellido?: string;
    cedula?: string;
    correo?: string;
    direccion?: string;
    notas?: string;
    cumple?: string;
    atendidoPor?: string;
  }>(peticion);

  const nombre = (datos.nombre ?? fila.nombre).trim();
  if (!nombre) throw new ErrorPeticion(400, 'invalida', 'La ficha necesita un nombre.');

  const correo = (datos.correo ?? fila.correo).trim();
  if (correo && !pareceCorreo(correo)) {
    throw new ErrorPeticion(400, 'invalida', 'Ese correo no parece un correo.');
  }

  const cumple = (datos.cumple ?? fila.cumple).trim();
  if (!cumpleValido(cumple)) {
    throw new ErrorPeticion(400, 'invalida', 'Esa fecha de cumpleaños no existe.');
  }

  const apellido = (datos.apellido ?? fila.apellido).trim();
  const cedula = (datos.cedula ?? fila.cedula).trim();
  const ahora = new Date().toISOString();

  try {
    await base
      .prepare(
        `UPDATE socios
            SET nombre = ?, apellido = ?, nombre_normal = ?, cedula = ?, cedula_digitos = ?,
                correo = ?, correo_normal = ?, cumple = ?, direccion = ?, notas = ?,
                atendido_por = ?, actualizado_en = ?
          WHERE codigo = ? AND eliminado_en IS NULL`,
      )
      .bind(
        nombre,
        apellido,
        sinTildes(`${nombre} ${apellido}`),
        cedula,
        soloDigitos(cedula),
        correo,
        correoNormal(correo),
        cumple,
        (datos.direccion ?? fila.direccion).trim(),
        (datos.notas ?? fila.notas).trim(),
        (datos.atendidoPor ?? fila.atendido_por).trim(),
        ahora,
        fila.codigo,
      )
      .run();
  } catch (error) {
    if (choco(error, 'socios.cedula_digitos')) {
      const otra = await base
        .prepare(`SELECT codigo, nombre FROM socios WHERE cedula_digitos = ? AND codigo <> ?`)
        .bind(soloDigitos(cedula), fila.codigo)
        .first<{ codigo: string; nombre: string }>();
      throw new ErrorPeticion(
        409,
        'repetida',
        'Esa cédula ya está en otra ficha.',
        otra ? `Es la de ${otra.nombre}, ${otra.codigo}.` : undefined,
      );
    }
    throw error;
  }

  const nueva = await porCodigoIncluyendoPapelera(base, fila.codigo);
  console.log(`Ficha ${fila.codigo} corregida por ${quien}.`);
  return { cliente: comoFicha(nueva!) };
}

// ---------------------------------------------------------------------------
// La papelera
// ---------------------------------------------------------------------------

/**
 * Retira una ficha de la lista. Reversible, y con constancia de quién.
 *
 * NO BORRA NADA DE LO QUE COMPRÓ. Es la promesa que hace que esto se pueda usar
 * sin miedo: quitar de en medio a alguien que ya no viene no puede costar el
 * historial de lo que se le vendió, ni descuadrar el pasivo del programa.
 *
 * Sus puntos dejan de estar a su alcance —no puede entrar— pero siguen escritos
 * en el libro mayor, así que si mañana vuelve y se restaura la ficha, se
 * encuentra su saldo intacto. Un programa de puntos que se come el saldo de
 * quien estuvo un año sin venir es un programa del que la gente se acuerda mal.
 */
export async function retirar(
  base: D1Database,
  codigo: string,
  quien: string,
): Promise<{ codigo: string; retirada: true }> {
  const fila = await porCodigoIncluyendoPapelera(base, codigo);
  if (!fila) throw new ErrorPeticion(404, 'no-encontrada', 'Esa ficha no existe.');
  if (fila.eliminado_en) {
    throw new ErrorPeticion(409, 'repetida', 'Esa ficha ya estaba en la papelera.');
  }

  await base
    .prepare(`UPDATE socios SET eliminado_en = ?, eliminado_por = ? WHERE codigo = ? AND eliminado_en IS NULL`)
    .bind(new Date().toISOString(), quien, fila.codigo)
    .run();

  return { codigo: fila.codigo, retirada: true };
}

export async function restaurar(
  base: D1Database,
  codigo: string,
): Promise<{ codigo: string; restaurada: true }> {
  const fila = await porCodigoIncluyendoPapelera(base, codigo);
  if (!fila) throw new ErrorPeticion(404, 'no-encontrada', 'Esa ficha no existe.');
  if (!fila.eliminado_en) {
    throw new ErrorPeticion(409, 'repetida', 'Esa ficha no estaba en la papelera.');
  }

  await base
    .prepare(`UPDATE socios SET eliminado_en = NULL, eliminado_por = NULL WHERE codigo = ?`)
    .bind(fila.codigo)
    .run();

  return { codigo: fila.codigo, restaurada: true };
}

/**
 * El borrado de verdad, que no se deshace.
 *
 * Dos candados, y los dos son a propósito:
 *
 * 1. **Solo alcanza fichas que ya están en la papelera.** Lo impone el servidor
 *    por su cuenta, diga lo que diga quien llame: borrar de verdad tiene que
 *    ser el segundo paso de una decisión, nunca el primero.
 *
 * 2. **Solo si la ficha no tiene nada colgando.** Una ficha con compras, con
 *    movimientos o con canjes NO se borra, y no es una limitación técnica: esas
 *    filas son el historial de un dinero que entró en la tienda y el libro mayor
 *    que explica los puntos de todo el mundo. Borrar la ficha dejaría compras
 *    huérfanas y un pasivo que no cuadra con la suma de los saldos. Para esas,
 *    la papelera ES el borrado: desaparece de todas las listas y no puede
 *    entrar.
 *
 * Lo que sí se borra sin dejar rastro es la ficha que nunca llegó a nada: la
 * que se creó con un dedo equivocado, la de prueba, la duplicada. Que es
 * exactamente lo que alguien quiere borrar de verdad.
 */
export async function borrarDeVerdad(
  base: D1Database,
  codigo: string,
  quien: string,
): Promise<{ codigo: string; borrada: true }> {
  const fila = await porCodigoIncluyendoPapelera(base, codigo);
  if (!fila) throw new ErrorPeticion(404, 'no-encontrada', 'Esa ficha no existe.');
  if (!fila.eliminado_en) {
    throw new ErrorPeticion(
      409,
      'invalida',
      'Primero hay que retirarla a la papelera. Borrar de verdad es el segundo paso, no el primero.',
    );
  }

  const cuantos = await base
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM compras WHERE socio_codigo = ?) AS compras,
         (SELECT COUNT(*) FROM movimientos WHERE socio_codigo = ?) AS movimientos,
         (SELECT COUNT(*) FROM canjes WHERE socio_codigo = ?) AS canjes,
         (SELECT COUNT(*) FROM ventas WHERE socio_codigo = ?) AS ventas,
         (SELECT COUNT(*) FROM socios WHERE referido_por = ?) AS ahijados`,
    )
    .bind(fila.codigo, fila.codigo, fila.codigo, fila.codigo, fila.codigo)
    .first<{
      compras: number;
      movimientos: number;
      canjes: number;
      ventas: number;
      ahijados: number;
    }>();

  const cuelga: string[] = [];
  if (cuantos?.ventas) cuelga.push(`${cuantos.ventas} venta(s)`);
  if (cuantos?.compras) cuelga.push(`${cuantos.compras} compra(s)`);
  if (cuantos?.movimientos) cuelga.push(`${cuantos.movimientos} movimiento(s) de puntos`);
  if (cuantos?.canjes) cuelga.push(`${cuantos.canjes} canje(s)`);
  if (cuantos?.ahijados) cuelga.push(`${cuantos.ahijados} persona(s) que trajo`);

  if (cuelga.length) {
    throw new ErrorPeticion(
      409,
      'invalida',
      'Esa ficha no se puede borrar del todo: tiene historial colgando.',
      `Tiene ${cuelga.join(', ')}. En la papelera ya no sale en ninguna lista ni puede entrar.`,
    );
  }

  await base
    .prepare(`DELETE FROM socios WHERE codigo = ? AND eliminado_en IS NOT NULL`)
    .bind(fila.codigo)
    .run();

  console.log(`Ficha ${fila.codigo} borrada definitivamente por ${quien}.`);
  return { codigo: fila.codigo, borrada: true };
}
