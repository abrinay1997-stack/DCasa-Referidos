/**
 * La puerta del sistema de socios: quién entra por dónde.
 *
 * ---------------------------------------------------------------------------
 * LA DIFERENCIA CON LOS OTROS DOS HUBS, Y POR QUÉ ESTE ARCHIVO NO SE PARECE
 *
 * En `hub-panaclaw` y en `hub-business-supplies`, Cloudflare Access está
 * delante de TODO y el Worker se niega a servir hasta la portada si Access no
 * está configurado. Aquí eso no puede ser: el cliente que escanea el QR en la
 * tienda no tiene un correo autorizado, ni lo va a tener nunca.
 *
 * Así que hay dos zonas separadas por prefijo de ruta:
 *
 *   PÚBLICA   /                  la app del socio
 *             /api/socio/*       su API, con sesión propia de teléfono + PIN
 *
 *   PRIVADA   /panel/            el panel del equipo
 *             /panel/api/*       su API, con el token firmado de Access
 *
 * TODO LO DEL EQUIPO VIVE BAJO `/panel/`, LA API INCLUIDA, Y ES A PROPÓSITO.
 * Una aplicación de Cloudflare Access se define por dominio + ruta. Con esta
 * forma, UNA SOLA aplicación sobre la ruta `panel` cubre la pantalla y la API
 * a la vez. Si la API del equipo viviera en `/api/panel/*`, harían falta dos
 * aplicaciones de Access, y el día que alguien cree una y se olvide de la
 * otra, la API del equipo queda abierta sin que nada lo grite. Una ruta, una
 * puerta, un sitio donde equivocarse en vez de dos.
 * ---------------------------------------------------------------------------
 *
 * De aquí no cuelga ninguna regla de negocio. Este archivo solo sabe de
 * direcciones y de quién llama.
 */

import { ErrorPeticion, cabecerasSeguridad, fallo, json } from './http';
import type { Env } from './entorno';
import { identificar, revisarPuerta, SinAcceso } from './acceso';
import * as socios from './socios';
import * as compras from './compras';
import { ajustar, bitacoraDe, saldoDe } from './movimientos';
import { queEstaEncendido, REGLAS } from './reglas';
import * as referidos from './referidos';
import * as canjes from './canjes';
import * as reportes from './reportes';
import * as clientes from './clientes';
import * as ventas from './ventas';
import { COOKIE_SESION, cookieBorrada, cookieDe, leerSesion } from './sesion';

/** Todo lo del equipo cuelga de aquí. Ver la cabecera. */
const ZONA_PRIVADA = '/panel';

