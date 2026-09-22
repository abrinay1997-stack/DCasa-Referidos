/**
 * La facturería: emitir una venta y reimprimir su comprobante.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTA PANTALLA TIENE QUE RESOLVER
 *
 * Una venta de mueblería se hace de pie, con el cliente delante, y termina con
 * un papel en su mano. Todo lo de aquí está ordenado para eso:
 *
 *   1. **El cliente primero.** Si ya vino antes, dos letras lo encuentran y no
 *      hay que volver a teclear nada. Si es nuevo, se teclea una vez y queda
 *      para siempre — y esa es la diferencia entre una libreta y un cuaderno.
 *   2. **Los artículos, uno por renglón.** Con su cantidad y su precio, porque
 *      dentro de seis meses «¿qué me vendieron?» se responde solo si está
 *      escrito.
 *   3. **El total, siempre a la vista.** Subtotal, descuento, ITBMS y total se
 *      recalculan a cada tecla, con LA MISMA función que usará el servidor al
 *      guardar (`compartido/ventas.js`). Nunca puede cobrarse un centavo
 *      distinto del que la vendedora dijo en voz alta.
 *   4. **Los puntos, antes de confirmar.** «Esta venta le da 1,070 puntos» es
 *      lo que convierte una factura en una razón para volver.
 *
 * ---------------------------------------------------------------------------
 * LOS PRECIOS SE TECLEAN SIN ITBMS
 *
 * Es como se arma una factura en Panamá, y la pantalla enseña el total con
 * impuesto mientras se teclea, así que nadie hace la cuenta de cabeza.
 */

import { api, aCentavos, comoDolares, comoFecha, comoPuntos } from './api.js';
import { el, buscador, campo, aviso, alEnviar, rellenar } from './vistas.js';
import { selectorDeCumple } from '../hub/cumple.js';

/**
 * Las cifras que esta pantalla necesita para anticipar el total y los puntos.
 *
 * LLEGAN DEL SERVIDOR, en `GET /panel/api/yo`, y no se escriben aquí. Es la
 * regla 1 de este repositorio: ninguna cifra vive en el código. Si el ITBMS
 * sube o si un dólar deja de dar un punto, esta pantalla lo sabe sin que nadie
 * la toque — y sobre todo, no puede quedarse diciendo la cifra vieja mientras
 * el servidor aplica la nueva.
 *
 * Los valores de partida son los que hoy están en `datos/puntos.json`, y solo
 * se usan en el instante entre que la pantalla se monta y `yo` contesta.
 */
const REGLAS = { itbmsPorcentaje: 7, puntosPorDolar: 1 };

export function ponerReglas(reglas) {
  if (Number.isInteger(reglas?.itbmsPorcentaje)) REGLAS.itbmsPorcentaje = reglas.itbmsPorcentaje;
  if (Number.isInteger(reglas?.puntosPorDolar)) REGLAS.puntosPorDolar = reglas.puntosPorDolar;
}

/**
 * Los totales, calculados igual que en el servidor.
 *
 * Es una copia en JavaScript de `compartido/ventas.ts`, y eso es una deuda
 * conocida: el panel no se compila, así que no puede importar el TypeScript. Lo
 * que impide que se separen es la prueba de extremo a extremo, que emite una
 * venta y comprueba que el total que enseñó la pantalla es el que guardó la
 * base. Si un día el panel pasa por un empaquetador, esto se borra y se importa.
 */
function totalesDe(lineas, descuentoCentavos) {
  let bruto = 0;
  let unidades = 0;
  for (const l of lineas) {
    if (!Number.isInteger(l.cantidad) || !Number.isInteger(l.precioCentavos)) continue;
    bruto += l.cantidad * l.precioCentavos;
    unidades += l.cantidad;
  }
  const descuento = Math.min(Math.max(descuentoCentavos || 0, 0), bruto);
  const subtotal = bruto - descuento;
  const itbms = Math.floor((subtotal * REGLAS.itbmsPorcentaje + 50) / 100);
  return { bruto, descuento, subtotal, itbms, total: subtotal + itbms, unidades };
}

