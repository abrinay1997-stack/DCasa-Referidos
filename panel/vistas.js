/**
 * Las pantallas del panel.
 *
 * La de registrar una compra es la que decide si el programa vive. Ocurre con
 * el cliente delante y una cola detrás, así que está pensada para que la
 * vendedora no tenga que decidir nada: busca, teclea dos datos, VE cuántos
 * puntos van a caer antes de confirmar, y confirma.
 *
 * Todo el texto va por `textContent`, nunca por `innerHTML`: los nombres y los
 * motivos los escriben personas.
 */

import { aCentavos, api, comoDolares, comoFecha, comoPuntos } from './api.js';

export function el(etiqueta, atributos = {}, hijos = []) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === 'clase') nodo.className = valor;
    else if (clave === 'texto') nodo.textContent = valor;
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo.setAttribute(clave, valor === true ? '' : valor);
  }
  for (const hijo of [].concat(hijos)) if (hijo) nodo.append(hijo);
  return nodo;
}

const aviso = (texto, tono = 'malo') => el('p', { clase: `aviso ${tono}`, texto, role: 'alert' });

function campo({ id, etiqueta, nota, ...resto }) {
  return el('label', { clase: 'campo', for: id }, [
    el('span', { clase: 'etiqueta', texto: etiqueta }),
    el('input', { id, name: id, ...resto }),
    nota ? el('span', { clase: 'nota', texto: nota }) : null,
  ]);
}

/** Bloquea el botón mientras trabaja y enseña el fallo donde se vea. */
function alEnviar(formulario, boton, accion) {
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    formulario.querySelectorAll('.aviso').forEach((n) => n.remove());
    boton.disabled = true;
    const texto = boton.textContent;
    boton.textContent = 'Un momento…';
    try {
      await accion();
    } catch (fallo) {
      const nodo = aviso(fallo.message + (fallo.detalle ? ` ${fallo.detalle}` : ''));
      formulario.append(nodo);
      nodo.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } finally {
      boton.disabled = false;
      boton.textContent = texto;
    }
  });
}

// ---------------------------------------------------------------------------
// Buscador de socios, reutilizable
// ---------------------------------------------------------------------------

/**
 * Un campo que busca mientras se escribe.
 *
 * Acepta cualquier tramo del celular, el nombre o el código, porque en el
 * mostrador se dice lo que se tiene a mano. Espera 250 ms entre teclas: sin eso,
 * teclear «6026» dispara cuatro consultas y la última en volver no es
 * necesariamente la del texto que hay en pantalla.
 */
export function buscador({ alElegir, autoenfoque = false }) {
  const entrada = el('input', {
    id: 'q',
    type: 'search',
    placeholder: 'Celular, nombre o código',
    autocomplete: 'off',
    inputmode: 'search',
  });
  const lista = el('div', { clase: 'resultados' });
  let temporizador;
  let peticion = 0;

  async function buscar() {
    const q = entrada.value.trim();
    if (q.length < 2) return lista.replaceChildren();

    const mia = ++peticion;
    try {
      const { filas } = await api.buscarSocios(q);
      // Si mientras tanto se tecleó otra letra, esta respuesta ya no vale.
      if (mia !== peticion) return;

      if (!filas.length) {
        return lista.replaceChildren(
          el('p', { clase: 'nota vacio', texto: 'No aparece nadie con eso.' }),
        );
      }
      lista.replaceChildren(
        ...filas.map((f) =>
          el('button', { clase: 'resultado', type: 'button', onclick: () => alElegir(f) }, [
            el('span', { clase: 'nombre', texto: f.nombre }),
            el('span', { clase: 'meta', texto: `${f.telefono} · ${comoPuntos(f.saldo)} pts` }),
            f.estado === 'suspendido' ? el('span', { clase: 'marca', texto: 'Suspendido' }) : null,
          ]),
        ),
      );
    } catch (fallo) {
      if (mia === peticion) lista.replaceChildren(aviso(fallo.message));
    }
  }

  entrada.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(buscar, 250);
  });

  const nodo = el('div', {}, [
    el('label', { clase: 'campo', for: 'q' }, [
      el('span', { clase: 'etiqueta', texto: 'Busca al socio' }),
      entrada,
    ]),
    lista,
  ]);

  if (autoenfoque) queueMicrotask(() => entrada.focus());
  return nodo;
}

