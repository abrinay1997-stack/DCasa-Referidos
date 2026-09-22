/**
 * Las pantallas del socio.
 *
 * Cada una devuelve un elemento ya montado. No hay plantillas ni framework: son
 * seis pantallas con formularios de tres campos, y meter un empaquetador para
 * eso cuesta cuarenta kilobytes que este público paga en datos móviles.
 *
 * ---------------------------------------------------------------------------
 * TODO EL TEXTO SE PONE CON `textContent`, NUNCA CON `innerHTML`
 *
 * El nombre de un socio y el motivo de un ajuste los escribe una persona, y el
 * nombre del padrino viene del servidor. Si alguno se montara como HTML, quien
 * se registre con el nombre `<img onerror=…>` ejecutaría código en la pantalla
 * de cualquiera que lo vea — y quien lo ve es su padrino, en su lista de
 * referidos.
 *
 * La política de seguridad de `compartido/seguridad.ts` ya prohíbe los scripts
 * en línea, así que no bastaría con eso para robar una sesión. Pero las dos
 * defensas se ponen, no una: la segunda existe para el día que alguien afloje
 * la primera.
 * ---------------------------------------------------------------------------
 */

import { api, comoDolares, comoFecha, comoPuntos, cuantoLeQueda } from './api.js';
import { selectorDeCumple } from '../hub/cumple.js';

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

export function elemento(etiqueta, atributos = {}, hijos = []) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === 'clase') nodo.className = valor;
    else if (clave === 'texto') nodo.textContent = valor;
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo.setAttribute(clave, valor === true ? '' : valor);
  }
  for (const hijo of [].concat(hijos)) {
    if (hijo) nodo.append(hijo);
  }
  return nodo;
}

const el = elemento;

function campo({ id, etiqueta, tipo = 'text', nota, ...resto }) {
  return el('label', { clase: 'campo', for: id }, [
    el('span', { clase: 'etiqueta', texto: etiqueta }),
    el('input', { id, name: id, type: tipo, ...resto }),
    nota ? el('span', { clase: 'nota', texto: nota }) : null,
  ]);
}

/**
 * El aviso de error.
 *
 * `role="alert"` para que un lector de pantalla lo anuncie: quien no ve la
 * pantalla tiene que enterarse de que su PIN no cuadró igual que quien sí.
 */
function aviso(mensaje, tono = 'malo') {
  return el('p', { clase: `aviso ${tono}`, texto: mensaje, role: 'alert' });
}

function botonera(nodo, cargando) {
  nodo.disabled = cargando;
  nodo.textContent = cargando ? 'Un momento…' : nodo.dataset.texto;
}

/** Envuelve un envío: bloquea el botón, enseña el fallo, y lo desbloquea. */
function alEnviar(formulario, boton, accion) {
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    formulario.querySelectorAll('.aviso').forEach((n) => n.remove());
    botonera(boton, true);
    try {
      await accion();
    } catch (fallo) {
      formulario.append(aviso(fallo.mensaje ?? fallo.message));
      // El teclado del móvil tapa media pantalla: si el aviso sale debajo, el
      // socio no lo ve y vuelve a pulsar el mismo botón.
      formulario.querySelector('.aviso')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } finally {
      botonera(boton, false);
    }
  });
}

// ---------------------------------------------------------------------------
// Portada
// ---------------------------------------------------------------------------

export function portada({ padrino, ir }) {
  return el('div', { clase: 'tarjeta' }, [
    el('p', { clase: 'antetitulo', texto: 'Programa de socios' }),
    el('h1', { texto: 'Tu casa suma puntos' }),
    padrino
      ? el('p', { clase: 'invita' }, [
          document.createTextNode('Te invitó '),
          el('b', { texto: nombreDe(padrino) }),
          document.createTextNode(`${puntoFinal(padrino)} Regístrate y empieza a sumar.`),
        ])
      : el('p', {
          texto:
            'Cada compra en D’CASA te da puntos. Y cada persona que traigas, ' +
            'también. Cuando tengas suficientes, los cambias por lo que quieras de la tienda.',
        }),
    el('button', { clase: 'boton', texto: 'Soy nuevo', onclick: () => ir('#/registro') }),
    el('button', {
      clase: 'boton secundario',
      texto: 'Ya tengo cuenta',
      onclick: () => ir('#/entrar'),
    }),
  ]);
}

