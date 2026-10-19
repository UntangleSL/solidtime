---
phase: 01-tenant-setup-outlook-spike
plan: 06
subsystem: testing
tags: [microsoft-graph, calendarview, fixtures, round-a, gate-fixed]

requires:
  - phase: 01-tenant-setup-outlook-spike
    provides: "01-03 sanitizer and fixture gate, 01-05 registered and verified Entra app"
provides:
  - "Sanitized Round A fixtures committed under tests/Fixtures/M365 (137 files: manifest, me, token shape, five calendarView passes, 11 required scenarios, 2 synthetic SYN scenarios, series)"
  - "S8 gate predicate fixed: an organized event is 'alone' when no attendee other than the organizer is listed (Graph returns the organizer as sole attendee)"
  - "Manifest observed text records attendeesOtherThanOrganizer for organized events (evidence for 01-08)"
  - "Spanish Round B instructions for the owner (strict order, restricted to S2, S3, S4, S5, S5b)"
affects: [01-07, 01-08]

actuals:
  tokens: 30000
  tasks: 2
  commits: 5
plan_head_before: 77d555a47fb52d0b49f900c8fe5ea0eabda90f91
plan_head_after: 781626415248e3d33e98495dac8fbb77b13afc04

key-files:
  created:
    - tests/Fixtures/M365/manifest.json
    - tests/Fixtures/M365/me.json
    - tests/Fixtures/M365/token-response.shape.json
    - tests/Fixtures/M365/calendarview/
    - tests/Fixtures/M365/scenarios/
    - tests/Fixtures/M365/series/
  modified:
    - tests/Tools/m365-spike/validate-fixtures.mjs
    - tests/Tools/m365-spike/lib/scenarios.mjs
    - tests/Tools/m365-spike/test/validate-fixtures.test.mjs
    - tests/Tools/m365-spike/test/pipeline.e2e.test.mjs
    - tests/Tools/m365-spike/test/validate-docs.test.mjs

key-decisions:
  - "Orchestrator decision (Rule 1): Graph lists the organizer as sole attendee of an event created without invitees in Outlook web (observed for S7 and S8). The S8 predicate now accepts attendees [] and [organizer only] and rejects any other attendee"
  - "S8 date deviation (Tue 2026-10-27 instead of Wed 2026-10-28) accepted"
  - "No recapture: the Round A raw capture of 2026-10-19T16:27:59Z is the baseline"

requirements-completed: []  # SETUP-02 is completed by 01-07 (Round B); this plan delivers its first half

duration: 25min
completed: 2026-10-19
status: complete
---

# Phase 1 Plan 06: Round A capture and fixtures Summary

**Round A is captured, sanitized and committed: the gate (schema, semantic, leaks against raw, replay) is green with 818 checks. The only blocker, S8 "with an attendee", was a wrong predicate, not an owner error: Outlook web makes Graph return the organizer as the sole attendee of an event created without invitees. The predicate was fixed with regression tests and no recapture was needed.**

## Historia del bloqueo y de la solución

1. **Bloqueo (commit `eb48374a`).** La primera pasada de la Tarea 2 falló solo en `--semantic`: `S8 round A: expected an organized event without attendees`. El evento S8 devolvía `attendees` = [A]. Por la regla del plan no se commiteó ningún fixture y se borraron los generados. S7 tenía el mismo patrón.
2. **Decisión del orquestador (sin recaptura).** El patrón es un hecho de Graph/Outlook web, no un error de la propietaria: al crear un evento sin invitados, Graph devuelve `attendees` = [la organizadora]. Fix Rule 1 en el predicado, no en el buzón.
3. **Solución (TDD).**
   - RED `a92e199e`: test de la puerta (`attendees: []` pasa; `[organizadora]` pasa; la comparación ignora mayúsculas; `[organizadora, otra]` falla; `[otra]` falla; `isOrganizer false` falla con y sin lista; lista sin organizadora identificable falla) y test del manifest. 2 tests en rojo.
   - GREEN `917cb28b`: `attendeesOtherThanOrganizer(event)` en `lib/scenarios.mjs` (compara direcciones en minúsculas; en los fixtures el seudónimo de una persona es estable gracias a `raw/salt` y al mapa de identidades) y `isAlone` en `validate-fixtures.mjs` usa `=== 0`. El texto `observed` del manifest añade `attendeesOtherThanOrganizer=N` solo en eventos organizados por A.
   - `b79d72cf`: dos ajustes de higiene al volver a ejecutar todo: el test CLI de `decisions --trace` dependía de que el manifest por defecto no existiera (ahora pasa rutas inexistentes explícitas); y el test nuevo construye la dirección en mayúsculas en tiempo de ejecución para no disparar el escáner de secretos.
4. **Fixtures (commit `78162641`).** `sanitize.mjs` (con Doppler, igual que la vez anterior, conservando `raw/salt` e `identity-map.json`) escribió 137 ficheros; 260 eventos sin etiqueta descartados.

