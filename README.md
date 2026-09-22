# Socios D'CASA

El programa de puntos y referidos de **D'CASA Panamá** (La Chorrera, Panamá
Oeste). Un cliente escanea un QR en la tienda, se registra con su celular, y
desde ahí suma puntos comprando y trayendo gente, y los cambia por productos.

```
/                      la app del socio            PÚBLICA
/api/socio/*           su API, con sesión propia   PÚBLICA
/panel/                el panel del equipo         detrás de Cloudflare Access
/panel/api/*           su API                      detrás de Cloudflare Access
```

Hoy está la **fase 1**: la puerta y el esqueleto. Las pantallas llegan en la
fase 2. Ver [«Por dónde va»](#por-dónde-va).

---

## Dos puertas en un solo Worker

Ésta es la diferencia con los dos hubs hermanos —
[`hub-panaclaw`](https://github.com/abrinay1997-stack/PanaClaw-WorkSpace) y
[`hub-business-supplies`](https://github.com/byslogistics/Hub-Business-Supplies)—
y es lo primero que hay que entender antes de tocar nada.

En aquéllos, Cloudflare Access está delante de **todo**, y el Worker se niega a
servir hasta la portada si Access no está configurado. Aquí eso no puede ser: el
cliente que escanea el QR en la tienda no tiene un correo autorizado, ni lo va a
tener nunca.

Así que hay dos zonas separadas por prefijo de ruta, y **todo lo del equipo vive
bajo `/panel/`, la API incluida**. No es cosmético: una aplicación de Cloudflare
Access se define por dominio + ruta, así que con esta forma **una sola
aplicación sobre la ruta `panel` cubre la pantalla y la API a la vez**. Si la
API del equipo viviera en `/api/panel/*`, harían falta dos aplicaciones, y el
día que alguien cree una y olvide la otra, la API queda abierta sin que nada lo
grite. Una ruta, una puerta, un sitio donde equivocarse en vez de dos.

Tres cosas sostienen eso, y ninguna se quita:

1. **`assets.run_worker_first` cubre `/panel/*`** en `wrangler.jsonc`. Sin eso,
   Cloudflare entrega `/panel/index.html` desde el borde sin ejecutar el Worker,
   y el guardia no llega a correr.
2. **El Worker verifica la firma del token de Access por su cuenta**, aunque
   Access esté bien puesto delante. No lee la cabecera
   `Cf-Access-Authenticated-User-Email`: esa cabecera es texto que cualquiera
   puede escribir.
3. **Sin `ACCESO_DOMINIO` y `ACCESO_AUD` bien puestos, `/panel/` responde 503**
   diciendo qué falta — y la app del socio sigue funcionando, porque la puerta
   que falta no es la suya.

---

## Las reglas que no se rompen

### 1. El saldo no existe como columna

`socios` no tiene una columna `saldo`, y es la decisión que gobierna todo lo
demás. El saldo de un socio es `SUM(movimientos.puntos)` y no vive en ningún
otro sitio.

Es la misma decisión que la ausencia de una columna `total` en las propuestas de
PanaClaw, por la misma razón: una columna de saldo es el sitio más barato del
mundo para que el número se despegue del libro que lo explica, y eso no se
descubre mirando la base —nadie mira una base de datos— sino en el mostrador,
con una vendedora que no puede explicarle al cliente de dónde sale su número.

`node herramientas/verificar.mjs` para el build si alguien la añade.

### 2. Nada se edita, nada se borra

Un asiento del libro mayor es inmutable. Corregir una compra mal registrada no
es un `UPDATE`: es un asiento de tipo `reverso` que apunta al original con la
misma cifra en negativo. Y el socio **lee esa historia en su app**, con el
motivo escrito. Que pueda ver por qué le quitaron puntos es lo que hace creíble
el programa: es la regla de marca «di qué no incluye» aplicada a un saldo.

### 3. Ninguna cifra vive en el código

Toda la economía sale de [`datos/puntos.json`](datos/puntos.json) y todo hex
sale de [`datos/marca.json`](datos/marca.json). Si el código necesita un valor
que no está ahí, ese valor no existe todavía.

**Los valores en `null` o `PENDIENTE` no se rellenan a ojo.** Mientras lo estén,
su pantalla no se muestra y su endpoint responde 503 diciendo qué falta. Una
cifra inventada en un programa de puntos es dinero real regalado o negado.

### 4. Los puntos de referido se pagan con la primera compra

Nunca al registrarse. Pagar por el alta convierte el programa en una fábrica de
cuentas falsas. Un solo nivel: quien trae gana por las compras de quien trajo, y
ahí se acaba la cadena.

### 5. El amarillo jamás toca el blanco

`#FED00F` sobre `#FFFFFF` da 1.47:1 — es invisible, no es que se lea mal. Es la
trampa número uno de esta marca en una interfaz, porque el impulso natural es
hacer el botón principal amarillo con letras blancas. **El botón de acción es
fondo amarillo con texto azul `#1340B1`** (5.9:1, AA). El verificador lo
comprueba regla de CSS por regla de CSS.

---

## Cómo se trabaja

```bash
npm install
npm run migrar:local     # crea las tablas en la base local
npm run dev              # servidor local en :8787
npm run verificar        # ¿el repositorio está en orden?
npm test                 # las reglas del dinero
npm run tipos            # el Worker compila
npm run build            # verifica, prueba y arma publico/
```

Desplegar no está en esa lista a propósito: lo hace GitHub Actions en cada
empuje a `main`. Ver [«Desplegar»](#desplegar).

`npm run dev` necesita un `.dev.vars` que no se versiona:

```ini
MODO = "desarrollo"
CORREO_DESARROLLO = "tu@correo.com"
SECRETO_SESION = "cualquier-cosa-en-local"
PIMIENTA_PIN = "cualquier-cosa-en-local"
```

`MODO=desarrollo` salta la comprobación de Access. **Nunca va a producción.**

---

## Desplegar

**Lo despliega GitHub Actions, no tú.** Cada empuje a `main` corre el flujo
[`entregar.yml`](.github/workflows/entregar.yml), que hace tres cosas en este
orden y se para en la primera que falle:

```
probar  →  migrar  →  desplegar
```

`probar` corre en los PR también, y ahí se acaba: de una rama no se publica
nada. Si algo falla, lo que está publicado sigue en pie.

**El orden es ése y no el contrario.** Una migración es aditiva: añade tablas y
columnas. El código viejo con columnas de más funciona igual —no las mira—; el
código nuevo con columnas de menos responde «La operación falló» a todo. Así que
la base va primero y el Worker después.

> Los dos hubs hermanos tienen migrar y desplegar en flujos separados, y los dos
> documentan que nadie puede encadenarlos: es una carrera que se gana por
> costumbre, porque migrar tarda segundos y construir tarda minutos. Aquí son
> tres trabajos encadenados y la carrera no existe.

### Los tres secretos

Dos en GitHub (Settings → Secrets and variables → Actions):

| Secreto | Dónde sale |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → Manage Account → API Tokens → Create Token → plantilla **Edit Cloudflare Workers**. **Antes de crearlo, súmale Account → D1 → Edit**: sin ese permiso, publicar funciona pero migrar no, y el fallo llega con la base ya tocada a medias. |
| `CLOUDFLARE_ACCOUNT_ID` | La barra lateral del panel de Workers. Aquí es **obligatorio**, aunque en otros repositorios sea opcional: este dueño tiene más de una cuenta, y cuando el token ve varias, wrangler pregunta cuál — y un token acotado no tiene permiso para leer la lista, así que falla con un error sobre permisos que no es lo que pasa. (Alternativa: escribir `"account_id"` en `wrangler.jsonc`; el flujo acepta las dos formas y prefiere el archivo.) |

Y dos en el **Worker**, que no van en GitHub. Se ponen **una sola vez** desde la
pestaña Actions → «Poner los secretos del Worker» → Run workflow:

| Secreto | Qué protege | ¿Se puede cambiar? |
|---|---|---|
| `SECRETO_SESION` | Firma la cookie de sesión del socio. Con ella cualquiera se fabrica una sesión a nombre de cualquiera. | Sí. Solo cierra las sesiones abiertas; cada socio vuelve a entrar con su PIN. |
| `PIMIENTA_PIN` | Se concatena al PIN antes de derivar el hash, y vive fuera de la base. Un PIN son seis dígitos: contra un volcado robado eso se agota en minutos, haya sal o no. Sin la pimienta, ese volcado no sirve de nada. | **No.** Ver abajo. |

Los dos son valores al azar que **nadie tiene que ver, recordar ni escribir
nunca**. Se generan en el flujo y se quedan en Cloudflare, sin pasar por el
portapapeles de nadie ni por el historial de una terminal.

**El flujo instala solo lo que falta y nunca sobrescribe.** Volver a lanzarlo no
hace nada y lo dice. Esa es la decisión más importante de ese archivo:

> Cambiar `PIMIENTA_PIN` **rompe el PIN de todos los socios a la vez y no tiene
> vuelta atrás**. Los hash guardados se derivaron con la pimienta vieja, que no
> está escrita en ningún sitio; con la nueva no cuadra ninguno. La única salida
> sería que una vendedora reiniciara el PIN de cada socio, uno por uno, con cada
> uno delante. Por eso desde ese flujo no se puede rotar, ni con confirmación.
> El día que haga falta, es una migración pensada, no un botón.

`SECRETO_SESION` sí se puede rotar marcando la casilla, y sirve si alguna vez se
sospecha que el valor se filtró.

Viven en el Worker y no en Actions porque Actions no los necesita: `wrangler
deploy` no los toca, y una llave que no hace falta en un sitio es una llave de
más dando vueltas.

### Publicar a mano, si hace falta

El botón sigue estando: Actions → «Probar y desplegar» → Run workflow. Y desde
la terminal, `npm run desplegar` hace lo mismo. Con una diferencia: lanzado a
mano **sin** `CLOUDFLARE_API_TOKEN`, el flujo falla en vez de avisar — quien
pulsa un botón espera que pase algo, y un verde que no hizo nada engaña.

### La puerta del equipo

Publicar **no** abre el panel. Mientras falten sus dos datos, `/panel/` responde
503 y la app del socio funciona igual.

En Cloudflare: **Zero Trust → Access → Applications → Self-hosted**.

- Dominio: `dcasa-socios.<cuenta>.workers.dev`
- **Ruta: `panel`** ← esto es lo que hace que una sola aplicación cubra pantalla
  y API
- Política: los correos de Marcial, del Sr. Jorge y de las tres vendedoras

De su pestaña *Overview* se copian los dos valores a `wrangler.jsonc`:

- `ACCESO_DOMINIO` ← el dominio del equipo, `algo.cloudflareaccess.com`
- `ACCESO_AUD` ← la etiqueta **Application Audience (AUD) Tag**

Al empujar ese cambio, el flujo despliega solo.

> **Cuidado con cuál de los dos identificadores se pega.** La etiqueta AUD son
> **64** caracteres hexadecimales. El que enseña la barra lateral del panel de
> Workers tiene **32** y es el de la **cuenta**. Se parecen, están a un clic el
> uno del otro, y con el equivocado puesto el panel queda **en pie** contestando
> «la sesión caducó» a cada llamada — sin sesión que caducar. En PanaClaw eso
> costó una tarde. `npm run verificar` lo para antes de construir, así que un
> valor mal copiado ya no llega a desplegarse.

### Por qué se comprueban los dos, y no solo el dominio

**El Team domain es uno por cuenta de Cloudflare**, no por aplicación.
`orange-brook-5740.cloudflareaccess.com` es la organización entera de Zero
Trust, y lo comparten este panel, el hub de PanaClaw y cualquier otra
herramienta que se proteja en esa cuenta.

**El AUD sí es único por aplicación**, y es lo único que las separa. Si el
Worker comprobara solo el dominio, cualquiera autorizado en `hub-panaclaw`
entraría también aquí: su token estaría firmado por el mismo equipo y sería
perfectamente válido. Por eso `worker/acceso.ts` compara las dos cosas, y por
eso ninguna de las dos se puede quitar «porque ya está la otra».

Ninguno de los dos valores es un secreto —son identificadores, y salen en el
propio panel de Cloudflare—, así que viven en `wrangler.jsonc` versionado, igual
que en los dos hubs hermanos.

### Una cosa que el flujo vigila por ti

`MODO=desarrollo` salta la comprobación de Access entera y deja el panel abierto
a quien dé con la dirección. Vive en `.dev.vars`, que no se versiona. Desde que
despliega Actions sola, un `"MODO": "desarrollo"` colado en `wrangler.jsonc` se
publicaría sin que nadie lo leyera — así que `npm run verificar` lo rechaza y el
flujo se para antes de migrar nada.

### El dominio, y el aviso más caro del proyecto

**Un QR impreso es permanente.** En cuanto haya mil volantes, un pendón en la
tienda y stickers en las cajas, la dirección que codifican no se puede cambiar.

**No imprimas nada que apunte a `dcasa-socios.<cuenta>.workers.dev`.** El QR
tiene que codificar una dirección en un dominio que D'CASA vaya a tener durante
años. En orden de preferencia:

1. `https://socios.dcasapty.com` — subdominio del propio cliente apuntando al
   Worker. Requiere el DNS de `dcasapty.com` en Cloudflare. Es la respuesta
   correcta.
2. `https://dcasapty.com/socios` — una redirección desde el sitio actual.
3. `https://juancitoads.com/dcasa-socios` — una regla en el Netlify de la
   agencia, como ya se hace con los SmartLinks. Sirve de puente porque se puede
   re-apuntar.

**Hasta que la dirección definitiva exista, los QR solo se muestran en pantalla.**
Nada a imprenta.

---

## La marca

Todo sale de
[`juanarrietabusiness-pixel/Agencia_Workspace`](https://github.com/juanarrietabusiness-pixel/Agencia_Workspace),
carpeta `Dcasa/01_ADN_y_Memoria/`, y está espejado en
[`datos/marca.json`](datos/marca.json). Los HEX están verificados por el cliente
en el formulario de onboarding de agosto de 2026.

| | |
|---|---|
| Azul | `#1340B1` |
| Amarillo | `#FED00F` |
| Hueso | `#E0DDD1` (en pantalla, `#EDEAE0`) |
| Tipografía | Anton (titulares, **solo caja alta**) · Oswald · Inter |
| Voz | Tuteo. El pana que sabe de casas. CTA único: «Escríbenos por WhatsApp» |

**Divergencia conocida:** los hex medidos *dentro* del archivo del logo
(`#1648C0`, `#FFD000`) no son los que el cliente confirmó. Manda el formulario
para todo lo que se compone. En la práctica: **el logo nunca se pone sobre una
masa plana de `#1340B1`** — los dos azules casi iguales pegados se leen como un
error de impresión. Va sobre blanco, sobre hueso, o dentro de su placa.

---

## Por dónde va

- [x] **Fase 1 — El esqueleto y la puerta.** Worker de dos zonas, guardia de
      Access, migraciones `0001`–`0002`, las dos fuentes de datos, el
      verificador, el build y las pruebas del dinero.
- [x] **Fase 2 — Socios y puntos.** Alta, PIN, sesión, candado, registro de
      compra, libro mayor. Pantallas de socio y de panel.
- [x] **Fase 3 — Referidos.** El vestado con la primera compra, los topes, el QR
      personal y compartir por WhatsApp.
- [x] **Fase 4 — Premios y canjes.** La máquina de estados y el Cron de
      vencimientos.
- [x] **Fase 5 — Reportes, términos y PWA.** El pasivo del programa, el reporte
      por vendedora, los términos —que leen las reglas reales, así que no pueden
      contradecir al sistema— y el regalo de cumpleaños, que lo acredita el
      Cron y no una pantalla.

El programa está entero. Lo que queda no es código: es lo de abajo.

## Lo que falta preguntarle a Marcial

La economía ya está decidida y vive en [`datos/puntos.json`](datos/puntos.json):
1 punto por dólar sobre el total con ITBMS, $20 de compra mínima, 0 por
registrarse, 500 al padrino y 250 al ahijado con la primera compra, 500 de
cumpleaños, sin vencimiento. Nada de eso se inventó aquí.

Quedan cuatro cosas, y ninguna bloquea el código:

1. **Confirmar el tope de 50,000 puntos por compra** (`acumulacion.puntosMaximosPorCompra`).
   No es una regla comercial: es un guardia contra el dedo que teclea $50,000 en
   vez de $500. Si D'CASA vende de verdad por encima de eso, hay que subirlo
   antes de que una venta grande se quede corta de puntos.
2. **Qué productos físicos entran como premio, y a cuántos puntos.** La escalera
   de descuentos ($5 a $100) ya está sembrada en `0004_premios_canjes.sql` y
   funciona sola. Un premio físico necesita costo real, no precio de lista.
   — Y de paso: **`LXI090202` figura con costo $26.01 y precio $4.99**. Uno de
   los dos está mal, y si es el precio, cada venta pierde $21.
3. **Qué correos más entran al panel.** Hoy la política `Equipo D'CASA` de Access
   tiene uno solo. Cada vendedora necesita el suyo: el reporte antifraude
   agrupa por correo, y con un correo compartido no agrupa nada.
4. **¿El DNS de `dcasapty.com` se puede mover a Cloudflare?** — de esto depende
   la dirección de los QR, y un QR impreso no se cambia. Mientras tanto todo
   vive en `dcasa-socios.abrinay1997.workers.dev`, que lleva dentro el nombre de
   una persona: antes de mandar un QR a imprenta, hay que resolver esto.

---

## Lo que esto NO es

- **No es un CRM.** No guarda conversaciones ni manda campañas.
- **No es un punto de venta.** No factura ni lleva inventario de la tienda.
- **No es el sitio web.** `dcasapty.com` es otra cosa y desde aquí no se toca.
- **No es un monedero.** Los puntos no son dinero y no salen de aquí.
- **No es multinivel.** Un nivel, y se gana porque alguien compró.
