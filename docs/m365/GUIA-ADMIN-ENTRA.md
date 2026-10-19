# Guía para la administración de Microsoft 365: registrar solidtime en Microsoft Entra

Esta guía es para la persona que administra Microsoft 365 en Untangle. No hace falta saber programar:
cada paso dice por dónde entrar, qué pulsar y qué valor pegar, y termina con lo que debes ver en
pantalla para saber que ha salido bien.

**Qué es la aplicación.** solidtime es la herramienta de control de tiempo de Untangle. Con esta
configuración el equipo podrá entrar con su cuenta de Microsoft 365 y ver sus reuniones de Outlook
dentro de solidtime. La aplicación solo **lee** los calendarios: no puede crear, cambiar ni borrar
nada en Outlook.

**Cuánto tiempo lleva.** Unos 45 minutos para registrar la aplicación (Partes 1 a 5). Las Partes 6 a 9
preparan las cuentas de prueba y los eventos de Outlook en dos rondas, y la Parte 10 es la entrega de
datos.

**Idioma del portal.** Las etiquetas en español de Microsoft cambian de una versión del portal a
otra. Por eso cada etiqueta lleva la etiqueta en inglés entre paréntesis. Si algo no coincide,
puedes cambiar el portal a inglés (rueda de Configuración > idioma) y seguir las etiquetas en
inglés. Anota cualquier etiqueta que no coincida y cuéntalo en la entrega (Parte 10).

**Avisos que enviarás al equipo.** Tres mensajes cortos, por el canal habitual (nunca con
secretos): «Registro listo», «Ronda A lista» y «Ronda B lista».

**Dominio de producción.** La dirección pública de solidtime en Dokploy aparece en esta guía como
`<DOMINIO-DOKPLOY>`. Es una marca: el equipo te dará el dominio real y tú lo escribes en su lugar,
sin `https://` y sin barra final. Si todavía no te lo han dado, completa todo lo demás y vuelve a
ese único paso cuando lo tengas.

**Regla de oro.** Un secreto o una contraseña **nunca** se pega en un chat, un correo, Teams, un
ticket ni el repositorio. Solo viaja por el gestor de contraseñas de la empresa (Parte 10).

Índice: Preparación, Parte 1 (registro), Parte 2 (URI de redirección), Parte 3 (permisos y
consentimiento), Parte 4 (secretos de cliente), Parte 5 (aplicación empresarial), Parte 6 (acceso
condicional), Parte 7 (usuarias de prueba y buzón), Parte 8 (escenarios de Outlook, Ronda A), Parte 9
(modificaciones, Ronda B) y Parte 10 (entrega).

## Preparación

**Qué hacer**

1. **Roles.** Para registrar la aplicación necesitas al menos el rol *Desarrollador de aplicaciones*
   (Application Developer). Para conceder el consentimiento y asignar personas necesitas *Administrador
   de aplicaciones en la nube* (Cloud Application Administrator) o *Administrador de aplicaciones*
   (Application Administrator). Una cuenta de *Administrador global* (Global Administrator) también
   sirve para hacer la configuración, pero **no** para las usuarias de prueba (punto 4).
2. **Licencias.** Comprueba si el inquilino tiene Microsoft Entra ID P1 o P2 (por ejemplo, Microsoft 365
   Business Premium incluye P1). Entra ID > Licencias (Licenses) > Todos los productos (All products).
   Sin P1 ni P2 no se pueden asignar grupos a una aplicación: en ese caso se asigna a las personas una
   a una (Parte 5) y en la entrega anotas `Modo de asignación: individual`. Con P1 o P2 se asigna un
   grupo, y solo cuentan sus **miembros directos**: los grupos anidados dentro de ese grupo no valen.
3. **Gestor de contraseñas.** Crea una entrada vacía llamada `solidtime-m365` en el gestor de
   contraseñas de la empresa. Ahí guardarás los secretos de la Parte 4.