// ---------------------------------------------------------------------------
// Nueva venta
// ---------------------------------------------------------------------------

export function nuevaVenta({ ir, encendido, prefijado = null }) {
  const pantalla = el('div', {});

  // Tres estados del cliente: ninguno, uno elegido de la libreta, o uno nuevo
  // que se está tecleando. La pantalla enseña uno solo cada vez: tener el
  // buscador y el formulario abiertos a la vez invita a teclear a alguien que
  // ya estaba, que es justo lo que crea fichas duplicadas.
  let cliente = prefijado ? { modo: 'elegido', ...prefijado } : { modo: 'ninguno' };

  const lineas = [{ descripcion: '', cantidad: 1, precioCentavos: 0 }];
  let descuento = 0;

  const cajaCliente = el('div', { clase: 'tarjeta' });
  const cajaLineas = el('div', { clase: 'tarjeta' });
  const cajaTotales = el('div', { clase: 'tarjeta totales' });
  const cajaEmitir = el('div', { clase: 'tarjeta' });

  const entradaFactura = el('input', {
    id: 'factura',
    type: 'text',
    inputmode: 'latin',
    autocomplete: 'off',
    placeholder: 'F-000501',
  });
  // El número de factura va en mayúsculas en el papel y el teclado del móvil
  // no. Se sube mientras se escribe en vez de corregirlo al guardar, que es lo
  // que hace que la vendedora vea lo mismo que va a quedar guardado.
  entradaFactura.addEventListener('input', () => {
    const donde = entradaFactura.selectionStart;
    entradaFactura.value = entradaFactura.value.toUpperCase();
    entradaFactura.setSelectionRange(donde, donde);
  });

  // --- El cliente ---------------------------------------------------------

  let datosNuevos = null;

  function pintarCliente() {
    if (cliente.modo === 'elegido') {
      return rellenar(cajaCliente, 
        el('h2', { texto: 'El cliente' }),
        el('div', { clase: 'elegido' }, [
          el('span', { clase: 'nombre', texto: cliente.nombre }),
          el('span', { clase: 'meta', texto: `${cliente.codigo} · ${comoPuntos(cliente.saldo ?? 0)} pts` }),
        ]),
        el('button', {
          clase: 'boton secundario chico',
          type: 'button',
          texto: 'Es otro',
          onclick: () => {
            cliente = { modo: 'ninguno' };
            pintarCliente();
          },
        }),
      );
    }

    if (cliente.modo === 'nuevo') {
      datosNuevos = formularioClienteNuevo(() => {
        cliente = { modo: 'ninguno' };
        pintarCliente();
      });
      return rellenar(cajaCliente, el('h2', { texto: 'Cliente nuevo' }), datosNuevos.nodo);
    }

    rellenar(cajaCliente, 
      el('h2', { texto: 'El cliente' }),
      buscador({
        alElegir: (f) => {
          cliente = { modo: 'elegido', codigo: f.codigo, nombre: f.nombre, saldo: f.saldo };
          pintarCliente();
        },
      }),
      el('p', { clase: 'nota', texto: 'Si nunca ha comprado aquí, no va a aparecer.' }),
      el('button', {
        clase: 'boton secundario',
        type: 'button',
        texto: 'Es la primera vez que compra',
        onclick: () => {
          cliente = { modo: 'nuevo' };
          pintarCliente();
        },
      }),
    );
  }

  // --- Las líneas ---------------------------------------------------------

  function pintarLineas() {
    const filas = lineas.map((linea, i) => {
      const desc = el('input', {
        type: 'text',
        value: linea.descripcion,
        placeholder: 'Juego de sala, colchón queen…',
        autocomplete: 'off',
        'aria-label': `Artículo ${i + 1}`,
      });
      desc.addEventListener('input', () => {
        linea.descripcion = desc.value;
      });

      const cant = el('input', {
        type: 'text',
        inputmode: 'numeric',
        value: String(linea.cantidad),
        'aria-label': `Cantidad del artículo ${i + 1}`,
      });
      cant.addEventListener('input', () => {
        const n = Number(cant.value.replace(/\D/g, ''));
        linea.cantidad = Number.isInteger(n) && n > 0 ? n : 0;
        pintarTotales();
      });

      const precio = el('input', {
        type: 'text',
        inputmode: 'decimal',
        value: linea.precioCentavos ? (linea.precioCentavos / 100).toFixed(2) : '',
        placeholder: '0.00',
        'aria-label': `Precio del artículo ${i + 1}, sin ITBMS`,
      });
      precio.addEventListener('input', () => {
        const c = aCentavos(precio.value);
        linea.precioCentavos = Number.isFinite(c) ? Math.round(c) : 0;
        pintarTotales();
      });

      return el('div', { clase: 'renglon-venta' }, [
        desc,
        el('div', { clase: 'renglon-cifras' }, [
          // «Cant.» escrito y no un «×». El aspa de multiplicar y el aspa de
          // quitar son el mismo signo, y en el mismo renglón: una dice cuántos
          // y la otra borra la línea. Con prisa eso se pulsa mal.
          el('span', { clase: 'x', texto: 'Cant.' }),
          cant,
          el('span', { clase: 'x', texto: '$' }),
          precio,
          lineas.length > 1
            ? el('button', {
                clase: 'quitar',
                type: 'button',
                texto: '✕',
                'aria-label': `Quitar el artículo ${i + 1}`,
                onclick: () => {
                  lineas.splice(i, 1);
                  pintarLineas();
                  pintarTotales();
                },
              })
            : null,
        ]),
      ]);
    });

    rellenar(cajaLineas, 
      el('h2', { texto: 'Qué se vendió' }),
      el('p', { clase: 'nota', texto: `Los precios van SIN ITBMS. Abajo se suma el ${REGLAS.itbmsPorcentaje} %.` }),
      ...filas,
      el('button', {
        clase: 'boton secundario chico',
        type: 'button',
        texto: '+ Otro artículo',
        onclick: () => {
          lineas.push({ descripcion: '', cantidad: 1, precioCentavos: 0 });
          pintarLineas();
        },
      }),
    );
  }

  // --- Los totales, a cada tecla ------------------------------------------

  function pintarTotales() {
    const t = totalesDe(lineas, descuento);

    const entradaDescuento = el('input', {
      type: 'text',
      inputmode: 'decimal',
      value: descuento ? (descuento / 100).toFixed(2) : '',
      placeholder: '0.00',
      id: 'descuento',
    });
    entradaDescuento.addEventListener('input', () => {
      const c = aCentavos(entradaDescuento.value);
      descuento = Number.isFinite(c) ? Math.round(c) : 0;
      pintarTotales();
      // Al repintar se pierde el foco, y con él el teclado abierto a mitad de
      // un número. Se devuelve al mismo sitio.
      const nuevo = cajaTotales.querySelector('#descuento');
      if (nuevo) {
        nuevo.focus();
        nuevo.setSelectionRange(nuevo.value.length, nuevo.value.length);
      }
    });

    rellenar(cajaTotales, 
      renglonTotal('Subtotal', comoDolares(t.bruto)),
      el('div', { clase: 'total-fila descuento' }, [
        el('label', { clase: 'total-que', for: 'descuento', texto: 'Descuento' }),
        el('div', { clase: 'total-entrada' }, [el('span', { texto: '$' }), entradaDescuento]),
      ]),
      t.descuento ? renglonTotal('Base', comoDolares(t.subtotal)) : null,
      renglonTotal(`ITBMS ${REGLAS.itbmsPorcentaje} %`, comoDolares(t.itbms)),
      el('div', { clase: 'total-fila grande' }, [
        el('span', { clase: 'total-que', texto: 'Total a cobrar' }),
        el('span', { clase: 'total-cuanto', texto: comoDolares(t.total) }),
      ]),
      t.total > 0 && encendido?.compras
        ? el('p', { clase: 'puntos-anticipo', texto: `Le suma ${comoPuntos(puntosDe(t.total))} puntos.` })
        : null,
    );
  }

  // --- Emitir -------------------------------------------------------------

  const boton = el('button', { clase: 'boton', type: 'submit', texto: 'Emitir el comprobante' });
  boton.dataset.texto = 'Emitir el comprobante';

  const notas = el('input', {
    id: 'notas',
    type: 'text',
    placeholder: 'Entrega el sábado, falta el espejo…',
    autocomplete: 'off',
  });

  const formulario = el('form', { novalidate: true }, [
    cajaEmitir,
  ]);

  rellenar(cajaEmitir, 
    el('label', { clase: 'campo', for: 'factura' }, [
      el('span', { clase: 'etiqueta', texto: 'Número de la factura fiscal' }),
      entradaFactura,
      el('span', {
        clase: 'nota',
        texto: 'El que imprimió la caja. Este comprobante la acompaña, no la sustituye.',
      }),
    ]),
    el('label', { clase: 'campo', for: 'notas' }, [
      el('span', { clase: 'etiqueta', texto: 'Nota (opcional)' }),
      notas,
    ]),
    boton,
  );

  alEnviar(formulario, boton, async () => {
    let datosCliente;
    if (cliente.modo === 'elegido') datosCliente = { codigo: cliente.codigo };
    else if (cliente.modo === 'nuevo') datosCliente = datosNuevos.valor();
    else throw new Error('Falta decir de quién es la venta.');

    const hecho = await api.emitirVenta({
      cliente: datosCliente,
      facturaFiscal: entradaFactura.value,
      lineas: lineas.map((l) => ({
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precioCentavos: l.precioCentavos,
      })),
      descuentoCentavos: descuento,
      notas: notas.value,
    });

    ir(`#/venta/${hecho.numero}`);
  });

  pintarCliente();
  pintarLineas();
  pintarTotales();

  rellenar(pantalla, 
    el('h1', { texto: 'Nueva venta' }),
    cajaCliente,
    cajaLineas,
    cajaTotales,
    formulario,
    el('button', { clase: 'boton secundario', type: 'button', texto: 'Volver', onclick: () => ir('#/') }),
  );

  return pantalla;
}

