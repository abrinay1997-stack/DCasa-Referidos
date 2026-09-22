/**
 * Las cabeceras de seguridad del HTML, en un solo sitio.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTO NO VIVE DENTRO DEL WORKER
 *
 * Porque el Worker no ve la mayoría de las respuestas que tienen que llevarlas.
 *
 * `assets.run_worker_first` está limitado a `/panel/*` (ver `wrangler.jsonc`),
 * así que la app del socio —que es justo la parte pública, la que abre
 * cualquiera con el enlace del QR, la única donde un navegador cualquiera
 * ejecuta nuestro HTML— se sirve desde el borde SIN pasar por el Worker. Una
 * función del Worker que añada cabeceras no llega a correr ahí.
 *
 * Se descubrió pidiendo `/` en `wrangler dev` y mirando la respuesta: venía sin
 * una sola cabecera. El Worker las ponía perfectamente en el 0 % de las
 * peticiones que importaban.
 *
 * La salida NO es encender `run_worker_first` para todo: eso cobra una
 * invocación por archivo servido a cada cliente y no protege nada que no
 * proteja un `_headers`. Así que se declaran aquí una vez y de aquí salen las
 * dos copias:
 *
 *   · `scripts/construir.mjs` las escribe en `publico/_headers`, que es lo que
 *     Cloudflare aplica a los archivos estáticos desde el borde.
 *   · `worker/http.ts` las pone en lo que sí genera el Worker.
 *
 * Si se cambian, se cambian aquí y las dos copias se rehacen solas.
 * ---------------------------------------------------------------------------
 */

export const CABECERAS_SEGURIDAD: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    // Sin `unsafe-inline`: todo el JavaScript vive en archivos. Por eso el
    // panel carga `quien.js` en vez de llevar un <script> dentro.
    "script-src 'self'",
    // Google Fonts sirve la hoja desde un dominio y los archivos desde otro.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};
