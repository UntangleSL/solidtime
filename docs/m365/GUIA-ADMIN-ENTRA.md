# Guía para la administración de Microsoft 365: registrar solidtime en Microsoft Entra

Esta guía es para la persona que administra Microsoft 365 en Untangle. No hace falta saber programar:
cada paso dice por dónde entrar, qué pulsar y qué valor pegar, y termina con lo que debes ver en
pantalla para saber que ha salido bien.

**Qué es la aplicación.** solidtime es la herramienta de control de tiempo de Untangle. Con esta
configuración el equipo podrá entrar con su cuenta de Microsoft 365 y ver sus reuniones de Outlook
dentro de solidtime. La aplicación solo **lee** los calendarios: no puede crear, cambiar ni borrar
nada en Outlook.

**Cuánto tiempo lleva.** Unos 45 minutos para registrar la aplicación (Partes 1 a 5) y entregar los
datos (Parte 10).

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
consentimiento), Parte 4 (secretos de cliente), Parte 5 (aplicación empresarial) y Parte 10
(entrega).

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
