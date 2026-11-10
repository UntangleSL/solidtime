# Inicio de sesión con Microsoft en Dokploy

Guía para desplegar y comprobar el inicio de sesión con Microsoft 365 de la Fase 2 en
`time.untangle.es`. Solo contiene **nombres** de variables y marcadores de posición
(`<ORGANIZATION-UUID>`, `<USER-UUID>`, `<correo-de-la-propietaria>`): ningún valor secreto, ningún
identificador real y ninguna dirección de correo real se guarda en git. Los valores viven en
Doppler (`vps`, configuración `prd`) y en la pestaña Environment de Dokploy.

## Alcance

- Qué cubre: variables de entorno, copia de Doppler a Dokploy, URI de redirección, arranque inicial de
  la propietaria sin correo saliente (D-22), la comprobación con `php artisan m365:check`, el primer
  inicio de sesión real, la dependencia del MFA de Entra (D-06), los límites de los usuarios sin
  contraseña, cómo desvincular una identidad y cómo apagar la integración.
- Qué no cubre: el correo saliente (tarea aparte con el
  postfix del VPS) y Cloudflare Access (solo una nota, ver el último apartado).
- El compose de referencia es `docs/deploy/dokploy-compose.fork.yml`. Este documento no lo aplica:
  pegarlo en Dokploy y redesplegar es un paso manual que se hace tras la aprobación de la propietaria.
- El inicio de sesión con correo y contraseña sigue funcionando para todas las personas; Microsoft es
  un camino adicional, no un sustituto.

## Variables de entorno

La integración se configura solo con variables de entorno (D-21). Un valor vacío o con solo espacios
cuenta como «no configurado»: no aparece el botón y las rutas responden 404.

| Variable | Origen | Obligatoria | Notas |
| --- | --- | --- | --- |
| `SOLIDTIME_MICROSOFT_CLIENT_ID` | Doppler `vps/prd` | Sí | Application (client) ID. Debe tener forma de GUID. |
| `SOLIDTIME_MICROSOFT_CLIENT_SECRET` | Doppler `vps/prd` | Sí | Valor del secreto (no el Id. de secreto). Nunca se imprime. |
| `SOLIDTIME_MICROSOFT_TENANT_ID` | Doppler `vps/prd` | Sí | Directory (tenant) ID. Debe ser un GUID: `common` y `organizations` se rechazan (D-01). |
| `SOLIDTIME_MICROSOFT_ORGANIZATION_ID` | Se rellena en el arranque inicial | No | Organización a la que entran las personas nuevas como empleadas. Vacía o sin forma de UUID = sin alta automática (el inicio de sesión de quien ya existe sigue funcionando). |
| `SOLIDTIME_MICROSOFT_REDIRECT_URI` | Literal, vacía | No | Solo para forzar otra URL de retorno. Vacía = `APP_URL` + `/auth/microsoft/callback`. |
| `SOLIDTIME_MICROSOFT_ALLOWED_DOMAINS` | Literal `untanglegrowth.com,untangle.es` | No | Dominios de correo permitidos (D-02); se normalizan (minúsculas, sin duplicados). |
| `SOLIDTIME_MICROSOFT_DEFAULT_TIMEZONE` | Literal `Europe/Madrid` | No | Zona horaria cuando el navegador no envía una válida. |
| `APP_URL` | Literal `https://time.untangle.es` | Sí | Con esta URL se construye la URI de redirección; no depende de las cabeceras del proxy. |
| `APP_FORCE_HTTPS` | Literal `true` | Sí | Detrás de Traefik, para que Laravel genere enlaces `https`. |
| `TRUSTED_PROXIES` | Literal: CIDR de la red Docker de Traefik | Sí | Se obtiene con `docker network inspect dokploy-network` (campo Subnet). Solo afecta a la IP de cliente (límite de intentos y registros), no a la URI de redirección. |
| `SESSION_LIFETIME` | Literal `720` | Sí | 12 horas para todas las personas (D-20); los inicios de sesión con Microsoft nunca marcan «recordarme». El compose usa 720 por defecto. |
| `APP_ENABLE_REGISTRATION` | Literal `off` | Sí | Solo `on` durante el arranque inicial; después vuelve a `off`. |

