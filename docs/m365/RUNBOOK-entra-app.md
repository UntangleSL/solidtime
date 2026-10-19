# Runbook: registro de solidtime en Microsoft Entra

Este documento guarda los valores **no secretos** del registro de la aplicación `solidtime-m365`, el
resultado de su verificación y los procedimientos de renovación y limpieza. Lo rellena el equipo de
desarrollo con lo que entrega la administración de Microsoft 365 (guía: `docs/m365/GUIA-ADMIN-ENTRA.md`,
Parte 10).

**Nunca secretos aquí.** Este fichero no contiene valores de secretos de cliente, tokens, contraseñas
ni direcciones de correo reales. Los secretos viajan solo por el gestor de contraseñas de la empresa.
Mientras la administración no responda, cada valor lleva la marca `PENDIENTE`.

## Valores del registro

| Clave | Valor |
| --- | --- |
| Directory (tenant) ID | PENDIENTE |
| Application (client) ID | PENDIENTE |
| Redirect URIs | `https://time.untangle.es/auth/microsoft/callback`<br>`https://solidtime.test/auth/microsoft/callback`<br>`http://localhost/auth/microsoft/callback`<br>`http://localhost/m365-spike/callback` (TEMPORAL: se elimina en la limpieza) |
| Scopes delegados | `openid profile email offline_access User.Read Calendars.Read` |
| Modo de acceso | PENDIENTE |
| Dominios | untanglegrowth.com (primario), untangle.es |
| Caducidad del secreto de producción | PENDIENTE |
| Recordatorio de renovación | PENDIENTE |
| Responsable del recordatorio | PENDIENTE |
| Caducidad del secreto spike | PENDIENTE |
| Acceso condicional | PENDIENTE |
| Dominio Dokploy | PENDIENTE |

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

## Verificación

Se rellena cuando la herramienta de captura comprueba el registro con la usuaria de prueba A y la
usuaria B. Hasta entonces, todo es `PENDIENTE`. Se registra:

- Fecha de la verificación: PENDIENTE
- scopeMatches (los permisos devueltos coinciden con los configurados y se emitió refresh token): PENDIENTE
- Sin pantalla de consentimiento para la usuaria A: PENDIENTE
- Usuaria B (Alejandro Cava, sin rol de administrador, no asignada) inicia sesión sin pantalla de permisos y recibe los seis permisos: PENDIENTE
- Acceso condicional (pestaña Acceso condicional del registro de inicio de sesión): PENDIENTE
- Secreto de producción: Valor comprobado por la administración (tres primeros caracteres coinciden y no es el Id. de secreto): PENDIENTE. La obtención de un token con este secreto se prueba en la Fase 2, en el primer inicio de sesión con Microsoft en Dokploy (criterio 1 de la Fase 2 del ROADMAP); allí AADSTS7000215 indica que el valor guardado es incorrecto y se crea un secreto nuevo según `## Renovación del secreto`.

## Doppler

Los secretos y los identificadores viven en Doppler, proyecto `vps`, configuraciones `dev` y `prd`.
Las claves llevan el prefijo `SOLIDTIME_` y van en mayúsculas. Aquí solo se anotan los **nombres**,
nunca los valores.

| Configuración | Clave | Contenido |
| --- | --- | --- |
| `prd` | `SOLIDTIME_MICROSOFT_CLIENT_SECRET` | Secreto de producción. La herramienta de captura no lo lee nunca. |
| `dev` | `SOLIDTIME_M365_SPIKE_CLIENT_SECRET` | Secreto spike (TEMPORAL), solo para la herramienta de captura. |
| `dev` y `prd` | `SOLIDTIME_MICROSOFT_TENANT_ID` | Directory (tenant) ID. |
| `dev` y `prd` | `SOLIDTIME_MICROSOFT_CLIENT_ID` | Application (client) ID. |

La herramienta de captura se ejecuta así:

```sh
doppler run -p vps -c dev -- node tests/Tools/m365-spike/capture.mjs <comando>
```

Si el secreto de producción aparece en el entorno (por ejemplo, copiado a `dev`), la herramienta
se niega a ejecutarse.

## Renovación del secreto

Procedimiento sin corte de servicio (Entra admite dos secretos a la vez):

1. Con el secreto antiguo todavía vigente, crea un secreto nuevo (guía, Parte 4 a): descripción
   `produccion-AAAA-MM`, 180 días, y copia el Valor al gestor de contraseñas.
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

Las capturas ya hechas, los identificadores inmutables y la sal local de seudónimos no dependen del
secreto y siguen siendo válidos.

## Limpieza tras el spike

- [ ] Eliminar el URI `http://localhost/m365-spike/callback` del registro (Autenticación > Web).
- [ ] Eliminar el secreto `spike-*` en Certificados y secretos.
- [ ] Borrar en local `tests/Tools/m365-spike/raw/` y `tests/Tools/m365-spike/.env.local`.
- [ ] Marcar en la guía las líneas que nombran el URI spike y el secreto spike como `RETIRADO <fecha>`.
- [ ] Actualizar `Redirect URIs` y `Caducidad del secreto spike` en esta tabla (con una nota
      `(eliminado AAAA-MM-DD)`) y añadir la línea a `## Historial`.

## Historial

| Fecha | Cambio | Quién |
| --- | --- | --- |
| 2026-10-19 | Esqueleto creado con valores PENDIENTE | Desarrollo |
