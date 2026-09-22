/**
 * La app del socio: qué pantalla toca y quién está dentro.
 *
 * Sin framework y sin empaquetador, a propósito. Son seis pantallas con
 * formularios de tres campos; meter React para eso cuesta unos cuarenta
 * kilobytes que este público paga en datos móviles, desde La Chorrera y con un
 * teléfono modesto. El presupuesto lo vigila `scripts/construir.mjs`.
 */

import { api } from './api.js';
import {
  actividad,
  cargando,
  entrar,
  invita,
  miCanje,
  misCanjes,
  misPuntos,
  portada,
  premios,
  problema,
  registro,
} from './vistas.js';

const donde = document.getElementById('app');

/**
 * Lo que sabemos ahora mismo.
 *
 * `socio` es `null` mientras no haya sesión. `padrino` sobrevive a la
 * navegación porque el socio puede ir de la portada a «entrar», descubrir que
 * no tiene cuenta, y volver a «registro»: perder por el camino quién lo invitó
 * es perder el referido, que es lo único que este QR venía a hacer.
 */
const estado = { socio: null, saldo: 0, encendido: null, padrino: null };

const ir = (ruta) => {
  if (location.hash === ruta) pintar();
  else location.hash = ruta;
};

function poner(nodo) {
  donde.replaceChildren(nodo);
  // Cada pantalla empieza por arriba. Sin esto, al pasar de una lista larga a
  // un formulario corto se llega a mitad de página sin nada que ver.
  window.scrollTo({ top: 0 });
}

async function entrado(socio) {
  estado.socio = socio;
  estado.padrino = null;
  await refrescar();
  ir('#/puntos');
}

async function refrescar() {
  const datos = await api.yo();
  estado.socio = datos.socio;
  estado.saldo = datos.saldo;
  estado.encendido = datos.encendido;
}

async function salir() {
  try {
    await api.salir();
  } finally {
    estado.socio = null;
    estado.saldo = 0;
    ir('#/');
  }
}

async function pintar() {
  const ruta = location.hash || '#/';

  // Las pantallas con sesión: si no hay, se manda a entrar en vez de enseñar
  // una pantalla vacía que no explica nada.
  const necesitaSesion = ruta !== '#/' && ruta !== '#/entrar' && ruta !== '#/registro';
  if (necesitaSesion && !estado.socio) return ir('#/entrar');

  switch (ruta) {
    case '#/entrar':
      return poner(entrar({ ir, entrado }));

    case '#/registro':
      return poner(registro({ padrino: estado.padrino, ir, entrado }));

    case '#/puntos':
      return poner(misPuntos({ ...estado, ir, salir }));

    case '#/premios': {
      poner(cargando());
      try {
        const datos = await api.premios();
        return poner(
          premios({
            datos,
            ir,
            pedir: async (premio) => {
              const seguro = confirm(
                `¿Cambiar ${premio.puntos.toLocaleString('en-US')} puntos por «${premio.nombre}»?\n\n` +
                  'Los puntos salen ahora y tienes 72 horas para pasar por la tienda. ' +
                  'Si no vas, te los devolvemos.',
              );
              if (!seguro) return;
              try {
                const canje = await api.pedirPremio(premio.id);
                estado.saldo -= canje.puntos;
                ir(`#/canje/${canje.codigo}`);
              } catch (fallo) {
                poner(problema(fallo.mensaje ?? fallo.message, () => pintar()));
              }
            },
          }),
        );
      } catch (fallo) {
        return poner(problema(fallo.message, () => pintar()));
      }
    }

    case '#/mis-premios': {
      poner(cargando());
      try {
        const { canjes } = await api.canjes();
        return poner(misCanjes({ canjes, ir }));
      } catch (fallo) {
        return poner(problema(fallo.message, () => pintar()));
      }
    }

    case '#/invita': {
      poner(cargando());
      try {
        return poner(invita({ datos: await api.referidos(), ir }));
      } catch (fallo) {
        return poner(problema(fallo.message, () => pintar()));
      }
    }

    case '#/actividad': {
      poner(cargando());
      try {
        const { filas } = await api.actividad();
        return poner(actividad({ filas, ir }));
      } catch (fallo) {
        return poner(problema(fallo.message, () => pintar()));
      }
    }

    default: {
      const canje = /^#\/canje\/([^/]+)$/.exec(ruta);
      if (canje) {
        poner(cargando());
        try {
          const { canjes } = await api.canjes();
          const suyo = canjes.find((c) => c.codigo === decodeURIComponent(canje[1]));
          if (!suyo) return ir('#/mis-premios');
          return poner(
            miCanje({
              canje: suyo,
              ir,
              cancelar: async (c) => {
                if (!confirm('¿Cancelarlo? Te devolvemos los puntos enteros.')) return;
                try {
                  await api.cancelarCanje(c.codigo);
                  await refrescar();
                  ir('#/puntos');
                } catch (fallo) {
                  poner(problema(fallo.mensaje ?? fallo.message, () => pintar()));
                }
              },
            }),
          );
        } catch (fallo) {
          return poner(problema(fallo.message, () => pintar()));
        }
      }

      // Con sesión abierta, la portada no tiene nada que ofrecer: quien vuelve
      // al enlace del QR estando dentro quiere ver sus puntos.
      if (estado.socio) return ir('#/puntos');
      return poner(portada({ padrino: estado.padrino, ir }));
    }
  }
}

/**
 * El arranque.
 *
 * Dos cosas antes de pintar nada: si el enlace trae un código de referido, se
 * resuelve a un nombre; y se pregunta si ya hay sesión abierta. Lo segundo
 * puede fallar de mil formas —sin red, servidor caído— y ninguna es motivo
 * para dejar la pantalla en blanco: se sigue como si no hubiera sesión, que es
 * un estado del que el socio sí puede salir solo.
 */
async function arrancar() {
  const codigo = new URLSearchParams(location.search).get('r');

  if (codigo) {
    try {
      const { padrino } = await api.padrino(codigo);
      estado.padrino = padrino;
    } catch {
      // Un código que no se pudo resolver NO bloquea nada. Quien está en el
      // mostrador con la vendedora esperando no puede quedarse fuera porque su
      // cuñado le pasó mal el código.
    }
    // El código se quita de la barra de direcciones en cuanto se usa: si el
    // socio comparte el enlace de su navegador después de registrarse, estaría
    // repartiendo el código de OTRO en vez del suyo.
    history.replaceState(null, '', location.pathname + location.hash);
  }

  try {
    await refrescar();
  } catch {
    estado.socio = null;
  }

  // Si vino por un QR de referido y no tiene sesión, va directo al registro:
  // es lo que venía a hacer.
  if (!estado.socio && estado.padrino && !location.hash) {
    return ir('#/registro');
  }

  await pintar();
}

window.addEventListener('hashchange', pintar);

poner(cargando());
arrancar();