4. **Dos usuarias de prueba, A y B.** Hacen falta dos cuentas dedicadas, con licencia que incluya un
   buzón de Exchange Online, y **ninguna con rol de administrador** (ni siquiera Administrador global).
   Motivo: un Administrador global se salta la opción «Asignación requerida» y se saltaría el bloqueo
   que queremos comprobar (el error AADSTS50105). La usuaria A estará dentro del grupo asignado como
   miembro directo; la usuaria B quedará fuera. Se crean o se confirman en la Parte 7.
5. **Qué tendrás a mano al terminar.** Los dos identificadores de la aplicación (no son secretos), la
   fecha de caducidad de los secretos, el nombre del grupo y el valor de los secretos en el gestor de
   contraseñas.

**Por qué**

Los permisos que concedemos son mínimos (solo lectura de calendario) y la aplicación solo debe poder
usarla el personal asignado. Dos cuentas de prueba sin privilegios permiten comprobar de verdad que
quien no está asignado queda fuera.

**Cómo comprobarlo**

Sabes si tienes P1 o P2 porque aparece en la lista de productos de Licencias. Tienes dos cuentas de
prueba que no figuran en ningún rol de administrador (Entra ID > Roles y administradores (Roles &
administrators) no las lista) y una entrada vacía en el gestor de contraseñas.

## Parte 1 – Registro de la aplicación

**Qué hacer**

1. Entra en el centro de administración de Microsoft Entra: `https://entra.microsoft.com`.
2. Entra ID > Registros de aplicaciones (App registrations) > Nuevo registro (New registration).
3. Nombre (Name): escribe `solidtime-m365`.
4. Tipos de cuenta admitidos (Supported account types): elige **Solo este inquilino** (Single tenant only), la primera opción, con el nombre de Untangle.
5. URI de redirección (Redirect URI): déjalo **vacío** en esta pantalla; se añade en la Parte 2.
6. Pulsa Registrar (Register).
7. En Información general (Overview) copia el identificador de aplicación (cliente) (Application
   (client) ID) y el identificador de directorio (inquilino) (Directory (tenant) ID). No copies el
   «Id. de objeto» (Object ID): es otro valor. Estos dos identificadores **no son secretos** y se
   entregan en la Parte 10.

**Por qué**

La aplicación es solo para cuentas de Untangle: nunca multiinquilino ni cuentas personales de
Microsoft. Con «Solo este inquilino» nadie de fuera de Untangle puede iniciar sesión.

**Cómo comprobarlo**

La página de Información general muestra el nombre `solidtime-m365`, los dos identificadores y
«Tipos de cuenta admitidos: Mi organización solamente» (o similar, con el nombre de Untangle).

## Parte 2 – URI de redirección

**Qué hacer**

1. En la aplicación `solidtime-m365`: Administrar (Manage) > Autenticación (Authentication).
2. Pestaña Configuración del URI de redirección (Redirect URI configuration) > Agregar URI de
   redirección (Add Redirect URI).
3. En «Seleccionar una plataforma» elige el icono **Web** (Web).
   - NUNCA elijas «Aplicación de página única» (Single-page application).
   - NUNCA elijas «Aplicaciones móviles y de escritorio» (Mobile and desktop applications).
4. Pega los URI de uno en uno, tal cual, sin barra final, sin comodines y sin puerto, y pulsa Configurar
   (Configure) cada vez:

   | URI (pégalo exactamente) | Para qué sirve |
   | --- | --- |
   | `https://<DOMINIO-DOKPLOY>/auth/microsoft/callback` | Producción en Dokploy. Sustituye `<DOMINIO-DOKPLOY>` por el dominio que te dé el equipo; debe ser https. |
   | `https://solidtime.test/auth/microsoft/callback` | Desarrollo local con proxy. |
   | `http://localhost/auth/microsoft/callback` | Desarrollo local sin proxy. |
   | `http://localhost/m365-spike/callback` | TEMPORAL: solo para la herramienta de captura del desarrollador; se elimina en la limpieza. |

   Si el equipo aún no te ha dado el dominio, añade los otros tres ahora y el de producción después.
5. En la misma página, sección Concesión implícita y flujos híbridos (Implicit grant and hybrid flows):
   - Las dos casillas, Tokens de acceso (Access tokens) y Tokens de id. (ID tokens), deben quedar desmarcadas.
