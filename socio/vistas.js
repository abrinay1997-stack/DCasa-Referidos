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

import { api, comoFecha, comoPuntos } from './api.js';

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
    campo({
      id: 'cumple',
      etiqueta: 'Tu cumpleaños (opcional)',
      tipo: 'text',
      inputmode: 'numeric',
      placeholder: 'Día y mes: 15-03',
      nota: 'No pedimos el año.',
    }),
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
      cumple: alRevesElCumple(formulario.cumple.value),
      referido: padrino?.codigo,
      acepta: true,
    });
    entrado(socio);
  });

  return formulario;
}

/** `15-03` → `03-15`. Vacío si no tiene esa forma. */
export function alRevesElCumple(valor) {
  const partes = /^(\d{1,2})[-/](\d{1,2})$/.exec((valor ?? '').trim());
  if (!partes) return '';
  const dia = partes[1].padStart(2, '0');
  const mes = partes[2].padStart(2, '0');
  return `${mes}-${dia}`;
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
      el('button', {
        clase: 'fila',
        texto: 'Mi actividad',
        onclick: () => ir('#/actividad'),
      }),
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
