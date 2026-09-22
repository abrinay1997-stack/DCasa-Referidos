/**
 * Hablar con la API del panel.
 *
 * Todo cuelga de `/panel/api/`, igual que esta pantalla cuelga de `/panel/`, y
 * es lo que permite que UNA sola aplicación de Cloudflare Access cubra las dos
 * con una regla de ruta. Ver la cabecera de `worker/index.ts`.
 */

export class Fallo extends Error {
  constructor(codigo, mensaje, detalle) {
    super(mensaje);
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

async function pedir(ruta, opciones = {}) {
  let r;
  try {
    r = await fetch(`/panel/api/${ruta}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opciones,
    });
  } catch {
    throw new Fallo('sin-red', 'Sin conexión. Revisa la señal y vuelve a intentarlo.');
  }

  let cuerpo;
  try {
    cuerpo = await r.json();
  } catch {
    // 401 sin JSON es Access devolviendo su propia pantalla de inicio de
    // sesión: la sesión del equipo caducó y hay que recargar para volver a
    // pasar por la puerta.
    if (r.status === 401) {
      throw new Fallo('sin-sesion', 'Tu sesión caducó. Recarga la página para volver a entrar.');
    }
    throw new Fallo('fallo', 'Algo falló de nuestro lado.');
  }

  if (!r.ok) throw new Fallo(cuerpo.codigo ?? 'fallo', cuerpo.mensaje ?? 'Algo falló.', cuerpo.detalle);
  return cuerpo;
}

const post = (ruta, cuerpo) => pedir(ruta, { method: 'POST', body: JSON.stringify(cuerpo ?? {}) });

export const api = {
  yo: () => pedir('yo'),
  buscarSocios: (q) => pedir(`socios?q=${encodeURIComponent(q)}`),
  socio: (codigo) => pedir(`socios/${encodeURIComponent(codigo)}`),
  altaSocio: (datos) => post('socios', datos),
  reiniciarPin: (codigo) => post(`socios/${encodeURIComponent(codigo)}/reiniciar-pin`),
  desbloquear: (codigo) => post(`socios/${encodeURIComponent(codigo)}/desbloquear`),
  ajustar: (codigo, puntos, motivo) => post(`socios/${encodeURIComponent(codigo)}/ajuste`, { puntos, motivo }),
  calcular: (socio, montoCentavos) => post('compras/calcular', { socio, montoCentavos }),
  registrarCompra: (datos) => post('compras', datos),
  anularCompra: (id, motivo) => post(`compras/${encodeURIComponent(id)}/anular`, { motivo }),
};

/**
 * `$1,070.00` escrito por una persona → `107000` centavos enteros.
 *
 * Se parte la cadena por la coma decimal en vez de multiplicar por 100 en coma
 * flotante: `19.99 * 100` da `1998.9999999999998`, y redondearlo funciona hasta
 * el día que no. Aquí lo que se teclea es dinero de verdad.
 */
export function aCentavos(texto) {
  const limpio = String(texto ?? '').replace(/[^\d.,]/g, '').replace(',', '.');
  if (!limpio) return NaN;

  const partes = limpio.split('.');
  if (partes.length > 2) return NaN;

  const enteros = partes[0] || '0';
  const decimales = (partes[1] ?? '').padEnd(2, '0').slice(0, 2);
  const centavos = Number(enteros) * 100 + Number(decimales);
  return Number.isFinite(centavos) ? centavos : NaN;
}

export const comoDolares = (centavos) => {
  const signo = centavos < 0 ? '-' : '';
  const e = Math.floor(Math.abs(centavos) / 100);
  const c = String(Math.abs(centavos) % 100).padStart(2, '0');
  return `${signo}$${e.toLocaleString('en-US')}.${c}`;
};

export const comoPuntos = (n) => Number(n).toLocaleString('en-US');

export const comoFecha = (iso) =>
  new Date(iso).toLocaleDateString('es-PA', { day: 'numeric', month: 'short', year: 'numeric' });