6. Configuración avanzada (Advanced settings; según la versión del portal está en la pestaña Configuración (Settings) o al final de la página):
   - Permitir flujos de cliente público (Allow public client flows) = No.
7. Pulsa Guardar (Save) si el portal lo pide.

**Por qué**

La plataforma Web permite usar el secreto de cliente y renovar la sesión de forma duradera; una
aplicación de página única guardaría credenciales en el navegador y caducaría cada 24 horas. El valor
No en los flujos de cliente público evita que alguien que conozca el identificador de la aplicación
lance contra ella un inicio de sesión por código de dispositivo (phishing). Las casillas implícitas
desmarcadas cierran un mecanismo antiguo que no usamos.

**Cómo comprobarlo**

Bajo la plataforma Web aparecen los URI que has añadido (cuatro si ya tienes el dominio), ninguno bajo
otra plataforma. Si se escribe mal un URI, más adelante Microsoft devolverá el error AADSTS50011 (el URI
de redirección no coincide): distingue mayúsculas y minúsculas y no admite una barra final.

## Parte 3 – Permisos y consentimiento

**Qué hacer**

1. Administrar (Manage) > Permisos de API (API permissions) > Agregar un permiso (Add a permission) >
   Microsoft Graph > Permisos delegados (Delegated permissions).
2. Marca `openid`, `profile`, `email` y `offline_access` (grupo OpenId permissions). Mantén
   `User.Read` (ya viene puesto al registrar). Marca `Calendars.Read` (grupo Calendars). Pulsa Agregar
   permisos (Add permissions).
3. NO marques `Calendars.ReadWrite`, NO `Calendars.ReadBasic` y NO marques ningún permiso de tipo Application permissions.
4. La lista final debe mostrar exactamente estos seis permisos delegados, y ninguno más:
   `openid profile email offline_access User.Read Calendars.Read`
5. Pulsa Conceder consentimiento de administrador para su inquilino (Grant admin consent for your tenant) > Sí > Actualizar (Refresh).

**Por qué**

Pedimos lo mínimo: leer calendarios y datos básicos del perfil, siempre en nombre de cada usuaria y
sin poder modificar nada. Como la aplicación exigirá asignación (Parte 5), las personas no pueden dar
su propio consentimiento: tiene que concederlo un administrador, y hacerlo ahora evita que cada
persona vea una pantalla de permisos.

**Cómo comprobarlo**

La columna Estado (Status) de cada permiso muestra «Concedido para» y el nombre de Untangle. La lista
no contiene ningún otro permiso.

## Parte 4 – Secretos de cliente

**Qué hacer**

Dentro de la aplicación: Administrar (Manage) > Certificados y secretos (Certificates & secrets) >
pestaña Secretos de cliente (Client secrets) > Nuevo secreto de cliente (New client secret).

**(a) Secreto de producción**

1. Descripción (Description): `produccion-AAAA-MM`, con el año y el mes actuales (por ejemplo, el de hoy).
2. Expira (Expires): elige la opción predefinida de 180 días (6 meses). Microsoft permite hasta 24
   meses y recomienda menos de 12; nosotros fijamos 180 días.
3. Pulsa Agregar (Add). Copia **en ese momento** la columna **Valor** (Value). No copies la columna Id.
   de secreto (Secret ID). El Valor solo se muestra una vez.
4. Pégalo directamente en la entrada `solidtime-m365` del gestor de contraseñas. Es el único sitio
   donde vive: irá a Dokploy en la Fase 2, nunca a un portátil.
5. Apunta la fecha exacta de caducidad y crea un recordatorio en el calendario 45 días antes (como
   mínimo 30), a nombre de un rol de administración y no de una persona concreta.

**Por qué**

Un secreto caducado deja a todo el personal sin acceso. El recordatorio con margen y la renovación
con dos secretos a la vez (ver el runbook) evitan ese corte.

**Cómo comprobarlo** (el mismo día)

1. Sal de la página y vuelve a Certificados y secretos. La columna Valor (Value) del secreto solo
   muestra los tres primeros caracteres.
