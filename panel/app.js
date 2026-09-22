/**
 * El panel del equipo: qué pantalla toca.
 *
 * Sin framework, por lo mismo que la app del socio: son cuatro pantallas y las
 * vendedoras lo van a abrir desde el móvil en la tienda, con la señal que haya.
 */

import { api } from './api.js';
import {
  cargando,
  el,
  ficha,
  nuevaCompra,
  pantallaCanjes,
  pantallaSocios,
  problema,
  reportes,
} from './vistas.js';

const donde = document.getElementById('app');
const quien = document.getElementById('quien');

const estado = { correo: null, encendido: null };

const ir = (ruta) => {
  if (location.hash === ruta) pintar();
  else location.hash = ruta;
};

function poner(nodo) {
  donde.replaceChildren(nodo);
  window.scrollTo({ top: 0 });
}

function portada() {
  const tarjeta = (titulo, texto, ruta, listo = true) =>
    el(listo ? 'button' : 'div', {
      clase: `atajo${listo ? '' : ' pendiente'}`,
      onclick: listo ? () => ir(ruta) : null,
    }, [
      el('span', { clase: 'titulo', texto: titulo }),
      el('span', { clase: 'texto', texto }),
    ]);

  return el('div', {}, [
    el('div', { clase: 'rejilla' }, [
      tarjeta(
        'Registrar una compra',
        'Busca al socio, teclea la factura y el monto, y súmale los puntos ahí mismo.',
        '#/compra',
      ),
      tarjeta('Socios', 'Busca, mira su ficha, reinicia un PIN, ajusta sus puntos.', '#/socios'),
      tarjeta('Entregar un premio', 'Teclea el código que trae el socio y entrégaselo.', '#/canjes'),
      tarjeta('Reportes', 'Cuánto debe el programa, quién trae gente y qué emite cada vendedora.', '#/reportes'),
    ]),

    // El aviso solo aparece mientras la economía esté sin definir. Cuando
    // Marcial responda, desaparece solo: sale de lo que dice el servidor, no de
    // una fecha ni de una bandera que alguien tenga que acordarse de apagar.
    !estado.encendido?.compras
      ? el('div', { clase: 'tarjeta nota-grande' }, [
          el('h2', { texto: 'Antes de que esto sirva para algo' }),
          el('p', {
            texto:
              'El programa no puede acreditar un solo punto hasta que se defina cuántos ' +
              'puntos da cada dólar y si se calculan sobre el total o sobre el subtotal ' +
              'sin ITBMS. Son decisiones del dueño, no del código: mientras tanto, dar de ' +
              'alta socios sí funciona y todo queda guardado.',
          }),
        ])
      : null,
  ]);
}

async function pintar() {
  const ruta = location.hash || '#/';

  if (ruta === '#/compra') {
    return poner(nuevaCompra({ ir, encendido: estado.encendido }));
  }

  if (ruta === '#/socios') return poner(pantallaSocios({ ir }));

  if (ruta === '#/canjes') return poner(pantallaCanjes({ ir }));

  if (ruta === '#/reportes') {
    poner(cargando());
    try {
      return poner(reportes({ datos: await api.reportes(), ir }));
    } catch (fallo) {
      return poner(problema(fallo.message, () => pintar()));
    }
  }

  const detalle = /^#\/socio\/([^/]+)$/.exec(ruta);
  if (detalle) {
    poner(cargando());
    const codigo = decodeURIComponent(detalle[1]);
    try {
      const datos = await api.socio(codigo);
      return poner(ficha({ datos, ir, recargar: () => pintar() }));
    } catch (fallo) {
      return poner(problema(fallo.message, () => pintar()));
    }
  }

  return poner(portada());
}

async function arrancar() {
  poner(cargando());
  try {
    const datos = await api.yo();
    estado.correo = datos.correo;
    estado.encendido = datos.encendido;
    quien.textContent = datos.correo;
  } catch (fallo) {
    quien.textContent = '';
    return poner(problema(fallo.message, () => arrancar()));
  }
  await pintar();
}

window.addEventListener('hashchange', pintar);
arrancar();
