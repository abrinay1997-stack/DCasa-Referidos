/**
 * La libreta de clientes y la ficha de cada uno.
 *
 * ---------------------------------------------------------------------------
 * UN CLIENTE Y UN SOCIO SON LA MISMA FICHA
 *
 * El porqué entero está en `migraciones/0005_ficha.sql`. En pantalla se traduce
 * en una sola cosa: la ficha dice si está RECLAMADA o no. Reclamada significa
 * que esa persona puso un PIN y ve sus puntos desde el teléfono; sin reclamar
 * significa que compró y sus puntos la esperan.
 *
 * Esa distinción vale dinero, y por eso la libreta se puede filtrar por ella:
 * «los que tienen puntos esperando y no lo saben» es la mejor lista de llamadas
 * que puede tener una tienda.
 */

import { api, comoDolares, comoFecha, comoPuntos } from './api.js';
import { el, campo, aviso, alEnviar, rellenar } from './vistas.js';
import { ayuda } from '../hub/ayuda.js';
import { paginador } from './facturas.js';
import { selectorDeCumple, cumpleEnPalabras } from '../hub/cumple.js';

// ---------------------------------------------------------------------------
// La libreta
// ---------------------------------------------------------------------------

export function libreta({ ir, admin, adminSinLista }) {
  const pantalla = el('div', {});
  const lista = el('div', { clase: 'tarjeta' });

  const filtro = { texto: '', reclamadas: '', papelera: false, pagina: 1 };
  let temporizador;

  const entrada = el('input', {
    id: 'q',
    type: 'search',
    placeholder: 'Nombre, celular, cédula, correo o código',
    autocomplete: 'off',
  });
  entrada.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      filtro.texto = entrada.value.trim();
      filtro.pagina = 1;
      cargar();
    }, 250);
  });

  const pestana = (texto, valor, clave) =>
    el('button', {
      clase: `pestana${filtro[clave] === valor ? ' puesta' : ''}`,
      type: 'button',
      texto,
      onclick: () => {
        filtro[clave] = valor;
        filtro.pagina = 1;
        pintarFiltros();
        cargar();
      },
    });

  const cajaFiltros = el('div', { clase: 'pestanas' });

  function pintarFiltros() {
    // Dentro de la papelera los otros filtros no se enseñan: allí no hay
    // «sin reclamar» que valga nada, y dejarlos puestos invita a creer que la
    // lista vacía es un fallo cuando es el filtro.
    if (filtro.papelera) {
      return rellenar(
        cajaFiltros,
        el('button', {
          clase: 'pestana puesta',
          type: 'button',
          texto: '← Volver a la lista',
          onclick: () => {
            filtro.papelera = false;
            filtro.pagina = 1;
            pintarFiltros();
            cargar();
          },
        }),
      );
    }

    rellenar(
      cajaFiltros,
      pestana('Todos', '', 'reclamadas'),
      // Esta es la lista que vale dinero: gente con puntos esperando que no
      // sabe que los tiene.
      pestana('Sin reclamar', 'no', 'reclamadas'),
      pestana('En el programa', 'si', 'reclamadas'),
      pestana('Papelera', true, 'papelera'),
    );
  }

  async function cargar() {
    rellenar(lista, el('p', { clase: 'nota', texto: 'Un momento…' }));
    const p = new URLSearchParams();
    if (filtro.texto) p.set('q', filtro.texto);
    if (filtro.reclamadas) p.set('reclamadas', filtro.reclamadas);
    if (filtro.papelera) p.set('papelera', 'si');
    p.set('pagina', String(filtro.pagina));

    try {
      const r = await api.clientes(`?${p}`);
      if (!r.clientes.length) {
        return rellenar(lista, 
          el('p', {
            clase: 'nota vacio',
            texto: filtro.papelera
              ? 'La papelera está vacía.'
              : filtro.texto
                ? 'No aparece nadie con eso.'
                : 'Todavía no hay clientes. El primero entra con la primera venta.',
          }),
        );
      }

      rellenar(lista, 
        ...r.clientes.map((c) =>
          el('button', { clase: 'resultado', type: 'button', onclick: () => ir(`#/cliente/${c.codigo}`) }, [
            el('span', { clase: 'nombre', texto: c.nombre }),
            el('span', {
              clase: 'meta',
              texto:
                `${c.codigo} · ${c.telefono}` +
                (c.compras ? ` · ${comoDolares(c.compradoCentavos)} en ${c.compras} compra(s)` : ' · sin compras'),
            }),
            el('span', { clase: 'meta', texto: `${comoPuntos(c.saldo)} puntos` }),
            c.reclamada
              ? null
              : el('span', { clase: 'marca suave', texto: c.saldo > 0 ? 'Puntos esperando' : 'Sin reclamar' }),
            c.estado === 'suspendido' ? el('span', { clase: 'marca', texto: 'Suspendida' }) : null,
          ]),
        ),
        paginador(r, (n) => {
          filtro.pagina = n;
          cargar();
        }),
      );
    } catch (fallo) {
      rellenar(lista, aviso(fallo.message));
    }
  }

  pintarFiltros();

  rellenar(pantalla, 
    el('h1', { texto: 'Clientes' }),
    el('div', { clase: 'tarjeta' }, [
      el('label', { clase: 'campo', for: 'q' }, [
        el('span', { clase: 'etiqueta', texto: 'Buscar' }),
        entrada,
      ]),
      cajaFiltros,
    ]),
    lista,
    el('button', { clase: 'boton secundario', type: 'button', texto: 'Volver', onclick: () => ir('#/') }),
    // Abajo, y no arriba: es un recordatorio para cuando crezca el equipo, no
    // algo que haya que leer antes de buscar a un cliente.
    adminSinLista && admin ? avisoSinAdmin() : null,
  );

  cargar();
  return pantalla;
}