2. Abre la entrada del gestor de contraseñas y comprueba que lo guardado empieza por esos mismos tres
   primeros caracteres y que **no** parece el Id. de secreto (Secret ID): el Id. de secreto tiene 36
   caracteres con cuatro guiones, y el Valor no.
3. Si cualquiera de las dos comprobaciones falla, elimina ese secreto y crea otro (el Valor no se
   puede volver a mostrar).
4. Apunta la fecha de esta comprobación: va en la entrega.

Esta comprobación atrapa el error más común (copiar el Id. de secreto en lugar del Valor) mientras el
valor sigue en el gestor de contraseñas. El primer inicio de sesión con Microsoft en Dokploy (Fase 2)
será la prueba definitiva de que el secreto funciona.

**(b) Secreto spike (TEMPORAL)**

1. TEMPORAL: crea un segundo secreto con Descripción (Description) `spike-AAAA-MM` (TEMPORAL),
   con el año y el mes actuales.
2. TEMPORAL: Expira (Expires) también 180 días (6 meses). Debe seguir vigente durante el registro, la
   Ronda A y la Ronda B, y esas fechas dependen de cuándo se preparen los escenarios.
3. TEMPORAL: lo usa solo la herramienta de captura del desarrollador. Entrégalo únicamente por el
   gestor de contraseñas. Se elimina en la limpieza, de modo que el secreto de producción nunca sale
   del gestor de contraseñas.
4. TEMPORAL: si el equipo avisa de que caducó antes de terminar la Ronda B (error AADSTS7000222), crea
   otro igual y entrégalo igual; las capturas ya hechas siguen siendo válidas.

**Por qué (secreto spike)**

Separar el secreto de la captura del de producción mantiene el de producción fuera de los portátiles
de desarrollo, y se destruye cuando termina el trabajo.

**Cómo comprobarlo (secreto spike)**

La lista de secretos muestra dos filas: `produccion-AAAA-MM` y el secreto spike, cada una con su fecha
de caducidad distinta.

## Parte 5 – Aplicación empresarial: asignación obligatoria

**Qué hacer**

1. Entra ID > Aplicaciones empresariales (Enterprise apps) > Todas las aplicaciones (All applications)
   y abre `solidtime-m365`. Se crea sola al registrar la aplicación; si no aparece, espera un minuto y
   pulsa Actualizar.
2. Administrar (Manage) > Propiedades (Properties):
   - ¿Asignación requerida? (Assignment required?) = Sí.
   - ¿Habilitado para que los usuarios inicien sesión? (Enabled for users to sign-in?) = Sí.
   - Pulsa Guardar (Save).
3. Administrar (Manage) > Usuarios y grupos (Users and groups) > Agregar usuario o grupo (Add
   user/group) > Ninguno seleccionado (None Selected): elige el grupo del personal que te indique el
   equipo (solo cuentan sus miembros directos) > Seleccionar (Select) > rol Acceso predeterminado
   (Default Access) > Asignar (Assign).
4. Comprueba que la usuaria A es miembro directo de ese grupo y que la usuaria B no está asignada de
   ninguna forma.
5. Sin P1 ni P2: no se puede asignar un grupo. Asigna una a una a cada persona del equipo y a la
   usuaria A con Agregar usuario o grupo, y en la entrega anota `Modo de asignación: individual`.

**Por qué**

Con la asignación obligatoria, Microsoft rechaza a cualquier persona no asignada, también a invitados
externos, con el error AADSTS50105 antes de que la aplicación llegue a verla. Recuerda que los
Administradores globales se saltan esta comprobación, por eso las usuarias de prueba no pueden serlo.

**Cómo comprobarlo**

Usuarios y grupos lista el grupo (o las personas) con el rol Acceso predeterminado, y Propiedades
muestra ¿Asignación requerida? = Sí. Más adelante, el intento de la usuaria B debe fallar con
AADSTS50105.

## Parte 6 – Revisión de acceso condicional

**Qué hacer**

