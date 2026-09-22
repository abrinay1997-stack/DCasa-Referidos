/**
 * Los premios y los canjes: por dónde salen los puntos.
 *
 * ---------------------------------------------------------------------------
 * LA RESERVA: SE DESCUENTA AL PEDIR, NO AL ENTREGAR
 *
 * El socio pide el premio desde su casa y tiene 72 horas para pasar por la
 * tienda. Si los puntos se descontaran al entregar, en esas 72 horas podría
 * pedir tres premios con saldo para uno y los tres le saldrían con código. El
 * primero que llegara al mostrador se lo llevaría; los otros dos serían dos
 * clientes con un código en la mano al que hay que decirles que no.
 *
 * Y LA COMPROBACIÓN DEL SALDO VA DENTRO DE LA ESCRITURA, no antes.
 *
 * «Leer el saldo, comprobar que alcanza, escribir» es una carrera: dos toques
 * seguidos en un móvil lento leen los dos el mismo saldo, los dos deciden que
 * alcanza, y los dos escriben. Aquí el INSERT lleva su propio `WHERE` sobre la
 * suma del libro mayor, así que la base decide, y decide una sola vez.
 * ---------------------------------------------------------------------------
 */

import { ErrorPeticion, cuerpoJson } from './http';
import { anioEnPanama, diaEnPanama, diaYMesEnPanama } from './reloj';
import { REGLAS } from './reglas';
import { ALFABETO_CODIGO } from '../compartido/socios';
import { sentenciaAsiento } from './movimientos';

/** Seis caracteres del mismo alfabeto sin ambigüedades que los códigos de socio. */
function codigoDeCanje(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let codigo = '';
  for (const b of bytes) codigo += ALFABETO_CODIGO[b % ALFABETO_CODIGO.length];
  return codigo;
}

export interface Premio {
  id: string;
  nombre: string;
  descripcion: string;
  tipo: 'descuento' | 'producto';
  puntos: number;
  valorCentavos: number;
  stock: number | null;
  imagen: string;
  /** Cuántos puntos le faltan a quien mira. Cero si ya le alcanza. */
  faltan: number;
}

/**
 * El catálogo que ve el socio.
 *
 * Los que no alcanza salen igual, con su «te faltan X». Esconderlos quitaría
 * lo único que hace que alguien vuelva: ver lo que está a punto de conseguir.
 */
export async function catalogo(base: D1Database, saldo: number): Promise<Premio[]> {
  const { results } = await base
    .prepare(
      `SELECT id, nombre, descripcion, tipo, puntos, valor_centavos, stock, imagen
         FROM premios
        WHERE activo = 1 AND (stock IS NULL OR stock > 0)
        ORDER BY orden, puntos`,
    )
    .all<Record<string, unknown>>();

  return (results ?? []).map((f) => ({
    id: f.id as string,
    nombre: f.nombre as string,
    descripcion: (f.descripcion as string) ?? '',
    tipo: (f.tipo as 'descuento' | 'producto') ?? 'descuento',
    puntos: f.puntos as number,
    valorCentavos: (f.valor_centavos as number) ?? 0,
    stock: (f.stock as number | null) ?? null,
    imagen: (f.imagen as string) ?? '',
    faltan: Math.max(0, (f.puntos as number) - saldo),
  }));
}

export interface CanjeLeido {
  id: string;
  codigo: string;
  socioCodigo: string;
  premioNombre: string;
  premioTipo: string;
  puntos: number;
  valorCentavos: number;
  estado: 'solicitado' | 'entregado' | 'vencido' | 'cancelado';
  solicitadoEn: string;
  expiraEn: string;
  entregadoEn: string | null;
  cerradoMotivo: string;
}

function comoCanje(f: Record<string, unknown>): CanjeLeido {
  return {
    id: f.id as string,
    codigo: f.codigo as string,
    socioCodigo: f.socio_codigo as string,
    premioNombre: f.premio_nombre as string,
    premioTipo: (f.premio_tipo as string) ?? 'descuento',
    puntos: f.puntos as number,
    valorCentavos: (f.valor_centavos as number) ?? 0,
    estado: f.estado as CanjeLeido['estado'],
    solicitadoEn: f.solicitado_en as string,
    expiraEn: f.expira_en as string,
    entregadoEn: (f.entregado_en as string) ?? null,
    cerradoMotivo: (f.cerrado_motivo as string) ?? '',
  };
}