export default {
  async fetch(peticion: Request, env: Env): Promise<Response> {
    const url = new URL(peticion.url);
    const ruta = url.pathname;

    try {
      if (ruta === ZONA_PRIVADA || ruta.startsWith(`${ZONA_PRIVADA}/`)) {
        return await zonaPrivada(peticion, url, env);
      }
      return await zonaPublica(peticion, url, env);
    } catch (error) {
      return convertirElFallo(error);
    }
  },
  /**
   * El Cron, cada hora. Hace las dos cosas que nadie va a acordarse de hacer.
   *
   * **Vence los códigos de canje** que nadie fue a buscar y devuelve los
   * puntos. Devolverlos no es cortesía: el socio los ganó comprando, y
   * quedárselos porque no pudo pasar por la tienda en tres días es la clase de
   * detalle que hace que un programa de puntos deje de ser creíble. Si esto
   * falla, los puntos se quedan reservados y el socio no puede volver a pedir
   * ese premio.
   *
   * **Y acredita los cumpleaños del día.** Un regalo que depende de que alguien
   * mire una lista cada mañana es un regalo que se entrega tarde o no se
   * entrega.
   *
   * Los dos pasos corren por separado y los dos son repetibles, así que si uno
   * revienta el otro igual se hace y el reintento de Cloudflare no duplica
   * nada. El fallo se registra CON EL NOMBRE DEL PASO que falló: esto corre sin
   * nadie mirando, y un error que no dice dónde ocurrió no se arregla.
   */
  async scheduled(_evento: ScheduledController, env: Env): Promise<void> {
    let fallo: unknown = null;

    try {
      const vencidos = await canjes.vencerLosViejos(env.BASE);
      if (vencidos) console.log(`Vencidos ${vencidos} canje(s); puntos devueltos.`);
    } catch (error) {
      console.error('El vencimiento de canjes falló:', error);
      fallo = error;
    }

    try {
      const felicitados = await canjes.felicitarALosDeHoy(env.BASE);
      if (felicitados) console.log(`Felicitados ${felicitados} socio(s) de cumpleaños.`);
    } catch (error) {
      console.error('El regalo de cumpleaños falló:', error);
      fallo ??= error;
    }

    // Relanzar es lo que hace que Cloudflare marque la ejecución como fallida y
    // la reintente. Sin esto, el Cron se vería verde con la mitad sin hacer.
    if (fallo) throw fallo;
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// LA ZONA DEL EQUIPO
// ---------------------------------------------------------------------------

/**
 * Qué le falta a la puerta. Vacío cuando está bien puesta.
 *
 * `wrangler.jsonc` nace con `ACCESO_DOMINIO` y `ACCESO_AUD` en `PENDIENTE`
 * porque esos dos datos solo existen después de crear la aplicación en
 * Cloudflare Access, y eso se hace a mano en el panel.
 *
 * NO BASTA CON QUE ESTÉN ESCRITOS, Y EN PANACLAW ESO COSTÓ UNA TARDE: un valor
 * con la forma equivocada —el identificador de la cuenta, de 32 caracteres,
 * pegado donde va la etiqueta AUD, de 64, que están a un clic el uno del otro
 * en el mismo panel— dejaba el hub en pie, servía la portada, y contestaba «la
 * sesión caducó» a cada llamada. Sin sesión que caducar: el token estaba
 * perfecto y era la comparación la que no podía cuadrar nunca. Un fallo que
 * manda a recargar es un fallo que nadie puede arreglar recargando. Por eso se
 * mira la FORMA y no la presencia.
 */
function faltaEnLaPuerta(env: Env): string[] {
  return revisarPuerta({ dominio: env.ACCESO_DOMINIO, aud: env.ACCESO_AUD });
}

async function zonaPrivada(peticion: Request, url: URL, env: Env): Promise<Response> {
  // Sin Access configurado, el panel NO se sirve: ni su pantalla, ni su API.
  //
  // Y fíjate en que esto NO tumba la zona pública. En los otros dos hubs, un
  // Access a medio poner dejaba el sitio entero en 503, y ahí era lo correcto
  // porque el sitio entero era privado. Aquí la app del socio no depende de
  // Access para nada: la puerta que falta no es la suya, y tumbarla sería
  // castigar a los clientes por una configuración del equipo.
  if (env.MODO !== 'desarrollo') {
    const falta = faltaEnLaPuerta(env);
    if (falta.length) return sinPuerta(falta);
  }

  // La firma se comprueba SIEMPRE, incluso con Access bien puesto delante. Si
  // un día esta dirección queda alcanzable por una ruta que no pasa por la
  // puerta, esto es lo único que queda en pie.
  const correo = await quienEsDelEquipo(peticion, env);

  if (!url.pathname.startsWith(`${ZONA_PRIVADA}/api/`)) {
    return await servirEstatico(peticion, env);
  }

  const ruta = url.pathname.slice(`${ZONA_PRIVADA}/api/`.length).replace(/\/$/, '');
  const metodo = peticion.method.toUpperCase();
  const base = env.BASE;

  if (ruta === 'yo' && metodo === 'GET') {
    return json({
      correo,
      encendido: queEstaEncendido(),
      admin: esAdmin(correo, env),
      // Mientras la lista esté vacía, cualquiera que entre puede borrar. La
      // pantalla lo avisa; ver `CORREOS_ADMIN` en wrangler.jsonc.
      adminSinLista: !(env.CORREOS_ADMIN ?? '').trim(),
    });
  }

  // Dar de alta desde el mostrador. Es la misma alta que hace el socio solo,
  // con `creadoPor` puesto al correo de la vendedora en vez de 'qr': saber
  // cuántas altas entran por el QR y cuántas las empuja el equipo es lo que
  // dice si el QR está funcionando.
  if (ruta === 'socios' && metodo === 'POST') {
    const { socio } = await socios.registrar(base, peticion, env, correo);
    return json(socio, 201);
  }

  // Lo que la vendedora ve mientras teclea: nombre, celular enmascarado y
  // saldo. Nunca la cédula ni el correo — para sumarle una compra a alguien no
  // hacen falta, y lo que no hace falta no se enseña.
  if (ruta === 'socios' && metodo === 'GET') {
    return json(await buscarSocios(base, url.searchParams.get('q') ?? ''));
  }

  // Cuántos puntos daría, SIN escribir nada. Alimenta el «esta compra le da
  // 340 puntos» que se ve antes de confirmar.
  if (ruta === 'compras/calcular' && metodo === 'POST') {
    const datos = await peticion.json<{ socio?: string; montoCentavos?: number }>();
    const codigo = (datos.socio ?? '').trim().toUpperCase();
    const saldo = codigo ? await saldoDe(base, codigo) : 0;
    return json(compras.calcular(compras.montoDesde(datos.montoCentavos), saldo));
  }

  if (ruta === 'compras' && metodo === 'POST') {
    return json(await compras.registrar(base, peticion, correo), 201);
  }

  const anular = /^compras\/([^/]+)\/anular$/.exec(ruta);
  if (anular && metodo === 'POST') {
    return json(await compras.anular(base, decodeURIComponent(anular[1]!), peticion, correo));
  }

  if (ruta === 'reportes' && metodo === 'GET') return json(await reportes.todo(base));

  if (ruta === 'canjes' && metodo === 'GET') {
    return json({ canjes: await canjes.paraElPanel(base, url.searchParams.get('estado') ?? 'solicitado') });
  }

  const verCanje = /^canjes\/([^/]+)$/.exec(ruta);
  if (verCanje && metodo === 'GET') {
    return json(await canjes.porCodigo(base, decodeURIComponent(verCanje[1]!)));
  }

  const entregar = /^canjes\/([^/]+)\/entregar$/.exec(ruta);
  if (entregar && metodo === 'POST') {
    return json(await canjes.entregar(base, decodeURIComponent(entregar[1]!), correo));
  }

  // Las acciones sobre un socio van ANTES que la ruta de detalle: todas cuelgan
  // de `socios/<codigo>/…` y sin este orden «reiniciar-pin» se leería como el
  // código de un socio que se llama así.
  const accion = /^socios\/([^/]+)\/([a-z-]+)$/.exec(ruta);
  if (accion && metodo === 'POST') {
    const codigo = decodeURIComponent(accion[1]!).toUpperCase();

    // Devuelve el PIN temporal UNA vez, para dictárselo al socio con él
    // delante. No se guarda en claro y no se puede volver a consultar.
    if (accion[2] === 'reiniciar-pin') {
      return json(await socios.reiniciarPin(base, codigo, env, correo));
    }
    if (accion[2] === 'desbloquear') {
      return json(await socios.desbloquear(base, codigo));
    }
    if (accion[2] === 'estado') {
      return json(await socios.cambiarEstado(base, codigo, peticion));
    }
    if (accion[2] === 'ajuste') {
      const cuerpo = await peticion.json<{ puntos?: number; motivo?: string }>();
      return json(
        await ajustar(base, codigo, Number(cuerpo.puntos), cuerpo.motivo ?? '', correo),
      );
    }
  }

  const detalle = /^socios\/([^/]+)$/.exec(ruta);
  if (detalle && metodo === 'GET') {
    const codigo = decodeURIComponent(detalle[1]!).toUpperCase();
    const fila = await socios.porCodigo(base, codigo);
    if (!fila) throw new ErrorPeticion(404, 'no-encontrada', 'Ese socio no existe.');
    return json({
      socio: socios.comoSocioPublico(fila),
      saldo: await saldoDe(base, codigo),
      bitacora: (await bitacoraDe(base, codigo)).filas,
      compras: await compras.deSocio(base, codigo),
    });
  }

  // --- Las ventas -------------------------------------------------------

  if (ruta === 'ventas' && metodo === 'POST') {
    return json(await ventas.emitir(base, peticion, correo), 201);
  }

  if (ruta === 'ventas' && metodo === 'GET') {
    return json(
      await ventas.listar(base, {
        texto: url.searchParams.get('q') ?? '',
        cliente: url.searchParams.get('cliente') ?? undefined,
        pagina: Number(url.searchParams.get('pagina') ?? 1),
        anuladas: url.searchParams.get('anuladas') === 'si',
      }),
    );
  }

  const anularVenta = /^ventas\/([^/]+)\/anular$/.exec(ruta);
  if (anularVenta && metodo === 'POST') {
    return json(await ventas.anular(base, decodeURIComponent(anularVenta[1]!), peticion, correo));
  }

  const verVenta = /^ventas\/([^/]+)$/.exec(ruta);
  if (verVenta && metodo === 'GET') {
    return json(await ventas.porNumero(base, decodeURIComponent(verVenta[1]!)));
  }

  // --- La libreta de clientes -------------------------------------------

  if (ruta === 'clientes' && metodo === 'GET') {
    const reclamadas = url.searchParams.get('reclamadas');
    return json(
      await clientes.listar(base, {
        texto: url.searchParams.get('q') ?? '',
        estado: url.searchParams.get('estado') ?? '',
        atendidoPor: url.searchParams.get('atiende') ?? '',
        reclamadas: reclamadas === 'si' || reclamadas === 'no' ? reclamadas : undefined,
        papelera: url.searchParams.get('papelera') === 'si',
        pagina: Number(url.searchParams.get('pagina') ?? 1),
      }),
    );
  }

  // Las acciones van ANTES del detalle, por lo mismo que en socios: sin este
  // orden, «retirar» se leería como el código de un cliente que se llama así.
  const accionCliente = /^clientes\/([^/]+)\/([a-z-]+)$/.exec(ruta);
  if (accionCliente && metodo === 'POST') {
    const codigo = decodeURIComponent(accionCliente[1]!).toUpperCase();
    if (accionCliente[2] === 'retirar') return json(await clientes.retirar(base, codigo, correo));
    if (accionCliente[2] === 'restaurar') return json(await clientes.restaurar(base, codigo));
    if (accionCliente[2] === 'borrar') {
      exigirAdmin(correo, env);
      return json(await clientes.borrarDeVerdad(base, codigo, correo));
    }
  }

  const detalleCliente = /^clientes\/([^/]+)$/.exec(ruta);
  if (detalleCliente) {
    const codigo = decodeURIComponent(detalleCliente[1]!).toUpperCase();
    if (metodo === 'GET') return json(await fichaEntera(base, codigo));
    if (metodo === 'POST') return json(await clientes.corregir(base, codigo, peticion, correo));
  }

  throw new ErrorPeticion(404, 'no-encontrada', 'Esa dirección no existe.');
}

/** Lo que se ve mientras falte la puerta. Dice qué falta y dónde se pone. */
function sinPuerta(problemas: string[]): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8">` +
      `<title>El panel todavía no está protegido</title>` +
      `<p>El panel del equipo no se sirve todavía porque le falta la puerta.</p>` +
      `<ul>${problemas.map((p) => `<li>${p}</li>`).join('')}</ul>` +
      `<p>En el panel de Cloudflare: Zero Trust &rarr; Access &rarr; Applications, ` +
      `sobre este Worker y con la RUTA <code>panel</code>. Al crearla, copie el dominio ` +
      `del equipo y la etiqueta AUD en <code>ACCESO_DOMINIO</code> y ` +
      `<code>ACCESO_AUD</code> de <code>wrangler.jsonc</code>, y vuelva a desplegar.</p>` +
      `<p>La etiqueta AUD est&aacute; en la propia aplicaci&oacute;n de Access, ` +
      `pesta&ntilde;a <em>Overview</em>, como &laquo;Application Audience (AUD) Tag&raquo;: ` +
      `son 64 caracteres. El identificador que sale en la barra lateral del panel ` +
      `de Workers es el de la CUENTA, tiene 32 y no sirve aqu&iacute;.</p>` +
      `<p>La app de los socios sigue funcionando: esto solo afecta a ` +
      `<code>/panel/</code>.</p>`,
    {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    },
  );
}