1. Entra ID > Acceso condicional (Conditional Access) > Directivas (Policies).
2. Revisa cada directiva **activada** cuyos usuarios incluyan al grupo del personal o a «Todos los usuarios» y cuyos recursos de destino incluyan «Todos los recursos» (All resources), Office 365, Exchange Online o Microsoft Graph. De cada una apunta si exige:
   - Autenticación multifactor (MFA).
   - Frecuencia de inicio de sesión (sign-in frequency).
   - Dispositivo compatible o unido de forma híbrida (compliant or hybrid-joined device).
   - Ubicaciones con nombre (named locations).
   - Riesgo de inicio de sesión o de usuario (sign-in or user risk).
   - Protección de tokens (token protection).
   - Bloqueo de la autenticación heredada (block legacy authentication).
   - Bloqueo del flujo de código de dispositivo (block device code flow).
3. Sin salir de Directivas, pulsa ¿Qué Pasaría Si? (What If) y rellena:
   - Usuario (User): la usuaria A.
   - Recursos de destino (Target resources): la aplicación `solidtime-m365`, buscándola por su Application (client) ID. No uses el grupo «Office 365»: no coincide con esta aplicación.
   - Plataforma de dispositivo (Device platform): Windows.
   - Aplicaciones cliente (Client apps): Explorador (Browser).
   - Pulsa ¿Qué Pasaría Si? (What If) y apunta qué directivas se aplican y qué exigen.
4. Cuando el equipo te avise de que ha hecho el primer inicio de sesión con la usuaria A (después de tu «Registro listo»; es la Entrega 1), entra en Supervisión y estado (Monitoring & health) > Registros de inicio de sesión (Sign-in logs), abre el inicio de sesión de A y mira la pestaña Acceso condicional (Conditional Access) y la columna Audiencia (Audience). Apunta las directivas aplicadas y el resultado. Comprueba también que el intento fallido de la usuaria B aparece con AADSTS50105.
5. Anota todo como «hallazgos de acceso condicional» para la entrega. Esta guía no te pide ninguna exclusión: cualquier excepción es decisión tuya.

**Por qué**

Estas directivas deciden si el portátil de desarrollo puede iniciar sesión y cada cuánto tiempo hay que renovar las sesiones de la aplicación (se tendrá en cuenta en la Fase 3). Saberlo ahora evita bloqueos inesperados durante las capturas.

**Cómo comprobarlo**

Tienes una lista de las directivas que afectan a la aplicación (o la anotación «ninguna») y el resultado de ¿Qué Pasaría Si? para la usuaria A. Tras la Entrega 1, el registro de inicio de sesión de A muestra las mismas directivas con resultado Éxito (Success).

## Parte 7 – Usuarias de prueba y buzón

**Qué hacer**

1. Crea o confirma las dos usuarias de prueba, A y B, en Entra ID > Usuarios (Users) > Todos los usuarios (All users). Las dos con licencia que incluya un buzón de Exchange Online y **sin ningún rol de administrador**.
2. La usuaria A es miembro directo del grupo asignado en la Parte 5 (o está asignada una a una si no hay P1 ni P2). La usuaria B no está asignada.
3. Entra con cada una en Outlook en la web, en una ventana privada (InPrivate): `https://outlook.office.com/calendar`. Usa una ventana privada distinta para cada cuenta.
4. En cada buzón pon la zona horaria en (UTC+01:00) Bruselas, Copenhague, Madrid, París: Configuración (Settings, la rueda) > General > Idioma y hora (Language and time) > Zona horaria (Time zone); si no la encuentras, busca «zona horaria» en el cuadro de búsqueda de Configuración.
5. Si alguna directiva de acceso condicional lo exige, registra el método de autenticación multifactor de las dos cuentas.
6. Comparte las credenciales de A y de B con el desarrollador **solo** por el gestor de contraseñas.
7. Envía el aviso «Registro listo» (Entrega 1) con los puntos de la Parte 10 que ya tengas.

**Por qué**

Con cuentas de prueba dedicadas, los calendarios de empleados reales no entran en los datos que se capturan.

**Cómo comprobarlo**

En una ventana privada, Outlook en la web muestra el calendario de A y el de B, con la zona horaria de Madrid. Ninguna de las dos aparece en Entra ID > Roles y administradores (Roles & administrators).