/**
 * El recordatorio de que la lista de quién manda está vacía.
 *
 * Mientras `CORREOS_ADMIN` no tenga a nadie, cualquiera que entre al panel
 * puede borrar una ficha del todo. Hoy es correcto porque detrás de Access hay
 * una sola persona. El día que entren las vendedoras dejará de serlo, y ese es
 * justo el día en que nadie se va a acordar de esto: por eso lo dice la
 * pantalla y no un comentario en un archivo.
 */
function avisoSinAdmin() {
  return el('p', { clase: 'nota recordatorio' }, [
    document.createTextNode('Cualquiera que entre a este panel puede borrar un cliente para siempre.'),
    ayuda(
      'Está bien mientras seas el único que entra. Cuando entren las vendedoras hay que ' +
        'poner los correos de quien sí pueda borrar en CORREOS_ADMIN, dentro de ' +
        'wrangler.jsonc, y volver a publicar. Este recordatorio desaparece solo cuando esa ' +
        'lista deje de estar vacía.',
      { etiqueta: 'Qué hay que hacer' },
    ),
  ]);
}

// ---------------------------------------------------------------------------
// La ficha entera
// ---------------------------------------------------------------------------

/**
 * Todo lo que se sabe de una persona, en una pantalla.
 *
 * El orden responde a cómo se usa: arriba quién es y cómo se le llama —que es
 * lo que se necesita con el teléfono en la mano—, luego las cifras, luego lo
 * que compró, y al final lo que se puede hacerle. Las acciones van abajo
 * porque son las que no se deshacen.
 */