// ---------------------------------------------------------------------------
// Registrar una compra
// ---------------------------------------------------------------------------

export function nuevaCompra({ ir, encendido }) {
  if (!encendido?.compras) {
    return el('div', { clase: 'tarjeta' }, [
      el('h1', { texto: 'Registrar una compra' }),
      aviso(
        'Todavía no se pueden registrar compras: falta definir en datos/puntos.json ' +
          'cuántos puntos da cada dólar y si se calculan sobre el total o sobre el ' +
          'subtotal sin ITBMS. Son decisiones de Marcial, no del código.',
        'espera',
      ),
      el('button', { clase: 'boton secundario', texto: 'Volver', onclick: () => ir('#/') }),
    ]);
  }

  let elegido = null;
  const donde = el('div');

  const pintarBusqueda = () => {
    donde.replaceChildren(
      el('div', { clase: 'tarjeta' }, [
        el('h1', { texto: 'Registrar una compra' }),
        buscador({
          autoenfoque: true,
          alElegir: (socio) => {
            elegido = socio;
            pintarFormulario();
          },
        }),
      ]),
    );
  };

  const pintarFormulario = () => {
    const boton = el('button', { clase: 'boton', type: 'submit', texto: 'Registrar' });
    const anticipo = el('p', { clase: 'anticipo' });

    const factura = el('input', {
      id: 'factura',
      autocomplete: 'off',
      placeholder: 'F-001234',
      required: true,
    });
    const monto = el('input', {
      id: 'monto',
      inputmode: 'decimal',
      placeholder: '0.00',
      required: true,
    });

    /**
     * Lo que la vendedora ve ANTES de confirmar.
     *
     * Sale de la misma función del servidor que después escribe los puntos. Si
     * fueran dos cuentas distintas, un día dirían cosas distintas y la vendedora
     * quedaría desmentida delante del cliente.
     */
    let pendiente;
    const recalcular = async () => {
      clearTimeout(pendiente);
      pendiente = setTimeout(async () => {
        const centavos = aCentavos(monto.value);
        if (!Number.isFinite(centavos) || centavos <= 0) return (anticipo.textContent = '');
        try {
          const c = await api.calcular(elegido.codigo, centavos);
          anticipo.replaceChildren(
            document.createTextNode('Esta compra le da '),
            el('b', { texto: `${comoPuntos(c.puntos)} puntos` }),
            document.createTextNode(`. Quedaría en ${comoPuntos(c.saldoDespues)}.`),
          );
        } catch (fallo) {
          anticipo.textContent = fallo.message;
        }
      }, 300);
    };
    monto.addEventListener('input', recalcular);

    const formulario = el('form', { clase: 'tarjeta', novalidate: true }, [
      el('p', { clase: 'antetitulo', texto: 'Registrar una compra' }),
      el('div', { clase: 'elegido' }, [
        el('span', { clase: 'nombre', texto: elegido.nombre }),
        el('span', { clase: 'meta', texto: `${elegido.telefono} · ${elegido.codigo}` }),
        el('button', {
          clase: 'cambiar',
          type: 'button',
          texto: 'Cambiar',
          onclick: pintarBusqueda,
        }),
      ]),
      el('label', { clase: 'campo', for: 'factura' }, [
        el('span', { clase: 'etiqueta', texto: 'Número de factura' }),
        factura,
      ]),
      el('label', { clase: 'campo', for: 'monto' }, [
        el('span', { clase: 'etiqueta', texto: 'Monto de la compra' }),
        monto,
        el('span', { clase: 'nota', texto: 'En dólares, como sale en la factura.' }),
      ]),
      anticipo,
      boton,
    ]);

    alEnviar(formulario, boton, async () => {
      const centavos = aCentavos(monto.value);
      if (!Number.isFinite(centavos) || centavos <= 0) {
        throw new Error('Revisa el monto: no se entiende.');
      }
      const hecho = await api.registrarCompra({
        socio: elegido.codigo,
        factura: factura.value,
        montoCentavos: centavos,
      });
      donde.replaceChildren(listo(hecho, elegido, pintarBusqueda, ir));
    });

    donde.replaceChildren(formulario);
  };

  pintarBusqueda();
  return donde;
}

