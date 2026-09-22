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
  referidos: () => pedir('/api/socio/referidos'),
  premios: () => pedir('/api/socio/premios'),
  terminos: () => pedir('/api/terminos'),
  canjes: () => pedir('/api/socio/canjes'),
  pedirPremio: (premio) => json('/api/socio/canjes', { premio }),
  cancelarCanje: (codigo) => json(`/api/socio/canjes/${encodeURIComponent(codigo)}/cancelar`, {}),
  padrino: (codigo) => pedir(`/api/socio/padrino?r=${encodeURIComponent(codigo)}`),
};

/** `500` → `$5.00`. Lo que vale un premio, para que el socio lo compare. */
export const comoDolares = (centavos) => {
  const e = Math.floor(Math.abs(centavos) / 100);
  const c = String(Math.abs(centavos) % 100).padStart(2, '0');
  return `$${e.toLocaleString('en-US')}.${c}`;
};

/**
 * Cuánto le queda a un código antes de vencer.
 *
 * En horas y no en «vence el 24/09 a las 15:04»: el socio quiere saber si le da
 * tiempo de pasar hoy, no la hora exacta.
 */
export function cuantoLeQueda(expiraEn) {
  const horas = Math.ceil((new Date(expiraEn).getTime() - Date.now()) / 3600_000);
  if (horas <= 0) return 'Ya venció';
  if (horas === 1) return 'Queda 1 hora';
  if (horas < 24) return `Quedan ${horas} horas`;
  const dias = Math.ceil(horas / 24);
  return dias === 1 ? 'Queda 1 día' : `Quedan ${dias} días`;
}

/** `1250` → `1,250`. Los puntos no llevan decimales nunca. */
export const comoPuntos = (n) => Number(n).toLocaleString('en-US');

/** Una fecha ISO, como la lee alguien en Panamá. */
export function comoFecha(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-PA', { day: 'numeric', month: 'long', year: 'numeric' });
}