/**
 * El socio pide un premio.
 *
 * Todo en un solo `batch`, y cada sentencia con su propia condición para que
 * ninguna pueda ocurrir sin las otras:
 *
 *   1. La fila del canje, solo si el saldo alcanza.
 *   2. El asiento negativo, solo si la fila anterior existe.
 *   3. El descuento de stock, solo si la fila anterior existe.
 */
export async function pedir(
  base: D1Database,
  socioCodigo: string,
  peticion: Request,
): Promise<CanjeLeido> {
  const datos = await cuerpoJson<{ premio?: string }>(peticion);
  const premioId = (datos.premio ?? '').trim();

  const premio = await base
    .prepare(
      `SELECT id, nombre, tipo, puntos, valor_centavos, costo_centavos, stock
         FROM premios WHERE id = ? AND activo = 1`,
    )
    .bind(premioId)
    .first<{
      id: string;
      nombre: string;
      tipo: string;
      puntos: number;
      valor_centavos: number;
      costo_centavos: number;
      stock: number | null;
    }>();

  if (!premio) throw new ErrorPeticion(404, 'no-encontrada', 'Ese premio ya no está disponible.');
  if (premio.stock !== null && premio.stock <= 0) {
    throw new ErrorPeticion(409, 'repetida', 'Ese premio se agotó. Elige otro.');
  }

  const minimo = REGLAS.canje.saldoMinimoParaCanjear;
  if (minimo !== null && premio.puntos < minimo) {
    throw new ErrorPeticion(
      400,
      'invalida',
      `El canje mínimo es de ${minimo} puntos.`,
    );
  }

  // Un solo canje pendiente del mismo premio. Sin esto, un toque doble en un
  // móvil lento deja al socio con dos códigos del mismo descuento y el doble de
  // puntos reservados.
  //
  // Esta consulta es solo para dar un mensaje útil —«ya lo tienes, es este
  // código»—. La que de verdad lo impide va DENTRO del INSERT de abajo: leer
  // aquí y escribir después es una carrera, y cinco peticiones simultáneas
  // pasan las cinco por este punto antes de que ninguna haya escrito.
  const yaPedido = await base
    .prepare(
      `SELECT codigo FROM canjes
        WHERE socio_codigo = ? AND premio_id = ? AND estado = 'solicitado'`,
    )
    .bind(socioCodigo, premioId)
    .first<{ codigo: string }>();

  if (yaPedido) {
    throw new ErrorPeticion(
      409,
      'repetida',
      'Ya tienes ese premio pedido. Enséñalo en la tienda antes de que venza.',
      yaPedido.codigo,
    );
  }

  const id = crypto.randomUUID();
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + REGLAS.canje.vigenciaDelCodigoHoras * 3600_000);

  // Hasta cinco intentos por si el código de seis caracteres sale repetido.
  for (let intento = 0; intento < 5; intento += 1) {
    const codigo = codigoDeCanje();

    const sentencias: D1PreparedStatement[] = [
      // 1. El canje, SOLO si el saldo alcanza. La condición va dentro del
      //    INSERT: la base decide, y decide una sola vez.
      base
        .prepare(
          `INSERT INTO canjes
             (id, codigo, socio_codigo, premio_id, premio_nombre, premio_tipo,
              puntos, valor_centavos, costo_centavos, estado, solicitado_en, expira_en)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'solicitado', ?, ?
            WHERE (SELECT COALESCE(SUM(puntos), 0) FROM movimientos WHERE socio_codigo = ?) >= ?
              AND NOT EXISTS (
                SELECT 1 FROM canjes
                 WHERE socio_codigo = ? AND premio_id = ? AND estado = 'solicitado'
              )`,
        )
        .bind(
          id,
          codigo,
          socioCodigo,
          premio.id,
          premio.nombre,
          premio.tipo,
          premio.puntos,
          premio.valor_centavos,
          premio.costo_centavos,
          ahora.toISOString(),
          expira.toISOString(),
          socioCodigo,
          premio.puntos,
          socioCodigo,
          premio.id,
        ),

      // 2. El asiento negativo, SOLO si el canje llegó a escribirse.
      base
        .prepare(
          `INSERT INTO movimientos
             (id, socio_codigo, ocurrido_en, tipo, puntos, canje_id, motivo, autor)
           SELECT ?, ?, ?, 'canje', ?, ?, ?, 'socio'
            WHERE EXISTS (SELECT 1 FROM canjes WHERE id = ?)`,
        )
        .bind(
          crypto.randomUUID(),
          socioCodigo,
          ahora.toISOString(),
          -premio.puntos,
          id,
          `Pediste: ${premio.nombre}`,
          id,
        ),

      // 3. El stock, por lo mismo.
      base
        .prepare(
          `UPDATE premios SET stock = stock - 1
            WHERE id = ? AND stock IS NOT NULL
              AND EXISTS (SELECT 1 FROM canjes WHERE id = ?)`,
        )
        .bind(premio.id, id),
    ];

    try {
      const hecho = await base.batch(sentencias);
      // Si el `WHERE` del saldo no se cumplió, la primera sentencia no escribió
      // nada — y las otras dos tampoco, porque dependen de ella.
      if (!hecho[0]?.meta.changes) {
        // No escribió: o no alcanzaba el saldo, o otra petición simultánea se
        // adelantó con el mismo premio. Se mira cuál de las dos para no decirle
        // «te faltan puntos» a quien sí los tenía.
        const pendiente = await base
          .prepare(
            `SELECT codigo FROM canjes
              WHERE socio_codigo = ? AND premio_id = ? AND estado = 'solicitado'`,
          )
          .bind(socioCodigo, premio.id)
          .first<{ codigo: string }>();

        if (pendiente) {
          throw new ErrorPeticion(
            409,
            'repetida',
            'Ya tienes ese premio pedido. Enséñalo en la tienda antes de que venza.',
            pendiente.codigo,
          );
        }
        throw new ErrorPeticion(
          400,
          'sin-saldo',
          'Te faltan puntos para ese premio. Sigue sumando y vuelve.',
        );
      }
    } catch (error) {
      if (error instanceof ErrorPeticion) throw error;
      if (String(error).includes('canjes.codigo')) continue;
      throw error;
    }

    const fila = await base
      .prepare(`SELECT * FROM canjes WHERE id = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    if (!fila) throw new ErrorPeticion(500, 'fallo', 'El canje no se guardó. Vuelve a intentarlo.');
    return comoCanje(fila);
  }

  throw new ErrorPeticion(500, 'fallo', 'No se pudo asignar un código. Vuelve a intentarlo.');
}

/** Los canjes de un socio, más reciente arriba. */
export async function deSocio(base: D1Database, socioCodigo: string): Promise<CanjeLeido[]> {
  const { results } = await base
    .prepare(`SELECT * FROM canjes WHERE socio_codigo = ? ORDER BY solicitado_en DESC LIMIT 30`)
    .bind(socioCodigo)
    .all<Record<string, unknown>>();
  return (results ?? []).map(comoCanje);
}

/** Resuelve el código que la vendedora teclea. */
export async function porCodigo(base: D1Database, codigo: string): Promise<CanjeLeido & { socio: string }> {
  const limpio = codigo.trim().toUpperCase();

  const fila = await base
    .prepare(
      `SELECT c.*, s.nombre || ' ' || s.apellido AS socio
         FROM canjes c JOIN socios s ON s.codigo = c.socio_codigo
        WHERE c.codigo = ?`,
    )
    .bind(limpio)
    .first<Record<string, unknown>>();

  if (!fila) throw new ErrorPeticion(404, 'no-encontrada', 'Ese código no existe. Revísalo.');
  return { ...comoCanje(fila), socio: ((fila.socio as string) ?? '').trim() };
}

/**
 * La vendedora entrega el premio.
 *
 * NO mueve puntos: ya salieron al pedirlo. Aquí solo se sella que se entregó.
 */
export async function entregar(
  base: D1Database,
  codigo: string,
  quien: string,
): Promise<CanjeLeido> {
  const canje = await porCodigo(base, codigo);

  if (canje.estado === 'entregado') {
    throw new ErrorPeticion(
      409,
      'repetida',
      `Ese premio ya se entregó el ${canje.entregadoEn ? diaEnPanama(canje.entregadoEn) : ''}.`,
    );
  }
  if (canje.estado !== 'solicitado') {
    throw new ErrorPeticion(
      409,
      'repetida',
      canje.estado === 'vencido'
        ? 'Ese código venció y los puntos ya volvieron a su cuenta.'
        : 'Ese canje se canceló.',
    );
  }

  const ahora = new Date().toISOString();

  // El `WHERE estado = 'solicitado'` es la defensa contra dos vendedoras
  // tecleando el mismo código a la vez: la segunda no cambia nada y se entera.
  const hecho = await base
    .prepare(
      `UPDATE canjes SET estado = 'entregado', entregado_en = ?, entregado_por = ?
        WHERE codigo = ? AND estado = 'solicitado'`,
    )
    .bind(ahora, quien, canje.codigo)
    .run();

  if (!hecho.meta.changes) {
    throw new ErrorPeticion(409, 'repetida', 'Alguien acaba de entregar ese premio.');
  }

  return { ...canje, estado: 'entregado', entregadoEn: ahora };
}

/**
 * Cierra un canje y devuelve los puntos.
 *
 * Sirve para el vencimiento automático y para la cancelación a mano. Los dos
 * hacen lo mismo: sellar el canje, escribir el asiento contrario y reponer el
 * stock, todo en un `batch` y todo condicionado a que el canje siguiera
 * pendiente.
 */
export async function cerrar(
  base: D1Database,
  canje: { id: string; socioCodigo: string; puntos: number; premioNombre: string; premioId?: string },
  estado: 'vencido' | 'cancelado',
  motivo: string,
  autor: string,
): Promise<void> {
  const ahora = new Date().toISOString();

  await base.batch([
    base
      .prepare(
        `UPDATE canjes SET estado = ?, cerrado_en = ?, cerrado_motivo = ?
          WHERE id = ? AND estado = 'solicitado'`,
      )
      .bind(estado, ahora, motivo, canje.id),

    // El asiento de vuelta, solo si el sellado de arriba se aplicó de verdad.
    base
      .prepare(
        `INSERT INTO movimientos
           (id, socio_codigo, ocurrido_en, tipo, puntos, canje_id, motivo, autor)
         SELECT ?, ?, ?, 'reverso', ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM canjes WHERE id = ? AND estado = ?)`,
      )
      .bind(
        crypto.randomUUID(),
        canje.socioCodigo,
        ahora,
        canje.puntos,
        canje.id,
        motivo,
        autor,
        canje.id,
        estado,
      ),

    // Y el stock vuelve al catálogo.
    base
      .prepare(
        `UPDATE premios SET stock = stock + 1
          WHERE id = (SELECT premio_id FROM canjes WHERE id = ?)
            AND stock IS NOT NULL
            AND EXISTS (SELECT 1 FROM canjes WHERE id = ? AND estado = ?)`,
      )
      .bind(canje.id, canje.id, estado),
  ]);
}

/** El socio cancela un canje que pidió sin querer. */
export async function cancelar(
  base: D1Database,
  socioCodigo: string,
  codigo: string,
): Promise<{ devueltos: number }> {
  const canje = await porCodigo(base, codigo);

  if (canje.socioCodigo !== socioCodigo) {
    // Mismo mensaje que si no existiera: si dijera «no es tuyo», tecleando
    // códigos al azar se averiguaría cuáles existen.
    throw new ErrorPeticion(404, 'no-encontrada', 'Ese código no existe. Revísalo.');
  }
  if (canje.estado !== 'solicitado') {
    throw new ErrorPeticion(409, 'repetida', 'Ese canje ya no está pendiente.');
  }

  await cerrar(base, canje, 'cancelado', 'Lo cancelaste tú.', 'socio');
  return { devueltos: canje.puntos };
}

/**
 * Vence los códigos que nadie fue a buscar. Lo llama el Cron cada hora.
 *
 * Devolver los puntos no es cortesía: el socio los ganó comprando, y
 * quedárselos porque no pudo pasar por la tienda en tres días es la clase de
 * detalle que hace que un programa de puntos deje de ser creíble.
 */
export async function vencerLosViejos(base: D1Database): Promise<number> {
  const ahora = new Date().toISOString();

  const { results } = await base
    .prepare(
      `SELECT id, socio_codigo, puntos, premio_nombre FROM canjes
        WHERE estado = 'solicitado' AND expira_en <= ? LIMIT 200`,
    )
    .bind(ahora)
    .all<{ id: string; socio_codigo: string; puntos: number; premio_nombre: string }>();

  for (const c of results ?? []) {
    await cerrar(
      base,
      { id: c.id, socioCodigo: c.socio_codigo, puntos: c.puntos, premioNombre: c.premio_nombre },
      'vencido',
      `Tu código de "${c.premio_nombre}" venció. Te devolvimos tus puntos.`,
      'sistema',
    );
  }

  return (results ?? []).length;
}

/** La lista del panel: lo pendiente primero, que es lo que hay que atender. */
export async function paraElPanel(base: D1Database, estado = 'solicitado') {
  const { results } = await base
    .prepare(
      `SELECT c.*, s.nombre || ' ' || s.apellido AS socio
         FROM canjes c JOIN socios s ON s.codigo = c.socio_codigo
        WHERE c.estado = ?
        ORDER BY c.solicitado_en DESC LIMIT 100`,
    )
    .bind(estado)
    .all<Record<string, unknown>>();

  return (results ?? []).map((f) => ({
    ...comoCanje(f),
    socio: ((f.socio as string) ?? '').trim(),
  }));
}

// ---------------------------------------------------------------------------
// El regalo de cumpleaños
// ---------------------------------------------------------------------------

/**
 * Felicita a quien cumple hoy, una vez al año.
 *
 * ---------------------------------------------------------------------------
 * EXIGE UNA COMPRA PREVIA, Y NO ES TACAÑERÍA
 *
 * Sin esa condición, la forma más rentable de usar el programa sería darse de
 * alta el día antes del propio cumpleaños con cinco teléfonos prestados. El
 * regalo premia a un cliente, no a una fecha.
 *
 * Y se comprueba que no se haya dado ya este año antes de escribir: el Cron
 * corre cada hora, así que sin esa comprobación el mismo socio cobraría
 * veinticuatro veces el día de su cumpleaños.
 * ---------------------------------------------------------------------------
 */
export async function felicitarALosDeHoy(base: D1Database): Promise<number> {
  const puntos = REGLAS.cumpleanos.puntos;
  if (puntos === null || puntos <= 0) return 0;

  const ahora = new Date();
  // EL DÍA QUE ES EN PANAMÁ, no en UTC. El Worker corre cinco horas por delante
  // de La Chorrera: a las 7 de la tarde del 14, en UTC ya es el 15, y sin esto
  // el regalo caía la tarde anterior al cumpleaños de cada uno.
  const hoy = diaYMesEnPanama(ahora);
  const desdeEneroUno = `${anioEnPanama(ahora)}-01-01T00:00:00.000Z`;

  const { results } = await base
    .prepare(
      `SELECT s.codigo FROM socios s
        WHERE s.cumple = ?
          AND s.estado = 'activo'
          AND s.eliminado_en IS NULL
          AND EXISTS (
            SELECT 1 FROM compras k
             WHERE k.socio_codigo = s.codigo AND k.anulada_en IS NULL AND k.puntos > 0
          )
          AND NOT EXISTS (
            SELECT 1 FROM movimientos m
             WHERE m.socio_codigo = s.codigo AND m.tipo = 'cumpleanos' AND m.ocurrido_en >= ?
          )
        LIMIT 200`,
    )
    .bind(hoy, desdeEneroUno)
    .all<{ codigo: string }>();

  const socios = results ?? [];
  if (!socios.length) return 0;

  await base.batch(
    socios.map((s) =>
      sentenciaAsiento(base, {
        socioCodigo: s.codigo,
        tipo: 'cumpleanos',
        puntos,
        motivo: '¡Feliz cumpleaños! Un regalo de parte de D’CASA.',
        autor: 'sistema',
        ocurridoEn: ahora.toISOString(),
      }),
    ),
  );

  return socios.length;
}

/** Un premio cobrado dentro de una venta, listo para descontar. */
export interface CanjeCobrado {
  codigo: string;
  premio: string;
  valorCentavos: number;
  /** La sentencia que lo marca entregado. Va en el batch de la venta. */
  sentencia: D1PreparedStatement;
}

/**
 * Cobra los códigos de premio que el cliente trae a una venta.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTO NO PUEDE SER «LA VENDEDORA TECLEA EL DESCUENTO»
 *
 * Que era como funcionaba. El socio canjeaba «$10 de descuento», le salía un
 * código, lo enseñaba, y alguien escribía 10.00 a mano en el campo de
 * descuento. Con eso, el mismo código valía en dos ventas, se podía teclear un
 * importe distinto del que valía el premio, y el historial no distinguía un
 * canje de una rebaja de mostrador.
 *
 * Aquí el importe lo pone el premio, no quien teclea; el código se marca
 * entregado en el MISMO batch que la venta; y el `WHERE estado = 'solicitado'`
 * de esa sentencia es lo que impide que dos vendedoras lo cobren a la vez —la
 * segunda no cambia ninguna fila y la venta entera se cae, que es lo correcto:
 * mejor repetir la venta que cobrar dos veces el mismo premio.
 *
 * ---------------------------------------------------------------------------
 * EL PREMIO TIENE QUE SER DEL CLIENTE DE LA VENTA
 *
 * Sin esa comprobación, un código de otra persona —que se reparte en un papel,
 * y que alguien puede leer por encima del hombro— serviría para rebajar
 * cualquier venta. Los puntos ya salieron del saldo de su dueño al pedirlo, así
 * que el fraude no descuadra nada visible: simplemente el descuento se lo lleva
 * quien no lo ganó.
 */
export async function cobrarEnVenta(
  base: D1Database,
  codigos: string[],
  socioCodigo: string,
  numeroDeLaVenta: string,
  ahora: string,
  quien: string,
): Promise<CanjeCobrado[]> {
  const limpios = [...new Set(codigos.map((c) => (c ?? '').trim().toUpperCase()).filter(Boolean))];
  if (!limpios.length) return [];

  const cobrados: CanjeCobrado[] = [];

  for (const codigo of limpios) {
    const canje = await porCodigo(base, codigo);

    if (canje.socioCodigo !== socioCodigo) {
      throw new ErrorPeticion(
        403,
        'sin-permiso',
        `El premio ${codigo} es de otro cliente. Solo lo puede usar quien lo ganó.`,
      );
    }
    if (canje.estado === 'entregado') {
      throw new ErrorPeticion(409, 'repetida', `El premio ${codigo} ya se entregó.`);
    }
    if (canje.estado !== 'solicitado') {
      throw new ErrorPeticion(
        409,
        'repetida',
        canje.estado === 'vencido'
          ? `El premio ${codigo} venció y sus puntos ya volvieron a la cuenta.`
          : `El premio ${codigo} se canceló.`,
      );
    }

    cobrados.push({
      codigo: canje.codigo,
      premio: canje.premioNombre,
      valorCentavos: canje.valorCentavos,
      sentencia: sellarConLaVenta(base, canje.codigo, numeroDeLaVenta, ahora, quien),
    });
  }

  return cobrados;
}

/**
 * Marca un premio entregado dentro de una venta.
 *
 * El `WHERE estado = 'solicitado'` es lo que impide cobrarlo dos veces: si otra
 * vendedora se adelantó, esta sentencia no cambia ninguna fila. Va en el batch
 * de la venta, así que D1 deshace la venta entera — que es lo correcto: mejor
 * repetir la venta que regalar el premio dos veces.
 */
export function sellarConLaVenta(
  base: D1Database,
  codigo: string,
  numero: string,
  ahora: string,
  quien: string,
): D1PreparedStatement {
  return base
    .prepare(
      `UPDATE canjes SET estado = 'entregado', entregado_en = ?, entregado_por = ?,
              venta_numero = ?
        WHERE codigo = ? AND estado = 'solicitado'`,
    )
    .bind(ahora, quien, numero, codigo);
}
