# Runbook: registro de solidtime en Microsoft Entra

Este documento guarda los valores **no secretos** del registro de la aplicación `solidtime-m365`, el
resultado de su verificación y los procedimientos de renovación y limpieza. Lo rellena el equipo de
desarrollo con lo que entrega la administración de Microsoft 365 (guía: `docs/m365/GUIA-ADMIN-ENTRA.md`,
Parte 10).

**Nunca secretos aquí.** Este fichero no contiene valores de secretos de cliente, tokens, contraseñas
ni direcciones de correo reales. Los secretos viajan solo por el gestor de contraseñas de la empresa.
Los valores se completaron el 2026-10-19, tras el registro y la verificación.

## Valores del registro

| Clave | Valor |
| --- | --- |
| Directory (tenant) ID | fad1cfee-2190-49da-ab7f-95c7ed3bd46a |
| Application (client) ID | 3ec957c9-3350-4585-abaa-4793e28da27d |
| Redirect URIs | `https://time.untangle.es/auth/microsoft/callback`<br>`https://solidtime.test/auth/microsoft/callback`<br>`http://localhost/auth/microsoft/callback`<br>`http://localhost/m365-spike/callback` (TEMPORAL: sigue en Entra; eliminación APLAZADA hasta producción, ver `## Limpieza tras el spike`) |
| Scopes delegados | `openid profile email offline_access User.Read Calendars.Read` |
| Modo de acceso | tenant (Asignación requerida = No; sin asignaciones) |
| Dominios | untanglegrowth.com (primario), untangle.es |
| Caducidad del secreto de producción | 2028-10-19 (secreto `produccion-2026-10`, creado 2026-10-19; 24 meses, ver nota) |
| Recordatorio de renovación | 2028-09-04 (calendario de Outlook de la administración) |
| Responsable del recordatorio | Administración de Microsoft 365 (Global Administrator) |
| Caducidad del secreto spike | 2027-04-19 (secreto `spike-2026-10`, creado 2026-10-19; 6 meses; sigue en Entra: eliminación APLAZADA hasta producción; su valor ya no existe en Doppler) |
| Acceso condicional | Sin políticas de acceso condicional; el tenant usa Security Defaults (MFA obligatorio para toda la organización). Sin cambios. |
| Dominio Dokploy | time.untangle.es |

Notas sobre las claves:

- `Modo de acceso`: `tenant` (decidido 2026-10-19): la aplicación empresarial tiene
  ¿Asignación requerida? = No y puede entrar cualquier miembro del tenant. Con Business Standard no
  hay Entra ID P1, así que no se pueden asignar grupos; los invitados (guests) se rechazan después,
  en el código de solidtime (AUTH-02), no en Entra. Si alguien activa la asignación por error, las
  personas no asignadas recibirán AADSTS50105.
- `Dominios`: dominios del tenant, `untanglegrowth.com` (primario) y `untangle.es`.
- `Caducidad del secreto de producción`, `Recordatorio de renovación` y `Caducidad del secreto spike`
  empiezan por una fecha ISO `AAAA-MM-DD`. El recordatorio está al menos 30 días antes de la
  caducidad (recomendado: 45).
- `Responsable del recordatorio`: un rol de administración, no una persona concreta.
- `Dominio Dokploy`: `time.untangle.es` (decidido 2026-10-19).
- `Caducidad del secreto de producción`: desviación de la guía (recomienda 180 días). La propietaria
  eligió 24 meses (2026-10-19) porque hay una sola persona administradora y el secreto vive solo en
  Doppler `vps`/`prd`; el recordatorio (2028-09-04) está en su calendario de Outlook, más de 30 días
  antes de la caducidad.
- `Acceso condicional`: Security Defaults exige MFA a toda la organización, por eso los inicios de
  sesión de verificación pasaron por MFA sin necesidad de políticas propias.

## Verificación

Resultado de la comprobación del registro con la herramienta de captura (`capture.mjs auth` y
`auth --as B`), con la usuaria de prueba A y la usuaria B. Se registra:

