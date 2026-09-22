/**
 * El selector de cumpleaños. Lo usan la app del socio y el panel del equipo.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ NO ES UN CALENDARIO, NI UN `<input type="date">`
 *
 * Los dos parecen la respuesta obvia y los dos están mal para este campo.
 *
 * `<input type="date">` EXIGE UN AÑO. Este sistema guarda solo el día y el mes,
 * a propósito: el año de nacimiento no hace falta para felicitar a nadie y es
 * un dato personal más que custodiar sin ganar nada (ver `cumple` en
 * `migraciones/0001_socios.sql`). Con un campo de fecha habría que pedir un año
 * para tirarlo, y el teclado nativo obliga además a retroceder cuarenta años
 * desde hoy, pantalla a pantalla.
 *
 * UN CALENDARIO DE CUADRÍCULA es peor todavía. Sirve para elegir una fecha que
 * no sabes —una cita, un vuelo— mirando en qué día de la semana cae. Nadie
 * elige su cumpleaños mirando un calendario: se lo sabe. Una cuadrícula lo
 * obliga a navegar meses para llegar a un dato que ya tenía en la punta de la
 * lengua.
 *
 * Dos listas, un toque cada una. El mes con su nombre escrito —«marzo», no
 * «03»— porque `15-03` y `03-15` se confunden en Panamá según quién lo escriba,
 * y un nombre no se confunde con nada. Y debajo, la fecha releída en palabras,
 * que es lo que convierte «creo que le di bien» en «sí, 15 de marzo».
 *
 * ---------------------------------------------------------------------------
 * EL 29 DE FEBRERO EXISTE
 *
 * Sin año no hay forma de saber si un febrero es bisiesto, así que la lista de
 * febrero llega a 29 siempre. Quien nació ese día tiene que poder decirlo: es
 * justo la persona a la que todos los formularios del mundo le dicen que su
 * cumpleaños no existe.
 */

const MESES = [
  ['01', 'enero', 31],
  ['02', 'febrero', 29],
  ['03', 'marzo', 31],
  ['04', 'abril', 30],
  ['05', 'mayo', 31],
  ['06', 'junio', 30],
  ['07', 'julio', 31],
  ['08', 'agosto', 31],
  ['09', 'septiembre', 30],
  ['10', 'octubre', 31],
  ['11', 'noviembre', 30],
  ['12', 'diciembre', 31],
];

/** Cuántos días tiene ese mes. 31 si no se reconoce, para no recortar de más. */
export function diasDelMes(mm) {
  return MESES.find(([numero]) => numero === mm)?.[2] ?? 31;
}

/** `03-15` → `15 de marzo`. Vacío si no tiene esa forma. */
export function cumpleEnPalabras(valor) {
  const partes = /^(\d{2})-(\d{2})$/.exec((valor ?? '').trim());
  if (!partes) return '';
  const mes = MESES.find(([numero]) => numero === partes[1]);
  if (!mes) return '';
  const dia = Number(partes[2]);
  if (dia < 1 || dia > mes[2]) return '';
  return `${dia} de ${mes[1]}`;
}

/**
 * Monta el selector.
 *
 * Devuelve el nodo y un `valor()` que da `MM-DD` o cadena vacía. No es un
 * `<input>` con un `name`, así que quien lo use lee `valor()` en vez de mirar
 * el formulario: es lo que permite que las dos listas sean un solo dato.
 */
export function selectorDeCumple({ id = 'cumple', etiqueta = 'Tu cumpleaños', valor = '', nota } = {}) {
  const crear = (etiquetaTexto, opciones, ancho) => {
    const select = document.createElement('select');
    select.id = `${id}-${ancho}`;
    select.className = 'cumple-parte';
    select.setAttribute('aria-label', etiquetaTexto);
    for (const [v, t] of opciones) {
      const opcion = document.createElement('option');
      opcion.value = v;
      opcion.textContent = t;
      select.append(opcion);
    }
    return select;
  };

  const selMes = crear('Mes', [['', 'Mes'], ...MESES.map(([n, nombre]) => [n, nombre])], 'mes');
  const selDia = crear('Día', [['', 'Día']], 'dia');

  const leido = document.createElement('span');
  leido.className = 'nota cumple-leido';

  // La lista de días se rehace al cambiar de mes. Si el día elegido ya no
  // existe —31 y se pasa a febrero— se recorta al último del mes en vez de
  // vaciarse: perder el dato entero por cambiar el mes obliga a teclear dos
  // veces, y quien lo hace normalmente es alguien que se equivocó de mes.
  const rehacerDias = () => {
    const teniaPuesto = selDia.value;
    const tope = selMes.value ? diasDelMes(selMes.value) : 31;
    selDia.replaceChildren();
    const vacia = document.createElement('option');
    vacia.value = '';
    vacia.textContent = 'Día';
    selDia.append(vacia);
    for (let d = 1; d <= tope; d += 1) {
      const opcion = document.createElement('option');
      opcion.value = String(d).padStart(2, '0');
      opcion.textContent = String(d);
      selDia.append(opcion);
    }
    if (teniaPuesto) {
      selDia.value = Number(teniaPuesto) > tope ? String(tope).padStart(2, '0') : teniaPuesto;
    }
  };

  const releer = () => {
    const v = valorDe();
    leido.textContent = v ? cumpleEnPalabras(v) : '';
  };

  const valorDe = () => (selMes.value && selDia.value ? `${selMes.value}-${selDia.value}` : '');

  selMes.addEventListener('change', () => {
    rehacerDias();
    releer();
  });
  selDia.addEventListener('change', releer);

  rehacerDias();
  const inicial = /^(\d{2})-(\d{2})$/.exec((valor ?? '').trim());
  if (inicial) {
    selMes.value = inicial[1];
    rehacerDias();
    selDia.value = inicial[2];
  }
  releer();

  const caja = document.createElement('div');
  caja.className = 'campo cumple';

  const titulo = document.createElement('span');
  titulo.className = 'etiqueta';
  titulo.textContent = etiqueta;

  const fila = document.createElement('div');
  fila.className = 'cumple-fila';
  fila.append(selMes, selDia);

  caja.append(titulo, fila);
  if (nota) {
    const n = document.createElement('span');
    n.className = 'nota';
    n.textContent = nota;
    caja.append(n);
  }
  caja.append(leido);

  return { nodo: caja, valor: valorDe };
}