export function fichaCliente({ datos, ir, recargar, admin }) {
  const c = datos.cliente;
  const nombre = `${c.nombre} ${c.apellido}`.trim();

  return el('div', {}, [
    c.eliminadoEn
      ? el('div', { clase: 'tarjeta nota-grande' }, [
          el('h2', { texto: 'Este cliente está en la papelera' }),
          el('p', {}, [
            document.createTextNode(
              `Lo quitó ${c.eliminadoPor ?? 'alguien'} el ${comoFecha(c.eliminadoEn)}. Lo que compró sigue guardado.`,
            ),
          ]),
          el('button', {
            clase: 'boton',
            type: 'button',
            texto: 'Devolverlo a la lista',
            onclick: async () => {
              await api.restaurarCliente(c.codigo);
              recargar();
            },
          }),
        ])
      : null,

    el('div', { clase: 'tarjeta' }, [
      el('p', { clase: 'antetitulo', texto: c.codigo }),
      el('h1', { texto: nombre }),
      c.reclamada
        ? el('p', { clase: 'nota', texto: 'Está en el programa: ve sus puntos desde el teléfono.' })
        : el('p', { clase: 'aviso bueno', role: 'status', texto:
            datos.saldo > 0
              ? `Tiene ${comoPuntos(datos.saldo)} puntos esperando y todavía no lo sabe. Dile que escanee el QR.`
              : 'Todavía no ha entrado al programa.' }),

      el('div', { clase: 'datos' }, [
        renglonDato('Celular', c.telefono),
        c.cedula ? renglonDato('Cédula / RUC', c.cedula) : null,
        c.correo ? renglonDato('Correo', c.correo) : null,
        c.direccion ? renglonDato('Dirección', c.direccion) : null,
        c.cumple ? renglonDato('Cumpleaños', cumpleEnPalabras(c.cumple)) : null,
        c.atendidoPor ? renglonDato('Lo atiende', c.atendidoPor.split('@')[0]) : null,
        renglonDato('Cliente desde', comoFecha(c.creadoEn)),
        datos.padrino ? renglonDato('Lo invitó', datos.padrino.nombre) : null,
      ]),
      c.notas ? el('p', { clase: 'notas-ficha', texto: c.notas }) : null,
    ]),

    el('div', { clase: 'cifras' }, [
      cifra('Ha comprado', comoDolares(datos.compradoCentavos), `en ${datos.cuantasCompras} compra(s)`),
      cifra('Puntos', comoPuntos(datos.saldo), `${comoDolares(datos.saldo)} en premios`),
    ]),

    el('div', { clase: 'tarjeta' }, [
      el('h2', { texto: 'Acciones' }),
      el('div', { clase: 'rejilla chica' }, [
        el('button', {
          clase: 'boton',
          type: 'button',
          texto: 'Venderle',
          onclick: () => ir(`#/venta?cliente=${c.codigo}`),
        }),
        el('button', {
          clase: 'boton secundario',
          type: 'button',
          texto: 'Corregir sus datos',
          onclick: () => ir(`#/cliente/${c.codigo}/editar`),
        }),
        el('button', {
          clase: 'boton secundario',
          type: 'button',
          texto: 'Su PIN y sus puntos',
          onclick: () => ir(`#/socio/${c.codigo}`),
        }),
      ]),
    ]),

    listaDe('Sus ventas', datos.ventas, (v) =>
      el('button', { clase: 'resultado', type: 'button', onclick: () => ir(`#/venta/${v.numero}`) }, [
        el('span', { clase: 'nombre', texto: `${v.numero} · ${comoDolares(v.totalCentavos)}` }),
        el('span', { clase: 'meta', texto: `${comoFecha(v.emitidaEn)} · factura ${v.facturaFiscal} · ${comoPuntos(v.puntos)} pts` }),
        v.anulada ? el('span', { clase: 'marca', texto: 'Anulado' }) : null,
      ]),
    'Todavía no se le ha emitido ningún comprobante.'),

    // Las compras cargadas a mano, las que no vinieron de una venta de aquí.
    // Salen aparte porque son de antes de la facturería y siguen contando.
    listaDe(
      'Compras cargadas a mano',
      datos.compras.filter((k) => !datos.ventas.some((v) => v.facturaFiscal === k.factura)),
      (k) =>
        el('div', { clase: 'resultado sin-pulsar' }, [
          el('span', { clase: 'nombre', texto: `${comoDolares(k.montoCentavos)} · factura ${k.factura}` }),
          el('span', { clase: 'meta', texto: `${comoFecha(k.registradaEn)} · ${comoPuntos(k.puntos)} pts` }),
          k.anulada ? el('span', { clase: 'marca', texto: 'Anulada' }) : null,
        ]),
      null,
    ),

    listaDe('A quién ha invitado', datos.traidos, (t) =>
      el('button', { clase: 'resultado', type: 'button', onclick: () => ir(`#/cliente/${t.codigo}`) }, [
        el('span', { clase: 'nombre', texto: t.nombre }),
        el('span', { clase: 'meta', texto: t.compro ? 'Ya compró' : 'Todavía no ha comprado' }),
      ]),
    null),

    el('div', { clase: 'tarjeta' }, [
      el('h2', { texto: 'Sus puntos, uno por uno' }),
      ...(datos.bitacora.length
        ? datos.bitacora.slice(0, 20).map((m) =>
            el('div', { clase: 'movimiento' }, [
              el('span', { clase: 'mov-cuando', texto: comoFecha(m.ocurridoEn) }),
              el('span', { clase: 'mov-que', texto: m.motivo || m.tipo }),
              el('span', { clase: `mov-cuanto ${m.puntos < 0 ? 'menos' : 'mas'}`, texto: `${m.puntos > 0 ? '+' : ''}${comoPuntos(m.puntos)}` }),
            ]),
          )
        : [el('p', { clase: 'nota vacio', texto: 'Todavía no tiene movimientos.' })]),
    ]),

    c.eliminadoEn ? null : zonaPeligro(c, ir, recargar),
    c.eliminadoEn && admin ? borradoDefinitivo(c, ir) : null,

    el('button', { clase: 'boton secundario', type: 'button', texto: 'Volver a clientes', onclick: () => ir('#/clientes') }),
  ]);
}

