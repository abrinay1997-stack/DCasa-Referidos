# Socios D'CASA — Arranque obligatorio

Este repositorio es el **programa de puntos y referidos de D'CASA Panamá**: la
app del socio, el panel del equipo y el Worker que los atiende. Es código de
producción, no memoria de marca.

**Si vas a tocar algo, lee antes [`README.md`](README.md) entero.** Aquí está lo
que no se puede deducir mirando el código.

---

## 1. Las cinco reglas que no puedes romper

Cada una cuesta dinero real o un cliente si se rompe.

1. **Ninguna cifra que no esté en [`datos/puntos.json`](datos/puntos.json).** No
   inventes, no estimes, no pongas «un valor razonable mientras tanto». Un
   valor en `null` o `PENDIENTE` significa que su pantalla NO se muestra y que
   su endpoint responde 503 diciendo qué falta. Eso es el comportamiento
   correcto, no una tarea pendiente que puedas cerrar tú.

2. **`socios` no tiene columna `saldo`, y no se la añadas.** El saldo es
   `SUM(movimientos.puntos)`. Es la regla 1 escrita en el esquema, igual que la
   ausencia de `total` en las propuestas de PanaClaw. `herramientas/verificar.mjs`
   para el build si aparece.

3. **Nada se edita ni se borra del libro mayor.** Una corrección es un asiento
   `reverso` con la cifra en negativo, con motivo escrito y con autor. El socio
   lee ese motivo en su app.

4. **Ningún hex fuera de [`datos/marca.json`](datos/marca.json), y el amarillo
   `#FED00F` jamás toca el blanco ni el hueso** (1.47:1, invisible). El botón de
   acción es fondo amarillo con texto azul `#1340B1`.

5. **Los puntos de referido se pagan con la primera compra verificada**, nunca
   al registrarse, y `referido_por` se escribe una vez y no se modifica jamás.

---

## 2. Antes de dar por terminado cualquier cambio

```bash
npm run verificar    # marca, invariantes, la forma de Access, huecos
npm test             # las reglas del dinero
npm run tipos        # el Worker compila
npm run build        # los tres anteriores + arma publico/
```

Los tres avisos de `verificar` sobre `PENDIENTE` son correctos y esperados
mientras Marcial no responda. **No los hagas callar rellenando los valores.**

---

## 3. La arquitectura en una frase

**Dos zonas en un solo Worker, separadas por prefijo de ruta.** `/` y
`/api/socio/*` son públicas (el cliente del QR); `/panel/` y `/panel/api/*` van
detrás de Cloudflare Access. Todo lo del equipo cuelga de `/panel/` para que una
sola aplicación de Access lo cubra entero. Ver `worker/index.ts`, cuya cabecera
lo explica, y la sección «Dos puertas en un solo Worker» del README.

Tres cosas sostienen la puerta y **ninguna se quita**: `run_worker_first` sobre
`/panel/*` en `wrangler.jsonc`; la verificación de firma que hace el propio
Worker; y el 503 cuando `ACCESO_DOMINIO` o `ACCESO_AUD` no tienen la forma que
les toca.

---

## 4. Dónde está cada cosa

```
datos/          Las dos fuentes de verdad. Máquina antes que prosa.
  puntos.json     Toda cifra que el programa puede acreditar
  marca.json      Todo token visual: hex, fuentes, formas, voz

compartido/     El contrato. No depende del Worker ni de las pantallas: si
                esto sale de Cloudflare, es lo que la otra implementación
                tiene que cumplir.
  puntos.ts       Las reglas del dinero. PURO y probado entero.
  texto.ts        Normalización. Copiado de PanaClaw-WorkSpace tal cual.
  seguridad.ts    Las cabeceras. Una sola declaración, dos destinos.
  api.ts          Códigos de error que las pantallas leen.

worker/         El servidor.
  index.ts        El enrutador de dos zonas y el guardia. Empieza aquí.
  acceso.ts       Cloudflare Access. Copiado de PanaClaw.
  http.ts         Cómo se responde y cómo se rechaza.
  entorno.ts      Lo que Cloudflare le pasa.

migraciones/    El esquema, con el porqué de cada decisión en la cabecera.
herramientas/   verificar.mjs — la marca y las invariantes, defendidas.
scripts/        construir.mjs — verificar → probar → construir. Nunca a medias.
pruebas/        Las reglas del dinero, caso por caso.
index.html      La app del socio (fase 1: portada).
panel/          El panel del equipo (fase 1: portada).
```

---

## 5. La marca

Sale de
[`juanarrietabusiness-pixel/Agencia_Workspace`](https://github.com/juanarrietabusiness-pixel/Agencia_Workspace)
→ `Dcasa/01_ADN_y_Memoria/`, espejada en `datos/marca.json`. **Este repositorio
es espejo, no fuente:** si un dato de marca cambia, cambia allí primero.

Antes de escribir un solo texto de cara al cliente, lee `voz` en
`datos/marca.json`. Tuteo siempre. Los mensajes de error también son de marca:
no se dice «credenciales inválidas», se dice «Ese número y ese PIN no
coinciden». Y jamás se distingue entre «ese teléfono no existe» y «ese PIN está
mal» — hacerlo convierte el formulario de acceso en un buscador de quién es
cliente de D'CASA.

---

## 6. Por dónde sigue

La fase 1 está hecha. La 2 es **socios y puntos**: alta, PIN con PBKDF2 y
pimienta, sesión firmada con revocación por cambio de PIN, candado contra fuerza
bruta, registro de compra por la vendedora y el libro mayor.

El detalle de cada fase, con su criterio de «hecho», está en el README.

**Una advertencia sobre el orden:** no construyas las pantallas antes que el
libro mayor. Todo lo que ve el socio es una vista del libro, y montarlo al revés
lleva a guardar un saldo en algún sitio «mientras tanto» — que es exactamente la
columna que la regla 2 prohíbe.