## Copiar de Doppler a Dokploy

1. Compose de Dokploy: `untangle-solidtime-tq34sf` (composeId `PtyO0frWvgS_QEaN9g1bW`), pestaña
   Environment.
2. Lee cada valor de Doppler, sin pegarlo en chats ni tickets:
   `doppler secrets get <NAME> -p vps -c prd --plain` (o desde el panel de Doppler). Los nombres a
   copiar son `SOLIDTIME_MICROSOFT_CLIENT_ID`, `SOLIDTIME_MICROSOFT_CLIENT_SECRET` y
   `SOLIDTIME_MICROSOFT_TENANT_ID`.
3. Pégalos en Environment con el mismo nombre. Dokploy solo inyecta en el contenedor las variables que
   el compose lista en `environment:`; por eso `dokploy-compose.fork.yml` las enumera todas.
4. **Redespliega siempre después de cambiar variables.** La imagen ejecuta `php artisan optimize`, que
   guarda la configuración y las rutas en caché, y Octane mantiene los procesos en memoria: sin
   redespliegue, la aplicación sigue con los valores antiguos.

## URI de redirección

- Se construye con `APP_URL` sin barra final + `/auth/microsoft/callback`, así que con
  `APP_URL=https://time.untangle.es` resulta `https://time.untangle.es/auth/microsoft/callback`, que es
  el valor registrado en Entra.
- Entra solo acepta `http` para `localhost`. Si `m365:check` muestra `WARNING: redirect uri is not https`,
  corrige `APP_URL` (no hace falta tocar nada más).
- Error `AADSTS50011` (la URL de respuesta no coincide): la URI que envía la aplicación no está
  registrada tal cual en Entra. Compara la línea `redirect uri:` de `m365:check` con la lista de
  Redirect URIs del registro (ver `docs/m365/RUNBOOK-entra-app.md`).
- `SOLIDTIME_MICROSOFT_REDIRECT_URI` solo se rellena para sobrescribirla; se usa tal cual, sin cambios.

## Arranque inicial sin correo (D-22)

El correo saliente de producción no está configurado, así que la propietaria no puede verificar su
dirección por correo. El orden es:

1. En Environment pon `APP_ENABLE_REGISTRATION=on` y redespliega.
2. La propietaria se registra en `/register` con **exactamente** la dirección de su cuenta de
   Microsoft 365 (`<correo-de-la-propietaria>`). Así, en su primer inicio de sesión con Microsoft la
   cuenta se vincula a ese usuario en vez de rechazarse.
3. Verifica la dirección directamente en la base de datos (alternativa SQL), desde el contenedor
   `database` (`psql -U <usuario> -d <base-de-datos>`; los valores salen del Environment de Dokploy):

   ```sql
   UPDATE users SET email_verified_at = now() WHERE email = '<correo-de-la-propietaria>' AND email_verified_at IS NULL;
   ```

   Debe responder `UPDATE 1`. Con `UPDATE 0` la dirección no coincide o ya estaba verificada.
4. Ella entra con correo y contraseña y cambia el nombre de su organización personal a «Untangle».
5. Lee el id de la organización en la URL `/organizations/<ORGANIZATION-UUID>` y ponlo en
   `SOLIDTIME_MICROSOFT_ORGANIZATION_ID`.
6. Pon `APP_ENABLE_REGISTRATION=off` y redespliega.
7. Comprueba con `m365:check` (apartado siguiente). El correo saliente es una tarea posterior e
   independiente.

## Comprobación

Dentro del contenedor `app`:

```sh
php artisan m365:check
```

Imprime una línea por elemento y **nunca** el secreto ni ningún token; es seguro pegarla en un ticket.
Termina con código 1 si falta algo obligatorio y 0 en caso contrario.

- `configured: yes` (o `no` seguida de `missing: <nombres>`, solo nombres de variables).
- `redirect uri: https://time.untangle.es/auth/microsoft/callback` (más una línea `WARNING` si no es https
  fuera del entorno local).
