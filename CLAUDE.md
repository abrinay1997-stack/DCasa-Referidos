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

Hoy `verificar` pasa sin avisos: la economía está decidida entera. Si mañana
aparece un `null` o un `PENDIENTE` nuevo, el aviso es correcto y esperado —
**no lo hagas callar rellenando el valor tú.**

**Y corre esto de verdad antes de empujar a `main`**, porque desde ahí ya no lo
revisa nadie: cada empuje dispara `entregar.yml`, que prueba, migra la base y
despliega el Worker, en ese orden. Lo que llega a `main` se publica. Un PR es
seguro —solo corre `probar`— y es por dónde va un cambio del que no estés
seguro.

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
index.html      La app del socio. Sin construir y sin dependencias.
socio/          Sus pantallas: puntos, actividad, invita, premios, términos.
panel/          El panel del equipo: compras, socios, canjes, reportes.
hub/            El icono, la tipografía y el manifest de la app instalable.
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

**Las cinco fases están hechas.** El programa acredita, canjea, vence, felicita
y reporta. Lo que queda abierto no es código y está en el README, en «Lo que
falta preguntarle a Marcial»: el tope por compra, qué productos entran como
premio, qué correos más abren el panel y adónde apuntan los QR impresos.

**Una advertencia sobre el orden**, por si añades algo: no construyas la
pantalla antes que el libro mayor. Todo lo que ve el socio es una vista del
libro, y montarlo al revés lleva a guardar un saldo en algún sitio «mientras
tanto» — que es exactamente la columna que la regla 2 prohíbe.

**Y otra sobre los gráficos:** un dato único dibujado como barra mide siempre el
100 % de sí mismo. Los dos gráficos del panel —vendedoras y altas por semana—
caen a una cifra sola cuando no hay con qué comparar, y eso no es un caso
límite: es lo que se ve las primeras semanas, que es justo cuando más se mira
esa pantalla.