/**
 * Lo que esta venta va a sumar, para decirlo antes de emitir.
 *
 * Es un ANTICIPO, no la cuenta buena: la de verdad la hace el servidor con
 * `compartido/puntos.ts`, que además aplica la compra mínima y el tope. Aquí se
 * redondea hacia abajo igual que allí, porque redondear hacia arriba regalaría
 * una fracción de punto en cada venta y a mil ventas eso es dinero.
 */
function puntosDe(totalCentavos) {
  return Math.floor((totalCentavos / 100) * REGLAS.puntosPorDolar);
}

function renglonTotal(que, cuanto) {
  return el('div', { clase: 'total-fila' }, [
    el('span', { clase: 'total-que', texto: que }),
    el('span', { clase: 'total-cuanto', texto: cuanto }),
  ]);
}

/**
 * El formulario del cliente que viene por primera vez.
 *
 * Solo el nombre y el celular son obligatorios, y es deliberado: lo demás se
 * completa después desde su ficha. Un formulario largo delante de una cola es
 * un formulario que se rellena con cualquier cosa.
 */
function formularioClienteNuevo(cancelar) {
  const cumple = selectorDeCumple({
    etiqueta: 'Cumpleaños (opcional)',
    nota: 'Le regalamos puntos ese día.',
  });

  const nodo = el('div', {}, [
    campo({ id: 'c-nombre', etiqueta: 'Nombre', autocomplete: 'given-name' }),
    campo({ id: 'c-apellido', etiqueta: 'Apellido', autocomplete: 'family-name' }),
    campo({
      id: 'c-telefono',
      etiqueta: 'Celular',
      type: 'tel',
      inputmode: 'numeric',
      placeholder: '6026-1919',
      nota: 'Es con lo que el sistema lo reconoce la próxima vez.',
    }),
    campo({ id: 'c-cedula', etiqueta: 'Cédula o RUC (opcional)', autocomplete: 'off' }),
    campo({
      id: 'c-correo',
      etiqueta: 'Correo (opcional)',
      type: 'email',
      inputmode: 'email',
      autocapitalize: 'off',
      spellcheck: 'false',
    }),
    campo({ id: 'c-direccion', etiqueta: 'Dirección de entrega (opcional)' }),
    cumple.nodo,
    el('button', { clase: 'boton secundario chico', type: 'button', texto: 'Mejor lo busco', onclick: cancelar }),
  ]);

  return {
    nodo,
    valor: () => ({
      nombre: nodo.querySelector('#c-nombre').value,
      apellido: nodo.querySelector('#c-apellido').value,
      telefono: nodo.querySelector('#c-telefono').value,
      cedula: nodo.querySelector('#c-cedula').value,
      correo: nodo.querySelector('#c-correo').value,
      direccion: nodo.querySelector('#c-direccion').value,
      cumple: cumple.valor(),
    }),
  };
}