## Parte 8 – Escenarios de Outlook (Ronda A)

**Qué hacer**

Usa **Outlook en la web** para todos los pasos y apunta qué cliente de Outlook usas (web, nuevo o clásico): los menús cambian. Trabaja con dos ventanas privadas, una con la sesión de A y otra con la de B.

**Regla del asunto (obligatoria):** el asunto empieza con la etiqueta entre corchetes, exactamente como en la tabla, por ejemplo `[M365-TEST S1] single`. La etiqueta identifica cada escenario y evita que entren datos reales.

Cómo se crea cada evento: Nuevo evento (New event) > escribe el asunto > fecha y hora (zona Madrid) > Invitar asistentes (Invite attendees) si la tabla lo pide > Enviar (Send) o Guardar. Opciones que aparecen en la tabla: Reunión de Teams (Teams meeting); Repetir (Repeat) > Semanalmente (Weekly); Privado (Private); Todo el día (All day); Mostrar como: Ocupado (Show as: Busy). Para responder una invitación, la persona invitada la abre y pulsa Aceptar (Accept) o Provisional (Tentative), y después Enviar (Send) la respuesta.

**Escenarios obligatorios** (horas en Europe/Madrid):

| ID | Asunto exacto | Quién lo crea | Cuándo | Qué hacer |
| --- | --- | --- | --- | --- |
| S1 | `[M365-TEST S1] single` | B organiza | miércoles 2026-10-21, 10:00-10:30 | Invita a A como asistente obligatoria y marca Reunión de Teams (Teams meeting). A pulsa Aceptar (Accept). |
| S1b | `[M365-TEST S1b] organizer` | A organiza | miércoles 2026-10-21, 12:00-12:30 | A invita a B. |
| S2 | `[M365-TEST S2] series` | B organiza | semanal, martes 10:00-10:30, desde el martes 2026-10-13, 5 repeticiones | Repetir (Repeat) > Semanalmente (Weekly), termina tras 5 repeticiones. A acepta toda la serie. |
| S3 | `[M365-TEST S3] cancelled` | B organiza | jueves 2026-10-29, 10:00-10:30 | A pulsa Aceptar (Accept). |
| S4 | `[M365-TEST S4] declined` | B organiza | jueves 2026-10-29, 12:00-12:30 | A pulsa Aceptar (Accept). Solo la rechazará en la Ronda B. |
| S5 | `[M365-TEST S5] moved` | B organiza | viernes 2026-10-30, 10:00-10:30 | A pulsa Aceptar (Accept). |
| S5b | `[M365-TEST S5b] moved week` | B organiza | viernes 2026-10-30, 12:00-12:30 | A pulsa Aceptar (Accept). |
| S6 | `[M365-TEST S6] private` | A organiza | lunes 2026-11-02, 10:00-10:30 | A invita a B y marca Privado (Private). |
| S6b | `[M365-TEST S6b] private attendee` | B organiza | lunes 2026-11-02, 12:00-12:30 | B marca Privado (Private) e invita a A. A pulsa Aceptar (Accept). |
| S7 | `[M365-TEST S7] all day` | A crea | miércoles 2026-11-04 | Marca Todo el día (All day). Sin asistentes. |
| S8 | `[M365-TEST S8] block` | A crea | miércoles 2026-10-28, 14:00-15:00 | Sin asistentes. Mostrar como: Ocupado (Show as: Busy). |

**Escenarios opcionales (recomendados):**