const nombreDe = (p) => (p.inicial ? `${p.nombre} ${p.inicial}` : p.nombre);

/**
 * El punto del final de la frase, salvo que el nombre ya traiga el suyo.
 *
 * `nombreDe` devuelve «María G.» —con punto, porque es una inicial abreviada— y
 * la frase que lo envuelve acababa poniendo otro: «Te invitó María G..». Es un
 * detalle, y es justo de los que hacen que una pieza parezca hecha con prisa.
 */
const puntoFinal = (p) => (p.inicial ? '' : '.');

// ---------------------------------------------------------------------------
// Entrar
// ---------------------------------------------------------------------------

export function entrar({ ir, entrado }) {
  const boton = el('button', { clase: 'boton', type: 'submit', texto: 'Entrar' });
  boton.dataset.texto = 'Entrar';

  const formulario = el('form', { clase: 'tarjeta', novalidate: true }, [
    el('p', { clase: 'antetitulo', texto: 'Tu cuenta' }),
    el('h1', { texto: 'Entra a tus puntos' }),
    campo({
      id: 'telefono',
      etiqueta: 'Tu celular',
      tipo: 'tel',
      inputmode: 'numeric',
      autocomplete: 'tel',
      placeholder: '6026-1919',
      required: true,
    }),
    campo({
      id: 'pin',
      etiqueta: 'Tu PIN',
      tipo: 'password',
      inputmode: 'numeric',
      autocomplete: 'current-password',
      maxlength: '6',
      placeholder: '6 números',
      required: true,
    }),
    boton,
    el('a', {
      clase: 'enlace',
      texto: 'Olvidé mi PIN',
      href:
        'https://wa.me/50760261919?text=' +
        encodeURIComponent('Hola D’CASA, olvidé el PIN de mi cuenta de socio. Mi número es '),
      target: '_blank',
      rel: 'noopener',
    }),
    el('button', {
      clase: 'boton secundario',
      type: 'button',
      texto: 'No tengo cuenta',
      onclick: () => ir('#/registro'),
    }),
  ]);

  alEnviar(formulario, boton, async () => {
    const socio = await api.entrar(formulario.telefono.value, formulario.pin.value);
    entrado(socio);
  });

  return formulario;
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

export function registro({ padrino, ir, entrado }) {
  const boton = el('button', { clase: 'boton', type: 'submit', texto: 'Crear mi cuenta' });
  boton.dataset.texto = 'Crear mi cuenta';

  // Dos listas y no un campo de texto. El porqué está en `hub/cumple.js`: sin
  // año no hay `<input type="date">` que valga, y `15-03` y `03-15` se
  // confunden según quién los escriba.
  const cumple = selectorDeCumple({
    etiqueta: 'Tu cumpleaños (opcional)',
    nota: 'Te regalamos puntos ese día. No pedimos el año.',
  });

  const formulario = el('form', { clase: 'tarjeta', novalidate: true }, [
    el('p', { clase: 'antetitulo', texto: 'Toma menos de un minuto' }),
    el('h1', { texto: 'Crea tu cuenta' }),
    padrino
      ? el('p', { clase: 'invita' }, [
          document.createTextNode('Te invitó '),
          el('b', { texto: nombreDe(padrino) }),
          document.createTextNode(puntoFinal(padrino)),
        ])
      : null,
    campo({ id: 'nombre', etiqueta: 'Tu nombre', autocomplete: 'given-name', required: true }),
    campo({ id: 'apellido', etiqueta: 'Tu apellido', autocomplete: 'family-name' }),
    campo({
      id: 'telefono',
      etiqueta: 'Tu celular',
      tipo: 'tel',
      inputmode: 'numeric',
      autocomplete: 'tel',
      placeholder: '6026-1919',
      required: true,
      nota: 'Con este número entras a tu cuenta.',
    }),
    campo({
      id: 'pin',
      etiqueta: 'Inventa un PIN',
      tipo: 'password',
      inputmode: 'numeric',
      autocomplete: 'new-password',
      maxlength: '6',
      placeholder: '6 números',
      required: true,
      nota: 'Que no sea 123456 ni parte de tu celular.',
    }),
    // El código del comprobante. Solo hace falta para RECLAMAR una ficha que ya
    // tiene puntos —quien compró antes de entrar al programa— y por eso va con
    // su explicación al lado en vez de esconderse: quien viene con el papel en
    // la mano tiene que entender en un vistazo que ese campo es para él.
    campo({
      id: 'codigo',
      etiqueta: 'Código de tu comprobante (si ya compraste aquí)',
      tipo: 'text',
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      placeholder: 'DCA…',
      nota: 'Está impreso en tu comprobante. Sirve para reclamar los puntos que ya tienes.',
    }),
    campo({
      id: 'correo',
      etiqueta: 'Tu correo (opcional)',
      tipo: 'email',
      inputmode: 'email',
      autocomplete: 'email',
      autocapitalize: 'off',
      spellcheck: 'false',
      placeholder: 'tucorreo@ejemplo.com',
      nota: 'Por si hay que avisarte de algo del programa. No lo usamos para publicidad.',
    }),
    cumple.nodo,
    el('label', { clase: 'casilla', for: 'acepta' }, [
      el('input', { id: 'acepta', name: 'acepta', type: 'checkbox' }),
      el('span', {}, [
        document.createTextNode('Acepto los '),
        el('a', { href: '#/terminos', texto: 'términos del programa' }),
        document.createTextNode(' y que D’CASA guarde mis datos para administrarlo.'),
      ]),
    ]),
    boton,
    el('button', {
      clase: 'boton secundario',
      type: 'button',
      texto: 'Ya tengo cuenta',
      onclick: () => ir('#/entrar'),
    }),
  ]);

  alEnviar(formulario, boton, async () => {
    if (!formulario.acepta.checked) {
      throw new Error('Para entrar al programa hay que aceptar los términos.');
    }
    const socio = await api.registro({
      nombre: formulario.nombre.value,
      apellido: formulario.apellido.value,
      telefono: formulario.telefono.value,
      pin: formulario.pin.value,
      // El campo se pide como «15-03» porque así se dice una fecha en Panamá,
      // y el servidor la quiere como «MM-DD». Se da la vuelta aquí en vez de
      // pedirle al socio que la escriba al revés.
      correo: formulario.correo.value,
      codigo: formulario.codigo.value,
      cumple: cumple.valor(),
      referido: padrino?.codigo,
      acepta: true,
    });
    entrado(socio);
  });

  return formulario;
}

// ---------------------------------------------------------------------------
// Mis puntos
// ---------------------------------------------------------------------------

export function misPuntos({ socio, saldo, encendido, ir, salir }) {
  return el('div', {}, [
    el('div', { clase: 'tarjeta centrada' }, [
      el('p', { clase: 'antetitulo', texto: `Hola, ${socio.nombre}` }),
      el('div', { clase: 'placa' }, [
        el('span', { clase: 'numero', texto: comoPuntos(saldo) }),
        el('span', { clase: 'unidad', texto: saldo === 1 ? 'punto' : 'puntos' }),
      ]),
      el('p', { clase: 'codigo' }, [
        document.createTextNode('Tu código: '),
        el('b', { texto: socio.codigo }),
      ]),
    ]),

    el('div', { clase: 'tarjeta' }, [
      el('button', { clase: 'fila', texto: 'Cambiar por premios', onclick: () => ir('#/premios') }),
      el('button', { clase: 'fila', texto: 'Mis premios', onclick: () => ir('#/mis-premios') }),
      el('button', { clase: 'fila', texto: 'Mi actividad', onclick: () => ir('#/actividad') }),
      el('button', { clase: 'fila', texto: 'Cómo funciona', onclick: () => ir('#/terminos') }),
      // «Invita y gana» no se enseña mientras el servidor no pueda pagar un
      // referido. Prometer una recompensa que el sistema no puede acreditar es
      // peor que no ofrecerla, y este programa se vende entero sobre que las
      // cuentas cuadran.
      encendido?.referidos
        ? el('button', { clase: 'fila', texto: 'Invita y gana', onclick: () => ir('#/invita') })
        : null,
      el('a', {
        clase: 'fila',
        texto: 'Escríbenos por WhatsApp',
        href: 'https://wa.me/50760261919',
        target: '_blank',
        rel: 'noopener',
      }),
    ]),

    !encendido?.compras
      ? el('div', { clase: 'tarjeta' }, [
          el('p', {
            clase: 'nota',
            texto:
              'Estamos terminando de montar el programa. Tu cuenta ya está creada y ' +
              'guardamos todo lo que compres.',
          }),
        ])
      : null,

    el('button', { clase: 'boton secundario', texto: 'Salir', onclick: salir }),
  ]);
}

// ---------------------------------------------------------------------------
// Mi actividad
// ---------------------------------------------------------------------------

const COMO_SE_LLAMA = {
  bienvenida: 'Regalo de bienvenida',
  compra: 'Tu compra',
  referido: 'Alguien que invitaste compró',
  canje: 'Cambiaste un premio',
  ajuste: 'Ajuste',
  reverso: 'Corrección',
  cumpleanos: 'Regalo de cumpleaños',
  vencimiento: 'Puntos vencidos',
};

export function actividad({ filas, ir }) {
  if (!filas.length) {
    return el('div', { clase: 'tarjeta' }, [
      el('h1', { texto: 'Tu actividad' }),
      el('p', { texto: 'Todavía no hay nada que contar. Tu primera compra aparecerá aquí.' }),
      el('button', { clase: 'boton secundario', texto: 'Volver', onclick: () => ir('#/puntos') }),
    ]);
  }

  return el('div', { clase: 'tarjeta' }, [
    el('h1', { texto: 'Tu actividad' }),
    el(
      'ul',
      { clase: 'bitacora' },
      filas.map((f) =>
        el('li', {}, [
          el('div', { clase: 'linea' }, [
            el('span', { clase: 'que', texto: COMO_SE_LLAMA[f.tipo] ?? 'Movimiento' }),
            el('span', {
              clase: `puntos ${f.puntos < 0 ? 'resta' : 'suma'}`,
              texto: `${f.puntos > 0 ? '+' : ''}${comoPuntos(f.puntos)}`,
            }),
          ]),
          el('span', { clase: 'cuando', texto: comoFecha(f.ocurridoEn) }),
          // El motivo de una corrección se enseña SIEMPRE. Que el socio pueda
          // leer por qué le quitaron puntos es lo que hace creíble el programa:
          // es la regla de marca «di qué no incluye», aplicada a un saldo.
          f.motivo ? el('p', { clase: 'motivo', texto: f.motivo }) : null,
        ]),
      ),
    ),
    el('button', { clase: 'boton secundario', texto: 'Volver', onclick: () => ir('#/puntos') }),
  ]);
}

// ---------------------------------------------------------------------------

export function cargando() {
  return el('div', { clase: 'tarjeta centrada' }, [el('p', { clase: 'nota', texto: 'Un momento…' })]);
}

export function problema(mensaje, reintentar) {
  return el('div', { clase: 'tarjeta' }, [
    aviso(mensaje),
    reintentar
      ? el('button', { clase: 'boton secundario', texto: 'Reintentar', onclick: reintentar })
      : null,
  ]);
}

// ---------------------------------------------------------------------------
// Invita y gana
// ---------------------------------------------------------------------------

/**
 * La pantalla que hace funcionar el programa entero.
 *
 * En Panamá los referidos se mueven por WhatsApp, no por correo ni por enlaces
 * copiados a mano. Por eso el botón de compartir es el elemento principal y no
 * un añadido al final: es el único que de verdad trae gente nueva.
 */
export function invita({ datos, ir }) {
  const { codigo, enlace, alPadrino, alAhijado, traidos } = datos;

  const mensaje =
    `Te invito al programa de puntos de D’CASA. ` +
    (alAhijado ? `Regístrate con mi código y empiezas con ${alAhijado} puntos: ` : 'Regístrate aquí: ') +
    enlace;

  const copiar = el('button', { clase: 'boton secundario', texto: 'Copiar mi enlace' });
  copiar.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(enlace);
      copiar.textContent = 'Copiado';
      setTimeout(() => (copiar.textContent = 'Copiar mi enlace'), 2000);
    } catch {
      // Sin permiso de portapapeles —pasa en algunos navegadores de móvil—, se
      // selecciona el texto para que al menos se pueda copiar a mano.
      const campo = document.getElementById('mi-enlace');
      campo?.focus();
      campo?.select?.();
      copiar.textContent = 'Cópialo de arriba';
    }
  });

  return el('div', {}, [
    el('div', { clase: 'tarjeta centrada' }, [
      el('p', { clase: 'antetitulo', texto: 'Invita y gana' }),
      el('h1', { texto: `Gana ${comoPuntos(alPadrino)} puntos` }),
      el('p', {
        texto:
          `Comparte tu código. Cuando la persona que traigas haga su primera compra, ` +
          `${comoPuntos(alPadrino)} puntos caen en tu cuenta` +
          (alAhijado ? ` y ${comoPuntos(alAhijado)} en la suya.` : '.'),
      }),

      el('div', { clase: 'placa' }, [
        el('span', { clase: 'codigo-grande', texto: codigo }),
      ]),

      el('input', { id: 'mi-enlace', clase: 'enlace-copiable', type: 'text', value: enlace, readonly: true }),

      el('a', {
        clase: 'boton',
        texto: 'Compartir por WhatsApp',
        href: `https://wa.me/?text=${encodeURIComponent(mensaje)}`,
        target: '_blank',
        rel: 'noopener',
      }),
      copiar,
    ]),

    el('div', { clase: 'tarjeta' }, [
      el('h2', { texto: 'A quién has traído' }),
      traidos.length
        ? el(
            'ul',
            { clase: 'bitacora' },
            traidos.map((t) =>
              el('li', {}, [
                el('div', { clase: 'linea' }, [
                  el('span', { clase: 'que', texto: t.nombre }),
                  t.compro
                    ? el('span', { clase: 'puntos suma', texto: `+${comoPuntos(t.puntos)}` })
                    : el('span', { clase: 'cuando', texto: 'Aún no ha comprado' }),
                ]),
                el('span', { clase: 'cuando', texto: `Desde ${comoFecha(t.desde)}` }),
              ]),
            ),
          )
        : el('p', {
            clase: 'nota',
            texto: 'Todavía no has traído a nadie. Comparte tu enlace y aparecerán aquí.',
          }),
    ]),

    el('button', { clase: 'boton secundario', texto: 'Volver', onclick: () => ir('#/puntos') }),
  ]);
}