/**
 * Quién hace la petición al panel.
 *
 * En producción, el correo del token firmado de Access. En `npm run dev` no hay
 * Access delante —no existe en local— y se usa el de `.dev.vars`. Ese archivo
 * no se versiona y `MODO=desarrollo` **nunca** va en producción.
 */
async function quienEsDelEquipo(peticion: Request, env: Env): Promise<string> {
  if (env.MODO === 'desarrollo') return env.CORREO_DESARROLLO ?? 'desarrollo@local';
  return identificar(peticion, { dominio: env.ACCESO_DOMINIO, aud: env.ACCESO_AUD });
}

// ---------------------------------------------------------------------------
// LA ZONA DEL SOCIO
// ---------------------------------------------------------------------------

async function zonaPublica(peticion: Request, url: URL, env: Env): Promise<Response> {
  if (!url.pathname.startsWith('/api/')) return await servirEstatico(peticion, env);

  const ruta = url.pathname.slice('/api/'.length).replace(/\/$/, '');
  const metodo = peticion.method.toUpperCase();
  const base = env.BASE;

  // Un latido para poder comprobar desde fuera que el Worker está vivo sin
  // tocar la base ni revelar nada de nadie.
  if (ruta === 'salud' && metodo === 'GET') {
    return json({ estado: 'en pie', zona: 'socio', encendido: queEstaEncendido() });
  }

  // Lo que dicen los términos sale de las MISMAS reglas que aplica el
  // servidor, no de un texto escrito aparte. Si se escribieran a mano, el día
  // que cambie una cifra los términos dirían una cosa y el sistema haría otra
  // — y en un programa de puntos eso es una promesa incumplida por escrito.
  if (ruta === 'terminos' && metodo === 'GET') {
    return json({
      puntosPorDolar: REGLAS.acumulacion.puntosPorDolar,
      compraMinimaCentavos: REGLAS.acumulacion.compraMinimaCentavos,
      puntosAlPadrino: REGLAS.referido.puntosAlPadrino,
      puntosAlAhijado: REGLAS.referido.puntosAlAhijado,
      topeDePuntosPorPadrinoAlMes: REGLAS.referido.topeDePuntosPorPadrinoAlMes,
      topeDeAhijadosPorPadrino: REGLAS.referido.topeDeAhijadosPorPadrino,
      puntosDeCumpleanos: REGLAS.cumpleanos.puntos,
      vigenciaDelCodigoHoras: REGLAS.canje.vigenciaDelCodigoHoras,
      vencimientoMeses: REGLAS.vencimiento.meses,
    });
  }

  // --- Sin sesión ---------------------------------------------------------

  if (ruta === 'socio/registro' && metodo === 'POST') {
    const { socio, cookie } = await socios.registrar(base, peticion, env);
    return conCookie(json(socio, 201), cookie);
  }

  if (ruta === 'socio/entrar' && metodo === 'POST') {
    const { socio, cookie } = await socios.entrar(base, peticion, env);
    return conCookie(json(socio), cookie);
  }

  if (ruta === 'socio/salir' && metodo === 'POST') {
    return conCookie(json({ listo: true }), cookieBorrada());
  }

  // Resuelve el código del QR a un nombre, y a nada más: «Te invitó María G.».
  // Es la única ruta pública sin sesión que toca la base.
  if (ruta === 'socio/padrino' && metodo === 'GET') {
    return json({ padrino: await socios.padrinoDe(base, url.searchParams.get('r') ?? '') });
  }

  // --- Con sesión ---------------------------------------------------------

  if (ruta.startsWith('socio/')) {
    const fila = await quienEsElSocio(peticion, env);

    if (ruta === 'socio/yo' && metodo === 'GET') {
      return json({
        socio: socios.comoSocioPublico(fila),
        saldo: await saldoDe(base, fila.codigo),
        encendido: queEstaEncendido(),
      });
    }

    if (ruta === 'socio/pin' && metodo === 'POST') {
      const { cookie } = await socios.cambiarPin(base, fila, peticion, env);
      return conCookie(json({ listo: true }), cookie);
    }

    // Su código, su enlace y a quién ha traído. El enlace se arma con el
    // origen de la petición, no con una dirección escrita a mano: el día que
    // esto viva en socios.dcasapty.com, lo que el socio comparte cambia solo.
    if (ruta === 'socio/referidos' && metodo === 'GET') {
      return json({
        codigo: fila.codigo,
        enlace: `${url.origin}/?r=${fila.codigo}`,
        alPadrino: REGLAS.referido.puntosAlPadrino,
        alAhijado: REGLAS.referido.puntosAlAhijado,
        traidos: await referidos.deSocio(base, fila.codigo),
      });
    }

    if (ruta === 'socio/premios' && metodo === 'GET') {
      const saldo = await saldoDe(base, fila.codigo);
      return json({ saldo, premios: await canjes.catalogo(base, saldo) });
    }

    if (ruta === 'socio/canjes' && metodo === 'GET') {
      return json({ canjes: await canjes.deSocio(base, fila.codigo) });
    }

    if (ruta === 'socio/canjes' && metodo === 'POST') {
      return json(await canjes.pedir(base, fila.codigo, peticion), 201);
    }

    const cancelar = /^socio\/canjes\/([^/]+)\/cancelar$/.exec(ruta);
    if (cancelar && metodo === 'POST') {
      return json(await canjes.cancelar(base, fila.codigo, decodeURIComponent(cancelar[1]!)));
    }

    if (ruta === 'socio/actividad' && metodo === 'GET') {
      const desde = Number(url.searchParams.get('desde') ?? 0);
      return json(await bitacoraDe(base, fila.codigo, Number.isFinite(desde) ? desde : 0));
    }
  }

  // Fase 3 en adelante: referidos, premios y canjes.
  throw new ErrorPeticion(404, 'no-encontrada', 'Esa dirección no existe.');
}