| ID | Asunto exacto | Quién lo crea | Cuándo | Qué hacer |
| --- | --- | --- | --- | --- |
| S7b | `[M365-TEST S7b] two days` | A crea | jueves 2026-11-05 a viernes 2026-11-06 | Marca Todo el día (All day) y pon dos días. Sin asistentes. |
| E1 | `[M365-TEST E1] series cancel one` | B organiza | semanal, jueves 16:00-16:30, desde el jueves 2026-10-22, 4 repeticiones | A acepta la serie. |
| E2 | `[M365-TEST E2] series split` | B organiza | semanal, lunes 16:00-16:30, desde el lunes 2026-10-19, 4 repeticiones | A acepta la serie. |
| E3 | `[M365-TEST E3] tentative` | B organiza | martes 2026-10-27, 16:00-16:30 | A responde Provisional (Tentative). |
| E4 | `[M365-TEST E4] no response` | B organiza | martes 2026-10-27, 17:00-17:30 | A **no** responde. |
| E5 | `[M365-TEST E5] overnight` | A crea | viernes 2026-11-06 a las 22:00 hasta el sábado 2026-11-07 a las 02:00 | No es de todo el día. Sin asistentes. |
| E6 | `[M365-TEST E6] series decline one` | B organiza | semanal, miércoles 16:00-16:30, desde el miércoles 2026-10-21, 4 repeticiones | A acepta la serie. |

**Fechas y cambio de hora.** España sale del horario de verano el domingo 2026-10-25. La serie S2 tiene repeticiones antes y después de ese día, algo que las fechas de arriba ya garantizan. La ventana de captura va de 2026-10-19T00:00:00Z a 2026-11-16T00:00:00Z. No pasa nada porque las primeras fechas ya estén en el pasado: Outlook acepta reuniones y series cuya primera repetición ya pasó.

**Alternativa de marzo de 2027.** Si preparas los escenarios después del 2026-11-16, usa estas mismas tablas sumando exactamente 22 semanas (154 días) a cada fecha. Los días de la semana no cambian. El cambio de hora pasa a ser el domingo 2027-03-28 y la ventana de captura va de 2027-03-22T00:00:00Z a 2027-04-19T00:00:00Z. Dile al equipo qué tabla has usado. Conversión de las fechas:

| Fecha de la tabla | Fecha de marzo |
| --- | --- |
| 2026-10-13 | 2027-03-16 |
| 2026-10-19 | 2027-03-22 |
| 2026-10-21 | 2027-03-24 |
| 2026-10-22 | 2027-03-25 |
| 2026-10-27 | 2027-03-30 |
| 2026-10-28 | 2027-03-31 |
| 2026-10-29 | 2027-04-01 |
| 2026-10-30 | 2027-04-02 |
| 2026-11-02 | 2027-04-05 |
| 2026-11-03 | 2027-04-06 |
| 2026-11-04 | 2027-04-07 |
| 2026-11-05 | 2027-04-08 |
| 2026-11-06 | 2027-04-09 |
| 2026-11-07 | 2027-04-10 |
| 2026-12-09 | 2027-05-12 |

**Al terminar.** Todo debe estar creado y respondido antes de enviar «Ronda A lista». Con ese aviso indica el cliente de Outlook y la zona horaria de los buzones. Después **detente**: no empieces la Parte 9 hasta que el equipo confirme «Ronda A capturada».

**Por qué**

Cada escenario enseña cómo informa Outlook de un tipo distinto de reunión (única, serie, cancelada, rechazada, movida, privada, de todo el día o sin asistentes). Con ellos, solidtime sabrá reconocerlas y tratarlas bien cuando lea los calendarios.

**Cómo comprobarlo**

En el calendario de A, en las semanas del 19 de octubre al 15 de noviembre de 2026 (o las de marzo si usas esa alternativa), aparecen todos los eventos con su etiqueta `[M365-TEST ...]`: S2 en cinco martes, S4, S5 y S3 como aceptadas, S6 y S6b con el candado de privado, S7 como evento de todo el día y S8 como Ocupado.

## Parte 9 – Modificaciones (Ronda B)

**Qué hacer**

Haz esto **solo después** de que el equipo confirme «Ronda A capturada». Cada fila es un cambio que debes enviar de verdad (Enviar, Send) desde la cuenta indicada.