// ---------------------------------------------------------------------------
// El comprobante
// ---------------------------------------------------------------------------

/**
 * El papel que se lleva el cliente.
 *
 * Se imprime desde el navegador —`window.print()`— y no se genera un PDF con
 * una biblioteca. Un generador de PDF son doscientos kilobytes para producir lo
 * que el navegador ya sabe hacer, y en Android «Imprimir → Guardar como PDF»
 * deja el archivo listo para mandar por WhatsApp en dos toques. Lo que cambia
 * al imprimir está en `@media print` de `panel/index.html`: se va todo lo que
 * no es el comprobante.
 */
export function comprobante({ datos, ir, admin }) {
  const d = datos.documento;

  const lineas = d.lineas.map((l) =>
    el('tr', {}, [
      el('td', { texto: l.descripcion }),
      el('td', { clase: 'num', texto: String(l.cantidad) }),
      el('td', { clase: 'num', texto: comoDolares(l.precioCentavos) }),
      el('td', { clase: 'num', texto: comoDolares(l.cantidad * l.precioCentavos) }),
    ]),
  );

  const papel = el('article', { clase: 'papel' }, [
    el('div', { clase: 'papel-cabecero' }, [
      el('img', { clase: 'papel-logo', src: '/hub/assets/logo-dcasa.png', alt: 'D’CASA Panamá', width: 1783, height: 809 }),
      el('div', { clase: 'papel-quien' }, [
        el('span', { clase: 'papel-titulo', texto: 'Comprobante de venta' }),
        el('span', { clase: 'papel-numero', texto: d.numero }),
      ]),
    ]),

    datos.anulada
      ? el('p', { clase: 'papel-anulada', texto: `ANULADO · ${datos.anuladaMotivo}` })
      : null,

    el('div', { clase: 'papel-datos' }, [
      dato('Fecha', comoFecha(`${d.fecha}T12:00:00Z`)),
      dato('Factura fiscal', d.facturaFiscal),
      dato('Atendió', d.vendedora.split('@')[0]),
    ]),

    el('div', { clase: 'papel-cliente' }, [
      el('span', { clase: 'papel-etiqueta', texto: 'Cliente' }),
      el('span', { clase: 'papel-nombre', texto: `${d.cliente.nombre} ${d.cliente.apellido}`.trim() }),
      el('span', { clase: 'papel-meta', texto: d.cliente.codigo }),
      d.cliente.cedula ? el('span', { clase: 'papel-meta', texto: `Cédula/RUC ${d.cliente.cedula}` }) : null,
      d.cliente.telefono ? el('span', { clase: 'papel-meta', texto: d.cliente.telefono }) : null,
      d.cliente.direccion ? el('span', { clase: 'papel-meta', texto: d.cliente.direccion }) : null,
    ]),

    el('table', { clase: 'papel-tabla' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { texto: 'Artículo' }),
          el('th', { clase: 'num', texto: 'Cant.' }),
          el('th', { clase: 'num', texto: 'Precio' }),
          el('th', { clase: 'num', texto: 'Importe' }),
        ]),
      ]),
      el('tbody', {}, lineas),
    ]),

    el('div', { clase: 'papel-totales' }, [
      renglonTotal('Subtotal', comoDolares(d.totales.brutoCentavos)),
      d.totales.descuentoCentavos
        ? renglonTotal('Descuento', `− ${comoDolares(d.totales.descuentoCentavos)}`)
        : null,
      renglonTotal(`ITBMS ${d.itbmsPorcentaje} %`, comoDolares(d.totales.itbmsCentavos)),
      el('div', { clase: 'total-fila grande' }, [
        el('span', { clase: 'total-que', texto: 'Total' }),
        el('span', { clase: 'total-cuanto', texto: comoDolares(d.totales.totalCentavos) }),
      ]),
    ]),

    d.notas ? el('p', { clase: 'papel-nota', texto: d.notas }) : null,

    // Los puntos van EN EL PAPEL. Es la única vez que el cliente tiene el
    // programa delante sin tener que abrir nada, y decirle cuánto lleva
    // acumulado es lo que hace que la próxima vez pregunte.
    d.puntos > 0
      ? el('div', { clase: 'papel-puntos' }, [
          el('span', { clase: 'papel-puntos-linea', texto: `Esta compra le sumó ${comoPuntos(d.puntos)} puntos.` }),
          el('span', { clase: 'papel-puntos-saldo', texto: `Lleva ${comoPuntos(d.saldoDespues)} puntos · ${comoDolares(d.saldoDespues)} en premios.` }),
          el('span', { clase: 'papel-puntos-pie', texto: 'Escanee el código de la tienda para verlos desde su teléfono.' }),
        ])
      : null,

    // La línea que evita el problema con la DGI. No va en letra pequeña al pie
    // por casualidad: va donde va en cualquier documento que aclara qué es.
    el('p', {
      clase: 'papel-legal',
      texto:
        'Este documento no es una factura fiscal. La factura fiscal de esta compra es la ' +
        `N.º ${d.facturaFiscal}, emitida por el equipo fiscal de D’CASA Panamá.`,
    }),
    el('p', { clase: 'papel-pie', texto: 'D’CASA Panamá · La Chorrera, frente al parque Libertadores' }),
  ]);

  const acciones = el('div', { clase: 'tarjeta sin-imprimir' }, [
    el('button', {
      clase: 'boton',
      type: 'button',
      texto: 'Imprimir o guardar en PDF',
      onclick: () => window.print(),
    }),
    el('button', {
      clase: 'boton secundario',
      type: 'button',
      texto: 'Otra venta',
      onclick: () => ir('#/venta'),
    }),
    el('button', {
      clase: 'boton secundario',
      type: 'button',
      texto: 'Ver la ficha del cliente',
      onclick: () => ir(`#/cliente/${d.cliente.codigo}`),
    }),
    !datos.anulada && admin ? botonAnular(datos.numero, ir) : null,
  ]);

  return el('div', {}, [papel, acciones]);
}

