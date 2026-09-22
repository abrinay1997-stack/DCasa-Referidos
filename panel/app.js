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
  problema,
  reportes,
} from './vistas.js';
import { comprobante, historialVentas, nuevaVenta, ponerReglas } from './facturas.js';
import { editarCliente, fichaCliente, libreta } from './clientes.js';

const donde = document.getElementById('app');
const quien = document.getElementById('quien');

const estado = { correo: null, encendido: null, admin: false, adminSinLista: false };

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
        'Nueva venta',
        'Los artículos, el ITBMS y el total. Sale el comprobante y los puntos caen solos.',
        '#/venta',
      ),
      tarjeta('Clientes', 'Quién es, qué compró, cuántos puntos tiene y a quién trajo.', '#/clientes'),
      tarjeta('Ventas', 'Los comprobantes emitidos. Se reimprimen y se anulan.', '#/ventas'),
      tarjeta(
        'Solo sumar puntos',
        'Sin detallar los artículos: la factura y el monto, y ya. Para lo que se cargue después.',
        '#/compra',
      ),
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

  // `#/socios` era una SEGUNDA puerta a la misma gente: otro buscador que
  // llevaba a otra pantalla del mismo cliente. Con dos listas, una vendedora
  // que busca a alguien acaba en una u otra según por dónde entró, y desde una
  // no se llega a lo de la otra. Ahora hay una sola lista, y el PIN y los
  // ajustes cuelgan de la ficha del cliente.
  //
  // La ruta sigue atendida porque puede estar guardada en el navegador de
  // alguien: lleva a donde ahora se hace eso.
  if (ruta === '#/socios') return ir('#/clientes');

  // --- La facturería ---
  if (ruta === '#/venta' || ruta.startsWith('#/venta?')) {
    // `#/venta?cliente=DCA…` llega desde la ficha: la venta se abre con esa
    // persona ya puesta, que es el viaje que ahorra el botón «Venderle».
    const codigo = new URLSearchParams(ruta.split('?')[1] ?? '').get('cliente');
    if (!codigo) return poner(nuevaVenta({ ir, encendido: estado.encendido }));
    poner(cargando());
    try {
      const datos = await api.cliente(codigo);
      return poner(
        nuevaVenta({
          ir,
          encendido: estado.encendido,
          prefijado: {
            codigo: datos.cliente.codigo,
            nombre: `${datos.cliente.nombre} ${datos.cliente.apellido}`.trim(),
            saldo: datos.saldo,
          },
        }),
      );
    } catch (fallo) {
      return poner(problema(fallo.message, () => pintar()));
    }
  }

  if (ruta === '#/ventas') return poner(historialVentas({ ir }));

  const verVenta = /^#\/venta\/([^/?]+)$/.exec(ruta);
  if (verVenta) {
    poner(cargando());
    try {
      const datos = await api.venta(decodeURIComponent(verVenta[1]));
      return poner(comprobante({ datos, ir, admin: estado.admin }));
    } catch (fallo) {
      return poner(problema(fallo.message, () => pintar()));
    }
  }

  // --- La libreta ---
  if (ruta === '#/clientes') {
    return poner(libreta({ ir, admin: estado.admin, adminSinLista: estado.adminSinLista }));
  }

  const editar = /^#\/cliente\/([^/]+)\/editar$/.exec(ruta);
  if (editar) {
    poner(cargando());
    try {
      const datos = await api.cliente(decodeURIComponent(editar[1]));
      return poner(editarCliente({ datos, ir, recargar: () => pintar() }));
    } catch (fallo) {
      return poner(problema(fallo.message, () => pintar()));
    }
  }

  const verCliente = /^#\/cliente\/([^/]+)$/.exec(ruta);
  if (verCliente) {
    poner(cargando());
    try {
      const datos = await api.cliente(decodeURIComponent(verCliente[1]));
      return poner(fichaCliente({ datos, ir, recargar: () => pintar(), admin: estado.admin }));
    } catch (fallo) {
      return poner(problema(fallo.message, () => pintar()));
    }
  }

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
    estado.admin = Boolean(datos.admin);
    estado.adminSinLista = Boolean(datos.adminSinLista);
    // Las cifras con las que la pantalla de venta anticipa el total y los
    // puntos. Vienen de aquí y no están escritas en el panel: regla 1.
    ponerReglas(datos.reglas);
    quien.textContent = datos.correo;
  } catch (fallo) {
    quien.textContent = '';
    return poner(problema(fallo.message, () => arrancar()));
  }
  await pintar();
}

window.addEventListener('hashchange', pintar);
arrancar();