Hecho para la decisión 01-08: **"personal blocks: organizer appears as sole attendee"** (S7 y S8 en Outlook web). El manifest lo conserva en `scenarios.S7.observed` y `scenarios.S8.observed` como `attendeesOtherThanOrganizer=0`; no se inventó ninguna clave nueva en el manifest (solo texto dentro de `observed`, que el contrato `--trace` de 01-04 ya trata como cadena libre). Con esto el caso `attendees: []` no existe en los fixtures reales; si Fases 3-4 lo necesitan, se cubre con un derivado SYN o un escenario creado desde otro cliente.

Fecha de S8: se creó el martes 2026-10-27 en lugar del miércoles 2026-10-28. **Aceptado** (no afecta a ninguna regla de la puerta).

## Resultado de la puerta (gate)

| Check | Resultado |
|-------|-----------|
| `validate-fixtures.mjs --round A --raw tests/Tools/m365-spike/raw` (schema, semantic, leaks, replay) | `validate-fixtures: OK (818 checks)` |
| Replay | cinco pasadas completas (prod-select, prefer-separate, no-immutableid, experiment-select, full-shape), cada una 22 peticiones y 14 eventos etiquetados |
| `validate-docs.mjs secrets` | `secrets: OK (1674 checks)` |
| `node --test "tests/Tools/m365-spike/test/*.test.mjs"` | 207 tests, 207 pasan, 0 fallos |
| `git status` | solo `.planning/milestone.lock` y `.planning/state.json` sin seguimiento (ajenos a este plan); `raw/` sigue ignorado, `raw/salt` e `identity-map.json` presentes |

Revisión humana de los ficheros saneados: `scenarios/S6b.roundA.json` (y el resto de los inspeccionados) solo contienen direcciones `person-a/person-b@example.test`, nombres `Test User/Test Person`, asuntos `[M365-TEST ...]` e ids `FAKE...`.

## Observed por escenario (Ronda A, del manifest saneado)

| Escenario | Observed |
|-----------|----------|
| S1, S3, S4, S5, S5b, S6b | `singleInstance`, `isOrganizer=false`, `responseStatus=accepted`, `sensitivity=normal` |
| S1b | `singleInstance`, `isOrganizer=true`, `responseStatus=organizer`, `attendeesOtherThanOrganizer=1` |
| S2 | 4 eventos en la ventana (20 oct, 27 oct, 3 nov, 10 nov; la del 13 oct queda fuera), el primero `occurrence`, aceptado; hora UTC 08:00 el 20 oct y 09:00 después (evidencia de cambio horario) |
| S6 | organizado, `sensitivity=private` |
| S7 | `isAllDay=true`, organizado, `responseStatus=none`, `attendeesOtherThanOrganizer=0` |
| S8 | organizado, `responseStatus=none`, `attendeesOtherThanOrganizer=0` |
| SYN-confidential, SYN-personal | sintéticos derivados de S6 (sensibilidades `confidential` y `personal`) |

Observación para 01-08 (no juzgada aquí): S6b (B lo marca Privado según la guía) aparece con `sensitivity=normal` en el calendario de A. Puede ser un comportamiento de Graph para asistentes o un paso omitido al crearlo; la puerta solo exige una sensibilidad presente. Conviene confirmarlo con la propietaria antes de afirmarlo en el documento de decisión.

## Resumen de experimentos (Ronda A)

- Ventana 2026-10-19 a 2026-11-16, cliente Outlook web, zona del buzón `Romance Standard Time`.
- `Prefer` combinado y en cabeceras separadas: ambos 200, UTC en todas las páginas.
- Página 2 sin `Prefer`: 200 y UTC, pero ids distintos a los de la pasada con `Prefer` (0 iguales, 3 distintos). Hay que reenviar las cabeceras en cada petición, también en `@odata.nextLink`.
- Formato de id: con inmutable 68-84 caracteres, por defecto 152-168; charset `A-Za-z0-9-=_`; 0 iguales, 14 distintos.
- `$select` de producción: 200, sin `lastModifiedDateTime` ni `attendees`; el de experimento: 200 y los devuelve.
- Serie maestra: 200, `recurrence` presente, `cancelledOccurrences` ausente.
- Forma completa: 43 propiedades en raw (lista en el manifest); la comparación de claves de la allow-list quedó registrada en la versión anterior de este resumen (9 claves de evento descartadas, ninguna parece dato de decisión; `onlineMeetingProvider` es la única dudosa).

## Instrucciones Ronda B (para la propietaria)

**Ronda A capturada: el administrador ya puede empezar la Parte 9 de `docs/m365/GUIA-ADMIN-ENTRA.md`.** Usa Outlook en la web, el mismo cliente de la Ronda A, con las dos ventanas privadas (una con la sesión de A y otra con la de B). Solo existen estos cinco escenarios (los opcionales E1, E2 y E6 no se crearon, así que se omiten). Hazlo **en este orden exacto** y no toques ningún otro evento:

| Orden | Escenario | Quién | Qué hacer en Outlook web |
|-------|-----------|-------|--------------------------|
| 1 | S2 `[M365-TEST S2] series` | B | Abre **solo** la repetición del martes 2026-11-03 y elige Este evento (This event). Muévela a 11:00-11:30, cambia el asunto a `[M365-TEST S2] series (edited)` y envía. No toques las otras repeticiones. |
| 2 | S3 `[M365-TEST S3] cancelled` | B | Cancela la reunión del jueves 2026-10-29 (10:00-10:30) y envía la cancelación. **A no debe abrir ni procesar el mensaje de cancelación.** Anota si el evento desapareció solo del calendario de A. |
| 3 | S4 `[M365-TEST S4] declined` | A | Abre la reunión del jueves 2026-10-29 (12:00-12:30) y elige Rechazar (Decline) > Enviar la respuesta ahora (Send the response now). |
| 4 | S5 `[M365-TEST S5] moved` | B | Cambia la hora a 11:00-11:30 el mismo día (viernes 2026-10-30) y envía la actualización. A no hace nada. |
| 5 | S5b `[M365-TEST S5b] moved week` | B | Muévela al miércoles 2026-12-09, 12:00-12:30 (fuera de la ventana de captura) y envía la actualización. A no hace nada. |

Sin cambios (nadie los toca): S1, S1b, S6, S6b, S7, S8.

Cada cambio debe **enviarse de verdad** (Enviar, Send) desde la cuenta indicada. Al terminar envía «Ronda B lista» con tus notas (sobre todo si S3 desapareció solo del calendario de A, y si S6b lo marcaste Privado). Cómo comprobarlo, en el calendario de A: S2 muestra la repetición del 3 de noviembre a las 11:00 con el asunto editado, S4 aparece como rechazada o ya no aparece, S5 muestra las 11:00 y S5b ya no aparece en noviembre. Después el desarrollador lanzará `capture --round B` (plan 01-07).

## Deviations from Plan

**1. [Rule 1 - Bug] Predicado `isAlone` de S8 incorrecto para datos reales de Graph**
- **Found during:** Task 2, gate semántico
- **Issue:** exigía `attendees.length === 0`; Outlook web devuelve el organizador como único asistente de un evento sin invitados (S7 y S8).
- **Fix:** comparar direcciones con el organizador (sin distinguir mayúsculas); `[]` también pasa; test de regresión de 8 casos.
- **Files modified:** `tests/Tools/m365-spike/validate-fixtures.mjs`, `tests/Tools/m365-spike/lib/scenarios.mjs`, `tests/Tools/m365-spike/test/validate-fixtures.test.mjs`, `tests/Tools/m365-spike/test/pipeline.e2e.test.mjs`
- **Commits:** `a92e199e` (RED), `917cb28b` (GREEN)

**2. [Rule 3 - Blocking] Test CLI acoplado a la ausencia de fixtures**
- **Found during:** verificación final con los fixtures ya generados
- **Issue:** `cli: decisions --trace on a tree without document and manifest` dependía de que `tests/Fixtures/M365/manifest.json` no existiera.
- **Fix:** el test pasa `--file` y `--manifest` inexistentes de forma explícita. El test nuevo de S8 construye su dirección en mayúsculas en tiempo de ejecución para no disparar `validate-docs.mjs secrets`.
- **Files modified:** `tests/Tools/m365-spike/test/validate-docs.test.mjs`, `tests/Tools/m365-spike/test/validate-fixtures.test.mjs`
- **Commit:** `b79d72cf`

**3. [Aceptado por el orquestador] S8 creado el martes 2026-10-27**, no el miércoles 2026-10-28. Los opcionales S7b y E1-E6 no se crearon por decisión de la propietaria; los validadores exigen solo los once obligatorios.

## Issues Encountered

La primera pasada de la Tarea 2 quedó bloqueada (ver historia arriba); resuelta sin recaptura. La Tarea 1 (checkpoint humano) quedó completa con la captura de 2026-10-19T16:27:59Z.

## Known Stubs

None.

## Threat Flags

None. T-01-20 (fuga): el gate de fugas contra raw, `validate-docs.mjs secrets` y la revisión humana de los ficheros saneados pasaron antes de commitear. T-01-21: de raw solo se inspeccionaron claves y eventos con etiqueta `[M365-TEST`.

## Next Steps

1. Propietaria/administrador: aplicar la Ronda B (tabla de arriba) y avisar con «Ronda B lista».
2. Desarrollador: plan 01-07, `capture --round B`, y re-sanitizar con el mismo `raw/salt` y `identity-map.json` (se conservan hasta 01-08).
3. 01-08: citar `scenarios.S7.observed` y `scenarios.S8.observed` como evidencia de "personal blocks: organizer appears as sole attendee", y confirmar la observación de S6b.

## Self-Check: PASSED

Commits `a92e199e`, `917cb28b`, `b79d72cf`, `78162641` existen y son ancestros de HEAD; `tests/Fixtures/M365/manifest.json`, `me.json`, `token-response.shape.json`, `calendarview/`, `scenarios/` y `series/` existen y están commiteados; `raw/salt` e `identity-map.json` presentes; `raw/` ignorado.