function renglonDato(que, cuanto) {
  return el('div', { clase: 'dato' }, [
    el('span', { clase: 'dato-que', texto: que }),
    el('span', { clase: 'dato-cuanto', texto: cuanto }),
  ]);
}

function cifra(titulo, valor, unidad) {
  return el('div', { clase: 'cifra' }, [
    el('span', { clase: 'cifra-titulo', texto: titulo }),
    el('span', { clase: 'cifra-valor', texto: valor }),
    unidad ? el('span', { clase: 'cifra-unidad', texto: unidad }) : null,
  ]);
}

/** Una sección de lista, que no se pinta si está vacía y no hay qué decir. */
function listaDe(titulo, filas, comoFila, siVacia) {
  if (!filas.length && !siVacia) return null;
  return el('div', { clase: 'tarjeta' }, [
    el('h2', { texto: titulo }),
    ...(filas.length ? filas.map(comoFila) : [el('p', { clase: 'nota vacio', texto: siVacia })]),
  ]);
}

/**
 * Retirar a la papelera.
 *
 * Se dice lo que NO se lleva por delante, que es lo que hace que alguien se
 * atreva a usarlo: las ventas, las compras y los puntos se quedan donde están.
 */
function zonaPeligro(c, ir, recargar) {
  const caja = el('div', { clase: 'tarjeta peligro' });

  const pintar = () =>
    rellenar(caja, 
      el('h2', { texto: 'Quitar de la lista' }),
      el('p', { clase: 'nota' }, [
        document.createTextNode('Deja de salir en las listas. No se borra nada de lo que compró.'),
        ayuda(
          'Sus comprobantes, sus compras y sus puntos siguen guardados igual, y las cifras de ' +
            'Reportes no cambian. Lo único que pasa es que no sale en las listas y no puede ' +
            'entrar a su cuenta. Si vuelve a la tienda, se devuelve a la lista desde la ' +
            'papelera y se encuentra su saldo intacto.',
          { etiqueta: 'Qué pasa con lo que compró' },
        ),
      ]),
      el('button', {
        clase: 'boton peligro',
        type: 'button',
        texto: 'Quitar de la lista',
        onclick: () => confirmar(),
      }),
    );

  const confirmar = () =>
    rellenar(caja, 
      el('h2', { texto: '¿Seguro?' }),
      el('p', { clase: 'nota', texto: `${c.nombre} deja de salir en la lista. Se puede deshacer desde la papelera.` }),
      el('button', {
        clase: 'boton peligro',
        type: 'button',
        texto: 'Sí, quitarlo',
        onclick: async () => {
          try {
            await api.retirarCliente(c.codigo);
            recargar();
          } catch (fallo) {
            caja.append(aviso(fallo.message));
          }
        },
      }),
      el('button', { clase: 'boton secundario chico', type: 'button', texto: 'No', onclick: pintar }),
    );

  pintar();
  return caja;
}

/**
 * El borrado que no se deshace.
 *
 * Solo aparece dentro de la papelera y solo a quien administra. Y aun así, el
 * servidor lo rechaza si la ficha tiene historial colgando: ese rechazo se
 * enseña entero, porque explica lo que la pantalla no puede adivinar.
 */
