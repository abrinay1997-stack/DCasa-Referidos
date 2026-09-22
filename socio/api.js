/**
 * Hablar con el servidor, y traducir sus fallos a algo que se pueda enseñar.
 *
 * Toda respuesta de error del Worker trae `{codigo, mensaje}` ya redactado en
 * español y en la voz de la marca (ver `compartido/api.ts`). Aquí NO se
 * reescribe ese texto: se enseña tal cual. Si un mensaje suena mal, se arregla
 * en el servidor, que es donde vive el único.
 *
 * El `codigo` sí se mira, porque decide qué OFRECER: volver a entrar, esperar,
 * o escribir por WhatsApp.
 */

export class FalloApi extends Error {
  constructor(codigo, mensaje, detalle) {
    super(mensaje);
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

async function pedir(ruta, opciones = {}) {
  let respuesta;
  try {
    respuesta = await fetch(ruta, {
      headers: { 'Content-Type': 'application/json' },
      ...opciones,
    });
  } catch {
    // Sin conexión. Es lo más probable de todo en un móvil con datos en La
    // Chorrera, así que tiene su propio mensaje en vez de caer en el genérico.
    throw new FalloApi('sin-red', 'No hay conexión. Revisa tus datos y vuelve a intentarlo.');
  }

  if (respuesta.status === 204) return null;

  let cuerpo;
  try {
    cuerpo = await respuesta.json();
  } catch {
    throw new FalloApi('fallo', 'Algo falló de nuestro lado. Vuelve a intentarlo.');
  }

  if (!respuesta.ok) {
    throw new FalloApi(cuerpo.codigo ?? 'fallo', cuerpo.mensaje ?? 'Algo falló.', cuerpo.detalle);
  }
  return cuerpo;
}

const json = (ruta, cuerpo) =>
  pedir(ruta, { method: 'POST', body: JSON.stringify(cuerpo) });

export const api = {
  yo: () => pedir('/api/socio/yo'),
  registro: (datos) => json('/api/socio/registro', datos),
  entrar: (telefono, pin) => json('/api/socio/entrar', { telefono, pin }),
  salir: () => json('/api/socio/salir', {}),
  actividad: (desde = 0) => pedir(`/api/socio/actividad?desde=${desde}`),
  padrino: (codigo) => pedir(`/api/socio/padrino?r=${encodeURIComponent(codigo)}`),
};

/** `1250` → `1,250`. Los puntos no llevan decimales nunca. */
export const comoPuntos = (n) => Number(n).toLocaleString('en-US');

/** Una fecha ISO, como la lee alguien en Panamá. */
export function comoFecha(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-PA', { day: 'numeric', month: 'long', year: 'numeric' });
}