// ---------------------------------------------------------------------------
// Premios
// ---------------------------------------------------------------------------

/**
 * El catálogo.
 *
 * Los premios que el socio todavía no alcanza salen igual, atenuados y con su
 * «te faltan X». Esconderlos quitaría lo único que hace que alguien vuelva: ver
 * lo que está a punto de conseguir.
 */
export function premios({ datos, ir, pedir }) {
  const { saldo, premios: lista } = datos;

  return el('div', {}, [
    el('div', { clase: 'tarjeta centrada' }, [
      el('p', { clase: 'antetitulo', texto: 'Tus puntos' }),
      el('div', { clase: 'placa' }, [
        el('span', { clase: 'numero', texto: comoPuntos(saldo) }),
        el('span', { clase: 'unidad', texto: saldo === 1 ? 'punto' : 'puntos' }),
      ]),
    ]),

    el('div', { clase: 'tarjeta' }, [
      el('h1', { texto: 'Cámbialos' }),
      lista.length
        ? el(
            'ul',
            { clase: 'premios' },
            lista.map((p) => {
              const alcanza = p.faltan === 0;
              return el('li', { clase: alcanza ? '' : 'lejos' }, [
                el('div', { clase: 'linea' }, [
                  el('span', { clase: 'que', texto: p.nombre }),
                  el('span', { clase: 'puntos suma', texto: comoPuntos(p.puntos) }),
                ]),
                p.descripcion ? el('span', { clase: 'cuando', texto: p.descripcion }) : null,
                alcanza
                  ? el('button', {
                      clase: 'boton chico',
                      texto: 'Pedirlo',
                      onclick: () => pedir(p),
                    })
                  : el('span', {
                      clase: 'faltan',
                      texto: `Te faltan ${comoPuntos(p.faltan)}`,
                    }),
              ]);
            }),
          )
        : el('p', { clase: 'nota', texto: 'Todavía no hay premios. Pronto los habrá.' }),
    ]),

    el('button', { clase: 'boton secundario', texto: 'Volver', onclick: () => ir('#/puntos') }),
  ]);
}