function dato(que, cuanto) {
  return el('div', { clase: 'papel-dato' }, [
    el('span', { clase: 'papel-etiqueta', texto: que }),
    el('span', { texto: cuanto }),
  ]);
}

/**
 * Anular pide el motivo y luego confirma.
 *
 * Dos pasos porque no se deshace y porque el motivo lo lee el cliente en su
 * cuenta: «anulado» a secas, en el historial de puntos de alguien, es un saldo
 * que bajó sin explicación.
 */
function botonAnular(numero, ir) {
  const caja = el('div', {});
  rellenar(caja, 
    el('button', {
      clase: 'boton peligro',
      type: 'button',
      texto: 'Anular este comprobante',
      onclick: () => pedirMotivo(),
    }),
  );

  function pedirMotivo() {
    const entrada = el('input', { id: 'motivo', type: 'text', placeholder: 'El cliente devolvió el sofá' });
    const boton = el('button', { clase: 'boton peligro', type: 'submit', texto: 'Anular de verdad' });
    boton.dataset.texto = 'Anular de verdad';

    const formulario = el('form', { novalidate: true }, [
      el('label', { clase: 'campo', for: 'motivo' }, [
        el('span', { clase: 'etiqueta', texto: 'Por qué se anula' }),
        entrada,
        el('span', { clase: 'nota', texto: 'El cliente lo va a leer en su cuenta. Los puntos vuelven atrás.' }),
      ]),
      boton,
      el('button', {
        clase: 'boton secundario chico',
        type: 'button',
        texto: 'Mejor no',
        onclick: () => rellenar(caja, botonAnular(numero, ir)),
      }),
    ]);

    alEnviar(formulario, boton, async () => {
      await api.anularVenta(numero, entrada.value);
      ir(`#/venta/${numero}`);
    });

    rellenar(caja, formulario);
  }

  return caja;
}

