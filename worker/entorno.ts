/**
 * Lo que Cloudflare le pasa al Worker.
 *
 * En un archivo propio porque lo miran todos los módulos, y tenerlo dentro de
 * uno obligaría a los demás a importar de ahí solo por un tipo.
 */

export interface Env {
  BASE: D1Database;
  ASSETS: Fetcher;

  /** El dominio del equipo en Access: `algo.cloudflareaccess.com`. */
  ACCESO_DOMINIO: string;
  /** El «Application Audience (AUD) Tag» de la aplicación en Access. */
  ACCESO_AUD: string;

  /**
   * La clave con la que se firma la cookie de sesión del socio.
   *
   * Es un SECRETO del Worker (`wrangler secret put SECRETO_SESION`), no una
   * variable de `wrangler.jsonc`: con ella cualquiera se fabrica una sesión a
   * nombre de cualquier socio.
   */
  SECRETO_SESION: string;

  /**
   * La pimienta que se concatena al PIN antes de derivar el hash.
   *
   * Vive fuera de la base a propósito. Un PIN son seis dígitos —un millón de
   * combinaciones— y eso se rompe por fuerza bruta en segundos contra un
   * volcado de la base robado. Con la pimienta fuera, ese volcado no sirve de
   * nada sin haberse llevado también el secreto del Worker.
   *
   * NO SE ROTA A LA LIGERA: cambiarla invalida todos los PIN existentes de
   * golpe y deja a todos los socios fuera. Si algún día hay que rotarla, se
   * hace con re-derivación al siguiente acceso correcto, no de un tirón.
   */
  PIMIENTA_PIN: string;

  /**
   * `desarrollo` salta la comprobación de Access en `/panel/`. **Nunca en
   * producción**: sin ella, el panel queda abierto a quien dé con la dirección.
   */
  MODO?: string;

  /** Con quién se firma lo que se haga en el panel durante `npm run dev`. */
  CORREO_DESARROLLO?: string;

  /**
   * Quién puede borrar definitivamente una ficha, separado por comas.
   *
   * Vacío significa «cualquiera que entre al panel», que es lo correcto
   * mientras detrás de Access haya una sola persona y lo dejará de ser en
   * cuanto entren las vendedoras. El panel lo avisa en pantalla mientras siga
   * vacío. Ver `wrangler.jsonc`.
   */
  CORREOS_ADMIN?: string;
}