- `allowed domains: untanglegrowth.com, untangle.es` (o `none`, que rechaza todos los inicios de sesión).
- `organization: not set`, `<ORGANIZATION-UUID> (Untangle)` o `<ORGANIZATION-UUID> NOT FOUND`
  (en ese caso el alta automática falla, pero quien ya existe sigue pudiendo entrar).
- `registration: off`, `force https: true`, `session lifetime: 720`.
- `linked accounts: <n> (connected: <m>)`.

## Primer inicio de sesión con Microsoft

Es el primer uso real del secreto de producción (D-12): hasta ahora solo se comprobó su forma.

1. Abre `https://time.untangle.es/login` y pulsa el botón de Microsoft con la cuenta de la propietaria.
2. Si el registro muestra `provider_code AADSTS7000215` (credencial no válida), el valor guardado del
   secreto es incorrecto. Crea un secreto nuevo según `docs/m365/RUNBOOK-entra-app.md`, apartado
   `## Renovación del secreto`, cópialo a Doppler y a Dokploy, y redespliega.
3. Anota la fecha del primer inicio de sesión correcto en `docs/m365/RUNBOOK-entra-app.md`
   (`## Verificación` y `## Historial`).

## MFA de Entra (segundo factor)

Los inicios de sesión con Microsoft **no pasan por el desafío TOTP de solidtime** (D-06): el segundo
factor es el MFA de Entra. Esa protección existe solo si el tenant la exige, de una de estas dos
formas:

- **Security Defaults** activados (en español, «valores predeterminados de seguridad»), o
- una **directiva de Acceso condicional** que exija MFA a todas las personas usuarias.

Desactivar Security Defaults sin una directiva de Acceso condicional equivalente **elimina el segundo
factor de todos los inicios de sesión con Microsoft en solidtime**. Dónde comprobarlo en el centro de
administración de Entra:

- Identidad → Información general → Propiedades → Administrar valores predeterminados de seguridad.
- Protección → Acceso condicional → Directivas (busca una que exija MFA a todos los usuarios).

Evidencia en la aplicación: cada inicio de sesión con Microsoft escribe en el log una línea
`Microsoft sign-in completed` con el dato `amr_mfa` igual a `yes`, `no` o `absent`. La aplicación
**no rechaza** nunca un inicio de sesión por ese valor: Security Defaults pide MFA según el riesgo y
muchos tokens no traen la reclamación `amr`, así que `absent` no es un error. Una serie de valores `no`
después de un cambio en el tenant es la señal para volver a revisar la configuración. El log está en la
salida del contenedor o en `storage/logs`, según `LOG_CHANNEL`.

La puerta de publicación de la Fase 2 (plan 02-11) anota la fecha de esta comprobación en el runbook de
Entra; repítela tras cualquier cambio en Security Defaults o en el Acceso condicional.

## Usuarios sin contraseña

Quien se da de alta con Microsoft no tiene contraseña en solidtime. Consecuencias:

- No puede cambiar la contraseña, eliminar su propia cuenta, cerrar las demás sesiones ni activar TOTP,
  porque esas acciones piden la contraseña actual.
- «¿Olvidaste tu contraseña?» le permite fijar una cuando el correo saliente funcione.
- Su inicio de sesión queda protegido por el MFA de Entra (apartado anterior).
- Una persona administradora puede eliminar usuarios.
- No hay «recordarme» para estos usuarios, por eso la sesión dura 12 horas (`SESSION_LIFETIME=720`).

## Desconectar y desvincular

- **Desconectar** (perfil de la persona): conserva el vínculo con la identidad de Microsoft y borra los
  tokens. La persona puede seguir entrando con Microsoft; solo se pierde el acceso a datos de Microsoft
  hasta que vuelva a conectar.
