/**
 * La ayuda emergente: un «?» que se toca y explica.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ NO ES UN `title=""`
 *
 * El atributo `title` del navegador NO EXISTE en un teléfono. No hay puntero
 * que se quede quieto encima, así que el texto no sale nunca. Y este panel se
 * usa de pie, con el cliente delante, desde un celular: una ayuda que solo ven
 * los de escritorio no es una ayuda, es una ayuda para nadie.
 *
 * Tampoco se abre al pasar el ratón. `:hover` tiene el mismo problema al revés
 * —en táctil se queda pegado tras el primer toque— así que esto se abre y se
 * cierra con un toque o un clic, igual en los dos sitios.
 *
 * ---------------------------------------------------------------------------
 * QUÉ VA AQUÍ DENTRO Y QUÉ NO
 *
 * Aquí va el PORQUÉ. Lo que hace falta para decidir se queda escrito en la
 * pantalla, siempre: «el celular es con lo que el cliente entra la próxima
 * vez» es un dato que cambia lo que la vendedora teclea, y esconderlo detrás
 * de un botón lo convierte en un dato que nadie lee.
 *
 * Detrás del «?» va lo que explica una decisión ya tomada: por qué esta
 * pantalla pide la factura fiscal, por qué los precios van sin ITBMS, por qué
 * una ficha con ventas no se borra del todo. Quien ya lo sabe no lo vuelve a
 * leer; quien llega nuevo lo toca una vez.
 *
 * NUNCA va aquí un aviso de error ni una advertencia de algo que no se
 * deshace: eso se lee sin tener que buscarlo.
 */

/** Cuál está abierta. Solo una a la vez: dos globos abiertos tapan la pantalla. */
let abierta = null;

function cerrarLaAbierta() {
  if (!abierta) return;
  abierta.boton.setAttribute('aria-expanded', 'false');
  abierta.globo.hidden = true;
  abierta = null;
}

// Un solo par de escuchas para toda la página, y no uno por cada ayuda: con
// veinte «?» en una pantalla, veinte escuchas de `click` en el documento son
// veinte funciones corriendo en cada toque.
if (typeof document !== 'undefined' && !document.__ayudaMontada) {
  document.__ayudaMontada = true;
  document.addEventListener('click', (evento) => {
    if (!abierta) return;
    if (abierta.caja.contains(evento.target)) return;
    cerrarLaAbierta();
  });
  document.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Escape' || !abierta) return;
    const volverA = abierta.boton;
    cerrarLaAbierta();
    // El foco vuelve al «?»: quien navega con teclado no puede quedarse en un
    // elemento que acaba de desaparecer.
    volverA.focus();
  });
}

let siguienteId = 0;

/**
 * Un «?» con su explicación.
 *
 * Devuelve un `<span>` listo para meter al lado de una etiqueta. El texto va
 * con `textContent`, nunca como HTML, por lo mismo que en todas las pantallas.
 */
export function ayuda(texto, { etiqueta = 'Qué es esto' } = {}) {
  siguienteId += 1;
  const id = `ayuda-${siguienteId}`;

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'ayuda-boton';
  boton.textContent = '?';
  // El «?» no dice nada a quien no lo ve. El nombre accesible sí.
  boton.setAttribute('aria-label', etiqueta);
  boton.setAttribute('aria-expanded', 'false');
  boton.setAttribute('aria-controls', id);

  const globo = document.createElement('span');
  globo.className = 'ayuda-globo';
  globo.id = id;
  globo.textContent = texto;
  globo.hidden = true;
  // `role="status"` y no `alert`: esto no interrumpe, se anuncia cuando el
  // lector de pantalla llegue. Un `alert` corta lo que se esté leyendo.
  globo.setAttribute('role', 'status');

  const caja = document.createElement('span');
  caja.className = 'ayuda';
  caja.append(boton, globo);

  boton.addEventListener('click', () => {
    const estaba = abierta?.boton === boton;
    cerrarLaAbierta();
    if (estaba) return;
    boton.setAttribute('aria-expanded', 'true');
    globo.hidden = false;
    abierta = { boton, globo, caja };
    acomodar(globo);
  });

  return caja;
}

/**
 * Empuja el globo hacia dentro si se sale de la pantalla.
 *
 * ESTO SE MIDE, NO SE ADIVINA. La primera versión lo resolvía en CSS con
 * `:nth-last-child`, apostando a que el último «?» de un grupo estaría cerca
 * del borde derecho. `nth-last-child` cuenta hermanos en el árbol, no
 * posiciones en la pantalla: en la pantalla de venta eso mandó un globo a
 * empezar en la coordenada −155 de una ventana de 360, o sea medio globo fuera
 * y sin forma de leerlo.
 *
 * Se mide al abrir y no una vez al cargar, así que girar el teléfono, cambiar
 * el tamaño de letra o abrir el teclado no dejan la medida vieja: la siguiente
 * vez que se abra se vuelve a medir.
 */
const MARGEN = 12;

function acomodar(globo) {
  globo.style.left = '0px';
  globo.style.right = 'auto';

  const caja = globo.getBoundingClientRect();
  const ancho = document.documentElement.clientWidth;

  const sobraDerecha = caja.right - (ancho - MARGEN);
  if (sobraDerecha > 0) globo.style.left = `${-sobraDerecha}px`;

  // Y después de empujar, comprobar el otro lado: en una pantalla estrecha un
  // globo ancho puede no caber por ninguno de los dos, y entre salirse por la
  // izquierda —donde empieza a leerse— y por la derecha, se elige la derecha.
  const yaEmpujado = globo.getBoundingClientRect();
  if (yaEmpujado.left < MARGEN) {
    globo.style.left = `${MARGEN - (yaEmpujado.left - parseFloat(globo.style.left || '0'))}px`;
  }
}

/**
 * Una etiqueta con su «?» al lado, que es como se usa casi siempre.
 *
 * `nodoEtiqueta` puede ser un `<span class="etiqueta">` o un `<h2>`: lo que
 * haga falta. La ayuda se cuelga dentro para que compartan el renglón sin
 * necesidad de un contenedor más.
 */
export function conAyuda(nodoEtiqueta, texto, opciones) {
  nodoEtiqueta.append(' ', ayuda(texto, opciones));
  return nodoEtiqueta;
}