- Fecha de la verificación: 2026-10-19
- scopeMatches (los permisos devueltos coinciden con los configurados y se emitió refresh token): sí, para A y B (scopeMatches true, refreshTokenIssued true, tidMatches true, userType Member). Permisos concedidos: Calendars.Read, email, openid, profile, User.Read; offline_access se evidencia por el refresh token.
- Sin pantalla de consentimiento para la usuaria A: sí (2026-10-19, segunda ejecución). La primera ejecución mostró la pantalla porque aún no se había concedido el consentimiento de administrador; la administración marcó «Consentir en nombre de su organización» y desde entonces no aparece para nadie.
- Usuaria B (Alejandro Cava, sin rol de administrador, no asignada) inicia sesión sin pantalla de permisos y recibe los seis permisos: sí (2026-10-19; `auth --as B`: scopeMatches true, refresh token emitido, tid coincide, userType Member, consentPromptShown false)
- Acceso condicional (pestaña Acceso condicional del registro de inicio de sesión): sin políticas aplicadas; Security Defaults activo (MFA para toda la organización). Sin bloqueos.
- Secreto de producción: Valor comprobado por la administración (tres primeros caracteres coinciden y no es el Id. de secreto): 2026-10-19 (el primer intento guardó el Id. de secreto por error; se detectó por su formato de GUID de 36 caracteres, se recrearon los secretos y el valor guardado ahora tiene la forma de un Valor, 40 caracteres). La obtención de un token con este secreto se prueba en la Fase 2, en el primer inicio de sesión con Microsoft en Dokploy (criterio 1 de la Fase 2 del ROADMAP); allí AADSTS7000215 indica que el valor guardado es incorrecto y se crea un secreto nuevo según `## Renovación del secreto`.

## Doppler

Los secretos y los identificadores viven en Doppler, proyecto `vps`, configuraciones `dev` y `prd`.
Las claves llevan el prefijo `SOLIDTIME_` y van en mayúsculas. Aquí solo se anotan los **nombres**,
nunca los valores.

| Configuración | Clave | Contenido |
| --- | --- | --- |
| `prd` | `SOLIDTIME_MICROSOFT_CLIENT_SECRET` | Secreto de producción. La herramienta de captura no lo lee nunca. |
| `dev` | `SOLIDTIME_M365_SPIKE_CLIENT_SECRET` | Secreto spike (TEMPORAL), solo para la herramienta de captura. ELIMINADA de Doppler el 2026-10-19 (junto con las otras seis claves `SOLIDTIME_M365_SPIKE_*`); `dev` solo conserva `SOLIDTIME_MICROSOFT_CLIENT_ID` y `SOLIDTIME_MICROSOFT_TENANT_ID`. |
| `dev` y `prd` | `SOLIDTIME_MICROSOFT_TENANT_ID` | Directory (tenant) ID. |
| `dev` y `prd` | `SOLIDTIME_MICROSOFT_CLIENT_ID` | Application (client) ID. |

Desde 2026-10-19 las siete claves `SOLIDTIME_M365_SPIKE_*` ya no existen en Doppler y el valor del secreto
spike no se conserva en ningún sitio utilizable. Una captura nueva necesitaría un secreto spike nuevo
(guía, Parte 4 b) y volver a cargar las claves en `dev`. La herramienta de captura se ejecutaba así:

```sh
doppler run -p vps -c dev -- node tests/Tools/m365-spike/capture.mjs <comando>
```

Si el secreto de producción aparece en el entorno (por ejemplo, copiado a `dev`), la herramienta
se niega a ejecutarse.

## Renovación del secreto

Procedimiento sin corte de servicio (Entra admite dos secretos a la vez):

1. Con el secreto antiguo todavía vigente, crea un secreto nuevo (guía, Parte 4 a): descripción
   `produccion-AAAA-MM`, 24 meses (decisión de la propietaria, 2026-10-19), y copia el Valor al gestor de
   contraseñas (Doppler `vps`, entorno `prd`, `SOLIDTIME_MICROSOFT_CLIENT_SECRET`). Recordatorio 45 días antes.
2. Comprueba el Valor el mismo día (tres primeros caracteres, no es el Id. de secreto).
3. Actualiza la variable de entorno del secreto en Dokploy y redespliega.
4. Verifica que el inicio de sesión con Microsoft funciona.
5. Elimina el secreto antiguo en Entra.
6. Actualiza las filas `Caducidad del secreto de producción` y `Recordatorio de renovación`, crea el
   nuevo recordatorio y añade una línea a `## Historial`.