function borradoDefinitivo(c, ir) {
  const caja = el('div', { clase: 'tarjeta peligro' });

  const pintar = () =>
    rellenar(caja, 
      el('h2', { texto: 'Borrar para siempre' }),
      el('p', { clase: 'nota' }, [
        document.createTextNode('Esto no se deshace.'),
        ayuda(
          'Solo se borra del todo un cliente que no tiene nada guardado: ni ventas, ni ' +
            'compras, ni puntos, ni gente invitada. En cuanto tenga algo de eso, el sistema no ' +
            'lo borra, porque se llevaría por delante el historial de dinero que entró a la ' +
            'tienda. Para ésos, la papelera es lo más lejos que llega.',
          { etiqueta: 'Cuándo se puede borrar' },
        ),
      ]),
      el('button', {
        clase: 'boton peligro',
        type: 'button',
        texto: 'Borrar para siempre',
        onclick: async () => {
          try {
            await api.borrarCliente(c.codigo);
            ir('#/clientes');
          } catch (fallo) {
            rellenar(caja, 
              el('h2', { texto: 'No se puede borrar' }),
              aviso(fallo.message),
              fallo.detalle ? el('p', { clase: 'nota', texto: fallo.detalle }) : null,
              el('button', { clase: 'boton secundario chico', type: 'button', texto: 'Entendido', onclick: pintar }),
            );
          }
        },
      }),
    );

  pintar();
  return caja;
}

// ---------------------------------------------------------------------------
// Corregir
// ---------------------------------------------------------------------------

/**
 * Corregir la ficha.
 *
 * El celular NO está. Es la llave con la que el socio entra y con la que el
 * sistema lo reconoce: poder cambiarlo desde aquí convertiría el panel en una
 * forma de apoderarse de la cuenta de alguien. El servidor tampoco lo acepta,
 * así que no es solo que la pantalla no lo ofrezca.
 */
export function editarCliente({ datos, ir, recargar }) {
  const c = datos.cliente;
  const cumple = selectorDeCumple({ etiqueta: 'Cumpleaños', valor: c.cumple, nota: 'Le regalamos puntos ese día.' });

  const boton = el('button', { clase: 'boton', type: 'submit', texto: 'Guardar' });
  boton.dataset.texto = 'Guardar';

  const formulario = el('form', { clase: 'tarjeta', novalidate: true }, [
    el('p', { clase: 'antetitulo', texto: c.codigo }),
    el('h1', { texto: 'Corregir los datos' }),
    campo({ id: 'nombre', etiqueta: 'Nombre', value: c.nombre }),
    campo({ id: 'apellido', etiqueta: 'Apellido', value: c.apellido }),
    campo({ id: 'cedula', etiqueta: 'Cédula o RUC', value: c.cedula }),
    campo({
      id: 'correo',
      etiqueta: 'Correo',
      type: 'email',
      inputmode: 'email',
      autocapitalize: 'off',
      spellcheck: 'false',
      value: c.correo,
    }),
    campo({ id: 'direccion', etiqueta: 'Dirección de entrega', value: c.direccion }),
    cumple.nodo,
    campo({ id: 'notas', etiqueta: 'Notas', value: c.notas, nota: 'Lo que haya que recordar de esta persona.' }),
    el('div', { clase: 'datos' }, [
      renglonDato('Celular', c.telefono),
    ]),
    el('p', { clase: 'nota' }, [
      document.createTextNode('El celular no se cambia desde aquí.'),
      ayuda(
        'Es con lo que el cliente entra a su cuenta y con lo que el sistema lo reconoce en la ' +
          'próxima venta. Si de verdad cambió de número, se registra como cliente nuevo y se ' +
          'pasan sus puntos con un ajuste, que queda escrito y él puede leer.',
        { etiqueta: 'Por qué no se cambia' },
      ),
    ]),
    boton,
    el('button', {
      clase: 'boton secundario',
      type: 'button',
      texto: 'Cancelar',
      onclick: () => ir(`#/cliente/${c.codigo}`),
    }),
  ]);

  alEnviar(formulario, boton, async () => {
    await api.corregirCliente(c.codigo, {
      nombre: formulario.nombre.value,
      apellido: formulario.apellido.value,
      cedula: formulario.cedula.value,
      correo: formulario.correo.value,
      direccion: formulario.direccion.value,
      notas: formulario.notas.value,
      cumple: cumple.valor(),
    });
    ir(`#/cliente/${c.codigo}`);
  });

  return formulario;
}