// ---------------------------------------------------------------------------
// El historial
// ---------------------------------------------------------------------------

export function historialVentas({ ir }) {
  const pantalla = el('div', {});
  const lista = el('div', { clase: 'tarjeta' });
  let pagina = 1;
  let texto = '';
  let temporizador;

  const entrada = el('input', {
    id: 'q',
    type: 'search',
    placeholder: 'Comprobante, factura, cliente…',
    autocomplete: 'off',
  });
  entrada.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      texto = entrada.value.trim();
      pagina = 1;
      cargar();
    }, 250);
  });

  async function cargar() {
    rellenar(lista, el('p', { clase: 'nota', texto: 'Un momento…' }));
    try {
      const r = await api.ventas(`?q=${encodeURIComponent(texto)}&pagina=${pagina}`);
      if (!r.ventas.length) {
        return rellenar(lista, 
          el('p', { clase: 'nota vacio', texto: texto ? 'Nada con eso.' : 'Todavía no hay ventas.' }),
        );
      }
      rellenar(lista, 
        ...r.ventas.map((v) =>
          el('button', { clase: 'resultado', type: 'button', onclick: () => ir(`#/venta/${v.numero}`) }, [
            el('span', { clase: 'nombre', texto: `${v.numero} · ${comoDolares(v.totalCentavos)}` }),
            el('span', { clase: 'meta', texto: `${v.clienteNombre} · ${comoFecha(v.emitidaEn)}` }),
            v.anulada ? el('span', { clase: 'marca', texto: 'Anulado' }) : null,
          ]),
        ),
        paginador(r, (p) => {
          pagina = p;
          cargar();
        }),
      );
    } catch (fallo) {
      rellenar(lista, aviso(fallo.message));
    }
  }

  rellenar(pantalla, 
    el('h1', { texto: 'Ventas' }),
    el('div', { clase: 'tarjeta' }, [
      el('label', { clase: 'campo', for: 'q' }, [
        el('span', { clase: 'etiqueta', texto: 'Buscar' }),
        entrada,
      ]),
    ]),
    lista,
    el('button', { clase: 'boton secundario', type: 'button', texto: 'Volver', onclick: () => ir('#/') }),
  );

  cargar();
  return pantalla;
}

/** Las páginas. Se enseña sólo si hay más de una: si no, es ruido. */
export function paginador({ cuantas, cuantos, pagina, porPagina }, alIr) {
  const total = cuantas ?? cuantos ?? 0;
  const paginas = Math.ceil(total / porPagina);
  if (paginas <= 1) return null;

  return el('div', { clase: 'paginas' }, [
    el('button', {
      clase: 'boton secundario chico',
      type: 'button',
      texto: '‹ Anterior',
      disabled: pagina <= 1,
      onclick: () => alIr(pagina - 1),
    }),
    el('span', { clase: 'nota', texto: `${pagina} de ${paginas} · ${total} en total` }),
    el('button', {
      clase: 'boton secundario chico',
      type: 'button',
      texto: 'Siguiente ›',
      disabled: pagina >= paginas,
      onclick: () => alIr(pagina + 1),
    }),
  ]);
}