// ---------------------------------------------------------------------------

/**
 * Quién es el socio que hace la petición.
 *
 * Dos pasos, y los dos hacen falta: que el token esté bien firmado (`leerSesion`)
 * y que la fila siga diciendo lo mismo (`socioDeLaSesion`). Entre que se emitió
 * la cookie y ahora pueden haber pasado noventa días, y en noventa días a
 * alguien lo suspenden, lo retiran o le reinician el PIN porque perdió el
 * teléfono.
 */
async function quienEsElSocio(peticion: Request, env: Env) {
  const token = cookieDe(peticion, COOKIE_SESION);
  if (!token) {
    throw new ErrorPeticion(401, 'sin-sesion', 'Entra con tu celular y tu PIN.');
  }
  const { c, p } = await leerSesion(token, env);
  return socios.socioDeLaSesion(env.BASE, c, p);
}

function conCookie(respuesta: Response, cookie: string): Response {
  const conLa = new Response(respuesta.body, respuesta);
  conLa.headers.set('Set-Cookie', cookie);
  return conLa;
}

/**
 * El buscador de la vendedora.
 *
 * Acepta cualquier tramo del celular, el celular entero, el nombre o el código,
 * porque en el mostrador se dice lo que se tiene a mano.
 *
 * CUALQUIER TRAMO, y no solo los últimos dígitos. Empezó buscando por el final
 * —«termina en 1919»— y la prueba de extremo a extremo lo cazó: tecleando los
 * primeros cuatro no encontraba nada y no decía por qué. Una vendedora con el
 * cliente delante no va a deducir que el buscador solo mira el final; va a
 * pensar que el socio no está y lo va a dar de alta otra vez, partiendo sus
 * puntos entre dos cuentas.
 *
 * El celular vuelve enmascarado: para sumarle una compra a alguien basta con
 * reconocerlo, y un listado que enseña teléfonos completos es una libreta de
 * contactos que se puede fotografiar de un vistazo.
 */