- **Desvincular por una persona administradora** (identidad equivocada o cuenta renombrada), desde el
  contenedor `database`:

  ```sql
  DELETE FROM microsoft_accounts WHERE user_id = '<USER-UUID>';
  ```

  Las entradas de tiempo no se tocan. En el siguiente inicio de sesión con Microsoft la cuenta se
  vuelve a vincular por dirección de correo verificada, o se rechaza si no coincide ninguna.

## Clientes OAuth de la app de escritorio y la extensión

La app de escritorio y la extensión del navegador se conectan por OAuth (Passport) a través del
inicio de sesión web, así que funcionan igual con Microsoft que con contraseña. Cada una necesita
su propio cliente público en esta instancia: los Client ID que traen de fábrica son los de la nube de
solidtime y aquí no existen. Con un Client ID desconocido, `/oauth/authorize` responde 401 y la
extensión muestra «Authorization page could not be loaded».

**Configuración de la extensión para time.untangle.es** (Instance Settings de la extensión):

| Campo | Valor |
| --- | --- |
| Solidtime Instance Endpoint | `https://time.untangle.es` |
| Solidtime Instance Client Id | `01a1abb9-d919-7314-8d56-118a74adf57b` |

Cliente «Browser Extension» creado el 2026-11-05 con la URI de redirección de la extensión de la
Chrome Web Store. Sirve para cualquier persona que instale esa extensión.

Crear el cliente (solo si no existe, por ejemplo con una base de datos nueva), en la terminal del
contenedor `app`:

```bash
cd /var/www/html && php artisan passport:client --public --name="Browser Extension" --redirect_uri="https://<ID-EXTENSION>.chromiumapp.org/"
```

- La URI de redirección es la que muestra la extensión en «show redirect url to oauth». La de la
  extensión de la Chrome Web Store es `https://hpanifeankiobmgbemnhjmhpjeebdhdd.chromiumapp.org/`.
- Si pregunta por el *provider*, elegir `users`.
- El Client ID que muestra el comando se pega en la extensión (Instance Settings) junto con el
  endpoint `https://time.untangle.es`. No es secreto (cliente público sin contraseña).
- El cliente vive en la tabla `oauth_clients` de la base de datos: no cambia al redesplegar. Solo se
  pierde si se crea una base de datos nueva; entonces hay que volver a crearlo y actualizar el ID en
  cada equipo. Las claves `PASSPORT_PRIVATE_KEY`/`PASSPORT_PUBLIC_KEY` del entorno deben mantenerse,
  o las sesiones ya conectadas tendrán que volver a iniciar sesión.

## Reuniones de Outlook en el calendario (Fase 3)

El calendario de solidtime muestra las reuniones de Outlook de cada persona como sugerencias de solo
lectura («fantasmas») junto a sus entradas de tiempo. No crean ni modifican entradas: los totales no
cambian.

- **Qué se guarda.** solidtime copia las reuniones elegibles de cada persona en las tablas
  `outlook_meetings` y `outlook_sync_windows` (el rango de fechas ya sincronizado). No se guardan las
  reuniones privadas, las canceladas ni las de todo el día. Cada fila pertenece a una sola persona y
  ninguna ruta acepta un identificador de usuario: solo se actúa sobre la sesión actual.
- **Cuándo se sincroniza.** Al abrir el calendario, al navegar entre semanas y con el botón «Sync
  Outlook». La lectura de `GET /m365/meetings` solo consulta la copia local y nunca llama a Graph; la
  sincronización es `POST /m365/meetings/sync`.
- **Ajustes de Graph.** Los parámetros `microsoft365.graph.*` (`max_pages`, `connect_timeout`,
  `timeout`, `deadline_seconds`, `reuse_seconds`, `min_interval_seconds`, `lock_seconds`) viven en
  `config/microsoft365.php` con valores fijos. **No hay variables de entorno nuevas** en esta fase, así
  que el Environment de Dokploy no cambia.
- **Límites de frecuencia.** Las rutas usan el limitador de Laravel con prefijos propios:
  `m365-read:` (lectura, 60 por minuto), `m365-sync:` (sincronización, 12 por minuto) y
  `m365-dismiss:` (descartar y restaurar, 60 por minuto). Si Outlook limita las peticiones (429/503) se
  respeta con `graph_backoff_until` en la cuenta de Microsoft de la persona: hasta esa hora no se vuelve
  a llamar a Graph y se muestran las reuniones ya guardadas.