Endurecimiento posterior, fuera de la Fase 1: las credenciales de certificado son más seguras que los
secretos. De momento se mantiene un secreto de cliente (decisión D-01).

### Secreto spike

Si el secreto spike caduca antes de terminar la Ronda B (la herramienta de captura informa del error
AADSTS7000222):

1. La administración crea un secreto nuevo `spike-AAAA-MM` (guía, Parte 4 b), 180 días.
2. Lo entrega solo por el gestor de contraseñas.
3. Quien desarrolla actualiza `SOLIDTIME_M365_SPIKE_CLIENT_SECRET` en Doppler (`vps`, `dev`) o, si
   usa `tests/Tools/m365-spike/.env.local` (fichero fuera de git), el valor de ese fichero.
4. Se elimina el secreto spike antiguo.
5. Se actualizan la fila `Caducidad del secreto spike` y `## Historial`.

Las capturas ya hechas y los identificadores inmutables no dependen del secreto y siguen siendo válidos.
La sal local de seudónimos se borró el 2026-10-19 junto con `raw/`: una captura nueva usaría una sal nueva
y todos los identificadores de las Rondas A y B cambiarían.

## Limpieza tras el spike

Estado a 2026-10-19:

- [ ] Eliminar el URI `http://localhost/m365-spike/callback` del registro (Autenticación > Web). APLAZADO hasta producción (decisión de la propietaria 2026-10-19), pendiente en Fase 7 (criterio de éxito de la Fase 7 en el ROADMAP). El URI sigue registrado y las líneas de la guía siguen marcadas TEMPORAL.
- [ ] Eliminar el secreto `spike-2026-10` en Certificados y secretos. APLAZADO hasta producción (decisión de la propietaria 2026-10-19), pendiente en Fase 7. Caduca el 2027-04-19 aunque no se elimine antes.
- [x] Eliminar de Doppler (`vps`, `dev`) las siete claves `SOLIDTIME_M365_SPIKE_*`: hecho el 2026-10-19 por la orquestación (comprobado: `dev` solo conserva `SOLIDTIME_MICROSOFT_CLIENT_ID` y `SOLIDTIME_MICROSOFT_TENANT_ID`; `prd` sin cambios). Consecuencia: el valor del secreto spike ya no existe en ningún sitio utilizable y una captura nueva necesitaría un secreto spike nuevo.
- [x] Borrar en local `tests/Tools/m365-spike/raw/` (datos reales de buzones de prueba, sal e identidad de seudónimos): hecho el 2026-10-19, tras pasar `validate-fixtures --raw` (esquema, semántica, fugas y reproducción de las páginas completas) y con la aprobación de la propietaria. `tests/Tools/m365-spike/.env.local` no existía (se usó Doppler).
- [ ] Marcar en la guía las líneas que nombran el URI spike y el secreto spike como `RETIRADO <fecha>`. APLAZADO junto con la eliminación en Entra: mientras el URI y el secreto sigan registrados, la guía los mantiene como TEMPORAL y no se marcan RETIRADO.
- [ ] Al eliminar el URI y el secreto en Entra: actualizar `Redirect URIs` y `Caducidad del secreto spike` en esta tabla (con una nota `(eliminado AAAA-MM-DD)`), marcar la guía como RETIRADO y añadir la línea a `## Historial`.

PHPUnit (`CalendarViewFixturesTest`): no disponible el 2026-10-19 (el equipo de desarrollo no tiene PHP ni Docker); pendiente de CI o Sail. La reproducción en Node de cada secuencia completa de páginas sí pasó (21 o 22 peticiones y 12 o 14 eventos por pasada).

## Historial

| Fecha | Cambio | Quién |
| --- | --- | --- |
| 2026-10-19 | Esqueleto creado | Desarrollo |
| 2026-10-19 | Registro creado y verificado | administrador M365 / desarrollador |
| 2026-10-19 | Doppler: eliminadas las siete claves `SOLIDTIME_M365_SPIKE_*` de `vps`/`dev` | Orquestación (aprobado por la propietaria) |
| 2026-10-19 | Local: borrado `tests/Tools/m365-spike/raw/` tras pasar el control de fixtures con raw | Desarrollo |
| 2026-10-19 | Limpieza en Entra (URI spike y secreto `spike-2026-10`) APLAZADA hasta producción; pendiente en Fase 7 | propietaria (decisión) |