| ID | Quién | Qué hacer |
| --- | --- | --- |
| S2 | B | Abre **solo** la repetición del martes 2026-11-03 y elige Este evento (This event). Muévela a 11:00-11:30, cambia el asunto a `[M365-TEST S2] series (edited)` y envía. |
| S3 | B | Cancela la reunión y envía la cancelación. A **no** debe abrir ni procesar el mensaje de cancelación. Anota si el evento desapareció solo del calendario de A. |
| S4 | A | Abre la reunión y elige Rechazar (Decline) > Enviar la respuesta ahora (Send the response now). |
| S5 | B | Cambia la hora a 11:00-11:30 el mismo día (viernes 2026-10-30) y envía la actualización. A no hace nada. |
| S5b | B | Muévela al miércoles 2026-12-09, 12:00-12:30 (fuera de la ventana de captura) y envía la actualización. |
| S1, S1b, S6, S6b, S7, S7b, S8, E3, E4, E5 | nadie | Sin cambios. |
| E1 | B | Abre **solo** la repetición del jueves 2026-11-05, elige Este evento (This event) > Cancelar (Cancel) > Enviar (Send). |
| E2 | B | Abre la repetición del lunes 2026-11-02 y elige Este y todos los eventos siguientes (This and all following events). Cambia la hora a 17:00-17:30 y envía. |
| E6 | A | Abre **solo** la repetición del miércoles 2026-11-04 y recházala (Rechazar, Decline), sin tocar el resto de la serie. |

Con la alternativa de marzo, aplica el mismo desplazamiento de 154 días a todas las fechas de esta tabla. Cuando termines, envía «Ronda B lista» con tus notas, por ejemplo si S3 desapareció solo del calendario de A.

**Por qué**

Cada cambio enseña cómo informa Outlook de una reunión movida, cancelada o rechazada a la persona invitada. Eso decide cómo solidtime detectará los registros de tiempo que ya no coinciden con Outlook.

**Cómo comprobarlo**

En el calendario de A, S2 muestra la repetición del 3 de noviembre a las 11:00 con el asunto editado, S4 aparece como rechazada o ya no aparece, S5 muestra las 11:00 y S5b ya no aparece en noviembre.

## Parte 10 – Entrega

**Qué hacer**

**Nunca pegues un secreto ni una contraseña en un chat, un correo, Teams, un ticket ni el
repositorio.** Los secretos y las credenciales viajan solo por el gestor de contraseñas de la empresa
(recurso compartido) o por un enlace de un solo uso que caduque. El resto de datos no son secretos y
se envían por el canal normal.

Avisos al equipo: «Registro listo» cuando el registro y las usuarias de prueba estén preparados,
«Ronda A lista» y «Ronda B lista».

Marca cada punto cuando lo hayas enviado. Los puntos con `(runbook)` se guardan en el runbook del
repositorio (`docs/m365/RUNBOOK-entra-app.md`) porque no son secretos.

- [ ] Directory (tenant) ID (runbook)
- [ ] Application (client) ID (runbook)
- [ ] Nombre del grupo asignado, o la palabra «individual» si asignaste personas una a una (runbook)
- [ ] Fecha de caducidad del secreto de producción (runbook)
- [ ] Fecha del recordatorio de renovación y rol responsable (runbook)
- [ ] Fecha de la comprobación del Valor del secreto de producción (runbook)
- [ ] Fecha de caducidad del secreto spike (runbook)
- [ ] Hallazgos de acceso condicional (runbook)
- [ ] Dominio Dokploy registrado en el URI de producción (runbook)
- [ ] Secreto spike: solo por el gestor de contraseñas o por un enlace de un solo uso con caducidad
- [ ] Secreto de producción: se queda en el gestor de contraseñas; no se envía a nadie
- [ ] Direcciones y credenciales de las usuarias de prueba A y B: las credenciales solo por el gestor
      de contraseñas
- [ ] Cliente de Outlook usado (web, nuevo o clásico)
- [ ] Zona horaria del buzón
- [ ] Etiquetas del portal o de Outlook que no coincidían con esta guía

**Por qué**

Todo lo que no es secreto queda documentado en el repositorio para renovar y auditar la configuración.
Un secreto en un chat o en un repositorio queda expuesto para siempre y obliga a rotarlo.

**Cómo comprobarlo**

Cada punto de la lista está marcado y el equipo confirma haberlos recibido. Si en algún momento un
secreto se pegó donde no debía, avisa al equipo: se elimina y se crea otro.