/**
 * El código que el socio enseña en la tienda.
 *
 * Grande, monoespaciado y con la cuenta atrás a la vista. Es lo que va a leer
 * una vendedora desde el otro lado del mostrador, en un teléfono que no es el
 * suyo.
 */
export function miCanje({ canje, ir, cancelar }) {
  return el('div', {}, [
    el('div', { clase: 'tarjeta centrada' }, [
      el('p', { clase: 'antetitulo', texto: 'Enséñalo en la tienda' }),
      el('h1', { texto: canje.premioNombre }),
      el('div', { clase: 'placa' }, [
        el('span', { clase: 'codigo-grande', texto: canje.codigo }),
      ]),
      el('p', { clase: 'grande', texto: cuantoLeQueda(canje.expiraEn) }),
      el('p', {
        clase: 'nota',
        texto:
          'Si no pasas antes de que venza, te devolvemos los puntos enteros y ' +
          'lo puedes pedir otra vez.',
      }),
      el('a', {
        clase: 'boton',
        texto: 'Cómo llegar',
        href: 'https://waze.com/ul/hd1x62rvjc',
        target: '_blank',
        rel: 'noopener',
      }),
      el('button', {
        clase: 'boton secundario',
        texto: 'Cancelarlo y recuperar mis puntos',
        onclick: () => cancelar(canje),
      }),
    ]),
    el('button', { clase: 'boton secundario', texto: 'Volver', onclick: () => ir('#/puntos') }),
  ]);
}