async function buscarSocios(base: D1Database, consulta: string) {
  const q = consulta.trim();
  if (q.length < 2) return { filas: [] };

  const digitos = q.replace(/\D/g, '');
  const como = `%${q.toLowerCase()}%`;

  const { results } = await base
    .prepare(
      `SELECT s.codigo, s.nombre, s.apellido, s.telefono_normal, s.estado,
              COALESCE((SELECT SUM(m.puntos) FROM movimientos m
                         WHERE m.socio_codigo = s.codigo), 0) AS saldo
         FROM socios s
        WHERE s.eliminado_en IS NULL
          AND (
            (? <> '' AND s.telefono_normal LIKE ?)
            OR LOWER(s.nombre || ' ' || s.apellido) LIKE ?
            OR s.codigo = ?
          )
        ORDER BY s.nombre LIMIT 20`,
    )
    .bind(digitos, `%${digitos}%`, como, q.toUpperCase())
    .all<{
      codigo: string;
      nombre: string;
      apellido: string;
      telefono_normal: string;
      estado: string;
      saldo: number;
    }>();

  return {
    filas: (results ?? []).map((f) => ({
      codigo: f.codigo,
      nombre: `${f.nombre} ${f.apellido}`.trim(),
      telefono: `****-${f.telefono_normal.slice(-4)}`,
      estado: f.estado,
      saldo: f.saldo,
    })),
  };
}