/**
 * La confirmación.
 *
 * Grande y legible desde medio metro, porque la vendedora se la va a enseñar al
 * cliente girando el teléfono. Es la parte que hace que el socio se crea que
 * sus puntos existen.
 */
function listo(hecho, socio, otraVez, ir) {
  return el('div', { clase: 'tarjeta centrada' }, [
    el('p', { clase: 'antetitulo', texto: 'Listo' }),
    el('div', { clase: 'placa' }, [
      el('span', { clase: 'numero', texto: `+${comoPuntos(hecho.puntos)}` }),
      el('span', { clase: 'unidad', texto: 'puntos' }),
    ]),
    el('p', { clase: 'grande' }, [
      el('b', { texto: socio.nombre.split(' ')[0] }),
      document.createTextNode(` ahora tiene ${comoPuntos(hecho.saldoNuevo)} puntos.`),
    ]),
    el('p', { clase: 'nota', texto: `Factura ${hecho.factura} · ${comoDolares(hecho.montoCentavos)}` }),
    el('button', { clase: 'boton', texto: 'Registrar otra', onclick: otraVez }),
    el('button', {
      clase: 'boton secundario',
      texto: 'Ver su ficha',
      onclick: () => ir(`#/socio/${socio.codigo}`),
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Buscar un socio
// ---------------------------------------------------------------------------

export function pantallaSocios({ ir }) {
  return el('div', { clase: 'tarjeta' }, [
    el('h1', { texto: 'Socios' }),
    buscador({ autoenfoque: true, alElegir: (s) => ir(`#/socio/${s.codigo}`) }),
  ]);
}

// ---------------------------------------------------------------------------
// La ficha
// ---------------------------------------------------------------------------

const NOMBRE_TIPO = {
  bienvenida: 'Bienvenida',
  compra: 'Compra',
  referido: 'Referido',
  canje: 'Canje',
  ajuste: 'Ajuste',
  reverso: 'Corrección',
  cumpleanos: 'Cumpleaños',
  vencimiento: 'Vencidos',
};

export function ficha({ datos, ir, recargar }) {
  const { socio, saldo, bitacora, compras } = datos;

  return el('div', {}, [
    el('div', { clase: 'tarjeta' }, [
      el('p', { clase: 'antetitulo', texto: socio.codigo }),
      el('h1', { texto: `${socio.nombre} ${socio.apellido}`.trim() }),
      el('p', { clase: 'nota', texto: `${socio.telefono} · alta ${comoFecha(socio.creadoEn)}` }),
      socio.estado === 'suspendido' ? aviso('Esta cuenta está suspendida.', 'espera') : null,
      socio.pinTemporal
        ? aviso('Tiene un PIN temporal: elegirá uno suyo la próxima vez que entre.', 'espera')
        : null,
      el('div', { clase: 'placa chica' }, [
        el('span', { clase: 'numero', texto: comoPuntos(saldo) }),
        el('span', { clase: 'unidad', texto: 'puntos' }),
      ]),
    ]),

    acciones({ socio, ir, recargar }),

    compras.length
      ? el('div', { clase: 'tarjeta' }, [
          el('h2', { texto: 'Sus compras' }),
          el(
            'ul',
            { clase: 'lista' },
            compras.map((c) =>
              el('li', { clase: c.anulada ? 'anulada' : '' }, [
                el('div', { clase: 'linea' }, [
                  el('span', { texto: `Factura ${c.factura}` }),
                  el('span', { clase: 'puntos', texto: `+${comoPuntos(c.puntos)}` }),
                ]),
                el('span', {
                  clase: 'cuando',
                  texto: `${comoDolares(c.montoCentavos)} · ${comoFecha(c.registradaEn)} · ${c.vendedor}`,
                }),
                c.anulada
                  ? el('p', { clase: 'motivo', texto: `Anulada: ${c.anuladaMotivo}` })
                  : el('button', {
                      clase: 'enlace-accion',
                      type: 'button',
                      texto: 'Anular',
                      onclick: () => anular(c, recargar),
                    }),
              ]),
            ),
          ),
        ])
      : null,

    el('div', { clase: 'tarjeta' }, [
      el('h2', { texto: 'Su bitácora' }),
      bitacora.length
        ? el(
            'ul',
            { clase: 'lista' },
            bitacora.map((m) =>
              el('li', {}, [
                el('div', { clase: 'linea' }, [
                  el('span', { texto: NOMBRE_TIPO[m.tipo] ?? m.tipo }),
                  el('span', {
                    clase: `puntos ${m.puntos < 0 ? 'resta' : ''}`,
                    texto: `${m.puntos > 0 ? '+' : ''}${comoPuntos(m.puntos)}`,
                  }),
                ]),
                el('span', { clase: 'cuando', texto: comoFecha(m.ocurridoEn) }),
                m.motivo ? el('p', { clase: 'motivo', texto: m.motivo }) : null,
              ]),
            ),
          )
        : el('p', { clase: 'nota', texto: 'Todavía no hay movimientos.' }),
    ]),

    el('button', { clase: 'boton secundario', texto: 'Volver', onclick: () => ir('#/socios') }),
  ]);
}

function acciones({ socio, recargar }) {
  const donde = el('div', { clase: 'tarjeta' });

  const reiniciar = async () => {
    if (!confirm(`¿Reiniciar el PIN de ${socio.nombre}?\n\nSe cerrarán sus sesiones abiertas.`)) return;

    let pin;
    try {
      ({ pin } = await api.reiniciarPin(socio.codigo));
    } catch (fallo) {
      return donde.prepend(aviso(fallo.message));
    }

    // ---------------------------------------------------------------------
    // El PIN OCUPA LA PANTALLA ENTERA Y NO SE VA SOLO.
    //
    // Este número se enseña UNA vez: no está guardado en claro en ningún sitio
    // y no se puede volver a consultar. Si la vendedora no lo lee, el socio se
    // queda fuera de su cuenta y hay que reiniciarlo otra vez.
    //
    // La primera versión lo metía en una tarjeta y llamaba a `recargar()`
    // inmediatamente después — y `recargar()` repinta la ficha entera, así que
    // borraba el PIN antes de que nadie lo leyera. Lo cazó la prueba de
    // navegador; en la tienda lo habría cazado una vendedora con el cliente
    // delante y nada que dictarle.
    //
    // Ahora ocupa la pantalla y solo se sale por el botón, que es cuando se
    // recarga.
    // ---------------------------------------------------------------------
    document.getElementById('app').replaceChildren(
      el('div', { clase: 'tarjeta centrada' }, [
        el('p', { clase: 'antetitulo', texto: 'PIN nuevo de ' + socio.nombre }),
        el('div', { clase: 'pin-nuevo' }, [
          el('span', { clase: 'pin', texto: pin }),
        ]),
        el('p', {
          clase: 'grande',
          texto: 'Dícteselo ahora. Este número no se vuelve a ver.',
        }),
        el('p', {
          clase: 'nota',
          texto:
            'Cuando entre con él, el sistema le pedirá que elija uno suyo. Sus ' +
            'sesiones abiertas ya se cerraron.',
        }),
        el('button', {
          clase: 'boton',
          texto: 'Listo, ya se lo dicté',
          onclick: () => recargar(),
        }),
      ]),
    );
  };

  const ajustar = async () => {
    const texto = prompt('¿Cuántos puntos? Usa un número negativo para quitar.');
    if (texto === null) return;
    const puntos = Number(texto);
    if (!Number.isInteger(puntos) || puntos === 0) {
      return donde.prepend(aviso('Tiene que ser un número entero distinto de cero.'));
    }
    const motivo = prompt('¿Por qué? El socio lo va a leer tal cual en su cuenta.');
    if (!motivo?.trim()) return donde.prepend(aviso('Sin motivo no se puede ajustar.'));

    try {
      await api.ajustar(socio.codigo, puntos, motivo);
      recargar();
    } catch (fallo) {
      donde.prepend(aviso(fallo.message));
    }
  };

  donde.append(
    el('h2', { texto: 'Acciones' }),
    el('button', { clase: 'fila', texto: 'Reiniciar su PIN', onclick: reiniciar }),
    el('button', { clase: 'fila', texto: 'Ajustar sus puntos', onclick: ajustar }),
    el('button', {
      clase: 'fila',
      texto: 'Quitarle el bloqueo por intentos',
      onclick: async () => {
        try {
          await api.desbloquear(socio.codigo);
          recargar();
        } catch (fallo) {
          donde.prepend(aviso(fallo.message));
        }
      },
    }),
  );
  return donde;
}

async function anular(compra, recargar) {
  const motivo = prompt(
    `Anular la factura ${compra.factura}.\n\n¿Por qué? El socio lo va a leer en su cuenta.`,
  );
  if (!motivo?.trim()) return;
  try {
    await api.anularCompra(compra.id, motivo);
    recargar();
  } catch (fallo) {
    alert(fallo.message);
  }
}

// ---------------------------------------------------------------------------

export const cargando = () =>
  el('div', { clase: 'tarjeta centrada' }, [el('p', { clase: 'nota', texto: 'Un momento…' })]);

export const problema = (mensaje, reintentar) =>
  el('div', { clase: 'tarjeta' }, [
    aviso(mensaje),
    reintentar ? el('button', { clase: 'boton secundario', texto: 'Reintentar', onclick: reintentar }) : null,
  ]);

// ---------------------------------------------------------------------------
// Entregar un premio
// ---------------------------------------------------------------------------

const NOMBRE_ESTADO_CANJE = {
  solicitado: 'Pendiente',
  entregado: 'Entregado',
  vencido: 'Venció',
  cancelado: 'Cancelado',
};

/**
 * La pantalla de canjes.
 *
 * Arriba, el campo para teclear el código que trae el socio — es lo que hace la
 * vendedora con el cliente delante, así que va primero y con el foco puesto.
 * Debajo, la lista de lo pendiente, que es lo que hay que atender.
 */
export function pantallaCanjes({ ir }) {
  const donde = el('div');

  const entrada = el('input', {
    id: 'codigo',
    type: 'text',
    placeholder: 'Ej.: 7K2M9P',
    autocomplete: 'off',
    autocapitalize: 'characters',
    maxlength: '6',
  });
  // Se sube a mayúsculas mientras escribe: el código está en mayúsculas y el
  // teclado de un móvil no lo está.
  entrada.addEventListener('input', () => {
    entrada.value = entrada.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  const boton = el('button', { clase: 'boton', type: 'submit', texto: 'Buscar el código' });
  const buscar = el('form', { clase: 'tarjeta', novalidate: true }, [
    el('h1', { texto: 'Entregar un premio' }),
    el('label', { clase: 'campo', for: 'codigo' }, [
      el('span', { clase: 'etiqueta', texto: 'El código que trae el socio' }),
      entrada,
    ]),
    boton,
  ]);

  alEnviar(buscar, boton, async () => {
    const canje = await api.verCanje(entrada.value);
    donde.replaceChildren(confirmarEntrega(canje, () => pintar(), ir));
  });

  async function pintar() {
    donde.replaceChildren(buscar, cargando());
    try {
      const { canjes } = await api.canjes('solicitado');
      donde.replaceChildren(buscar, lista(canjes, ir));
      queueMicrotask(() => entrada.focus());
    } catch (fallo) {
      donde.replaceChildren(buscar, problema(fallo.message, pintar));
    }
  }

  function lista(canjes, ir) {
    if (!canjes.length) {
      return el('div', { clase: 'tarjeta' }, [
        el('h2', { texto: 'Pendientes de recoger' }),
        el('p', { clase: 'nota', texto: 'Ninguno ahora mismo.' }),
      ]);
    }
    return el('div', { clase: 'tarjeta' }, [
      el('h2', { texto: `Pendientes de recoger (${canjes.length})` }),
      el(
        'ul',
        { clase: 'lista' },
        canjes.map((c) =>
          el('li', {}, [
            el('div', { clase: 'linea' }, [
              el('span', { texto: c.socio }),
              el('span', { clase: 'codigo-chico', texto: c.codigo }),
            ]),
            el('span', {
              clase: 'cuando',
              texto: `${c.premioNombre} · ${comoPuntos(c.puntos)} pts · pedido el ${comoFecha(c.solicitadoEn)}`,
            }),
            el('button', {
              clase: 'enlace-accion',
              type: 'button',
              texto: 'Entregarlo',
              onclick: async () => {
                try {
                  const canje = await api.verCanje(c.codigo);
                  donde.replaceChildren(confirmarEntrega(canje, pintar, ir));
                } catch (fallo) {
                  alert(fallo.message);
                }
              },
            }),
          ]),
        ),
      ),
    ]);
  }

  pintar();
  return donde;
}

/**
 * La confirmación antes de entregar.
 *
 * Se enseña de quién es y qué es ANTES de sellar, porque entregar no se puede
 * deshacer: los puntos salieron cuando el socio lo pidió, y una entrega sellada
 * por error solo se corrige con un ajuste manual.
 */
function confirmarEntrega(canje, volver, ir) {
  if (canje.estado !== 'solicitado') {
    return el('div', { clase: 'tarjeta' }, [
      el('h1', { texto: 'Ese código ya no vale' }),
      aviso(
        canje.estado === 'entregado'
          ? `Ya se entregó el ${comoFecha(canje.entregadoEn)}.`
          : canje.estado === 'vencido'
            ? 'Venció y los puntos ya volvieron a su cuenta. Puede pedirlo otra vez.'
            : 'Se canceló y los puntos ya volvieron a su cuenta.',
        'espera',
      ),
      el('button', { clase: 'boton secundario', texto: 'Volver', onclick: volver }),
    ]);
  }

  const boton = el('button', { clase: 'boton', type: 'submit', texto: 'Entregar' });
  const formulario = el('form', { clase: 'tarjeta centrada' }, [
    el('p', { clase: 'antetitulo', texto: 'Confirma antes de entregar' }),
    el('h1', { texto: canje.premioNombre }),
    el('p', { clase: 'grande' }, [
      document.createTextNode('Para '),
      el('b', { texto: canje.socio }),
    ]),
    el('p', {
      clase: 'nota',
      texto:
        `${comoPuntos(canje.puntos)} puntos · pedido el ${comoFecha(canje.solicitadoEn)} · ` +
        `código ${canje.codigo}`,
    }),
    canje.premioTipo === 'descuento'
      ? aviso(
          `Es un descuento de ${comoDolares(canje.valorCentavos)}: aplícalo en la compra que ` +
            'esté haciendo ahora. Los puntos ya salieron de su cuenta.',
          'espera',
        )
      : null,
    boton,
  ]);

  alEnviar(formulario, boton, async () => {
    await api.entregarCanje(canje.codigo);
    formulario.replaceWith(
      el('div', { clase: 'tarjeta centrada' }, [
        el('p', { clase: 'antetitulo', texto: 'Entregado' }),
        el('h1', { texto: canje.premioNombre }),
        el('p', { clase: 'grande', texto: `Listo. ${canje.socio} ya lo tiene.` }),
        el('button', { clase: 'boton', texto: 'Atender otro', onclick: volver }),
        el('button', {
          clase: 'boton secundario',
          texto: 'Ver su ficha',
          onclick: () => ir(`#/socio/${canje.socioCodigo}`),
        }),
      ]),
    );
  });

  return formulario;
}