- **Reconectar.** El botón «Reconnect Microsoft» aparece solo cuando el fallo del token lo puede
  arreglar la persona (por ejemplo, una sesión revocada en Entra). Si caduca el
  **secreto de cliente** de la aplicación de Entra, todas las personas ven «Outlook unavailable» y no
  tienen nada que reconectar: busca en el log líneas `Microsoft token refresh failed` con
  `reason=client_error` y renueva el secreto según `docs/m365/RUNBOOK-entra-app.md`
  (`## Renovación del secreto`).
- **Carril de Outlook (D-23).** Las reuniones ocupan un carril reservado a la derecha de cada día, de
  modo que siguen siendo alcanzables aunque haya entradas de tiempo en la misma franja.
- **Desconectar borra la copia (D-21).** «Disconnect» en el perfil elimina las reuniones guardadas, los
  descartes y las ventanas de sincronización de esa persona, además de los tokens. Volver a conectar
  empieza de cero.
- **Suplantación (D-22).** Mientras una persona administradora suplanta a otra desde Filament no se
  muestran reuniones ni controles de Outlook y nunca se llama a Graph con la cuenta suplantada.
- **Rutas y Cloudflare Access.** `/m365/*` son rutas de sesión del navegador (cookie y CSRF) y no
  aceptan tokens de API, por eso **no necesitan ninguna excepción (bypass) de Cloudflare Access**. La
  excepción de `/api/*`, `/oauth/token` y `/health-check/up` descrita más abajo no cambia.
- **Comprobación pública tras desplegar.** `GET /m365/meetings` sin sesión y con
  `Accept: application/json` responde 401 (ruta desplegada e integración activa); 404 significa que la
  integración está apagada o que la ruta no está desplegada.
- **Migraciones.** Con `AUTO_DB_MIGRATE` el contenedor `app` aplica al arrancar
  `2026_11_05_000001_create_outlook_meetings_tables` (dos tablas nuevas) y
  `2026_11_05_000002_add_graph_state_to_microsoft_accounts_table` (dos columnas anulables en
  `microsoft_accounts`: `reconnect_required_at` y `graph_backoff_until`). Son aditivas y tienen
  `down()`; no reescriben datos.

Pendiente para la Fase 7 (SEC-04), conocido y aceptado por ahora:

- Las URL de conectar y desconectar del perfil y `microsoft.redirect?intent=connect` no se bloquean
  durante la suplantación: una persona administradora suplantando podría iniciar la conexión o
  desconectar (y purgar) los datos de esa persona.
- Una sincronización que corre a la vez que una desconexión puede volver a insertar filas que quedan
  invisibles (la lectura responde vacío sin una cuenta conectada); se eliminan en la siguiente
  desconexión.

## Apagar la integración

Vacía `SOLIDTIME_MICROSOFT_CLIENT_ID`, `SOLIDTIME_MICROSOFT_CLIENT_SECRET` o
`SOLIDTIME_MICROSOFT_TENANT_ID` en Dokploy y redespliega: desaparece el botón y las rutas de Microsoft
responden 404. El inicio de sesión con correo y contraseña no cambia. La comprobación completa de
apagado y limpieza se hace en la Fase 7.

## Cloudflare Access (futuro)

Más adelante el sitio puede ponerse detrás de Cloudflare Access con Entra como proveedor de identidad
(D-23). No forma parte de esta fase, la aplicación no depende de Cloudflare ni de ninguna pasarela
externa para la identidad, y nada de lo anterior lo da por supuesto. Cuando se active, hay que crear
una excepción (bypass) para `/api/*`, `/oauth/token` y `/health-check/up`, o la aplicación de
escritorio, la extensión del navegador y las comprobaciones de salud dejarán de funcionar. El inicio de
sesión con Microsoft dentro de solidtime sigue siendo necesario para la identidad y los tokens de Graph.