const NOMBRE_ESTADO = {
  solicitado: 'Pendiente de recoger',
  entregado: 'Entregado',
  vencido: 'Venció · puntos devueltos',
  cancelado: 'Cancelado · puntos devueltos',
};

export function misCanjes({ canjes, ir }) {
  return el('div', { clase: 'tarjeta' }, [
    el('h1', { texto: 'Mis premios' }),
    canjes.length
      ? el(
          'ul',
          { clase: 'bitacora' },
          canjes.map((c) =>
            el('li', {}, [
              el('div', { clase: 'linea' }, [
                el('span', { clase: 'que', texto: c.premioNombre }),
                el('span', { clase: 'puntos resta', texto: `-${comoPuntos(c.puntos)}` }),
              ]),
              el('span', { clase: 'cuando', texto: NOMBRE_ESTADO[c.estado] ?? c.estado }),
              c.estado === 'solicitado'
                ? el('button', {
                    clase: 'enlace-accion',
                    texto: `Ver mi código · ${cuantoLeQueda(c.expiraEn)}`,
                    onclick: () => ir(`#/canje/${c.codigo}`),
                  })
                : null,
            ]),
          ),
        )
      : el('p', { clase: 'nota', texto: 'Todavía no has cambiado ningún premio.' }),
    el('button', { clase: 'boton secundario', texto: 'Volver', onclick: () => ir('#/puntos') }),
  ]);
}

