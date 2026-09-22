#!/usr/bin/env node
/**
 * Comprueba que el repositorio no se haya desincronizado.
 *
 * Corre antes de construir y en CI en cada push. Si encuentra un error,
 * `publico/` se queda vacío y no se publica nada: una herramienta que acredita
 * puntos mal es peor que una herramienta caída, porque la caída se nota.
 *
 * Lo que vigila, y por qué cada cosa:
 *
 *   1. Ningún hex fuera de `datos/marca.json`.
 *   2. El amarillo no toca el blanco ni el hueso (ratio 1.47:1, invisible).
 *   3. Ningún comentario CSS dentro de otro: no anidan, y el navegador se come
 *      la regla siguiente sin decir nada.
 *   4. Ninguna tipografía prohibida.
 *   5. Ninguna columna `saldo` en las migraciones — la invariante del libro
 *      mayor, defendida mecánicamente y no con buena voluntad.
 *   6. `ACCESO_DOMINIO` y `ACCESO_AUD` tienen la FORMA correcta, con las
 *      expresiones leídas de `worker/acceso.ts` para no duplicarlas.
 *   7. `datos/puntos.json` es válido, y se dice qué sigue PENDIENTE.
 *   8. Los secretos no están escritos en ningún archivo versionado.
 *   9. Ni enlaces rotos ni huecos de plantilla en los `.md`.
 *
 * Para un contraejemplo deliberado —un hex equivocado que se está ilustrando—
 * se escapa la línea con `<!-- v: por qué -->` en Markdown o `// v: por qué`
 * en código.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (ruta) => relative(RAIZ, ruta).replace(/\\/g, '/');

const errores = [];
const avisos = [];
const error = (archivo, linea, msg) => errores.push({ archivo, linea, msg });
const aviso = (archivo, linea, msg) => avisos.push({ archivo, linea, msg });

const NO_MIRAR = [/^node_modules\//, /^publico\//, /^\.git\//, /^\.wrangler\//];
const saltar = (ruta) => NO_MIRAR.some((re) => re.test(rel(ruta)));

function listar(dir, extensiones, acc = []) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (saltar(ruta)) continue;
    if (statSync(ruta).isDirectory()) listar(ruta, extensiones, acc);
    else if (extensiones.includes(extname(ruta))) acc.push(ruta);
  }
  return acc;
}

const ESCAPE = /(?:<!--|\/\/|\/\*)\s*v:\s*\S/;

function lineas(ruta) {
  return readFileSync(ruta, 'utf8')
    .split('\n')
    .map((texto, i) => ({ n: i + 1, texto }))
    .filter(({ texto }) => !ESCAPE.test(texto));
}

// ---------------------------------------------------------------------------
// Las dos fuentes de verdad
// ---------------------------------------------------------------------------

let marca;
let reglas;
try {
  marca = JSON.parse(readFileSync(join(RAIZ, 'datos/marca.json'), 'utf8'));
  reglas = JSON.parse(readFileSync(join(RAIZ, 'datos/puntos.json'), 'utf8'));
} catch (err) {
  console.error(`\n✗ JSON inválido en datos/: ${err.message}\n`);
  process.exit(1);
}

/** Todos los hex que la marca reconoce, en mayúsculas. */
const hexValidos = new Set();
for (const token of Object.values(marca.color?.tokens ?? {})) {
  if (token.hex) hexValidos.add(token.hex.toUpperCase());
}
for (const par of marca.color?.paresDeTexto ?? []) {
  hexValidos.add(par.texto.toUpperCase());
  hexValidos.add(par.fondo.toUpperCase());
}
// Los prohibidos también se reconocen: están declarados para poder detectarlos,
// no para usarlos. Se comprueban aparte, en reglaCombinaciones().
const hexProhibidos = new Set();
for (const combo of marca.color?.combinacionesProhibidas ?? []) {
  hexProhibidos.add(`${combo.texto.toUpperCase()}|${combo.fondo.toUpperCase()}`);
}

const ARCHIVOS_DE_CODIGO = listar(RAIZ, ['.ts', '.js', '.mjs', '.tsx', '.css', '.html']);

// ---------------------------------------------------------------------------
// 1. Ningún hex fuera de datos/marca.json
// ---------------------------------------------------------------------------