/**
 * Quién manda, para lo único que lo necesita: borrar una ficha del todo.
 *
 * Todo lo demás del panel lo puede hacer cualquiera que entre, porque la puerta
 * ya es Access y quien está detrás es el equipo. Lo que se separa aquí es lo
 * único que no se deshace.
 *
 * LA LISTA VACÍA DEJA ENTRAR A TODOS, y es deliberado: hoy detrás de Access hay
 * una sola persona, y un sistema que al desplegarse deja a su dueño sin poder
 * borrar nada no es más seguro, es más molesto. En cuanto entren las vendedoras
 * hay que poner los correos, y la pantalla lo recuerda mientras no estén.
 */
function esAdmin(correo: string, env: Env): boolean {
  const lista = (env.CORREOS_ADMIN ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (!lista.length) return true;
  return lista.includes(correo.trim().toLowerCase());
}

function exigirAdmin(correo: string, env: Env): void {
  if (esAdmin(correo, env)) return;
  throw new ErrorPeticion(
    403,
    'sin-permiso',
    'Borrar una ficha del todo no está a tu alcance. Pídeselo a quien administra el panel.',
  );
}

/**
 * Todo lo que se sabe de una persona, en una sola respuesta.
 *
 * Es la pantalla que responde de una vez las preguntas que antes obligaban a
 * mirar en cuatro sitios: quién es, qué compró, cuántos puntos tiene y de dónde
 * salieron, y a quién trajo.
 *
 * Va en una sola llamada y no en cuatro a propósito: la ficha se abre con el
 * cliente delante y cuatro viajes por una red de tienda son cuatro esperas.
 */
async function fichaEntera(base: D1Database, codigo: string) {
  const fila = await base
    .prepare(
      `SELECT codigo, nombre, apellido, telefono, telefono_normal, cedula, cedula_digitos,
              correo, correo_normal, cumple, direccion, notas, atendido_por, estado, pin_hash,
              referido_por, referido_pagado_en, terminos_version, creado_en, creado_por,
              actualizado_en, eliminado_en, eliminado_por
         FROM socios WHERE codigo = ?`,
    )
    .bind(codigo)
    .first<Parameters<typeof clientes.comoFicha>[0]>();

  if (!fila) throw new ErrorPeticion(404, 'no-encontrada', 'Esa ficha no existe.');

  const [saldo, bitacora, sus, susVentas, padrino, traidos] = await Promise.all([
    saldoDe(base, codigo),
    bitacoraDe(base, codigo),
    compras.deSocio(base, codigo),
    ventas.deCliente(base, codigo),
    socios.padrinoDe(base, codigo),
    base
      .prepare(
        `SELECT s.codigo, s.nombre, s.apellido, s.creado_en,
                EXISTS (SELECT 1 FROM compras c
                         WHERE c.socio_codigo = s.codigo AND c.anulada_en IS NULL AND c.puntos > 0) AS compro
           FROM socios s
          WHERE s.referido_por = ? AND s.eliminado_en IS NULL
          ORDER BY s.creado_en DESC LIMIT 50`,
      )
      .bind(codigo)
      .all<{ codigo: string; nombre: string; apellido: string; creado_en: string; compro: number }>(),
  ]);

  // Lo comprado se suma AQUÍ y no se guarda en ninguna columna, por lo mismo
  // que el saldo: una cifra guardada es una cifra que un día deja de cuadrar
  // con las filas que la explican.
  const dinero = await base
    .prepare(
      `SELECT COALESCE(SUM(monto_centavos), 0) AS total, COUNT(*) AS cuantas
         FROM compras WHERE socio_codigo = ? AND anulada_en IS NULL`,
    )
    .bind(codigo)
    .first<{ total: number; cuantas: number }>();

  return {
    cliente: clientes.comoFicha(fila),
    saldo,
    compradoCentavos: dinero?.total ?? 0,
    cuantasCompras: dinero?.cuantas ?? 0,
    bitacora: bitacora.filas,
    compras: sus,
    ventas: susVentas,
    padrino,
    traidos: (traidos.results ?? []).map((t) => ({
      codigo: t.codigo,
      nombre: `${t.nombre} ${t.apellido ?? ''}`.trim(),
      creadoEn: t.creado_en,
      compro: Boolean(t.compro),
    })),
  };
}

/** Los archivos, con las cabeceras de seguridad puestas. */
async function servirEstatico(peticion: Request, env: Env): Promise<Response> {
  const respuesta = await env.ASSETS.fetch(peticion);
  const tipo = respuesta.headers.get('Content-Type') ?? '';
  if (!tipo.includes('text/html')) return respuesta;

  const conCabeceras = new Response(respuesta.body, respuesta);
  for (const [nombre, valor] of Object.entries(cabecerasSeguridad())) {
    conCabeceras.headers.set(nombre, valor);
  }
  return conCabeceras;
}

/** La única captura. Convierte cualquier cosa lanzada en una respuesta. */
function convertirElFallo(error: unknown): Response {
  if (error instanceof SinAcceso) {
    // 401 y no 403: quien llega con un token que ya no sirve tiene que volver
    // a pasar por Access, y eso es lo que hace el navegador al recargar. Solo
    // se contesta esto cuando recargar PUEDE arreglarlo.
    if (error.motivo === 'sesion') {
      return fallo(
        401,
        'sin-sesion',
        'La sesión caducó. Recarga la página para volver a entrar.',
      );
    }

    // La otra mitad: la puerta está mal puesta, o no está delante de esta
    // dirección. Mandar a recargar aquí es mandar a repetir lo único que no
    // puede funcionar, y quien trabaja se queda dándole a F5 sin saber que el
    // fallo no es suyo. 503 y no 401 porque el que falla es el servidor: no
    // hay nada que quien llama pueda presentar para entrar.
    console.error('Puerta mal puesta:', error.message);
    return fallo(
      503,
      'puerta-mal-puesta',
      'El panel no puede comprobar quién entra: la puerta está mal puesta. ' +
        'Recargar no lo arregla. Hay que revisar la aplicación de Cloudflare Access ' +
        'y los valores de ACCESO_DOMINIO y ACCESO_AUD.' +
        (error.decible ? ` Lo que no cuadra: ${error.message}` : ''),
    );
  }

  if (error instanceof ErrorPeticion) {
    return fallo(error.http, error.codigo, error.message, error.detalle);
  }

  console.error(error);
  return fallo(500, 'fallo', 'Algo falló de nuestro lado. Vuelve a intentarlo.');
}
