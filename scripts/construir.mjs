#!/usr/bin/env node
/**
 * Arma `publico/`, que es lo que Cloudflare publica.
 *
 *   publico/index.html        la app del socio (pública)
 *   publico/hub/assets/       el logo
 *   publico/panel/            el panel del equipo (detrás de Access)
 *
 * EL ORDEN IMPORTA, y es el mismo que en PanaClaw: primero se verifica el
 * repositorio, después se prueban las reglas del dinero, y solo entonces se
 * construye. Si algo de eso falla, `publico/` se queda VACÍA en vez de quedarse
 * a medias, y no se publica nada. Es deliberado: un programa de puntos que
 * acredita mal es peor que uno caído, porque el caído se nota el mismo día.
 *
 * Ni la app del socio ni el panel se empaquetan todavía. En la fase 1 son HTML
 * con los estilos dentro y sin dependencias, y esa propiedad —abrirlos con
 * doble clic y verlos igual que publicados— vale más que meterlos en un
 * empaquetador para no ganar nada. Cuando la fase 2 traiga las pantallas de
 * verdad, aquí entra el `vite build` de cada una.
 */

import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CABECERAS_SEGURIDAD } from '../compartido/seguridad.ts';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const destino = join(raiz, 'publico');

const correr = (orden, argumentos) =>
  execFileSync(orden, argumentos, { cwd: raiz, stdio: 'inherit' });

/**
 * Cuánto JavaScript puede pesar la zona del socio, comprimido.
 *
 * El público de D'CASA son familias de La Chorrera entrando con datos móviles
 * desde teléfonos modestos. Un megabyte de JavaScript en esa pantalla no es una
 * molestia: es un socio que no se registra. El presupuesto se comprueba aquí
 * para que el día que alguien añada una librería de gráficas «solo para la
 * barra de progreso», el build lo diga en vez de descubrirlo el cliente.
 */
const PRESUPUESTO_SOCIO_GZIP = 60 * 1024;

// Verificar va primero y sin instalar nada: si el repositorio está mal —un hex
// fuera de la marca, la etiqueta de Access mal copiada, una columna `saldo`
// colada en una migración— se sabe en tres décimas.
console.log('· Verificando el repositorio…');
correr('node', ['herramientas/verificar.mjs']);

console.log('· Probando las reglas del dinero…');
correr('npm', ['test', '--silent']);

await rm(destino, { recursive: true, force: true });
await mkdir(destino, { recursive: true });

console.log('· Copiando la app del socio…');
await cp(join(raiz, 'index.html'), join(destino, 'index.html'));
await cp(join(raiz, 'socio'), join(destino, 'socio'), { recursive: true });
await cp(join(raiz, 'hub'), join(destino, 'hub'), { recursive: true });

console.log('· Copiando el panel del equipo…');
await cp(join(raiz, 'panel'), join(destino, 'panel'), { recursive: true });

// Las cabeceras de seguridad de los archivos estáticos.
//
// Van en `_headers` y no en el Worker porque el Worker no llega a ejecutarse
// para la zona pública: `run_worker_first` está limitado a `/panel/*`. Ver la
// cabecera de `compartido/seguridad.ts`, que es de donde sale esta lista — aquí
// no se escribe ninguna cabecera a mano, para que no puedan discrepar.
// El manifest tiene que servirse con su tipo o el navegador lo ignora en
// silencio y «Añadir a pantalla de inicio» no aparece — sin ningún error.
const cabecerasExtra = [
  '',
  '/hub/manifest.webmanifest',
  '  Content-Type: application/manifest+json; charset=utf-8',
];

console.log('· Escribiendo las cabeceras de seguridad…');
const cabeceras = [
  '/*',
  ...Object.entries(CABECERAS_SEGURIDAD).map(([n, v]) => `  ${n}: ${v}`),
  ...cabecerasExtra,
];
await writeFile(join(destino, '_headers'), `${cabeceras.join('\n')}\n`, 'utf8');

// El presupuesto, medido sobre lo que de verdad se va a publicar.
console.log('· Midiendo la zona del socio…');
let pesoSocio = 0;
// `hub` cuenta aunque no sea del socio: de ahí sale el selector de cumpleaños,
// que el socio descarga. Un presupuesto que no mide lo que de verdad se baja
// no es un presupuesto, es una forma de esconder peso en otra carpeta.
for (const carpeta of ['', 'socio', 'hub']) {
  // El panel no cuenta: lo usan seis personas del equipo desde la tienda, no
  // los clientes, y sus pantallas van a ser mucho más pesadas por necesidad.
  const dir = carpeta ? join(destino, carpeta) : destino;
  for (const nombre of await readdir(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) continue;
    if (!['.js', '.mjs', '.html'].includes(extname(nombre))) continue;
    pesoSocio += gzipSync(readFileSync(ruta)).length;
  }
}

const enKb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

if (pesoSocio > PRESUPUESTO_SOCIO_GZIP) {
  console.error(
    `\n✗ La zona del socio pesa ${enKb(pesoSocio)} comprimida y el presupuesto es ` +
      `${enKb(PRESUPUESTO_SOCIO_GZIP)}.\n` +
      `  No se publica. El público de D'CASA entra con datos móviles: cada kilobyte ` +
      `de más es un socio que no se registra.\n`,
  );
  await rm(destino, { recursive: true, force: true });
  process.exit(1);
}

console.log(
  `\n✓ publico/ lista. Zona del socio: ${enKb(pesoSocio)} de ${enKb(PRESUPUESTO_SOCIO_GZIP)}.\n`,
);