function reglaColor() {
  const HEX = /#[0-9a-fA-F]{6}\b/g;
  for (const ruta of ARCHIVOS_DE_CODIGO) {
    for (const { n, texto } of lineas(ruta)) {
      for (const encontrado of texto.match(HEX) ?? []) {
        const hex = encontrado.toUpperCase();
        if (!hexValidos.has(hex)) {
          error(
            rel(ruta),
            n,
            `El color ${encontrado} no está en datos/marca.json. Todo hex sale de ahí ` +
              `y solo de ahí. Si hace falta uno nuevo, se añade allí primero.`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. El amarillo no toca el blanco ni el hueso
// ---------------------------------------------------------------------------

/** Luminancia relativa de un hex, según la fórmula de WCAG. */
function luminancia(hex) {
  const canal = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * canal((n >> 16) & 255) +
    0.7152 * canal((n >> 8) & 255) +
    0.0722 * canal(n & 255)
  );
}

function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Los pares que la marca declara como aptos, comprobados de verdad.
 *
 * No se cree el `ratio` escrito en el JSON: se recalcula. Un número copiado a
 * mano en un archivo de marca es exactamente la clase de dato que se queda
 * viejo cuando alguien retoca un hex y no vuelve a mirar la tabla.
 */
function reglaContraste() {
  for (const par of marca.color?.paresDeTexto ?? []) {
    const real = contraste(par.texto, par.fondo);
    if (real < 4.5) {
      error(
        'datos/marca.json',
        0,
        `El par declarado como apto ${par.texto} sobre ${par.fondo} da ${real.toFixed(2)}:1, ` +
          `por debajo del mínimo de 4.5:1 de WCAG AA.`,
      );
    } else if (Math.abs(real - par.ratio) > 0.35) {
      aviso(
        'datos/marca.json',
        0,
        `El par ${par.texto} sobre ${par.fondo} dice ${par.ratio}:1 pero da ${real.toFixed(2)}:1.`,
      );
    }
  }

  for (const combo of marca.color?.combinacionesProhibidas ?? []) {
    const real = contraste(combo.texto, combo.fondo);
    if (real >= 4.5) {
      aviso(
        'datos/marca.json',
        0,
        `${combo.texto} sobre ${combo.fondo} está marcado como prohibido pero da ` +
          `${real.toFixed(2)}:1. Revisa si la prohibición sigue teniendo sentido.`,
      );
    }
  }
}

/**
 * El amarillo pegado al blanco dentro de una misma regla de CSS.
 *
 * Es la trampa número uno de esta marca en una interfaz: el impulso natural es
 * hacer el botón principal amarillo con letras blancas, y eso da 1.47:1 — no
 * se lee, no es que se lea mal. Se busca por bloque de llaves porque es donde
 * conviven `color` y `background`.
 */
function reglaCombinaciones() {
  const archivos = ARCHIVOS_DE_CODIGO.filter((r) => ['.css', '.html', '.tsx'].includes(extname(r)));

  for (const ruta of archivos) {
    const texto = readFileSync(ruta, 'utf8');
    if (ESCAPE.test(texto)) continue;

    for (const bloque of texto.match(/\{[^{}]*\}/g) ?? []) {
      const hexes = (bloque.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((h) => h.toUpperCase());
      if (hexes.length < 2) continue;

      // Un bloque donde TODOS los hex son definiciones de variable es la
      // paleta, no un uso: `:root { --amarillo: #FED00F; --blanco: #FFFFFF; }`
      // declara la marca entera y por fuerza tiene los dos juntos. Lo que se
      // persigue es `color` y `background` en la misma regla, que es donde el
      // amarillo acaba encima del blanco sin que nadie lo vea.
      const esPaleta = bloque
        .split(/[;\n]/)
        .filter((l) => /#[0-9a-fA-F]{6}\b/.test(l))
        .every((l) => /--[\w-]+\s*:/.test(l));
      if (esPaleta) continue;

      for (const par of hexProhibidos) {
        const [a, b] = par.split('|');
        if (hexes.includes(a) && hexes.includes(b)) {
          const linea = texto.slice(0, texto.indexOf(bloque)).split('\n').length;
          error(
            rel(ruta),
            linea,
            `${a} y ${b} conviven en la misma regla. Ese par da ` +
              `${contraste(a, b).toFixed(2)}:1 y está prohibido en datos/marca.json: ` +
              `es invisible. El botón de acción es fondo amarillo con texto AZUL.`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Comentarios CSS anidados
// ---------------------------------------------------------------------------

/**
 * `/* … /* … *​/ … *​/` — los comentarios CSS NO ANIDAN.
 *
 * El `*​/` de dentro cierra el de fuera, y todo lo que venía después se queda
 * suelto en mitad de la hoja de estilos. El navegador no protesta: descarta en
 * silencio desde ahí hasta la siguiente llave, y se lleva por delante la regla
 * que viniera detrás.
 *
 * Esto pasó de verdad, y pasó por culpa de este mismo verificador: para
 * escapar un hex de contraejemplo se metió un `/* v: … *​/` DENTRO de un
 * comentario que ya estaba abierto. La regla `.placa-logo` desapareció, el logo
 * se fue al borde izquierdo, y nada lo dijo — ni el build, ni las pruebas, ni
 * mirar la página, porque el logo lleva su propia placa blanca dibujada dentro
 * del PNG y parecía que el estilo seguía ahí. Se descubrió en una captura de
 * producción.
 *
 * Un fallo que no se ve es peor que uno que revienta, así que ahora revienta.
 */
function reglaComentarios() {
  for (const ruta of ARCHIVOS_DE_CODIGO) {
    if (!['.css', '.html'].includes(extname(ruta))) continue;

    const texto = readFileSync(ruta, 'utf8');
    let abierto = -1;

    for (let i = 0; i < texto.length - 1; i += 1) {
      const dos = texto.slice(i, i + 2);
      if (dos === '/*') {
        if (abierto >= 0) {
          error(
            rel(ruta),
            texto.slice(0, i).split('\n').length,
            'Comentario CSS dentro de otro comentario CSS. No anidan: el «*/» de dentro ' +
              'cierra el de fuera, y lo que venga después queda suelto en la hoja de estilos. ' +
              'El navegador descarta en silencio hasta la siguiente llave y se lleva la regla ' +
              'que hubiera detrás.',
          );
          break;
        }
        abierto = i;
        i += 1;
      } else if (dos === '*/') {
        if (abierto < 0) {
          // Un cierre sin apertura significa que ALGO cerró antes el comentario
          // que éste creía seguir. Es la otra mitad del mismo fallo, y la que
          // de verdad picó: no hacía falta anidar un `/*` — bastó con escribir
          // los dos caracteres de cierre dentro del texto del comentario, entre
          // comillas, explicando precisamente este problema.
          error(
            rel(ruta),
            texto.slice(0, i).split('\n').length,
            'Cierre de comentario CSS suelto: aquí no había ningún comentario abierto. ' +
              'Casi siempre significa que el texto de un comentario anterior contenía los ' +
              'dos caracteres de cierre —aunque fuera entre comillas— y lo terminó antes ' +
              'de tiempo. Todo lo que venía después quedó suelto en la hoja de estilos.',
          );
          break;
        }
        abierto = -1;
        i += 1;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Ninguna tipografía prohibida
// ---------------------------------------------------------------------------

function reglaTipografia() {
  const prohibidas = marca.tipografia?.prohibidas ?? [];
  for (const ruta of ARCHIVOS_DE_CODIGO) {
    for (const { n, texto } of lineas(ruta)) {
      for (const familia of prohibidas) {
        // `sans-serif` y `system-ui` son familias genéricas, no tipografías, y
        // son el plan B legítimo cuando Anton todavía no cargó.
        const re = new RegExp(`\\b${familia.replace(/ /g, '\\s+')}\\b`, 'i');
        if (re.test(texto)) {
          error(
            rel(ruta),
            n,
            `«${familia}» está prohibida en datos/marca.json. La marca usa Anton, ` +
              `Oswald e Inter, y nada más.`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Ninguna columna `saldo` — la invariante del libro mayor
// ---------------------------------------------------------------------------

/**
 * El saldo es SUM(movimientos.puntos) y no vive en ninguna columna.
 *
 * Esto es la invariante de `migraciones/0002_movimientos.sql` defendida
 * mecánicamente. Si alguien añade la columna «solo para que el listado vaya
 * rápido», el build se para aquí y el mensaje explica por qué no.
 */
function reglaSinSaldo() {
  for (const ruta of listar(RAIZ, ['.sql'])) {
    for (const { n, texto } of lineas(ruta)) {
      if (/^\s*saldo\b/i.test(texto) || /\badd\s+column\s+saldo\b/i.test(texto)) {
        error(
          rel(ruta),
          n,
          `Aquí se está creando una columna «saldo», y el programa no tiene ninguna. ` +
            `El saldo es SUM(movimientos.puntos) y no existe en ningún otro sitio: una ` +
            `columna es el sitio más barato para que el número se despegue del libro ` +
            `que lo explica. Ver la cabecera de migraciones/0002_movimientos.sql.`,
        );
      }
    }
  }
}

/**
 * Una ficha sin PIN no puede entrar, y eso tiene que seguir escrito.
 *
 * Desde que una venta crea la ficha de alguien que no se registró, `pin_hash`
 * puede ser la cadena vacía. La base NO lo impide con un CHECK —añadirlo obliga
 * a reconstruir `socios` con cuatro claves foráneas apuntando a ella, ver
 * `0005_ficha.sql`— así que la invariante vive en dos sitios del código, y esta
 * comprobación es lo que impide que alguien se lleve por delante cualquiera de
 * los dos sin enterarse:
 *
 *   · `worker/sesion.ts` devuelve `false` en vez de derivar con 0 iteraciones,
 *     que lanza.
 *   · `worker/socios.ts` rechaza la entrada ANTES de comparar, y lo hace igual
 *     que a un número que no existe.
 *
 * Sin el primero, intentar entrar con una ficha sin reclamar daba un 500. Sin
 * el segundo, el rechazo llegaría en 2 ms en vez de en 300 y el reloj diría lo
 * que el mensaje calla.
 */
function reglaFichaSinPin() {
  const sesion = readFileSync(join(RAIZ, 'worker/sesion.ts'), 'utf8');
  if (!/if \(!guardado\.hash \|\| !guardado\.iteraciones\) return false;/.test(sesion)) {
    error(
      'worker/sesion.ts',
      0,
      `Falta el corte de «pinCoincide» para una ficha sin PIN. Sin él, PBKDF2 con ` +
        `0 iteraciones lanza y un intento de entrar se convierte en un 500.`,
    );
  }

  const socios = readFileSync(join(RAIZ, 'worker/socios.ts'), 'utf8');
  if (!/if \(!fila\.pin_hash\) \{\s*\n\s*await derivarEnVano/.test(socios)) {
    error(
      'worker/socios.ts',
      0,
      `Falta el rechazo de una ficha sin reclamar en «entrar()», derivando en vano ` +
        `antes. Sin él, la pantalla de acceso contesta distinto —o más rápido— para ` +
        `un número que es cliente de D'CASA, y eso la convierte en un detector.`,
    );
  }
}

/**
 * Las vueltas de PBKDF2, contra el techo de la plataforma.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTA REGLA EXISTE
 *
 * Cloudflare no acepta más de 100.000 iteraciones de PBKDF2, y el runtime de
 * la máquina de uno no pone ese límite. Así que un número más alto funciona en
 * local, pasa las pruebas, se publica, y en producción revienta TODO lo que
 * toca un PIN: registrarse, reclamar la ficha, entrar, reiniciar el PIN. Nadie
 * puede usar el programa y nada en el repositorio lo dice.
 *
 * Eso pasó con 210.000, y se descubrió porque el dueño no pudo entrar a su
 * propia cuenta. Esta regla es para que la próxima vez lo diga el flujo y no
 * un cliente de pie en el mostrador.
 *
 * Y el señuelo de `entrar()` tiene que derivar con las MISMAS vueltas: si se
 * separan, un número que no existe contesta en un tiempo distinto a uno que sí,
 * y la pantalla de acceso vuelve a ser un detector de clientes de D'CASA.
 * ---------------------------------------------------------------------------
 */
function reglaVueltas() {
  const TOPE = 100_000;

  const sesion = readFileSync(join(RAIZ, 'worker/sesion.ts'), 'utf8');
  const puestas = /export const ITERACIONES = ([\d_]+);/.exec(sesion);

  if (!puestas) {
    error('worker/sesion.ts', 0, 'No se encuentra «export const ITERACIONES».');
  } else {
    const vueltas = Number(puestas[1].replace(/_/g, ''));
    if (vueltas > TOPE) {
      error(
        'worker/sesion.ts',
        sesion.slice(0, puestas.index).split('\n').length,
        `ITERACIONES = ${vueltas.toLocaleString('es')}, y Cloudflare no acepta más de ` +
          `${TOPE.toLocaleString('es')}. Arriba lanza «Pbkdf2 failed: iteration counts ` +
          `above 100000 are not supported», y con eso nadie puede registrarse ni entrar. ` +
          `En local no falla: ese límite solo existe en producción.`,
      );
    }
  }

  const socios = readFileSync(join(RAIZ, 'worker/socios.ts'), 'utf8');
  const senuelo = /const SEÑUELO: PinGuardado = \{[^}]*\}/s.exec(socios);
  if (!senuelo) {
    error('worker/socios.ts', 0, 'No se encuentra el señuelo de «derivarEnVano».');
  } else if (!/iteraciones: ITERACIONES,/.test(senuelo[0])) {
    error(
      'worker/socios.ts',
      socios.slice(0, senuelo.index).split('\n').length,
      `El señuelo tiene las vueltas escritas a mano en vez de «iteraciones: ITERACIONES». ` +
        `Tiene que costar lo MISMO que un PIN de verdad: si se separan, un número que no ` +
        `existe contesta en un tiempo distinto a uno que sí, y la pantalla de acceso ` +
        `vuelve a ser un detector de clientes de D'CASA.`,
    );
  }
}

/**
 * Los datos del emisor que todavía faltan en el comprobante.
 *
 * Es un AVISO y no un error, a propósito: el sistema funciona sin ellos y
 * parar el despliegue por un RUC que nadie ha dado aún sería peor. Pero el
 * papel que se lleva el cliente identifica al COMPRADOR y desglosa un
 * impuesto, y no dice de quién es — así que esto tiene que seguir doliendo
 * hasta que alguien lo rellene.
 *
 * `regimenFiscal` es el que más importa de los tres: decide si el papel puede
 * afirmar que la factura salió de un equipo fiscal. Afirmarlo cuando D'CASA
 * esté en facturación electrónica sería escribir algo falso en el papel de un
 * cliente, así que hasta saberlo el comprobante no lo dice.
 */
function reglaEmisor() {
  const ruta = join(RAIZ, 'datos/emisor.json');
  if (!existsSync(ruta)) {
    error('datos/emisor.json', 0, 'Falta el archivo con los datos de quien emite el comprobante.');
    return;
  }
  const e = JSON.parse(readFileSync(ruta, 'utf8'));
  const faltan = ['razonSocial', 'ruc', 'domicilio', 'telefono', 'regimenFiscal'].filter(
    (k) => !e[k] || e[k] === 'PENDIENTE',
  );
  if (!faltan.length) return;

  aviso(
    'datos/emisor.json',
    0,
    `El comprobante sale sin ${faltan.join(', ')}. Mientras falten, ese papel no dice ` +
      `de quién es. Pregúntaselo a Marcial: son datos que están en su factura fiscal.`,
  );
}

// ---------------------------------------------------------------------------
// 5. La forma de los dos datos de Access
// ---------------------------------------------------------------------------

/**
 * Lee una expresión regular DE `worker/acceso.ts` en vez de duplicarla.
 *
 * Duplicarla sería escribir dos veces la misma verdad, y el día que Cloudflare
 * cambie el formato de la etiqueta AUD, una de las dos se quedaría vieja sin
 * que nadie lo notara — que es justo el fallo que esta comprobación existe
 * para evitar.
 */
function formaDeAcceso(nombre) {
  const fuente = readFileSync(join(RAIZ, 'worker/acceso.ts'), 'utf8');
  const encontrado = new RegExp(`export const ${nombre} = (/.+/);`).exec(fuente);
  if (!encontrado) {
    error('worker/acceso.ts', 0, `No se encontró ${nombre}. verificar.mjs la lee de ahí.`);
    return null;
  }
  const cuerpo = encontrado[1];
  return new RegExp(cuerpo.slice(1, cuerpo.lastIndexOf('/')));
}

function reglaPuerta() {
  const crudo = readFileSync(join(RAIZ, 'wrangler.jsonc'), 'utf8');
  const sinComentarios = crudo.replace(/^\s*\/\/.*$/gm, '');

  let config;
  try {
    config = JSON.parse(sinComentarios);
  } catch (err) {
    error('wrangler.jsonc', 0, `No es JSONC válido: ${err.message}`);
    return;
  }

  const formaDominio = formaDeAcceso('FORMA_DOMINIO');
  const formaAud = formaDeAcceso('FORMA_AUD');
  if (!formaDominio || !formaAud) return;

  const revisar = (clave, forma, esperado) => {
    const valor = config.vars?.[clave];
    const linea = crudo.split('\n').findIndex((l) => l.includes(`"${clave}"`)) + 1;

    if (!valor || valor === 'PENDIENTE') {
      aviso(
        'wrangler.jsonc',
        linea,
        `${clave} sigue en PENDIENTE. El panel responderá 503 hasta que se ponga ` +
          `(la app del socio funciona igual). Se copia de Zero Trust → Access → ` +
          `Applications, sobre este Worker y con la ruta «panel».`,
      );
      return;
    }
    if (!forma.test(valor)) {
      error(
        'wrangler.jsonc',
        linea,
        `${clave} no tiene la forma de ${esperado}: el valor puesto tiene ` +
          `${valor.length} caracteres. Con el valor equivocado el panel queda EN PIE ` +
          `contestando «la sesión caducó» a cada llamada, sin sesión que caducar. ` +
          `Eso es una avería sin síntoma legible, y por eso se para aquí.`,
      );
    }
  };

  revisar('ACCESO_DOMINIO', formaDominio, 'un dominio de equipo, «algo.cloudflareaccess.com»');
  revisar('ACCESO_AUD', formaAud, 'una etiqueta AUD, 64 caracteres hexadecimales');

  // MODO=desarrollo salta la comprobación de Cloudflare Access ENTERA y deja el
  // panel abierto a quien dé con la dirección. Vive en `.dev.vars`, que no se
  // versiona, y no tiene por qué aparecer nunca aquí.
  //
  // Esta comprobación no existía mientras desplegaba una persona desde su
  // terminal: ahí, quien pega una variable en `wrangler.jsonc` es quien la
  // mira. Desde que despliega GitHub Actions sola en cada empuje a `main`, un
  // `"MODO": "desarrollo"` colado en un commit se publica sin que nadie lo lea.
  // Es barata y lo que evita no lo es.
  if ('MODO' in (config.vars ?? {})) {
    const linea = crudo.split('\n').findIndex((l) => l.includes('"MODO"')) + 1;
    error(
      'wrangler.jsonc',
      linea,
      `MODO no va aquí. Puesto en «desarrollo» salta la comprobación de Access ` +
        `entera y deja el panel del equipo abierto a cualquiera que dé con la ` +
        `dirección. Va en .dev.vars, que no se versiona ni se publica.`,
    );
  }

  // `run_worker_first` sobre /panel/* es lo que impide que Cloudflare sirva la
  // pantalla del panel desde el borde sin ejecutar el guardia.
  const primero = config.assets?.run_worker_first;
  const cubrePanel =
    primero === true || (Array.isArray(primero) && primero.some((p) => p.includes('/panel')));
  if (!cubrePanel) {
    error(
      'wrangler.jsonc',
      0,
      `assets.run_worker_first no cubre /panel/*. Sin eso, Cloudflare entrega la ` +
        `pantalla del panel desde el borde SIN ejecutar el Worker, y el guardia que ` +
        `comprueba Access no llega a correr.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 6. La economía del programa
// ---------------------------------------------------------------------------

// `null` significa «sin decidir» en todo el archivo menos aquí: en estas claves es
// la decisión, y dice que la regla está apagada a propósito.
const NULO_ES_DECISION = new Set(['vencimiento.meses']);

function reglaEconomia() {
  const pendientes = [];
  const recorrer = (objeto, camino) => {
    for (const [clave, valor] of Object.entries(objeto)) {
      if (clave.startsWith('$')) continue;
      const donde = camino ? `${camino}.${clave}` : clave;
      if (NULO_ES_DECISION.has(donde)) continue;
      if (valor === null || valor === 'PENDIENTE') pendientes.push(donde);
      else if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
        recorrer(valor, donde);
      }
    }
  };
  recorrer(reglas, '');

  if (!Number.isInteger(reglas.version)) {
    error('datos/puntos.json', 0, 'La `version` tiene que ser un entero.');
  }

  // El número de niveles de referido no es una preferencia: el código de la
  // fase 3 implementa uno, y poner dos aquí sin implementarlo dejaría medio
  // programa prometiendo algo que no paga.
  if (reglas.referido?.niveles !== 1) {
    error(
      'datos/puntos.json',
      0,
      `referido.niveles vale ${reglas.referido?.niveles} pero el sistema implementa 1. ` +
        `Cambiar el número no añade el nivel: hay que escribirlo.`,
    );
  }
  if (reglas.referido?.vestaCon !== 'primera-compra-verificada') {
    error(
      'datos/puntos.json',
      0,
      `referido.vestaCon no se toca. Pagar el referido antes de la primera compra ` +
        `convierte el programa en una fábrica de cuentas falsas.`,
    );
  }
  if (reglas.acumulacion?.redondeo !== 'abajo') {
    error(
      'datos/puntos.json',
      0,
      `acumulacion.redondeo tiene que ser «abajo». Hacia arriba regala una fracción ` +
        `de punto en cada venta, y a mil ventas eso es dinero.`,
    );
  }

  if (pendientes.length) {
    aviso(
      'datos/puntos.json',
      0,
      `Sin definir todavía (${pendientes.length}): ${pendientes.join(', ')}. ` +
        `Mientras lo estén, sus pantallas no se muestran y sus endpoints responden 503.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 7. Los secretos no se versionan
// ---------------------------------------------------------------------------

function reglaSecretos() {
  const SOSPECHOSO = [
    /SECRETO_SESION\s*[:=]\s*['"][^'"]{8,}/,
    /PIMIENTA_PIN\s*[:=]\s*['"][^'"]{8,}/,
    /CLOUDFLARE_API_TOKEN\s*[:=]\s*['"][^'"]{8,}/,
  ];
  for (const ruta of [...ARCHIVOS_DE_CODIGO, ...listar(RAIZ, ['.json', '.jsonc', '.yml'])]) {
    for (const { n, texto } of lineas(ruta)) {
      for (const re of SOSPECHOSO) {
        if (re.test(texto)) {
          error(
            rel(ruta),
            n,
            `Esto parece un secreto escrito en un archivo versionado. Los secretos van ` +
              `con «wrangler secret put» y nunca en el repositorio.`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Enlaces rotos y huecos de plantilla
// ---------------------------------------------------------------------------

const HUECOS = [/\[completa aquí\]/i, /<tu [^>]+>/i, /\bTODO\s*[:(]/, /\bTBD\b/i, /XXXX/]; // v: los patrones que se buscan, no un hueco real

function reglaHuecos() {
  for (const ruta of [...listar(RAIZ, ['.md']), ...ARCHIVOS_DE_CODIGO]) {
    for (const { n, texto } of lineas(ruta)) {
      for (const re of HUECOS) {
        if (re.test(texto)) {
          error(rel(ruta), n, `Hueco de plantilla sin resolver: «${texto.trim().slice(0, 70)}».`);
        }
      }
    }
  }
}

function reglaEnlaces() {
  const ENLACE = /\[[^\]]*\]\(([^)\s]+)\)/g;
  for (const ruta of listar(RAIZ, ['.md'])) {
    for (const { n, texto } of lineas(ruta)) {
      let hallado;
      while ((hallado = ENLACE.exec(texto))) {
        const destino = hallado[1];
        if (/^(https?:|mailto:|#)/.test(destino)) continue;
        const absoluto = join(dirname(ruta), destino.split('#')[0]);
        try {
          statSync(absoluto);
        } catch {
          error(rel(ruta), n, `Enlace roto: ${destino}`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------

reglaColor();
reglaContraste();
reglaCombinaciones();
reglaComentarios();
reglaTipografia();
reglaSinSaldo();
reglaFichaSinPin();
reglaVueltas();
reglaEmisor();
reglaPuerta();
reglaEconomia();
reglaSecretos();
reglaHuecos();
reglaEnlaces();

const pintar = (lista, icono) => {
  for (const { archivo, linea, msg } of lista) {
    console.log(`  ${icono} ${archivo}${linea ? `:${linea}` : ''}\n     ${msg}`);
  }
};

if (avisos.length) {
  console.log(`\nAvisos (${avisos.length}):`);
  pintar(avisos, '·');
}

if (errores.length) {
  console.log(`\nErrores (${errores.length}):`);
  pintar(errores, '✗');
  console.log(
    `\n✗ La verificación falló. Corrige el archivo, nunca los datos/*.json al revés.\n`,
  );
  process.exit(1);
}

console.log(`\n✓ El repositorio está en orden.${avisos.length ? ` (${avisos.length} aviso(s))` : ''}\n`);
