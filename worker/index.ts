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
  if (ruta === 'yo' && peticion.method === 'GET') return json({ correo });

  // Fase 2 en adelante: socios, compras, canjes, premios y reportes.
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

  // Un latido para poder comprobar desde fuera que el Worker está vivo sin
  // tocar la base ni revelar nada de nadie.
  if (ruta === 'salud' && peticion.method === 'GET') {
    return json({ estado: 'en pie', zona: 'socio' });
  }

  // Fase 2 en adelante: registro, entrar, yo, actividad, premios, canjes.
  throw new ErrorPeticion(404, 'no-encontrada', 'Esa dirección no existe.');
}

// ---------------------------------------------------------------------------

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