// ---------------------------------------------------------------------------
// Términos
// ---------------------------------------------------------------------------

/**
 * Los términos del programa.
 *
 * ---------------------------------------------------------------------------
 * SIN LETRA CHICA, Y ES UNA DECISIÓN DE MARCA
 *
 * D'CASA se vende sobre la ausencia de trampa. Unos términos escritos para que
 * nadie los lea contradirían eso más de lo que protegerían a nadie.
 *
 * Así que están en la misma voz que el resto de la app, dicen lo que NO hacen
 * los puntos antes que lo que sí, y el aviso de privacidad va entero y no
 * enlazado a otro sitio.
 *
 * Lo que se dice aquí es lo que el código hace de verdad. Si alguna vez dejan
 * de coincidir, lo que está mal es el código.
 * ---------------------------------------------------------------------------
 */
export function terminos({ reglas, ir, hayVuelta }) {
  const apartado = (titulo, ...parrafos) =>
    el('section', {}, [
      el('h2', { texto: titulo }),
      ...parrafos.map((t) => (typeof t === 'string' ? el('p', { texto: t }) : t)),
    ]);

  return el('div', {}, [
    el('div', { clase: 'tarjeta' }, [
      el('p', { clase: 'antetitulo', texto: 'Programa de socios' }),
      el('h1', { texto: 'Cómo funciona' }),

      apartado(
        'Tus puntos no son dinero',
        'No se cambian por efectivo, no se transfieren a otra persona y no se heredan. ' +
          'Sirven para lo que dice el catálogo de premios y para nada más.',
      ),

      apartado(
        'Cómo los ganas',
        reglas?.puntosPorDolar
          ? `Ganas ${reglas.puntosPorDolar} punto por cada dólar que pagas, calculado sobre el ` +
              'total de tu factura con el ITBMS incluido.'
          : 'Ganas puntos por cada compra que hagas en la tienda.',
        reglas?.compraMinimaCentavos
          ? `Las compras de menos de ${comoDolares(reglas.compraMinimaCentavos)} no suman puntos.`
          : null,
        'Una vendedora registra tu compra en el momento. Si no la registró, escríbenos y lo revisamos.',
      ),

      apartado(
        'Cómo ganas invitando',
        reglas?.puntosAlPadrino
          ? `Cuando alguien se registra con tu código y hace su primera compra, tú ganas ` +
              `${comoPuntos(reglas.puntosAlPadrino)} puntos` +
              (reglas.puntosAlAhijado ? ` y esa persona gana ${comoPuntos(reglas.puntosAlAhijado)}.` : '.')
          : 'Puedes invitar a otras personas con tu código.',
        'Se paga una sola vez por persona, y solo cuando esa persona compra de verdad. ' +
          'Registrarse no paga nada.',
        reglas?.topeDePuntosPorPadrinoAlMes && reglas?.puntosAlPadrino
          ? `Hay un tope de ${Math.floor(reglas.topeDePuntosPorPadrinoAlMes / reglas.puntosAlPadrino)} ` +
              'invitaciones cobrables al mes' +
              (reglas.topeDeAhijadosPorPadrino
                ? `, y de ${comoPuntos(reglas.topeDeAhijadosPorPadrino)} personas en total.`
                : '.')
          : null,
      ),

      // El cumpleaños se acredita solo, sin que el socio pida nada. Si no
      // estuviera escrito aquí, el día que le entren 500 puntos de la nada
      // tendría que preguntar de dónde salieron — y un punto que aparece sin
      // explicación se parece demasiado a un error.
      reglas?.puntosDeCumpleanos
        ? apartado(
            'Tu cumpleaños',
            `El día de tu cumpleaños te regalamos ${comoPuntos(reglas.puntosDeCumpleanos)} puntos, ` +
              'una vez al año. Aparecen solos en tu cuenta.',
            'Para eso hay que haber comprado alguna vez. Si nunca has comprado, no entran.',
          )
        : null,

      apartado(
        'Cómo los cambias',
        'Pides el premio desde aquí, te sale un código y lo enseñas en la tienda. ' +
          'Los puntos salen de tu cuenta en el momento de pedirlo.',
        `Tienes ${reglas?.vigenciaDelCodigoHoras ?? 72} horas para pasar. Si no vas, el código vence y ` +
          'te devolvemos los puntos enteros: puedes volver a pedirlo cuando quieras.',
        'Un premio ya entregado no se devuelve.',
      ),

      apartado(
        '¿Vencen?',
        reglas?.vencimientoMeses
          ? `Sí, a los ${reglas.vencimientoMeses} meses. Te avisamos 30 días antes.`
          : 'No. Tus puntos se quedan ahí. Si algún día eso cambiara, te avisaríamos con ' +
              '30 días de antelación antes de que venciera ninguno.',
      ),

      apartado(
        'Si anulamos una compra',
        'Si una compra se anula —una devolución, un error al registrarla— los puntos que dio ' +
          'salen de tu cuenta, y en tu actividad queda escrito por qué. Nunca te quitamos ' +
          'puntos sin decirte el motivo.',
      ),

      apartado(
        'Lo que podemos cambiar',
        'Podemos cambiar el catálogo de premios y cuántos puntos cuesta cada uno. ' +
          'Lo que ya pediste se respeta al precio que tenía cuando lo pediste.',
      ),

      apartado(
        'Tus datos',
        'Guardamos tu nombre, tu celular, y si nos los diste, tu cédula, tu correo y el día ' +
          'y mes de tu cumpleaños. No guardamos el año. Guardamos también qué compraste con ' +
          'nosotros y cuántos puntos tienes.',
        'Los usamos solo para administrar este programa. No se los vendemos ni se los damos ' +
          'a nadie.',
        el('p', {}, [
          document.createTextNode(
            'Puedes pedirnos ver tus datos, corregirlos o borrarlos cuando quieras, como dice ' +
              'la Ley 81 de 2019 de Panamá. Escríbenos a ',
          ),
          el('a', { href: 'mailto:info@dcasapty.com', texto: 'info@dcasapty.com' }),
          document.createTextNode(' o por WhatsApp al +507 6026-1919.'),
        ]),
      ),

      el('p', { clase: 'nota', texto: 'D’CASA Panamá · La Chorrera, Panamá Oeste.' }),

      hayVuelta
        ? el('button', { clase: 'boton secundario', texto: 'Volver', onclick: () => ir('#/puntos') })
        : el('button', { clase: 'boton secundario', texto: 'Volver', onclick: () => ir('#/registro') }),
    ]),
  ]);
}
